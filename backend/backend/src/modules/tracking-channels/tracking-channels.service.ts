import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Leg, LegType } from '../../database/entities/leg.entity';
import { PartnerOperator } from '../../database/entities/partner-operator.entity';
import {
  TrackingChannel,
  TrackingChannelType,
} from '../../database/entities/tracking-channel.entity';
import { TrackingEvent, TrackingEventType } from '../../database/entities/tracking-event.entity';
import { Role } from '../../database/entities/user-role.entity';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { CarriersService } from '../carriers/carriers.service';
import { HubsService } from '../hubs/hubs.service';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { IngestPartnerPingDto } from './dto/ingest-partner-ping.dto';
import { IngestTrackingChannelDto } from './dto/ingest-tracking-channel.dto';

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN];

@Injectable()
export class TrackingChannelsService {
  constructor(
    @InjectRepository(TrackingChannel)
    private readonly channelsRepo: Repository<TrackingChannel>,
    @InjectRepository(TrackingEvent)
    private readonly eventsRepo: Repository<TrackingEvent>,
    @InjectRepository(Leg)
    private readonly legsRepo: Repository<Leg>,
    private readonly hubsService: HubsService,
    private readonly carriersService: CarriersService,
    private readonly gateway: TrackingGateway,
  ) {}

  // POST /tracking-channels — a WAZZAR dispatcher/admin manually logging
  // a tracking update (e.g. a phone call from a bus driver, relayed by
  // hand). Same hub-scoping as LegsService's dispatcher actions.
  async ingestManual(dto: IngestTrackingChannelDto, requester: JwtPayload): Promise<TrackingChannel> {
    const leg = await this.findLegOrThrow(dto.legId);
    await this.assertDispatcherHubAccess(leg, requester);

    return this.recordChannelEvent(leg, dto.channelType, dto.source ?? null, dto.eventData);
  }

  // POST /tracking-channels/partner-ping — an external partner
  // operator's own system, authenticated via PartnerApiKeyGuard (see
  // that guard's header comment). Scoped so a partner can only ingest
  // pings for a leg whose TRUNK carrier is actually one of their own —
  // the API key alone proves *which* partner is calling, not that this
  // specific leg belongs to them.
  async ingestPartnerPing(
    dto: IngestPartnerPingDto,
    partnerOperator: PartnerOperator,
  ): Promise<TrackingChannel> {
    const leg = await this.findLegOrThrow(dto.legId);

    if (leg.legType !== LegType.TRUNK || !leg.carrierId) {
      throw new ForbiddenException('Partner pings are only accepted for an assigned TRUNK leg');
    }
    const carrier = await this.carriersService.findOne(leg.carrierId);
    if (carrier.partnerOperatorId !== partnerOperator.id) {
      throw new ForbiddenException('This leg is not assigned to one of your carriers');
    }

    return this.recordChannelEvent(
      leg,
      dto.channelType,
      dto.source ?? partnerOperator.name,
      dto.eventData,
    );
  }

  async list(legId: string): Promise<TrackingChannel[]> {
    return this.channelsRepo.find({ where: { legId }, order: { createdAt: 'DESC' } });
  }

  async listEvents(legId: string): Promise<TrackingEvent[]> {
    return this.eventsRepo.find({ where: { legId }, order: { createdAt: 'ASC' } });
  }

  // Shared ingestion primitive — also called directly by
  // LatraPollingService (a system actor, not a request, so it skips the
  // guarded ingestManual/ingestPartnerPing wrappers above and their
  // per-request authorization checks entirely).
  //
  // Always writes the raw TrackingChannel row (the audit log of "a ping
  // arrived"). Only derives + broadcasts a normalized LOCATION_UPDATE
  // TrackingEvent when eventData actually carries numeric
  // latitude/longitude — a bare status ping with no coordinates (e.g. a
  // dispatcher's manual note) is still logged, just doesn't fabricate a
  // location.
  async recordChannelEvent(
    leg: Leg,
    channelType: TrackingChannelType,
    source: string | null,
    eventData: Record<string, unknown>,
  ): Promise<TrackingChannel> {
    const channel = this.channelsRepo.create({ legId: leg.id, channelType, source, eventData });
    const saved = await this.channelsRepo.save(channel);

    const latitude = typeof eventData.latitude === 'number' ? eventData.latitude : null;
    const longitude = typeof eventData.longitude === 'number' ? eventData.longitude : null;

    if (latitude !== null && longitude !== null) {
      const event = this.eventsRepo.create({
        legId: leg.id,
        eventType: TrackingEventType.LOCATION_UPDATE,
        metadata: { latitude, longitude, channelType, source },
      });
      await this.eventsRepo.save(event);

      // Additive push over the existing Socket.IO gateway — see
      // TrackingGateway.broadcastLegUpdate's header comment.
      this.gateway.broadcastLegUpdate(leg.shipmentId, {
        legId: leg.id,
        sequence: leg.sequence,
        legType: leg.legType,
        latitude,
        longitude,
        channelType,
      });
    }

    saved.processedAt = new Date();
    return this.channelsRepo.save(saved);
  }

  private async assertDispatcherHubAccess(leg: Leg, requester: JwtPayload): Promise<void> {
    if (requester.roles.some((role) => ADMIN_ROLES.includes(role))) {
      return;
    }
    if (!requester.roles.includes(Role.DISPATCHER)) {
      throw new ForbiddenException('Only a dispatcher or admin can log a tracking update');
    }

    const assignedHubIds = await this.hubsService.findAssignedHubIds(requester.sub);
    const touchesAssignedHub =
      (leg.fromHubId && assignedHubIds.includes(leg.fromHubId)) ||
      (leg.toHubId && assignedHubIds.includes(leg.toHubId));
    if (!touchesAssignedHub) {
      throw new ForbiddenException('You are not assigned to a hub this leg touches');
    }
  }

  private async findLegOrThrow(id: string): Promise<Leg> {
    const leg = await this.legsRepo.findOne({ where: { id } });
    if (!leg) {
      throw new NotFoundException(`Leg ${id} not found`);
    }
    return leg;
  }
}
