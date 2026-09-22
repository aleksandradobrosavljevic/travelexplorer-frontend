import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, expand, forkJoin, map, of, reduce, shareReplay, switchMap, throwError } from 'rxjs';
import { buildApiUrl, buildAssetUrls, firstAssetUrl } from '../core/config/api';

export type PublisherContentType = 'Object' | 'Event' | 'Activity';

export interface ReferenceOption {
  id: number;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  boundMinLat?: number | null;
  boundMaxLat?: number | null;
  boundMinLng?: number | null;
  boundMaxLng?: number | null;
}

export interface ObjectReferenceOption {
  id: number;
  name: string;
  destinationId: number;
  latitude?: number | null;
  longitude?: number | null;
}

export interface PublisherContentPayload {
  title: string;
  description: string;
  latitude?: number | null;
  longitude?: number | null;
  location?: string | null;
  startDateTime: string;
  endDateTime?: string | null;
  capacity: number | null;
  price: number | null;
  currency?: string | null;
  airbnbLink: string;
  bookingLink: string;
  destinationId?: number | null;
  objectTypeId?: number | null;
  activityTypeId?: number | null;
  eventTypeId?: number | null;
  objectId?: number | null;
  durationMinutes?: number | null;
  website?: string | null;
  phone?: string | null;
}

type ImageUploadResponse = {
  url?: string | null;
  relativeUrl?: string | null;
  relativePath?: string | null;
  urls?: string[] | null;
  relativePaths?: string[] | null;
};

export interface PublisherContentItem {
  id: number;
  title: string;
  type: PublisherContentType;
  status: 'Draft' | 'Pending Approval' | 'Approved' | 'Rejected';
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | null;
  rejectionReason?: string;
  description: string;
  location: string;
  startDateTime: string;
  endDateTime?: string | null;
  capacity: number | null;
  price: number | null;
  airbnbLink: string;
  bookingLink: string;
  destinationId?: number | null;
  destinationName?: string | null;
  objectTypeId?: number | null;
  objectTypeName?: string | null;
  activityTypeId?: number | null;
  activityTypeName?: string | null;
  eventTypeId?: number | null;
  eventTypeName?: string | null;
  objectId?: number | null;
  objectName?: string | null;
  currency?: string | null;
  imageUrl?: string | null;
  imageUrls?: string[];
  latitude?: number | null;
  longitude?: number | null;
  website?: string | null;
  phone?: string | null;
  averageRating?: number | null;
  reviewCount?: number | null;
  durationMinutes?: number | null;
}

type ReferenceItemDto = {
  id: number;
  name: string;
};

type TouristObjectResponseDto = {
  id: number;
  destinationId: number;
  destinationName?: string | null;
  destinationCountry?: string | null;
  objectTypeId: number;
  objectTypeName?: string | null;
  statusName: string;
  name: string;
  description?: string | null;
  address?: string | null;
  airbnbUrl?: string | null;
  bookingUrl?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  latitude?: number | null;
  longitude?: number | null;
  website?: string | null;
  phone?: string | null;
  averageRating?: number | null;
  reviewCount?: number | null;
};

type ActivityResponseDto = {
  id: number;
  destinationId?: number | null;
  destinationName?: string | null;
  objectId?: number | null;
  objectName?: string | null;
  activityTypeId: number;
  activityTypeName?: string | null;
  statusName: string;
  name: string;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  airbnbUrl?: string | null;
  bookingUrl?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  latitude?: number | null;
  longitude?: number | null;
  durationMinutes?: number | null;
  averageRating?: number | null;
  reviewCount?: number | null;
};

type EventResponseDto = {
  id: number;
  objectId: number;
  objectName: string;
  destinationId?: number | null;
  destinationName?: string | null;
  eventTypeId: number;
  eventTypeName?: string | null;
  statusName: string;
  name: string;
  description?: string | null;
  startDatetime: string;
  endDatetime?: string | null;
  capacity?: number | null;
  price?: number | null;
  currency?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  latitude?: number | null;
  longitude?: number | null;
  averageRating?: number | null;
  reviewCount?: number | null;
};

@Injectable({
  providedIn: 'root'
})
export class PublisherContentService {
  private contentType$: Observable<PublisherContentType>;
  private user$: Observable<any>;
  private refreshTrigger = signal(0);

