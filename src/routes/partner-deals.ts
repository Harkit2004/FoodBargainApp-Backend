import { Router } from "express";
import type { Response } from "express";
import { db } from "../db/db.js";
import {
  partners,
  restaurants,
  deals,
  cuisines,
  dietaryPreferences,
  dealCuisines,
  dealDietaryPreferences,
  userFavoriteRestaurants,
  users,
  userNotificationPreferences,
  notifications,
} from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authenticateUser, requirePartner } from "../middleware/auth.js";
import { AuthHelper, DbHelper, ResponseHelper, ValidationHelper } from "../utils/api-helpers.js";
import { sendNewDealEmail } from "../utils/email.js";

const router = Router();

// Apply authentication and partner requirement to all routes
router.use(authenticateUser);
router.use(requirePartner);

// Helper function to verify restaurant ownership
async function verifyRestaurantOwnership(userId: string, restaurantId: number) {
  const result = await db
    .select({ partnerId: partners.id })
    .from(partners)
    .innerJoin(restaurants, eq(partners.id, restaurants.partnerId))
    .where(and(eq(partners.userId, userId), eq(restaurants.id, restaurantId)))
    .limit(1);

  return result.length > 0;
}

// Helper function to get partner ID from user ID
async function getPartnerIdFromUser(userId: string): Promise<number | null> {
  const partner = await db
    .select({ id: partners.id })
    .from(partners)
    .where(eq(partners.userId, userId))
    .limit(1);

  return partner.length > 0 && partner[0] !== undefined ? partner[0].id : null;
}

