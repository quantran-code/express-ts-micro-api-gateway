import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from './app';
import { config } from './config';
import { signTestToken } from './test/tokens';

interface ErrorBody {
  error: string;
  requestId: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeFetchMock() {
  return vi.fn<typeof fetch>();
}

type FetchMock = ReturnType<typeof makeFetchMock>;

interface OutboundCall {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function readCall(fetchMock: FetchMock, index = 0): OutboundCall {
  const call = fetchMock.mock.calls[index];
  if (!call) {
    throw new Error(`expected at least ${index + 1} outbound fetch call(s)`);
  }
  const [input, init] = call;
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  return {
    url,
    method: init?.method,
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: init?.body,
  };
}

function memberToken(): string {
  return signTestToken({ sub: 3, role: 'member', memberId: 42 });
}

const LOGIN_BODY = { email: 'ada@example.com', password: 'correct-horse' };
const REGISTER_BODY = {
  email: 'grace@example.com',
  password: 'battery-staple',
  name: 'Grace Hopper',
};

describe('POST /auth/login', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('proxies to the auth service login path without requiring a token', async () => {
    const upstreamBody = {
      accessToken: 'header.payload.signature',
      user: { id: 1, email: 'ada@example.com', role: 'librarian' },
    };
    fetchMock.mockResolvedValue(jsonResponse(upstreamBody));

    const res = await request(app).post('/auth/login').send(LOGIN_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(upstreamBody);

    const call = readCall(fetchMock);
    expect(call.url).toBe(`${config.authServiceUrl}/auth/login`);
    expect(call.method).toBe('POST');
    expect(call.headers['x-service-key']).toBe(config.serviceKey);
    expect(call.headers['x-request-id']).toMatch(UUID_PATTERN);
    expect(call.headers['content-type']).toBe('application/json');
    expect(JSON.parse(String(call.body))).toEqual(LOGIN_BODY);
    expect(call.headers).not.toHaveProperty('x-user-id');
    expect(call.headers).not.toHaveProperty('x-user-role');
    expect(call.headers).not.toHaveProperty('x-user-member-id');
  });

  it('forwards an incoming x-request-id upstream and relays the upstream error body unchanged', async () => {
    const upstreamBody = {
      error: 'Invalid credentials',
      requestId: 'auth-request-id',
    };
    fetchMock.mockResolvedValue(jsonResponse(upstreamBody, 401));

    const res = await request(app)
      .post('/auth/login')
      .set('x-request-id', 'login-request-id')
      .send(LOGIN_BODY);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(upstreamBody);
    expect(readCall(fetchMock).headers['x-request-id']).toBe('login-request-id');
  });
});

describe('POST /auth/register', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('proxies anonymously when no Authorization header is sent', async () => {
    const upstreamBody = { id: 5, email: 'grace@example.com' };
    fetchMock.mockResolvedValue(jsonResponse(upstreamBody, 201));

    const res = await request(app).post('/auth/register').send(REGISTER_BODY);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(upstreamBody);

    const call = readCall(fetchMock);
    expect(call.url).toBe(`${config.authServiceUrl}/auth/register`);
    expect(call.method).toBe('POST');
    expect(call.headers['x-service-key']).toBe(config.serviceKey);
    expect(call.headers['x-request-id']).toMatch(UUID_PATTERN);
    expect(call.headers).not.toHaveProperty('x-user-id');
    expect(call.headers).not.toHaveProperty('x-user-role');
    expect(call.headers).not.toHaveProperty('x-user-member-id');
  });

  it('proxies with the user headers when a valid token is sent', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 5 }, 201));

    const res = await request(app)
      .post('/auth/register')
      .set('authorization', `Bearer ${memberToken()}`)
      .send(REGISTER_BODY);

    expect(res.status).toBe(201);

    const { headers } = readCall(fetchMock);
    expect(headers['x-user-id']).toBe('3');
    expect(headers['x-user-role']).toBe('member');
    expect(headers['x-user-member-id']).toBe('42');
  });

  it('omits x-user-member-id when the token has no member id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 6 }, 201));
    const token = signTestToken({ sub: 9, role: 'librarian', memberId: null });

    const res = await request(app)
      .post('/auth/register')
      .set('authorization', `Bearer ${token}`)
      .send(REGISTER_BODY);

    expect(res.status).toBe(201);

    const { headers } = readCall(fetchMock);
    expect(headers['x-user-id']).toBe('9');
    expect(headers['x-user-role']).toBe('librarian');
    expect(headers).not.toHaveProperty('x-user-member-id');
  });

  it('answers 401 without proxying for a malformed token', async () => {
    const res = await request(app)
      .post('/auth/register')
      .set('authorization', 'Bearer not-a-token')
      .send(REGISTER_BODY);

    expect(res.status).toBe(401);
    const body = res.body as ErrorBody;
    expect(Object.keys(body).sort()).toEqual(['error', 'requestId']);
    expect(body.requestId.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 401 without proxying for a token signed with another secret', async () => {
    const token = signTestToken(
      { sub: 3, role: 'member', memberId: 42 },
      'some-other-secret',
    );

    const res = await request(app)
      .post('/auth/register')
      .set('authorization', `Bearer ${token}`)
      .send(REGISTER_BODY);

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).requestId.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 401 without proxying for an expired token', async () => {
    const token = signTestToken({
      sub: 3,
      role: 'member',
      memberId: 42,
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    const res = await request(app)
      .post('/auth/register')
      .set('authorization', `Bearer ${token}`)
      .send(REGISTER_BODY);

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).requestId.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 401 without proxying for a non-Bearer Authorization header', async () => {
    const res = await request(app)
      .post('/auth/register')
      .set('authorization', 'Basic Z3JhY2U6YmF0dGVyeQ==')
      .send(REGISTER_BODY);

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('echoes the incoming x-request-id on its own 401 body', async () => {
    const res = await request(app)
      .post('/auth/register')
      .set('authorization', 'Bearer not-a-token')
      .set('x-request-id', 'register-request-id')
      .send(REGISTER_BODY);

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).requestId).toBe('register-request-id');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
