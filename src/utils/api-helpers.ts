import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";

// Common HTTP status codes
export enum HttpStatus {
  OK = 200,
  CREATED = 201,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  INTERNAL_SERVER_ERROR = 500,
}

// Common error messages
export enum ErrorMessages {
  AUTH_REQUIRED = "User authentication required",
  INVALID_ID = "Invalid ID provided",
  NOT_FOUND = "Resource not found",
  FORBIDDEN_ACCESS = "Access denied - insufficient permissions",
  VALIDATION_FAILED = "Validation failed",
  INTERNAL_ERROR = "Internal server error occurred",
}

// Common success messages
export enum SuccessMessages {
  CREATED = "Resource created successfully",
  UPDATED = "Resource updated successfully",
  DELETED = "Resource deleted successfully",
  FETCHED = "Resource fetched successfully",
}

// Standard API response interface
export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  errors?: Record<string, string>;
}

// Response helpers
export class ResponseHelper {
  static success<T>(res: Response, data: T, message?: string, status = HttpStatus.OK): void {
    res.status(status).json({
      success: true,
      message,
      data,
    });
  }

  static created<T>(res: Response, data: T, message = SuccessMessages.CREATED): void {
    this.success(res, data, message, HttpStatus.CREATED);
  }

  static error(res: Response, error: string, status = HttpStatus.BAD_REQUEST): void {
    res.status(status).json({
      success: false,
      error,
    });
  }

  static badRequest(res: Response, error: string): void {
    this.error(res, error, HttpStatus.BAD_REQUEST);
  }

  static unauthorized(res: Response, error = ErrorMessages.AUTH_REQUIRED): void {
    this.error(res, error, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(res: Response, error = ErrorMessages.FORBIDDEN_ACCESS): void {
    this.error(res, error, HttpStatus.FORBIDDEN);
  }

  static notFound(res: Response, error = ErrorMessages.NOT_FOUND): void {
    this.error(res, error, HttpStatus.NOT_FOUND);
  }

  static internalError(res: Response, error: string = ErrorMessages.INTERNAL_ERROR): void {
    this.error(res, error, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  static validationError(res: Response, errors: Record<string, string>): void {
    res.status(HttpStatus.BAD_REQUEST).json({
      success: false,
      error: ErrorMessages.VALIDATION_FAILED,
      errors,
    });
  }
}

// Validation helpers
export class ValidationHelper {
  static isValidId(id: string | number): boolean {
    const numericId = typeof id === "string" ? parseInt(id) : id;
    return !isNaN(numericId) && numericId > 0;
  }

  static parseId(id: string): number | null {
    const numericId = parseInt(id);
    return this.isValidId(numericId) ? numericId : null;
  }

  static validateRequiredFields(
    data: Record<string, unknown>,
    requiredFields: string[]
  ): Record<string, string> | null {
    const errors: Record<string, string> = {};

    requiredFields.forEach((field) => {
      if (!data[field] || (typeof data[field] === "string" && !data[field].trim())) {
        errors[field] = `${field} is required`;
      }
    });

    return Object.keys(errors).length > 0 ? errors : null;
  }

  static validatePriceCents(price: number): string | null {
    if (price < 0) {
      return "Price cannot be negative";
    }
    if (!Number.isInteger(price)) {
      return "Price must be in cents (whole number)";
    }
    return null;
  }

  static validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static validatePhone(phone: string): boolean {
    const phoneRegex = /^\+?[\d\s\-()]+$/;
    return phoneRegex.test(phone) && phone.replace(/\D/g, "").length >= 10;
  }

  static validateArrayIds(ids: unknown, fieldName: string): { valid: boolean; error?: string } {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { valid: false, error: `At least one ${fieldName} is required` };
    }
    if (!ids.every((id) => typeof id === "number" && id > 0)) {
      return { valid: false, error: `All ${fieldName} must be valid positive integers` };
    }
    return { valid: true };
  }

  static validateTargetType(targetType: unknown): { valid: boolean; error?: string } {
    const validTypes = ["restaurant", "menu_item", "deal"];
    if (!targetType || !validTypes.includes(targetType as string)) {
      return { valid: false, error: "Target type must be one of: restaurant, menu_item, deal" };
    }
    return { valid: true };
  }
}

// Authentication helpers
export class AuthHelper {
  static getUserId(req: AuthenticatedRequest): string | null {
    return req.user?.id || null;
  }

  static requireAuth(req: AuthenticatedRequest, res: Response): string | null {
    const userId = this.getUserId(req);
    if (!userId) {
      ResponseHelper.unauthorized(res);
      return null;
    }
    return userId;
  }

  static getOptionalAuth(req: AuthenticatedRequest): string | null {
    // Try to get user from authenticated request, return null if not authenticated
    return req.user?.id || null;
  }

  static async getOptionalAuthFromToken(req: AuthenticatedRequest): Promise<string | null> {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
      }

      const token = authHeader.substring(7);
      if (!token || token === "undefined" || token === "null") {
        return null;
      }

      // We need to verify the token and get the user ID
      // For now, let's use a simplified approach that manually authenticates
      return null; // TODO: Implement token verification
    } catch (error) {
      console.log("Error in getOptionalAuthFromToken:", error);
      return null;
    }
  }
}

// Database helpers
export class DbHelper {
  static handleDbError(error: unknown, res: Response, customMessage?: string): void {
    console.error("Database error:", error);
    ResponseHelper.internalError(res, customMessage);
  }

  static async executeWithErrorHandling<T>(
    operation: () => Promise<T>,
    res: Response,
    errorMessage?: string
  ): Promise<T | null> {
    try {
      return await operation();
    } catch (error) {
      this.handleDbError(error, res, errorMessage);
      return null;
    }
  }
}

// Common route patterns
export class RouteHelper {
  static async handleStandardRoute<T>(
    req: AuthenticatedRequest,
    res: Response,
    handler: (userId: string) => Promise<T>,
    errorMessage?: string
  ): Promise<void> {
    const userId = AuthHelper.requireAuth(req, res);
    if (!userId) return;

    const result = await DbHelper.executeWithErrorHandling(
      () => handler(userId),
      res,
      errorMessage
    );

    if (result !== null) {
      ResponseHelper.success(res, result);
    }
  }

  static validateIds(res: Response, ids: Record<string, string>): Record<string, number> | null {
    const validatedIds: Record<string, number> = {};
    const errors: Record<string, string> = {};

    Object.entries(ids).forEach(([key, value]) => {
      const numericId = ValidationHelper.parseId(value);
      if (numericId === null) {
        errors[key] = `Invalid ${key}`;
      } else {
        validatedIds[key] = numericId;
      }
    });

    if (Object.keys(errors).length > 0) {
      ResponseHelper.validationError(res, errors);
      return null;
    }

    return validatedIds;
  }
}

// Helper functions for common operations
export function createRouteHandler<T>(
  handler: (userId: string, req: AuthenticatedRequest, res: Response) => Promise<T>,
  errorMessage?: string
) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const userId = AuthHelper.requireAuth(req, res);
    if (!userId) return;

    const result = await DbHelper.executeWithErrorHandling(
      () => handler(userId, req, res),
      res,
      errorMessage
    );

    if (result !== null) {
      ResponseHelper.success(res, result);
    }
  };
}

export function validateRating(rating: number): boolean {
  return typeof rating === "number" && rating >= 1 && rating <= 5;
}

export function validateTargetType(targetType: string): boolean {
  const validTargetTypes = ["restaurant", "menu_item", "deal"];
  return validTargetTypes.includes(targetType);
}
