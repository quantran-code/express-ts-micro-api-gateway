import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TokenPayload {
  sub: number;
  role: string;
  memberId: number | null;
  exp: number;
}

function decodeJsonSegment(segment: string): Record<string, unknown> | null {
  try {
    const decoded = Buffer.from(segment, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Verifies an HS256 bearer token with the shared secret, exactly the way
 * auth-service signs it. Returns the payload, or null for anything that is not a
 * valid, unexpired token (missing segments, wrong algorithm, bad signature,
 * expired). Never throws.
 */
export function verifyToken(token: string, secret: string): TokenPayload | null {
  const segments = token.split('.');
  if (segments.length !== 3) {
    return null;
  }

  const encodedHeader = segments[0];
  const encodedPayload = segments[1];
  const signature = segments[2];
  if (!encodedHeader || !encodedPayload || !signature) {
    return null;
  }

  const header = decodeJsonSegment(encodedHeader);
  if (!header || header.alg !== 'HS256') {
    return null;
  }

  const expected = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();

  let actual: Buffer;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  const payload = decodeJsonSegment(encodedPayload);
  if (!payload) {
    return null;
  }

  const { sub, role, memberId, exp } = payload;
  if (typeof sub !== 'number' || typeof role !== 'string' || typeof exp !== 'number') {
    return null;
  }
  if (memberId !== null && memberId !== undefined && typeof memberId !== 'number') {
    return null;
  }

  // exp is expressed in seconds since the epoch; expired is treated exactly like
  // malformed so callers never have to special-case it.
  if (exp * 1000 <= Date.now()) {
    return null;
  }

  return {
    sub,
    role,
    memberId: typeof memberId === 'number' ? memberId : null,
    exp,
  };
}

/**
 * Extracts the token from an Authorization header value, accepting a
 * case-insensitive 'Bearer <token>' prefix. Returns null for anything else.
 */
export function readBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const match = /^bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) {
    return null;
  }

  const token = match[1];
  return token ? token : null;
}
