import { Router } from "express";
import type { Response } from "express";
import { db } from "../db/db.js";
import { partners, restaurants, deals } from "../db/schema.js";
import { eq, and, count } from "drizzle-orm";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { authenticateUser, requirePartner } from "../middleware/auth.js";
import { AuthHelper, DbHelper, ResponseHelper, ValidationHelper } from "../utils/api-helpers.js";

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateUser);

/**
 * POST /partner/register
 * Register as a restaurant partner
 *
 * Body:
 * {
 *   "businessName": "John's Pizza Co.",
 *   "streetAddress": "123 Main St",
 *   "city": "Toronto",
 *   "province": "ON",
 *   "postalCode": "M1A 1A1",
 *   "phone": "+1-416-555-0123"
 * }
 */
router.post("/register", async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const { businessName, streetAddress, city, province, postalCode, phone } = req.body;

  if (!businessName) {
    return ResponseHelper.badRequest(res, "Business name is required");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Check if user is already a partner
      const existingPartner = await db
        .select()
        .from(partners)
        .where(eq(partners.userId, userId))
        .limit(1);

      if (existingPartner.length > 0) {
        throw new Error("User is already registered as a partner");
      }

      // Create partner record
      const newPartner = await db
        .insert(partners)
        .values({
          userId,
          businessName,
          streetAddress: streetAddress || null,
          city: city || null,
          province: province || null,
          postalCode: postalCode || null,
          phone: phone || null,
        })
        .returning();

      if (!newPartner[0]) {
        throw new Error("Failed to create partner record");
      }

      return {
        partnerId: newPartner[0].id,
        businessName: newPartner[0].businessName,
        streetAddress: newPartner[0].streetAddress,
        city: newPartner[0].city,
        province: newPartner[0].province,
        postalCode: newPartner[0].postalCode,
        phone: newPartner[0].phone,
        createdAt: newPartner[0].createdAt,
      };
    },
    res,
    "Failed to register as partner"
  );

  if (result) {
    ResponseHelper.created(res, result);
  }
});

/**
 * GET /partner/profile
 * Get partner profile information
 */
router.get("/profile", requirePartner, async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      const partner = await db.select().from(partners).where(eq(partners.userId, userId)).limit(1);

      if (!partner[0]) {
        throw new Error("Partner profile not found");
      }

      return {
        id: partner[0].id,
        businessName: partner[0].businessName,
        streetAddress: partner[0].streetAddress,
        city: partner[0].city,
        province: partner[0].province,
        postalCode: partner[0].postalCode,
        phone: partner[0].phone,
        createdAt: partner[0].createdAt,
        updatedAt: partner[0].updatedAt,
      };
    },
    res,
    "Failed to fetch partner profile"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

/**
 * PUT /partner/profile
 * Update partner profile information
 *
 * Body:
 * {
 *   "businessName": "Updated Business Name",
 *   "streetAddress": "456 New St",
 *   "city": "Toronto",
 *   "province": "ON",
 *   "postalCode": "M2B 2B2",
 *   "phone": "+1-416-555-0456"
 * }
 */
router.put("/profile", requirePartner, async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const { businessName, streetAddress, city, province, postalCode, phone } = req.body;

  if (businessName !== undefined && !businessName.trim()) {
    return ResponseHelper.badRequest(res, "Business name cannot be empty");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Prepare update data
      const updateData: Partial<typeof partners.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (businessName !== undefined) updateData.businessName = businessName;
      if (streetAddress !== undefined) updateData.streetAddress = streetAddress;
      if (city !== undefined) updateData.city = city;
      if (province !== undefined) updateData.province = province;
      if (postalCode !== undefined) updateData.postalCode = postalCode;
      if (phone !== undefined) updateData.phone = phone;

      // Update partner information
      const updatedPartner = await db
        .update(partners)
        .set(updateData)
        .where(eq(partners.userId, userId))
        .returning();

      if (updatedPartner.length === 0) {
        throw new Error("Partner not found");
      }

      if (!updatedPartner[0]) {
        throw new Error("Failed to update partner profile");
      }

      return {
        id: updatedPartner[0].id,
        businessName: updatedPartner[0].businessName,
        streetAddress: updatedPartner[0].streetAddress,
        city: updatedPartner[0].city,
        province: updatedPartner[0].province,
        postalCode: updatedPartner[0].postalCode,
        phone: updatedPartner[0].phone,
        updatedAt: updatedPartner[0].updatedAt,
      };
    },
    res,
    "Failed to update partner profile"
  );

  if (result) {
    ResponseHelper.success(res, result, "Partner profile updated successfully");
  }
});

