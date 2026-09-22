import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, shareReplay } from 'rxjs';
import { map } from 'rxjs/operators';
import * as L from 'leaflet';
import { environment } from '../../../../environments/environment';

export interface DestinationBounds {
  id: number;
  name: string;
  centerLat: number | null;
  centerLng: number | null;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface DestinationBoundsLayers {
  outline: L.Rectangle;
  mask: L.Polygon;
}

interface ApplyOptions {
  drawLayers?: boolean;
  fit?: boolean;
  lockBounds?: boolean;
  minZoom?: number;
  padding?: number;
}

@Injectable({ providedIn: 'root' })
export class DestinationBoundsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  private cached$: Observable<DestinationBounds | null> | null = null;

  getBounds(): Observable<DestinationBounds | null> {
    if (!this.cached$) {
      this.cached$ = this.http
        .get<any>(`${this.apiUrl}/map/destination-info`)
        .pipe(
          map((dto) => this.normalize(dto)),
          shareReplay(1)
        );
    }
    return this.cached$;
  }

  reset(): void {
    this.cached$ = null;
  }

  isInside(bounds: DestinationBounds | null, lat: number, lng: number): boolean {
    if (!bounds) return true;
    return (
      lat >= bounds.minLat &&
      lat <= bounds.maxLat &&
      lng >= bounds.minLng &&
      lng <= bounds.maxLng
    );
  }

  toLatLngBounds(bounds: DestinationBounds): L.LatLngBounds {
    return L.latLngBounds(
      L.latLng(bounds.minLat, bounds.minLng),
      L.latLng(bounds.maxLat, bounds.maxLng)
    );
  }

  // Nominatim wants: viewbox=lng1,lat1,lng2,lat2  (left, top, right, bottom)
  viewboxParam(bounds: DestinationBounds | null): string {
    if (!bounds) return '';
    return `&viewbox=${bounds.minLng},${bounds.maxLat},${bounds.maxLng},${bounds.minLat}&bounded=1`;
  }

  applyToMap(
    map: L.Map,
    bounds: DestinationBounds | null,
    options: ApplyOptions = {}
  ): DestinationBoundsLayers | null {
    if (!bounds) return null;

    const { drawLayers = true, fit = true, lockBounds = true, padding = 0.15 } = options;
    const leafletBounds = this.toLatLngBounds(bounds);

    if (fit) {
      map.fitBounds(leafletBounds, { padding: [16, 16] });
    }

    if (lockBounds) {
      map.setMaxBounds(leafletBounds.pad(padding));
      if (options.minZoom != null) {
        map.setMinZoom(options.minZoom);
      } else {
        const fittedZoom = map.getBoundsZoom(leafletBounds, false);
        map.setMinZoom(Math.max(2, fittedZoom - 2));
      }
    }

    if (!drawLayers) return null;
    return this.drawBoundsLayers(map, bounds);
  }

  drawBoundsLayers(map: L.Map, bounds: DestinationBounds): DestinationBoundsLayers {
    const outline = L.rectangle(this.toLatLngBounds(bounds), {
      color: '#239485',
      weight: 2,
      fill: false,
      interactive: false
    }).addTo(map);

    const worldRing: L.LatLngExpression[] = [
      [90, -180],
      [90, 180],
      [-90, 180],
      [-90, -180]
    ];
    const boundsRing: L.LatLngExpression[] = [
      [bounds.minLat, bounds.minLng],
      [bounds.minLat, bounds.maxLng],
      [bounds.maxLat, bounds.maxLng],
      [bounds.maxLat, bounds.minLng]
    ];

    const mask = L.polygon([worldRing, boundsRing], {
      stroke: false,
      fillColor: '#0f172a',
      fillOpacity: 0.35,
      interactive: false
    }).addTo(map);

    return { outline, mask };
  }

  private normalize(dto: any): DestinationBounds | null {
    if (!dto) return null;
    const minLat = this.toNum(dto.boundMinLat);
    const maxLat = this.toNum(dto.boundMaxLat);
    const minLng = this.toNum(dto.boundMinLng);
    const maxLng = this.toNum(dto.boundMaxLng);
    if (minLat == null || maxLat == null || minLng == null || maxLng == null) {
      return null;
    }
    return {
      id: dto.id,
      name: dto.name ?? '',
      centerLat: this.toNum(dto.centerLat),
      centerLng: this.toNum(dto.centerLng),
      minLat,
      maxLat,
      minLng,
      maxLng
    };
  }

  private toNum(v: unknown): number | null {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  }
}
