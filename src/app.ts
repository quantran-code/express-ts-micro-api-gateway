import express, { Request, Response } from 'express';
import { errorHandler, notFoundHandler } from './errors/handlers';
import { authRouter } from './routes/auth';
import { proxyRouter } from './routes/proxy';

const app = express();

app.use(express.json());

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Auth routes are mounted before any token gate: /auth/login never requires a
// token and /auth/register only validates an Authorization header when present.
app.use('/auth', authRouter);

// Proxied routes: each mounted prefix requires a valid, unexpired bearer token
// before anything is forwarded to a backing service.
app.use(proxyRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
