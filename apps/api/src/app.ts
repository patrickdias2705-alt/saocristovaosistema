import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { Database } from './db';
import type { Config } from './config';
import { AuthService, AuthGuard } from './auth';
import { PackageService } from './packages';
import { OCRService } from './ocr';
import { AdminService } from './admin';
import { NotificationWorker, FakeWhatsAppProvider, MetaWhatsAppProvider } from './notifications';
import { SessionController, OperationsController, WebhookController, SafeErrors } from './http';
export async function createApplication(config: Config, db: Database) {
  const packages = new PackageService(db, config);
  const ocr = new OCRService(packages);
  const worker = new NotificationWorker(
    db,
    config,
    config.WHATSAPP_PROVIDER === 'meta'
      ? new MetaWhatsAppProvider(config)
      : new FakeWhatsAppProvider(),
  );
  @Module({
    controllers: [SessionController, OperationsController, WebhookController],
    providers: [
      AuthGuard,
      { provide: 'CONFIG', useValue: config },
      { provide: AuthService, useValue: new AuthService(db, config) },
      { provide: PackageService, useValue: packages },
      { provide: OCRService, useValue: ocr },
      { provide: AdminService, useValue: new AdminService(db) },
      { provide: NotificationWorker, useValue: worker },
    ],
  })
  class AppModule {}
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: false,
    bodyParser: true,
  });
  if (process.env.VERCEL) app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({
    origin: config.WEB_ORIGIN,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Condominium-Id'],
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = randomUUID();
    res.setHeader('X-Request-Id', id);
    res.setHeader('Cache-Control', 'no-store');
    const start = Date.now();
    res.on('finish', () => {
      if (config.NODE_ENV !== 'test')
        console.log(
          JSON.stringify({
            level: 'info',
            requestId: id,
            method: req.method,
            status: res.statusCode,
            durationMs: Date.now() - start,
          }),
        );
    });
    next();
  });
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { message: 'Muitas requisições. Aguarde um minuto.' },
    }),
  );
  app.useGlobalFilters(new SafeErrors());
  if (config.NODE_ENV !== 'production')
    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('São Cristóvão Entregas')
          .setVersion('0.1.0')
          .addBearerAuth()
          .build(),
      ),
    );
  await app.init();
  return { app, worker, ocr, packages };
}
