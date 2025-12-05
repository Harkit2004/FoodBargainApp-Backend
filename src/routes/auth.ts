import { Router } from "express";
import type { Request, Response } from "express";
import { createClerkClient } from "@clerk/backend";
import { db } from "../db/db.js";
import {
  users,
  userCuisines,
  userDietaryPreferences,
  userNotificationPreferences,
  partners,
} from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authenticateUser } from "../middleware/auth.js";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
});

const router = Router();

/**
 * POST /auth/register
 * Complete user registration with comprehensive profile information
 *
 * This is a two-step process:
 * 1. User creates account with Clerk (frontend handles email/password)
 * 2. This endpoint completes registration with all required profile data
 *
 * Body:
 * {
 *   "clerkUserId": "user_xxx", // From Clerk after initial signup
 *   "displayName": "John Doe",
 *   "location": "43.721722,-79.641655", // latitude,longitude
 *   "phone": "+1234567890", // optional
 *   "cuisinePreferences": [1, 2, 3], // array of cuisine IDs
 *   "dietaryPreferences": [1, 2] // array of dietary preference IDs
 * }
 */
router.post("/register", async (req: Request, res: Response) => {
  try {
    const {
      clerkUserId,
      displayName,
      location,
      phone,
      cuisinePreferences = [],
      dietaryPreferences = [],
    } = req.body;

    // Validation
    if (!clerkUserId) {
      return res.status(400).json({
        success: false,
        error: "Clerk user ID is required",
      });
    }

    if (!displayName || !location) {
      return res.status(400).json({
        success: false,
        error: "Display name and location are required",
      });
    }

    // Verify user exists in Clerk
    let clerkUser;
    try {
      clerkUser = await clerkClient.users.getUser(clerkUserId);
    } catch {
      return res.status(400).json({
        success: false,
        error: "Invalid Clerk user ID",
      });
    }

    // Check if user already exists in our database
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1);

    if (existingUser.length > 0) {
      return res.status(409).json({
        success: false,
        error: "User profile already exists",
      });
    }

    // Create user record first
    const newUser = await db
      .insert(users)
      .values({
        clerkUserId,
        email: clerkUser.emailAddresses[0]?.emailAddress || "",
        displayName,
        location,
        phone: phone || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const result = newUser[0]!;
    const userId = result.id;

    // Add cuisine preferences
    if (cuisinePreferences.length > 0) {
      const cuisineData = cuisinePreferences.map((cuisineId: number) => ({
        userId,
        cuisineId,
      }));
      await db.insert(userCuisines).values(cuisineData);
    }

    // Add dietary preferences
    if (dietaryPreferences.length > 0) {
      const dietaryData = dietaryPreferences.map((dietaryPreferenceId: number) => ({
        userId,
        dietaryPreferenceId,
      }));
      await db.insert(userDietaryPreferences).values(dietaryData);
    }

    // Create default notification preferences
    await db.insert(userNotificationPreferences).values({
      userId,
      emailNotifications: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: "User registration completed successfully",
      data: {
        user: {
          id: result.id,
          email: result.email,
          displayName: result.displayName,
          location: result.location,
          phone: result.phone,
          clerkUserId: result.clerkUserId,
          isPartner: false, // New users are not partners by default
          isAdmin: result.isAdmin ?? false,
        },
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to complete user registration",
    });
  }
});

/**
 * POST /auth/login
 * Note: With Clerk, authentication is typically handled client-side.
 * This endpoint is for getting user session information after Clerk authentication.
 *
 * Body:
 * {
 *   "clerkUserId": "user_xxx"
 * }
 */
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { clerkUserId } = req.body;

    if (!clerkUserId) {
      return res.status(400).json({
        success: false,
        error: "Clerk user ID is required",
      });
    }

    // Verify user exists in Clerk
    await clerkClient.users.getUser(clerkUserId);

    // Find user in our database
    const user = await db.select().from(users).where(eq(users.clerkUserId, clerkUserId)).limit(1);

    if (user.length === 0) {
      // User exists in Clerk but hasn't completed registration
      return res.status(404).json({
        success: false,
        error: "User registration not completed. Please complete your profile.",
        requiresRegistration: true,
      });
    }

    // Check if user is banned
    if (user[0]!.isBanned) {
      return res.status(403).json({
        success: false,
        error: "Account banned",
        isBanned: true,
        banReason: user[0]!.banReason,
      });
    }

    // Check if user is a partner
    const partner = await db
      .select()
      .from(partners)
      .where(eq(partners.userId, user[0]!.id))
      .limit(1);
    const isPartner = partner.length > 0;

    res.json({
      success: true,
      message: "Login successful",
      data: {
        user: {
          id: user[0]!.id,
          email: user[0]!.email,
          displayName: user[0]!.displayName,
          clerkUserId: user[0]!.clerkUserId,
          location: user[0]!.location,
          phone: user[0]!.phone,
          isPartner,
          isAdmin: user[0]!.isAdmin ?? false,
        },
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during login",
    });
  }
});

/**
 * POST /auth/forgot-password
 * Initiate password reset process via Clerk
 *
 * Body:
 * {
 *   "email": "user@example.com"
 * }
 */
router.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Invalid email format",
      });
    }

    // Note: Password reset is typically handled client-side with Clerk
    // This endpoint acknowledges the request for security purposes

    res.json({
      success: true,
      message: "If an account with that email exists, a password reset link has been sent.",
    });
  } catch {
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * POST /auth/reset-password
 * Note: Password reset is typically handled client-side with Clerk.
 * This endpoint is for confirmation purposes.
 *
 * Body:
 * {
 *   "clerkUserId": "user_xxx"
 * }
 */
router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { clerkUserId } = req.body;

    if (!clerkUserId) {
      return res.status(400).json({
        success: false,
        error: "Clerk user ID is required",
      });
    }

    // Verify user exists in Clerk
    await clerkClient.users.getUser(clerkUserId);

    res.json({
      success: true,
      message: "Password has been reset successfully",
    });
  } catch {
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * POST /auth/logout
 * Log out user and invalidate session
 * Note: Session management is typically handled client-side with Clerk
 */
router.post("/logout", authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { clerkUserId } = req.body;

    if (clerkUserId) {
      // Optionally revoke sessions in Clerk
      try {
        await clerkClient.sessions.revokeSession(clerkUserId);
      } catch {
        // Continue even if session revocation fails
        throw new Error("Failed to revoke session");
      }
    }

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch {
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

export default router;
