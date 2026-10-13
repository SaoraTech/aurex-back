import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module';
import { AUTH } from './auth/auth.constants';
import { validateEnv } from './config/env';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { JsonLogger } from './common/json-logger';
import { requestContext } from './common/request-context';
import { ArcjetService } from './security/arcjet.service';
import { authProtection } from './security/auth-protect.middleware';

async function bootstrap() {
  const env = validateEnv();
  const logger = new JsonLogger(env.LOG_LEVEL);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger });
  const config = app.get(ConfigService);
  const http = new Logger('Bootstrap');

  // Only proxies listed in TRUSTED_PROXIES may set the client IP (X-Forwarded-For). With none configured the socket
  // address is used, so a client cannot spoof its IP to dodge rate limits. Behind a load balancer you MUST set it.
  const proxies = config.get<string[]>('trustedProxies') ?? [];
  app.set('trust proxy', proxies.length ? proxies : false);
  if (!proxies.length && env.NODE_ENV === 'production') http.warn({ msg: 'trusted_proxies_empty', detail: 'Behind a load balancer all clients will share its IP; set TRUSTED_PROXIES.' });

  // 1) correlation id + access log (first middleware)
  app.use(requestContext({ log: m => logger.log(m, 'Http') }));

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));

  const swaggerEnabled = env.SWAGGER_ENABLED ? env.SWAGGER_ENABLED === 'true' : env.NODE_ENV !== 'production';
  app.use(helmet({ contentSecurityPolicy: swaggerEnabled ? false : undefined, crossOriginEmbedderPolicy: false }));
  const origins = (config.get<string>('corsOrigin') ?? '').split(',').map(v => v.trim()).filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : false, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id', 'X-File-Name', 'X-File-Content-Type'],
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'X-Aurex-Audio-Provider', 'X-Aurex-Audio-Fallback'],
  });

  // 2) Better Auth routes are served outside Nest's router: protect them with Arcjet, then mount the handler
  //    BEFORE any body parser. `app.all` (not `app.use`) keeps the full original URL for Better Auth's base path.
  const express_ = app.getHttpAdapter().getInstance() as express.Express;
  express_.use('/api/auth', authProtection(app.get(ArcjetService)));
  express_.all('/api/auth/*splat', toNodeHandler(app.get(AUTH)));

  // 3) Raw-body routes (binary uploads) with explicit hard limits, then JSON/urlencoded parsers.
  const uploadMax = config.get<number>('uploadMaxBytes') ?? 26214400;
  const audioMax = config.get<number>('audioMaxUploadBytes') ?? 20971520;
  app.use('/api/v1/library/documents', (req: express.Request, res: express.Response, next: express.NextFunction) => (req.method === 'POST' ? express.raw({ type: () => true, limit: uploadMax })(req, res, next) : next()));
  app.use('/api/v1/audio/transcriptions', express.raw({ type: () => true, limit: audioMax }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  if (swaggerEnabled) {
    const swagger = new DocumentBuilder().setTitle('Aurex API').setDescription('API commune aux clients Web, Android, iOS et Desktop.').setVersion('1.0.0').addBearerAuth().build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));
  }

  app.enableShutdownHooks();
  await app.listen(config.get<number>('port') ?? 3000, '0.0.0.0');
  http.log({ msg: 'listening', port: config.get('port'), env: env.NODE_ENV, arcjetMode: config.get('arcjetMode') });
}
void bootstrap();
