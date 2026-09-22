import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { ReviewModerationItem } from '../../shared/admin-destination.models';

type ReviewApiItem = {
  id: number;
  touristId: number;
  touristFirstName: string;
  touristLastName: string;
  objectId?: number | null;
  activityId?: number | null;
  eventId?: number | null;
  rating: number;
  comment?: string | null;
  isVisible: boolean;
  isRead: boolean;
  rejectionReason?: string | null;
  reportCount?: number | null;
  isReportedByCurrentUser?: boolean | null;
  contentName?: string | null;
  contentType?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ReviewApiResponse = {
  reviews?: ReviewApiItem[];
};

@Injectable({ providedIn: 'root' })
export class AdminDestinationReviewsService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getReviewsForAdminDestination(): Observable<ReviewModerationItem[]> {
    const params = new HttpParams()
      .set('page', '1')
      .set('pageSize', '100');

    return this.http
      .get<ReviewApiResponse>(`${this.apiUrl}/review/reported`, { params })
      .pipe(map((response) => (response.reviews ?? []).map((review) => this.mapReview(review))));
  }

  toggleVisibility(id: number, rejectionReason?: string): Observable<ReviewModerationItem> {
    return this.http
      .patch<ReviewApiItem>(
        `${this.apiUrl}/review/${id}/toggle-visibility`,
        { rejectionReason: rejectionReason ?? null }
      )
      .pipe(map((review) => this.mapReview(review)));
  }

  ignoreReports(id: number): Observable<ReviewModerationItem> {
    return this.http
      .post<ReviewApiItem>(`${this.apiUrl}/review/${id}/ignore-reports`, {})
      .pipe(map((review) => this.mapReview(review)));
  }

  private mapReview(review: ReviewApiItem): ReviewModerationItem {
    const targetType = (review.contentType as 'Object' | 'Activity' | 'Event' | null)
      ?? (review.objectId ? 'Object' : review.activityId ? 'Activity' : 'Event');
    const targetId = review.objectId ?? review.activityId ?? review.eventId ?? 0;

    return {
      ...review,
      targetType,
      targetId,
      targetName: review.contentName ?? `${targetType} #${targetId}`,
      reportCount: review.reportCount ?? 0,
      isReportedByCurrentUser: !!review.isReportedByCurrentUser
    } satisfies ReviewModerationItem;
  }
}
