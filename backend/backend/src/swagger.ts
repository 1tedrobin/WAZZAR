import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// Mounted at GET /docs (Swagger UI) and GET /docs-json (raw OpenAPI
// document) — see main.ts. Most of the per-route detail (parameter
// types, DTO shapes, operation summaries) comes for free from the
// @nestjs/swagger CLI plugin enabled in nest-cli.json, which reads the
// existing `// POST /riders — ...`-style comments most controllers
// already had above each handler (introspectComments: true) rather
// than requiring @ApiOperation/@ApiProperty hand-written on every DTO
// field. @ApiTags on each controller (added alongside this file) is
// what actually needs to be hand-added, since the plugin can't infer
// how routes should be grouped in the UI.
//
// SWAGGER_ENABLED controls whether this mounts, following the same
// secure-by-default-in-production shape as security-checks.ts:
//   - NODE_ENV=production: docs are NOT mounted unless SWAGGER_ENABLED
//     is explicitly set to "true". A public, unauthenticated map of
//     every route + payload shape is exactly the kind of thing that
//     should be an opt-in decision for a real deployment, not a default.
//   - any other NODE_ENV (local/dev/staging/test/unset): docs ARE
//     mounted unless SWAGGER_ENABLED is explicitly set to "false".
// Calling the routes still requires the normal auth (bearer JWT + role
// guard) either way — this only controls whether the *map* of routes is
// publicly browsable.
export function setupSwagger(app: INestApplication): boolean {
  const isProduction = process.env.NODE_ENV === 'production';
  const enabled = isProduction
    ? process.env.SWAGGER_ENABLED === 'true'
    : process.env.SWAGGER_ENABLED !== 'false';

  if (!enabled) {
    return false;
  }

  const config = new DocumentBuilder()
    .setTitle('WAZZAR API')
    .setDescription(
      'Logistics/parcel delivery platform backend — customers, riders, ' +
        'dispatch, payments, tracking, and admin operations. Most routes ' +
        'require a Bearer JWT (obtained from POST /auth/login) and, for ' +
        'admin/business routes, a specific role — see each route\'s ' +
        '"Authorize" requirement below.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token from POST /auth/login or POST /auth/register',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });
  return true;
}
