import { db } from "../db/db.js";
import { deals } from "../db/schema.js";
import { eq, and, gte, lte, lt, sql } from "drizzle-orm";
import cron from "node-cron";

/**
 * Manage deal status transitions based on dates
 * This job handles three scenarios:
 * 1. Draft → Active: Deals that should become active based on start/end dates
 * 2. Active → Expired: Deals that have passed their end date
 * 3. Expired → Active: Deals that were extended and should become active again
 */
export async function manageDealStatuses(): Promise<void> {
  console.log("🔄 Starting deal status management check...");

  try {
    const stats = {
      draftToActive: 0,
      activeToExpired: 0,
      expiredToActive: 0,
    };

    // 1. DRAFT → ACTIVE
    // Activate draft deals where today is between start_date and end_date
    const draftDealsToActivate = await db
      .update(deals)
      .set({
        status: "active",
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(deals.status, "draft"),
          lte(deals.startDate, sql`CURRENT_DATE`), // start_date <= today
          gte(deals.endDate, sql`CURRENT_DATE`) // end_date >= today
        )
      )
      .returning({ id: deals.id, title: deals.title });

    stats.draftToActive = draftDealsToActivate.length;
    if (draftDealsToActivate.length > 0) {
      console.log(`✅ Activated ${draftDealsToActivate.length} draft deal(s):`);
      draftDealsToActivate.forEach((deal) => {
        console.log(`   - Deal #${deal.id}: "${deal.title}"`);
      });
    }

    // 2. ACTIVE → EXPIRED
    // Expire active deals where end_date is in the past
    const activeDealsToExpire = await db
      .update(deals)
      .set({
        status: "expired",
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(deals.status, "active"),
          lt(deals.endDate, sql`CURRENT_DATE`) // end_date < today
        )
      )
      .returning({ id: deals.id, title: deals.title });

    stats.activeToExpired = activeDealsToExpire.length;
    if (activeDealsToExpire.length > 0) {
      console.log(`⏰ Expired ${activeDealsToExpire.length} active deal(s):`);
      activeDealsToExpire.forEach((deal) => {
        console.log(`   - Deal #${deal.id}: "${deal.title}"`);
      });
    }

    // 3. EXPIRED → ACTIVE
    // Reactivate expired deals where the end_date was extended to include today
    const expiredDealsToReactivate = await db
      .update(deals)
      .set({
        status: "active",
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(deals.status, "expired"),
          lte(deals.startDate, sql`CURRENT_DATE`), // start_date <= today
          gte(deals.endDate, sql`CURRENT_DATE`) // end_date >= today (was extended)
        )
      )
      .returning({ id: deals.id, title: deals.title });

    stats.expiredToActive = expiredDealsToReactivate.length;
    if (expiredDealsToReactivate.length > 0) {
      console.log(`🔄 Reactivated ${expiredDealsToReactivate.length} expired deal(s):`);
      expiredDealsToReactivate.forEach((deal) => {
        console.log(`   - Deal #${deal.id}: "${deal.title}"`);
      });
    }

    // Summary
    const totalChanges = stats.draftToActive + stats.activeToExpired + stats.expiredToActive;
    console.log("\n📊 Deal Status Management Summary:");
    console.log(`   Draft → Active: ${stats.draftToActive}`);
    console.log(`   Active → Expired: ${stats.activeToExpired}`);
    console.log(`   Expired → Active: ${stats.expiredToActive}`);
    console.log(`   Total changes: ${totalChanges}`);

    if (totalChanges === 0) {
      console.log("✅ No status changes needed");
    } else {
      console.log(`✅ Successfully updated ${totalChanges} deal status(es)`);
    }
  } catch (error) {
    console.error("❌ Error in manageDealStatuses job:", error);
    throw error; // Re-throw to let the scheduler handle it
  }
}

/**
 * Start the deal status management job
 * Runs every hour using cron syntax (at the start of every hour)
 */
export function startDealStatusJob(): void {
  console.log("🚀 Starting deal status management job");
  console.log("⏰ Job scheduled to run every hour (at minute 0)");

  // Run immediately on startup
  manageDealStatuses().catch((error) => {
    console.error("❌ Initial deal status check failed:", error);
  });

  // Schedule to run every hour at minute 0
  // Cron pattern: "0 * * * *" = At minute 0 of every hour
  cron.schedule("0 * * * *", () => {
    console.log("⏰ Deal Status Job triggered at:", new Date().toISOString());
    manageDealStatuses().catch((error) => {
      console.error("❌ Scheduled deal status check failed:", error);
    });
  });

  console.log("✅ Deal status management job started successfully");
  console.log("📅 Next run: Top of the next hour");
}
