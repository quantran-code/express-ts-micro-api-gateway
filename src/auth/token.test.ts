import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { readBearerToken, verifyToken } from './token';
import { requireToken } from '../middleware/requireToken';
import { config } from '../config';
import { errorHandler, notFoundHandler } from '../errors/handlers';
import { signTestToken } from '../test/tokens';

interface ErrorBody {
  error: string;
  requestId: string;
}

interface UserBody {
  user: {
    id: number;
    role: string;
    memberId: number | null;
  };
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signRaw(
  payload: Record<string, unknown>,
  secret: string,
  alg = 'HS256',
): string {
  const encodedHeader = encodeSegment({ alg, typ: 'JWT' });
  const encodedPayload = encodeSegment(payload);
  const signature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function buildProtectedApp() {
  const protectedApp = express();
  protectedApp.use(express.json());

  protectedApp.get('/protected', requireToken, (req, res) => {
    res.status(200).json({ user: req.user });
  });

  protectedApp.use(notFoundHandler);
  protectedApp.use(errorHandler);

  return protectedApp;
}

describe('verifyToken', () => {
  it('returns the payload of a valid, unexpired HS256 token', () => {
    const token = signTestToken({ sub: 7, role: 'librarian', memberId: 12 });

    const payload = verifyToken(token, config.jwtSecret);

    expect(payload?.sub).toBe(7);
    expect(payload?.role).toBe('librarian');
    expect(payload?.memberId).toBe(12);
    expect(typeof payload?.exp).toBe('number');
    expect(payload?.exp).toBeGreaterThan(nowInSeconds());
  });

  it('returns a null memberId when the token carries one', () => {
    const token = signTestToken({ sub: 7, role: 'librarian', memberId: null });

    expect(verifyToken(token, config.jwtSecret)?.memberId).toBeNull();
  });

  it('returns null for a token without three dot-separated segments', () => {
    const token = signTestToken({ sub: 7, role: 'librarian', memberId: 12 });

    expect(verifyToken('not-a-token', config.jwtSecret)).toBeNull();
    expect(verifyToken(token.split('.').slice(0, 2).join('.'), config.jwtSecret)).toBeNull();
  });

  it('returns null for a token signed with a different secret', () => {
    const token = signTestToken(
      { sub: 7, role: 'librarian', memberId: 12 },
      'some-other-secret',
    );

    expect(verifyToken(token, config.jwtSecret)).toBeNull();
  });

  it('returns null when the header algorithm is not HS256', () => {
    const token = signRaw(
      { sub: 7, role: 'librarian', memberId: 12, exp: nowInSeconds() + 3600 },
      config.jwtSecret,
      'HS512',
    );

    expect(verifyToken(token, config.jwtSecret)).toBeNull();
  });

  it('returns null when exp is in the past', () => {
    const token = signTestToken({
      sub: 7,
      role: 'librarian',
      memberId: 12,
      exp: nowInSeconds() - 60,
    });

    expect(verifyToken(token, config.jwtSecret)).toBeNull();
  });

  it('returns null instead of throwing for a non-JSON payload segment', () => {
    const encodedHeader = encodeSegment({ alg: 'HS256', typ: 'JWT' });
    const encodedPayload = Buffer.from('not-json', 'utf8').toString('base64url');
    const signature = createHmac('sha256', config.jwtSecret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    expect(
      verifyToken(`${encodedHeader}.${encodedPayload}.${signature}`, config.jwtSecret),
    ).toBeNull();
  });
});

describe('readBearerToken', () => {
  it('reads a token from a Bearer header', () => {
    expect(readBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('accepts a case-insensitive scheme', () => {
    expect(readBearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('returns null for a missing header', () => {
    expect(readBearerToken(undefined)).toBeNull();
  });

  it('returns null for a non-Bearer scheme or an empty token', () => {
    expect(readBearerToken('Basic abc.def.ghi')).toBeNull();
    expect(readBearerToken('Bearer')).toBeNull();
    expect(readBearerToken('Bearer   ')).toBeNull();
  });
});

describe('requireToken', () => {
  it('calls next with the token claims on the request for a valid token', async () => {
    const token = signTestToken({ sub: 3, role: 'member', memberId: 42 });

    const res = await request(buildProtectedApp())
      .get('/protected')
      .set('authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as UserBody).user).toEqual({
      id: 3,
      role: 'member',
      memberId: 42,
    });
  });

  it('keeps a null memberId on the request', async () => {
    const token = signTestToken({ sub: 4, role: 'librarian', memberId: null });

    const res = await request(buildProtectedApp())
      .get('/protected')
      .set('authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as UserBody).user).toEqual({
      id: 4,
      role: 'librarian',
      memberId: null,
    });
  });

  it('answers 401 without a token', async () => {
    const res = await request(buildProtectedApp()).get('/protected');

    expect(res.status).toBe(401);
    const body = res.body as ErrorBody;
    expect(Object.keys(body).sort()).toEqual(['error', 'requestId']);
    expect(body.requestId.length).toBeGreaterThan(0);
  });

  it('answers 401 for a malformed token', async () => {
    const res = await request(buildProtectedApp())
      .get('/protected')
      .set('authorization', 'Bearer not-a-token');

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).error).toBeTruthy();
  });

  it('answers 401 the same way for an expired token', async () => {
    const token = signTestToken({
      sub: 3,
      role: 'member',
      memberId: 42,
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    const res = await request(buildProtectedApp())
      .get('/protected')
      .set('authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).requestId.length).toBeGreaterThan(0);
  });

  it('answers 401 for a token signed with another secret', async () => {
    const token = signTestToken({ sub: 3, role: 'member', memberId: 42 }, 'wrong-secret');

    const res = await request(buildProtectedApp())
      .get('/protected')
      .set('authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('echoes the incoming x-request-id on the 401 body', async () => {
    const res = await request(buildProtectedApp())
      .get('/protected')
      .set('x-request-id', 'token-request-id');

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).requestId).toBe('token-request-id');
  });
});
