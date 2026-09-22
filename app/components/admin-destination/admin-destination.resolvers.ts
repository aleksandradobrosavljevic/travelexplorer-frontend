import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { of  } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  ActivityRecord,
  AdminDestinationAnalytics,
  AdminDestinationModerationRequest,
  AdminDestinationUsersPayload,
  DestinationRecord,
  EventRecord,
  ReviewModerationItem,
  TouristObjectRecord,
  AdminDestinationReferenceData
} from './shared/admin-destination.models';
import { AdminDestinationDashboardService } from './pages/dashboard/dashboard.service';
import { AdminDestinationContentService } from './pages/content/content.service';
import { AdminDestinationMapService, MapContext } from './pages/map/map.service';
import { AdminDestinationRequestsService } from './pages/requests/requests.service';
import { AdminDestinationReviewsService } from './pages/reviews/reviews.service';

export interface AdminDestinationContentResolvedData {
  destination: DestinationRecord | null;
  objects: TouristObjectRecord[];
  activities: ActivityRecord[];
  events: EventRecord[];
  referenceData: AdminDestinationReferenceData;
}

export const adminDestinationDashboardResolver: ResolveFn<AdminDestinationAnalytics | null> = () => {
  return inject(AdminDestinationDashboardService).getDashboardAnalytics().pipe(
    catchError(() => of(null))
  );
};

export const adminDestinationContentResolver: ResolveFn<AdminDestinationContentResolvedData | null> = () => {
  return inject(AdminDestinationContentService).getContentContext().pipe(
    catchError(() => of(null))
  );
};

export const adminDestinationMapResolver: ResolveFn<MapContext | null> = () => {
  return inject(AdminDestinationMapService).getMapContext().pipe(
    catchError(() => of(null))
  );
};
export const adminDestinationRequestsResolver: ResolveFn<AdminDestinationModerationRequest[]> = () => {
  return inject(AdminDestinationRequestsService).getModerationRequests().pipe(
    catchError(() => of([]))
  );
};

export const adminDestinationReviewsResolver: ResolveFn<ReviewModerationItem[]> = () => {
  return inject(AdminDestinationReviewsService).getReviewsForAdminDestination().pipe(
    catchError(() => of([]))
  );
};
