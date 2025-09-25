import { Router } from "express";
import type { Response } from "express";
import { db } from "../db/db.js";
import { deals, restaurants, partners, userFavoriteDeals } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authenticateUser } from "../middleware/auth.js";
import { ResponseHelper, AuthHelper, ValidationHelper, DbHelper } from "../utils/api-helpers.js";

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateUser);

/**
 * POST /deals/:dealId/favorite
 * Bookmark/save a deal as favorite
 */
router.post("/:dealId/favorite", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const dealId = ValidationHelper.parseId(req.params.dealId as string);
  if (dealId === null) {
    return ResponseHelper.badRequest(res, "Invalid deal ID");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Check if deal exists and is active
      const deal = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);

      if (deal.length === 0) {
        throw new Error("Deal not found");
      }

      if (!deal[0] || deal[0].status !== "active") {
        throw new Error("Deal is not currently active");
      }

      // Check if already bookmarked
      const existingFavorite = await db
        .select()
        .from(userFavoriteDeals)
        .where(and(eq(userFavoriteDeals.userId, userId), eq(userFavoriteDeals.dealId, dealId)))
        .limit(1);

      if (existingFavorite.length > 0) {
        throw new Error("Deal is already bookmarked");
      }

      // Add to favorites
      await db.insert(userFavoriteDeals).values({
        userId,
        dealId,
      });

      return {
        dealId,
        bookmarked: true,
      };
    },
    res,
    "Failed to bookmark deal"
  );

  if (result) {
    ResponseHelper.success(res, result, "Deal bookmarked successfully", 201);
  }
});

/**
 * DELETE /deals/:dealId/favorite
 * Remove deal from favorites/bookmarks
 */
router.delete("/:dealId/favorite", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const dealId = ValidationHelper.parseId(req.params.dealId as string);
  if (dealId === null) {
    return ResponseHelper.badRequest(res, "Invalid deal ID");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Remove from favorites
      await db
        .delete(userFavoriteDeals)
        .where(and(eq(userFavoriteDeals.userId, userId), eq(userFavoriteDeals.dealId, dealId)));

      return {
        dealId,
        bookmarked: false,
      };
    },
    res,
    "Failed to remove bookmark"
  );

  if (result) {
    ResponseHelper.success(res, result, "Deal removed from bookmarks");
  }
});

/**
 * GET /deals/favorites
 * Get user's bookmarked/favorite deals
 *
 * Query parameters:
 * - page (optional): Page number for pagination (default: 1)
 * - limit (optional): Number of deals per page (default: 20, max: 100)
 * - status (optional): Filter by deal status (active, expired, etc.)
 */
router.get("/favorites", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const status = req.query.status as string;
  const offset = (page - 1) * limit;

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Build the query conditions
      const whereConditions = status
        ? and(
            eq(userFavoriteDeals.userId, userId),
            eq(deals.status, status as "draft" | "active" | "expired" | "archived")
          )
        : eq(userFavoriteDeals.userId, userId);

      // Execute query with pagination
      const favoriteDeals = await db
        .select({
          id: deals.id,
          title: deals.title,
          description: deals.description,
          status: deals.status,
          startDate: deals.startDate,
          endDate: deals.endDate,
          createdAt: deals.createdAt,
          restaurant: {
            id: restaurants.id,
            name: restaurants.name,
            streetAddress: restaurants.streetAddress,
            city: restaurants.city,
            province: restaurants.province,
          },
          partner: {
            id: partners.id,
            businessName: partners.businessName,
          },
          bookmarkedAt: userFavoriteDeals.createdAt,
        })
        .from(userFavoriteDeals)
        .innerJoin(deals, eq(userFavoriteDeals.dealId, deals.id))
        .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
        .innerJoin(partners, eq(deals.partnerId, partners.id))
        .where(whereConditions)
        .limit(limit)
        .offset(offset)
        .orderBy(userFavoriteDeals.createdAt);

      // Get total count for pagination
      const totalCountResult = await db
        .select({ count: userFavoriteDeals.id })
        .from(userFavoriteDeals)
        .innerJoin(deals, eq(userFavoriteDeals.dealId, deals.id))
        .where(whereConditions);

      const totalCount = totalCountResult.length;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        deals: favoriteDeals,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
    },
    res,
    "Failed to fetch favorite deals"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

