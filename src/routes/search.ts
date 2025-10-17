import { Router } from "express";
import type { Request, Response } from "express";
import { and, asc, desc, eq, like, or, inArray } from "drizzle-orm";
import { db } from "../db/db.js";
import {
  restaurants,
  partners,
  deals,
  cuisines,
  dealCuisines,
  dietaryPreferences,
  dealDietaryPreferences,
  userFavoriteRestaurants,
  users,
} from "../db/schema.js";
import { ResponseHelper, AuthHelper, ValidationHelper, DbHelper } from "../utils/api-helpers.js";

const router = Router();

// Optional authentication middleware for public endpoints that show user-specific data when logged in
const optionalAuth = async (req: Request, res: Response, next: () => void) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      // No auth provided, continue as public request
      return next();
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix
    if (!token) {
      return next();
    }

    // Use the same verification logic as the main auth middleware
    const { verifyToken } = await import("@clerk/backend");
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });

    if (payload && payload.sub) {
      // Find user in database
      const user = await db.select().from(users).where(eq(users.clerkUserId, payload.sub)).limit(1);

      if (user.length > 0 && user[0]) {
        (req as Request & { userId?: string }).userId = user[0].id;
      }
    }
  } catch (error) {
    // Invalid token, continue as public request
    console.log("Optional auth failed:", error);
  }

  next();
};

/**
 * GET /search/restaurants
 * Search for restaurants with various filters
 */
