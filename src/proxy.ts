import type { Request, Response } from 'express';
import { config } from './config';

/**
 * Forwards the incoming request to a backing service and relays its answer
 * unchanged: same method, same path and query string, same status code and the
 * same JSON body (including a body that carries its own requestId, or none at
 * all).
 */
export async function proxyRequest(
  req: Request,
  res: Response,
  baseUrl: string,
  requestId: string,
): Promise<void> {
  const headers: Record<string, string> = {
    'x-service-key': config.serviceKey,
    'x-request-id': requestId,
  };

  if (req.user) {
    headers['x-user-id'] = String(req.user.id);
    headers['x-user-role'] = req.user.role;
    if (req.user.memberId !== null) {
      headers['x-user-member-id'] = String(req.user.memberId);
    }
  }

  const method = req.method.toUpperCase();
  const init: RequestInit = { method, headers };

  const body: unknown = req.body;
  const forwardsBody =
    method !== 'GET' && method !== 'HEAD' && body !== undefined && body !== null;
  if (forwardsBody) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  // originalUrl keeps the full path and query string even when the proxy handler
  // is mounted on a prefix.
  const upstreamUrl = `${baseUrl}${req.originalUrl}`;

  let upstream: Awaited<ReturnType<typeof fetch>>;
  try {
    upstream = await fetch(upstreamUrl, init);
  } catch {
    res.status(502).json({ error: 'Bad Gateway', requestId });
    return;
  }

  let raw: string;
  try {
    raw = await upstream.text();
  } catch {
    res.status(502).json({ error: 'Bad Gateway', requestId });
    return;
  }

  if (raw.trim() === '') {
    res.status(upstream.status).end();
    return;
  }

  let relayed: unknown;
  try {
    relayed = JSON.parse(raw);
  } catch {
    res.status(502).json({ error: 'Bad Gateway', requestId });
    return;
  }

  res.status(upstream.status).json(relayed);
}
