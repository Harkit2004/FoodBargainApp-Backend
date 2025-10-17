import { Router } from "express";
import type { Response } from "express";
import { db } from "../db/db.js";
import {
  restaurants,
  partners,
  userFavoriteRestaurants,
  userNotificationPreferences,
  deals,
  notifications,
} from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authenticateUser } from "../middleware/auth.js";
import { ResponseHelper, AuthHelper, ValidationHelper, DbHelper } from "../utils/api-helpers.js";

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateUser);

/**
 * POST /notifications/restaurants/:restaurantId/bookmark
 * Bookmark a restaurant and set notification preferences
 *
 * Body:
 * {
 *   "notifyOnDeal": true
 * }
 */
router.post(
  "/restaurants/:restaurantId/bookmark",
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = AuthHelper.requireAuth(req, res);
    if (!userId) return;

    const restaurantId = ValidationHelper.parseId(req.params.restaurantId as string);
    if (restaurantId === null) {
      return ResponseHelper.badRequest(res, "Invalid restaurant ID");
    }

    const { notifyOnDeal } = req.body;

    const result = await DbHelper.executeWithErrorHandling(
      async () => {
        // Check if restaurant exists and is active
        const restaurant = await db
          .select()
          .from(restaurants)
          .where(and(eq(restaurants.id, restaurantId), eq(restaurants.isActive, true)))
          .limit(1);

        if (restaurant.length === 0) {
          throw new Error("Restaurant not found or inactive");
        }

        // Check if already bookmarked
        const existingBookmark = await db
          .select()
          .from(userFavoriteRestaurants)
          .where(
            and(
              eq(userFavoriteRestaurants.userId, userId),
              eq(userFavoriteRestaurants.restaurantId, restaurantId)
            )
          )
          .limit(1);

        if (existingBookmark.length > 0) {
          // Update existing bookmark
          const updatedBookmark = await db
            .update(userFavoriteRestaurants)
            .set({
              notifyOnDeal: notifyOnDeal !== undefined ? notifyOnDeal : false,
            })
            .where(
              and(
                eq(userFavoriteRestaurants.userId, userId),
                eq(userFavoriteRestaurants.restaurantId, restaurantId)
              )
            )
            .returning();

          return {
            restaurantId,
            isBookmarked: true,
            notifyOnDeal: updatedBookmark[0]?.notifyOnDeal ?? notifyOnDeal,
            bookmarkedAt: updatedBookmark[0]?.createdAt ?? new Date(),
            message: "Restaurant bookmark updated",
          };
        }

        // Create new bookmark
        const newBookmark = await db
          .insert(userFavoriteRestaurants)
          .values({
            userId,
            restaurantId,
            notifyOnDeal: notifyOnDeal !== undefined ? notifyOnDeal : false,
          })
          .returning();

        return {
          restaurantId,
          isBookmarked: true,
          notifyOnDeal: newBookmark[0]?.notifyOnDeal ?? notifyOnDeal,
          bookmarkedAt: newBookmark[0]?.createdAt ?? new Date(),
          message: "Restaurant bookmarked successfully",
        };
      },
      res,
      "Failed to bookmark restaurant"
    );

    if (result) {
      const { message, ...data } = result;
      const statusCode = result.message.includes("updated") ? 200 : 201;
      ResponseHelper.success(res, data, message, statusCode);
    }
  }
);

/**
 * DELETE /notifications/restaurants/:restaurantId/bookmark
 * Remove restaurant bookmark
 */
router.delete(
  "/restaurants/:restaurantId/bookmark",
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = AuthHelper.requireAuth(req, res);
    if (!userId) return;

    const restaurantId = ValidationHelper.parseId(req.params.restaurantId as string);
    if (restaurantId === null) {
      return ResponseHelper.badRequest(res, "Invalid restaurant ID");
    }

    const result = await DbHelper.executeWithErrorHandling(
      async () => {
        // Remove bookmark
        await db
          .delete(userFavoriteRestaurants)
          .where(
            and(
              eq(userFavoriteRestaurants.userId, userId),
              eq(userFavoriteRestaurants.restaurantId, restaurantId)
            )
          )
          .returning();

        return {
          restaurantId,
          isBookmarked: false,
          notifyOnDeal: false,
          bookmarkedAt: null,
        };
      },
      res,
      "Failed to remove restaurant bookmark"
    );

    if (result) {
      ResponseHelper.success(res, result, "Restaurant bookmark removed");
    }
  }
);

/**
 * GET /notifications/bookmarked-restaurants
 * Get all bookmarked restaurants for the user
 *
 * Query parameters:
 * - page (optional): Page number for pagination (default: 1)
 * - limit (optional): Results per page (default: 20, max: 100)
 */