  constructor(private readonly http: HttpClient) {
    this.user$ = toObservable(this.refreshTrigger).pipe(
      switchMap(() => this.http.get<any>(buildApiUrl('users/me'))),
      shareReplay(1)
    );

    this.contentType$ = this.user$.pipe(
      map((user) => this.normalizeContentType(user?.publisherProfile?.publisherTypeName) ?? 'Object')
    );
  }

  invalidateUserCache(): void {
    this.refreshTrigger.update(v => v + 1);
  }

  getCurrentPublisherContentType(): Observable<PublisherContentType> {
    return this.contentType$;
  }

  getUserProfile(): Observable<any> {
    return this.user$;
  }

  getObjectTypes(): Observable<ReferenceOption[]> {
    return this.http.get<ReferenceItemDto[]>(buildApiUrl('reference-data/object-types')).pipe(
      map((items) => (items ?? []).map((item) => ({ id: item.id, name: item.name })))
    );
  }

  getActivityTypes(): Observable<ReferenceOption[]> {
    return this.http.get<ReferenceItemDto[]>(buildApiUrl('reference-data/activity-types')).pipe(
      map((items) => (items ?? []).map((item) => ({ id: item.id, name: item.name })))
    );
  }

  getEventTypes(): Observable<ReferenceOption[]> {
    return this.http.get<ReferenceItemDto[]>(buildApiUrl('reference-data/event-types')).pipe(
      map((items) => (items ?? []).map((item) => ({ id: item.id, name: item.name })))
    );
  }

  getPublisherObjects(): Observable<ObjectReferenceOption[]> {
    return this.getAllObjectReferences();
  }

  getObjectsByDestination(destinationId: number): Observable<ObjectReferenceOption[]> {
    return this.getAllObjectReferences({ destinationId });
  }

  getObjectDestination(objectId: number): Observable<number | null> {
    return this.http.get<TouristObjectResponseDto>(buildApiUrl(`tourist-objects/${objectId}`)).pipe(
      map((item) => item?.destinationId ?? null)
    );
  }

  private getAllObjectReferences(
    filters: { destinationId?: number } = {},
    pageSize = 50
  ): Observable<ObjectReferenceOption[]> {
    return this.getObjectReferencePage(1, pageSize, filters).pipe(
      expand(result => result.items.length === pageSize
        ? this.getObjectReferencePage(result.page + 1, pageSize, filters)
        : EMPTY
      ),
      reduce((items, result) => [...items, ...result.items], [] as ObjectReferenceOption[])
    );
  }

