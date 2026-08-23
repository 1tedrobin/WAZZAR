import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../database/entities/user-role.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { AddMessageDto } from './dto/add-message.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListMyTicketsQueryDto } from './dto/list-my-tickets-query.dto';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { SupportService } from './support.service';

// Every route requires a valid token. The /support/tickets/* routes have
// no @Roles() — any authenticated CUSTOMER/RIDER/BUSINESS can raise a
// ticket, unlike e.g. ScheduledDeliveriesController which is BUSINESS-
// only. The /support/admin/* routes are @Roles(ADMIN, SUPER_ADMIN),
// registered as their own static-prefixed group before the ':id' routes
// so 'admin' is never swallowed as a ticket id — same ordering reasoning
// as PaymentsController's 'reconcile/:date'.
@ApiTags('Support')
@ApiBearerAuth('access-token')
@Controller('support')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SupportController {
  constructor(private readonly service: SupportService) {}

  @Post('tickets')
  create(@Body() dto: CreateTicketDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(user.sub, user.roles, dto);
  }

  @Get('tickets')
  listOwn(@Query() query: ListMyTicketsQueryDto, @CurrentUser() user: JwtPayload) {
    return this.service.listOwn(user.sub, query);
  }

  @Get('admin/tickets')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  listAll(@Query() query: ListTicketsQueryDto) {
    return this.service.listAll(query);
  }

  @Get('admin/tickets/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  getAdmin(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getAdmin(id);
  }

  @Patch('admin/tickets/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto) {
    return this.service.update(id, dto);
  }

  @Post('admin/tickets/:id/messages')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  addAdminMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.addAdminMessage(user.sub, id, user.roles, dto);
  }

  @Get('tickets/:id')
  getOwn(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.service.getOwn(user.sub, id);
  }

  @Post('tickets/:id/messages')
  replyOwn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.replyOwn(user.sub, id, user.roles, dto);
  }
}
