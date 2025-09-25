import { Router } from "express";
import type { Request, Response } from "express";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { db } from "../db/db.js";
import {
  restaurants,
  partners,
  deals,
  cuisines,
  dealCuisines,
  userFavoriteRestaurants,
} from "../db/schema.js";
import { ResponseHelper, AuthHelper, ValidationHelper, DbHelper } from "../utils/api-helpers.js";

const router = Router();

/**
 * GET /search/restaurants
 * Search for restaurants with various filters
 */
router.get("/restaurants", async (req: Request, res: Response) => {
  const {
    q: searchQuery,
    cuisine,
    latitude: userLatStr,
    longitude: userLngStr,
    radius: radiusStr,
    page: pageStr,
    limit: limitStr,
    sortBy,
    sortOrder,
    hasActiveDeals,
  } = req.query;

  // Parse and validate parameters
  const userLat = userLatStr ? parseFloat(userLatStr as string) : null;
  const userLng = userLngStr ? parseFloat(userLngStr as string) : null;
  const radius = radiusStr ? parseFloat(radiusStr as string) : 50; // Default 50km
  const page = Math.max(1, parseInt(pageStr as string) || 1);
  const limit = Math.min(Math.max(1, parseInt(limitStr as string) || 20), 100);
  const offset = (page - 1) * limit;

  // Validate location parameters
  if ((userLat !== null && userLng === null) || (userLat === null && userLng !== null)) {
    return ResponseHelper.badRequest(
      res,
      "Both latitude and longitude are required for location-based search"
    );
  }

  if (userLat !== null && (userLat < -90 || userLat > 90)) {
    return ResponseHelper.badRequest(res, "Latitude must be between -90 and 90");
  }

  if (userLng !== null && (userLng < -180 || userLng > 180)) {
    return ResponseHelper.badRequest(res, "Longitude must be between -180 and 180");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Build the base query conditions
      const whereConditions: import("drizzle-orm").SQLWrapper[] = [eq(restaurants.isActive, true)];

      // Add search query filter
      if (searchQuery) {
        const searchTerm = `%${searchQuery}%`;
        const searchCondition = or(
          like(restaurants.name, searchTerm),
          like(partners.businessName, searchTerm),
          like(restaurants.description, searchTerm)
        );
        if (searchCondition) {
          whereConditions.push(searchCondition);
        }
      }

      // Add cuisine filter
      if (cuisine) {
        const cuisineId = await db
          .select({ id: cuisines.id })
          .from(cuisines)
          .where(like(cuisines.name, `%${cuisine}%`))
          .limit(1);

        if (cuisineId.length > 0 && cuisineId[0]?.id !== undefined) {
          const restaurantsWithCuisine = await db
            .select({ restaurantId: deals.restaurantId })
            .from(deals)
            .innerJoin(dealCuisines, eq(deals.id, dealCuisines.dealId))
            .where(and(eq(dealCuisines.cuisineId, cuisineId[0].id), eq(deals.status, "active")));

          const restaurantIds = restaurantsWithCuisine.map((r) => r.restaurantId);

          if (restaurantIds.length > 0) {
            whereConditions.push(sql`${restaurants.id} IN ${restaurantIds}`);
          } else {
            // No restaurants found with this cuisine
            return {
              restaurants: [],
              searchParams: {
                query: searchQuery || null,
                cuisine: cuisine || null,
                location:
                  userLat !== null && userLng !== null
                    ? { latitude: userLat, longitude: userLng, radius }
                    : null,
                sortBy: sortBy || "relevance",
                sortOrder: sortOrder || "asc",
              },
              pagination: {
                currentPage: page,
                totalPages: 1,
                totalCount: 0,
                hasNextPage: false,
                hasPreviousPage: false,
              },
            };
          }
        }
      }

      // Add active deals filter
      if (hasActiveDeals === "true") {
        const dealsSubquery = db
          .select({ restaurantId: deals.restaurantId })
          .from(deals)
          .where(eq(deals.status, "active"));

        const restaurantIdsWithActiveDeals = await dealsSubquery;
        const activeRestaurantIds = restaurantIdsWithActiveDeals.map((d) => d.restaurantId);

        if (activeRestaurantIds.length > 0) {
          whereConditions.push(sql`${restaurants.id} IN ${activeRestaurantIds}`);
        } else {
          // No restaurants with active deals
          return {
            restaurants: [],
            searchParams: {
              query: searchQuery || null,
              cuisine: cuisine || null,
              location:
                userLat !== null && userLng !== null
                  ? { latitude: userLat, longitude: userLng, radius }
                  : null,
              sortBy: sortBy || "relevance",
              sortOrder: sortOrder || "asc",
            },
            pagination: {
              currentPage: page,
              totalPages: 1,
              totalCount: 0,
              hasNextPage: false,
              hasPreviousPage: false,
            },
          };
        }
      }

      // Determine sort order
      const validSortByFields = ["name", "ratingAvg", "distance", "createdAt", "relevance"];
      const validSortOrders = ["asc", "desc"];
      const actualSortBy = validSortByFields.includes(sortBy as string)
        ? (sortBy as string)
        : "relevance";
      const actualSortOrder = validSortOrders.includes(sortOrder as string)
        ? (sortOrder as string)
        : "asc";

      // Get restaurant results with sorting
      let orderByClause;
      if (actualSortBy === "name") {
        orderByClause = actualSortOrder === "desc" ? desc(restaurants.name) : asc(restaurants.name);
      } else if (actualSortBy === "ratingAvg") {
        orderByClause =
          actualSortOrder === "desc" ? desc(restaurants.ratingAvg) : asc(restaurants.ratingAvg);
      } else if (actualSortBy === "createdAt") {
        orderByClause =
          actualSortOrder === "desc" ? desc(restaurants.createdAt) : asc(restaurants.createdAt);
      } else {
        // Default relevance sorting (created date desc)
        orderByClause = desc(restaurants.createdAt);
      }

      const searchResults = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          description: restaurants.description,
          streetAddress: restaurants.streetAddress,
          city: restaurants.city,
          province: restaurants.province,
          latitude: restaurants.latitude,
          longitude: restaurants.longitude,
          ratingAvg: restaurants.ratingAvg,
          ratingCount: restaurants.ratingCount,
          openingTime: restaurants.openingTime,
          closingTime: restaurants.closingTime,
          createdAt: restaurants.createdAt,
          partner: {
            businessName: partners.businessName,
          },
        })
        .from(restaurants)
        .innerJoin(partners, eq(restaurants.partnerId, partners.id))
        .where(and(...whereConditions))
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      // Apply distance filtering if location provided
      let filteredResults = searchResults;
      if (userLat !== null && userLng !== null) {
        filteredResults = searchResults.filter((restaurant) => {
          if (!restaurant.latitude || !restaurant.longitude) return false;

          // Simple distance calculation (rough approximation)
          const distance =
            Math.sqrt(
              Math.pow(restaurant.latitude - userLat, 2) +
                Math.pow(restaurant.longitude - userLng, 2)
            ) * 111; // Rough conversion to km

          return distance <= radius;
        });

        // Sort by distance if requested
        if (actualSortBy === "distance") {
          filteredResults.sort((a, b) => {
            const distanceA = Math.sqrt(
              Math.pow((a.latitude || 0) - userLat, 2) + Math.pow((a.longitude || 0) - userLng, 2)
            );
            const distanceB = Math.sqrt(
              Math.pow((b.latitude || 0) - userLat, 2) + Math.pow((b.longitude || 0) - userLng, 2)
            );

            return actualSortOrder === "desc" ? distanceB - distanceA : distanceA - distanceB;
          });
        }
      }

      // Get active deals for these restaurants
      const restaurantIds = filteredResults.map((r) => r.id);
      let dealsForRestaurants: {
        id: number;
        title: string;
        description: string | null;
        restaurantId: number;
      }[] = [];

      if (restaurantIds.length > 0) {
        dealsForRestaurants = await db
          .select({
            id: deals.id,
            title: deals.title,
            description: deals.description,
            restaurantId: deals.restaurantId,
          })
          .from(deals)
          .where(and(sql`${deals.restaurantId} IN ${restaurantIds}`, eq(deals.status, "active")));
      }

      // Map deals to restaurants
      const resultsWithDeals = filteredResults.map((restaurant) => {
        const restaurantDeals = dealsForRestaurants.filter(
          (deal) => deal.restaurantId === restaurant.id
        );

        return {
          ...restaurant,
          activeDeals: restaurantDeals,
          ...(userLat !== null && userLng !== null && restaurant.latitude && restaurant.longitude
            ? {
                distance:
                  Math.sqrt(
                    Math.pow(restaurant.latitude - userLat, 2) +
                      Math.pow(restaurant.longitude - userLng, 2)
                  ) * 111, // Rough conversion to km
              }
            : {}),
        };
      });

      // Calculate pagination info (simplified - in production you'd want a proper count query)
      const totalPages = Math.ceil(searchResults.length / limit);

      return {
        restaurants: resultsWithDeals,
        searchParams: {
          query: searchQuery || null,
          cuisine: cuisine || null,
          location:
            userLat !== null && userLng !== null
              ? { latitude: userLat, longitude: userLng, radius }
              : null,
          sortBy: actualSortBy,
          sortOrder: actualSortOrder,
        },
        pagination: {
          currentPage: page,
          totalPages: Math.max(totalPages, 1),
          totalCount: searchResults.length, // Simplified count
          hasNextPage: searchResults.length === limit,
          hasPreviousPage: page > 1,
        },
      };
    },
    res,
    "Failed to search restaurants"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

