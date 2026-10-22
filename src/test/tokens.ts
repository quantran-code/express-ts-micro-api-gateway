import { createHmac } from 'node:crypto';
import { config } from '../config';

export interface TestTokenInput {
  sub: number;
  role: string;
  memberId: number | null;
  exp?: number;
}

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * Signs a token with the same HMAC-SHA256 scheme auth-service uses, so tests never
 * hardcode a bearer token.
 */
export function signTestToken(
  payload: TestTokenInput,
  secret: string = config.jwtSecret,
): string {
  const encodedHeader = encodeSegment({ alg: 'HS256', typ: 'JWT' });
  const encodedPayload = encodeSegment({
    sub: payload.sub,
    role: payload.role,
    memberId: payload.memberId,
    exp: payload.exp ?? Math.floor(Date.now() / 1000) + 60 * 60,
  });
  const signature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}
