import { Router } from "express";
import type { Response } from "express";
import { db } from "../db/db.js";
import { menuSections, menuItems } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authenticateUser, requirePartner } from "../middleware/auth.js";
import { ResponseHelper, ValidationHelper, AuthHelper } from "../utils/api-helpers.js";
import { OwnershipHelper } from "../utils/ownership-helpers.js";

const router = Router();

// Public routes for viewing menus (no authentication required)

/**
 * GET /menu/restaurant/:restaurantId
 * Get all menu sections and items for a restaurant (public)
 */
router.get("/restaurant/:restaurantId", async (req, res: Response) => {
  const restaurantId = ValidationHelper.parseId(req.params.restaurantId as string);
  if (restaurantId === null) {
    return ResponseHelper.badRequest(res, "Invalid restaurant ID");
  }

  try {
    const sections = await db
      .select({
        id: menuSections.id,
        title: menuSections.title,
        position: menuSections.position,
        restaurantId: menuSections.restaurantId,
      })
      .from(menuSections)
      .where(eq(menuSections.restaurantId, restaurantId))
      .orderBy(menuSections.position);

    const items = await db
      .select({
        id: menuItems.id,
        sectionId: menuItems.sectionId,
        restaurantId: menuItems.restaurantId,
        name: menuItems.name,
        description: menuItems.description,
        priceCents: menuItems.priceCents,
        imageUrl: menuItems.imageUrl,
        isAvailable: menuItems.isAvailable,
      })
      .from(menuItems)
      .where(and(eq(menuItems.restaurantId, restaurantId), eq(menuItems.isAvailable, true)));

    ResponseHelper.success(res, { sections, items });
  } catch {
    ResponseHelper.internalError(res, "Failed to fetch restaurant menu");
  }
});

/**
 * GET /menu/sections
 * Get menu sections for a restaurant (public)
 */
router.get("/sections", async (req, res: Response) => {
  const restaurantId = ValidationHelper.parseId(req.query.restaurantId as string);
  if (restaurantId === null) {
    return ResponseHelper.badRequest(res, "Invalid restaurant ID");
  }

  try {
    const sections = await db
      .select({
        id: menuSections.id,
        title: menuSections.title,
        position: menuSections.position,
        restaurantId: menuSections.restaurantId,
      })
      .from(menuSections)
      .where(eq(menuSections.restaurantId, restaurantId))
      .orderBy(menuSections.position);

    ResponseHelper.success(res, sections);
  } catch {
    ResponseHelper.internalError(res, "Failed to fetch menu sections");
  }
});

/**
 * GET /menu/items
 * Get menu items for a section (public)
 */
router.get("/items", async (req, res: Response) => {
  const sectionId = ValidationHelper.parseId(req.query.sectionId as string);
  if (sectionId === null) {
    return ResponseHelper.badRequest(res, "Invalid section ID");
  }

  try {
    const items = await db
      .select({
        id: menuItems.id,
        sectionId: menuItems.sectionId,
        restaurantId: menuItems.restaurantId,
        name: menuItems.name,
        description: menuItems.description,
        priceCents: menuItems.priceCents,
        imageUrl: menuItems.imageUrl,
        isAvailable: menuItems.isAvailable,
      })
      .from(menuItems)
      .where(and(eq(menuItems.sectionId, sectionId), eq(menuItems.isAvailable, true)));

    ResponseHelper.success(res, items);
  } catch {
    ResponseHelper.internalError(res, "Failed to fetch menu items");
  }
});

// Partner-only routes (require authentication and partner status)
router.use(authenticateUser);
router.use(requirePartner);

// Input validation interfaces
interface SectionInput {
  title: string;
  position?: number;
}

interface ItemInput {
  name: string;
  description?: string;
  priceCents: number;
  imageUrl?: string;
  isAvailable?: boolean;
  sectionId?: number;
}

