import { Router } from "express";
import type { Response } from "express";
import { db } from "../db/db.js";
import { ratings, restaurants, partners, users } from "../db/schema.js";
import { and, eq, inArray, avg, count } from "drizzle-orm";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authenticateUser, requirePartner } from "../middleware/auth.js";
import { AuthHelper, DbHelper, ResponseHelper, ValidationHelper } from "../utils/api-helpers.js";
import {
  addJiraComment,
  buildHeading,
  buildKeyValueParagraph,
  buildParagraph,
  createJiraTicket,
  extractIssueMetadata,
  fetchJiraIssue,
  searchJiraIssues,
  transitionIssueToCategory,
  type JiraDocument,
  type JiraIssue,
} from "../utils/jira.js";

const router = Router();
const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || "SCRUM";

router.use(authenticateUser);

router.post("/", requirePartner, async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const { ratingId, reason } = req.body as { ratingId?: number; reason?: string };

  if (!ratingId || typeof ratingId !== "number" || ratingId <= 0) {
    return ResponseHelper.badRequest(res, "Valid rating ID is required");
  }

  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    return ResponseHelper.badRequest(res, "Reason for report is required");
  }

  if (reason.length > 1000) {
    return ResponseHelper.badRequest(res, "Reason must be less than 1000 characters");
  }

  const trimmedReason = reason.trim();

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      const ratingRecord = await getRatingForPartner(ratingId, userId);
      if (!ratingRecord) {
        throw new Error("Rating not found or you do not have permission to report it");
      }

      if (!ratingRecord.comment) {
        throw new Error("Only comments can be reported");
      }

      const existingIssue = await findExistingCommentReport(ratingId, userId);
      if (existingIssue) {
        throw new Error(
          existingIssue.key
            ? `This comment has already been reported. Ticket ${existingIssue.key} is in review.`
            : "This comment has already been reported."
        );
      }

      const jiraTicket = await createJiraTicket({
        summary: `Comment Report: ${ratingRecord.restaurantName} (Rating ${ratingRecord.id})`,
        description: buildCommentReportDescription({
          ratingId: ratingRecord.id,
          restaurantName: ratingRecord.restaurantName,
          ratingValue: ratingRecord.rating,
          comment: ratingRecord.comment,
          reviewerName: ratingRecord.reviewerName || "FoodBargain Diner",
          reviewerEmail: ratingRecord.reviewerEmail || "N/A",
          reportedBy: ratingRecord.partnerName || "Restaurant Partner",
          reason: trimmedReason,
        }),
        labels: ["comment-report", `restaurant-${ratingRecord.restaurantId}`],
        metadata: {
          type: "comment-report",
          ratingId: ratingRecord.id,
          restaurantId: ratingRecord.restaurantId,
          restaurantName: ratingRecord.restaurantName,
          reviewerId: ratingRecord.reviewerId,
          reviewerName: ratingRecord.reviewerName,
          partnerUserId: userId,
          reason: trimmedReason,
        },
      });

      return {
        ratingId: ratingRecord.id,
        jiraTicketId: jiraTicket.key,
        createdAt: jiraTicket.createdAt,
      };
    },
    res,
    "Failed to submit report"
  );

  if (result) {
    ResponseHelper.success(res, result, "Report submitted successfully", 201);
  }
});

