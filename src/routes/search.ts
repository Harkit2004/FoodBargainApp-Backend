import { Router } from "express";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { and, asc, desc, eq, inArray, sql, or, ilike, exists } from "drizzle-orm";
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
  userFavoriteDeals,
  users,
} from "../db/schema.js";
import { ResponseHelper, AuthHelper, ValidationHelper } from "../utils/api-helpers.js";

interface SearchRequest extends Request {
  userId?: string;
}

const router = Router();

// --- Types ---

type SearchSort = "relevance" | "rating" | "distance" | "newest";
type SortOrder = "asc" | "desc";

interface SearchResult {
  items: unknown[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalCount: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

interface SearchFilters {
  query?: string | undefined;
  showType: "all" | "restaurants" | "deals";
  cuisineIds: number[];
  dietaryIds: number[];
  latitude?: number | undefined;
  longitude?: number | undefined;
  distanceKm?: number | undefined;
  page: number;
  limit: number;
  sortBy: SearchSort;
  sortOrder: SortOrder;
  hasActiveDeals?: boolean;
}

// --- Helpers ---

const parseFilters = (req: Request): SearchFilters => {
  const query = (req.query.q || req.query.query)?.toString().trim() || undefined;
  const showType = (
    ["restaurants", "deals"].includes(req.query.showType as string) ? req.query.showType : "all"
  ) as SearchFilters["showType"];

  const parseIds = (param: unknown): number[] => {
    if (!param) return [];
    const arr = Array.isArray(param) ? param : [param];
    return arr
      .flatMap((x: unknown) => String(x).split(","))
      .map((x: string) => parseInt(x.trim()))
      .filter((x: number) => !isNaN(x));
  };

  const cuisineIds = parseIds(req.query.cuisineIds || req.query.cuisineId);
  const dietaryIds = parseIds(req.query.dietaryPreferenceIds || req.query.dietaryPreferenceId);

  const lat = req.query.latitude ? parseFloat(req.query.latitude as string) : undefined;
  const lng = req.query.longitude ? parseFloat(req.query.longitude as string) : undefined;
  const dist = req.query.distance || req.query.radius;
  const distanceKm = dist ? parseFloat(dist as string) : undefined;

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

  const sortBy = (
    ["rating", "distance", "newest"].includes(req.query.sortBy as string)
      ? req.query.sortBy
      : "relevance"
  ) as SearchSort;

  let sortOrder: SortOrder = "asc";
  if (req.query.sortOrder === "desc" || req.query.sortOrder === "asc") {
    sortOrder = req.query.sortOrder as SortOrder;
  } else if (sortBy === "rating" || sortBy === "newest" || sortBy === "relevance") {
    sortOrder = "desc";
  }

  return {
    query,
    showType,
    cuisineIds,
    dietaryIds,
    latitude: !isNaN(lat!) ? lat : undefined,
    longitude: !isNaN(lng!) ? lng : undefined,
    distanceKm: !isNaN(distanceKm!) ? distanceKm : undefined,
    page,
    limit,
    sortBy,
    sortOrder,
    hasActiveDeals: req.query.hasActiveDeals === "true",
  };
};

const getDistanceSql = (lat: number, lng: number, targetLat: unknown, targetLng: unknown) => {
  return sql<number>`
    6371 * acos(
      least(1, greatest(-1,
        cos(radians(${lat})) * cos(radians(${targetLat})) *
        cos(radians(${targetLng}) - radians(${lng})) +
        sin(radians(${lat})) * sin(radians(${targetLat}))
      ))
    )
  `;
};

// --- Search Logic ---

const searchRestaurants = async (filters: SearchFilters, userId?: string) => {
  const conditions = [eq(restaurants.isActive, true)];

  // Text Search
  if (filters.query) {
    const term = `%${filters.query}%`;
    conditions.push(
      or(
        ilike(restaurants.name, term),
        ilike(restaurants.description, term),
        ilike(partners.businessName, term)
      )!
    );
  }

  // Location Filter
  let distanceCol = sql<number | null>`NULL`;
  if (filters.latitude !== undefined && filters.longitude !== undefined) {
    distanceCol = getDistanceSql(
      filters.latitude,
      filters.longitude,
      restaurants.latitude,
      restaurants.longitude
    );
    if (filters.distanceKm) {
      conditions.push(sql`${distanceCol} <= ${filters.distanceKm}`);
    }
  }

  // Cuisine & Dietary Filters (via Active Deals)
  // If filters are present, we only show restaurants that have at least one active deal matching the criteria
  if (filters.cuisineIds.length > 0 || filters.dietaryIds.length > 0 || filters.hasActiveDeals) {
    const dealConditions = [eq(deals.restaurantId, restaurants.id), eq(deals.status, "active")];

    if (filters.cuisineIds.length > 0) {
      dealConditions.push(
        exists(
          db
            .select()
            .from(dealCuisines)
            .where(
              and(
                eq(dealCuisines.dealId, deals.id),
                inArray(dealCuisines.cuisineId, filters.cuisineIds)
              )
            )
        )
      );
    }

    if (filters.dietaryIds.length > 0) {
      dealConditions.push(
        exists(
          db
            .select()
            .from(dealDietaryPreferences)
            .where(
              and(
                eq(dealDietaryPreferences.dealId, deals.id),
                inArray(dealDietaryPreferences.dietaryPreferenceId, filters.dietaryIds)
              )
            )
        )
      );
    }

    conditions.push(
      exists(
        db
          .select()
          .from(deals)
          .where(and(...dealConditions))
      )
    );
  }

  // Sorting
  let orderBy;
  switch (filters.sortBy) {
    case "rating":
      orderBy =
        filters.sortOrder === "asc" ? asc(restaurants.ratingAvg) : desc(restaurants.ratingAvg);
      break;
    case "distance":
      orderBy = filters.sortOrder === "desc" ? desc(distanceCol) : asc(distanceCol);
      break;
    case "newest":
      orderBy =
        filters.sortOrder === "asc" ? asc(restaurants.createdAt) : desc(restaurants.createdAt);
      break;
    default: // relevance
      // If query exists, we could sort by similarity, but for now default to rating or distance
      orderBy = filters.latitude ? asc(distanceCol) : desc(restaurants.ratingAvg);
  }

  // Query
  const baseQuery = db
    .select({
      restaurant: restaurants,
      partnerName: partners.businessName,
      distance: distanceCol,
    })
    .from(restaurants)
    .innerJoin(partners, eq(restaurants.partnerId, partners.id))
    .where(and(...conditions));

  const totalCountRes = await db
    .select({ count: sql<number>`count(*)` })
    .from(baseQuery.as("subquery"));

  const totalCount = Number(totalCountRes[0]?.count || 0);
  const totalPages = Math.ceil(totalCount / filters.limit);

  const rows = await baseQuery
    .orderBy(orderBy)
    .limit(filters.limit)
    .offset((filters.page - 1) * filters.limit);

  // Hydrate with Active Deals & Bookmarks
  // We fetch active deals for the returned restaurants to display them in the card
  const restaurantIds = rows.map((r) => r.restaurant.id);
  const activeDealsMap = new Map<
    number,
    {
      id: number;
      title: string;
      description: string | null;
      cuisines: { id: number; name: string }[];
      dietaryPreferences: { id: number; name: string }[];
    }[]
  >();
  const bookmarkedIds = new Set<number>();

  if (restaurantIds.length > 0) {
    // Fetch Active Deals
    const activeDealsRows = await db
      .select({
        id: deals.id,
        title: deals.title,
        description: deals.description,
        restaurantId: deals.restaurantId,
      })
      .from(deals)
      .where(and(inArray(deals.restaurantId, restaurantIds), eq(deals.status, "active")))
      .limit(50);

    const dealIds = activeDealsRows.map((d) => d.id);

    // Fetch Cuisines for these deals
    const dealCuisinesRows =
      dealIds.length > 0
        ? await db
            .select({
              dealId: dealCuisines.dealId,
              id: cuisines.id,
              name: cuisines.name,
            })
            .from(dealCuisines)
            .innerJoin(cuisines, eq(dealCuisines.cuisineId, cuisines.id))
            .where(inArray(dealCuisines.dealId, dealIds))
        : [];

    // Fetch Dietary for these deals
    const dealDietaryRows =
      dealIds.length > 0
        ? await db
            .select({
              dealId: dealDietaryPreferences.dealId,
              id: dietaryPreferences.id,
              name: dietaryPreferences.name,
            })
            .from(dealDietaryPreferences)
            .innerJoin(
              dietaryPreferences,
              eq(dealDietaryPreferences.dietaryPreferenceId, dietaryPreferences.id)
            )
            .where(inArray(dealDietaryPreferences.dealId, dealIds))
        : [];

    // Map them
    const cuisinesMap = new Map<number, { id: number; name: string }[]>();
    dealCuisinesRows.forEach((r) => {
      if (!cuisinesMap.has(r.dealId)) cuisinesMap.set(r.dealId, []);
      cuisinesMap.get(r.dealId)?.push({ id: r.id, name: r.name });
    });

    const dietaryMap = new Map<number, { id: number; name: string }[]>();
    dealDietaryRows.forEach((r) => {
      if (!dietaryMap.has(r.dealId)) dietaryMap.set(r.dealId, []);
      dietaryMap.get(r.dealId)?.push({ id: r.id, name: r.name });
    });

    for (const d of activeDealsRows) {
      if (!activeDealsMap.has(d.restaurantId)) activeDealsMap.set(d.restaurantId, []);
      activeDealsMap.get(d.restaurantId)?.push({
        id: d.id,
        title: d.title,
        description: d.description,
        cuisines: cuisinesMap.get(d.id) || [],
        dietaryPreferences: dietaryMap.get(d.id) || [],
      });
    }

    // Fetch Bookmarks
    if (userId) {
      const bookmarks = await db
        .select({ id: userFavoriteRestaurants.restaurantId })
        .from(userFavoriteRestaurants)
        .where(
          and(
            eq(userFavoriteRestaurants.userId, userId),
            inArray(userFavoriteRestaurants.restaurantId, restaurantIds)
          )
        );
      bookmarks.forEach((b) => bookmarkedIds.add(b.id));
    }
  }

  return {
    items: rows.map((row) => ({
      ...row.restaurant,
      partner: { businessName: row.partnerName },
      distanceKm: row.distance,
      activeDeals: activeDealsMap.get(row.restaurant.id) || [],
      activeDealsCount: activeDealsMap.get(row.restaurant.id)?.length || 0,
      isBookmarked: bookmarkedIds.has(row.restaurant.id),
    })),
    pagination: {
      currentPage: filters.page,
      totalPages,
      totalCount,
      hasNextPage: filters.page < totalPages,
      hasPreviousPage: filters.page > 1,
    },
  };
};

const searchDeals = async (filters: SearchFilters, userId?: string) => {
  const conditions = [eq(deals.status, "active")];

  // Text Search
  if (filters.query) {
    const term = `%${filters.query}%`;
    conditions.push(
      or(ilike(deals.title, term), ilike(deals.description, term), ilike(restaurants.name, term))!
    );
  }

  // Location Filter
  let distanceCol = sql<number | null>`NULL`;
  if (filters.latitude !== undefined && filters.longitude !== undefined) {
    distanceCol = getDistanceSql(
      filters.latitude,
      filters.longitude,
      restaurants.latitude,
      restaurants.longitude
    );
    if (filters.distanceKm) {
      conditions.push(sql`${distanceCol} <= ${filters.distanceKm}`);
    }
  }

  // Cuisine Filter
  if (filters.cuisineIds.length > 0) {
    conditions.push(
      exists(
        db
          .select()
          .from(dealCuisines)
          .where(
            and(
              eq(dealCuisines.dealId, deals.id),
              inArray(dealCuisines.cuisineId, filters.cuisineIds)
            )
          )
      )
    );
  }

  // Dietary Filter
  if (filters.dietaryIds.length > 0) {
    conditions.push(
      exists(
        db
          .select()
          .from(dealDietaryPreferences)
          .where(
            and(
              eq(dealDietaryPreferences.dealId, deals.id),
              inArray(dealDietaryPreferences.dietaryPreferenceId, filters.dietaryIds)
            )
          )
      )
    );
  }

  // Sorting
  let orderBy;
  switch (filters.sortBy) {
    case "distance":
      orderBy = filters.sortOrder === "desc" ? desc(distanceCol) : asc(distanceCol);
      break;
    case "newest":
      orderBy = filters.sortOrder === "asc" ? asc(deals.createdAt) : desc(deals.createdAt);
      break;
    default: // relevance or rating (deals don't have rating, use restaurant rating or created at)
      orderBy = filters.latitude ? asc(distanceCol) : desc(deals.createdAt);
  }

  // Query
  const baseQuery = db
    .select({
      deal: deals,
      restaurant: restaurants,
      partnerName: partners.businessName,
      distance: distanceCol,
    })
    .from(deals)
    .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
    .innerJoin(partners, eq(deals.partnerId, partners.id))
    .where(and(...conditions));

  const totalCountRes = await db
    .select({ count: sql<number>`count(*)` })
    .from(baseQuery.as("subquery"));

  const totalCount = Number(totalCountRes[0]?.count || 0);
  const totalPages = Math.ceil(totalCount / filters.limit);

  const rows = await baseQuery
    .orderBy(orderBy)
    .limit(filters.limit)
    .offset((filters.page - 1) * filters.limit);

  // Hydrate Cuisines, Dietary & Bookmarks
  const dealIds = rows.map((r) => r.deal.id);
  const cuisinesMap = new Map<number, { id: number; name: string }[]>();
  const dietaryMap = new Map<number, { id: number; name: string }[]>();
  const bookmarkedIds = new Set<number>();

  if (dealIds.length > 0) {
    // Fetch Cuisines
    const cRows = await db
      .select({ dealId: dealCuisines.dealId, id: cuisines.id, name: cuisines.name })
      .from(dealCuisines)
      .innerJoin(cuisines, eq(dealCuisines.cuisineId, cuisines.id))
      .where(inArray(dealCuisines.dealId, dealIds));

    cRows.forEach((r) => {
      if (!cuisinesMap.has(r.dealId)) cuisinesMap.set(r.dealId, []);
      cuisinesMap.get(r.dealId)?.push({ id: r.id, name: r.name });
    });

    // Fetch Dietary
    const dRows = await db
      .select({
        dealId: dealDietaryPreferences.dealId,
        id: dietaryPreferences.id,
        name: dietaryPreferences.name,
      })
      .from(dealDietaryPreferences)
      .innerJoin(
        dietaryPreferences,
        eq(dealDietaryPreferences.dietaryPreferenceId, dietaryPreferences.id)
      )
      .where(inArray(dealDietaryPreferences.dealId, dealIds));

    dRows.forEach((r) => {
      if (!dietaryMap.has(r.dealId)) dietaryMap.set(r.dealId, []);
      dietaryMap.get(r.dealId)?.push({ id: r.id, name: r.name });
    });

    // Fetch Bookmarks
    if (userId) {
      const bookmarks = await db
        .select({ id: userFavoriteDeals.dealId })
        .from(userFavoriteDeals)
        .where(
          and(eq(userFavoriteDeals.userId, userId), inArray(userFavoriteDeals.dealId, dealIds))
        );
      bookmarks.forEach((b) => bookmarkedIds.add(b.id));
    }
  }

  return {
    items: rows.map((row) => ({
      ...row.deal,
      restaurant: {
        ...row.restaurant,
        ratingAvg: row.restaurant.ratingAvg, // Ensure string/number consistency if needed
      },
      partner: { id: row.deal.partnerId, businessName: row.partnerName },
      distanceKm: row.distance,
      cuisines: cuisinesMap.get(row.deal.id) || [],
      dietaryPreferences: dietaryMap.get(row.deal.id) || [],
      isBookmarked: bookmarkedIds.has(row.deal.id),
    })),
    pagination: {
      currentPage: filters.page,
      totalPages,
      totalCount,
      hasNextPage: filters.page < totalPages,
      hasPreviousPage: filters.page > 1,
    },
  };
};

// --- Routes ---

// Optional Auth Middleware
const optionalAuth = async (req: Request, res: Response, next: () => void) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const { verifyToken } = await import("@clerk/backend");
      const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY! });
      if (payload.sub) {
        const user = await db
          .select()
          .from(users)
          .where(eq(users.clerkUserId, payload.sub))
          .limit(1);
        if (user[0]) (req as SearchRequest).userId = user[0].id;
      }
    }
  } catch {
    /* ignore invalid tokens for optional auth */
  }
  next();
};