/**
 * POST /partner/restaurants
 * Create a new restaurant
 *
 * Body:
 * {
 *   "name": "John's Pizza Downtown",
 *   "description": "Authentic Italian pizza since 1985",
 *   "streetAddress": "789 Queen St W",
 *   "city": "Toronto",
 *   "province": "ON",
 *   "postalCode": "M3C 3C3",
 *   "phone": "+1-416-555-0789",
 *   "latitude": 43.7002,
 *   "longitude": -79.4000,
 *   "openingTime": "11:00",
 *   "closingTime": "23:00"
 * }
 */
router.post("/restaurants", requirePartner, async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const {
    name,
    description,
    streetAddress,
    city,
    province,
    postalCode,
    phone,
    latitude,
    longitude,
    openingTime,
    closingTime,
    imageUrl,
  } = req.body;

  if (!name) {
    return ResponseHelper.badRequest(res, "Restaurant name is required");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Get partner ID
      const partner = await db.select().from(partners).where(eq(partners.userId, userId)).limit(1);

      if (partner.length === 0) {
        throw new Error("Partner not found");
      }

      const partnerId = partner[0]?.id;
      if (!partnerId) {
        throw new Error("Partner not found");
      }

      // Create restaurant
      const newRestaurant = await db
        .insert(restaurants)
        .values({
          partnerId,
          name,
          description: description || null,
          streetAddress: streetAddress || null,
          city: city || null,
          province: province || null,
          postalCode: postalCode || null,
          phone: phone || null,
          latitude: latitude || null,
          longitude: longitude || null,
          openingTime: openingTime || null,
          closingTime: closingTime || null,
          imageUrl: imageUrl || null,
        })
        .returning();

      if (!newRestaurant[0]) {
        throw new Error("Failed to create restaurant");
      }

      return {
        id: newRestaurant[0].id,
        name: newRestaurant[0].name,
        description: newRestaurant[0].description,
        streetAddress: newRestaurant[0].streetAddress,
        city: newRestaurant[0].city,
        province: newRestaurant[0].province,
        postalCode: newRestaurant[0].postalCode,
        phone: newRestaurant[0].phone,
        latitude: newRestaurant[0].latitude,
        longitude: newRestaurant[0].longitude,
        openingTime: newRestaurant[0].openingTime,
        closingTime: newRestaurant[0].closingTime,
        isActive: newRestaurant[0].isActive,
        imageUrl: newRestaurant[0].imageUrl,
        createdAt: newRestaurant[0].createdAt,
      };
    },
    res,
    "Failed to create restaurant"
  );

  if (result) {
    ResponseHelper.created(res, result);
  }
});

/**
 * GET /partner/restaurants
 * Get all restaurants owned by the partner with deal counts
 */
router.get("/restaurants", requirePartner, async (req: AuthenticatedRequest, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Get partner ID
      const partner = await db.select().from(partners).where(eq(partners.userId, userId)).limit(1);

      if (partner.length === 0) {
        throw new Error("Partner not found");
      }

      const partnerId = partner[0]?.id;
      if (!partnerId) {
        throw new Error("Partner not found");
      }

      // Get all restaurants for this partner
      const partnerRestaurants = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.partnerId, partnerId));

      // Enhance each restaurant with deal counts
      const restaurantsWithCounts = await Promise.all(
        partnerRestaurants.map(async (restaurant) => {
          // Get total deal count for this restaurant
          const totalDealsResult = await db
            .select({ count: count() })
            .from(deals)
            .where(eq(deals.restaurantId, restaurant.id));

          // Get active deal count for this restaurant
          const activeDealsResult = await db
            .select({ count: count() })
            .from(deals)
            .where(and(eq(deals.restaurantId, restaurant.id), eq(deals.status, "active")));

          const totalDeals = totalDealsResult[0]?.count || 0;
          const activeDeals = activeDealsResult[0]?.count || 0;

          return {
            ...restaurant,
            totalDeals: Number(totalDeals),
            activeDeals: Number(activeDeals),
            rating: Number(restaurant.ratingAvg || 0),
          };
        })
      );

      return restaurantsWithCounts;
    },
    res,
    "Failed to fetch restaurants"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