/**
 * GET /deals/:dealId/favorite-status
 * Check if a specific deal is bookmarked by the user
 */
router.get("/:dealId/favorite-status", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const dealId = ValidationHelper.parseId(req.params.dealId as string);
  if (dealId === null) {
    return ResponseHelper.badRequest(res, "Invalid deal ID");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      const favorite = await db
        .select()
        .from(userFavoriteDeals)
        .where(and(eq(userFavoriteDeals.userId, userId), eq(userFavoriteDeals.dealId, dealId)))
        .limit(1);

      return {
        dealId,
        isBookmarked: favorite.length > 0,
        bookmarkedAt: favorite.length > 0 ? favorite[0]?.createdAt || null : null,
      };
    },
    res,
    "Failed to check favorite status"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

/**
 * GET /deals
 * Browse available deals (with bookmark status for authenticated users)
 *
 * Query parameters:
 * - page (optional): Page number for pagination (default: 1)
 * - limit (optional): Number of deals per page (default: 20, max: 100)
 * - status (optional): Filter by deal status (default: active)
 * - restaurantId (optional): Filter by restaurant ID
 */
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  // Optional authentication - get userId if available
  const userId = AuthHelper.getOptionalAuth(req);

  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const status = (req.query.status as string) || "active";
  const restaurantId = req.query.restaurantId ? parseInt(req.query.restaurantId as string) : null;
  const offset = (page - 1) * limit;

  // Validate restaurantId if provided
  if (req.query.restaurantId && isNaN(restaurantId!)) {
    return ResponseHelper.badRequest(res, "Invalid restaurant ID");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Build query conditions
      const dealWhereConditions = restaurantId
        ? and(
            eq(deals.status, status as "draft" | "active" | "expired" | "archived"),
            eq(deals.restaurantId, restaurantId)
          )
        : eq(deals.status, status as "draft" | "active" | "expired" | "archived");

      // Execute query
      const allDeals = await db
        .select({
          id: deals.id,
          title: deals.title,
          description: deals.description,
          status: deals.status,
          startDate: deals.startDate,
          endDate: deals.endDate,
          createdAt: deals.createdAt,
          restaurant: {
            id: restaurants.id,
            name: restaurants.name,
            streetAddress: restaurants.streetAddress,
            city: restaurants.city,
            province: restaurants.province,
            ratingAvg: restaurants.ratingAvg,
            ratingCount: restaurants.ratingCount,
          },
          partner: {
            id: partners.id,
            businessName: partners.businessName,
          },
        })
        .from(deals)
        .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
        .innerJoin(partners, eq(deals.partnerId, partners.id))
        .where(dealWhereConditions)
        .limit(limit)
        .offset(offset)
        .orderBy(deals.createdAt);

      // If user is authenticated, get their bookmarked deals
      let bookmarkedDealIds: number[] = [];
      if (userId) {
        const bookmarks = await db
          .select({ dealId: userFavoriteDeals.dealId })
          .from(userFavoriteDeals)
          .where(eq(userFavoriteDeals.userId, userId));

        bookmarkedDealIds = bookmarks.map((b) => b.dealId);
      }

      // Add bookmark status to deals
      const dealsWithBookmarkStatus = allDeals.map((deal) => ({
        ...deal,
        isBookmarked: bookmarkedDealIds.includes(deal.id),
      }));

      return {
        deals: dealsWithBookmarkStatus,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(allDeals.length / limit), // This is approximate
        },
      };
    },
    res,
    "Failed to fetch deals"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

export default router;