/**
 * POST /partner-deals
 * Create a new deal
 *
 * Body:
 * {
 *   "title": "50% off All Pizzas",
 *   "description": "Get half price on all our delicious pizzas",
 *   "restaurantId": 1,
 *   "startDate": "2024-01-15",
 *   "endDate": "2024-01-31",
 *   "cuisineIds"?: [1, 2],
 *   "dietaryPreferenceIds"?: [1]
 * }
 */
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const { title, description, restaurantId, startDate, endDate, cuisineIds, dietaryPreferenceIds } =
    req.body;

  // Basic validation
  if (!title || !restaurantId || !startDate || !endDate) {
    return ResponseHelper.badRequest(
      res,
      "Title, restaurant ID, start date, and end date are required"
    );
  }

  // Validate dates
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return ResponseHelper.badRequest(res, "Invalid date format");
  }

  if (start >= end) {
    return ResponseHelper.badRequest(res, "Start date must be before end date");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Verify restaurant ownership
      const hasAccess = await verifyRestaurantOwnership(userId, restaurantId);
      if (!hasAccess) {
        throw new Error("You can only create deals for restaurants you own");
      }

      // Get partner ID
      const partnerId = await getPartnerIdFromUser(userId);
      if (!partnerId) {
        throw new Error("Partner not found");
      }

      // Validate cuisine IDs if provided
      if (cuisineIds && Array.isArray(cuisineIds) && cuisineIds.length > 0) {
        const validCuisines = await db
          .select()
          .from(cuisines)
          .where(inArray(cuisines.id, cuisineIds));

        if (validCuisines.length !== cuisineIds.length) {
          throw new Error("One or more invalid cuisine IDs");
        }
      }

      // Validate dietary preference IDs if provided
      if (
        dietaryPreferenceIds &&
        Array.isArray(dietaryPreferenceIds) &&
        dietaryPreferenceIds.length > 0
      ) {
        const validDietaryPreferences = await db
          .select()
          .from(dietaryPreferences)
          .where(inArray(dietaryPreferences.id, dietaryPreferenceIds));

        if (validDietaryPreferences.length !== dietaryPreferenceIds.length) {
          throw new Error("One or more invalid dietary preference IDs");
        }
      }

      // Create the deal
      const newDeal = await db
        .insert(deals)
        .values({
          title,
          description: description || null,
          partnerId,
          restaurantId,
          startDate,
          endDate,
          status: "draft", // Always start as draft
        })
        .returning();

      if (!newDeal[0]) {
        throw new Error("Failed to create deal");
      }
      const dealId = newDeal[0].id;

      // Add cuisine associations
      if (cuisineIds && Array.isArray(cuisineIds) && cuisineIds.length > 0) {
        const dealCuisineData = cuisineIds.map((cuisineId) => ({
          dealId,
          cuisineId,
        }));
        await db.insert(dealCuisines).values(dealCuisineData);
      }

      // Add dietary preference associations
      if (
        dietaryPreferenceIds &&
        Array.isArray(dietaryPreferenceIds) &&
        dietaryPreferenceIds.length > 0
      ) {
        const dealDietaryData = dietaryPreferenceIds.map((dietaryPreferenceId) => ({
          dealId,
          dietaryPreferenceId,
        }));
        await db.insert(dealDietaryPreferences).values(dealDietaryData);
      }

      // Send notifications to users who bookmarked this restaurant with notifyOnDeal=true
      // Note: Notifications are sent asynchronously to avoid blocking the response
      setImmediate(async () => {
        try {
          // Get restaurant info for notification
          const restaurantInfo = await db
            .select()
            .from(restaurants)
            .where(eq(restaurants.id, restaurantId))
            .limit(1);

          if (restaurantInfo.length === 0) {
            console.warn(`Restaurant ${restaurantId} not found for notifications`);
            return;
          }

          const restaurant = restaurantInfo[0];
          if (!restaurant) {
            console.warn(`Restaurant ${restaurantId} data is invalid`);
            return;
          }

          // Find users who bookmarked this restaurant with notifyOnDeal=true
          const bookmarkedUsers = await db
            .select({
              user: users,
              notificationPrefs: userNotificationPreferences,
              bookmark: userFavoriteRestaurants,
            })
            .from(userFavoriteRestaurants)
            .innerJoin(users, eq(userFavoriteRestaurants.userId, users.id))
            .leftJoin(userNotificationPreferences, eq(userNotificationPreferences.userId, users.id))
            .where(
              and(
                eq(userFavoriteRestaurants.restaurantId, restaurantId),
                eq(userFavoriteRestaurants.notifyOnDeal, true)
              )
            );

          console.log(
            `📢 Found ${bookmarkedUsers.length} users to notify about new deal at ${restaurant.name}`
          );

          if (bookmarkedUsers.length === 0) {
            return;
          }

          // Format dates for email
          const formattedStartDate = new Date(startDate).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          });

          const formattedEndDate = new Date(endDate).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          });

          // Send notifications to each user
          for (const { user, notificationPrefs } of bookmarkedUsers) {
            try {
              // Create in-app notification
              await db.insert(notifications).values({
                userId: user.id,
                dealId,
                type: "new_deal",
                title: `🎉 New Deal at ${restaurant.name}`,
                message: `${restaurant.name} just added a new deal: "${title}"!`,
              });

              console.log(`✅ Created in-app notification for ${user.email} - Deal: ${title}`);

              // Send email if user has email notifications enabled
              const emailEnabled = notificationPrefs?.emailNotifications !== false;

              if (emailEnabled && user.email) {
                const emailSent = await sendNewDealEmail({
                  userEmail: user.email,
                  userName: user.displayName || "Valued Customer",
                  dealTitle: title,
                  dealDescription: description || "Check out this amazing deal!",
                  restaurantName: restaurant.name,
                  startDate: formattedStartDate,
                  endDate: formattedEndDate,
                  dealId,
                });

                if (emailSent) {
                  console.log(`📧 New deal email sent to ${user.email}`);
                } else {
                  console.warn(`⚠️  Failed to send email to ${user.email}`);
                }
              } else {
                console.log(`📵 Email notifications disabled for user ${user.displayName}`);
              }
            } catch (error) {
              console.error(
                `❌ Failed to send notification to ${user.email} for deal ${dealId}:`,
                error
              );
              // Continue with other users even if one fails
            }
          }
        } catch (error) {
          console.error("❌ Error sending new deal notifications:", error);
        }
      });

      return {
        ...newDeal[0],
        cuisineIds: cuisineIds || [],
        dietaryPreferenceIds: dietaryPreferenceIds || [],
      };
    },
    res,
    "Failed to create deal"
  );

  if (result) {
    ResponseHelper.created(res, result);
  }
});

