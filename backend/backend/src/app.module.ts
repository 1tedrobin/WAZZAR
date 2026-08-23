import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from './database/data-source';
import { envFilePaths } from './env-file';
import { AdminBusinessesModule } from './modules/admin-businesses/admin-businesses.module';
import { AdminCustomersModule } from './modules/admin-customers/admin-customers.module';
import { AuthModule } from './modules/auth/auth.module';
import { BusinessCustomersModule } from './modules/business-customers/business-customers.module';
import { BusinessProfileModule } from './modules/business-profile/business-profile.module';
import { BusinessStaffModule } from './modules/business-staff/business-staff.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { GeocodingModule } from './modules/geocoding/geocoding.module';
import { HealthModule } from './modules/health/health.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { RidersModule } from './modules/riders/riders.module';
import { ScheduledDeliveriesModule } from './modules/scheduled-deliveries/scheduled-deliveries.module';
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { SupportModule } from './modules/support/support.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { UploadsModule } from './modules/uploads/uploads.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // NODE_ENV=staging/production load .env.staging/.env.production
      // first, falling back to .env for anything not overridden there —
      // see env-file.ts for the exact precedence and why this exists.
      envFilePath: envFilePaths(),
    }),
    // Global default: 60 requests per 60 seconds per IP. Individual
    // endpoints (currently auth's login/register/refresh) override this
    // with a stricter limit via @Throttle() — see auth.controller.ts.
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 60,
      },
    ]),
    TypeOrmModule.forRoot(dataSourceOptions),
    // Global — registers @Cron()/@Interval() support app-wide. Only
    // ScheduledDeliveriesCronService uses it today, but this only needs
    // to be imported once regardless of how many modules end up with
    // their own cron jobs later.
    ScheduleModule.forRoot(),
    HealthModule,
    AuthModule,
    RidersModule,
    ShipmentsModule,
    TrackingModule,
    DispatchModule,
    PricingModule,
    PaymentsModule,
    UploadsModule,
    GeocodingModule,
    BusinessCustomersModule,
    BusinessProfileModule,
    BusinessStaffModule,
    ScheduledDeliveriesModule,
    SupportModule,
    AdminBusinessesModule,
    AdminCustomersModule,
    // Future modules go here as vertical slices are built: UsersModule, ...
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
