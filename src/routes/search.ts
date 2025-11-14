import { Router } from "express";
import type { Request, Response } from "express";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
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

type ShowType = "all" | "restaurants" | "deals";
type SearchSort = "relevance" | "rating" | "distance";

type RawSearchFilters = {
  query: string | null;
  showType: ShowType;
  cuisineIds: number[];
  cuisineNames: string[];
  dietaryPreferenceIds: number[];
  dietaryPreferenceNames: string[];
  distanceKm: number | null;
  latitude: number | null;
  longitude: number | null;
  page: number;
  limit: number;
  sortBy: SearchSort;
  sortOrder: "asc" | "desc";
  hasActiveDeals: boolean;
};

type SearchFilters = Omit<RawSearchFilters, "cuisineNames" | "dietaryPreferenceNames">;

type SearchPagination = {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

type SearchResult<T> = {
  items: T[];
  pagination: SearchPagination;
};

type RestaurantSearchRow = {
  id: number;
  name: string;
  imageUrl: string | null;
  description: string | null;
  streetAddress: string | null;
  city: string | null;
  province: string | null;
  latitude: number | null;
  longitude: number | null;
  ratingAvg: string | null;
  ratingCount: number | null;
  openingTime: string | null;
  closingTime: string | null;
  createdAt: Date | null;
  partner: {
    businessName: string;
  };
  distanceKm: number | null;
  activeDeals: Array<{
    id: number;
    title: string;
    description: string | null;
    restaurantId: number;
    cuisines: Array<{ id: number; name: string }>;
    dietaryPreferences: Array<{ id: number; name: string }>;
  }>;
  activeDealsCount: number;
  isBookmarked: boolean;
};

type DealSearchRow = {
  id: number;
  title: string;
  description: string | null;
  status: "draft" | "active" | "expired" | "archived";
  startDate: string;
  endDate: string;
  createdAt: Date | null;
  restaurant: {
    id: number;
    name: string;
    imageUrl: string | null;
    streetAddress: string | null;
    city: string | null;
    province: string | null;
    latitude: number | null;
    longitude: number | null;
    ratingAvg: string | null;
    ratingCount: number | null;
  };
  partner: {
    id: number;
    businessName: string;
  };
  cuisines: Array<{ id: number; name: string }>;
  dietaryPreferences: Array<{ id: number; name: string }>;
  isBookmarked: boolean;
  distanceKm: number | null;
};

type RestaurantSearchResult = SearchResult<RestaurantSearchRow>;
type DealSearchResult = SearchResult<DealSearchRow>;

const parseNumberArrayParam = (value: unknown): number[] => {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  const numbers = values
    .flatMap((entry) => String(entry).split(","))
    .map((segment) => parseInt(segment.trim(), 10))
    .filter((num) => !Number.isNaN(num));

  return [...new Set(numbers)];
};

const parseStringArrayParam = (value: unknown): string[] => {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  const strings = values
    .flatMap((entry) => String(entry).split(","))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return [...new Set(strings)];
};

const parseSearchFilters = (req: Request): RawSearchFilters => {
  const queryParam = typeof req.query.q === "string" ? req.query.q : req.query.query;
  const query =
    typeof queryParam === "string" && queryParam.trim().length > 0 ? queryParam.trim() : null;

  const showTypeRaw = (req.query.showType || req.query.entityType || req.query.type) as
    | string
    | undefined;
  const showType: ShowType =
    showTypeRaw === "restaurants" || showTypeRaw === "deals" ? showTypeRaw : "all";

  const distanceParam = req.query.distance ?? req.query.radius ?? null;
  const parsedDistance = typeof distanceParam === "string" ? parseFloat(distanceParam) : null;
  const distanceKm =
    parsedDistance !== null && !Number.isNaN(parsedDistance) && parsedDistance > 0
      ? parsedDistance
      : null;

  const latitudeParam =
    typeof req.query.latitude === "string" ? parseFloat(req.query.latitude) : null;
  const latitude = latitudeParam !== null && !Number.isNaN(latitudeParam) ? latitudeParam : null;

  const longitudeParam =
    typeof req.query.longitude === "string" ? parseFloat(req.query.longitude) : null;
  const longitude =
    longitudeParam !== null && !Number.isNaN(longitudeParam) ? longitudeParam : null;

  const pageParam = typeof req.query.page === "string" ? parseInt(req.query.page, 10) : 1;
  const page = !Number.isNaN(pageParam) && pageParam > 0 ? pageParam : 1;

  const limitParam = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 20;
  const limit = Math.min(Math.max(1, Number.isNaN(limitParam) ? 20 : limitParam), 100);

  const sortByRaw = typeof req.query.sortBy === "string" ? req.query.sortBy : "relevance";
  const sortBy: SearchSort =
    sortByRaw === "rating" || sortByRaw === "distance" ? sortByRaw : "relevance";

  const sortOrderRaw = typeof req.query.sortOrder === "string" ? req.query.sortOrder : undefined;
  let sortOrder: "asc" | "desc";
  if (sortOrderRaw === "desc" || sortOrderRaw === "asc") {
    sortOrder = sortOrderRaw;
  } else if (sortBy === "rating" || sortBy === "relevance") {
    sortOrder = "desc";
  } else {
    sortOrder = "asc";
  }

  const cuisineIds = [
    ...parseNumberArrayParam(req.query.cuisineIds),
    ...parseNumberArrayParam(req.query.cuisineId),
  ];
  const dietaryPreferenceIds = [
    ...parseNumberArrayParam(req.query.dietaryPreferenceIds),
    ...parseNumberArrayParam(req.query.dietaryPreferenceId),
  ];

  const cuisineNames = parseStringArrayParam(req.query.cuisine || req.query.cuisines);
  const dietaryPreferenceNames = parseStringArrayParam(
    req.query.dietaryPreference || req.query.dietaryPreferences
  );

  const hasActiveDeals = req.query.hasActiveDeals === "true";

  return {
    query,
    showType,
    cuisineIds,
    cuisineNames,
    dietaryPreferenceIds,
    dietaryPreferenceNames,
    distanceKm,
    latitude,
    longitude,
    page,
    limit,
    sortBy,
    sortOrder,
    hasActiveDeals,
  };
};

const hydrateSearchFilters = async (filters: RawSearchFilters): Promise<SearchFilters> => {
  let cuisineIds = filters.cuisineIds;
  if (cuisineIds.length === 0 && filters.cuisineNames.length > 0) {
    const cuisineRows = await db
      .select({ id: cuisines.id })
      .from(cuisines)
      .where(inArray(cuisines.name, filters.cuisineNames));
    cuisineIds = cuisineRows.map((row) => row.id);
  }

  let dietaryIds = filters.dietaryPreferenceIds;
  if (dietaryIds.length === 0 && filters.dietaryPreferenceNames.length > 0) {
    const dietaryRows = await db
      .select({ id: dietaryPreferences.id })
      .from(dietaryPreferences)
      .where(inArray(dietaryPreferences.name, filters.dietaryPreferenceNames));
    dietaryIds = dietaryRows.map((row) => row.id);
  }

  return {
    query: filters.query,
    showType: filters.showType,
    cuisineIds,
    dietaryPreferenceIds: dietaryIds,
    distanceKm: filters.distanceKm,
    latitude: filters.latitude,
    longitude: filters.longitude,
    page: filters.page,
    limit: filters.limit,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    hasActiveDeals: filters.hasActiveDeals,
  };
};

const buildDistanceExpression = (
  latitudeColumn: typeof restaurants.latitude,
  longitudeColumn: typeof restaurants.longitude,
  latitude: number | null,
  longitude: number | null
) => {
  if (latitude === null || longitude === null) {
    return null;
  }

  return sql<number>`
    6371 * acos(
      least(
        1,
        greatest(
          -1,
          cos(radians(${latitude})) * cos(radians(${latitudeColumn})) *
          cos(radians(${longitudeColumn}) - radians(${longitude})) +
          sin(radians(${latitude})) * sin(radians(${latitudeColumn}))
        )
      )
    )
  `;
};

const intersectIds = (current: number[] | null, next: number[]): number[] | null => {
  if (current === null) {
    return [...new Set(next)];
  }

  const nextSet = new Set(next);
  return current.filter((id) => nextSet.has(id));
};

const createEmptyResult = <T>(filters: SearchFilters): SearchResult<T> => ({
  items: [],
  pagination: {
    currentPage: filters.page,
    totalPages: 1,
    totalCount: 0,
    hasNextPage: false,
    hasPreviousPage: filters.page > 1,
  },
});

const getRestaurantSearchResults = async (
  filters: SearchFilters,
  userId?: string
): Promise<RestaurantSearchResult> => {
  let filteredRestaurantIds: number[] | null = null;

  if (filters.hasActiveDeals) {
    const activeRestaurants = await db
      .selectDistinct({ restaurantId: deals.restaurantId })
      .from(deals)
      .where(eq(deals.status, "active"));
    filteredRestaurantIds = intersectIds(
      filteredRestaurantIds,
      activeRestaurants.map((row) => row.restaurantId)
    );
    if (!filteredRestaurantIds || filteredRestaurantIds.length === 0) {
      return createEmptyResult(filters);
    }
  }

  const whereConditions: import("drizzle-orm").SQLWrapper[] = [eq(restaurants.isActive, true)];

  if (filters.query) {
    const term = `%${filters.query}%`;
    whereConditions.push(
      sql`(${restaurants.name} ILIKE ${term} OR ${partners.businessName} ILIKE ${term} OR COALESCE(${restaurants.description}, '') ILIKE ${term})`
    );
  }

  if (filteredRestaurantIds && filteredRestaurantIds.length > 0) {
    whereConditions.push(inArray(restaurants.id, filteredRestaurantIds));
  }

  const distanceExpr = buildDistanceExpression(
    restaurants.latitude,
    restaurants.longitude,
    filters.latitude,
    filters.longitude
  );

  const offset = (filters.page - 1) * filters.limit;

  let orderByClause;
  if (filters.sortBy === "rating") {
    orderByClause =
      filters.sortOrder === "asc" ? asc(restaurants.ratingAvg) : desc(restaurants.ratingAvg);
  } else if (filters.sortBy === "distance" && distanceExpr) {
    orderByClause = filters.sortOrder === "desc" ? desc(distanceExpr) : asc(distanceExpr);
  } else {
    orderByClause =
      filters.sortOrder === "asc" ? asc(restaurants.createdAt) : desc(restaurants.createdAt);
  }

  const selection = {
    id: restaurants.id,
    name: restaurants.name,
    imageUrl: restaurants.imageUrl,
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
    distanceKm: distanceExpr ?? sql<number | null>`NULL`,
  };

  const restaurantQuery = db
    .select(selection)
    .from(restaurants)
    .innerJoin(partners, eq(restaurants.partnerId, partners.id))
    .where(and(...whereConditions))
    .orderBy(orderByClause)
    .limit(filters.limit)
    .offset(offset);

  const totalCountQuery = db
    .select({ count: sql<number>`count(*)` })
    .from(restaurants)
    .innerJoin(partners, eq(restaurants.partnerId, partners.id))
    .where(and(...whereConditions));

  const [restaurantRows, totalCountResult] = await Promise.all([restaurantQuery, totalCountQuery]);
  const totalCount = totalCountResult[0]?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / filters.limit));

  const restaurantIds = restaurantRows.map((row) => row.id);

  const activeDealsMap = new Map<
    number,
    Array<{
      id: number;
      title: string;
      description: string | null;
      restaurantId: number;
      cuisines: Array<{ id: number; name: string }>;
      dietaryPreferences: Array<{ id: number; name: string }>;
    }>
  >();
  let bookmarkedRestaurantIds: number[] = [];
  if (restaurantIds.length > 0) {
    const activeDealsPromise = db
      .select({
        id: deals.id,
        title: deals.title,
        description: deals.description,
        restaurantId: deals.restaurantId,
      })
      .from(deals)
      .where(and(inArray(deals.restaurantId, restaurantIds), eq(deals.status, "active")));

    const bookmarksPromise = userId
      ? db
          .select({ restaurantId: userFavoriteRestaurants.restaurantId })
          .from(userFavoriteRestaurants)
          .where(
            and(
              eq(userFavoriteRestaurants.userId, userId),
              inArray(userFavoriteRestaurants.restaurantId, restaurantIds)
            )
          )
      : Promise.resolve([]);

    const [activeDealsRows, bookmarks] = await Promise.all([activeDealsPromise, bookmarksPromise]);
    bookmarkedRestaurantIds = bookmarks.map((bookmark) => bookmark.restaurantId);

    const activeDealIds = activeDealsRows.map((dealRow) => dealRow.id);

    const cuisinesByDeal = new Map<number, Array<{ id: number; name: string }>>();
    const dietaryByDeal = new Map<number, Array<{ id: number; name: string }>>();

    if (activeDealIds.length > 0) {
      const cuisineQuery = db
        .select({
          dealId: dealCuisines.dealId,
          id: cuisines.id,
          name: cuisines.name,
        })
        .from(dealCuisines)
        .innerJoin(cuisines, eq(dealCuisines.cuisineId, cuisines.id))
        .where(inArray(dealCuisines.dealId, activeDealIds));

      const dietaryQuery = db
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
        .where(inArray(dealDietaryPreferences.dealId, activeDealIds));

      const [cuisineRows, dietaryRows] = await Promise.all([cuisineQuery, dietaryQuery]);

      cuisineRows.forEach((row) => {
        if (!cuisinesByDeal.has(row.dealId)) {
          cuisinesByDeal.set(row.dealId, []);
        }
        cuisinesByDeal.get(row.dealId)!.push({ id: row.id, name: row.name });
      });

      dietaryRows.forEach((row) => {
        if (!dietaryByDeal.has(row.dealId)) {
          dietaryByDeal.set(row.dealId, []);
        }
        dietaryByDeal.get(row.dealId)!.push({ id: row.id, name: row.name });
      });
    }

    activeDealsRows.forEach((dealRow) => {
      if (!activeDealsMap.has(dealRow.restaurantId)) {
        activeDealsMap.set(dealRow.restaurantId, []);
      }
      activeDealsMap.get(dealRow.restaurantId)!.push({
        ...dealRow,
        cuisines: cuisinesByDeal.get(dealRow.id) ?? [],
        dietaryPreferences: dietaryByDeal.get(dealRow.id) ?? [],
      });
    });
  }

  return {
    items: restaurantRows.map((row) => ({
      ...row,
      activeDeals: activeDealsMap.get(row.id) ?? [],
      activeDealsCount: activeDealsMap.get(row.id)?.length ?? 0,
      isBookmarked: bookmarkedRestaurantIds.includes(row.id),
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

const getDealSearchResults = async (
  filters: SearchFilters,
  userId?: string
): Promise<DealSearchResult> => {
  let filteredDealIds: number[] | null = null;

  if (filters.cuisineIds.length > 0) {
    const cuisineMatches = await db
      .selectDistinct({ dealId: dealCuisines.dealId })
      .from(dealCuisines)
      .where(inArray(dealCuisines.cuisineId, filters.cuisineIds));
    filteredDealIds = intersectIds(
      filteredDealIds,
      cuisineMatches.map((row) => row.dealId)
    );
    if (!filteredDealIds || filteredDealIds.length === 0) {
      return createEmptyResult(filters);
    }
  }

  if (filters.dietaryPreferenceIds.length > 0) {
    const dietaryMatches = await db
      .selectDistinct({ dealId: dealDietaryPreferences.dealId })
      .from(dealDietaryPreferences)
      .where(inArray(dealDietaryPreferences.dietaryPreferenceId, filters.dietaryPreferenceIds));
    filteredDealIds = intersectIds(
      filteredDealIds,
      dietaryMatches.map((row) => row.dealId)
    );
    if (!filteredDealIds || filteredDealIds.length === 0) {
      return createEmptyResult(filters);
    }
  }

  const whereConditions: import("drizzle-orm").SQLWrapper[] = [eq(deals.status, "active")];

  if (filters.query) {
    const term = `%${filters.query}%`;
    whereConditions.push(
      sql`(${deals.title} ILIKE ${term} OR COALESCE(${deals.description}, '') ILIKE ${term} OR ${restaurants.name} ILIKE ${term})`
    );
  }

  if (filteredDealIds && filteredDealIds.length > 0) {
    whereConditions.push(inArray(deals.id, filteredDealIds));
  }

  const distanceExpr = buildDistanceExpression(
    restaurants.latitude,
    restaurants.longitude,
    filters.latitude,
    filters.longitude
  );

  if (distanceExpr && filters.distanceKm !== null) {
    whereConditions.push(isNotNull(restaurants.latitude));
    whereConditions.push(isNotNull(restaurants.longitude));
    whereConditions.push(sql`${distanceExpr} <= ${filters.distanceKm}`);
  }

  const offset = (filters.page - 1) * filters.limit;

  let orderByClause;
  if (filters.sortBy === "rating") {
    orderByClause =
      filters.sortOrder === "asc" ? asc(restaurants.ratingAvg) : desc(restaurants.ratingAvg);
  } else if (filters.sortBy === "distance" && distanceExpr) {
    orderByClause = filters.sortOrder === "desc" ? desc(distanceExpr) : asc(distanceExpr);
  } else {
    orderByClause = filters.sortOrder === "asc" ? asc(deals.createdAt) : desc(deals.createdAt);
  }

  const selection = {
    id: deals.id,
    title: deals.title,
    description: deals.description,
    status: deals.status,
    startDate: deals.startDate,
    endDate: deals.endDate,
    createdAt: deals.createdAt,
    restaurant: {
      id: restaurants.id,
      name: restaurants.name,
      imageUrl: restaurants.imageUrl,
      streetAddress: restaurants.streetAddress,
      city: restaurants.city,
      province: restaurants.province,
      latitude: restaurants.latitude,
      longitude: restaurants.longitude,
      ratingAvg: restaurants.ratingAvg,
      ratingCount: restaurants.ratingCount,
    },
    partner: {
      id: partners.id,
      businessName: partners.businessName,
    },
    distanceKm: distanceExpr ?? sql<number | null>`NULL`,
  };

  const dealQuery = db
    .select(selection)
    .from(deals)
    .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
    .innerJoin(partners, eq(deals.partnerId, partners.id))
    .where(and(...whereConditions))
    .orderBy(orderByClause)
    .limit(filters.limit)
    .offset(offset);

  const dealCountQuery = db
    .select({ count: sql<number>`count(*)` })
    .from(deals)
    .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
    .where(and(...whereConditions));

  const [dealRows, totalCountResult] = await Promise.all([dealQuery, dealCountQuery]);
  const totalCount = totalCountResult[0]?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / filters.limit));

  const dealIds = dealRows.map((deal) => deal.id);

  const cuisinesByDeal = new Map<number, Array<{ id: number; name: string }>>();
  const dietaryByDeal = new Map<number, Array<{ id: number; name: string }>>();

  let bookmarkedDealIds: number[] = [];
  if (dealIds.length > 0) {
    const cuisineQuery = db
      .select({
        dealId: dealCuisines.dealId,
        cuisineId: cuisines.id,
        cuisineName: cuisines.name,
      })
      .from(dealCuisines)
      .innerJoin(cuisines, eq(dealCuisines.cuisineId, cuisines.id))
      .where(inArray(dealCuisines.dealId, dealIds));

    const dietaryQuery = db
      .select({
        dealId: dealDietaryPreferences.dealId,
        dietaryId: dietaryPreferences.id,
        dietaryName: dietaryPreferences.name,
      })
      .from(dealDietaryPreferences)
      .innerJoin(
        dietaryPreferences,
        eq(dealDietaryPreferences.dietaryPreferenceId, dietaryPreferences.id)
      )
      .where(inArray(dealDietaryPreferences.dealId, dealIds));

    const favoritesPromise = userId
      ? db
          .select({ dealId: userFavoriteDeals.dealId })
          .from(userFavoriteDeals)
          .where(
            and(eq(userFavoriteDeals.userId, userId), inArray(userFavoriteDeals.dealId, dealIds))
          )
      : Promise.resolve([]);

    const [cuisineRows, dietaryRows, favorites] = await Promise.all([
      cuisineQuery,
      dietaryQuery,
      favoritesPromise,
    ]);

    cuisineRows.forEach((row) => {
      if (!cuisinesByDeal.has(row.dealId)) {
        cuisinesByDeal.set(row.dealId, []);
      }
      cuisinesByDeal.get(row.dealId)!.push({ id: row.cuisineId, name: row.cuisineName });
    });

    dietaryRows.forEach((row) => {
      if (!dietaryByDeal.has(row.dealId)) {
        dietaryByDeal.set(row.dealId, []);
      }
      dietaryByDeal.get(row.dealId)!.push({ id: row.dietaryId, name: row.dietaryName });
    });

    bookmarkedDealIds = favorites.map((favorite) => favorite.dealId);
  }

  return {
    items: dealRows.map((deal) => ({
      ...deal,
      cuisines: cuisinesByDeal.get(deal.id) ?? [],
      dietaryPreferences: dietaryByDeal.get(deal.id) ?? [],
      isBookmarked: bookmarkedDealIds.includes(deal.id),
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

router.get("/", optionalAuth, async (req: Request, res: Response) => {
  const rawFilters = parseSearchFilters(req);

  if ((rawFilters.latitude === null) !== (rawFilters.longitude === null)) {
    return ResponseHelper.badRequest(
      res,
      "Both latitude and longitude are required for location-based search"
    );
  }

  if (rawFilters.latitude !== null && (rawFilters.latitude < -90 || rawFilters.latitude > 90)) {
    return ResponseHelper.badRequest(res, "Latitude must be between -90 and 90");
  }

  if (
    rawFilters.longitude !== null &&
    (rawFilters.longitude < -180 || rawFilters.longitude > 180)
  ) {
    return ResponseHelper.badRequest(res, "Longitude must be between -180 and 180");
  }

  if (rawFilters.distanceKm !== null && rawFilters.latitude === null) {
    return ResponseHelper.badRequest(
      res,
      "Distance filtering requires both latitude and longitude"
    );
  }

  const filters = await hydrateSearchFilters(rawFilters);
  const userId = (req as Request & { userId?: string }).userId;

  const includeRestaurants = filters.showType !== "deals";
  const includeDeals = filters.showType !== "restaurants";

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      const [restaurantResult, dealResult] = await Promise.all([
        includeRestaurants
          ? getRestaurantSearchResults(filters, userId)
          : Promise.resolve(createEmptyResult(filters)),
        includeDeals
          ? getDealSearchResults(filters, userId)
          : Promise.resolve(createEmptyResult(filters)),
      ]);

      return {
        restaurants: restaurantResult.items,
        deals: dealResult.items,
        pagination: {
          restaurants: restaurantResult.pagination,
          deals: dealResult.pagination,
        },
        filtersApplied: {
          query: filters.query,
          showType: filters.showType,
          cuisineIds: filters.cuisineIds,
          dietaryPreferenceIds: filters.dietaryPreferenceIds,
          latitude: filters.latitude,
          longitude: filters.longitude,
          distanceKm: filters.distanceKm,
          sortBy: filters.sortBy,
          sortOrder: filters.sortOrder,
        },
      };
    },
    res,
    "Failed to search"
  );

  if (result) {
    ResponseHelper.success(res, result);
  }
});

router.get("/restaurants", optionalAuth, async (req: Request, res: Response) => {
  const rawFilters = parseSearchFilters(req);
  rawFilters.showType = "restaurants";

  if ((rawFilters.latitude === null) !== (rawFilters.longitude === null)) {
    return ResponseHelper.badRequest(
      res,
      "Both latitude and longitude are required for location-based search"
    );
  }

  if (rawFilters.latitude !== null && (rawFilters.latitude < -90 || rawFilters.latitude > 90)) {
    return ResponseHelper.badRequest(res, "Latitude must be between -90 and 90");
  }

  if (
    rawFilters.longitude !== null &&
    (rawFilters.longitude < -180 || rawFilters.longitude > 180)
  ) {
    return ResponseHelper.badRequest(res, "Longitude must be between -180 and 180");
  }

  if (rawFilters.distanceKm !== null && rawFilters.latitude === null) {
    return ResponseHelper.badRequest(
      res,
      "Distance filtering requires both latitude and longitude"
    );
  }

  const filters = await hydrateSearchFilters(rawFilters);
  const userId = (req as Request & { userId?: string }).userId;

  const result = await DbHelper.executeWithErrorHandling(
    async () => {
      const restaurantResult = await getRestaurantSearchResults(filters, userId);

      return {
        restaurants: restaurantResult.items,
        searchParams: {
          query: filters.query,
          cuisineIds: filters.cuisineIds,
          dietaryPreferenceIds: filters.dietaryPreferenceIds,
          location:
            filters.latitude !== null && filters.longitude !== null
              ? {
                  latitude: filters.latitude,
                  longitude: filters.longitude,
                  radius: filters.distanceKm,
                }
              : null,
          sortBy: filters.sortBy,
          sortOrder: filters.sortOrder,
        },
        pagination: restaurantResult.pagination,
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
          imageUrl: restaurants.imageUrl,
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
