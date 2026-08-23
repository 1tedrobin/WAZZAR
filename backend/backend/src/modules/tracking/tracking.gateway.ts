import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { corsOrigin } from '../../cors-origin';
import { Rider } from '../../database/entities/rider.entity';
import { RiderLocation } from '../../database/entities/rider-location.entity';
import { Shipment } from '../../database/entities/shipment.entity';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { canAccessShipment } from './tracking-access.util';
import { buildTrackingSnapshot, TrackingSnapshot } from './tracking-snapshot.util';

// Namespace mirrors WAZZAR_SYSTEM_ARCHITECTURE.md's tracking endpoint
// (ws://api.wazzar.tz/api/v1/tracking/shipment/{shipmentId}?token=...),
// adapted to Socket.IO's connect-once model instead of one raw WebSocket
// per shipment: a client connects to /tracking a single time with a
// bearer token, then emits `subscribe`/`unsubscribe` per shipment it
// wants updates for. Each shipment gets its own room (`shipment:{id}`),
// so a customer watching one delivery never sees another customer's
// traffic.
//
// This gateway deliberately does NOT depend on TrackingService — it
// re-fetches what it needs (shipment, caller's rider profile, current
// location) directly, using the same pure canAccessShipment /
// buildTrackingSnapshot helpers TrackingService uses. That keeps the
// dependency graph one-directional: TrackingService -> TrackingGateway
// (to broadcast on a new ping), never the other way.
@WebSocketGateway({ namespace: '/tracking', cors: { origin: corsOrigin(), credentials: true } })
export class TrackingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(Shipment)
    private readonly shipmentsRepo: Repository<Shipment>,
    @InjectRepository(Rider)
    private readonly ridersRepo: Repository<Rider>,
    @InjectRepository(RiderLocation)
    private readonly locationsRepo: Repository<RiderLocation>,
  ) {}

  // Auth happens once at connect time — same bearer token the REST API
  // uses, passed as `auth: { token }` (or a `?token=` query param, for
  // clients that can't set `auth` on connect). No token, or an
  // invalid/expired one, disconnects immediately rather than allowing an
  // anonymous socket to sit around.
  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
      client.data.user = payload;
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(): void {
    // No per-shipment cleanup needed — Socket.IO drops a disconnected
    // socket's room memberships automatically.
  }

  // Client -> server: { shipmentId: string }
  // Server -> client: an immediate `tracking:update` snapshot on success,
  // or an `error` event with a message if the shipmentId is missing,
  // doesn't exist, or the caller can't access it.
  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { shipmentId?: string },
  ): Promise<void> {
    const requester: JwtPayload | undefined = client.data.user;
    const shipmentId = body?.shipmentId;

    if (!requester) {
      client.disconnect(true);
      return;
    }
    if (!shipmentId) {
      client.emit('error', { message: 'shipmentId is required' });
      return;
    }

    const shipment = await this.shipmentsRepo.findOne({ where: { id: shipmentId } });
    if (!shipment) {
      client.emit('error', { message: `Shipment ${shipmentId} not found` });
      return;
    }

    const callerRider = await this.ridersRepo.findOne({ where: { userId: requester.sub } });
    if (!canAccessShipment(shipment, requester, callerRider)) {
      client.emit('error', { message: 'You do not have access to this shipment' });
      return;
    }

    await client.join(this.room(shipmentId));

    // Send a snapshot immediately so the client has something to render
    // without waiting for the rider's next location ping (which can be up
    // to ~30s away — see Foundation 8 in the architecture doc).
    const location = shipment.riderId
      ? await this.locationsRepo.findOne({ where: { riderId: shipment.riderId } })
      : null;
    client.emit('tracking:update', buildTrackingSnapshot(shipment, location));
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { shipmentId?: string },
  ): void {
    if (body?.shipmentId) {
      client.leave(this.room(body.shipmentId));
    }
  }

  // Called by TrackingService after it persists a new rider location.
  // No-op if nobody's subscribed to this shipment's room (Socket.IO just
  // emits to an empty room).
  broadcastToShipment(shipmentId: string, snapshot: TrackingSnapshot): void {
    this.server.to(this.room(shipmentId)).emit('tracking:update', snapshot);
  }

  private room(shipmentId: string): string {
    return `shipment:${shipmentId}`;
  }

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken;
    }

    const queryToken = client.handshake.query?.token;
    if (typeof queryToken === 'string' && queryToken.length > 0) {
      return queryToken;
    }

    return null;
  }
}