router.get("/restaurants", optionalAuth, async (req: Request, res: Response) => {
  const {
    q: searchQuery,
    cuisine,
    dietaryPreference,
    latitude: userLatStr,
    longitude: userLngStr,
    radius: radiusStr,
    page: pageStr,
    limit: limitStr,
    sortBy,
    sortOrder,
    hasActiveDeals,
  } = req.query;

  console.log("Search endpoint called with params:", {
    searchQuery,
    cuisine,
    dietaryPreference,
    userLatStr,
    userLngStr,
    radiusStr,
    page: pageStr,
    limit: limitStr,
  });

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
      let cuisineRestaurantIds: number[] | null = null;
      if (cuisine) {
        console.log("Filtering by cuisine:", cuisine);
        const cuisineId = await db
          .select({ id: cuisines.id })
          .from(cuisines)
          .where(like(cuisines.name, `%${cuisine}%`))
          .limit(1);

        console.log("Found cuisine ID:", cuisineId);

        if (cuisineId.length > 0 && cuisineId[0]?.id !== undefined) {
          const restaurantsWithCuisine = await db
            .select({ restaurantId: deals.restaurantId })
            .from(deals)
            .innerJoin(dealCuisines, eq(deals.id, dealCuisines.dealId))
            .where(and(eq(dealCuisines.cuisineId, cuisineId[0].id), eq(deals.status, "active")));

          cuisineRestaurantIds = [...new Set(restaurantsWithCuisine.map((r) => r.restaurantId))];
          console.log("Restaurants with cuisine:", cuisineRestaurantIds);

          if (cuisineRestaurantIds.length === 0) {
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

      // Add dietary preference filter
      let dietaryRestaurantIds: number[] | null = null;
      if (dietaryPreference) {
        console.log("Filtering by dietary preference:", dietaryPreference);
        const dietPrefId = await db
          .select({ id: dietaryPreferences.id })
          .from(dietaryPreferences)
          .where(like(dietaryPreferences.name, `%${dietaryPreference}%`))
          .limit(1);

        console.log("Found dietary preference ID:", dietPrefId);

        if (dietPrefId.length > 0 && dietPrefId[0]?.id !== undefined) {
          const restaurantsWithDietPref = await db
            .select({ restaurantId: deals.restaurantId })
            .from(deals)
            .innerJoin(dealDietaryPreferences, eq(deals.id, dealDietaryPreferences.dealId))
            .where(
              and(
                eq(dealDietaryPreferences.dietaryPreferenceId, dietPrefId[0].id),
                eq(deals.status, "active")
              )
            );

          dietaryRestaurantIds = [...new Set(restaurantsWithDietPref.map((r) => r.restaurantId))];
          console.log("Restaurants with dietary preference:", dietaryRestaurantIds);

          if (dietaryRestaurantIds.length === 0) {
            // No restaurants found with this dietary preference
            return {
              restaurants: [],
              searchParams: {
                query: searchQuery || null,
                cuisine: cuisine || null,
                dietaryPreference: dietaryPreference || null,
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

      // Combine cuisine and dietary filters with AND logic
      // If both filters are active, only include restaurants that match BOTH
      if (cuisineRestaurantIds !== null && dietaryRestaurantIds !== null) {
        console.log("Applying AND logic between cuisine and dietary filters");
        const intersectedIds = cuisineRestaurantIds.filter((id) =>
          dietaryRestaurantIds!.includes(id)
        );
        console.log("Restaurants matching both filters:", intersectedIds.length, "restaurants");

        if (intersectedIds.length > 0) {
          whereConditions.push(inArray(restaurants.id, intersectedIds));
        } else {
          // No restaurants match both filters
          return {
            restaurants: [],
            searchParams: {
              query: searchQuery || null,
              cuisine: cuisine || null,
              dietaryPreference: dietaryPreference || null,
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
      } else if (cuisineRestaurantIds !== null) {
        // Only cuisine filter is active
        whereConditions.push(inArray(restaurants.id, cuisineRestaurantIds));
      } else if (dietaryRestaurantIds !== null) {
        // Only dietary filter is active
        whereConditions.push(inArray(restaurants.id, dietaryRestaurantIds));
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
          whereConditions.push(inArray(restaurants.id, activeRestaurantIds));
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
        console.log(
          "Applying distance filter. User location:",
          { userLat, userLng },
          "Radius:",
          radius
        );
        console.log("Results before distance filter:", searchResults.length);

        // Log all restaurant locations
        console.log("All restaurants in database:");
        searchResults.forEach((restaurant) => {
          console.log(`  - ${restaurant.name}: (${restaurant.latitude}, ${restaurant.longitude})`);
        });

        filteredResults = searchResults.filter((restaurant) => {
          if (!restaurant.latitude || !restaurant.longitude) return false;

          // Haversine formula for accurate distance calculation
          const toRad = (value: number) => (value * Math.PI) / 180;
          const R = 6371; // Earth's radius in km

          const dLat = toRad(restaurant.latitude - userLat);
          const dLon = toRad(restaurant.longitude - userLng);

          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(userLat)) *
              Math.cos(toRad(restaurant.latitude)) *
              Math.sin(dLon / 2) *
              Math.sin(dLon / 2);

          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const distance = R * c; // Distance in km

          console.log(
            `Restaurant ${restaurant.name} at distance ${distance.toFixed(2)}km (limit: ${radius}km)${distance <= radius ? " ✓ INCLUDED" : " ✗ FILTERED OUT"}`
          );
          return distance <= radius;
        });

        console.log("Results after distance filter:", filteredResults.length);

        // Sort by distance if requested
        if (actualSortBy === "distance") {
          filteredResults.sort((a, b) => {
            const toRad = (value: number) => (value * Math.PI) / 180;
            const R = 6371;

            // Calculate distance A
            const dLatA = toRad((a.latitude || 0) - userLat);
            const dLonA = toRad((a.longitude || 0) - userLng);
            const aA =
              Math.sin(dLatA / 2) * Math.sin(dLatA / 2) +
              Math.cos(toRad(userLat)) *
                Math.cos(toRad(a.latitude || 0)) *
                Math.sin(dLonA / 2) *
                Math.sin(dLonA / 2);
            const cA = 2 * Math.atan2(Math.sqrt(aA), Math.sqrt(1 - aA));
            const distanceA = R * cA;

            // Calculate distance B
            const dLatB = toRad((b.latitude || 0) - userLat);
            const dLonB = toRad((b.longitude || 0) - userLng);
            const aB =
              Math.sin(dLatB / 2) * Math.sin(dLatB / 2) +
              Math.cos(toRad(userLat)) *
                Math.cos(toRad(b.latitude || 0)) *
                Math.sin(dLonB / 2) *
                Math.sin(dLonB / 2);
            const cB = 2 * Math.atan2(Math.sqrt(aB), Math.sqrt(1 - aB));
            const distanceB = R * cB;

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
          .where(and(inArray(deals.restaurantId, restaurantIds), eq(deals.status, "active")));
      }

      // Get bookmark status for authenticated users
      const userId = (req as Request & { userId?: string }).userId;
      let bookmarkedRestaurants: number[] = [];

      if (userId && restaurantIds.length > 0) {
        const bookmarks = await db
          .select({ restaurantId: userFavoriteRestaurants.restaurantId })
          .from(userFavoriteRestaurants)
          .where(
            and(
              eq(userFavoriteRestaurants.userId, userId),
              inArray(userFavoriteRestaurants.restaurantId, restaurantIds)
            )
          );

        bookmarkedRestaurants = bookmarks.map((b) => b.restaurantId);
      }

      // Map deals and bookmarks to restaurants
      const resultsWithDeals = filteredResults.map((restaurant) => {
        const restaurantDeals = dealsForRestaurants.filter(
          (deal) => deal.restaurantId === restaurant.id
        );

        return {
          ...restaurant,
          activeDeals: restaurantDeals,
          isBookmarked: bookmarkedRestaurants.includes(restaurant.id),
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
router.get("/restaurants/:restaurantId", optionalAuth, async (req: Request, res: Response) => {
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

      // Get bookmark status for authenticated users
      const userId = (req as Request & { userId?: string }).userId;
      let isBookmarked = false;

      if (userId) {
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

        isBookmarked = bookmark.length > 0;
      }

      return {
        restaurant: {
          ...restaurant[0],
          isBookmarked,
        },
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
