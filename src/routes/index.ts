import authRoutes from "./auth.js";
import dealsRoutes from "./deals.js";
import menuRoutes from "./menu.js";
import notificationsRoutes from "./notifications.js";
import partnerRoutes from "./partner.js";
import partnerDealsRoutes from "./partner-deals.js";
import preferencesRoutes from "./preferences.js";
import ratingsRoutes from "./ratings.js";
import searchRoutes from "./search.js";
import userRoutes from "./user.js";
import dealReportsRoutes from "./deal-reports.js";
import commentReportsRoutes from "./comment-reports.js";
import adminRoutes from "./admin.js";
import disputesRoutes from "./disputes.js";
import tagsRoutes from "./tags.js";

export {
  authRoutes,
  dealsRoutes,
  menuRoutes,
  notificationsRoutes,
  partnerRoutes,
  partnerDealsRoutes,
  preferencesRoutes,
  ratingsRoutes,
  searchRoutes,
  userRoutes,
  dealReportsRoutes,
  commentReportsRoutes,
  adminRoutes,
  disputesRoutes,
  tagsRoutes,
};

// Default export for convenient importing
export default {
  auth: authRoutes,
  deals: dealsRoutes,
  menu: menuRoutes,
  notifications: notificationsRoutes,
  partner: partnerRoutes,
  partnerDeals: partnerDealsRoutes,
  preferences: preferencesRoutes,
  ratings: ratingsRoutes,
  search: searchRoutes,
  user: userRoutes,
  dealReports: dealReportsRoutes,
  commentReports: commentReportsRoutes,
  admin: adminRoutes,
  disputes: disputesRoutes,
  tags: tagsRoutes,
};
