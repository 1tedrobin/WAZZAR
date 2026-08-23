import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { UploadsService } from './modules/uploads/uploads.service';
import { assertProductionSafeConfig } from './security-checks';
import { corsOrigin } from './cors-origin';
import { setupSwagger } from './swagger';

async function bootstrap() {
  assertProductionSafeConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Preserves the exact raw request bytes (req.rawBody) alongside the
    // normal parsed req.body — needed because real webhook signature
    // verification (Stripe's constructEvent, and to a lesser extent
    // M-Pesa's) must be computed over the exact bytes the provider sent,
    // not a re-serialized JSON.stringify(parsedBody) — those can differ
    // in key order/whitespace and silently fail verification. See
    // payments.controller.ts's two webhook endpoints and
    // webhook-signature.ts.
    rawBody: true,
  });

  app.use(helmet());
  app.enableCors({ origin: corsOrigin(), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown fields
      transform: true, // turn plain JSON into DTO class instances
    }),
  );

  // Serves whatever UploadsService/UploadsController writes to disk
  // (rider onboarding docs, proof-of-delivery photos) back out at
  // /uploads/<filename> — matches the URL UploadsService.buildUrl()
  // hands back. Swap this out (and the multer storage engine in
  // uploads.controller.ts) if/when this moves to S3-compatible
  // storage — see MASTER_GAPS_AND_ROADMAP.md.
  app.useStaticAssets(UploadsService.UPLOADS_DIR, { prefix: '/uploads/' });

  const swaggerEnabled = setupSwagger(app);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  // eslint-disable-next-line no-console
  console.log(`WAZZAR backend listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`Health check: http://localhost:${port}/health`);
  if (swaggerEnabled) {
    // eslint-disable-next-line no-console
    console.log(`API docs: http://localhost:${port}/docs`);
  }
}

bootstrap();
