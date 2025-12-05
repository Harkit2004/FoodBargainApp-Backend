import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  bigint,
  text,
  decimal,
  integer,
  doublePrecision,
  time,
  boolean,
  date,
  smallint,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// Enums
export const dealStatusEnum = pgEnum("deal_status", ["draft", "active", "expired", "archived"]);
export const ratingTargetTypeEnum = pgEnum("rating_target_type", [
  "restaurant",
  "menu_item",
  "deal",
]);

// 1. Users table
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: varchar("clerk_user_id").notNull().unique(),
  email: varchar("email").unique(),
  displayName: varchar("display_name").notNull(),
  phone: varchar("phone"),
  location: varchar("location").notNull(),
  isAdmin: boolean("is_admin").default(false).notNull(),
  isBanned: boolean("is_banned").default(false).notNull(),
  banReason: text("ban_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 2. Partners table
export const partners = pgTable(
  "partners",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id),
    businessName: varchar("business_name").notNull(),
    streetAddress: varchar("street_address"),
    city: varchar("city"),
    province: varchar("province"),
    postalCode: varchar("postal_code"),
    phone: varchar("phone"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_partners_business_name_trgm").using("gin", sql`${table.businessName} gin_trgm_ops`),
  ]
);

// 3. Restaurants table
export const restaurants = pgTable(
  "restaurants",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    partnerId: bigint("partner_id", { mode: "number" }).references(() => partners.id),
    name: varchar("name").notNull(),
    description: text("description"),
    streetAddress: varchar("street_address"),
    city: varchar("city"),
    province: varchar("province"),
    postalCode: varchar("postal_code"),
    phone: varchar("phone"),
    imageUrl: varchar("image_url"),
    ratingAvg: decimal("rating_avg", { precision: 3, scale: 2 }).default("0.0"),
    ratingCount: integer("rating_count").default(0),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    openingTime: time("opening_time"),
    closingTime: time("closing_time"),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_restaurants_name_trgm").using("gin", sql`${table.name} gin_trgm_ops`),
    index("idx_restaurants_description_trgm").using("gin", sql`${table.description} gin_trgm_ops`),
    index("idx_restaurants_active_created_at").on(table.isActive, table.createdAt),
    index("idx_restaurants_location").on(table.latitude, table.longitude),
  ]
);

// 4. Menu sections table
export const menuSections = pgTable("menu_sections", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  restaurantId: bigint("restaurant_id", { mode: "number" })
    .notNull()
    .references(() => restaurants.id),
  title: varchar("title").notNull(),
  position: integer("position").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 5. Menu items table
export const menuItems = pgTable("menu_items", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  sectionId: bigint("section_id", { mode: "number" })
    .notNull()
    .references(() => menuSections.id),
  restaurantId: bigint("restaurant_id", { mode: "number" })
    .notNull()
    .references(() => restaurants.id),
  name: varchar("name").notNull(),
  description: text("description"),
  priceCents: integer("price_cents").notNull(),
  imageUrl: varchar("image_url"),
  isAvailable: boolean("is_available").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 6. Deals table
export const deals = pgTable(
  "deals",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    title: varchar("title").notNull(),
    description: text("description"),
    partnerId: bigint("partner_id", { mode: "number" })
      .notNull()
      .references(() => partners.id),
    restaurantId: bigint("restaurant_id", { mode: "number" })
      .notNull()
      .references(() => restaurants.id),
    status: dealStatusEnum("status").notNull().default("draft"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_deals_title_trgm").using("gin", sql`${table.title} gin_trgm_ops`),
    index("idx_deals_description_trgm").using("gin", sql`${table.description} gin_trgm_ops`),
    index("idx_deals_status_created_at").on(table.status, table.createdAt),
    index("idx_deals_restaurant_status").on(table.restaurantId, table.status),
  ]
);

// 7. Cuisines table
export const cuisines = pgTable("cuisines", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  name: varchar("name").unique().notNull(),
});

// 8. Dietary preferences table
export const dietaryPreferences = pgTable("dietary_preferences", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  name: varchar("name").unique().notNull(),
});

// 9. Deal cuisines junction table
export const dealCuisines = pgTable(
  "deal_cuisines",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    dealId: bigint("deal_id", { mode: "number" })
      .notNull()
      .references(() => deals.id),
    cuisineId: bigint("cuisine_id", { mode: "number" })
      .notNull()
      .references(() => cuisines.id),
  },
  (table) => [
    index("idx_deal_cuisines_deal_id").on(table.dealId),
    uniqueIndex("uniq_deal_cuisine_pair").on(table.dealId, table.cuisineId),
  ]
);

// 10. Deal dietary preferences junction table
export const dealDietaryPreferences = pgTable(
  "deal_dietary_preferences",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    dealId: bigint("deal_id", { mode: "number" })
      .notNull()
      .references(() => deals.id),
    dietaryPreferenceId: bigint("dietary_preference_id", { mode: "number" })
      .notNull()
      .references(() => dietaryPreferences.id),
  },
  (table) => [
    index("idx_deal_dietary_preferences_deal_id").on(table.dealId),
    uniqueIndex("uniq_deal_dietary_pair").on(table.dealId, table.dietaryPreferenceId),
  ]
);

// 11. User favorite deals table
export const userFavoriteDeals = pgTable(
  "user_favorite_deals",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    dealId: bigint("deal_id", { mode: "number" })
      .notNull()
      .references(() => deals.id),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_user_favorite_deals_user_deal").on(table.userId, table.dealId),
    uniqueIndex("uniq_user_favorite_deal").on(table.userId, table.dealId),
  ]
);

