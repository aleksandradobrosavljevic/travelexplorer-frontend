import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PublisherStateService {
  detailsFrom = signal<string | null>(null);
  detailsId = signal<number | null>(null);
  myContentParams = signal<Record<string, string>>({});
  reviewsParams = signal<Record<string, string>>({});
  reviewsFocus = signal<{ contentId: number; openReviews: boolean } | null>(null);
  
  mapState = signal<{
  lat: number;
  lng: number;
  zoom: number;
  destinationId: number | null;
  destinationName: string;
  nameSearch: string;
  minRating: number;
  selectedItemId: number | null;
  selectedItemLat: number | null;
  selectedItemLng: number | null;
  filterGroups: any[];
} | null>(null);
}
