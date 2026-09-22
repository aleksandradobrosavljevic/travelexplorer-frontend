import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { AuthState } from '../../../../core/services/auth-state.service';
import { buildAssetUrls } from '../../../../core/config/api';
import {
  ActivityRecord,
  AdminDestinationReferenceData,
  DestinationRecord,
  EventRecord,
  TouristObjectRecord
} from '../../shared/admin-destination.models';

export interface ContentContext {
  destination: DestinationRecord | null;
  objects: TouristObjectRecord[];
  activities: ActivityRecord[];
  events: EventRecord[];
  referenceData: AdminDestinationReferenceData;
  objectTotalCount: number;
  activityTotalCount: number;
  eventTotalCount: number;
}

export interface PagedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ImageUploadResponse {
  url?: string | null;
  relativePath?: string | null;
  urls?: string[];
  relativePaths?: string[];
}

@Injectable({ providedIn: 'root' })
export class AdminDestinationContentService {
  private readonly http = inject(HttpClient);
  private readonly authState = inject(AuthState);
  private readonly apiUrl = environment.apiUrl;

  getContentContext(): Observable<ContentContext> {
    const user = this.authState.getCurrentUser() as any;
    const destinationId = user?.destinationId
      ?? user?.DestinationId
      ?? user?.adminProfile?.destinationId
      ?? user?.AdminProfile?.DestinationId
      ?? null;

    const destination$ = destinationId
      ? this.http.get<DestinationRecord>(`${this.apiUrl}/destinations/${destinationId}`).pipe(
          catchError(() => of(null))
        )
      : of(null);

      return forkJoin({
        destination: destination$,
        objectsResult: this.getObjects(1, 10),
        activitiesResult: this.getActivities(1, 10),
        eventsResult: this.getEvents(1, 10),
        referenceData: this.getReferenceData().pipe(
          catchError(() => of({ objectTypes: [], activityTypes: [], eventTypes: [] }))
        )
      }).pipe(
        switchMap((context) => {
          const objects = context.objectsResult.items;
          const activities = context.activitiesResult.items;
          const events = context.eventsResult.items;
      
          const base = {
            destination: context.destination,
            objects,
            activities,
            events,
            referenceData: context.referenceData,
            objectTotalCount: context.objectsResult.totalCount,
            activityTotalCount: context.activitiesResult.totalCount,
            eventTotalCount: context.eventsResult.totalCount,
          };
      
          if (base.destination) return of(base);
      
          const fallbackId = objects.find(o => o.destinationId != null)?.destinationId
            ?? activities.find(a => a.destinationId != null)?.destinationId
            ?? null;
      
          if (!fallbackId) return of(base);
      
          return this.http.get<DestinationRecord>(`${this.apiUrl}/destinations/${fallbackId}`).pipe(
            map((destination) => ({ ...base, destination })),
            catchError(() => of(base))
          );
        }),
        catchError(() => of({
          destination: null,
          objects: [],
          activities: [],
          events: [],
          referenceData: { objectTypes: [], activityTypes: [], eventTypes: [] },
          objectTotalCount: 0,
          activityTotalCount: 0,
          eventTotalCount: 0,
        }))
      );
  }

  updateDestinationStatus(destination: DestinationRecord, isActive: boolean): Observable<DestinationRecord> {
    return this.http.patch<DestinationRecord>(`${this.apiUrl}/destinations/${destination.id}`, { isActive });
  }

  createActivity(payload: any): Observable<ActivityRecord> {
    return this.http.post<ActivityRecord>(`${this.apiUrl}/activities`, payload).pipe(
      map((item) => this.normalizeActivityRecord(item))
    );
  }

  updateActivity(id: number, payload: any): Observable<ActivityRecord> {
    return this.http.put<ActivityRecord>(`${this.apiUrl}/activities/${id}`, payload).pipe(
      map((item) => this.normalizeActivityRecord(item))
    );
  }

  approveActivity(id: number): Observable<ActivityRecord> {
    return this.http.patch<ActivityRecord>(`${this.apiUrl}/activities/${id}/approve`, {}).pipe(
      map((item) => this.normalizeActivityRecord(item))
    );
  }

  rejectActivity(id: number, reason: string): Observable<ActivityRecord> {
    return this.http.patch<ActivityRecord>(
      `${this.apiUrl}/activities/${id}/reject`,
      JSON.stringify(reason),
      { headers: { 'Content-Type': 'application/json' } }
    ).pipe(map((item) => this.normalizeActivityRecord(item)));
  }