router.get("/", optionalAuth, async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req);
    const userId = (req as SearchRequest).userId;

    const [restaurantsRes, dealsRes] = await Promise.all([
      filters.showType !== "deals"
        ? searchRestaurants(filters, userId)
        : { items: [], pagination: { totalCount: 0 } },
      filters.showType !== "restaurants"
        ? searchDeals(filters, userId)
        : { items: [], pagination: { totalCount: 0 } },
    ]);

    ResponseHelper.success(res, {
      restaurants: restaurantsRes.items,
      deals: dealsRes.items,
      pagination: {
        restaurants: (restaurantsRes as SearchResult).pagination,
        deals: (dealsRes as SearchResult).pagination,
      },
      filtersApplied: filters,
    });
  } catch (error) {
    console.error("Search error:", error);
    ResponseHelper.internalError(res, "Search failed");
  }
});

router.get("/restaurants", optionalAuth, async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req);
    filters.showType = "restaurants";
    const userId = (req as SearchRequest).userId;

    const result = await searchRestaurants(filters, userId);
    ResponseHelper.success(res, {
      restaurants: result.items,
      pagination: result.pagination,
      searchParams: filters,
    });
  } catch (error) {
    console.error("Restaurant search error:", error);
    ResponseHelper.internalError(res, "Search failed");
  }
});

