export interface ServiceConfig {
  port: number;
  env: string;
  serviceKey: string;
  authServiceUrl: string;
  catalogServiceUrl: string;
  memberServiceUrl: string;
  loanServiceUrl: string;
  reportingServiceUrl: string;
  jwtSecret: string;
}

export const config: ServiceConfig = {
  port: Number(process.env.PORT) || 3000,
  env: process.env.NODE_ENV || 'development',
  serviceKey: process.env.SERVICE_KEY || 'dev-service-key',
  authServiceUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  catalogServiceUrl: process.env.CATALOG_SERVICE_URL || 'http://localhost:3002',
  memberServiceUrl: process.env.MEMBER_SERVICE_URL || 'http://localhost:3003',
  loanServiceUrl: process.env.LOAN_SERVICE_URL || 'http://localhost:3004',
  reportingServiceUrl: process.env.REPORTING_SERVICE_URL || 'http://localhost:3005',
  jwtSecret: process.env.JWT_SECRET || 'development-insecure-secret',
};
