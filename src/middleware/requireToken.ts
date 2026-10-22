import type { RequestHandler } from 'express';
import { readBearerToken, verifyToken } from '../auth/token';
import { config } from '../config';
import { HttpError } from '../errors/httpError';

/**
 * Requires a valid, unexpired bearer token. A missing, malformed, wrongly signed
 * or expired token all end up as the same 401 so the request is never proxied.
 */
export const requireToken: RequestHandler = (req, res, next) => {
  const token = readBearerToken(req.header('authorization'));
  if (!token) {
    next(new HttpError(401, 'Unauthorized'));
    return;
  }

  const payload = verifyToken(token, config.jwtSecret);
  if (!payload) {
    next(new HttpError(401, 'Unauthorized'));
    return;
  }

  req.user = { id: payload.sub, role: payload.role, memberId: payload.memberId };
  next();
};
