import express, { Request, Response, NextFunction } from 'express';
import { HttpError } from './errors/httpError';

const app = express();

app.use(express.json());

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', service: 'api-gateway' });
});

// TODO: mount this service's routes here once implemented.

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err.message || 'Internal Server Error' });
});

export default app;
