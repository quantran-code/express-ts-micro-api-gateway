import { randomUUID } from 'node:crypto';
import type { Request } from 'express';

/**
 * The correlation id for the current request: the incoming x-request-id when it
 * is present and non-empty, otherwise a freshly generated one.
 */
export function resolveRequestId(req: Request): string {
  const incoming = req.header('x-request-id');
  if (incoming && incoming.trim() !== '') {
    return incoming;
  }
  return randomUUID();
}
