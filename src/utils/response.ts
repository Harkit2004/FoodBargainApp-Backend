import type { Response } from "express";

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string | undefined;
}

export const sendSuccess = <T>(res: Response, data: T, message?: string) => {
  const response: ApiResponse<T> = {
    success: true,
    data,
    message,
  };
  res.json(response);
};

export const sendError = (res: Response, statusCode: number, error: string, message?: string) => {
  const response: ApiResponse = {
    success: false,
    error,
    message,
  };
  res.status(statusCode).json(response);
};

export const sendValidationError = (res: Response, errors: Record<string, string>) => {
  res.status(400).json({
    success: false,
    error: "Validation failed",
    errors,
  });
};
