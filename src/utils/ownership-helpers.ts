import { db } from "../db/db.js";
import { partners, restaurants } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

export class OwnershipHelper {
  /**
   * Verify if a user owns a specific restaurant
   */
  static async verifyRestaurantOwnership(userId: string, restaurantId: number): Promise<boolean> {
    const result = await db
      .select({ partnerId: partners.id })
      .from(partners)
      .innerJoin(restaurants, eq(partners.id, restaurants.partnerId))
      .where(and(eq(partners.userId, userId), eq(restaurants.id, restaurantId)))
      .limit(1);

    return result.length > 0;
  }

  /**
   * Get partner ID from user ID
   */
  static async getPartnerIdFromUser(userId: string): Promise<number | null> {
    const partner = await db
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.userId, userId))
      .limit(1);

    return partner.length > 0 && partner[0] ? partner[0].id : null;
  }

  /**
   * Verify if user is a partner
   */
  static async isPartner(userId: string): Promise<boolean> {
    const partnerId = await this.getPartnerIdFromUser(userId);
    return partnerId !== null;
  }
}