  private getObjectReferencePage(
    page: number,
    pageSize: number,
    filters: { destinationId?: number }
  ): Observable<{ page: number; items: ObjectReferenceOption[] }> {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize)
    });

    if (filters.destinationId) {
      params.set('destinationId', String(filters.destinationId));
    }

    return this.http.get<{ items: TouristObjectResponseDto[] }>(
      buildApiUrl(`tourist-objects?${params.toString()}`)
    ).pipe(
      map((response) => ({
        page,
        items: (response?.items ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          destinationId: item.destinationId,
          latitude: item.latitude ?? null,
          longitude: item.longitude ?? null
        }))
      }))
    );
  }

  uploadObjectImage(objectId: number, file: File): Observable<string> {
    return this.uploadObjectImages(objectId, [file]).pipe(
      map((urls) => urls[0] ?? '')
    );
  }

  uploadObjectImages(
    objectId: number,
    files: File[],
    retainedImageUrls: string[] = [],
    replaceExistingImages = false
  ): Observable<string[]> {
    const formData = this.buildImageFormData(files, retainedImageUrls, replaceExistingImages);

    return this.http.patch<ImageUploadResponse>(
      buildApiUrl(`tourist-objects/${objectId}/image`),
      formData
    ).pipe(
      map((response) => this.normalizeUploadResponse(response))
    );
  }

  uploadActivityImage(activityId: number, file: File): Observable<string> {
    return this.uploadActivityImages(activityId, [file]).pipe(
      map((urls) => urls[0] ?? '')
    );
  }

  uploadActivityImages(
    activityId: number,
    files: File[],
    retainedImageUrls: string[] = [],
    replaceExistingImages = false
  ): Observable<string[]> {
    const formData = this.buildImageFormData(files, retainedImageUrls, replaceExistingImages);

    return this.http.patch<ImageUploadResponse>(
      buildApiUrl(`activities/${activityId}/image`),
      formData
    ).pipe(
      map((response) => this.normalizeUploadResponse(response))
    );
  }

  uploadEventImage(eventId: number, file: File): Observable<string> {
    return this.uploadEventImages(eventId, [file]).pipe(
      map((urls) => urls[0] ?? '')
    );
  }

  uploadEventImages(
    eventId: number,
    files: File[],
    retainedImageUrls: string[] = [],
    replaceExistingImages = false
  ): Observable<string[]> {
    const formData = this.buildImageFormData(files, retainedImageUrls, replaceExistingImages);

    return this.http.patch<ImageUploadResponse>(
      buildApiUrl(`events/${eventId}/image`),
      formData
    ).pipe(
      map((response) => this.normalizeUploadResponse(response))
    );
  }

  getContentItems(page: number = 1, pageSize: number = 10,
    filters: { search?: string; statusName?: string; sort?: string } = {}
  ): Observable<PublisherContentItem[]> {
    const buildParams = () => {
      let q = `page=${page}&pageSize=${pageSize}`;
      if (filters.search)     q += `&search=${encodeURIComponent(filters.search)}`;
      if (filters.statusName) q += `&statusName=${encodeURIComponent(filters.statusName)}`;
      if (filters.sort)       q += `&sort=${filters.sort}`;
      return q;
    };

    return this.contentType$.pipe(
      switchMap((contentType) => {
        switch (contentType) {
          case 'Object':
            return this.http.get<{ items: TouristObjectResponseDto[] }>(
              buildApiUrl(`tourist-objects?${buildParams()}`)
            ).pipe(map((response) => (response?.items ?? []).map((item) => this.mapObjectItem(item))));
          case 'Activity':
            return this.http.get<{ items: ActivityResponseDto[] }>(
              buildApiUrl(`activities?${buildParams()}`)
            ).pipe(map((response) => (response?.items ?? []).map((item) => this.mapActivityItem(item))));
          case 'Event':
            return this.http.get<{ items: EventResponseDto[] }>(
              buildApiUrl(`events?${buildParams()}`)
            ).pipe(map((response) => (response?.items ?? []).map((item) => this.mapEventItem(item))));
        }
      })
    );
  }

  getAllContentItems(
    pageSize = 50,
    filters: { search?: string; statusName?: string; sort?: string } = {}
  ): Observable<PublisherContentItem[]> {
    return this.getContentItemsPage(1, pageSize, filters).pipe(
      expand(result => result.items.length === pageSize
        ? this.getContentItemsPage(result.page + 1, pageSize, filters)
        : EMPTY
      ),
      reduce((items, result) => [...items, ...result.items], [] as PublisherContentItem[])
    );
  }

  getContentItemById(id: number): Observable<PublisherContentItem> {
    return this.contentType$.pipe(
      switchMap((contentType) => this.getContentByTypeAndId(contentType, id))
    );
  }

  private getContentItemsPage(
    page: number,
    pageSize: number,
    filters: { search?: string; statusName?: string; sort?: string }
  ): Observable<{ page: number; items: PublisherContentItem[] }> {
    return this.getContentItems(page, pageSize, filters).pipe(
      map(items => ({ page, items }))
    );
  }

  deleteContentItem(id: number): Observable<void> {
    return this.contentType$.pipe(
      switchMap((contentType) => {
        switch (contentType) {
          case 'Object':
            return this.http.delete<void>(buildApiUrl(`tourist-objects/${id}`));
          case 'Activity':
            return this.http.delete<void>(buildApiUrl(`activities/${id}`));
          case 'Event':
            return this.http.delete<void>(buildApiUrl(`events/${id}`));
        }
      })
    );
  }

  updateContentItem(
    id: number,
    updatedData: PublisherContentPayload & { type: PublisherContentType }
  ): Observable<PublisherContentItem> {
    return this.getContentItemById(id).pipe(
      switchMap((existingItem) => {
        switch (existingItem.type) {
          case 'Object':
            return this.http.put<TouristObjectResponseDto>(
              buildApiUrl(`tourist-objects/${id}`),
              {
                objectTypeId: updatedData.objectTypeId ?? existingItem.objectTypeId ?? 1,
                destinationId: updatedData.destinationId ?? existingItem.destinationId ?? 0,
                name: updatedData.title || existingItem.title,
                description: updatedData.description ?? existingItem.description ?? null,
                latitude: updatedData.latitude ?? existingItem.latitude ?? null,
                longitude: updatedData.longitude ?? existingItem.longitude ?? null,
                address: updatedData.location ?? existingItem.location ?? null,
                website: updatedData.website ?? existingItem.website ?? null,
                phone: updatedData.phone ?? existingItem.phone ?? null,
                airbnbUrl: updatedData.airbnbLink || existingItem.airbnbLink || null,
                bookingUrl: updatedData.bookingLink || existingItem.bookingLink || null,
              }
            ).pipe(map((item) => this.mapObjectItem(item)));

          case 'Activity':
            return this.http.put<ActivityResponseDto>(
              buildApiUrl(`activities/${id}`),
              {
                name: updatedData.title || existingItem.title,
                description: updatedData.description ?? existingItem.description ?? null,
                activityTypeId: updatedData.activityTypeId ?? existingItem.activityTypeId ?? 1,
                destinationId: updatedData.destinationId ?? existingItem.destinationId ?? null,
                objectId: updatedData.objectId ?? existingItem.objectId ?? null,
                durationMinutes: updatedData.durationMinutes ?? existingItem.durationMinutes ?? null,
                price: updatedData.price ?? existingItem.price ?? null,
                currency: updatedData.currency ?? existingItem.currency ?? 'RSD',
                latitude: updatedData.latitude ?? existingItem.latitude ?? null,
                longitude: updatedData.longitude ?? existingItem.longitude ?? null,
              }
            ).pipe(map((item) => this.mapActivityItem(item)));

          case 'Event':
            if (!updatedData.objectId && !existingItem.objectId) {
              return throwError(() => new Error('Event requires a related object.'));
            }

            return this.http.put<EventResponseDto>(
              buildApiUrl(`events/${id}`),
              {
                objectId: updatedData.objectId ?? existingItem.objectId,
                eventTypeId: updatedData.eventTypeId ?? existingItem.eventTypeId ?? 1,
                name: updatedData.title || existingItem.title,
                description: updatedData.description ?? existingItem.description ?? null,
                startDatetime: updatedData.startDateTime ?? existingItem.startDateTime,
                endDatetime: updatedData.endDateTime ?? existingItem.endDateTime ?? null,
                capacity: updatedData.capacity ?? existingItem.capacity ?? null,
                price: updatedData.price ?? existingItem.price ?? null,
                currency: updatedData.currency ?? existingItem.currency ?? 'RSD',
                latitude: updatedData.latitude ?? existingItem.latitude ?? null,
                longitude: updatedData.longitude ?? existingItem.longitude ?? null,
              }
            ).pipe(map((item) => this.mapEventItem(item)));
        }
      })
    );
  }

  createContentItem(
    contentType: PublisherContentType,
    data: PublisherContentPayload
  ): Observable<PublisherContentItem> {
    return this.contentType$.pipe(
      switchMap(() => {
        switch (contentType) {
          case 'Object':
            return this.http.post<TouristObjectResponseDto>(
              buildApiUrl('tourist-objects'),
              {
                objectTypeId: data.objectTypeId ?? 1,
                destinationId: data.destinationId,
                name: data.title,
                description: data.description,
                address: data.location ?? null,
                latitude: data.latitude ?? null,
                longitude: data.longitude ?? null,
                website: data.website ?? null,
                airbnbUrl: data.airbnbLink || null,
                bookingUrl: data.bookingLink || null,
                phone: data.phone ?? null
              }
            ).pipe(map((item) => this.mapObjectItem(item)));

          case 'Activity':
            return this.http.post<ActivityResponseDto>(
              buildApiUrl('activities'),
              {
                name: data.title,
                description: data.description,
                activityTypeId: data.activityTypeId ?? 1,
                destinationId: data.destinationId,
                objectId: data.objectId ?? null,
                durationMinutes: data.durationMinutes ?? null,
                price: data.price,
                currency: data.currency ?? 'RSD',
                airbnbUrl: data.airbnbLink || null,
                bookingUrl: data.bookingLink || null,
                latitude: data.latitude ?? null,
                longitude: data.longitude ?? null
              }
            ).pipe(map((item) => this.mapActivityItem(item)));

          case 'Event':
            if (!data.objectId) {
              return throwError(() => new Error('Event requires a related object.'));
            }

            return this.http.post<EventResponseDto>(
              buildApiUrl('events'),
              {
                objectId: data.objectId,
                eventTypeId: data.eventTypeId ?? 1,
                name: data.title,
                description: data.description,
                startDatetime: data.startDateTime,
                endDatetime: data.endDateTime ?? null,
                capacity: data.capacity,
                price: data.price,
                currency: data.currency ?? 'RSD',
                latitude: data.latitude ?? null,
                longitude: data.longitude ?? null
              }
            ).pipe(map((item) => this.mapEventItem(item)));
        }
      })
    );
  }

  getReviewsForContentItems(items: PublisherContentItem[]) {
    if (!items.length) {
      return of([] as Array<{ item: PublisherContentItem; reviews: any[] }>);
    }

    return forkJoin(
      items.map((item) =>
        this.http.get<{ reviews?: any[] }>(
          buildApiUrl(`review/target/${item.type}/${item.id}?page=1&pageSize=50`)
        ).pipe(
          map((response) => ({ item, reviews: response.reviews ?? [] }))
        )
      )
    );
  }

  private getContentByTypeAndId(contentType: PublisherContentType, id: number): Observable<PublisherContentItem> {
    switch (contentType) {
      case 'Object':
        return this.http.get<TouristObjectResponseDto>(buildApiUrl(`tourist-objects/${id}`)).pipe(
          map((item) => this.mapObjectItem(item))
        );

      case 'Activity':
        return this.http.get<ActivityResponseDto>(buildApiUrl(`activities/${id}`)).pipe(
          map((item) => this.mapActivityItem(item))
        );

      case 'Event':
        return this.http.get<EventResponseDto>(buildApiUrl(`events/${id}`)).pipe(
          map((item) => this.mapEventItem(item))
        );
    }
  }

  private mapObjectItem(item: TouristObjectResponseDto): PublisherContentItem {
    return {
      id: item.id,
      title: item.name,
      type: 'Object',
      status: this.mapStatus(item.statusName),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      approvedAt: item.approvedAt ?? null,
      rejectionReason: item.rejectionReason ?? undefined,
      description: item.description ?? '',
      location: item.address ?? '',
      startDateTime: '',
      capacity: null,
      price: null,
      airbnbLink: item.airbnbUrl ?? '',
      bookingLink: item.bookingUrl ?? '',
      destinationId: item.destinationId,
      destinationName: item.destinationName ?? null,
      objectTypeId: item.objectTypeId,
      objectTypeName: item.objectTypeName ?? null,
      currency: null,
      imageUrl: this.firstImageUrl(item),
      imageUrls: this.normalizeImageUrls(item),
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      website: item.website ?? null,
      phone: item.phone ?? null,
      averageRating: item.averageRating ?? null,
      reviewCount: item.reviewCount ?? null,
    };
  }

  private mapActivityItem(item: ActivityResponseDto): PublisherContentItem {
    return {
      id: item.id,
      title: item.name,
      type: 'Activity',
      status: this.mapStatus(item.statusName),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      approvedAt: item.approvedAt ?? null,
      rejectionReason: item.rejectionReason ?? undefined,
      description: item.description ?? '',
      location: item.objectName ?? item.destinationName ?? '',
      startDateTime: '',
      capacity: null,
      price: item.price ?? null,
      airbnbLink: item.airbnbUrl ?? '',
      bookingLink: item.bookingUrl ?? '',
      destinationId: item.destinationId ?? null,
      destinationName: item.destinationName ?? null,
      activityTypeId: item.activityTypeId,
      activityTypeName: item.activityTypeName ?? null,
      objectId: item.objectId ?? null,
      objectName: item.objectName ?? null,
      currency: item.currency ?? 'RSD',
      imageUrl: this.firstImageUrl(item),
      imageUrls: this.normalizeImageUrls(item),
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      durationMinutes: item.durationMinutes ?? null,
      averageRating: item.averageRating ?? null,
      reviewCount: item.reviewCount ?? null,
    };
  }

  private mapEventItem(item: EventResponseDto): PublisherContentItem {
    return {
      id: item.id,
      title: item.name,
      type: 'Event',
      status: this.mapStatus(item.statusName),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      approvedAt: item.approvedAt ?? null,
      rejectionReason: item.rejectionReason ?? undefined,
      description: item.description ?? '',
      location: item.objectName ?? item.destinationName ?? '',
      startDateTime: item.startDatetime ? item.startDatetime.slice(0, 16) : '',
      endDateTime: item.endDatetime ? item.endDatetime.slice(0, 16) : null,
      capacity: item.capacity ?? null,
      price: item.price ?? null,
      airbnbLink: '',
      bookingLink: '',
      eventTypeId: item.eventTypeId,
      eventTypeName: item.eventTypeName ?? null,
      objectId: item.objectId,
      objectName: item.objectName ?? null,
      destinationId: item.destinationId ?? null,
      destinationName: item.destinationName ?? null,
      currency: item.currency ?? 'RSD',
      imageUrl: this.firstImageUrl(item),
      imageUrls: this.normalizeImageUrls(item),
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      averageRating: item.averageRating ?? null,
      reviewCount: item.reviewCount ?? null,
    };
  }

  private mapStatus(statusName?: string | null): PublisherContentItem['status'] {
    switch ((statusName ?? '').toLowerCase()) {
      case 'approved':
        return 'Approved';
      case 'rejected':
        return 'Rejected';
      case 'pending':
        return 'Pending Approval';
      default:
        return 'Draft';
    }
  }

  private normalizeUploadResponse(response: ImageUploadResponse): string[] {
    if (Array.isArray(response.urls) && response.urls.length > 0) {
      return buildAssetUrls({ imageUrls: response.urls });
    }

    if (Array.isArray(response.relativePaths) && response.relativePaths.length > 0) {
      return buildAssetUrls({ imageUrls: response.relativePaths });
    }

    const single = response.url ?? response.relativeUrl ?? response.relativePath ?? null;
    return buildAssetUrls({ imageUrl: single });
  }

  private buildImageFormData(files: File[], retainedImageUrls: string[], replaceExistingImages: boolean): FormData {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    retainedImageUrls.forEach((url) => formData.append('retainedImageUrls', url));
    if (replaceExistingImages) {
      formData.append('replaceExistingImages', 'true');
    }
    return formData;
  }

  private normalizeImageUrls(item: { imageUrl?: string | null; imageUrls?: string[] | null }): string[] {
    return buildAssetUrls(item);
  }

  private firstImageUrl(item: { imageUrl?: string | null; imageUrls?: string[] | null }): string | null {
    return firstAssetUrl(item);
  }

  private normalizeContentType(value?: string | null): PublisherContentType | null {
    if (value === 'Object' || value === 'Event' || value === 'Activity') {
      return value;
    }

    return null;
  }

  getDestinations(): Observable<ReferenceOption[]> {
    return this.getAllDestinationRows().pipe(
      map((items) => items.map((item: any) => ({
        id: item.id,
        name: item.name,
        latitude: item.latitude,
        longitude: item.longitude,
        boundMinLat: item.boundMinLat ?? null,
        boundMaxLat: item.boundMaxLat ?? null,
        boundMinLng: item.boundMinLng ?? null,
        boundMaxLng: item.boundMaxLng ?? null,
      })))
    );
  }

  private getAllDestinationRows(pageSize = 50): Observable<any[]> {
    return this.getDestinationRowsPage(1, pageSize).pipe(
      expand(result => result.rows.length === pageSize
        ? this.getDestinationRowsPage(result.page + 1, pageSize)
        : EMPTY
      ),
      reduce((allRows, result) => [...allRows, ...result.rows], [] as any[])
    );
  }

  private getDestinationRowsPage(page: number, pageSize: number): Observable<{ page: number; rows: any[] }> {
    return this.http.get<any>(buildApiUrl(`destinations?page=${page}&pageSize=${pageSize}`)).pipe(
      map(response => ({
        page,
        rows: Array.isArray(response) ? response : response?.items ?? response?.data ?? []
      }))
    );
  }
}