router.get("/check/:ratingId", requirePartner, async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const ratingId = ValidationHelper.parseId(req.params.ratingId as string);
  if (ratingId === null) {
    return ResponseHelper.badRequest(res, "Invalid rating ID");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      const ratingRecord = await getRatingForPartner(ratingId, userId);
      if (!ratingRecord) {
        throw new Error("Rating not found or you do not have permission to view it");
      }

      const issue = await findExistingCommentReport(ratingId, userId);
      return {
        hasReported: Boolean(issue),
        ratingId,
        jiraTicketId: issue?.key ?? null,
        createdAt: issue?.fields.created ?? null,
        metadata: issue ? extractIssueMetadata(issue) : null,
      };
    },
    res,
    "Failed to check report status"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  const adminId = AuthHelper.requireAdmin(req, res);
  if (!adminId) return;

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      const issues = await searchJiraIssues({
        jql:
          `project = ${JIRA_PROJECT_KEY} AND labels = "comment-report" ` +
          "AND statusCategory != Done ORDER BY created DESC",
        fields: ["key", "summary", "status", "description", "created"],
        maxResults: 100,
      });

      if (issues.length === 0) {
        return [];
      }

      const metadataList = issues.map((issue) => ({
        issue,
        metadata: extractIssueMetadata(issue),
      }));

      const ratingIds = metadataList
        .map((item) => Number(item.metadata?.ratingId))
        .filter((id): id is number => Number.isFinite(id));

      const ratingsData = ratingIds.length
        ? await db
            .select({
              id: ratings.id,
              rating: ratings.rating,
              comment: ratings.comment,
              createdAt: ratings.createdAt,
              restaurantId: ratings.targetId,
              reviewerName: users.displayName,
              reviewerEmail: users.email,
              restaurantName: restaurants.name,
            })
            .from(ratings)
            .leftJoin(users, eq(users.id, ratings.userId))
            .leftJoin(restaurants, eq(restaurants.id, ratings.targetId))
            .where(inArray(ratings.id, ratingIds))
        : [];

      const ratingMap = new Map(ratingsData.map((record) => [record.id, record]));

      return metadataList.map(({ issue, metadata }) => ({
        issueKey: issue.key,
        status: issue.fields.status?.name ?? "Unknown",
        createdAt: issue.fields.created,
        metadata,
        rating: metadata?.ratingId ? (ratingMap.get(Number(metadata.ratingId)) ?? null) : null,
      }));
    },
    res,
    "Failed to load comment reports"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

router.post("/:issueKey/dismiss", async (req: AuthenticatedRequest, res: Response) => {
  const adminId = AuthHelper.requireAdmin(req, res);
  if (!adminId) return;

  const { note } = req.body as { note?: string };
  const issueKey = req.params.issueKey as string;

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      if (note) {
        await addJiraComment(issueKey, `Dismissed by admin: ${note}`);
      }
      await transitionIssueToCategory(issueKey, "Done");
      return { issueKey, dismissed: true };
    },
    res,
    "Failed to dismiss report"
  );

  if (result) {
    ResponseHelper.success(res, result, "Report dismissed");
  }
});

router.post("/:issueKey/remove", async (req: AuthenticatedRequest, res: Response) => {
  const adminId = AuthHelper.requireAdmin(req, res);
  if (!adminId) return;

  const { ratingId: providedRatingId, note } = req.body as { ratingId?: number; note?: string };
  const issueKey = req.params.issueKey as string;

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      const ratingId = await resolveRatingId(issueKey, providedRatingId);
      const ratingRecord = await db
        .select({
          id: ratings.id,
          targetType: ratings.targetType,
          targetId: ratings.targetId,
        })
        .from(ratings)
        .where(eq(ratings.id, ratingId))
        .limit(1);

      if (!ratingRecord[0]) {
        throw new Error("Rating not found");
      }

      await db.delete(ratings).where(eq(ratings.id, ratingId));

      if (ratingRecord[0].targetType === "restaurant") {
        await updateRestaurantAggregateRating(ratingRecord[0].targetId);
      }

      if (note) {
        await addJiraComment(issueKey, `Comment removed by admin: ${note}`);
      }
      await transitionIssueToCategory(issueKey, "Done");

      return { ratingId, issueKey, removed: true };
    },
    res,
    "Failed to remove comment"
  );

  if (result) {
    ResponseHelper.success(res, result, "Comment removed and report closed");
  }
});

