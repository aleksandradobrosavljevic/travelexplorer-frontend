import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, forkJoin, map, Observable, of } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { AuthState } from '../../../../core/services/auth-state.service';
import { firstAssetUrl } from '../../../../core/config/api';
import {
  ActivityRecord,
  DestinationRecord,
  EventRecord,
  TouristObjectRecord,
} from '../../shared/admin-destination.models';

export interface MapContext {
  destination: DestinationRecord | null;
  objects: TouristObjectRecord[];
  activities: ActivityRecord[];
  events: EventRecord[];
}

@Injectable({ providedIn: 'root' })
export class AdminDestinationMapService {
  private readonly http = inject(HttpClient);
  private readonly authState = inject(AuthState);
  private readonly apiUrl = environment.apiUrl;

  getMapContext(): Observable<MapContext> {
    const user = this.authState.getCurrentUser() as any;
    const destinationId = user?.destinationId
      ?? user?.DestinationId
      ?? user?.adminProfile?.destinationId
      ?? user?.AdminProfile?.DestinationId
      ?? null;
  
    const destination$ = destinationId
      ? this.http.get<DestinationRecord>(`${this.apiUrl}/destinations/${destinationId}`)
          .pipe(catchError(() => of(null)))
      : of(null);
  
    const markers$ = destinationId
      ? this.http.get<any[]>(`${this.apiUrl}/map/markers?destinationId=${destinationId}`)
          .pipe(catchError(() => of([])))
      : of([]);
  
    return forkJoin({ destination: destination$, markers: markers$ }).pipe(
      map(({ destination, markers }) => ({
        destination,
        objects: markers.filter((m: any) => m.markerType === 'Object').map((m: any) => this.normalizeMarkerImage(m)),
        activities: markers.filter((m: any) => m.markerType === 'Activity').map((m: any) => this.normalizeMarkerImage(m)),
        events: markers.filter((m: any) => m.markerType === 'Event').map((m: any) => this.normalizeMarkerImage(m)),
      })),
      catchError(() => of({ destination: null, objects: [], activities: [], events: [] }))
    );
  }

  private normalizeMarkerImage<T extends { imageUrl?: string | null; imageUrls?: string[] | null }>(marker: T): T {
    return {
      ...marker,
      imageUrl: firstAssetUrl(marker),
    };
  }

  geocode(query: string): Observable<{ label: string; lat: number; lng: number }[]> {
    return this.http
      .get<{ label: string; lat: number; lng: number }[]>(
        `${this.apiUrl}/map/geocode?query=${encodeURIComponent(query)}`
      )
      .pipe(catchError(() => of([])));
  }
}
