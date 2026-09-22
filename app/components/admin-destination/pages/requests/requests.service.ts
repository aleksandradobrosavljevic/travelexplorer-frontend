import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, catchError, expand, forkJoin, map, Observable, of, reduce } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { firstAssetUrl } from '../../../../core/config/api';
import {
  ActivityRecord,
  AdminDestinationModerationRequest,
  EventRecord,
  RequestRecord,
  TouristObjectRecord
} from '../../shared/admin-destination.models';

@Injectable({ providedIn: 'root' })
export class AdminDestinationRequestsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  private readonly MODERATION_PAGE_SIZE = 50;

  getModerationRequests(): Observable<AdminDestinationModerationRequest[]> {
    return forkJoin({
      accounts: this.getAllPagedRows<RequestRecord>('requests', { status: 'Pending' }),
      objects: this.getAllPagedRows<TouristObjectRecord>('tourist-objects', { statusName: 'Pending' }),
      activities: this.getAllPagedRows<ActivityRecord>('activities', { statusName: 'Pending' }),
      events: this.getAllPagedRows<EventRecord>('events', { statusName: 'Pending' }),
    }).pipe(
      map(({ accounts, objects, activities, events }) => [
        ...accounts.map((r) => this.mapAccountRequest(r)),
        ...objects.map((r) => this.mapObjectRequest(r)),
        ...activities.map((r) => this.mapActivityRequest(r)),
        ...events.map((r) => this.mapEventRequest(r))
      ].sort((a, b) => this.compareCreatedAtDesc(a.createdAt, b.createdAt)))
    );
  }

  approveModerationRequest(item: AdminDestinationModerationRequest): Observable<unknown> {
    switch (item.kind) {
      case 'account':
        return this.http.put(`${this.apiUrl}/requests/${item.id}/approve`, {});
      case 'object':
        return this.http.patch(`${this.apiUrl}/tourist-objects/${item.id}/approve`, {});
      case 'activity':
        return this.http.patch(`${this.apiUrl}/activities/${item.id}/approve`, {});
      case 'event':
        return this.http.patch(`${this.apiUrl}/events/${item.id}/approve`, {});
    }
  }

  rejectModerationRequest(item: AdminDestinationModerationRequest, reason: string): Observable<unknown> {
    const body = JSON.stringify(reason);
    const headers = { 'Content-Type': 'application/json' };

    switch (item.kind) {
      case 'account':
        return this.http.put(`${this.apiUrl}/requests/${item.id}/reject`, body, { headers });
      case 'object':
        return this.http.patch(`${this.apiUrl}/tourist-objects/${item.id}/reject`, body, { headers });
      case 'activity':
        return this.http.patch(`${this.apiUrl}/activities/${item.id}/reject`, body, { headers });
      case 'event':
        return this.http.patch(`${this.apiUrl}/events/${item.id}/reject`, body, { headers });
    }
  }

  private mapAccountRequest(item: RequestRecord): AdminDestinationModerationRequest {
    return {
      id: item.id,
      kind: 'account',
      title: item.organizationName,
      subtitle: item.publisherTypeName,
      detail: item.description || item.website || 'Publisher account request',
      owner: item.contactPerson,
      createdAt: item.createdAt,
      rejectionReason: item.rejectionReason,
      phone: item.phone,
      website: item.website,
      destinationName: item.destinationName,
      imageUrl: firstAssetUrl({ imageUrl: item.publisherAvatarUrl ?? null })
    };
  }

  private mapObjectRequest(item: TouristObjectRecord): AdminDestinationModerationRequest {
    return {
      id: item.id,
      kind: 'object',
      title: item.name,
      subtitle: item.objectTypeName,
      detail: item.description || item.address || 'Tourist object request',
      owner: item.phone || item.website || 'Object submission',
      createdAt: item.createdAt,
      rejectionReason: item.rejectionReason,
      phone: item.phone,
      website: item.website,
      address: item.address,
      imageUrl: firstAssetUrl(item)
    };
  }
  
  private mapActivityRequest(item: ActivityRecord): AdminDestinationModerationRequest {
    return {
      id: item.id,
      kind: 'activity',
      title: item.name,
      subtitle: item.activityTypeName,
      detail: item.description || 'Activity request',
      owner: item.objectId ? `Linked object #${item.objectId}` : 'No linked object',
      createdAt: item.createdAt,
      rejectionReason: item.rejectionReason,
      price: item.price,
      currency: item.currency,
      durationMinutes: item.durationMinutes,
      destinationName: item.destinationName,
      objectName: item.objectName || (item.objectId ? `Object #${item.objectId}` : null),
      imageUrl: firstAssetUrl(item)
    };
  }
  
  private mapEventRequest(item: EventRecord): AdminDestinationModerationRequest {
    return {
      id: item.id,
      kind: 'event',
      title: item.name,
      subtitle: item.eventTypeName,
      detail: item.description || 'Event request',
      owner: item.objectName || `Object #${item.objectId}`,
      objectName: item.objectName || `Object #${item.objectId}`,
      createdAt: item.createdAt,
      rejectionReason: item.rejectionReason,
      price: item.price,
      currency: item.currency,
      capacity: item.capacity,
      startDatetime: item.startDatetime,
      endDatetime: item.endDatetime,
      imageUrl: firstAssetUrl(item)
    };
  }
  
  private compareCreatedAtDesc(a?: string, b?: string): number {
    return new Date(b ?? 0).getTime() - new Date(a ?? 0).getTime();
  }

  private getAllPagedRows<T>(
    path: string,
    params: Record<string, string>
  ): Observable<T[]> {
    return this.getPagedRowsPage<T>(path, params, 1).pipe(
      expand(result => result.rows.length === this.MODERATION_PAGE_SIZE
        ? this.getPagedRowsPage<T>(path, params, result.page + 1)
        : EMPTY
      ),
      reduce((rows, result) => [...rows, ...result.rows], [] as T[]),
      catchError(() => of([] as T[]))
    );
  }

  private getPagedRowsPage<T>(
    path: string,
    params: Record<string, string>,
    page: number
  ): Observable<{ page: number; rows: T[] }> {
    const query = new URLSearchParams({
      ...params,
      page: String(page),
      pageSize: String(this.MODERATION_PAGE_SIZE)
    });

    return this.http.get<any>(`${this.apiUrl}/${path}?${query.toString()}`).pipe(
      map(response => ({
        page,
        rows: Array.isArray(response) ? response : response?.items ?? response?.data ?? []
      }))
    );
  }
}