// Validation helpers
function validateSectionInput(input: Partial<SectionInput>): {
  data: Partial<SectionInput>;
  error?: string;
} {
  if (input.title !== undefined && !input.title.trim()) {
    return { data: {}, error: "Section title cannot be empty" };
  }

  return {
    data: {
      ...(input.title && { title: input.title.trim() }),
      ...(input.position !== undefined && { position: input.position }),
    },
  };
}

function validateItemInput(input: Partial<ItemInput>): {
  data: Partial<ItemInput>;
  error?: string;
} {
  if (input.name !== undefined && !input.name.trim()) {
    return { data: {}, error: "Item name cannot be empty" };
  }

  if (input.priceCents !== undefined) {
    const priceError = ValidationHelper.validatePriceCents(input.priceCents);
    if (priceError) return { data: {}, error: priceError };
  }

  return {
    data: {
      ...(input.name && { name: input.name.trim() }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.priceCents !== undefined && { priceCents: input.priceCents }),
      ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
      ...(input.isAvailable !== undefined && { isAvailable: input.isAvailable }),
      ...(input.sectionId !== undefined && { sectionId: input.sectionId }),
    },
  };
}

// Common operation validator
async function validateOperation(
  req: AuthenticatedRequest,
  res: Response,
  paramNames: string[]
): Promise<{ userId: string; params: Record<string, number> } | null> {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return null;

  const params: Record<string, number> = {};

  for (const paramName of paramNames) {
    const value = ValidationHelper.parseId(req.params[paramName] as string);
    if (value === null) {
      ResponseHelper.badRequest(res, `Invalid ${paramName}`);
      return null;
    }
    params[paramName] = value;
  }

  if (params.restaurantId) {
    const hasAccess = await OwnershipHelper.verifyRestaurantOwnership(userId, params.restaurantId);
    if (!hasAccess) {
      ResponseHelper.forbidden(res);
      return null;
    }
  }

  return { userId, params };
}

/**
 * POST /menu/:restaurantId/sections
 * Create a new menu section
 */
router.post("/:restaurantId/sections", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = await validateOperation(req, res, ["restaurantId"]);
    if (!validation) return;

    const { params } = validation;
    const restaurantId = params.restaurantId;

    const { data, error } = validateSectionInput(req.body);
    if (error) return ResponseHelper.badRequest(res, error);
    if (!data.title) return ResponseHelper.badRequest(res, "Section title is required");

    const newSection = await db
      .insert(menuSections)
      .values({
        restaurantId: Number(restaurantId),
        title: data.title,
        position: data.position ?? 0,
      })
      .returning();

    ResponseHelper.created(res, newSection[0]);
  } catch {
    ResponseHelper.internalError(res, "Failed to create menu section");
  }
});

/**
 * GET /menu/:restaurantId/sections
 * Get all menu sections for a restaurant
 */
router.get("/:restaurantId/sections", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = await validateOperation(req, res, ["restaurantId"]);
    if (!validation) return;

    const { params } = validation;
    const restaurantId = params.restaurantId;

    if (restaurantId === undefined) {
      return ResponseHelper.badRequest(res, "Invalid restaurantId");
    }

    const sections = await db
      .select({
        id: menuSections.id,
        title: menuSections.title,
        position: menuSections.position,
        createdAt: menuSections.createdAt,
        updatedAt: menuSections.updatedAt,
      })
      .from(menuSections)
      .where(eq(menuSections.restaurantId, restaurantId))
      .orderBy(menuSections.position);

    const sectionsWithItems = await Promise.all(
      sections.map(async (section) => {
        const items = await db
          .select()
          .from(menuItems)
          .where(eq(menuItems.sectionId, section.id))
          .orderBy(menuItems.id);
        return { ...section, items };
      })
    );

    ResponseHelper.success(res, sectionsWithItems);
  } catch {
    ResponseHelper.internalError(res, "Failed to fetch menu sections");
  }
});