// 12. User favorite restaurants table
export const userFavoriteRestaurants = pgTable(
  "user_favorite_restaurants",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    restaurantId: bigint("restaurant_id", { mode: "number" })
      .notNull()
      .references(() => restaurants.id),
    notifyOnDeal: boolean("notify_on_deal").default(false),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_user_favorite_restaurants_user_restaurant").on(table.userId, table.restaurantId),
    uniqueIndex("uniq_user_favorite_restaurant").on(table.userId, table.restaurantId),
  ]
);

// 13. User cuisines table (favorite cuisines)
export const userCuisines = pgTable("user_cuisines", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  cuisineId: bigint("cuisine_id", { mode: "number" })
    .notNull()
    .references(() => cuisines.id),
});

// 14. User dietary preferences table
export const userDietaryPreferences = pgTable("user_dietary_preferences", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  dietaryPreferenceId: bigint("dietary_preference_id", { mode: "number" })
    .notNull()
    .references(() => dietaryPreferences.id),
});

// 15. User notification preferences table
export const userNotificationPreferences = pgTable("user_notification_preferences", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid("user_id")
    .unique()
    .notNull()
    .references(() => users.id),
  emailNotifications: boolean("email_notifications").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 16. Ratings table
export const ratings = pgTable("ratings", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  targetType: ratingTargetTypeEnum("target_type").notNull(),
  targetId: bigint("target_id", { mode: "number" }).notNull(),
  rating: smallint("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 17. Deal reports table
export const dealReports = pgTable("deal_reports", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  dealId: bigint("deal_id", { mode: "number" })
    .notNull()
    .references(() => deals.id),
  reason: text("reason").notNull(),
  jiraTicketId: varchar("jira_ticket_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// 18. Notifications table
export const notifications = pgTable("notifications", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  dealId: bigint("deal_id", { mode: "number" }).references(() => deals.id),
  type: varchar("type").notNull(), // 'deal_expiring', 'new_deal', 'system'
  title: varchar("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// 19. Review Tags table
export const reviewTags = pgTable("review_tags", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  name: varchar("name").notNull().unique(),
  isCustom: boolean("is_custom").default(false).notNull(),
  createdBy: uuid("created_by").references(() => users.id), // Null for system tags
  createdAt: timestamp("created_at").defaultNow(),
});

// 20. Rating Tags junction table
export const ratingTags = pgTable("rating_tags", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  ratingId: bigint("rating_id", { mode: "number" })
    .notNull()
    .references(() => ratings.id, { onDelete: "cascade" }),
  tagId: bigint("tag_id", { mode: "number" })
    .notNull()
    .references(() => reviewTags.id, { onDelete: "cascade" }),
});

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  partner: one(partners),
  favoriteDeals: many(userFavoriteDeals),
  favoriteRestaurants: many(userFavoriteRestaurants),
  cuisines: many(userCuisines),
  dietaryPreferences: many(userDietaryPreferences),
  notificationPreferences: one(userNotificationPreferences),
  ratings: many(ratings),
  dealReports: many(dealReports),
  notifications: many(notifications),
}));

export const partnersRelations = relations(partners, ({ one, many }) => ({
  user: one(users, { fields: [partners.userId], references: [users.id] }),
  restaurants: many(restaurants),
  deals: many(deals),
}));

export const restaurantsRelations = relations(restaurants, ({ one, many }) => ({
  partner: one(partners, { fields: [restaurants.partnerId], references: [partners.id] }),
  menuSections: many(menuSections),
  menuItems: many(menuItems),
  deals: many(deals),
  favoriteByUsers: many(userFavoriteRestaurants),
}));

export const menuSectionsRelations = relations(menuSections, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [menuSections.restaurantId],
    references: [restaurants.id],
  }),
  menuItems: many(menuItems),
}));

export const menuItemsRelations = relations(menuItems, ({ one }) => ({
  section: one(menuSections, { fields: [menuItems.sectionId], references: [menuSections.id] }),
  restaurant: one(restaurants, { fields: [menuItems.restaurantId], references: [restaurants.id] }),
}));

export const dealsRelations = relations(deals, ({ one, many }) => ({
  partner: one(partners, { fields: [deals.partnerId], references: [partners.id] }),
  restaurant: one(restaurants, { fields: [deals.restaurantId], references: [restaurants.id] }),
  cuisines: many(dealCuisines),
  dietaryPreferences: many(dealDietaryPreferences),
  favoriteByUsers: many(userFavoriteDeals),
  reports: many(dealReports),
}));

export const cuisinesRelations = relations(cuisines, ({ many }) => ({
  deals: many(dealCuisines),
  users: many(userCuisines),
}));

export const dietaryPreferencesRelations = relations(dietaryPreferences, ({ many }) => ({
  deals: many(dealDietaryPreferences),
  users: many(userDietaryPreferences),
}));

export const dealReportsRelations = relations(dealReports, ({ one }) => ({
  user: one(users, { fields: [dealReports.userId], references: [users.id] }),
  deal: one(deals, { fields: [dealReports.dealId], references: [deals.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  deal: one(deals, { fields: [notifications.dealId], references: [deals.id] }),
}));

export const reviewTagsRelations = relations(reviewTags, ({ one, many }) => ({
  creator: one(users, { fields: [reviewTags.createdBy], references: [users.id] }),
  ratings: many(ratingTags),
}));

export const ratingTagsRelations = relations(ratingTags, ({ one }) => ({
  rating: one(ratings, { fields: [ratingTags.ratingId], references: [ratings.id] }),
  tag: one(reviewTags, { fields: [ratingTags.tagId], references: [reviewTags.id] }),
}));

export const ratingsRelations = relations(ratings, ({ one, many }) => ({
  user: one(users, { fields: [ratings.userId], references: [users.id] }),
  tags: many(ratingTags),
}));
