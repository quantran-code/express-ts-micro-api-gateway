import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError } from './httpError';
import { resolveRequestId } from '../requestId';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: 'Not Found', requestId: resolveRequestId(req) });
};

// eslint-disable-next-line no-unused-vars
export const errorHandler: ErrorRequestHandler = (err: Error, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    requestId: resolveRequestId(req),
  });
};
