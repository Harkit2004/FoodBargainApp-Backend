import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "@clerk/backend";
import { db } from "../db/db.js";
import { users, partners } from "../db/schema.js";
import { eq } from "drizzle-orm";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    clerkUserId: string;
    email?: string;
    displayName?: string;
    isPartner?: boolean;
    isAdmin?: boolean;
    isBanned?: boolean;
    banReason?: string | null;
  };
}

/**
 * Authentication middleware with Clerk integration
 * Verifies JWT tokens and loads user data from database
 */
export const authenticateUser = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  await authenticateUserInternal(req, res, next, false);
};

/**
 * Authentication middleware that allows banned users to proceed
 * Used for routes like submitting a ban dispute
 */
export const authenticateUserAllowBanned = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  await authenticateUserInternal(req, res, next, true);
};

const authenticateUserInternal = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
  allowBanned: boolean
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Missing or invalid authorization header",
      });
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify the token with Clerk
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });

    if (!payload.sub) {
      return res.status(401).json({
        error: "Invalid token payload",
      });
    }

    // Find user in our database
    const dbUser = await db.select().from(users).where(eq(users.clerkUserId, payload.sub)).limit(1);

    if (dbUser.length === 0) {
      // User exists in Clerk but hasn't completed registration
      return res.status(403).json({
        error: "Registration not completed. Please complete your profile first.",
        requiresRegistration: true,
        clerkUserId: payload.sub,
      });
    }

    // Check if user is banned
    if (dbUser[0]!.isBanned && !allowBanned) {
      return res.status(403).json({
        error: "Account banned",
        isBanned: true,
        banReason: dbUser[0]!.banReason,
      });
    }

    // Check if user is a partner
    const partnerCheck = await db
      .select()
      .from(partners)
      .where(eq(partners.userId, dbUser[0]!.id))
      .limit(1);

    req.user = {
      id: dbUser[0]!.id,
      clerkUserId: payload.sub,
      email: dbUser[0]!.email || "",
      displayName: dbUser[0]!.displayName || "",
      isPartner: partnerCheck.length > 0,
      isAdmin: dbUser[0]!.isAdmin ?? false,
      isBanned: dbUser[0]!.isBanned,
    };

    next();
  } catch {
    return res.status(401).json({
      error: "Authentication failed",
    });
  }
};

/**
 * Middleware to check if authenticated user is a partner
 */
export const requirePartner = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: "Authentication required",
      });
    }

    if (!req.user.isPartner) {
      return res.status(403).json({
        error: "Partner access required",
      });
    }

    next();
  } catch {
    return res.status(500).json({
      error: "Authorization check failed",
    });
  }
};
