import { Router } from 'express';
import type { RequestHandler } from 'express';
import { config } from '../config';
import { proxyRequest } from '../proxy';
import { resolveRequestId } from '../requestId';
import { requireToken } from '../middleware/requireToken';

/**
 * First path segment of an inbound request -> the base URL of the backing service
 * that owns it. Resolved per request so the configured value is always used.
 */
const TARGETS: Record<string, () => string> = {
  books: () => config.catalogServiceUrl,
  members: () => config.memberServiceUrl,
  loans: () => config.loanServiceUrl,
  reports: () => config.reportingServiceUrl,
};

function createProxyHandler(resolveBaseUrl: () => string): RequestHandler {
  return (req, res, next) => {
    // requireToken runs first for every mounted prefix, so a missing, malformed or
    // expired token never reaches the outbound call.
    void proxyRequest(req, res, resolveBaseUrl(), resolveRequestId(req)).catch(next);
  };
}

export const proxyRouter: Router = Router();

for (const [prefix, resolveBaseUrl] of Object.entries(TARGETS)) {
  proxyRouter.use(`/${prefix}`, requireToken, createProxyHandler(resolveBaseUrl));
}
