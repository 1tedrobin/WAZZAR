import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '../../database/entities/user-role.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { AnalyticsService } from './analytics.service';
import { AnalyticsSummaryQueryDto } from './dto/analytics-summary-query.dto';

@ApiTags('Business — Analytics')
@ApiBearerAuth('access-token')
@Controller('business/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BUSINESS)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  getSummary(@Query() query: AnalyticsSummaryQueryDto, @CurrentUser() user: JwtPayload) {
    return this.analyticsService.getSummary(user.sub, query);
  }
}
