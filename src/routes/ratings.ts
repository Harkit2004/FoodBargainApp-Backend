import { Router } from "express";
import type { Response } from "express";
import { db } from "../db/db.js";
import { ratings, restaurants, menuItems, deals, users } from "../db/schema.js";
import { eq, and, avg, count } from "drizzle-orm";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authenticateUser } from "../middleware/auth.js";
import {
  AuthHelper,
  DbHelper,
  ResponseHelper,
  ValidationHelper,
  validateTargetType,
} from "../utils/api-helpers.js";

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateUser);

/**
 * POST /ratings
 * Create a new rating for a restaurant, menu item, or deal
 *
 * Body:
 * {
 *   "targetType": "restaurant", // "restaurant", "menu_item", or "deal"
 *   "targetId": 1,
 *   "rating": 5, // 1-5 stars
 *   "comment": "Great food and service!"
 * }
 */
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const { targetType, targetId, rating, comment } = req.body;

  // Validate inputs
  const targetTypeValidation = ValidationHelper.validateTargetType(targetType);
  if (!targetTypeValidation.valid) {
    return ResponseHelper.badRequest(res, targetTypeValidation.error!);
  }

  if (!targetId || typeof targetId !== "number") {
    return ResponseHelper.badRequest(res, "Valid targetId required");
  }

  if (typeof rating !== "number" || rating < 1 || rating > 5) {
    return ResponseHelper.badRequest(res, "Rating must be between 1 and 5");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Verify target exists
      let targetExists = false;
      let targetName = "";

      if (targetType === "restaurant") {
        const restaurant = await db
          .select({ id: restaurants.id, name: restaurants.name })
          .from(restaurants)
          .where(and(eq(restaurants.id, targetId), eq(restaurants.isActive, true)))
          .limit(1);

        targetExists = restaurant.length > 0;
        targetName = restaurant.length > 0 ? restaurant[0]!.name : "";
      } else if (targetType === "menu_item") {
        const menuItem = await db
          .select({ id: menuItems.id, name: menuItems.name })
          .from(menuItems)
          .where(and(eq(menuItems.id, targetId), eq(menuItems.isAvailable, true)))
          .limit(1);

        targetExists = menuItem.length > 0;
        targetName = menuItem.length > 0 ? menuItem[0]!.name : "";
      } else if (targetType === "deal") {
        const deal = await db
          .select({ id: deals.id, title: deals.title })
          .from(deals)
          .where(and(eq(deals.id, targetId), eq(deals.status, "active")))
          .limit(1);

        targetExists = deal.length > 0;
        targetName = deal.length > 0 ? deal[0]!.title : "";
      }

      if (!targetExists) {
        throw new Error(`${targetType.replace("_", " ")} not found or inactive`);
      }

      // Check if user has already rated this target
      const existingRating = await db
        .select()
        .from(ratings)
        .where(
          and(
            eq(ratings.userId, userId),
            eq(ratings.targetType, targetType as "restaurant" | "menu_item" | "deal"),
            eq(ratings.targetId, targetId)
          )
        )
        .limit(1);

      if (existingRating.length > 0) {
        throw new Error("You have already rated this item. Use PUT to update your rating.");
      }

      // Create the rating
      const newRating = await db
        .insert(ratings)
        .values({
          userId,
          targetType: targetType as "restaurant" | "menu_item" | "deal",
          targetId,
          rating,
          comment: comment || null,
        })
        .returning();

      // Update aggregate rating for restaurants
      if (targetType === "restaurant") {
        await updateRestaurantAggregateRating(targetId);
      }

      return {
        id: newRating[0]!.id,
        targetType: newRating[0]!.targetType,
        targetId: newRating[0]!.targetId,
        targetName,
        rating: newRating[0]!.rating,
        comment: newRating[0]!.comment,
        createdAt: newRating[0]!.createdAt,
      };
    },
    res,
    "Failed to create rating"
  );

  if (result) {
    ResponseHelper.success(
      res,
      result,
      `Rating for ${result.targetName} created successfully`,
      201
    );
  }
});

/**
 * PUT /ratings/:ratingId
 * Update an existing rating (only by the rating's author)
 *
 * Body:
 * {
 *   "rating": 4,
 *   "comment": "Updated comment"
 * }
 */
