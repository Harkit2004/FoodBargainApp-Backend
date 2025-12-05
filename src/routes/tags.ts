import { Router } from "express";
import type { Response } from "express";
import { db } from "../db/db.js";
import { reviewTags, users } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authenticateUser } from "../middleware/auth.js";
import { AuthHelper, DbHelper, ResponseHelper } from "../utils/api-helpers.js";

const router = Router();

// Get all tags
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      let tags = await db.select().from(reviewTags).orderBy(desc(reviewTags.createdAt));

      // Seed default tags if none exist
      if (tags.length === 0) {
        const DEFAULT_TAGS = [
          "Tasted Good",
          "Great Value",
          "Fast Service",
          "Clean Packaging",
          "Friendly Staff",
        ];
        await db.insert(reviewTags).values(
          DEFAULT_TAGS.map((name) => ({
            name,
            isCustom: false,
            createdBy: null,
          }))
        );
        tags = await db.select().from(reviewTags).orderBy(desc(reviewTags.createdAt));
      }

      return tags;
    },
    res,
    "Failed to fetch tags"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

// Create a new tag
router.post("/", authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const { name } = req.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return ResponseHelper.badRequest(res, "Tag name is required");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Check if tag already exists
      const existingTag = await db
        .select()
        .from(reviewTags)
        .where(eq(reviewTags.name, name.trim()))
        .limit(1);

      if (existingTag.length > 0) {
        return existingTag[0];
      }

      // Create new tag
      const [newTag] = await db
        .insert(reviewTags)
        .values({
          name: name.trim(),
          isCustom: true,
          createdBy: userId,
        })
        .returning();

      return newTag;
    },
    res,
    "Failed to create tag"
  );

  if (result) {
    ResponseHelper.created(res, result);
  }
});

// Delete a tag (Admin only)
router.delete("/:id", authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const tagId = parseInt(req.params.id || "");
  if (isNaN(tagId)) {
    return ResponseHelper.badRequest(res, "Invalid tag ID");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Check if user is admin
      const [user] = await db
        .select({ isAdmin: users.isAdmin })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user || !user.isAdmin) {
        throw new Error("Unauthorized: Admin access required");
      }

      // Delete tag
      const [deletedTag] = await db.delete(reviewTags).where(eq(reviewTags.id, tagId)).returning();

      if (!deletedTag) {
        throw new Error("Tag not found");
      }

      return { success: true, message: "Tag deleted successfully" };
    },
    res,
    "Failed to delete tag"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

export default router;
