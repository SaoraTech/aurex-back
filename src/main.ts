import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module';
import { AUTH } from './auth/auth.constants';
import { validateEnv } from './config/env';

async function bootstrap() {
  validateEnv();
  const app = await NestFactory.create(AppModule, { bodyParser: false, bufferLogs: true });
  const config = app.get(ConfigService);
  const auth = app.get(AUTH);

  app.setGlobalPrefix('api/v1', { exclude: ['api/auth/(.*)'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  const origins = (config.get<string>('CORS_ORIGIN') ?? '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Better Auth must receive the raw request before the general JSON parser.
  app.use('/api/auth', toNodeHandler(auth));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  const swagger = new DocumentBuilder()
    .setTitle('Aurex API')
    .setDescription('API centrale pour Aurex Web, Android/Kotlin, iOS/Swift, Desktop et SDKs.')
    .setVersion('1.1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  app.enableShutdownHooks();
  await app.listen(config.get<number>('PORT', 3000), '0.0.0.0');
}
void bootstrap();
