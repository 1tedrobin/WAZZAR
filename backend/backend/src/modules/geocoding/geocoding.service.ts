import { Injectable } from '@nestjs/common';

export interface GeocodeResult {
  address: string;
  latitude: number;
  longitude: number;
}

// Adapter around OpenStreetMap's Nominatim — free, no API key, but rate
// limited (max ~1 req/sec, and requires a real User-Agent per their
// usage policy: https://operations.osmfoundation.org/policies/nominatim/).
// Deliberately isolated behind this one class, same "adapter, not
// foundation" principle WAZZAR already applies to LATRA — swapping to
// Google Places or Mapbox later means changing only this file, not
// GeocodingController or any frontend caller (they only see
// GeocodeResult[]).
@Injectable()
export class GeocodingService {
  private readonly baseUrl = 'https://nominatim.openstreetmap.org/search';

  async search(query: string, countryCode?: string): Promise<GeocodeResult[]> {
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: '5',
    });
    if (countryCode) {
      params.set('countrycodes', countryCode);
    }

    const res = await fetch(`${this.baseUrl}?${params.toString()}`, {
      headers: {
        // Required by Nominatim's usage policy — a generic fetch UA
        // gets blocked. Not a real domain yet; update once WAZZAR has
        // one, this is just "identify yourself," not a security control.
        'User-Agent': 'WAZZAR-backend/1.0 (contact: dev@wazzar.example)',
      },
    });

    if (!res.ok) {
      throw new Error(`Geocoding provider returned ${res.status}`);
    }

    const results = (await res.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
    }>;

    return results.map((r) => ({
      address: r.display_name,
      latitude: parseFloat(r.lat),
      longitude: parseFloat(r.lon),
    }));
  }
}
