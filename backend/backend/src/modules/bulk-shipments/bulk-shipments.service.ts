import { BadRequestException, Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { GeocodingService } from '../geocoding/geocoding.service';
import { CreateShipmentDto } from '../shipments/dto/create-shipment.dto';
import { ShipmentsService } from '../shipments/shipments.service';

// Hard cap on rows per upload. Not an arbitrary UX limit — it exists
// because any row missing lat/lng has to be geocoded through Nominatim
// (see GeocodingService), which is free but rate-limited to roughly
// one request per second and requires a courteous delay between calls
// (see GEOCODE_DELAY_MS below). A 100-row CSV where every address
// needs geocoding already takes ~3-4 minutes end-to-end (two lookups
// per row); anything larger would make this endpoint itself the
// bottleneck. A business with more volume than that should include
// pickup_lat/pickup_lng/dropoff_lat/dropoff_lng columns directly (see
// buildCsvTemplate) and skip geocoding entirely.
export const MAX_BULK_ROWS = 100;

// Nominatim's usage policy asks for max ~1 request/second from a given
// client. This is a floor between geocode calls, not a queue/limiter —
// good enough for one business's one CSV import running at a time,
// which is the only concurrency this endpoint sees today.
const GEOCODE_DELAY_MS = 1100;

export interface BulkImportRowFailure {
  row: number;
  error: string;
}

export interface BulkImportRowSuccess {
  row: number;
  shipmentId: string;
  price: string | null;
}

export interface BulkImportResult {
  totalRows: number;
  created: BulkImportRowSuccess[];
  failed: BulkImportRowFailure[];
}

interface ParsedCsvRow {
  pickup_address?: string;
  pickup_lat?: string;
  pickup_lng?: string;
  pickup_instruction?: string;
  dropoff_address?: string;
  dropoff_lat?: string;
  dropoff_lng?: string;
  dropoff_instruction?: string;
  package_weight_kg?: string;
  package_description?: string;
}

@Injectable()
export class BulkShipmentsService {
  constructor(
    private readonly shipmentsService: ShipmentsService,
    private readonly geocodingService: GeocodingService,
  ) {}

  async importCsv(businessId: string, fileBuffer: Buffer): Promise<BulkImportResult> {
    const rows = this.parseCsv(fileBuffer);

    if (rows.length === 0) {
      throw new BadRequestException('CSV has no data rows');
    }
    if (rows.length > MAX_BULK_ROWS) {
      throw new BadRequestException(
        `CSV has ${rows.length} rows — the limit is ${MAX_BULK_ROWS} per upload. Split large imports into multiple files, or include lat/lng columns to skip geocoding.`,
      );
    }

    const created: BulkImportRowSuccess[] = [];
    const failed: BulkImportRowFailure[] = [];

    // Sequential, not Promise.all — both to respect Nominatim's rate
    // limit (see GEOCODE_DELAY_MS) and so each row's pricing quote
    // reflects PricingConfig at the moment that row is processed,
    // same as if a business had submitted them one at a time.
    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2; // +1 for 0-index, +1 for the header row
      try {
        const dto = await this.resolveRow(rows[i]);
        const shipment = await this.shipmentsService.create(dto, businessId);
        created.push({ row: rowNumber, shipmentId: shipment.id, price: shipment.price });
      } catch (err) {
        // One bad row (bad address, ungeocodable, no active pricing
        // config, ...) never aborts the rest of the batch — this is a
        // best-effort bulk import, not an all-or-nothing transaction.
        // Each successful row is already its own committed shipment
        // via ShipmentsService.create()'s own transaction.
        failed.push({ row: rowNumber, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    return { totalRows: rows.length, created, failed };
  }

  private parseCsv(fileBuffer: Buffer): ParsedCsvRow[] {
    try {
      return parse(fileBuffer, {
        columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
      }) as ParsedCsvRow[];
    } catch (err) {
      throw new BadRequestException(
        `Couldn't parse this file as CSV: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }

  private async resolveRow(row: ParsedCsvRow): Promise<CreateShipmentDto> {
    if (!row.pickup_address?.trim()) {
      throw new Error('pickup_address is required');
    }
    if (!row.dropoff_address?.trim()) {
      throw new Error('dropoff_address is required');
    }

    const pickupLocation = await this.resolveLocation(
      row.pickup_address,
      row.pickup_lat,
      row.pickup_lng,
      row.pickup_instruction,
    );
    const dropoffLocation = await this.resolveLocation(
      row.dropoff_address,
      row.dropoff_lat,
      row.dropoff_lng,
      row.dropoff_instruction,
    );

    const packageWeightKg = row.package_weight_kg?.trim()
      ? Number(row.package_weight_kg)
      : undefined;
    if (packageWeightKg !== undefined && Number.isNaN(packageWeightKg)) {
      throw new Error(`package_weight_kg "${row.package_weight_kg}" is not a number`);
    }

    return {
      pickupLocation,
      dropoffLocation,
      packageWeightKg,
      packageDescription: row.package_description?.trim() || undefined,
    };
  }

  // Given lat/lng columns, uses them directly — no network call, no
  // rate-limit delay, and no dependence on Nominatim actually finding
  // the address. Only falls back to geocoding the address text when
  // either coordinate is missing.
  private async resolveLocation(
    address: string,
    latStr: string | undefined,
    lngStr: string | undefined,
    instruction: string | undefined,
  ) {
    if (latStr?.trim() && lngStr?.trim()) {
      const latitude = Number(latStr);
      const longitude = Number(lngStr);
      if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        throw new Error(`Invalid coordinates "${latStr}, ${lngStr}" for "${address}"`);
      }
      return { latitude, longitude, address: address.trim(), instruction: instruction?.trim() || undefined };
    }

    const results = await this.geocodingService.search(address, 'tz');
    // Courteous delay after every live geocode call, matching
    // Nominatim's ~1 req/sec usage policy — see GEOCODE_DELAY_MS.
    await sleep(GEOCODE_DELAY_MS);

    if (results.length === 0) {
      throw new Error(`Could not find coordinates for "${address}" — add pickup_lat/pickup_lng (or dropoff_lat/dropoff_lng) columns instead`);
    }
    return {
      latitude: results[0].latitude,
      longitude: results[0].longitude,
      address: address.trim(),
      instruction: instruction?.trim() || undefined,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A downloadable starting point for a business's own spreadsheet tool
// — matches the exact column names resolveRow() reads. lat/lng columns
// are shown but left blank in the template on purpose: filling them in
// is optional (falls back to geocoding), but a business importing more
// than a handful of rows should strongly prefer providing them (see
// MAX_BULK_ROWS's comment on why geocoding is slow).
export function buildCsvTemplate(): string {
  const header = [
    'pickup_address', 'pickup_lat', 'pickup_lng', 'pickup_instruction',
    'dropoff_address', 'dropoff_lat', 'dropoff_lng', 'dropoff_instruction',
    'package_weight_kg', 'package_description',
  ];
  const example = [
    'Mikocheni B, Dar es Salaam', '-6.7714', '39.2450', 'Blue gate, ask for Asha',
    'CBD, Dar es Salaam', '', '', 'Reception desk',
    '2.5', 'Documents',
  ];
  return `${header.join(',')}\n${example.map((v) => (v.includes(',') ? `"${v}"` : v)).join(',')}\n`;
}
