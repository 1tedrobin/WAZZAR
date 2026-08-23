import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../database/entities/user-role.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { ScheduledDeliveriesService } from './scheduled-deliveries.service';
import { CreateScheduledDeliveryDto } from './dto/create-scheduled-delivery.dto';
import { UpdateScheduledDeliveryDto } from './dto/update-scheduled-delivery.dto';

// Every route is scoped to the calling business's own schedules — same
// ownership pattern as BusinessCustomersController, no cross-business
// admin view here either. There is deliberately no "run now" or
// "preview next shipment" route: firing a schedule is exclusively the
// cron job's job (ScheduledDeliveriesCronService) so there's exactly
// one code path that ever creates a shipment from a schedule.
@ApiTags('Business — Scheduled Deliveries')
@ApiBearerAuth('access-token')
@Controller('business/scheduled-deliveries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BUSINESS)
export class ScheduledDeliveriesController {
  constructor(private readonly service: ScheduledDeliveriesService) {}

  @Post()
  create(@Body() dto: CreateScheduledDeliveryDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user.sub);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScheduledDeliveryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(user.sub, id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(user.sub, id);
  }
}
