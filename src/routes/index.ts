import authRoutes from "./auth.js";
import dealsRoutes from "./deals.js";
import menuRoutes from "./menu.js";
import notificationsRoutes from "./notifications.js";
import partnerRoutes from "./partner.js";
import partnerDealsRoutes from "./partner-deals.js";
import ratingsRoutes from "./ratings.js";
import searchRoutes from "./search.js";
import userRoutes from "./user.js";

export {
  authRoutes,
  dealsRoutes,
  menuRoutes,
  notificationsRoutes,
  partnerRoutes,
  partnerDealsRoutes,
  ratingsRoutes,
  searchRoutes,
  userRoutes,
};

// Default export for convenient importing
export default {
  auth: authRoutes,
  deals: dealsRoutes,
  menu: menuRoutes,
  notifications: notificationsRoutes,
  partner: partnerRoutes,
  partnerDeals: partnerDealsRoutes,
  ratings: ratingsRoutes,
  search: searchRoutes,
  user: userRoutes,
};
