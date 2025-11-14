import { Router } from "express";
import type { Response } from "express";
import { db } from "../db/db.js";
import { deals, users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authenticateUser } from "../middleware/auth.js";
import { AuthHelper, DbHelper, ResponseHelper, ValidationHelper } from "../utils/api-helpers.js";
import {
  buildHeading,
  buildKeyValueParagraph,
  buildParagraph,
  createJiraTicket,
  extractIssueMetadata,
  searchJiraIssues,
  type JiraDocument,
  type JiraIssue,
} from "../utils/jira.js";

const router = Router();
const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || "SCRUM";

// All routes require authentication
router.use(authenticateUser);

/**
 * POST /deal-reports
 * Allow a diner to report a deal once. A Jira ticket is created for Trust & Safety.
 */
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const { dealId, reason } = req.body as { dealId?: number; reason?: string };

  if (!dealId || typeof dealId !== "number" || dealId <= 0) {
    return ResponseHelper.badRequest(res, "Valid deal ID is required");
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
      const dealRecord = await db
        .select({ id: deals.id, title: deals.title, description: deals.description })
        .from(deals)
        .where(eq(deals.id, dealId))
        .limit(1);

      if (!dealRecord[0]) {
        throw new Error("Deal not found");
      }

      const existingIssue = await findExistingDealReport(dealId, userId);
      if (existingIssue) {
        const issueKey = existingIssue.key;
        throw new Error(
          issueKey
            ? `You have already reported this deal. Ticket ${issueKey} is in review.`
            : "You have already reported this deal"
        );
      }

      const reporter = await db
        .select({ email: users.email, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!reporter[0]) {
        throw new Error("User profile not found");
      }

      const jiraTicket = await createJiraTicket({
        summary: `Deal Report: ${dealRecord[0].title} (ID: ${dealRecord[0].id})`,
        description: buildDealReportDescription({
          dealId: dealRecord[0].id,
          title: dealRecord[0].title,
          description: dealRecord[0].description || "No description",
          reason: trimmedReason,
          reporterName: reporter[0].displayName || "FoodBargain User",
          reporterEmail: reporter[0].email || "N/A",
        }),
        labels: ["deal-report", `deal-${dealRecord[0].id}`],
        metadata: {
          type: "deal-report",
          dealId: dealRecord[0].id,
          dealTitle: dealRecord[0].title,
          reporterUserId: userId,
          reporterEmail: reporter[0].email,
          reporterName: reporter[0].displayName,
          reason: trimmedReason,
        },
      });

      return {
        reportId: null,
        dealId,
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

/**
 * GET /deal-reports/check/:dealId
 * Allow the frontend to know if the user has already reported this deal.
 */
router.get("/check/:dealId", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const dealId = ValidationHelper.parseId(req.params.dealId as string);
  if (dealId === null) {
    return ResponseHelper.badRequest(res, "Invalid deal ID");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      const issue = await findExistingDealReport(dealId, userId);
      const metadata = issue ? extractIssueMetadata(issue) : null;
      return {
        hasReported: Boolean(issue),
        reportId: null,
        createdAt: issue?.fields.created ?? null,
        jiraTicketId: issue?.key ?? null,
        metadata,
      };
    },
    res,
    "Failed to check report status"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

interface DealReportDescription {
  dealId: number;
  title: string;
  description: string;
  reason: string;
  reporterName: string;
  reporterEmail: string;
}

function buildDealReportDescription(data: DealReportDescription): JiraDocument {
  return {
    type: "doc",
    version: 1,
    content: [
      buildParagraph("A user has reported a deal for review.", true),
      buildHeading("Deal Information"),
      buildKeyValueParagraph("Deal ID", data.dealId.toString()),
      buildKeyValueParagraph("Deal Title", data.title),
      buildKeyValueParagraph("Deal Description", data.description),
      buildHeading("Report Details"),
      buildKeyValueParagraph("Reported by", `${data.reporterName} (${data.reporterEmail})`),
      buildKeyValueParagraph("Reason", data.reason),
    ],
  };
}

async function findExistingDealReport(dealId: number, userId: string): Promise<JiraIssue | null> {
  const sanitizedUserId = userId.replace(/["']/g, "");
  const jql =
    `project = ${JIRA_PROJECT_KEY} AND labels = "deal-report" ` +
    `AND text ~ '"dealId":${dealId}' AND text ~ '"reporterUserId":"${sanitizedUserId}"' ` +
    "ORDER BY created DESC";

  const issues = await searchJiraIssues({
    jql,
    maxResults: 1,
    fields: ["key", "created", "status", "description"],
  });

  return issues[0] ?? null;
}

export default router;