/**
 * PUT /menu/:restaurantId/sections/:sectionId
 * Update a menu section
 */
router.put(
  "/:restaurantId/sections/:sectionId",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const validation = await validateOperation(req, res, ["restaurantId", "sectionId"]);
      if (!validation) return;

      const { params } = validation;
      const restaurantId = params.restaurantId;
      const sectionId = params.sectionId;

      const { data, error } = validateSectionInput(req.body);
      if (error) return ResponseHelper.badRequest(res, error);

      const updateData = {
        ...data,
        updatedAt: new Date(),
      };

      if (sectionId === undefined || restaurantId === undefined) {
        return ResponseHelper.badRequest(res, "Invalid sectionId or restaurantId");
      }
      const updatedSection = await db
        .update(menuSections)
        .set(updateData)
        .where(
          and(
            eq(menuSections.id, Number(sectionId)),
            eq(menuSections.restaurantId, Number(restaurantId))
          )
        )
        .returning();

      if (updatedSection.length === 0) {
        return ResponseHelper.notFound(res);
      }

      ResponseHelper.success(res, updatedSection[0]);
    } catch {
      ResponseHelper.internalError(res, "Failed to update menu section");
    }
  }
);

/**
 * DELETE /menu/:restaurantId/sections/:sectionId
 * Delete a menu section and all its items
 */
router.delete(
  "/:restaurantId/sections/:sectionId",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const validation = await validateOperation(req, res, ["restaurantId", "sectionId"]);
      if (!validation) return;

      const { params } = validation;
      const restaurantId = params.restaurantId;
      const sectionId = params.sectionId;

      // Delete items first (foreign key constraint)
      if (sectionId === undefined) {
        return ResponseHelper.badRequest(res, "Invalid sectionId");
      }
      await db.delete(menuItems).where(eq(menuItems.sectionId, sectionId));

      // Delete section
      const deletedSection = await db
        .delete(menuSections)
        .where(
          and(
            eq(menuSections.id, Number(sectionId)),
            eq(menuSections.restaurantId, Number(restaurantId))
          )
        )
        .returning();

      if (deletedSection.length === 0) {
        return ResponseHelper.notFound(res);
      }

      ResponseHelper.success(res, {
        message: "Menu section and all its items deleted successfully",
      });
    } catch {
      ResponseHelper.internalError(res, "Failed to delete menu section");
    }
  }
);

/**
 * POST /menu/:restaurantId/sections/:sectionId/items
 * Create a new menu item
 */
router.post(
  "/:restaurantId/sections/:sectionId/items",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const validation = await validateOperation(req, res, ["restaurantId", "sectionId"]);
      if (!validation) return;

      const { params } = validation;
      const restaurantId = params.restaurantId;
      const sectionId = params.sectionId;

      const { data, error } = validateItemInput(req.body);
      if (error) return ResponseHelper.badRequest(res, error);
      if (!data.name || data.priceCents === undefined) {
        return ResponseHelper.badRequest(res, "Item name and price are required");
      }

      // Verify section exists
      const section = await db
        .select()
        .from(menuSections)
        .where(
          and(
            eq(menuSections.id, Number(sectionId)),
            eq(menuSections.restaurantId, Number(restaurantId))
          )
        )
        .limit(1);

      if (section.length === 0) {
        return ResponseHelper.notFound(res);
      }

      // Create item
      const newItem = await db
        .insert(menuItems)
        .values({
          sectionId: Number(sectionId),
          restaurantId: Number(restaurantId),
          name: data.name!,
          description: data.description || null,
          priceCents: data.priceCents!,
          imageUrl: data.imageUrl || null,
          isAvailable: data.isAvailable ?? true,
        })
        .returning();

      ResponseHelper.created(res, newItem[0]);
    } catch {
      ResponseHelper.internalError(res, "Failed to create menu item");
    }
  }
);

