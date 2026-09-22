import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, catchError, expand, forkJoin, map, of, reduce } from 'rxjs';
import { FavouriteItem } from '../../models/favourite-item';
import { FALLBACK_IMAGE_URL, buildApiUrl, firstAssetUrl } from '../config/api';
import { AuthState } from './auth-state.service';

type FavouriteApiItem = {
  id: number;
  objectId?: number | null;
  activityId?: number | null;
  eventId?: number | null;
  entityId?: number | null;
  entityType?: string | null;
  destinationId?: number | null;
  destinationName?: string | null;
  destinationCountry?: string | null;
  title?: string | null;
  location?: string | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  price?: number | null;
  currency?: string | null;
  averageRating?: number | null;
  reviewCount?: number | null;
  createdAt?: string | null;
};

type FavouriteSummaryResponse = {
  objects?: FavouriteApiItem[] | null;
  activities?: FavouriteApiItem[] | null;
  events?: FavouriteApiItem[] | null;
  savedObjectIds?: number[] | null;
  savedActivityIds?: number[] | null;
  savedEventIds?: number[] | null;
};

@Injectable({
  providedIn: 'root'
})
export class FavouritesService {
  private readonly apiUrl = buildApiUrl('favourites');

  readonly favourites = signal<FavouriteItem[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  constructor(
    private http: HttpClient,
    private authState: AuthState
  ) {}

  toggleFavourite(entityType: string, entityId: number) {
    if (!this.canUseFavourites()) {
      return of({ isSaved: false });
    }

    return this.http.post<{ isSaved: boolean }>(
      `${this.apiUrl}/toggle/${entityType}/${entityId}`,
      {},
      this.authOptions()
    );
  }

  isFavourite(entityType: string, entityId: number) {
    if (!this.canUseFavourites()) {
      return of(false);
    }

    return this.http.get<FavouriteSummaryResponse>(
      `${this.apiUrl}/summary?previewCount=0`,
      this.authOptions()
    ).pipe(
      map((summary) => this.getSavedIds(summary, entityType).includes(entityId)),
      catchError(() => of(false))
    );
  }

  loadFavourites(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    if (!this.canUseFavourites()) {
      this.favourites.set([]);
      this.isLoading.set(false);
      return;
    }

    forkJoin({
      objects: this.getAllByType('Object'),
      activities: this.getAllByType('Activity'),
      events: this.getAllByType('Event')
    }).pipe(
      map(({ objects, activities, events }): FavouriteItem[] => [
        ...objects.map((item) => this.mapFavouriteItem(item, 'Object')),
        ...activities.map((item) => this.mapFavouriteItem(item, 'Activity')),
        ...events.map((item) => this.mapFavouriteItem(item, 'Event'))
      ].filter((item): item is FavouriteItem => item !== null)),
      catchError(() => of([] as FavouriteItem[]))
    ).subscribe({
      next: (items) => {
        this.favourites.set(items);
        this.isLoading.set(false);
      },
      error: () => {
        this.favourites.set([]);
        this.errorMessage.set('We could not load your saved trips right now.');
        this.isLoading.set(false);
      }
    });
  }

  removeFavourite(id: number): void {
    const previousItems = this.favourites();
    const item = previousItems.find((currentItem) => currentItem.id === id);
    if (!item) {
      return;
    }

    this.errorMessage.set(null);
    this.favourites.set(previousItems.filter((currentItem) => currentItem.id !== id));

    const entityId = item.entityId ?? id;
    const entityType = item.entityType ?? 'Object';

    this.toggleFavourite(entityType, entityId).subscribe({
      error: () => {
        this.favourites.set(previousItems);
        this.errorMessage.set('We could not remove that item from your saved trips.');
      }
    });
  }

  private mapFavouriteItem(item: FavouriteApiItem, fallbackType: string): FavouriteItem | null {
    const entityType = item.entityType ?? fallbackType;
    const entityId = item.entityId ?? this.getEntityId(item, entityType);

    if (!entityId || !item.title) {
      return null;
    }

    return {
      id: item.id,
      entityId,
      entityType,
      destinationId: item.destinationId ?? null,
      destinationName: item.destinationName ?? null,
      destinationCountry: item.destinationCountry ?? null,
      title: item.title,
      location: item.location ?? item.destinationName ?? '',
      imageUrl: firstAssetUrl(item) ?? FALLBACK_IMAGE_URL,
      price: typeof item.price === 'number' ? item.price : null,
      currency: item.currency ?? (entityType === 'Object' ? null : 'RSD'),
      averageRating: this.normalizeRating(item.averageRating),
      reviewCount: typeof item.reviewCount === 'number' ? item.reviewCount : null,
      createdAt: item.createdAt ?? null
    };
  }

  private normalizeRating(value: unknown): number | null {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return null;
    }

    return Number(value.toFixed(2));
  }

  private getEntityId(item: FavouriteApiItem, entityType: string): number | null {
    switch (entityType.toLowerCase()) {
      case 'activity':
        return item.activityId ?? null;
      case 'event':
        return item.eventId ?? null;
      default:
        return item.objectId ?? null;
    }
  }

  private getSavedIds(summary: FavouriteSummaryResponse, entityType: string): number[] {
    switch (entityType.toLowerCase()) {
      case 'activity':
        return [...(summary.savedActivityIds ?? [])];
      case 'event':
        return [...(summary.savedEventIds ?? [])];
      default:
        return [...(summary.savedObjectIds ?? [])];
    }
  }

  private getAllByType(entityType: string, pageSize = 50) {
    return this.getByTypePage(entityType, 1, pageSize).pipe(
      expand(result => result.items.length === pageSize
        ? this.getByTypePage(entityType, result.page + 1, pageSize)
        : EMPTY
      ),
      reduce((items, result) => [...items, ...result.items], [] as FavouriteApiItem[])
    );
  }

  private getByTypePage(entityType: string, page: number, pageSize: number) {
    return this.http.get<FavouriteApiItem[]>(
      `${this.apiUrl}/${entityType}?page=${page}&pageSize=${pageSize}`,
      this.authOptions()
    ).pipe(
      map(items => ({ page, items: items ?? [] }))
    );
  }

  private canUseFavourites(): boolean {
    return this.authState.isLoggedIn()
      && (this.authState.getUserRole() ?? '').toLowerCase() === 'tourist';
  }

  private authOptions() {
    const token = this.authState.getAccessToken();

    return token
      ? { headers: { Authorization: `Bearer ${token}` } }
      : {};
  }
}
