import { Router } from "express";
import type { Response } from "express";
import { db } from "../db/db.js";
import {
  users,
  cuisines,
  dietaryPreferences,
  userCuisines,
  userDietaryPreferences,
} from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authenticateUser } from "../middleware/auth.js";
import { ResponseHelper, AuthHelper, ValidationHelper, DbHelper } from "../utils/api-helpers.js";

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateUser);

// User Story 2: Set up favorite cuisines and dietary preferences
/**
 * GET /user/cuisines
 * Get all available cuisines
 */
router.get("/cuisines", async (req: AuthenticatedRequest, res: Response) => {
  const result = await DbHelper.executeWithErrorHandling(
    () => db.select().from(cuisines),
    res,
    "Failed to fetch cuisines"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

/**
 * GET /user/dietary-preferences
 * Get all available dietary preferences
 */
router.get("/dietary-preferences", async (req: AuthenticatedRequest, res: Response) => {
  const result = await DbHelper.executeWithErrorHandling(
    () => db.select().from(dietaryPreferences),
    res,
    "Failed to fetch dietary preferences"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

/**
 * POST /user/favorite-cuisines
 * Set user's favorite cuisines
 */
router.post("/favorite-cuisines", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const { cuisineIds } = req.body;

  // Validate cuisine IDs array
  const validation = ValidationHelper.validateArrayIds(cuisineIds, "cuisine ID");
  if (!validation.valid) {
    return ResponseHelper.badRequest(res, validation.error!);
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Validate that all cuisine IDs exist
      const validCuisines = await db
        .select()
        .from(cuisines)
        .where(inArray(cuisines.id, cuisineIds));

      if (validCuisines.length !== cuisineIds.length) {
        throw new Error("One or more invalid cuisine IDs");
      }

      // Remove existing user cuisines and insert new ones
      await db.delete(userCuisines).where(eq(userCuisines.userId, userId));

      const userCuisineData = cuisineIds.map((cuisineId: number) => ({
        userId,
        cuisineId,
      }));

      await db.insert(userCuisines).values(userCuisineData);

      return { cuisineIds };
    },
    res,
    "Failed to update favorite cuisines"
  );

  if (result) {
    ResponseHelper.success(res, result, "Favorite cuisines updated successfully");
  }
});

/**
 * POST /user/dietary-preferences
 * Set user's dietary preferences
 */
router.post("/dietary-preferences", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const { dietaryPreferenceIds } = req.body;

  // Validate dietary preference IDs array
  const validation = ValidationHelper.validateArrayIds(
    dietaryPreferenceIds,
    "dietary preference ID"
  );
  if (!validation.valid) {
    return ResponseHelper.badRequest(res, validation.error!);
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Validate that all dietary preference IDs exist
      const validDietaryPreferences = await db
        .select()
        .from(dietaryPreferences)
        .where(inArray(dietaryPreferences.id, dietaryPreferenceIds));

      if (validDietaryPreferences.length !== dietaryPreferenceIds.length) {
        throw new Error("One or more invalid dietary preference IDs");
      }

      // Remove existing user dietary preferences and insert new ones
      await db.delete(userDietaryPreferences).where(eq(userDietaryPreferences.userId, userId));

      const userDietaryPreferenceData = dietaryPreferenceIds.map((dietaryPreferenceId: number) => ({
        userId,
        dietaryPreferenceId,
      }));

      await db.insert(userDietaryPreferences).values(userDietaryPreferenceData);

      return { dietaryPreferenceIds };
    },
    res,
    "Failed to update dietary preferences"
  );

  if (result) {
    ResponseHelper.success(res, result, "Dietary preferences updated successfully");
  }
});

/**
 * GET /user/profile
 * Get user's current profile including preferences
 */
router.get("/profile", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Get user basic info
      const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);

      if (user.length === 0 || !user[0]) {
        throw new Error("User not found");
      }

      // Get user's favorite cuisines and dietary preferences in parallel
      const [userFavoriteCuisines, userFavoriteDietaryPreferences] = await Promise.all([
        db
          .select({
            id: cuisines.id,
            name: cuisines.name,
          })
          .from(userCuisines)
          .innerJoin(cuisines, eq(userCuisines.cuisineId, cuisines.id))
          .where(eq(userCuisines.userId, userId)),

        db
          .select({
            id: dietaryPreferences.id,
            name: dietaryPreferences.name,
          })
          .from(userDietaryPreferences)
          .innerJoin(
            dietaryPreferences,
            eq(userDietaryPreferences.dietaryPreferenceId, dietaryPreferences.id)
          )
          .where(eq(userDietaryPreferences.userId, userId)),
      ]);

      const userData = user[0];
      return {
        user: {
          id: userData.id,
          email: userData.email,
          displayName: userData.displayName,
          phone: userData.phone,
          location: userData.location,
          createdAt: userData.createdAt,
        },
        favoriteCuisines: userFavoriteCuisines,
        dietaryPreferences: userFavoriteDietaryPreferences,
      };
    },
    res,
    "Failed to fetch user profile"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

// User Story 5: Update personal information
/**
 * PUT /user/profile
 * Update user's personal information
 */
router.put("/profile", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const { displayName, phone, location } = req.body;

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Prepare update data with proper typing
      const updateData: Partial<typeof users.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (displayName !== undefined) updateData.displayName = displayName;
      if (phone !== undefined) updateData.phone = phone;
      if (location !== undefined) updateData.location = location;

      // Update user information
      const updatedUser = await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning();

      if (updatedUser.length === 0 || !updatedUser[0]) {
        throw new Error("User not found");
      }

      const userData = updatedUser[0];
      return {
        id: userData.id,
        email: userData.email,
        displayName: userData.displayName,
        phone: userData.phone,
        location: userData.location,
        updatedAt: userData.updatedAt,
      };
    },
    res,
    "Failed to update user profile"
  );

  if (result) {
    ResponseHelper.success(res, result, "Profile updated successfully");
  }
});

export default router;