router.get("/bookmarked-restaurants", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = (page - 1) * limit;

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Get bookmarked restaurants with details
      const bookmarkedRestaurants = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          description: restaurants.description,
          streetAddress: restaurants.streetAddress,
          city: restaurants.city,
          province: restaurants.province,
          phone: restaurants.phone,
          ratingAvg: restaurants.ratingAvg,
          ratingCount: restaurants.ratingCount,
          openingTime: restaurants.openingTime,
          closingTime: restaurants.closingTime,
          partner: {
            id: partners.id,
            businessName: partners.businessName,
          },
          bookmarkInfo: {
            notifyOnDeal: userFavoriteRestaurants.notifyOnDeal,
            bookmarkedAt: userFavoriteRestaurants.createdAt,
          },
        })
        .from(userFavoriteRestaurants)
        .innerJoin(restaurants, eq(userFavoriteRestaurants.restaurantId, restaurants.id))
        .innerJoin(partners, eq(restaurants.partnerId, partners.id))
        .where(and(eq(userFavoriteRestaurants.userId, userId), eq(restaurants.isActive, true)))
        .limit(limit)
        .offset(offset)
        .orderBy(userFavoriteRestaurants.createdAt);

      // Get active deals count for each bookmarked restaurant
      const restaurantIds = bookmarkedRestaurants.map((r) => r.id);
      const activeDealsCount =
        restaurantIds.length > 0
          ? await db
              .select({
                restaurantId: deals.restaurantId,
                dealCount: deals.id,
              })
              .from(deals)
              .where(
                and(
                  eq(deals.status, "active")
                  // Note: In a real app, you'd use an IN clause here
                )
              )
          : [];

      // Add active deals info to results
      const resultsWithDeals = bookmarkedRestaurants.map((restaurant) => ({
        ...restaurant,
        activeDealsCount: activeDealsCount.filter((d) => d.restaurantId === restaurant.id).length,
      }));

      return {
        restaurants: resultsWithDeals,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(bookmarkedRestaurants.length / limit),
          totalCount: bookmarkedRestaurants.length,
          hasNextPage: bookmarkedRestaurants.length === limit,
          hasPreviousPage: page > 1,
        },
      };
    },
    res,
    "Failed to fetch bookmarked restaurants"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

/**
 * PATCH /notifications/restaurants/:restaurantId/bookmark
 * Update notification preferences for a bookmarked restaurant
 *
 * Body:
 * {
 *   "notifyOnDeal": false
 * }
 */
router.patch(
  "/restaurants/:restaurantId/bookmark",
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = AuthHelper.requireAuth(req, res);
    if (!userId) return;

    const restaurantId = ValidationHelper.parseId(req.params.restaurantId as string);
    if (restaurantId === null) {
      return ResponseHelper.badRequest(res, "Invalid restaurant ID");
    }

    const { notifyOnDeal } = req.body;
    if (notifyOnDeal === undefined) {
      return ResponseHelper.badRequest(res, "notifyOnDeal preference is required");
    }

    const result = await DbHelper.executeWithErrorHandling(
      async () => {
        // Check if restaurant is bookmarked
        const existingBookmark = await db
          .select()
          .from(userFavoriteRestaurants)
          .where(
            and(
              eq(userFavoriteRestaurants.userId, userId),
              eq(userFavoriteRestaurants.restaurantId, restaurantId)
            )
          )
          .limit(1);

        if (existingBookmark.length === 0) {
          throw new Error("Restaurant is not bookmarked");
        }

        // Update notification preference
        const updatedBookmark = await db
          .update(userFavoriteRestaurants)
          .set({
            notifyOnDeal: Boolean(notifyOnDeal),
          })
          .where(
            and(
              eq(userFavoriteRestaurants.userId, userId),
              eq(userFavoriteRestaurants.restaurantId, restaurantId)
            )
          )
          .returning();

        return {
          restaurantId,
          notifyOnDeal: updatedBookmark[0]?.notifyOnDeal ?? notifyOnDeal,
          updatedAt: new Date(),
        };
      },
      res,
      "Failed to update notification preference"
    );

    if (result) {
      ResponseHelper.success(res, result, "Notification preference updated");
    }
  }
);

/**
 * GET /notifications/preferences
 * Get user's global notification preferences
 */
router.get("/preferences", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Get user's notification preferences
      const preferences = await db
        .select()
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, userId))
        .limit(1);

      if (preferences.length === 0) {
        // Create default preferences if none exist
        const defaultPrefs = await db
          .insert(userNotificationPreferences)
          .values({
            userId,
            emailNotifications: true,
          })
          .returning();

        return {
          emailNotifications: defaultPrefs[0]?.emailNotifications ?? true,
          createdAt: defaultPrefs[0]?.createdAt ?? new Date(),
          updatedAt: defaultPrefs[0]?.updatedAt ?? new Date(),
        };
      }

      return {
        emailNotifications: preferences[0]?.emailNotifications ?? true,
        createdAt: preferences[0]?.createdAt ?? new Date(),
        updatedAt: preferences[0]?.updatedAt ?? new Date(),
      };
    },
    res,
    "Failed to fetch notification preferences"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

