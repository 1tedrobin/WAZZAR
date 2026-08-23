import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GeocodeSearchQueryDto } from './dto/geocode-search-query.dto';
import { GeocodingService } from './geocoding.service';

@ApiTags('Geocoding')
@ApiBearerAuth('access-token')
@Controller('geocode')
@UseGuards(JwtAuthGuard)
export class GeocodingController {
  constructor(private readonly geocodingService: GeocodingService) {}

  // GET /geocode/search?q=...&countryCode=tz — any authenticated user.
  // Backs address-autocomplete in the customer app (pickup/dropoff),
  // replacing the fixed mock suggestion list. See
  // MASTER_GAPS_AND_ROADMAP.md ("Geocoding / places-search endpoint").
  @Get('search')
  search(@Query() query: GeocodeSearchQueryDto) {
    return this.geocodingService.search(query.q, query.countryCode);
  }
}
