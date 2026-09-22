export interface AdminDestinationSummaryCard {
  label: string;
  value: string;
  hint: string;
  tone?: 'default' | 'good' | 'warning' | 'danger';
}

export interface AdminDestinationAnalyticsTableRow {
  label: string;
  value: number | string;
  hint?: string;
  tone?: 'default' | 'good' | 'warning' | 'danger';
}

export interface AdminDestinationTopItem {
  label: string;
  type?: string;
  value: number;
}

export interface AdminDestinationAnalytics {
  destinationName: string;
  selectedYear: number | null;
  availableYears: number[];
  hasDataForSelectedYear: boolean;
  summaryCards: AdminDestinationSummaryCard[];
  contentStatusRows: AdminDestinationAnalyticsTableRow[];
  contentTypeRows: AdminDestinationAnalyticsTableRow[];
  approvalRows: AdminDestinationAnalyticsTableRow[];
  reviewRows: AdminDestinationAnalyticsTableRow[];
  publisherRows: AdminDestinationPagedSection<AdminDestinationAnalyticsTableRow>;
  adminActionRows: AdminDestinationAnalyticsTableRow[];
  topSavedItems: AdminDestinationPagedSection<AdminDestinationTopItem>;
  notes: string[];
}

export interface DestinationRecord {
  id: number;
  destinationTypeId: number;
  destinationTypeName: string;
  name: string;
  country: string;
  description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TouristObjectRecord {
  id: number;
  destinationId: number;
  objectTypeId: number;
  objectTypeName: string;
  statusId: number;
  statusName: string;
  name: string;
  description?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  website?: string | null;
  phone?: string | null;
  airbnbUrl?: string | null;
  bookingUrl?: string | null;
  rejectionReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  isActive: boolean;
}

export interface ActivityRecord {
  id: number;
  name: string;
  description?: string | null;
  activityTypeId: number;
  activityTypeName: string;
  destinationId?: number | null;
  destinationName?: string | null;
  objectId?: number | null;
  objectName?: string | null;
  durationMinutes?: number | null;
  price?: number | null;
  currency?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  statusId: number;
  statusName: string;
  rejectionReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
  isActive: boolean;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
}

export interface EventRecord {
  id: number;
  publisherId?: number | null;
  adminId?: number | null;
  objectId: number;
  objectName?: string | null;
  eventTypeId: number;
  eventTypeName: string;
  statusId: number;
  statusName: string;
  name: string;
  description?: string | null;
  startDatetime: string;
  endDatetime?: string | null;
  capacity?: number | null;
  price?: number | null;
  currency?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  rejectionReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
  isActive: boolean;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
}

export interface RequestRecord {
  id: number;
  publisherUserId: number;
  adminId?: number | null;
  publisherTypeId: number;
  publisherTypeName: string;
  destinationId: number;
  destinationName: string;
  statusId: number;
  statusName: string;
  organizationName: string;
  contactPerson: string;
  phone: string;
  website?: string | null;
  description?: string | null;
  publisherAvatarUrl?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AdminDestinationRequestKind = 'account' | 'object' | 'activity' | 'event';

export interface AdminDestinationModerationRequest {
  id: number;
  kind: AdminDestinationRequestKind;
  title: string;
  subtitle: string;
  detail: string;
  owner: string;
  createdAt?: string;
  rejectionReason?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  price?: number | null;
  currency?: string | null;
  durationMinutes?: number | null;
  capacity?: number | null;
  startDatetime?: string | null;
  endDatetime?: string | null;
  destinationName?: string | null;
  objectName?: string | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
}

export interface ReviewModerationItem {
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
  reportCount: number;
  isReportedByCurrentUser?: boolean;
  createdAt: string;
  updatedAt: string;
  targetType: 'Object' | 'Activity' | 'Event';
  targetId: number;
  targetName: string;
}

export interface AdminDestinationUserAction {
  id: number;
  action: string;
  reason?: string | null;
  createdAt: string;
  adminDisplayName: string;
}

export interface AdminDestinationUserRow {
  id: number;
  email: string;
  role: string;
  isActive: boolean;
  firstName?: string | null;
  lastName?: string | null;
  organizationName?: string | null;
  joinedAt: string;
  actions: AdminDestinationUserAction[];
}

export interface AdminDestinationUsersPayload {
  destinationName: string;
  publishers: AdminDestinationUserRow[];
  tourists: AdminDestinationUserRow[];
}

export interface AdminDestinationReferenceData {
  objectTypes: { id: number; name: string }[];
  activityTypes: { id: number; name: string }[];
  eventTypes: { id: number; name: string }[];
}

export interface AdminDestinationPagedSection<T> {
  items: T[];
  totalCount: number;
  totalPages: number;
  page: number;
}
