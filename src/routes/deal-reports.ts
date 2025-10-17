import { Router } from "express";
import type { Response } from "express";
import { db } from "../db/db.js";
import { dealReports, deals, users } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authenticateUser } from "../middleware/auth.js";
import { ResponseHelper, AuthHelper, ValidationHelper, DbHelper } from "../utils/api-helpers.js";

const router = Router();

/**
 * POST /deal-reports
 * Submit a report for a deal
 * Request body: { dealId: number, reason: string }
 */
router.post("/", authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const { dealId, reason } = req.body;

  // Validate input
  if (!dealId || typeof dealId !== "number") {
    return ResponseHelper.badRequest(res, "Valid deal ID is required");
  }

  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    return ResponseHelper.badRequest(res, "Reason for report is required");
  }

  if (reason.length > 1000) {
    return ResponseHelper.badRequest(res, "Reason must be less than 1000 characters");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Check if deal exists
      const deal = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);

      if (deal.length === 0) {
        throw new Error("Deal not found");
      }

      // Check if user has already reported this deal
      const existingReport = await db
        .select()
        .from(dealReports)
        .where(and(eq(dealReports.userId, userId), eq(dealReports.dealId, dealId)))
        .limit(1);

      if (existingReport.length > 0) {
        throw new Error("You have already reported this deal");
      }

      // Get user details for Jira ticket
      const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);

      if (user.length === 0) {
        throw new Error("User not found");
      }

      // Create Jira ticket
      let jiraTicketId: string | null = null;
      try {
        jiraTicketId = await createJiraTicket({
          dealId: deal[0]!.id,
          dealTitle: deal[0]!.title,
          dealDescription: deal[0]!.description || "No description",
          reportReason: reason.trim(),
          reporterEmail: user[0]!.email || "N/A",
          reporterName: user[0]!.displayName,
        });
      } catch (jiraError) {
        console.error("Failed to create Jira ticket:", jiraError);
        // Continue even if Jira fails - we still want to record the report
      }

      // Insert the report into database
      const newReport = await db
        .insert(dealReports)
        .values({
          userId,
          dealId,
          reason: reason.trim(),
          jiraTicketId,
        })
        .returning();

      return {
        reportId: newReport[0]!.id,
        dealId,
        jiraTicketId,
        message: jiraTicketId
          ? "Report submitted successfully. A support ticket has been created."
          : "Report submitted successfully. Support will review your report.",
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
 * Check if the current user has reported a specific deal
 */
router.get("/check/:dealId", authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const dealId = ValidationHelper.parseId(req.params.dealId as string);
  if (dealId === null) {
    return ResponseHelper.badRequest(res, "Invalid deal ID");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      const report = await db
        .select()
        .from(dealReports)
        .where(and(eq(dealReports.userId, userId), eq(dealReports.dealId, dealId)))
        .limit(1);

      return {
        hasReported: report.length > 0,
        reportId: report.length > 0 ? report[0]!.id : null,
        createdAt: report.length > 0 ? report[0]!.createdAt : null,
      };
    },
    res,
    "Failed to check report status"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

/**
 * Create a Jira ticket for a deal report
 * This uses the Jira REST API v3
 * Creates a ticket, assigns it to the configured user, and adds it to a sprint
 */
async function createJiraTicket(data: {
  dealId: number;
  dealTitle: string;
  dealDescription: string;
  reportReason: string;
  reporterEmail: string;
  reporterName: string;
}): Promise<string> {
  const jiraConfig = {
    url: process.env.JIRA_URL,
    email: process.env.JIRA_EMAIL,
    apiToken: process.env.JIRA_API_TOKEN,
    projectKey: process.env.JIRA_PROJECT_KEY || "SCRUM",
    issueType: process.env.JIRA_ISSUE_TYPE || "Task",
    sprintId: process.env.JIRA_SPRINT_ID ? parseInt(process.env.JIRA_SPRINT_ID) : null,
  };

  // Validate required config
  if (!jiraConfig.url || !jiraConfig.email || !jiraConfig.apiToken) {
    throw new Error(
      "Jira configuration is missing. Please set JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables."
    );
  }

  const auth = Buffer.from(`${jiraConfig.email}:${jiraConfig.apiToken}`).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  // Step 1: Get the account ID of the authenticated user
  const myselfResponse = await fetch(`${jiraConfig.url}/rest/api/3/myself`, {
    method: "GET",
    headers,
  });

  if (!myselfResponse.ok) {
    throw new Error(`Failed to get Jira account info: ${myselfResponse.status}`);
  }

  const myselfData = (await myselfResponse.json()) as { accountId: string };
  const accountId = myselfData.accountId;

  // Step 2: Create the issue with assignee
  const issueData = {
    fields: {
      project: {
        key: jiraConfig.projectKey,
      },
      summary: `Deal Report: ${data.dealTitle} (ID: ${data.dealId})`,
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "A user has reported a deal for review.",
                marks: [{ type: "strong" }],
              },
            ],
          },
          {
            type: "heading",
            attrs: { level: 3 },
            content: [
              {
                type: "text",
                text: "Deal Information",
              },
            ],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Deal ID: ", marks: [{ type: "strong" }] },
              { type: "text", text: data.dealId.toString() },
            ],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Deal Title: ", marks: [{ type: "strong" }] },
              { type: "text", text: data.dealTitle },
            ],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Deal Description: ", marks: [{ type: "strong" }] },
              { type: "text", text: data.dealDescription },
            ],
          },
          {
            type: "heading",
            attrs: { level: 3 },
            content: [
              {
                type: "text",
                text: "Report Details",
              },
            ],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Reported by: ", marks: [{ type: "strong" }] },
              { type: "text", text: `${data.reporterName} (${data.reporterEmail})` },
            ],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Reason: ", marks: [{ type: "strong" }] },
              { type: "text", text: data.reportReason },
            ],
          },
        ],
      },
      issuetype: {
        name: jiraConfig.issueType,
      },
      labels: ["deal-report", "user-generated"],
      assignee: {
        id: accountId,
      },
    },
  };

  const createResponse = await fetch(`${jiraConfig.url}/rest/api/3/issue`, {
    method: "POST",
    headers,
    body: JSON.stringify(issueData),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    console.error("Jira API error:", errorText);
    throw new Error(
      `Failed to create Jira ticket: ${createResponse.status} ${createResponse.statusText}`
    );
  }

  const result = (await createResponse.json()) as { key: string };
  const issueKey = result.key;

  // Step 3: Add the issue to the sprint (if sprint ID is configured)
  if (jiraConfig.sprintId) {
    try {
      const sprintResponse = await fetch(
        `${jiraConfig.url}/rest/agile/1.0/sprint/${jiraConfig.sprintId}/issue`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ issues: [issueKey] }),
        }
      );

      if (!sprintResponse.ok) {
        console.error(`Failed to add issue to sprint: ${sprintResponse.status}`);
        // Don't throw - the issue was created successfully
      } else {
        console.log(`✅ Issue ${issueKey} added to sprint ${jiraConfig.sprintId}`);
      }
    } catch (sprintError) {
      console.error("Error adding issue to sprint:", sprintError);
      // Don't throw - the issue was created successfully
    }
  }

  return issueKey; // Returns ticket ID like "SCRUM-123"
}

export default router;
