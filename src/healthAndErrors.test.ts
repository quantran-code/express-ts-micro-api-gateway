import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from './app';
import { errorHandler, notFoundHandler } from './errors/handlers';
import { HttpError } from './errors/httpError';

interface ErrorBody {
  error: string;
  requestId: string;
}

const CONFIG_ENV_VARS = [
  'NODE_ENV',
  'PORT',
  'SERVICE_KEY',
  'JWT_SECRET',
  'AUTH_SERVICE_URL',
  'CATALOG_SERVICE_URL',
  'MEMBER_SERVICE_URL',
  'LOAN_SERVICE_URL',
  'REPORTING_SERVICE_URL',
] as const;

describe('config', () => {
  const originalValues: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of CONFIG_ENV_VARS) {
      originalValues[name] = process.env[name];
    }
  });

  afterEach(() => {
    for (const name of CONFIG_ENV_VARS) {
      const original = originalValues[name];
      if (original === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = original;
      }
    }
    vi.resetModules();
  });

  it('falls back to the documented defaults when the env vars are unset', async () => {
    for (const name of CONFIG_ENV_VARS) {
      delete process.env[name];
    }
    vi.resetModules();

    const { config } = await import('./config');

    expect(config.port).toBe(3000);
    expect(config.env).toBe('development');
    expect(config.serviceKey).toBe('dev-service-key');
    expect(config.jwtSecret).toBe('development-insecure-secret');
    expect(config.authServiceUrl).toBe('http://localhost:3001');
    expect(config.catalogServiceUrl).toBe('http://localhost:3002');
    expect(config.memberServiceUrl).toBe('http://localhost:3003');
    expect(config.loanServiceUrl).toBe('http://localhost:3004');
    expect(config.reportingServiceUrl).toBe('http://localhost:3005');
  });

  it('resolves every value from its environment variable', async () => {
    process.env.PORT = '4000';
    process.env.SERVICE_KEY = 'shared-service-key';
    process.env.JWT_SECRET = 'shared-jwt-secret';
    process.env.AUTH_SERVICE_URL = 'http://auth.test:9001';
    process.env.CATALOG_SERVICE_URL = 'http://catalog.test:9002';
    process.env.MEMBER_SERVICE_URL = 'http://member.test:9003';
    process.env.LOAN_SERVICE_URL = 'http://loan.test:9004';
    process.env.REPORTING_SERVICE_URL = 'http://reporting.test:9005';
    vi.resetModules();

    const { config } = await import('./config');

    expect(config.port).toBe(4000);
    expect(config.serviceKey).toBe('shared-service-key');
    expect(config.jwtSecret).toBe('shared-jwt-secret');
    expect(config.authServiceUrl).toBe('http://auth.test:9001');
    expect(config.catalogServiceUrl).toBe('http://catalog.test:9002');
    expect(config.memberServiceUrl).toBe('http://member.test:9003');
    expect(config.loanServiceUrl).toBe('http://loan.test:9004');
    expect(config.reportingServiceUrl).toBe('http://reporting.test:9005');
  });
});

describe('GET /health', () => {
  const originalCatalogUrl = process.env.CATALOG_SERVICE_URL;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalCatalogUrl === undefined) {
      delete process.env.CATALOG_SERVICE_URL;
    } else {
      process.env.CATALOG_SERVICE_URL = originalCatalogUrl;
    }
  });

  it('answers 200 locally and never proxies, even with the service URLs configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.CATALOG_SERVICE_URL = 'http://catalog.test:9002';

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('404 handler', () => {
  it('answers 404 with exactly an error and a requestId', async () => {
    const res = await request(app).get('/definitely-not-a-route');

    expect(res.status).toBe(404);
    const body = res.body as ErrorBody;
    expect(Object.keys(body).sort()).toEqual(['error', 'requestId']);
    expect(body.error).toBe('Not Found');
    expect(typeof body.requestId).toBe('string');
    expect(body.requestId.length).toBeGreaterThan(0);
  });

  it('echoes a non-empty incoming x-request-id', async () => {
    const res = await request(app)
      .get('/definitely-not-a-route')
      .set('x-request-id', 'incoming-request-id');

    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).requestId).toBe('incoming-request-id');
  });

  it('generates its own requestId when the header is absent', async () => {
    const res = await request(app).get('/definitely-not-a-route');

    const { requestId } = res.body as ErrorBody;
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('generates its own requestId when the header is empty', async () => {
    const res = await request(app)
      .get('/definitely-not-a-route')
      .set('x-request-id', '');

    expect((res.body as ErrorBody).requestId.length).toBeGreaterThan(0);
  });
});

describe('error handler', () => {
  function buildErrorApp() {
    const errorApp = express();
    errorApp.use(express.json());

    errorApp.get('/teapot', () => {
      throw new HttpError(418, 'Brewing is not available');
    });

    errorApp.get('/failure', () => {
      throw new Error('Something exploded');
    });

    errorApp.use(notFoundHandler);
    errorApp.use(errorHandler);

    return errorApp;
  }

  it('keeps the HttpError status and message and adds a requestId', async () => {
    const res = await request(buildErrorApp()).get('/teapot');

    expect(res.status).toBe(418);
    const body = res.body as ErrorBody;
    expect(Object.keys(body).sort()).toEqual(['error', 'requestId']);
    expect(body.error).toBe('Brewing is not available');
    expect(body.requestId.length).toBeGreaterThan(0);
  });

  it('echoes a non-empty incoming x-request-id on an error', async () => {
    const res = await request(buildErrorApp())
      .get('/failure')
      .set('x-request-id', 'error-request-id');

    expect(res.status).toBe(500);
    expect((res.body as ErrorBody).requestId).toBe('error-request-id');
  });

  it('answers 500 for a non-HttpError and generates a requestId', async () => {
    const res = await request(buildErrorApp()).get('/failure');

    expect(res.status).toBe(500);
    const body = res.body as ErrorBody;
    expect(body.error).toBe('Something exploded');
    expect(body.requestId.length).toBeGreaterThan(0);
  });
});
