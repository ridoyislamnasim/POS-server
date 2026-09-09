import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import type { AuthedRequest } from "../types.js";

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers["x-request-id"] as string) || randomUUID();
  const corr = (req.headers["x-correlation-id"] as string) || id;
  (req as AuthedRequest).requestId = id;
  (req as AuthedRequest).correlationId = corr;
  res.setHeader("x-request-id", id);
  res.setHeader("x-correlation-id", corr);
  next();
}