/**
 * PUT /menu/:restaurantId/sections/:sectionId/items/:itemId
 * Update a menu item
 */
router.put(
  "/:restaurantId/sections/:sectionId/items/:itemId",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const validation = await validateOperation(req, res, ["restaurantId", "sectionId", "itemId"]);
      if (!validation) return;

      const { params } = validation;
      const restaurantId = params.restaurantId;
      const sectionId = params.sectionId;
      const itemId = params.itemId;

      const { data, error } = validateItemInput(req.body);
      if (error) return ResponseHelper.badRequest(res, error);

      const updateData = {
        ...data,
        updatedAt: new Date(),
      };

      const updatedItem = await db
        .update(menuItems)
        .set(updateData)
        .where(
          and(
            eq(menuItems.id, Number(itemId)),
            eq(menuItems.sectionId, Number(sectionId)),
            eq(menuItems.restaurantId, Number(restaurantId))
          )
        )
        .returning();

      if (updatedItem.length === 0) {
        return ResponseHelper.notFound(res);
      }

      ResponseHelper.success(res, updatedItem[0]);
    } catch {
      ResponseHelper.internalError(res, "Failed to update menu item");
    }
  }
);

/**
 * DELETE /menu/:restaurantId/sections/:sectionId/items/:itemId
 * Delete a menu item
 */
router.delete(
  "/:restaurantId/sections/:sectionId/items/:itemId",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const validation = await validateOperation(req, res, ["restaurantId", "sectionId", "itemId"]);
      if (!validation) return;

      const { params } = validation;
      const restaurantId = params.restaurantId;
      const sectionId = params.sectionId;
      const itemId = params.itemId;

      const deletedItem = await db
        .delete(menuItems)
        .where(
          and(
            eq(menuItems.id, Number(itemId)),
            eq(menuItems.sectionId, Number(sectionId)),
            eq(menuItems.restaurantId, Number(restaurantId))
          )
        )
        .returning();

      if (deletedItem.length === 0) {
        return ResponseHelper.notFound(res);
      }

      ResponseHelper.success(res, { message: "Menu item deleted successfully" });
    } catch {
      ResponseHelper.internalError(res, "Failed to delete menu item");
    }
  }
);

// Additional simplified endpoints to match frontend service expectations

/**
 * POST /menu/:restaurantId/items
 * Create a new menu item (simplified endpoint)
 */
router.post("/:restaurantId/items", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = await validateOperation(req, res, ["restaurantId"]);
    if (!validation) return;

    const { params } = validation;
    const restaurantId = params.restaurantId;

    const { data, error } = validateItemInput(req.body);
    if (error) return ResponseHelper.badRequest(res, error);
    if (!data.name || data.priceCents === undefined || !req.body.sectionId) {
      return ResponseHelper.badRequest(res, "Item name, price, and sectionId are required");
    }

    const sectionId = ValidationHelper.parseId(req.body.sectionId);
    if (sectionId === null) {
      return ResponseHelper.badRequest(res, "Invalid sectionId");
    }

    // Verify section exists and belongs to the restaurant
    const section = await db
      .select()
      .from(menuSections)
      .where(
        and(
          eq(menuSections.id, Number(sectionId)),
          eq(menuSections.restaurantId, Number(restaurantId))
        )
      )
      .limit(1);

    if (section.length === 0) {
      return ResponseHelper.badRequest(res, "Invalid section for this restaurant");
    }

    // Create item
    const newItem = await db
      .insert(menuItems)
      .values({
        sectionId: Number(sectionId),
        restaurantId: Number(restaurantId),
        name: data.name!,
        description: data.description || null,
        priceCents: data.priceCents!,
        imageUrl: data.imageUrl || null,
        isAvailable: data.isAvailable ?? true,
      })
      .returning();

    ResponseHelper.created(res, newItem[0]);
  } catch {
    ResponseHelper.internalError(res, "Failed to create menu item");
  }
});

