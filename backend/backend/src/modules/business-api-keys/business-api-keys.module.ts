import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey } from '../../database/entities/api-key.entity';
import { BusinessApiKeysController } from './business-api-keys.controller';
import { BusinessApiKeysService } from './business-api-keys.service';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey])],
  controllers: [BusinessApiKeysController],
  providers: [BusinessApiKeysService],
  // Exported so PublicApiModule's ApiKeyAuthGuard can validate keys
  // presented against the public API without a second, duplicate
  // TypeOrmModule.forFeature([ApiKey]) registration elsewhere.
  exports: [BusinessApiKeysService],
})
export class BusinessApiKeysModule {}