/**
 * GET /partner-deals
 * Get all deals for the current partner
 *
 * Query parameters:
 * - status (optional): Filter by deal status
 * - restaurantId (optional): Filter by restaurant
 */
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const status = req.query.status as string;
  const restaurantId = req.query.restaurantId ? parseInt(req.query.restaurantId as string) : null;

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Get partner ID
      const partnerId = await getPartnerIdFromUser(userId);
      if (!partnerId) {
        throw new Error("Partner not found");
      }

      // Build query conditions
      const conditions = [eq(deals.partnerId, partnerId)];

      if (status !== undefined && status !== null) {
        conditions.push(eq(deals.status, status as "draft" | "active" | "expired" | "archived"));
      }

      if (restaurantId !== undefined && restaurantId !== null) {
        conditions.push(eq(deals.restaurantId, restaurantId));
      }

      const whereConditions = conditions.length === 1 ? conditions[0] : and(...conditions);

      // Get deals with restaurant information
      const partnerDeals = await db
        .select({
          id: deals.id,
          title: deals.title,
          description: deals.description,
          status: deals.status,
          startDate: deals.startDate,
          endDate: deals.endDate,
          createdAt: deals.createdAt,
          updatedAt: deals.updatedAt,
          restaurant: {
            id: restaurants.id,
            name: restaurants.name,
            streetAddress: restaurants.streetAddress,
            city: restaurants.city,
            province: restaurants.province,
          },
        })
        .from(deals)
        .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
        .where(whereConditions)
        .orderBy(deals.createdAt);

      // Get associated cuisines and dietary preferences for each deal
      const dealsWithAssociations = await Promise.all(
        partnerDeals.map(async (deal) => {
          // Get cuisines
          const dealCuisineList = await db
            .select({
              id: cuisines.id,
              name: cuisines.name,
            })
            .from(dealCuisines)
            .innerJoin(cuisines, eq(dealCuisines.cuisineId, cuisines.id))
            .where(eq(dealCuisines.dealId, deal.id));

          // Get dietary preferences
          const dealDietaryList = await db
            .select({
              id: dietaryPreferences.id,
              name: dietaryPreferences.name,
            })
            .from(dealDietaryPreferences)
            .innerJoin(
              dietaryPreferences,
              eq(dealDietaryPreferences.dietaryPreferenceId, dietaryPreferences.id)
            )
            .where(eq(dealDietaryPreferences.dealId, deal.id));

          return {
            ...deal,
            cuisines: dealCuisineList,
            dietaryPreferences: dealDietaryList,
          };
        })
      );

      return dealsWithAssociations;
    },
    res,
    "Failed to fetch deals"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

/**
 * GET /partner-deals/:dealId
 * Get a specific deal by ID
 */
router.get("/:dealId", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const dealId = ValidationHelper.parseId(req.params.dealId as string);

  if (!dealId) {
    return ResponseHelper.badRequest(res, "Invalid deal ID");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Get partner ID
      const partnerId = await getPartnerIdFromUser(userId);
      if (!partnerId) {
        return null;
      }

      // Get the deal
      const deal = await db
        .select({
          id: deals.id,
          title: deals.title,
          description: deals.description,
          status: deals.status,
          startDate: deals.startDate,
          endDate: deals.endDate,
          createdAt: deals.createdAt,
          updatedAt: deals.updatedAt,
          restaurant: {
            id: restaurants.id,
            name: restaurants.name,
            streetAddress: restaurants.streetAddress,
            city: restaurants.city,
            province: restaurants.province,
          },
        })
        .from(deals)
        .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
        .where(and(eq(deals.id, dealId), eq(deals.partnerId, partnerId)))
        .limit(1);

      if (deal.length === 0) {
        return null;
      }

      // Get associated cuisines and dietary preferences
      const dealCuisineList = await db
        .select({
          id: cuisines.id,
          name: cuisines.name,
        })
        .from(dealCuisines)
        .innerJoin(cuisines, eq(dealCuisines.cuisineId, cuisines.id))
        .where(eq(dealCuisines.dealId, dealId));

      const dealDietaryList = await db
        .select({
          id: dietaryPreferences.id,
          name: dietaryPreferences.name,
        })
        .from(dealDietaryPreferences)
        .innerJoin(
          dietaryPreferences,
          eq(dealDietaryPreferences.dietaryPreferenceId, dietaryPreferences.id)
        )
        .where(eq(dealDietaryPreferences.dealId, dealId));

      return {
        ...deal[0],
        cuisines: dealCuisineList,
        dietaryPreferences: dealDietaryList,
      };
    },
    res,
    "Failed to get deal"
  );

  if (result === null) {
    // Only send notFound if headers weren't already sent (error wasn't already handled)
    if (!res.headersSent) {
      return ResponseHelper.notFound(res);
    }
    return;
  }

  return ResponseHelper.success(res, result);
});