/**
 * PUT /notifications/preferences
 * Update user's global notification preferences
 *
 * Body:
 * {
 *   "emailNotifications": false
 * }
 */
router.put("/preferences", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const { emailNotifications } = req.body;
  if (emailNotifications === undefined) {
    return ResponseHelper.badRequest(res, "emailNotifications preference is required");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Check if preferences exist
      const existingPrefs = await db
        .select()
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, userId))
        .limit(1);

      if (existingPrefs.length === 0) {
        // Create new preferences
        const newPrefs = await db
          .insert(userNotificationPreferences)
          .values({
            userId,
            emailNotifications: Boolean(emailNotifications),
          })
          .returning();

        return {
          emailNotifications: newPrefs[0]?.emailNotifications ?? true,
          createdAt: newPrefs[0]?.createdAt ?? new Date(),
          updatedAt: newPrefs[0]?.updatedAt ?? new Date(),
          message: "Notification preferences created",
        };
      }

      // Update existing preferences
      const updatedPrefs = await db
        .update(userNotificationPreferences)
        .set({
          emailNotifications: Boolean(emailNotifications),
          updatedAt: new Date(),
        })
        .where(eq(userNotificationPreferences.userId, userId))
        .returning();

      return {
        emailNotifications: updatedPrefs[0]?.emailNotifications ?? true,
        createdAt: updatedPrefs[0]?.createdAt ?? new Date(),
        updatedAt: updatedPrefs[0]?.updatedAt ?? new Date(),
        message: "Notification preferences updated",
      };
    },
    res,
    "Failed to update notification preferences"
  );

  if (result) {
    const { message, ...data } = result;
    ResponseHelper.success(res, data, message);
  }
});

/**
 * GET /notifications
 * Get user's notifications
 *
 * Query parameters:
 * - page (optional): Page number (default: 1)
 * - limit (optional): Results per page (default: 20, max: 100)
 * - unreadOnly (optional): Only fetch unread notifications (default: false)
 */
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = (page - 1) * limit;
  const unreadOnly = req.query.unreadOnly === "true";

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      const query = db
        .select({
          id: notifications.id,
          type: notifications.type,
          title: notifications.title,
          message: notifications.message,
          isRead: notifications.isRead,
          createdAt: notifications.createdAt,
          dealId: notifications.dealId,
        })
        .from(notifications)
        .where(
          unreadOnly
            ? and(eq(notifications.userId, userId), eq(notifications.isRead, false))
            : eq(notifications.userId, userId)
        )
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .offset(offset);

      const userNotifications = await query;

      // Get total count for pagination
      const countResult = await db
        .select({ count: notifications.id })
        .from(notifications)
        .where(
          unreadOnly
            ? and(eq(notifications.userId, userId), eq(notifications.isRead, false))
            : eq(notifications.userId, userId)
        );

      const totalCount = countResult.length;

      return {
        notifications: userNotifications,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalCount,
          hasNextPage: offset + userNotifications.length < totalCount,
          hasPreviousPage: page > 1,
        },
      };
    },
    res,
    "Failed to fetch notifications"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

/**
 * GET /notifications/unread-count
 * Get count of unread notifications
 */
router.get("/unread-count", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      const countResult = await db
        .select({ count: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

      return {
        count: countResult.length,
      };
    },
    res,
    "Failed to fetch unread notification count"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

/**
 * PATCH /notifications/:id/read
 * Mark a notification as read
 */
router.patch("/:id/read", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const notificationId = ValidationHelper.parseId(req.params.id as string);
  if (notificationId === null) {
    return ResponseHelper.badRequest(res, "Invalid notification ID");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Check if notification belongs to user
      const notification = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
        .limit(1);

      if (notification.length === 0) {
        throw new Error("Notification not found");
      }

      // Mark as read
      const updated = await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.id, notificationId))
        .returning();

      return {
        id: updated[0]?.id,
        isRead: updated[0]?.isRead,
      };
    },
    res,
    "Failed to mark notification as read"
  );

  if (result) {
    ResponseHelper.success(res, result, "Notification marked as read");
  }
});

/**
 * PATCH /notifications/mark-all-read
 * Mark all notifications as read for the user
 */
router.patch("/mark-all-read", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

      return {
        success: true,
      };
    },
    res,
    "Failed to mark all notifications as read"
  );

  if (result) {
    ResponseHelper.success(res, result, "All notifications marked as read");
  }
});

export default router;
