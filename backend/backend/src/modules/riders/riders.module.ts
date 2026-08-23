import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Rider } from '../../database/entities/rider.entity';
import { Shipment } from '../../database/entities/shipment.entity';
import { RidersController } from './riders.controller';
import { RidersService } from './riders.service';

@Module({
  // Shipment is read-only here (rider earnings) — RidersModule doesn't
  // own Shipment and doesn't write to it; ShipmentsModule remains the
  // sole writer, same as the pre-existing ridersRepo read inside
  // ShipmentsService.
  imports: [TypeOrmModule.forFeature([Rider, Shipment])],
  controllers: [RidersController],
  providers: [RidersService],
})
export class RidersModule {}