router.get("/restaurants/:restaurantId", optionalAuth, async (req: Request, res: Response) => {
  const restaurantId = ValidationHelper.parseId(req.params.restaurantId as string);
  if (!restaurantId) return ResponseHelper.badRequest(res, "Invalid ID");

  try {
    const restaurantRows = await db
      .select({
        restaurant: restaurants,
        partnerName: partners.businessName,
      })
      .from(restaurants)
      .innerJoin(partners, eq(restaurants.partnerId, partners.id))
      .where(eq(restaurants.id, restaurantId))
      .limit(1);

    if (restaurantRows.length === 0) return ResponseHelper.error(res, "Restaurant not found", 404);

    const row = restaurantRows[0]!;
    const restaurant = {
      ...row.restaurant,
      partner: { businessName: row.partnerName },
    };

    const activeDealsRows = await db
      .select()
      .from(deals)
      .where(and(eq(deals.restaurantId, restaurantId), eq(deals.status, "active")))
      .orderBy(desc(deals.createdAt));

    const userId = AuthHelper.getOptionalAuth(req as AuthenticatedRequest);
    let isBookmarked = false;
    if (userId) {
      const b = await db
        .select()
        .from(userFavoriteRestaurants)
        .where(
          and(
            eq(userFavoriteRestaurants.userId, userId),
            eq(userFavoriteRestaurants.restaurantId, restaurantId)
          )
        );
      isBookmarked = b.length > 0;
    }

    ResponseHelper.success(res, {
      restaurant: { ...restaurant, isBookmarked },
      activeDeals: activeDealsRows,
    });
  } catch (error) {
    console.error("Restaurant detail error:", error);
    ResponseHelper.internalError(res, "Failed to fetch details");
  }
});

router.get("/restaurants/:restaurantId/bookmark-status", async (req: Request, res: Response) => {
  const userId = AuthHelper.requireAuth(req, res);
  if (!userId) return;
  const restaurantId = ValidationHelper.parseId(req.params.restaurantId as string);
  if (!restaurantId) return ResponseHelper.badRequest(res, "Invalid ID");

  try {
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

    const b = bookmark[0];

    ResponseHelper.success(res, {
      restaurantId,
      isBookmarked: !!b,
      notifyOnDeal: b?.notifyOnDeal ?? false,
      bookmarkedAt: b?.createdAt ?? null,
    });
  } catch {
    ResponseHelper.internalError(res, "Error checking bookmark");
  }
});

export default router;
