import { Router } from "express";
import type { Response } from "express";
import { db } from "../db/db.js";
import { users, partners } from "../db/schema.js";
import { eq, ilike, or, desc, sql } from "drizzle-orm";
import { ResponseHelper, DbHelper } from "../utils/api-helpers.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authenticateUser } from "../middleware/auth.js";

const router = Router();

// Require admin for all routes
router.use(authenticateUser);
router.use((req: AuthenticatedRequest, res: Response, next) => {
  if (!req.user?.isAdmin) {
    return ResponseHelper.forbidden(res);
  }
  next();
});

/**
 * GET /admin/users
 * List all users with pagination and search
 */
router.get("/users", async (req: AuthenticatedRequest, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const query = (req.query.q || "") as string;

  const searchCondition = query
    ? or(
        ilike(users.displayName, `%${query}%`),
        ilike(users.email, `%${query}%`),
        ilike(users.phone, `%${query}%`)
      )
    : undefined;

  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      phone: users.phone,
      isAdmin: users.isAdmin,
      isBanned: users.isBanned,
      banReason: users.banReason,
      createdAt: users.createdAt,
      partnerId: partners.id,
    })
    .from(users)
    .leftJoin(partners, eq(users.id, partners.userId))
    .where(searchCondition)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  // Use a separate count query to avoid issues with computed columns in subquery
  const totalCountRes = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(searchCondition);

  const totalCount = Number(totalCountRes[0]?.count || 0);
  const totalPages = Math.ceil(totalCount / limit);

  const formattedRows = rows.map((row) => ({
    ...row,
    isPartner: !!row.partnerId,
    partnerId: undefined,
  }));

  ResponseHelper.success(res, {
    users: formattedRows,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
    },
  });
});

/**
 * PUT /admin/users/:userId/ban
 * Ban a user
 */
router.put("/users/:userId/ban", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.params.userId;
  const { reason } = req.body;

  if (!userId) {
    return ResponseHelper.badRequest(res, "User ID is required");
  }

  if (!reason || typeof reason !== "string") {
    return ResponseHelper.badRequest(res, "Ban reason is required");
  }

  // Prevent banning self
  if (userId === req.user?.id) {
    return ResponseHelper.badRequest(res, "You cannot ban yourself");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      const updatedUser = await db
        .update(users)
        .set({
          isBanned: true,
          banReason: reason,
        })
        .where(eq(users.id, userId))
        .returning();

      if (updatedUser.length === 0) {
        throw new Error("User not found");
      }
      return updatedUser[0];
    },
    res,
    "Failed to ban user"
  );

  if (result) {
    ResponseHelper.success(res, result, "User banned successfully");
  }
});

/**
 * PUT /admin/users/:userId/unban
 * Unban a user
 */
router.put("/users/:userId/unban", async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.params.userId;

  if (!userId) {
    return ResponseHelper.badRequest(res, "User ID is required");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      const updatedUser = await db
        .update(users)
        .set({
          isBanned: false,
          banReason: null,
        })
        .where(eq(users.id, userId))
        .returning();

      if (updatedUser.length === 0) {
        throw new Error("User not found");
      }
      return updatedUser[0];
    },
    res,
    "Failed to unban user"
  );

  if (result) {
    ResponseHelper.success(res, result, "User unbanned successfully");
  }
});

export default router;