/**
 * GET /search/restaurants/:restaurantId
 * Get detailed information about a specific restaurant
 */
router.get("/restaurants/:restaurantId", async (req: Request, res: Response) => {
  const restaurantId = ValidationHelper.parseId(req.params.restaurantId as string);
  if (restaurantId === null) {
    return ResponseHelper.badRequest(res, "Invalid restaurant ID");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      // Get restaurant details
      const restaurant = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          description: restaurants.description,
          streetAddress: restaurants.streetAddress,
          city: restaurants.city,
          province: restaurants.province,
          postalCode: restaurants.postalCode,
          phone: restaurants.phone,
          ratingAvg: restaurants.ratingAvg,
          ratingCount: restaurants.ratingCount,
          latitude: restaurants.latitude,
          longitude: restaurants.longitude,
          openingTime: restaurants.openingTime,
          closingTime: restaurants.closingTime,
          isActive: restaurants.isActive,
          createdAt: restaurants.createdAt,
          partner: {
            id: partners.id,
            businessName: partners.businessName,
          },
        })
        .from(restaurants)
        .innerJoin(partners, eq(restaurants.partnerId, partners.id))
        .where(and(eq(restaurants.id, restaurantId), eq(restaurants.isActive, true)))
        .limit(1);

      if (restaurant.length === 0) {
        throw new Error("Restaurant not found");
      }

      // Get active deals for this restaurant
      const activeDeals = await db
        .select({
          id: deals.id,
          title: deals.title,
          description: deals.description,
          startDate: deals.startDate,
          endDate: deals.endDate,
          createdAt: deals.createdAt,
        })
        .from(deals)
        .where(and(eq(deals.restaurantId, restaurantId), eq(deals.status, "active")))
        .orderBy(deals.createdAt);

      return {
        restaurant: restaurant[0],
        activeDeals,
      };
    },
    res,
    "Failed to fetch restaurant details"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

/**
 * GET /search/restaurants/:restaurantId/bookmark-status
 * Check if restaurant is bookmarked by authenticated user
 */
router.get("/restaurants/:restaurantId/bookmark-status", async (req: Request, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;

  const restaurantId = ValidationHelper.parseId(req.params.restaurantId as string);
  if (restaurantId === null) {
    return ResponseHelper.badRequest(res, "Invalid restaurant ID");
  }

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      const bookmark = await db
        .select()
        .from(userFavoriteRestaurants)
        .where(
          and(
            eq(userFavoriteRestaurants.userId, userId),
            eq(userFavoriteRestaurants.restaurantId, restaurantId)
          )
        )
        .limit(1);

      const bookmarkData = bookmark.length > 0 && bookmark[0] ? bookmark[0] : null;
      return {
        restaurantId,
        isBookmarked: bookmark.length > 0,
        notifyOnDeal: bookmarkData?.notifyOnDeal ?? false,
        bookmarkedAt: bookmarkData?.createdAt ?? null,
      };
    },
    res,
    "Failed to check bookmark status"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

export default router;
