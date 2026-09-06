import { BadRequestException } from '@nestjs/common';
import { BulkShipmentsService, MAX_BULK_ROWS, buildCsvTemplate } from './bulk-shipments.service';

function makeShipmentsService(impl?: (dto: any, businessId: string) => Promise<any>) {
  return {
    create: jest.fn(impl ?? (async (dto: any) => ({ id: `ship-${Math.random()}`, price: '5000.00', ...dto }))),
  } as any;
}

function makeGeocodingService(impl?: (query: string) => Promise<any[]>) {
  return {
    search: jest.fn(impl ?? (async () => [{ address: 'Resolved Address', latitude: -6.8, longitude: 39.28 }])),
  } as any;
}

const BUSINESS_ID = 'a5f3c111-0000-4000-8000-000000000001';

const HEADER = 'pickup_address,pickup_lat,pickup_lng,pickup_instruction,dropoff_address,dropoff_lat,dropoff_lng,dropoff_instruction,package_weight_kg,package_description';

describe('BulkShipmentsService', () => {
  describe('importCsv', () => {
    it('creates one shipment per row when lat/lng are provided directly (no geocoding call)', async () => {
      const shipmentsService = makeShipmentsService();
      const geocodingService = makeGeocodingService();
      const service = new BulkShipmentsService(shipmentsService, geocodingService);

      const csv = [
        HEADER,
        'Mikocheni B,-6.77,39.24,Blue gate,CBD,-6.81,39.29,Reception,2.5,Documents',
        'Masaki,-6.75,39.28,,Kariakoo,-6.82,39.27,,,',
      ].join('\n');

      const result = await service.importCsv(BUSINESS_ID, Buffer.from(csv));

      expect(result.totalRows).toBe(2);
      expect(result.created).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
      expect(geocodingService.search).not.toHaveBeenCalled();
      expect(shipmentsService.create).toHaveBeenCalledTimes(2);
      const firstDto = shipmentsService.create.mock.calls[0][0];
      expect(firstDto.pickupLocation).toEqual({ latitude: -6.77, longitude: 39.24, address: 'Mikocheni B', instruction: 'Blue gate' });
      expect(firstDto.packageWeightKg).toBe(2.5);
      expect(shipmentsService.create.mock.calls[0][1]).toBe(BUSINESS_ID);
    });

    it('geocodes rows missing lat/lng', async () => {
      const shipmentsService = makeShipmentsService();
      const geocodingService = makeGeocodingService(async () => [
        { address: 'Resolved', latitude: -6.79, longitude: 39.25 },
      ]);
      const service = new BulkShipmentsService(shipmentsService, geocodingService);

      const csv = [HEADER, 'Mikocheni B,,,,CBD,-6.81,39.29,,,'].join('\n');

      const result = await service.importCsv(BUSINESS_ID, Buffer.from(csv));

      expect(result.created).toHaveLength(1);
      // Only the pickup address needed geocoding (dropoff had lat/lng).
      expect(geocodingService.search).toHaveBeenCalledTimes(1);
      expect(geocodingService.search).toHaveBeenCalledWith('Mikocheni B', 'tz');
      const dto = shipmentsService.create.mock.calls[0][0];
      expect(dto.pickupLocation.latitude).toBe(-6.79);
    }, 10000);

    it('isolates a bad row instead of failing the whole batch', async () => {
      const shipmentsService = makeShipmentsService();
      const geocodingService = makeGeocodingService(async () => []); // no results -> ungeocodable
      const service = new BulkShipmentsService(shipmentsService, geocodingService);

      const csv = [
        HEADER,
        'Good Pickup,-6.77,39.24,,Good Dropoff,-6.81,39.29,,,',
        'Bad Pickup,,,,Bad Dropoff,,,,,', // no lat/lng, geocoding returns nothing
      ].join('\n');

      const result = await service.importCsv(BUSINESS_ID, Buffer.from(csv));

      expect(result.created).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].row).toBe(3); // header is row 1, so second data row is row 3
      expect(result.failed[0].error).toMatch(/Could not find coordinates/);
    }, 10000);

    it('reports a missing-required-field row without touching ShipmentsService', async () => {
      const shipmentsService = makeShipmentsService();
      const geocodingService = makeGeocodingService();
      const service = new BulkShipmentsService(shipmentsService, geocodingService);

      const csv = [HEADER, ',-6.77,39.24,,CBD,-6.81,39.29,,,'].join('\n'); // missing pickup_address

      const result = await service.importCsv(BUSINESS_ID, Buffer.from(csv));

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toMatch(/pickup_address is required/);
      expect(shipmentsService.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for an empty CSV', async () => {
      const service = new BulkShipmentsService(makeShipmentsService(), makeGeocodingService());

      await expect(service.importCsv(BUSINESS_ID, Buffer.from(HEADER + '\n'))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException past MAX_BULK_ROWS', async () => {
      const service = new BulkShipmentsService(makeShipmentsService(), makeGeocodingService());
      const rows = Array.from({ length: MAX_BULK_ROWS + 1 }, (_, i) => `P${i},-6.77,39.24,,D${i},-6.81,39.29,,,`);
      const csv = [HEADER, ...rows].join('\n');

      await expect(service.importCsv(BUSINESS_ID, Buffer.from(csv))).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-numeric package_weight_kg without touching ShipmentsService', async () => {
      const shipmentsService = makeShipmentsService();
      const service = new BulkShipmentsService(shipmentsService, makeGeocodingService());

      const csv = [HEADER, 'P,-6.77,39.24,,D,-6.81,39.29,,heavy,'].join('\n');

      const result = await service.importCsv(BUSINESS_ID, Buffer.from(csv));

      expect(result.failed[0].error).toMatch(/package_weight_kg "heavy" is not a number/);
      expect(shipmentsService.create).not.toHaveBeenCalled();
    });
  });

  describe('buildCsvTemplate', () => {
    it('produces a header row matching the columns resolveRow() reads', () => {
      const template = buildCsvTemplate();
      expect(template.split('\n')[0]).toBe(HEADER);
    });
  });
});