/**
 * GET /partner/restaurants/:restaurantId
 * Get a specific restaurant owned by the partner
 */
router.get(
  "/restaurants/:restaurantId",
  requirePartner,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = AuthHelper.requireAuth(req, res);
    if (!userId) return;

    const restaurantId = ValidationHelper.parseId(req.params.restaurantId as string);
    if (restaurantId === null) {
      return ResponseHelper.badRequest(res, "Invalid restaurant ID");
    }

    const result = await DbHelper.executeWithErrorHandling(
      async () => {
        // Get partner ID
        const partner = await db
          .select()
          .from(partners)
          .where(eq(partners.userId, userId))
          .limit(1);

        if (partner.length === 0) {
          throw new Error("Partner not found");
        }

        const partnerId = partner[0]?.id;
        if (!partnerId) {
          throw new Error("Partner not found");
        }

        // Get the specific restaurant for this partner
        const restaurant = await db
          .select()
          .from(restaurants)
          .where(and(eq(restaurants.id, restaurantId), eq(restaurants.partnerId, partnerId)))
          .limit(1);

        if (restaurant.length === 0) {
          throw new Error("Restaurant not found or you don't have permission to access it");
        }

        return restaurant[0];
      },
      res,
      "Failed to fetch restaurant"
    );

    if (result) {
      ResponseHelper.success(res, result);
    }
  }
);

/**
 * PUT /partner/restaurants/:restaurantId
 * Update restaurant information
 *
 * Body: Same as POST /partner/restaurants (all fields optional)
 */
router.put(
  "/restaurants/:restaurantId",
  requirePartner,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = AuthHelper.requireAuth(req, res);
    if (!userId) return;

    const restaurantId = ValidationHelper.parseId(req.params.restaurantId as string);
    if (restaurantId === null) {
      return ResponseHelper.badRequest(res, "Invalid restaurant ID");
    }

    const {
      name,
      description,
      streetAddress,
      city,
      province,
      postalCode,
      phone,
      latitude,
      longitude,
      openingTime,
      closingTime,
      isActive,
      imageUrl,
    } = req.body;

    if (name !== undefined && !name.trim()) {
      return ResponseHelper.badRequest(res, "Restaurant name cannot be empty");
    }

    const result = await DbHelper.executeWithErrorHandling(
      async () => {
        // Get partner ID and verify ownership
        const partner = await db
          .select()
          .from(partners)
          .where(eq(partners.userId, userId))
          .limit(1);

        if (partner.length === 0) {
          throw new Error("Partner not found");
        }

        const partnerId = partner[0]?.id;
        if (!partnerId) {
          throw new Error("Partner not found");
        }

        // Verify restaurant ownership
        const restaurant = await db
          .select()
          .from(restaurants)
          .where(eq(restaurants.id, restaurantId))
          .limit(1);

        if (restaurant.length === 0) {
          throw new Error("Restaurant not found");
        }

        if (!restaurant[0] || restaurant[0].partnerId !== partnerId) {
          throw new Error("You can only update restaurants you own");
        }

        // Prepare update data
        const updateData: Partial<typeof restaurants.$inferInsert> = {
          updatedAt: new Date(),
        };

        if (name !== undefined) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        if (streetAddress !== undefined) updateData.streetAddress = streetAddress;
        if (city !== undefined) updateData.city = city;
        if (province !== undefined) updateData.province = province;
        if (postalCode !== undefined) updateData.postalCode = postalCode;
        if (phone !== undefined) updateData.phone = phone;
        if (latitude !== undefined) updateData.latitude = latitude;
        if (longitude !== undefined) updateData.longitude = longitude;
        if (openingTime !== undefined) updateData.openingTime = openingTime;
        if (closingTime !== undefined) updateData.closingTime = closingTime;
        if (isActive !== undefined) {
          updateData.isActive = isActive;
        }

        if (imageUrl !== undefined) {
          updateData.imageUrl = imageUrl;
        }

        // Update restaurant
        const updatedRestaurant = await db
          .update(restaurants)
          .set(updateData)
          .where(eq(restaurants.id, restaurantId))
          .returning();

        return updatedRestaurant[0];
      },
      res,
      "Failed to update restaurant"
    );

    if (result) {
      ResponseHelper.success(res, result, "Restaurant information updated successfully");
    }
  }
);

export default router;
