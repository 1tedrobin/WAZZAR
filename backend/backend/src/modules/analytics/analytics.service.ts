import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { centsFromDecimal, decimalFromCents } from '../../common/money';
import { Shipment, ShipmentStatus } from '../../database/entities/shipment.entity';
import { AnalyticsSummaryQueryDto } from './dto/analytics-summary-query.dto';

const DEFAULT_WINDOW_DAYS = 30;
const TOP_DESTINATIONS_LIMIT = 5;

// "Completed" for analytics purposes matches what OverviewPage's
// client-side statsFor() already treats as delivered — DELIVERED and
// COMPLETED are both terminal-success states in the shipment lifecycle
// (COMPLETED is DELIVERED plus payout/rating settled), and a business
// doesn't care which of the two a shipment is currently sitting in.
const COMPLETED_STATUSES: ShipmentStatus[] = [ShipmentStatus.DELIVERED, ShipmentStatus.COMPLETED];

export interface DailyPoint {
  date: string;
  shipments: number;
  spend: number;
}

export interface StatusCount {
  status: ShipmentStatus;
  count: number;
}

export interface DestinationCount {
  area: string;
  count: number;
}

export interface AnalyticsSummary {
  periodStart: string;
  periodEnd: string;
  totals: {
    shipments: number;
    completed: number;
    cancelled: number;
    completionRate: number | null;
    totalSpend: number;
    avgDeliveryMinutes: number | null;
    avgRiderRating: number | null;
  };
  dailySeries: DailyPoint[];
  statusBreakdown: StatusCount[];
  topDestinations: DestinationCount[];
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentsRepo: Repository<Shipment>,
  ) {}

  async getSummary(businessId: string, query: AnalyticsSummaryQueryDto): Promise<AnalyticsSummary> {
    const { periodStart, periodEnd, rangeStart, rangeEnd } = this.resolveRange(query);

    // Pulled into memory and aggregated in JS rather than a SQL
    // GROUP BY — fine at the shipment volumes a single business
    // generates today (this mirrors the same tradeoff OverviewPage's
    // client-side statsFor() already makes, just over the business's
    // real full-period history via a DB query instead of over
    // whatever page of `GET /shipments` happened to be loaded
    // client-side). Would need to move to SQL aggregation if a
    // business's per-period shipment count ever grows into the
    // thousands.
    const shipments = await this.shipmentsRepo.find({
      where: { customerId: businessId, createdAt: Between(rangeStart, rangeEnd) },
      order: { createdAt: 'ASC' },
    });

    const completed = shipments.filter((s) => COMPLETED_STATUSES.includes(s.status));
    const cancelled = shipments.filter((s) => s.status === ShipmentStatus.CANCELLED);
    // Spend counts every non-cancelled shipment's price, not just
    // completed ones — same definition OverviewPage's statsFor() uses
    // for "spend this month" (a confirmed-but-still-in-transit
    // delivery is still money committed).
    const spendable = shipments.filter((s) => s.status !== ShipmentStatus.CANCELLED);

    const totalSpendCents = spendable.reduce(
      (sum, s) => sum + (s.price ? centsFromDecimal(s.price) : 0),
      0,
    );

    const withDeliveryTime = completed.filter((s) => s.deliveredAt);
    const avgDeliveryMinutes = withDeliveryTime.length
      ? Math.round(
          withDeliveryTime.reduce(
            (sum, s) => sum + (s.deliveredAt!.getTime() - s.createdAt.getTime()) / 60000,
            0,
          ) / withDeliveryTime.length,
        )
      : null;

    const rated = shipments.filter((s) => s.riderRating != null);
    const avgRiderRating = rated.length
      ? Math.round((rated.reduce((sum, s) => sum + (s.riderRating as number), 0) / rated.length) * 10) / 10
      : null;

    return {
      periodStart,
      periodEnd,
      totals: {
        shipments: shipments.length,
        completed: completed.length,
        cancelled: cancelled.length,
        completionRate: shipments.length ? Math.round((completed.length / shipments.length) * 1000) / 10 : null,
        totalSpend: Number(decimalFromCents(totalSpendCents)),
        avgDeliveryMinutes,
        avgRiderRating,
      },
      dailySeries: this.buildDailySeries(shipments, periodStart, periodEnd),
      statusBreakdown: this.buildStatusBreakdown(shipments),
      topDestinations: this.buildTopDestinations(shipments),
    };
  }

  private resolveRange(query: AnalyticsSummaryQueryDto) {
    if ((query.periodStart && !query.periodEnd) || (!query.periodStart && query.periodEnd)) {
      throw new BadRequestException('periodStart and periodEnd must be provided together');
    }
    if (query.periodStart && query.periodEnd && query.periodStart > query.periodEnd) {
      throw new BadRequestException('periodStart must not be after periodEnd');
    }

    let periodEnd = query.periodEnd;
    let periodStart = query.periodStart;
    if (!periodEnd) {
      periodEnd = new Date().toISOString().slice(0, 10);
      const start = new Date();
      start.setUTCDate(start.getUTCDate() - (DEFAULT_WINDOW_DAYS - 1));
      periodStart = start.toISOString().slice(0, 10);
    }

    return {
      periodStart: periodStart!,
      periodEnd,
      rangeStart: new Date(`${periodStart}T00:00:00.000Z`),
      rangeEnd: new Date(`${periodEnd}T23:59:59.999Z`),
    };
  }

  private buildDailySeries(shipments: Shipment[], periodStart: string, periodEnd: string): DailyPoint[] {
    const byDate = new Map<string, DailyPoint>();
    const cursor = new Date(`${periodStart}T00:00:00.000Z`);
    const end = new Date(`${periodEnd}T00:00:00.000Z`);
    // Pre-seed every date in range with zeros so the chart never has
    // gaps on days with no shipments. Spend is accumulated in integer
    // cents (see common/money.ts) and only converted back to a decimal
    // once per day at the end — the same "convert once, round once"
    // rule InvoicesService.generate follows, rather than repeatedly
    // adding and rounding floats across every shipment in a day.
    const centsByDate = new Map<string, number>();
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      byDate.set(key, { date: key, shipments: 0, spend: 0 });
      centsByDate.set(key, 0);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    for (const s of shipments) {
      const key = s.createdAt.toISOString().slice(0, 10);
      const point = byDate.get(key);
      if (!point) continue; // outside range due to a UTC edge — safe to skip
      point.shipments += 1;
      if (s.status !== ShipmentStatus.CANCELLED && s.price) {
        centsByDate.set(key, (centsByDate.get(key) ?? 0) + centsFromDecimal(s.price));
      }
    }
    for (const point of byDate.values()) {
      point.spend = Number(decimalFromCents(centsByDate.get(point.date) ?? 0));
    }

    return Array.from(byDate.values());
  }

  private buildStatusBreakdown(shipments: Shipment[]): StatusCount[] {
    const counts = new Map<ShipmentStatus, number>();
    for (const s of shipments) {
      counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }

  // Groups by the first comma-separated segment of the dropoff address
  // (same shortenAddress trick InvoicesService uses for line-item
  // descriptions) — "Mikocheni B, Dar es Salaam" -> "Mikocheni B".
  // Coarse (no geocoded ward/district boundaries), but a business can
  // still tell where most of its volume goes without one.
  private buildTopDestinations(shipments: Shipment[]): DestinationCount[] {
    const counts = new Map<string, number>();
    for (const s of shipments) {
      const address = s.dropoffLocation?.address;
      if (!address) continue;
      const area = address.split(',')[0].trim() || address;
      counts.set(area, (counts.get(area) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([area, count]) => ({ area, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_DESTINATIONS_LIMIT);
  }
}
