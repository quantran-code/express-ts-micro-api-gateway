import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from './app';
import { signTestToken } from './test/tokens';

interface ErrorBody {
  error: string;
  requestId: string;
}

const CATALOG_URL = 'http://localhost:3002';
const MEMBER_URL = 'http://localhost:3003';
const LOAN_URL = 'http://localhost:3004';
const REPORTING_URL = 'http://localhost:3005';

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

describe('proxied routes', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const forwardCases = [
    { path: '/books/1?page=2', baseUrl: CATALOG_URL },
    { path: '/members/7', baseUrl: MEMBER_URL },
    { path: '/loans?overdue=true', baseUrl: LOAN_URL },
    { path: '/reports/most-borrowed', baseUrl: REPORTING_URL },
  ];

  it.each(forwardCases)(
    'forwards $path to $baseUrl with the original method, path and query string',
    async ({ path, baseUrl }) => {
      fetchMock.mockResolvedValue(jsonResponse({ forwarded: true }));

      const res = await request(app)
        .get(path)
        .set('authorization', `Bearer ${memberToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ forwarded: true });

      const call = readCall(fetchMock);
      expect(call.url).toBe(`${baseUrl}${path}`);
      expect(call.method).toBe('GET');
    },
  );

  it('relays an upstream error body unchanged, including its own requestId', async () => {
    const upstreamBody = { error: 'Book not found', requestId: 'catalog-request-id' };
    fetchMock.mockResolvedValue(jsonResponse(upstreamBody, 404));

    const res = await request(app)
      .get('/books/999')
      .set('authorization', `Bearer ${memberToken()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(upstreamBody);
  });

  it('relays an upstream error body that carries no requestId without adding one', async () => {
    const upstreamBody = { error: 'Report upstream unavailable' };
    fetchMock.mockResolvedValue(jsonResponse(upstreamBody, 502));

    const res = await request(app)
      .get('/reports/overdue-summary')
      .set('authorization', `Bearer ${memberToken()}`);

    expect(res.status).toBe(502);
    expect(res.body).toEqual(upstreamBody);
  });

  it('relays a successful upstream body unchanged', async () => {
    const upstreamBody = { data: [{ id: 1, title: 'Dune' }] };
    fetchMock.mockResolvedValue(jsonResponse(upstreamBody, 201));

    const res = await request(app)
      .get('/books')
      .set('authorization', `Bearer ${memberToken()}`);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(upstreamBody);
  });

  it('sends the service key and the incoming request id upstream', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    await request(app)
      .get('/books')
      .set('authorization', `Bearer ${memberToken()}`)
      .set('x-request-id', 'incoming-request-id');

    const { headers } = readCall(fetchMock);
    expect(headers['x-service-key']).toBe('dev-service-key');
    expect(headers['x-request-id']).toBe('incoming-request-id');
  });

  it('generates a request id upstream when the incoming request has none', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    await request(app)
      .get('/books')
      .set('authorization', `Bearer ${memberToken()}`);

    expect(readCall(fetchMock).headers['x-request-id']).toMatch(UUID_PATTERN);
  });

  it('forwards the user headers when the token carries a member id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    await request(app)
      .get('/members/3')
      .set('authorization', `Bearer ${memberToken()}`);

    const { headers } = readCall(fetchMock);
    expect(headers['x-user-id']).toBe('3');
    expect(headers['x-user-role']).toBe('member');
    expect(headers['x-user-member-id']).toBe('42');
  });

  it('omits x-user-member-id when the token has no member id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    const token = signTestToken({ sub: 9, role: 'librarian', memberId: null });

    await request(app).get('/books').set('authorization', `Bearer ${token}`);

    const { headers } = readCall(fetchMock);
    expect(headers['x-user-id']).toBe('9');
    expect(headers['x-user-role']).toBe('librarian');
    expect(headers).not.toHaveProperty('x-user-member-id');
  });

  it('forwards the JSON body for a state-changing request', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 5 }, 201));

    const res = await request(app)
      .post('/books')
      .set('authorization', `Bearer ${memberToken()}`)
      .send({ title: 'Dune' });

    expect(res.status).toBe(201);
    const call = readCall(fetchMock);
    expect(call.method).toBe('POST');
    expect(call.headers['content-type']).toBe('application/json');
    expect(JSON.parse(String(call.body))).toEqual({ title: 'Dune' });
  });

  it('answers 401 without proxying when no token is sent', async () => {
    const res = await request(app).get('/books');

    expect(res.status).toBe(401);
    const body = res.body as ErrorBody;
    expect(Object.keys(body).sort()).toEqual(['error', 'requestId']);
    expect(body.requestId.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 401 without proxying for a malformed token', async () => {
    const res = await request(app)
      .get('/members/1')
      .set('authorization', 'Bearer not-a-token');

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
      .get('/loans')
      .set('authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).requestId.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('echoes the incoming x-request-id on its own 401 body', async () => {
    const res = await request(app)
      .get('/reports/overdue-summary')
      .set('x-request-id', 'proxy-request-id');

    expect(res.status).toBe(401);
    expect((res.body as ErrorBody).requestId).toBe('proxy-request-id');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still answers 404 for a path that no backing service owns', async () => {
    const res = await request(app).get('/orders/1');

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).error).toBe('Not Found');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 502 with its own error and requestId when the upstream call fails', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await request(app)
      .get('/books')
      .set('authorization', `Bearer ${memberToken()}`)
      .set('x-request-id', 'gateway-request-id');

    expect(res.status).toBe(502);
    const body = res.body as ErrorBody;
    expect(Object.keys(body).sort()).toEqual(['error', 'requestId']);
    expect(body.requestId).toBe('gateway-request-id');
  });

  it('answers 502 when the upstream body is not JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>oops</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const res = await request(app)
      .get('/books')
      .set('authorization', `Bearer ${memberToken()}`);

    expect(res.status).toBe(502);
    expect((res.body as ErrorBody).error).toBe('Bad Gateway');
    expect((res.body as ErrorBody).requestId.length).toBeGreaterThan(0);
  });
});
