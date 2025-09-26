import { Router } from "express";
import { db } from "../db/db.js";
import { cuisines, dietaryPreferences } from "../db/schema.js";
import { sendSuccess, sendError } from "../utils/response.js";

const router = Router();

/**
 * GET /api/preferences/cuisines
 * Get all available cuisine types
 */
router.get("/cuisines", async (req, res) => {
  try {
    const allCuisines = await db.select().from(cuisines);

    return sendSuccess(res, { cuisines: allCuisines }, "Cuisines retrieved successfully");
  } catch (error) {
    console.error("Error fetching cuisines:", error);
    return sendError(res, 500, "Failed to fetch cuisines");
  }
});

/**
 * GET /api/preferences/dietary
 * Get all available dietary preferences
 */
router.get("/dietary", async (req, res) => {
  try {
    const allDietaryPreferences = await db.select().from(dietaryPreferences);

    return sendSuccess(
      res,
      { dietaryPreferences: allDietaryPreferences },
      "Dietary preferences retrieved successfully"
    );
  } catch (error) {
    console.error("Error fetching dietary preferences:", error);
    return sendError(res, 500, "Failed to fetch dietary preferences");
  }
});

export default router;
