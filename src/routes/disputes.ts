import { Router } from "express";
import type { Response } from "express";
import { ResponseHelper } from "../utils/api-helpers.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authenticateUserAllowBanned } from "../middleware/auth.js";
import { createJiraTicket, type JiraDocument } from "../utils/jira.js";

const router = Router();

// Allow banned users to access this route
router.use(authenticateUserAllowBanned);

/**
 * POST /disputes
 * Submit a dispute for a ban
 */
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return ResponseHelper.unauthorized(res);
  }

  const { reason, message } = req.body;

  if (!reason || !message) {
    return ResponseHelper.badRequest(res, "Reason and message are required");
  }

  try {
    const description: JiraDocument = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: `User ${req.user?.displayName} (${req.user?.email}) has disputed their ban.`,
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "Dispute Details" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Reason: ", marks: [{ type: "strong" }] },
            { type: "text", text: reason },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Message: ", marks: [{ type: "strong" }] },
            { type: "text", text: message },
          ],
        },
      ],
    };

    const ticket = await createJiraTicket({
      summary: `Ban Dispute: ${req.user?.displayName}`,
      description,
      labels: ["ban-dispute", "user-dispute"],
      metadata: {
        userId,
        userEmail: req.user?.email,
        clerkUserId: req.user?.clerkUserId,
        banReason: req.user?.banReason || "Unknown",
      },
    });

    ResponseHelper.success(res, {
      ticketId: ticket.key,
      message: "Dispute submitted successfully",
    });
  } catch (error) {
    console.error("Failed to submit dispute:", error);
    ResponseHelper.internalError(res, "Failed to submit dispute");
  }
});

export default router;