/**
 * PUT /partner-deals/:dealId
 * Update a deal
 */
router.put("/:dealId", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const dealId = ValidationHelper.parseId(req.params.dealId as string);
  const { title, description, startDate, endDate, cuisineIds, dietaryPreferenceIds } = req.body;

  if (!dealId) {
    return ResponseHelper.badRequest(res, "Invalid deal ID");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Get partner ID
      const partnerId = await getPartnerIdFromUser(userId);
      if (!partnerId) {
        return null;
      }

      // Verify deal ownership
      const existingDeal = await db
        .select()
        .from(deals)
        .where(and(eq(deals.id, dealId), eq(deals.partnerId, partnerId)))
        .limit(1);

      if (existingDeal.length === 0) {
        return null;
      }

      // Check if deal can be edited (only archived deals cannot be modified)
      // Note: Expired deals CAN be edited to allow partners to extend end_date
      // The automated job will reactivate them if extended
      if (existingDeal[0] && existingDeal[0].status === "archived") {
        throw new Error("Cannot modify archived deals");
      }

      // Prepare update data
      const updateData: Partial<typeof deals.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (startDate !== undefined) {
        const start = new Date(startDate);
        if (isNaN(start.getTime())) {
          throw new Error("Invalid start date format");
        }
        updateData.startDate = startDate;
      }
      if (endDate !== undefined) {
        const end = new Date(endDate);
        if (isNaN(end.getTime())) {
          throw new Error("Invalid end date format");
        }
        updateData.endDate = endDate;
      }

      // Validate date relationship if both dates are being updated
      if (updateData.startDate && updateData.endDate) {
        const start = new Date(updateData.startDate);
        const end = new Date(updateData.endDate);
        if (start >= end) {
          throw new Error("Start date must be before end date");
        }
      }

      // Update the deal
      const updatedDeal = await db
        .update(deals)
        .set(updateData)
        .where(eq(deals.id, dealId))
        .returning();

      // Update cuisine associations if provided
      if (cuisineIds !== undefined) {
        // Remove existing associations
        await db.delete(dealCuisines).where(eq(dealCuisines.dealId, dealId));

        // Add new associations
        if (Array.isArray(cuisineIds) && cuisineIds.length > 0) {
          const dealCuisineData = cuisineIds.map((cuisineId) => ({
            dealId,
            cuisineId,
          }));
          await db.insert(dealCuisines).values(dealCuisineData);
        }
      }

      // Update dietary preference associations if provided
      if (dietaryPreferenceIds !== undefined) {
        // Remove existing associations
        await db.delete(dealDietaryPreferences).where(eq(dealDietaryPreferences.dealId, dealId));

        // Add new associations
        if (Array.isArray(dietaryPreferenceIds) && dietaryPreferenceIds.length > 0) {
          const dealDietaryData = dietaryPreferenceIds.map((dietaryPreferenceId) => ({
            dealId,
            dietaryPreferenceId,
          }));
          await db.insert(dealDietaryPreferences).values(dealDietaryData);
        }
      }

      return {
        message: "Deal updated successfully",
        data: updatedDeal[0],
      };
    },
    res,
    "Failed to update deal"
  );

  if (result === null) {
    // Only send notFound if headers weren't already sent (error wasn't already handled)
    if (!res.headersSent) {
      return ResponseHelper.notFound(res);
    }
    return;
  }

  return ResponseHelper.success(res, result);
});