  deleteActivity(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/activities/${id}`);
  }

  createEvent(payload: any): Observable<EventRecord> {
    return this.http.post<EventRecord>(`${this.apiUrl}/events`, payload).pipe(
      map((item) => this.normalizeEventRecord(item))
    );
  }

  updateEvent(id: number, payload: any): Observable<EventRecord> {
    return this.http.put<EventRecord>(`${this.apiUrl}/events/${id}`, payload).pipe(
      map((item) => this.normalizeEventRecord(item))
    );
  }

  approveEvent(id: number): Observable<EventRecord> {
    return this.http.patch<EventRecord>(`${this.apiUrl}/events/${id}/approve`, {}).pipe(
      map((item) => this.normalizeEventRecord(item))
    );
  }

  rejectEvent(id: number, reason: string): Observable<EventRecord> {
    return this.http.patch<EventRecord>(
      `${this.apiUrl}/events/${id}/reject`,
      JSON.stringify(reason),
      { headers: { 'Content-Type': 'application/json' } }
    ).pipe(map((item) => this.normalizeEventRecord(item)));
  }

  deleteEvent(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/events/${id}`);
  }

  private getReferenceData(): Observable<AdminDestinationReferenceData> {
    return forkJoin({
      objectTypes: this.http.get<{ id: number; name: string }[]>(
        `${this.apiUrl}/reference-data/object-types`
      ),
      activityTypes: this.http.get<{ id: number; name: string }[]>(
        `${this.apiUrl}/reference-data/activity-types`
      ),
      eventTypes: this.http.get<{ id: number; name: string }[]>(
        `${this.apiUrl}/reference-data/event-types`
      )
    });
  }

  getObjects(page = 1, pageSize = 10, search = '', statusName = '', isActive?: boolean): Observable<PagedResult<TouristObjectRecord>> {
    let params = new HttpParams()
      .set('page', page)
      .set('pageSize', pageSize);
    if (search) params = params.set('search', search);
    if (statusName && statusName !== 'all') params = params.set('statusName', statusName);
    if (isActive !== undefined) params = params.set('isActive', isActive.toString());
    return this.http.get<PagedResult<TouristObjectRecord>>(
      `${this.apiUrl}/tourist-objects/all`, { params }
    ).pipe(
      map((result) => this.normalizePagedResult(result, page, pageSize, (item) => this.normalizeObjectRecord(item))),
      catchError(() => of({ items: [], totalCount: 0, page, pageSize, totalPages: 0 }))
    );
  }
  
  getActivities(page = 1, pageSize = 10, search = '', statusName = '', isActive?: boolean): Observable<PagedResult<ActivityRecord>> {
    let params = new HttpParams()
      .set('page', page)
      .set('pageSize', pageSize);
    if (search) params = params.set('search', search);
    if (statusName && statusName !== 'all') params = params.set('statusName', statusName);
    if (isActive !== undefined) params = params.set('isActive', isActive.toString());
    return this.http.get<PagedResult<ActivityRecord>>(
      `${this.apiUrl}/activities/all`, { params }
    ).pipe(
      map((result) => this.normalizePagedResult(result, page, pageSize, (item) => this.normalizeActivityRecord(item))),
      catchError(() => of({ items: [], totalCount: 0, page, pageSize, totalPages: 0 }))
    );
  }
  
  getEvents(page = 1, pageSize = 10, search = '', statusName = '', isActive?: boolean): Observable<PagedResult<EventRecord>> {
    let params = new HttpParams()
      .set('page', page)
      .set('pageSize', pageSize);
    if (search) params = params.set('search', search);
    if (statusName && statusName !== 'all') params = params.set('statusName', statusName);
    if (isActive !== undefined) params = params.set('isActive', isActive.toString());
    return this.http.get<PagedResult<EventRecord>>(
      `${this.apiUrl}/events/all`, { params }
    ).pipe(
      map((result) => this.normalizePagedResult(result, page, pageSize, (item) => this.normalizeEventRecord(item))),
      catchError(() => of({ items: [], totalCount: 0, page, pageSize, totalPages: 0 }))
    );
  }
  createObject(payload: any): Observable<TouristObjectRecord> {
    return this.http.post<TouristObjectRecord>(`${this.apiUrl}/tourist-objects`, payload).pipe(
      map((item) => this.normalizeObjectRecord(item))
    );
  }
  
  updateObject(id: number, payload: any): Observable<TouristObjectRecord> {
    return this.http.put<TouristObjectRecord>(`${this.apiUrl}/tourist-objects/${id}`, payload).pipe(
      map((item) => this.normalizeObjectRecord(item))
    );
  }
  
  approveObject(id: number): Observable<TouristObjectRecord> {
    return this.http.patch<TouristObjectRecord>(`${this.apiUrl}/tourist-objects/${id}/approve`, {}).pipe(
      map((item) => this.normalizeObjectRecord(item))
    );
  }
  
  deleteObject(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/tourist-objects/${id}`);
  }
  
  rejectObject(id: number, reason: string): Observable<TouristObjectRecord> {
    return this.http.patch<TouristObjectRecord>(
      `${this.apiUrl}/tourist-objects/${id}/reject`,
      JSON.stringify(reason),
      { headers: { 'Content-Type': 'application/json' } }
    ).pipe(map((item) => this.normalizeObjectRecord(item)));
  }
  
  getObjectById(id: number): Observable<TouristObjectRecord> {
    return this.http.get<TouristObjectRecord>(`${this.apiUrl}/tourist-objects/${id}`).pipe(
      map((item) => this.normalizeObjectRecord(item))
    );
  }
  
  getActivityById(id: number): Observable<ActivityRecord> {
    return this.http.get<ActivityRecord>(`${this.apiUrl}/activities/${id}`).pipe(
      map((item) => this.normalizeActivityRecord(item))
    );
  }
  
  getEventById(id: number): Observable<EventRecord> {
    return this.http.get<EventRecord>(`${this.apiUrl}/events/${id}`).pipe(
      map((item) => this.normalizeEventRecord(item))
    );
  }

  getReviews(type: 'object' | 'activity' | 'event', id: number, pageSize = 50, sort = 'dateNewest'): Observable<any> {
    const targetType = type === 'object' ? 'Object' : type === 'activity' ? 'Activity' : 'Event';
    return this.http.get<any>(
      `${this.apiUrl}/review/target/${targetType}/${id}?page=1&pageSize=${pageSize}&sort=${sort}`
    ).pipe(catchError(() => of({ reviews: [], totalReviews: 0, averageRating: 0 })));
  }

  uploadObjectImage(objectId: number, files: File | File[], retainedImageUrls: string[] = []): Observable<ImageUploadResponse> {
    return this.uploadEntityImage(`tourist-objects/${objectId}/image`, files, retainedImageUrls);
  }

  uploadActivityImage(activityId: number, files: File | File[], retainedImageUrls: string[] = []): Observable<ImageUploadResponse> {
    return this.uploadEntityImage(`activities/${activityId}/image`, files, retainedImageUrls);
  }

  uploadEventImage(eventId: number, files: File | File[], retainedImageUrls: string[] = []): Observable<ImageUploadResponse> {
    return this.uploadEntityImage(`events/${eventId}/image`, files, retainedImageUrls);
  }

  private uploadEntityImage(path: string, files: File | File[], retainedImageUrls: string[]): Observable<ImageUploadResponse> {
    const formData = new FormData();
    const uploadFiles = Array.isArray(files) ? files : [files];
    uploadFiles.forEach((file) => formData.append('files', file));
    retainedImageUrls.forEach((url) => formData.append('retainedImageUrls', url));
    formData.append('replaceExistingImages', 'true');

    return this.http.patch<ImageUploadResponse>(
      `${this.apiUrl}/${path}`,
      formData
    ).pipe(map((response) => this.normalizeUploadResponse(response)));
  }

  toggleObjectActive(id: number): Observable<TouristObjectRecord> {
    return this.http.patch<TouristObjectRecord>(`${this.apiUrl}/tourist-objects/${id}/toggle-active`, {}).pipe(
      map((item) => this.normalizeObjectRecord(item))
    );
  }

  toggleActivityActive(id: number): Observable<ActivityRecord> {
    return this.http.patch<ActivityRecord>(`${this.apiUrl}/activities/${id}/toggle-active`, {}).pipe(
      map((item) => this.normalizeActivityRecord(item))
    );
  }

  toggleEventActive(id: number): Observable<EventRecord> {
    return this.http.patch<EventRecord>(`${this.apiUrl}/events/${id}/toggle-active`, {}).pipe(
      map((item) => this.normalizeEventRecord(item))
    );
  }

  private normalizePagedResult<T>(
    result: PagedResult<T> | null | undefined,
    page: number,
    pageSize: number,
    normalizeItem: (item: T) => T
  ): PagedResult<T> {
    return {
      items: (result?.items ?? []).map((item) => normalizeItem(item)),
      totalCount: result?.totalCount ?? 0,
      page: result?.page ?? page,
      pageSize: result?.pageSize ?? pageSize,
      totalPages: result?.totalPages ?? 0,
    };
  }

  private normalizeObjectRecord(item: TouristObjectRecord): TouristObjectRecord {
    return this.normalizeRecordImages(item);
  }

  private normalizeActivityRecord(item: ActivityRecord): ActivityRecord {
    return this.normalizeRecordImages(item);
  }

  private normalizeEventRecord(item: EventRecord): EventRecord {
    return this.normalizeRecordImages(item);
  }

  private normalizeRecordImages<T extends { imageUrl?: string | null; imageUrls?: string[] | null }>(item: T): T {
    const imageUrls = buildAssetUrls(item);
    return {
      ...item,
      imageUrl: imageUrls[0] ?? null,
      imageUrls,
    };
  }

  private normalizeUploadResponse(response: ImageUploadResponse): ImageUploadResponse {
    const imageUrls = buildAssetUrls({
      imageUrl: response.url ?? response.relativePath ?? null,
      imageUrls: [
        ...(response.urls ?? []),
        ...(response.relativePaths ?? []),
      ],
    });

    return {
      ...response,
      url: imageUrls[0] ?? null,
      urls: imageUrls,
    };
  }
}
