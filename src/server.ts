import app from './app';
import { config } from './config';

app.listen(config.port, () => {
  console.log(`api-gateway listening on port ${config.port} (${config.env})`);
});