/**
 * PATCH /partner-deals/:dealId/status
 * Update deal status (draft -> active -> expired -> archived)
 *
 * Body:
 * {
 *   "status": "active"
 * }
 */
router.patch("/:dealId/status", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const dealId = ValidationHelper.parseId(req.params.dealId as string);
  const { status } = req.body;

  if (!dealId) {
    return ResponseHelper.badRequest(res, "Invalid deal ID");
  }

  const validStatuses = ["draft", "active", "expired", "archived"];
  if (!status || !validStatuses.includes(status)) {
    return ResponseHelper.badRequest(
      res,
      "Valid status required (draft, active, expired, archived)"
    );
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Get partner ID
      const partnerId = await getPartnerIdFromUser(userId);
      if (!partnerId) {
        return null;
      }

      // Verify deal ownership and get current status
      const existingDeal = await db
        .select()
        .from(deals)
        .where(and(eq(deals.id, dealId), eq(deals.partnerId, partnerId)))
        .limit(1);

      if (existingDeal.length === 0 || !existingDeal[0]) {
        return null;
      }

      const currentStatus = existingDeal[0].status;

      // Validate status transitions
      const validTransitions: Record<string, string[]> = {
        draft: ["active", "archived"],
        active: ["expired", "archived"],
        expired: ["archived"],
        archived: [], // No transitions from archived
      };

      if (!validTransitions[currentStatus] || !validTransitions[currentStatus].includes(status)) {
        throw new Error(`Cannot transition from ${currentStatus} to ${status}`);
      }

      // Update deal status
      const updatedDeal = await db
        .update(deals)
        .set({
          status: status as "draft" | "active" | "expired" | "archived",
          updatedAt: new Date(),
        })
        .where(eq(deals.id, dealId))
        .returning();

      // TODO: If deal becomes active, we could trigger notifications here,
      // but maybe doing that in frontend is better

      if (!updatedDeal[0]) {
        throw new Error("Failed to update deal status");
      }

      return {
        message: `Deal status updated to ${status}`,
        data: {
          id: updatedDeal[0].id,
          status: updatedDeal[0].status,
          updatedAt: updatedDeal[0].updatedAt,
        },
      };
    },
    res,
    "Failed to update deal status"
  );

  if (result === null) {
    // Only send notFound if headers weren't already sent (error wasn't already handled)
    if (!res.headersSent) {
      return ResponseHelper.notFound(res);
    }
    return;
  }

  return ResponseHelper.success(res, result);
});

/**
 * DELETE /partner-deals/:dealId
 * Delete a deal (only allowed for draft deals)
 */
router.delete("/:dealId", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const dealId = ValidationHelper.parseId(req.params.dealId as string);

  if (!dealId) {
    return ResponseHelper.badRequest(res, "Invalid deal ID");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Get partner ID
      const partnerId = await getPartnerIdFromUser(userId);
      if (!partnerId) {
        return null;
      }

      // Verify deal ownership and status
      const existingDeal = await db
        .select()
        .from(deals)
        .where(and(eq(deals.id, dealId), eq(deals.partnerId, partnerId)))
        .limit(1);

      if (existingDeal.length === 0) {
        return null;
      }

      // Only allow deletion of draft deals
      if (!existingDeal[0] || existingDeal[0].status !== "draft") {
        throw new Error("Only draft deals can be deleted. Use archive instead.");
      }

      // Delete associated records first
      await db.delete(dealCuisines).where(eq(dealCuisines.dealId, dealId));
      await db.delete(dealDietaryPreferences).where(eq(dealDietaryPreferences.dealId, dealId));

      // Delete the deal
      await db.delete(deals).where(eq(deals.id, dealId));

      return { message: "Deal deleted successfully" };
    },
    res,
    "Failed to delete deal"
  );

  if (result === null) {
    // Only send notFound if headers weren't already sent (error wasn't already handled)
    if (!res.headersSent) {
      return ResponseHelper.notFound(res);
    }
    return;
  }

  return ResponseHelper.success(res, result);
});

export default router;
