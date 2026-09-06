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
import { AdminStaffModule } from './modules/admin-staff/admin-staff.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { BulkShipmentsModule } from './modules/bulk-shipments/bulk-shipments.module';
import { BusinessApiKeysModule } from './modules/business-api-keys/business-api-keys.module';
import { BusinessCustomersModule } from './modules/business-customers/business-customers.module';
import { BusinessProfileModule } from './modules/business-profile/business-profile.module';
import { BusinessStaffModule } from './modules/business-staff/business-staff.module';
import { CarriersModule } from './modules/carriers/carriers.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { GeocodingModule } from './modules/geocoding/geocoding.module';
import { HealthModule } from './modules/health/health.module';
import { HubsModule } from './modules/hubs/hubs.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { LegsModule } from './modules/legs/legs.module';
import { PartnerOperatorsModule } from './modules/partner-operators/partner-operators.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { RidersModule } from './modules/riders/riders.module';
import { ScheduledDeliveriesModule } from './modules/scheduled-deliveries/scheduled-deliveries.module';
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { SupportModule } from './modules/support/support.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { TrackingChannelsModule } from './modules/tracking-channels/tracking-channels.module';
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
    // Global — registers @Cron()/@Interval() support app-wide. Used by
    // ScheduledDeliveriesCronService and Phase 2's LatraPollingService —
    // this only needs to be imported once regardless of how many modules
    // end up with their own cron jobs.
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
    AdminStaffModule,
    BusinessApiKeysModule,
    PublicApiModule,
    InvoicesModule,
    AnalyticsModule,
    BulkShipmentsModule,
    // Phase 2 (Intercity/Trunk Network) — see
    // docs/delivery-notes/PHASE2_INTERCITY_FOUNDATION.md for the whole
    // pass. HubsModule/PartnerOperatorsModule/CarriersModule are the new
    // Phase 2 entities' CRUD; LegsModule is the core (plans/drives
    // intercity shipments); TrackingChannelsModule ingests trunk-leg
    // tracking pings (including the LATRA adapter) on top of it. This
    // supersedes an earlier, minimal CargoCompanies/TransportLegs slice
    // (admin CRUD only, nothing wired into real shipment flow) — removed
    // rather than kept alongside, to avoid two competing notions of
    // "cargo company" and "leg" in the same codebase.
    HubsModule,
    PartnerOperatorsModule,
    CarriersModule,
    LegsModule,
    TrackingChannelsModule,
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