import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { readBearerToken, verifyToken } from '../auth/token';
import { config } from '../config';
import { HttpError } from '../errors/httpError';
import { proxyRequest } from '../proxy';
import { resolveRequestId } from '../requestId';

/**
 * Forwards the request to auth-service, keeping the full path
 * (${AUTH_SERVICE_URL}/auth/login) and the query string, with the same
 * service-key and request-id headers as every other proxied route.
 */
function proxyToAuthService(req: Request, res: Response, next: NextFunction): void {
  void proxyRequest(req, res, config.authServiceUrl, resolveRequestId(req)).catch(next);
}

const loginHandler: RequestHandler = (req, res, next) => {
  // /auth/login never requires a token: a bad password is auth-service's answer to
  // give, not the gateway's, so the request is always proxied.
  proxyToAuthService(req, res, next);
};

const registerHandler: RequestHandler = (req, res, next) => {
  // /auth/register is the one route with optional authentication. An Authorization
  // header that is present must be valid and unexpired, otherwise the request is
  // rejected without proxying; no header at all proxies anonymously.
  const authorization = req.header('authorization');
  if (authorization !== undefined) {
    const token = readBearerToken(authorization);
    const payload = token ? verifyToken(token, config.jwtSecret) : null;
    if (!payload) {
      next(new HttpError(401, 'Unauthorized'));
      return;
    }
    req.user = { id: payload.sub, role: payload.role, memberId: payload.memberId };
  }

  proxyToAuthService(req, res, next);
};

export const authRouter: Router = Router();

authRouter.post('/login', loginHandler);
authRouter.post('/register', registerHandler);
