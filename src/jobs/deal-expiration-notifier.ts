import { db } from "../db/db.js";
import {
  deals,
  userFavoriteDeals,
  users,
  userNotificationPreferences,
  restaurants,
  notifications,
} from "../db/schema.js";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { sendDealExpirationEmail } from "../utils/email.js";
import cron from "node-cron";

/**
 * Check for deals expiring within 24 hours and send notifications
 * This job should run every hour
 */
export async function checkExpiringDeals(): Promise<void> {
  console.log("🔄 Starting deal expiration check...");

  try {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59, 999);

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Find deals that are expiring within the next 24 hours
    const expiringDeals = await db
      .select({
        deal: deals,
        restaurant: restaurants,
      })
      .from(deals)
      .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
      .where(
        and(
          eq(deals.status, "active"),
          gte(deals.endDate, sql`CURRENT_DATE`), // expires today or later
          lte(deals.endDate, sql`CURRENT_DATE`) // expires today
        )
      );

    console.log(`📊 Found ${expiringDeals.length} deals expiring today`);

    if (expiringDeals.length === 0) {
      console.log("✅ No expiring deals found");
      return;
    }

    // For each expiring deal, find users who have favorited it
    for (const { deal, restaurant } of expiringDeals) {
      const favoriteUsers = await db
        .select({
          user: users,
          notificationPrefs: userNotificationPreferences,
          favorite: userFavoriteDeals,
        })
        .from(userFavoriteDeals)
        .innerJoin(users, eq(userFavoriteDeals.userId, users.id))
        .leftJoin(userNotificationPreferences, eq(userNotificationPreferences.userId, users.id))
        .where(eq(userFavoriteDeals.dealId, deal.id));

      console.log(`📧 Deal "${deal.title}" has ${favoriteUsers.length} users who favorited it`);

      for (const { user, notificationPrefs } of favoriteUsers) {
        try {
          // Check if we've already sent a notification for this deal to this user
          const existingNotification = await db
            .select()
            .from(notifications)
            .where(
              and(
                eq(notifications.userId, user.id),
                eq(notifications.dealId, deal.id),
                eq(notifications.type, "deal_expiring")
              )
            )
            .limit(1);

          if (existingNotification.length > 0) {
            console.log(`⏭️  Notification already sent to ${user.email} for deal ${deal.id}`);
            continue;
          }

          const expirationDateStr = new Date(deal.endDate).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          });

          // Create in-app notification
          await db.insert(notifications).values({
            userId: user.id,
            dealId: deal.id,
            type: "deal_expiring",
            title: `⏰ Deal Expiring Today`,
            message: `Your favorite deal "${deal.title}" at ${restaurant.name} expires today!`,
          });

          console.log(`✅ Created in-app notification for ${user.email} - Deal: ${deal.title}`);

          // Send email notification if user has email notifications enabled
          const emailEnabled = notificationPrefs?.emailNotifications !== false;

          if (emailEnabled && user.email) {
            const emailSent = await sendDealExpirationEmail({
              userEmail: user.email,
              userName: user.displayName || "Valued Customer",
              dealTitle: deal.title,
              dealDescription: deal.description || "Limited time offer",
              restaurantName: restaurant.name,
              expirationDate: expirationDateStr,
              dealId: deal.id,
            });

            if (emailSent) {
              console.log(`📧 Email sent to ${user.email} for deal: ${deal.title}`);
            } else {
              console.warn(`⚠️  Failed to send email to ${user.email}`);
            }
          } else {
            console.log(`📵 Email notifications disabled or no email for user ${user.displayName}`);
          }
        } catch (error) {
          console.error(
            `❌ Failed to send notification to ${user.email} for deal ${deal.id}:`,
            error
          );
          // Continue with other users even if one fails
        }
      }
    }

    console.log("✅ Deal expiration check completed successfully");
  } catch (error) {
    console.error("❌ Error in checkExpiringDeals job:", error);
    throw error; // Re-throw to let the scheduler handle it
  }
}

/**
 * Start the deal expiration notification job
 * Runs every hour using cron syntax (at the start of every hour)
 */
export function startDealExpirationJob(): void {
  console.log("🚀 Starting deal expiration notification job");
  console.log("⏰ Job scheduled to run every hour (at minute 0)");

  // Run immediately on startup
  checkExpiringDeals().catch((error) => {
    console.error("❌ Initial deal expiration check failed:", error);
  });

  // Schedule to run every hour at minute 0
  // Cron pattern: "0 * * * *" = At minute 0 of every hour
  cron.schedule("0 * * * *", () => {
    console.log("⏰ Cron job triggered at:", new Date().toISOString());
    checkExpiringDeals().catch((error) => {
      console.error("❌ Scheduled deal expiration check failed:", error);
    });
  });

  console.log("✅ Deal expiration job started successfully");
  console.log("📅 Next run: Top of the next hour");
}