router.put("/:ratingId", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const ratingId = ValidationHelper.parseId(req.params.ratingId as string);
  if (ratingId === null) {
    return ResponseHelper.badRequest(res, "Invalid rating ID");
  }

  const { rating, comment } = req.body;
  if (rating !== undefined && (typeof rating !== "number" || rating < 1 || rating > 5)) {
    return ResponseHelper.badRequest(res, "Rating must be between 1 and 5");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Verify rating exists and belongs to user
      const existingRating = await db
        .select()
        .from(ratings)
        .where(and(eq(ratings.id, ratingId), eq(ratings.userId, userId)))
        .limit(1);

      if (existingRating.length === 0) {
        throw new Error("Rating not found or you don't have permission to edit it");
      }

      // Prepare update data
      const updateData: Partial<{ updatedAt: Date; rating: number; comment: string | null }> = {
        updatedAt: new Date(),
      };

      if (rating !== undefined) {
        updateData.rating = rating;
      }

      if (comment !== undefined) {
        updateData.comment = comment;
      }

      // Update the rating
      const updatedRating = await db
        .update(ratings)
        .set(updateData)
        .where(eq(ratings.id, ratingId))
        .returning();

      // Update aggregate rating for restaurants if rating changed
      if (rating !== undefined && existingRating[0]!.targetType === "restaurant") {
        await updateRestaurantAggregateRating(existingRating[0]!.targetId);
      }

      return {
        id: updatedRating[0]!.id,
        targetType: updatedRating[0]!.targetType,
        targetId: updatedRating[0]!.targetId,
        rating: updatedRating[0]!.rating,
        comment: updatedRating[0]!.comment,
        updatedAt: updatedRating[0]!.updatedAt,
      };
    },
    res,
    "Failed to update rating"
  );

  if (result) {
    ResponseHelper.success(res, result, "Rating updated successfully");
  }
});

/**
 * DELETE /ratings/:ratingId
 * Delete a rating (only by the rating's author)
 */
router.delete("/:ratingId", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const ratingId = ValidationHelper.parseId(req.params.ratingId as string);
  if (ratingId === null) {
    return ResponseHelper.badRequest(res, "Invalid rating ID");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Verify rating exists
      const existingRating = await db
        .select()
        .from(ratings)
        .where(eq(ratings.id, ratingId))
        .limit(1);

      if (existingRating.length === 0) {
        throw new Error("Rating not found");
      }

      // Check permission: User must be the author OR an admin
      if (existingRating[0]!.userId !== userId && !req.user?.isAdmin) {
        throw new Error("You don't have permission to delete this rating");
      }

      const targetType = existingRating[0]!.targetType;
      const targetId = existingRating[0]!.targetId;

      // Delete the rating
      await db.delete(ratings).where(eq(ratings.id, ratingId));

      // Update aggregate rating for restaurants
      if (targetType === "restaurant") {
        await updateRestaurantAggregateRating(targetId);
      }

      return { deleted: true };
    },
    res,
    "Failed to delete rating"
  );

  if (result) {
    ResponseHelper.success(res, result, "Rating deleted successfully");
  }
});

/**
 * GET /ratings
 * Get ratings for a specific target with pagination
 *
 * Query parameters:
 * - targetType: "restaurant", "menu_item", or "deal"
 * - targetId: ID of the target
 * - page (optional): Page number (default: 1)
 * - limit (optional): Results per page (default: 20, max: 100)
 */
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  const { targetType, targetId, page: pageStr, limit: limitStr } = req.query;

  if (!validateTargetType(targetType as string)) {
    return ResponseHelper.badRequest(
      res,
      "Valid targetType query parameter required (restaurant, menu_item, deal)"
    );
  }

  const targetIdNum = ValidationHelper.parseId(targetId as string);
  if (targetIdNum === null) {
    return ResponseHelper.badRequest(res, "Valid targetId query parameter required");
  }

  const page = Math.max(1, parseInt(pageStr as string) || 1);
  const limit = Math.min(Math.max(1, parseInt(limitStr as string) || 20), 100);
  const offset = (page - 1) * limit;

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Get ratings with user information
      const ratingsWithUsers = await db
        .select({
          id: ratings.id,
          rating: ratings.rating,
          comment: ratings.comment,
          createdAt: ratings.createdAt,
          updatedAt: ratings.updatedAt,
          user: {
            id: users.id,
            displayName: users.displayName,
          },
        })
        .from(ratings)
        .innerJoin(users, eq(ratings.userId, users.id))
        .where(
          and(
            eq(ratings.targetType, targetType as "restaurant" | "menu_item" | "deal"),
            eq(ratings.targetId, targetIdNum)
          )
        )
        .limit(limit)
        .offset(offset)
        .orderBy(ratings.createdAt);

      // Get aggregate statistics
      const aggregateStats = await db
        .select({
          avgRating: avg(ratings.rating),
          totalCount: count(ratings.id),
        })
        .from(ratings)
        .where(
          and(
            eq(ratings.targetType, targetType as "restaurant" | "menu_item" | "deal"),
            eq(ratings.targetId, targetIdNum)
          )
        );

      const avgRating = aggregateStats[0]?.avgRating
        ? Math.round(parseFloat(aggregateStats[0].avgRating.toString()) * 10) / 10
        : 0;
      const totalCount = aggregateStats[0]?.totalCount || 0;

      // Get rating distribution
      const ratingDistribution = await db
        .select({
          rating: ratings.rating,
          count: count(ratings.id),
        })
        .from(ratings)
        .where(
          and(
            eq(ratings.targetType, targetType as "restaurant" | "menu_item" | "deal"),
            eq(ratings.targetId, targetIdNum)
          )
        )
        .groupBy(ratings.rating)
        .orderBy(ratings.rating);

      return {
        ratings: ratingsWithUsers,
        aggregate: {
          averageRating: avgRating,
          totalCount,
          distribution: ratingDistribution,
        },
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(Number(totalCount) / limit),
          totalCount: Number(totalCount),
          hasNextPage: ratingsWithUsers.length === limit,
          hasPreviousPage: page > 1,
        },
      };
    },
    res,
    "Failed to fetch ratings"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