async function resolveRatingId(issueKey: string, providedRatingId?: number): Promise<number> {
  if (providedRatingId) {
    return providedRatingId;
  }

  const issue = await fetchJiraIssue(issueKey, ["description"]);
  const metadata = extractIssueMetadata(issue);
  const ratingId = metadata?.ratingId;
  if (!ratingId || typeof ratingId !== "number") {
    throw new Error("Unable to resolve rating ID from Jira issue");
  }
  return ratingId;
}

async function getRatingForPartner(ratingId: number, userId: string) {
  const records = await db
    .select({
      id: ratings.id,
      targetType: ratings.targetType,
      restaurantId: ratings.targetId,
      rating: ratings.rating,
      comment: ratings.comment,
      reviewerId: ratings.userId,
      reviewerName: users.displayName,
      reviewerEmail: users.email,
      partnerUserId: partners.userId,
      partnerName: partners.businessName,
      restaurantName: restaurants.name,
    })
    .from(ratings)
    .innerJoin(restaurants, eq(restaurants.id, ratings.targetId))
    .innerJoin(partners, eq(restaurants.partnerId, partners.id))
    .leftJoin(users, eq(users.id, ratings.userId))
    .where(and(eq(ratings.id, ratingId), eq(ratings.targetType, "restaurant")))
    .limit(1);

  if (!records[0] || records[0].partnerUserId !== userId) {
    return null;
  }

  return records[0];
}

async function findExistingCommentReport(
  ratingId: number,
  userId: string
): Promise<JiraIssue | null> {
  const sanitizedUserId = userId.replace(/["']/g, "");
  const jql =
    `project = ${JIRA_PROJECT_KEY} AND labels = "comment-report" ` +
    `AND text ~ '"ratingId":${ratingId}' AND text ~ '"partnerUserId":"${sanitizedUserId}"' ` +
    "ORDER BY created DESC";

  const issues = await searchJiraIssues({
    jql,
    maxResults: 1,
    fields: ["key", "created", "status", "description"],
  });

  return issues[0] ?? null;
}

interface CommentReportDescription {
  ratingId: number;
  restaurantName: string;
  ratingValue: number;
  comment: string;
  reviewerName: string;
  reviewerEmail: string;
  reportedBy: string;
  reason: string;
}

function buildCommentReportDescription(data: CommentReportDescription): JiraDocument {
  return {
    type: "doc",
    version: 1,
    content: [
      buildParagraph("A restaurant partner has flagged a user comment for review.", true),
      buildHeading("Rating Details"),
      buildKeyValueParagraph("Rating ID", data.ratingId.toString()),
      buildKeyValueParagraph("Restaurant", data.restaurantName),
      buildKeyValueParagraph("Rating", `${data.ratingValue}/5`),
      buildKeyValueParagraph("Comment", data.comment),
      buildHeading("Report Details"),
      buildKeyValueParagraph("Reviewer", `${data.reviewerName} (${data.reviewerEmail})`),
      buildKeyValueParagraph("Reported By", data.reportedBy),
      buildKeyValueParagraph("Reason", data.reason),
    ],
  };
}

async function updateRestaurantAggregateRating(restaurantId: number) {
  try {
    const stats = await db
      .select({
        avgRating: avg(ratings.rating),
        totalCount: count(ratings.id),
      })
      .from(ratings)
      .where(and(eq(ratings.targetType, "restaurant"), eq(ratings.targetId, restaurantId)));

    const avgRating = stats[0]?.avgRating
      ? Math.round(parseFloat(stats[0].avgRating.toString()) * 100) / 100
      : 0;
    const totalCount = stats[0]?.totalCount || 0;

    await db
      .update(restaurants)
      .set({
        ratingAvg: avgRating.toString(),
        ratingCount: Number(totalCount),
        updatedAt: new Date(),
      })
      .where(eq(restaurants.id, restaurantId));
  } catch (error) {
    console.error("Error updating restaurant aggregate rating:", error);
  }
}

export default router;
