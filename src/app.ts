import express from "express";
import "dotenv/config";

// Import all route modules from centralized index
import {
  authRoutes,
  userRoutes,
  dealsRoutes,
  partnerRoutes,
  menuRoutes,
  partnerDealsRoutes,
  searchRoutes,
  notificationsRoutes,
  ratingsRoutes,
} from "./routes/index.js";

const app = express();

// Middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:3000"];
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }

  next();
});

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    message: "FoodBargain API is running!",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/deals", dealsRoutes);
app.use("/api/partner", partnerRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/partner-deals", partnerDealsRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/ratings", ratingsRoutes);

// 404 handler - catch all remaining requests
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
});

// Global error handler
interface ErrorWithStatus extends Error {
  status?: number;
}

app.use((err: ErrorWithStatus, req: express.Request, res: express.Response) => {
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    error: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

export default app;