/**
 * GET /ratings/my-ratings
 * Get all ratings created by the authenticated user
 *
 * Query parameters:
 * - page (optional): Page number (default: 1)
 * - limit (optional): Results per page (default: 20, max: 100)
 * - targetType (optional): Filter by target type
 */
router.get("/my-ratings", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const { page: pageStr, limit: limitStr, targetType } = req.query;
  const page = Math.max(1, parseInt(pageStr as string) || 1);
  const limit = Math.min(Math.max(1, parseInt(limitStr as string) || 20), 100);
  const offset = (page - 1) * limit;

  if (targetType && !validateTargetType(targetType as string)) {
    return ResponseHelper.badRequest(
      res,
      "Valid targetType required (restaurant, menu_item, deal)"
    );
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Build query conditions
      let whereConditions = eq(ratings.userId, userId);

      if (targetType) {
        whereConditions = and(
          whereConditions,
          eq(ratings.targetType, targetType as "restaurant" | "menu_item" | "deal")
        )!;
      }

      // Get user's ratings with target information
      const myRatings = await db
        .select({
          id: ratings.id,
          targetType: ratings.targetType,
          targetId: ratings.targetId,
          rating: ratings.rating,
          comment: ratings.comment,
          createdAt: ratings.createdAt,
          updatedAt: ratings.updatedAt,
        })
        .from(ratings)
        .where(whereConditions)
        .limit(limit)
        .offset(offset)
        .orderBy(ratings.createdAt);

      // Get target names for each rating
      const ratingsWithTargetNames = await Promise.all(
        myRatings.map(async (rating) => {
          let targetName = "";

          if (rating.targetType === "restaurant") {
            const restaurant = await db
              .select({ name: restaurants.name })
              .from(restaurants)
              .where(eq(restaurants.id, rating.targetId))
              .limit(1);
            targetName =
              restaurant.length > 0 && restaurant[0] ? restaurant[0].name : "Unknown Restaurant";
          } else if (rating.targetType === "menu_item") {
            const menuItem = await db
              .select({ name: menuItems.name })
              .from(menuItems)
              .where(eq(menuItems.id, rating.targetId))
              .limit(1);
            targetName =
              menuItem.length > 0 && menuItem[0] ? menuItem[0].name : "Unknown Menu Item";
          } else if (rating.targetType === "deal") {
            const deal = await db
              .select({ title: deals.title })
              .from(deals)
              .where(eq(deals.id, rating.targetId))
              .limit(1);
            targetName = deal.length > 0 && deal[0] ? deal[0].title : "Unknown Deal";
          }

          return {
            ...rating,
            targetName,
          };
        })
      );

      return {
        ratings: ratingsWithTargetNames,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(myRatings.length / limit),
          totalCount: myRatings.length,
          hasNextPage: myRatings.length === limit,
          hasPreviousPage: page > 1,
        },
      };
    },
    res,
    "Failed to fetch your ratings"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

/**
 * Helper function to update restaurant aggregate rating
 */
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