/**
 * PUT /menu/:restaurantId/items/:itemId
 * Update a menu item (simplified endpoint)
 */
router.put("/:restaurantId/items/:itemId", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = await validateOperation(req, res, ["restaurantId", "itemId"]);
    if (!validation) return;

    const { params } = validation;
    const restaurantId = params.restaurantId;
    const itemId = params.itemId;

    const { data, error } = validateItemInput(req.body);
    if (error) return ResponseHelper.badRequest(res, error);

    // If sectionId is being updated, verify it belongs to the restaurant
    if (req.body.sectionId !== undefined) {
      const sectionId = ValidationHelper.parseId(req.body.sectionId);
      if (sectionId === null) {
        return ResponseHelper.badRequest(res, "Invalid sectionId");
      }

      const section = await db
        .select()
        .from(menuSections)
        .where(
          and(
            eq(menuSections.id, Number(sectionId)),
            eq(menuSections.restaurantId, Number(restaurantId))
          )
        )
        .limit(1);

      if (section.length === 0) {
        return ResponseHelper.badRequest(res, "Invalid section for this restaurant");
      }

      data.sectionId = Number(sectionId);
    }

    const updateData = {
      ...data,
      updatedAt: new Date(),
    };

    const updatedItem = await db
      .update(menuItems)
      .set(updateData)
      .where(
        and(eq(menuItems.id, Number(itemId)), eq(menuItems.restaurantId, Number(restaurantId)))
      )
      .returning();

    if (updatedItem.length === 0) {
      return ResponseHelper.notFound(res);
    }

    ResponseHelper.success(res, updatedItem[0]);
  } catch {
    ResponseHelper.internalError(res, "Failed to update menu item");
  }
});

/**
 * DELETE /menu/:restaurantId/items/:itemId
 * Delete a menu item (simplified endpoint)
 */
router.delete("/:restaurantId/items/:itemId", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = await validateOperation(req, res, ["restaurantId", "itemId"]);
    if (!validation) return;

    const { params } = validation;
    const restaurantId = params.restaurantId;
    const itemId = params.itemId;

    const deletedItem = await db
      .delete(menuItems)
      .where(
        and(eq(menuItems.id, Number(itemId)), eq(menuItems.restaurantId, Number(restaurantId)))
      )
      .returning();

    if (deletedItem.length === 0) {
      return ResponseHelper.notFound(res);
    }

    ResponseHelper.success(res, { message: "Menu item deleted successfully" });
  } catch {
    ResponseHelper.internalError(res, "Failed to delete menu item");
  }
});

/**
 * GET /menu/:restaurantId/sections/:sectionId
 * Get a specific menu section with its items
 */
router.get(
  "/:restaurantId/sections/:sectionId",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const validation = await validateOperation(req, res, ["restaurantId", "sectionId"]);
      if (!validation) return;

      const { params } = validation;
      const restaurantId = params.restaurantId;
      const sectionId = params.sectionId;

      const section = await db
        .select({
          id: menuSections.id,
          title: menuSections.title,
          position: menuSections.position,
          restaurantId: menuSections.restaurantId,
          createdAt: menuSections.createdAt,
          updatedAt: menuSections.updatedAt,
        })
        .from(menuSections)
        .where(
          and(
            eq(menuSections.id, Number(sectionId)),
            eq(menuSections.restaurantId, Number(restaurantId))
          )
        )
        .limit(1);

      if (section.length === 0) {
        return ResponseHelper.notFound(res);
      }

      const items = await db
        .select()
        .from(menuItems)
        .where(eq(menuItems.sectionId, Number(sectionId)))
        .orderBy(menuItems.id);

      const sectionWithItems = {
        ...section[0],
        items,
      };

      ResponseHelper.success(res, sectionWithItems);
    } catch {
      ResponseHelper.internalError(res, "Failed to fetch menu section");
    }
  }
);

export default router;
