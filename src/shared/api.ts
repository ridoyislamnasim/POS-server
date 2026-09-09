export type ApiSuccess<T> = {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
};

export type ApiError = {
  success: false;
  error: { code: string; message: string };
};

export type ApiEnvelope<T> = ApiSuccess<T> | ApiError;
