import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal, inject, DestroyRef, NgZone, HostListener, WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePickerModule } from 'primeng/datepicker';
import { Select } from 'primeng/select';
import { Paginator, PaginatorState } from 'primeng/paginator';
import { HttpBackend, HttpClient } from '@angular/common/http';
import { Overlay, OverlayRef, OverlayModule } from '@angular/cdk/overlay';
import { TemplatePortal, PortalModule } from '@angular/cdk/portal';
import { ViewChild, TemplateRef, ViewContainerRef, ElementRef } from '@angular/core';
import {
  ActivityRecord,
  DestinationRecord,
  EventRecord,
  TouristObjectRecord
} from '../../shared/admin-destination.models';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog';
import { RejectionReasonDialogComponent } from '../../../shared/rejection-reason-dialog/rejection-reason-dialog';
import { AdminDestinationContentService, ContentContext } from './content.service';
import { DestinationBounds, DestinationBoundsService } from '../../shared/destination-bounds.service';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-message';
import {
  PHONE_FORMAT_EXAMPLE,
  PHONE_FORMAT_HELPER,
  PHONE_INVALID_MESSAGE,
  isValidPhone,
  normalizePhone,
  sanitizePhoneInput
} from '../../../../core/utils/phone-format';
import { IMAGE_UPLOAD_HINT, oversizedImageMessage, splitImagesBySize } from '../../../../core/utils/image-upload-limits';
import * as L from 'leaflet';
delete (L.Icon.Default.prototype as any)._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

type PendingContentAction =
  | { type: 'toggle-destination' }
  | { type: 'approve-object'; item: TouristObjectRecord }
  | { type: 'reject-object'; item: TouristObjectRecord; reason: string }
  | { type: 'delete-object'; item: TouristObjectRecord }
  | { type: 'toggle-object-active'; item: TouristObjectRecord }
  | { type: 'approve-activity'; item: ActivityRecord }
  | { type: 'reject-activity'; item: ActivityRecord; reason: string }
  | { type: 'delete-activity'; item: ActivityRecord }
  | { type: 'toggle-activity-active'; item: ActivityRecord }
  | { type: 'approve-event'; item: EventRecord }
  | { type: 'reject-event'; item: EventRecord; reason: string }
  | { type: 'delete-event'; item: EventRecord }
  | { type: 'toggle-event-active'; item: EventRecord }
  | null;

type RejectionReasonTarget =
  | { type: 'object'; item: TouristObjectRecord }
  | { type: 'activity'; item: ActivityRecord }
  | { type: 'event'; item: EventRecord }
  | null;

@Component({
  selector: 'app-admin-destination-content',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDialogComponent, RejectionReasonDialogComponent, DatePickerModule, Select, Paginator, OverlayModule, PortalModule],
  templateUrl: './content.html',
  styleUrl: './content.css'
})
export class AdminDestinationContentComponent implements OnInit {
  private readonly contentService = inject(AdminDestinationContentService);
  private readonly boundsService = inject(DestinationBoundsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toastr = inject(ToastrService);
  private readonly ngZone = inject(NgZone);

  private readonly overlay = inject(Overlay);
  private readonly viewContainerRef = inject(ViewContainerRef);
  
  private objectOverlayRef: OverlayRef | null = null;
  private activityOverlayRef: OverlayRef | null = null;
  
  @ViewChild('objectAddressInput') objectAddressInput!: ElementRef;
  @ViewChild('activityAddressInput') activityAddressInput!: ElementRef;
  @ViewChild('objectSuggestionsTemplate') objectSuggestionsTemplate!: TemplateRef<any>;
  @ViewChild('activitySuggestionsTemplate') activitySuggestionsTemplate!: TemplateRef<any>;

  private destinationBounds: DestinationBounds | null = null;

  readonly objectTotalCount = signal(0);
  readonly activityTotalCount = signal(0);
  readonly eventTotalCount = signal(0);
  readonly objectAddress = signal<string | null>(null);

  get minDateTime(): Date { return new Date(); }

  private objectSuggestionIdx = -1;
  private activitySuggestionIdx = -1;

  readonly objectAddressSuggestions = signal<any[]>([]);
  readonly activityAddressSuggestions = signal<any[]>([]);

  private eventMap: L.Map | null = null;
  private eventMarker: L.Marker | null = null;

  private readonly destroyRef = inject(DestroyRef);
  private readonly addressSearch$ = new Subject<string>();

  readonly objectLocationSet = signal(false);

  private objectMap: L.Map | null = null;
  private objectMarker: L.Marker | null = null;

  private readonly nominatimHttp = new HttpClient(inject(HttpBackend));

  readonly objectFormSnapshot = signal<string | null>(null);
  readonly activityFormSnapshot = signal<string | null>(null);
  readonly eventFormSnapshot = signal<string | null>(null);

  private activityMap: L.Map | null = null;
  private activityMarker: L.Marker | null = null;
  readonly activityLocationSet = signal(false);
  readonly activityAddress = signal<string | null>(null);
  private readonly activityAddressSearch$ = new Subject<string>();

  readonly destination = signal<DestinationRecord | null>(null);
  readonly objects = signal<TouristObjectRecord[]>([]);
  readonly activities = signal<ActivityRecord[]>([]);
  readonly events = signal<EventRecord[]>([]);
  readonly activityTypes = signal<{ id: number; name: string }[]>([]);
  readonly eventTypes = signal<{ id: number; name: string }[]>([]);
  readonly isLoading = signal(false);
  readonly activeContentTable = signal<'objects' | 'activities' | 'events'>('objects');
  readonly activitySearch = signal('');
  readonly eventSearch = signal('');
  readonly activityStatusFilter = signal('all');
  readonly eventStatusFilter = signal('all');
  readonly editingActivityId = signal<number | null>(null);
  readonly editingEventId = signal<number | null>(null);
  readonly pendingAction = signal<PendingContentAction>(null);
  readonly rejectionReasonTarget = signal<RejectionReasonTarget>(null);
  readonly objectTypes = signal<{ id: number; name: string }[]>([]);
  readonly editingObjectId = signal<number | null>(null);
  readonly objectSearch = signal('');
  readonly objectStatusFilter = signal('all');

  // ── Constants ─────────────────────────────────────────────────────
  readonly DESCRIPTION_MAX_LENGTH = 500;

  readonly statusFilterOptions = [
    { label: 'All statuses', value: 'all' },
    { label: 'Approved', value: 'approved' },
    { label: 'Pending', value: 'pending' },
    { label: 'Rejected', value: 'rejected' }
  ];

  readonly contentStatusOptions = [
    { label: 'Approved', value: 'Approved' },
    { label: 'Pending',  value: 'Pending'  },
    { label: 'Rejected', value: 'Rejected' },
  ];

  readonly objectImagePreview = signal<string | null>(null);
  readonly activityImagePreview = signal<string | null>(null);
  readonly eventImagePreview = signal<string | null>(null);
  readonly objectImagePreviews = signal<string[]>([]);
  readonly activityImagePreviews = signal<string[]>([]);
  readonly eventImagePreviews = signal<string[]>([]);
  readonly objectImageFiles = signal<File[]>([]);
  readonly activityImageFiles = signal<File[]>([]);
  readonly eventImageFiles = signal<File[]>([]);
  readonly objectRetainedImageUrls = signal<string[]>([]);
  readonly activityRetainedImageUrls = signal<string[]>([]);
  readonly eventRetainedImageUrls = signal<string[]>([]);
  readonly objectImageBaselineUrls = signal<string[]>([]);
  readonly activityImageBaselineUrls = signal<string[]>([]);
  readonly eventImageBaselineUrls = signal<string[]>([]);
  readonly maxImageUploadCount = 15;
  readonly phonePlaceholder = PHONE_FORMAT_EXAMPLE;
  readonly phoneHelperText = PHONE_FORMAT_HELPER;
  readonly websitePlaceholder = 'https://example.com';
  readonly airbnbUrlPlaceholder = 'https://www.airbnb.com/rooms/123456';
  readonly bookingUrlPlaceholder = 'https://www.booking.com/hotel/rs/example.html';
  readonly urlHelperText = 'Use a full http:// or https:// URL.';
  readonly imageUploadHint = IMAGE_UPLOAD_HINT;
  readonly objectImageError = signal<string | null>(null);
  readonly activityImageError = signal<string | null>(null);
  readonly eventImageError = signal<string | null>(null);
  readonly lightboxImage = signal<string | null>(null);
  private imageStripDrag: {
    element: HTMLElement;
    startX: number;
    scrollLeft: number;
    moved: boolean;
  } | null = null;

  readonly modalType = signal<'object' | 'activity' | 'event' | null>(null);
  readonly modalOpen = signal(false);

  readonly pageSizeOptions = [5, 10, 20];

  readonly objectPage = signal(1);
  readonly objectTotalPages = signal(1);
  readonly objectPageSize = signal(10);

  readonly activityPage = signal(1);
  readonly activityTotalPages = signal(1);
  readonly activityPageSize = signal(10);

  readonly eventPage = signal(1);
  readonly eventTotalPages = signal(1);
  readonly eventPageSize = signal(10);

  private readonly objectSearch$ = new Subject<void>();
  private readonly activitySearch$ = new Subject<void>();
  private readonly eventSearch$ = new Subject<void>();

  readonly objectActiveFilter = signal<string>('all');
  readonly activityActiveFilter = signal<string>('all');
  readonly eventActiveFilter = signal<string>('all');

  onObjectActiveChange(): void { this.refreshObjects(1); }
  onActivityActiveChange(): void { this.refreshActivities(1); }
  onEventActiveChange(): void { this.refreshEvents(1); }

  readonly activeFilterOptions = [
    { label: 'All', value: 'all' },
    { label: 'Active', value: 'true' },
    { label: 'Inactive', value: 'false' }
  ];

  readonly objectFormDirty = computed(() => {
    const snap = this.objectFormSnapshot();
    if (snap === null) return true;
    return snap !== this.snapshotObjectForm()
      || this.hasImageChanges(this.objectImageBaselineUrls(), this.objectRetainedImageUrls(), this.objectImageFiles());
  });

  readonly activityFormDirty = computed(() => {
    const snap = this.activityFormSnapshot();
    if (snap === null) return true;
    return snap !== this.snapshotActivityForm()
      || this.hasImageChanges(this.activityImageBaselineUrls(), this.activityRetainedImageUrls(), this.activityImageFiles());
  });

  readonly eventFormDirty = computed(() => {
    const snap = this.eventFormSnapshot();
    if (snap === null) return true;
    return snap !== this.snapshotEventForm()
      || this.hasImageChanges(this.eventImageBaselineUrls(), this.eventRetainedImageUrls(), this.eventImageFiles());
  });

  readonly formVersion = signal(0);

  bumpFormVersion(): void {
    this.formVersion.update(v => v + 1);
  }

  onObjectPhoneChange(value: string | null): void {
    this.objectForm.phone = sanitizePhoneInput(value);
    this.bumpFormVersion();
  }

  goToContentDetail(type: 'object' | 'activity' | 'event', item: TouristObjectRecord | ActivityRecord | EventRecord): void {
    this.router.navigate(['/admin-destination/content', type, item.id], {
      state: { returnUrl: this.router.url }
    });
  }

  objectForm = {
    name: '', description: '', objectTypeId: 0,
    address: '' as string | null,
    website: '' as string | null,
    phone: '' as string | null,
    latitude: null as number | null,
    longitude: null as number | null,
    airbnbUrl: null as string | null,
    bookingUrl: null as string | null,
    imageUrl: null as string | null,
    imageFile: null as File | null,
    statusName: 'Pending' as string,
  };

  readonly confirmDialogOpen = computed(() => this.pendingAction() !== null);
  readonly rejectionReasonDialogOpen = computed(() => this.rejectionReasonTarget() !== null);

  readonly rejectionReasonDialogMessage = computed(() => {
    const target = this.rejectionReasonTarget();
    return target ? `Enter a reason for rejecting "${target.item.name}".` : '';
  });

  readonly confirmDialogTitle = computed(() => {
    const action = this.pendingAction();
    switch (action?.type) {
      case 'toggle-destination': return this.destination()?.isActive ? 'Deactivate destination?' : 'Activate destination?';
      case 'approve-object': return 'Approve object?';
      case 'reject-object': return 'Reject object?';
      case 'delete-object': return 'Delete object?';
      case 'approve-activity': return 'Approve activity?';
      case 'reject-activity': return 'Reject activity?';
      case 'delete-activity': return 'Delete activity?';
      case 'approve-event': return 'Approve event?';
      case 'reject-event': return 'Reject event?';
      case 'delete-event': return 'Delete event?';
      case 'toggle-object-active': return (action as any).item?.isActive ? 'Deactivate object?' : 'Activate object?';
      case 'toggle-activity-active': return (action as any).item?.isActive ? 'Deactivate activity?' : 'Activate activity?';
      case 'toggle-event-active': return (action as any).item?.isActive ? 'Deactivate event?' : 'Activate event?';
      default: return 'Confirm action';
    }
  });

  readonly confirmDialogMessage = computed(() => {
    const action = this.pendingAction();
    if (!action) return '';
    if (action.type === 'toggle-destination') {
      return `Are you sure you want to ${this.destination()?.isActive ? 'deactivate' : 'activate'} this destination?`;
    }
    return 'item' in action ? `Continue with "${action.item.name}"?` : 'Are you sure?';
  });

  readonly confirmDialogDanger = computed(() => {
    const action = this.pendingAction();
    const type = action?.type;
    if (!action || !type) return false;
    if (type === 'delete-object' || type === 'delete-activity' || type === 'delete-event') return true;
    if (type === 'reject-object' || type === 'reject-activity' || type === 'reject-event') return true;
    if (type === 'toggle-destination') return true;
    if (type === 'toggle-object-active' || type === 'toggle-activity-active' || type === 'toggle-event-active') {
      return !!action.item.isActive;
    }
    return false;
  });

  readonly confirmDialogLabel = computed(() => {
    const type = this.pendingAction()?.type;
    if (type?.startsWith('delete')) return 'Delete';
    if (type?.startsWith('reject')) return 'Reject';
    if (type === 'toggle-object-active' || type === 'toggle-activity-active' || type === 'toggle-event-active') {
      const item = (this.pendingAction() as any)?.item;
      return item?.isActive ? 'Deactivate' : 'Activate';
    }
    if (type === 'toggle-destination') return this.destination()?.isActive ? 'Deactivate' : 'Activate';
    return 'Approve';
  });

  activityForm = {
    name: '', description: '', activityTypeId: 0,
    objectId: null as number | null, durationMinutes: null as number | null,
    price: null as number | null, currency: 'EUR',
    latitude: null as number | null, longitude: null as number | null,
    imageUrl: null as string | null,
    imageFile: null as File | null,
    statusName: 'Pending' as string,
  };

  eventForm = {
    objectId: 0, eventTypeId: 0, name: '', description: '',
    startDatetime: null as Date | null, endDatetime: null as Date | null,
    capacity: null as number | null,
    price: null as number | null, currency: 'EUR',
    imageUrl: null as string | null,
    imageFile: null as File | null,
    statusName: 'Pending' as string,
  };

  ngOnInit(): void {
    const context = this.route.snapshot.data['contentContext'] as ContentContext | undefined;
    if (context) this.applyContentContext(context);

    this.boundsService.getBounds().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(b => {
      this.destinationBounds = b;
    });

    this.addressSearch$.pipe(debounceTime(800), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.searchObjectAddress());
    this.activityAddressSearch$.pipe(debounceTime(800), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.searchActivityAddress());
    this.objectSearch$.pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refreshObjects(1));
    this.activitySearch$.pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refreshActivities(1));
    this.eventSearch$.pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refreshEvents(1));

    this.destroyRef.onDestroy(() => {
      document.removeEventListener('keydown', this.preventBackspaceNavigation);
    });
  }

  private reverseGeocode(lat: number, lng: number, onAddress: (address: string) => void): void {
    this.nominatimHttp.get<any>(
      `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=en`
    ).subscribe({
      next: (data) => {
        const props = data?.features?.[0]?.properties;
        if (props) {
          const parts = [
            props.street && props.housenumber 
              ? `${props.street} ${props.housenumber}` 
              : props.street,
            props.suburb || props.neighbourhood,
            props.city || props.town || props.village
          ].filter(Boolean);
          this.ngZone.run(() => onAddress(parts.join(', ')));
        }
      },
      error: () => {}
    });
  }

  private applyContentContext(context: ContentContext): void {
    this.objectTotalCount.set(context.objectTotalCount);
    this.activityTotalCount.set(context.activityTotalCount);
    this.eventTotalCount.set(context.eventTotalCount);
    this.objectTotalPages.set(Math.max(1, Math.ceil(context.objectTotalCount / this.objectPageSize())));
    this.activityTotalPages.set(Math.max(1, Math.ceil(context.activityTotalCount / this.activityPageSize())));
    this.eventTotalPages.set(Math.max(1, Math.ceil(context.eventTotalCount / this.eventPageSize())));
    this.destination.set(context.destination);
    this.objects.set(context.objects);
    this.activities.set(context.activities);
    this.events.set(context.events);
    this.objectTypes.set(context.referenceData.objectTypes ?? []);
    this.activityTypes.set(context.referenceData.activityTypes ?? []);
    this.eventTypes.set(context.referenceData.eventTypes ?? []);

    if (!this.objectForm.objectTypeId) this.objectForm.objectTypeId = this.objectTypes()[0]?.id ?? 0;
    if (!this.activityForm.activityTypeId) this.activityForm.activityTypeId = this.activityTypes()[0]?.id ?? 0;
    if (!this.eventForm.eventTypeId) this.eventForm.eventTypeId = this.eventTypes()[0]?.id ?? 0;
    if (!this.eventForm.objectId) this.eventForm.objectId = this.objects()[0]?.id ?? 0;
  }

  requestToggleDestinationStatus(): void { this.pendingAction.set({ type: 'toggle-destination' }); }
  requestApproveActivity(item: ActivityRecord): void { this.pendingAction.set({ type: 'approve-activity', item }); }
  requestRejectActivity(item: ActivityRecord): void { this.rejectionReasonTarget.set({ type: 'activity', item }); }
  requestDeleteActivity(item: ActivityRecord): void { this.pendingAction.set({ type: 'delete-activity', item }); }
  requestApproveEvent(item: EventRecord): void { this.pendingAction.set({ type: 'approve-event', item }); }
  requestRejectEvent(item: EventRecord): void { this.rejectionReasonTarget.set({ type: 'event', item }); }
  requestDeleteEvent(item: EventRecord): void { this.pendingAction.set({ type: 'delete-event', item }); }
  cancelPendingAction(): void { this.pendingAction.set(null); }
  cancelRejectionReason(): void { this.rejectionReasonTarget.set(null); }

  confirmRejectionReason(reason: string): void {
    const target = this.rejectionReasonTarget();
    if (!target) return;
    this.rejectionReasonTarget.set(null);
    if (target.type === 'object') this.pendingAction.set({ type: 'reject-object', item: target.item, reason });
    else if (target.type === 'activity') this.pendingAction.set({ type: 'reject-activity', item: target.item, reason });
    else this.pendingAction.set({ type: 'reject-event', item: target.item, reason });
  }

  private snapshotObjectForm(): string {
    this.formVersion();
    return JSON.stringify({ ...this.objectForm, imageFile: null, address: this.objectAddress() });
  }

  private snapshotActivityForm(): string {
    this.formVersion();
    return JSON.stringify({ ...this.activityForm, imageFile: null, address: this.activityAddress() });
  }

  private snapshotEventForm(): string {
    this.formVersion();
    return JSON.stringify({ ...this.eventForm, imageFile: null });
  }

  confirmPendingAction(): void {
    const action = this.pendingAction();
    if (!action) return;
    this.pendingAction.set(null);
    switch (action.type) {
      case 'toggle-destination': this.toggleDestinationStatus(); break;
      case 'approve-object': this.approveObject(action.item); break;
      case 'reject-object': this.rejectObject(action.item, action.reason); break;
      case 'delete-object': this.deleteObject(action.item); break;
      case 'approve-activity': this.approveActivity(action.item); break;
      case 'reject-activity': this.rejectActivity(action.item, action.reason); break;
      case 'delete-activity': this.deleteActivity(action.item); break;
      case 'approve-event': this.approveEvent(action.item); break;
      case 'reject-event': this.rejectEvent(action.item, action.reason); break;
      case 'delete-event': this.deleteEvent(action.item); break;
      case 'toggle-object-active': this.toggleObjectActive(action.item); break;
      case 'toggle-activity-active': this.toggleActivityActive(action.item); break;
      case 'toggle-event-active': this.toggleEventActive(action.item); break;
    }
  }

  toggleDestinationStatus(): void {
    const dest = this.destination();
    if (!dest) { this.toastr.error('Destination could not be resolved.'); return; }
    this.contentService.updateDestinationStatus(dest, !dest.isActive).subscribe({
      next: (updated) => { this.destination.set(updated); this.toastr.success(`Destination is now ${updated.isActive ? 'active' : 'inactive'}.`); },
      error: () => this.toastr.error('Destination status could not be updated.')
    });
  }

  editActivity(item: ActivityRecord): void {
    this.editingActivityId.set(item.id);
    this.activityAddress.set(null);
    this.activityLocationSet.set(false);
    this.activityImageError.set(null);
    const imageUrls = item.imageUrls?.length ? item.imageUrls : item.imageUrl ? [item.imageUrl] : [];
    this.activityImageFiles.set([]);
    this.activityRetainedImageUrls.set(imageUrls);
    this.activityImageBaselineUrls.set(imageUrls);
    this.activityImagePreviews.set(imageUrls);
    this.activityImagePreview.set(imageUrls[0] ?? null);
    this.activityForm = {
      name: item.name, description: item.description ?? '',
      activityTypeId: item.activityTypeId, objectId: item.objectId ?? null,
      durationMinutes: item.durationMinutes ?? null, price: item.price ?? null,
      currency: item.currency ?? 'EUR',
      latitude: item.latitude ?? null, longitude: item.longitude ?? null,
      imageUrl: item.imageUrl ?? null, imageFile: null,
      statusName: item.statusName ?? 'Pending',
    };
    const linkedObject = item.objectId ? this.objects().find(o => o.id === item.objectId) : null;
    this.activityLocationSet.set(
      (item.latitude != null && item.longitude != null) ||
      (linkedObject?.latitude != null && linkedObject?.longitude != null)
    );
    this.activityFormSnapshot.set(this.snapshotActivityForm());
    this.openModal('activity');
  }

  resetActivityForm(): void {
    this.editingActivityId.set(null);
    this.activityLocationSet.set(false);
    this.activityAddress.set(null);
    this.activityImageError.set(null);
    this.activityImagePreview.set(null);
    this.activityImagePreviews.set([]);
    this.activityImageFiles.set([]);
    this.activityRetainedImageUrls.set([]);
    this.activityImageBaselineUrls.set([]);
    this.activityFormSnapshot.set(null);
    this.activityForm = {
      name: '', description: '', activityTypeId: this.activityTypes()[0]?.id ?? 0,
      objectId: null, durationMinutes: null, price: null,
      currency: 'EUR', latitude: null, longitude: null,
      imageUrl: null, imageFile: null, statusName: 'Pending',
    };
  }

  submitActivity(): void {
    const destinationId = this.destination()?.id
      ?? this.objects().find(o => o.destinationId != null)?.destinationId
      ?? this.activities().find(a => a.destinationId != null)?.destinationId
      ?? null;

    if (!destinationId) { this.toastr.error('Activity cannot be saved — destination could not be resolved.'); return; }
    if (!this.activityForm.name || !this.activityForm.activityTypeId) { this.toastr.error('Activity name and type are required.'); return; }
    if (this.activityForm.price != null && this.activityForm.price < 0) { this.toastr.error('Price cannot be negative.'); return; }
    if (this.activityForm.durationMinutes != null && this.activityForm.durationMinutes < 1) { this.toastr.error('Duration must be at least 1 minute.'); return; }
    if ((this.activityForm.description ?? '').length > this.DESCRIPTION_MAX_LENGTH) {
      this.toastr.warning(`Description must not exceed ${this.DESCRIPTION_MAX_LENGTH} characters.`); return;
    }
    if (this.activityImageError()) { this.toastr.error(this.activityImageError()!); return; }

    if (!this.activityForm.objectId && (this.activityForm.latitude == null || this.activityForm.longitude == null)) {
      this.toastr.error('Please set the activity location on the map or link it to an object.');
      return;
    }

    const imageFiles = this.activityImageFiles();
    const retainedImageUrls = this.activityRetainedImageUrls();
    const shouldSyncImages = this.hasImageChanges(this.activityImageBaselineUrls(), retainedImageUrls, imageFiles);
    const doSubmit = () => {
      const payload = {
        name: this.activityForm.name,
        description: this.activityForm.description || null,
        activityTypeId: this.activityForm.activityTypeId,
        objectId: this.activityForm.objectId,
        durationMinutes: this.activityForm.durationMinutes,
        price: this.activityForm.price,
        currency: this.activityForm.currency,
        latitude: this.activityForm.latitude,
        longitude: this.activityForm.longitude,
        destinationId
      };
      const editingId = this.editingActivityId();
      const request$ = editingId !== null ? this.contentService.updateActivity(editingId, payload) : this.contentService.createActivity(payload);
      request$.subscribe({
        next: (saved) => {
          const finish = () => {
            this.toastr.success(editingId !== null ? 'Activity updated.' : 'Activity created.');
            if (editingId !== null) this.refreshActivities(this.activityPage()); else this.refreshActivities(1);
            this.resetActivityForm();
            this.closeModal();
          };
          if (shouldSyncImages) {
            this.contentService.uploadActivityImage(saved.id, imageFiles, retainedImageUrls).subscribe({
              next: finish,
              error: (error) => {
                this.toastr.error(extractApiErrorMessage(error, 'Image upload failed, but activity data was saved.'));
                finish();
              }
            });
            return;
          }
          finish();
        },
        error: () => this.toastr.error('Activity could not be saved.')
      });
    };
    doSubmit();
  }

  approveActivity(item: ActivityRecord): void {
    this.contentService.approveActivity(item.id).subscribe({
      next: () => { this.toastr.success(`Activity "${item.name}" approved.`); this.refreshActivities(this.activityPage()); },
      error: () => this.toastr.error('Activity could not be approved.')
    });
  }

  rejectActivity(item: ActivityRecord, reason: string): void {
    this.contentService.rejectActivity(item.id, reason).subscribe({
      next: () => { this.toastr.success(`Activity "${item.name}" rejected.`); this.refreshActivities(this.activityPage()); },
      error: () => this.toastr.error('Activity could not be rejected.')
    });
  }

  deleteActivity(item: ActivityRecord): void {
    this.contentService.deleteActivity(item.id).subscribe({
      next: () => { this.toastr.success(`Activity "${item.name}" deleted.`); this.refreshActivities(this.activityPage()); },
      error: () => this.toastr.error('Activity could not be deleted.')
    });
  }

  editEvent(item: EventRecord): void {
    this.editingEventId.set(item.id);
    this.eventImageError.set(null);
    const imageUrls = item.imageUrls?.length ? item.imageUrls : item.imageUrl ? [item.imageUrl] : [];
    this.eventImageFiles.set([]);
    this.eventRetainedImageUrls.set(imageUrls);
    this.eventImageBaselineUrls.set(imageUrls);
    this.eventImagePreviews.set(imageUrls);
    this.eventImagePreview.set(imageUrls[0] ?? null);
    this.eventForm = {
      objectId: item.objectId, eventTypeId: item.eventTypeId,
      name: item.name, description: item.description ?? '',
      startDatetime: item.startDatetime ? new Date(item.startDatetime) : null,
      endDatetime: item.endDatetime ? new Date(item.endDatetime) : null,
      capacity: item.capacity ?? null, price: item.price ?? null,
      currency: item.currency ?? 'EUR',
      imageUrl: item.imageUrl ?? null, imageFile: null,
      statusName: item.statusName ?? 'Pending',
    };
    this.eventFormSnapshot.set(this.snapshotEventForm());
    this.openModal('event');
  }

  resetEventForm(): void {
    this.editingEventId.set(null);
    this.eventImageError.set(null);
    this.eventImagePreview.set(null);
    this.eventImagePreviews.set([]);
    this.eventImageFiles.set([]);
    this.eventRetainedImageUrls.set([]);
    this.eventImageBaselineUrls.set([]);
    this.eventFormSnapshot.set(null);
    this.eventForm = {
      objectId: this.objects()[0]?.id ?? 0, eventTypeId: this.eventTypes()[0]?.id ?? 0,
      name: '', description: '', startDatetime: null, endDatetime: null,
      capacity: null, price: null, currency: 'EUR',
      imageUrl: null, imageFile: null, statusName: 'Pending',
    };
  }

  submitEvent(): void {
    const editingId = this.editingEventId();
    if (!this.eventForm.objectId || !this.eventForm.eventTypeId || !this.eventForm.name || !this.eventForm.startDatetime) { this.toastr.error('Event object, type, name and start date are required.'); return; }
    if (this.eventForm.price != null && this.eventForm.price < 0) { this.toastr.error('Price cannot be negative.'); return; }
    if (this.eventForm.capacity != null && this.eventForm.capacity < 1) { this.toastr.error('Capacity must be at least 1.'); return; }
    if ((this.eventForm.description ?? '').length > this.DESCRIPTION_MAX_LENGTH) {
      this.toastr.warning(`Description must not exceed ${this.DESCRIPTION_MAX_LENGTH} characters.`); return;
    }
    const now = new Date();
    if (editingId === null && this.eventForm.startDatetime < now) { this.toastr.error('Start date cannot be in the past.'); return; }
    if (this.eventForm.endDatetime && this.eventForm.endDatetime <= this.eventForm.startDatetime) { this.toastr.error('End date must be after start date.'); return; }
    if (this.eventImageError()) { this.toastr.error(this.eventImageError()!); return; }

    const imageFiles = this.eventImageFiles();
    const retainedImageUrls = this.eventRetainedImageUrls();
    const shouldSyncImages = this.hasImageChanges(this.eventImageBaselineUrls(), retainedImageUrls, imageFiles);
    const doSubmit = () => {
      const payload = {
        objectId: this.eventForm.objectId,
        eventTypeId: this.eventForm.eventTypeId,
        name: this.eventForm.name,
        description: this.eventForm.description || null,
        capacity: this.eventForm.capacity,
        price: this.eventForm.price,
        currency: this.eventForm.currency,
        startDatetime: this.eventForm.startDatetime!.toISOString(),
        endDatetime: this.eventForm.endDatetime ? this.eventForm.endDatetime.toISOString() : null,
      };
      const request$ = editingId !== null ? this.contentService.updateEvent(editingId, payload) : this.contentService.createEvent(payload);
      request$.subscribe({
        next: (saved) => {
          const finish = () => {
            this.toastr.success(editingId !== null ? 'Event updated.' : 'Event created.');
            this.resetEventForm();
            if (editingId !== null) this.refreshEvents(this.eventPage()); else this.refreshEvents(1);
            this.closeModal();
          };
          if (shouldSyncImages) {
            this.contentService.uploadEventImage(saved.id, imageFiles, retainedImageUrls).subscribe({
              next: finish,
              error: (error) => {
                this.toastr.error(extractApiErrorMessage(error, 'Image upload failed, but event data was saved.'));
                finish();
              }
            });
            return;
          }
          finish();
        },
        error: () => this.toastr.error('Event could not be saved.')
      });
    };
    doSubmit();
  }

  approveEvent(item: EventRecord): void {
    this.contentService.approveEvent(item.id).subscribe({
      next: () => { this.toastr.success(`Event "${item.name}" approved.`); this.refreshEvents(this.eventPage()); },
      error: () => this.toastr.error('Event could not be approved.')
    });
  }

  rejectEvent(item: EventRecord, reason: string): void {
    this.contentService.rejectEvent(item.id, reason).subscribe({
      next: () => { this.toastr.success(`Event "${item.name}" rejected.`); this.refreshEvents(this.eventPage()); },
      error: () => this.toastr.error('Event could not be rejected.')
    });
  }

  deleteEvent(item: EventRecord): void {
    this.contentService.deleteEvent(item.id).subscribe({
      next: () => { this.toastr.success(`Event "${item.name}" deleted.`); this.refreshEvents(this.eventPage()); },
      error: () => this.toastr.error('Event could not be deleted.')
    });
  }

  findObjectName(objectId: number | null | undefined): string {
    return this.objects().find(o => o.id === objectId)?.name ?? 'Not linked';
  }

  private refreshObjects(page = this.objectPage()): void {
    const isActive = this.objectActiveFilter() === 'all' ? undefined : this.objectActiveFilter() === 'true';
    this.contentService.getObjects(page, this.objectPageSize(), this.objectSearch(), this.objectStatusFilter(), isActive).subscribe(result => {
      this.objects.set(result.items); this.objectTotalPages.set(Math.max(1, result.totalPages));
      this.objectPage.set(result.page); this.objectTotalCount.set(result.totalCount);
    });
  }

  private refreshActivities(page = this.activityPage()): void {
    const isActive = this.activityActiveFilter() === 'all' ? undefined : this.activityActiveFilter() === 'true';
    this.contentService.getActivities(page, this.activityPageSize(), this.activitySearch(), this.activityStatusFilter(), isActive).subscribe(result => {
      this.activities.set(result.items); this.activityTotalPages.set(Math.max(1, result.totalPages));
      this.activityPage.set(result.page); this.activityTotalCount.set(result.totalCount);
    });
  }

  private refreshEvents(page = this.eventPage()): void {
    const isActive = this.eventActiveFilter() === 'all' ? undefined : this.eventActiveFilter() === 'true';
    this.contentService.getEvents(page, this.eventPageSize(), this.eventSearch(), this.eventStatusFilter(), isActive).subscribe(result => {
      this.events.set(result.items); this.eventTotalPages.set(Math.max(1, result.totalPages));
      this.eventPage.set(result.page); this.eventTotalCount.set(result.totalCount);
    });
  }

  editObject(item: TouristObjectRecord): void {
    this.editingObjectId.set(item.id);
    this.objectAddress.set(item.address ?? null);
    this.objectImageError.set(null);
    const imageUrls = item.imageUrls?.length ? item.imageUrls : item.imageUrl ? [item.imageUrl] : [];
    this.objectImageFiles.set([]);
    this.objectRetainedImageUrls.set(imageUrls);
    this.objectImageBaselineUrls.set(imageUrls);
    this.objectImagePreviews.set(imageUrls);
    this.objectImagePreview.set(imageUrls[0] ?? null);
    this.objectForm = {
      name: item.name, description: item.description ?? '',
      objectTypeId: item.objectTypeId,
      address: item.address ?? null, website: item.website ?? null,
      phone: item.phone ?? null, latitude: item.latitude ?? null,
      longitude: item.longitude ?? null, airbnbUrl: item.airbnbUrl ?? null,
      bookingUrl: item.bookingUrl ?? null, imageUrl: item.imageUrl ?? null,
      imageFile: null, statusName: item.statusName ?? 'Pending',
    };
    this.objectLocationSet.set(item.latitude != null && item.longitude != null);
    this.objectFormSnapshot.set(this.snapshotObjectForm());
    this.openModal('object');
  }

  resetObjectForm(): void {
    this.editingObjectId.set(null);
    this.objectLocationSet.set(false);
    this.objectAddress.set(null);
    this.objectImageError.set(null);
    this.objectImagePreview.set(null);
    this.objectImagePreviews.set([]);
    this.objectImageFiles.set([]);
    this.objectRetainedImageUrls.set([]);
    this.objectImageBaselineUrls.set([]);
    this.objectFormSnapshot.set(null);
    this.objectForm = {
      name: '', description: '', objectTypeId: this.objectTypes()[0]?.id ?? 0,
      address: null, website: null, phone: null, latitude: null, longitude: null,
      airbnbUrl: null, bookingUrl: null, imageUrl: null, imageFile: null,
      statusName: 'Pending',
    };
  }

  private validateObjectPhone(): boolean {
    const phone = normalizePhone(this.objectForm.phone);

    if (!isValidPhone(phone)) {
      this.toastr.error(PHONE_INVALID_MESSAGE);
      return false;
    }

    this.objectForm.phone = phone;
    return true;
  }

  submitObject(): void {
    const destinationId = this.destination()?.id ?? this.objects().find(o => o.destinationId != null)?.destinationId ?? null;
    if (!destinationId) { this.toastr.error('Object cannot be saved — destination could not be resolved.'); return; }
    if (!this.objectForm.name || !this.objectForm.objectTypeId) { this.toastr.error('Object name and type are required.'); return; }
    if (this.objectForm.latitude == null || this.objectForm.longitude == null) { this.toastr.error('Please set the object location on the map.'); return; }
    if ((this.objectForm.description ?? '').length > this.DESCRIPTION_MAX_LENGTH) {
      this.toastr.warning(`Description must not exceed ${this.DESCRIPTION_MAX_LENGTH} characters.`); return;
    }
    if (!this.validateObjectPhone()) return;
    if (this.objectImageError()) { this.toastr.error(this.objectImageError()!); return; }

    const imageFiles = this.objectImageFiles();
    const retainedImageUrls = this.objectRetainedImageUrls();
    const shouldSyncImages = this.hasImageChanges(this.objectImageBaselineUrls(), retainedImageUrls, imageFiles);
    const doSubmit = () => {
      const payload = {
        name: this.objectForm.name,
        description: this.objectForm.description || null,
        objectTypeId: this.objectForm.objectTypeId,
        destinationId,
        address: this.objectAddress(),
        website: this.objectForm.website,
        phone: normalizePhone(this.objectForm.phone),
        latitude: this.objectForm.latitude,
        longitude: this.objectForm.longitude,
        airbnbUrl: this.objectForm.airbnbUrl,
        bookingUrl: this.objectForm.bookingUrl
      };
      const editingId = this.editingObjectId();
      const request$ = editingId !== null ? this.contentService.updateObject(editingId, payload) : this.contentService.createObject(payload);
      request$.subscribe({
        next: (saved) => {
          const finish = () => {
            this.toastr.success(editingId !== null ? 'Object updated.' : 'Object created.');
            this.resetObjectForm();
            if (editingId !== null) this.refreshObjects(this.objectPage()); else this.refreshObjects(1);
            this.closeModal();
          };
          if (shouldSyncImages) {
            this.contentService.uploadObjectImage(saved.id, imageFiles, retainedImageUrls).subscribe({
              next: finish,
              error: (error) => {
                this.toastr.error(extractApiErrorMessage(error, 'Image upload failed, but object data was saved.'));
                finish();
              }
            });
            return;
          }
          finish();
        },
        error: (error) => this.toastr.error(extractApiErrorMessage(error, 'Object could not be saved.'))
      });
    };
    doSubmit();
  }

  requestApproveObject(item: TouristObjectRecord): void { this.pendingAction.set({ type: 'approve-object', item }); }
  requestDeleteObject(item: TouristObjectRecord): void { this.pendingAction.set({ type: 'delete-object', item }); }

  approveObject(item: TouristObjectRecord): void {
    this.contentService.approveObject(item.id).subscribe({
      next: () => { this.toastr.success(`Object "${item.name}" approved.`); this.refreshObjects(); },
      error: () => this.toastr.error('Object could not be approved.')
    });
  }

  deleteObject(item: TouristObjectRecord): void {
    this.contentService.deleteObject(item.id).subscribe({
      next: () => { this.toastr.success(`Object "${item.name}" deleted.`); this.refreshObjects(); },
      error: () => this.toastr.error('Object could not be deleted.')
    });
  }

  requestRejectObject(item: TouristObjectRecord): void { this.rejectionReasonTarget.set({ type: 'object', item }); }

  rejectObject(item: TouristObjectRecord, reason: string): void {
    this.contentService.rejectObject(item.id, reason).subscribe({
      next: () => { this.toastr.success(`Object "${item.name}" rejected.`); this.refreshObjects(this.objectPage()); },
      error: () => this.toastr.error('Object could not be rejected.')
    });
  }

  openModal(type: 'object' | 'activity' | 'event' | null): void {
    this.modalType.set(type);
    this.modalOpen.set(true);
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', this.preventBackspaceNavigation);
    if (type === 'object') this.initObjectMap();
    if (type === 'activity') this.initActivityMap();
    if (type === 'event') this.initEventMap();
  }

  closeModal(): void {
    this.destroyObjectMap(); this.destroyActivityMap(); this.destroyEventMap();
    this.closeObjectOverlay();
    this.closeActivityOverlay();
    this.modalOpen.set(false); this.modalType.set(null);
    this.resetObjectForm(); this.resetActivityForm(); this.resetEventForm();
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', this.preventBackspaceNavigation);
  }

  initObjectMap(): void {
    setTimeout(() => {
      const container = document.getElementById('object-map');
      if (!container) return;
      if (this.objectMap) { this.objectMap.remove(); this.objectMap = null; this.objectMarker = null; }
      const dest = this.destination();
      const lat = this.objectForm.latitude ?? dest?.latitude;
      const lng = this.objectForm.longitude ?? dest?.longitude;
      if (lat == null || lng == null) { this.toastr.warning('Destination coordinates are not set. Map cannot be centered.'); return; }
      this.objectMap = L.map('object-map').setView([lat, lng], this.objectForm.latitude != null ? 15 : 13);
      requestAnimationFrame(() => this.objectMap?.invalidateSize());
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: 'OpenStreetMap contributors' }).addTo(this.objectMap);
      this.boundsService.applyToMap(this.objectMap, this.destinationBounds);
      if (this.objectForm.latitude != null && this.objectForm.longitude != null) {
        this.objectMarker = L.marker([this.objectForm.latitude, this.objectForm.longitude], { icon: this.createMapIcon('O') }).addTo(this.objectMap);
        this.objectMap.setView([this.objectForm.latitude, this.objectForm.longitude], 15);
      }
      this.objectMap.off('click');
      this.objectMap?.on('click', (e: L.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng;
        if (!this.boundsService.isInside(this.destinationBounds, lat, lng)) {
          this.ngZone.run(() => this.toastr.warning(`Pin must be within ${this.destinationBounds?.name || 'your destination'}.`));
          return;
        }
        if (this.objectMarker) { this.objectMarker.remove(); this.objectMarker = null; }
        if (!this.objectMap) return;
        this.objectMarker = L.marker([lat, lng], { icon: this.createMapIcon('O') }).addTo(this.objectMap!);
        this.ngZone.run(() => {
          this.objectForm.latitude = parseFloat(lat.toFixed(6));
          this.objectForm.longitude = parseFloat(lng.toFixed(6));
          this.objectLocationSet.set(true); this.bumpFormVersion();
        });
        this.reverseGeocode(lat, lng, (address) => this.objectAddress.set(address));
      });
    }, 200);
  }

  destroyObjectMap(): void {
    if (this.objectMap) { this.objectMap.remove(); this.objectMap = null; this.objectMarker = null; }
  }

  searchObjectAddress(): void {
    const address = this.objectAddress();
    if (!address?.trim()) return;
    this.nominatimHttp.get<any[]>(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=5&accept-language=en&addressdetails=1${this.boundsService.viewboxParam(this.destinationBounds)}`
    ).subscribe({
      next: (results) => {
        if (!results?.length) return;
        const hasNumber = /\d/.test(this.objectAddress() ?? '');
        if (results.length === 1 || hasNumber) { this.selectObjectSuggestion(results[0]); return; }
        this.ngZone.run(() => { this.objectAddressSuggestions.set(results); this.openObjectOverlay(); });
      },
      error: () => this.objectAddressSuggestions.set([])
    });
  }

  onObjectAddressInput(): void {
    const val = this.objectAddress() ?? '';
    if (val.trim().length < 4) { this.objectAddressSuggestions.set([]); this.closeObjectOverlay(); return; }
    this.addressSearch$.next(val);
  }

  selectObjectSuggestion(result: any): void {
    const latNum = parseFloat(result.lat);
    const lngNum = parseFloat(result.lon);
    this.objectSuggestionIdx = -1;
    this.objectAddressSuggestions.set([]);
    this.closeObjectOverlay();
    if (!this.boundsService.isInside(this.destinationBounds, latNum, lngNum)) {
      this.toastr.warning(`Address is outside ${this.destinationBounds?.name || 'your destination'}.`); return;
    }
    const a = result.address;
    const street = a?.road || a?.pedestrian || a?.footway || a?.park || a?.amenity || '';
    const number = a?.house_number || '';
    const neighbourhood = a?.suburb || a?.neighbourhood || a?.quarter || '';
    const city = a?.city || a?.town || a?.village || '';
    const streetPart = [street, number].filter(Boolean).join(' ');
    const formattedAddress = [streetPart, neighbourhood, city].filter(Boolean).join(', ');
    const isPrecise = a?.house_number || (a?.amenity && result.class === 'amenity') || (a?.tourism && result.class === 'tourism') || a?.leisure || a?.historic || ['house', 'building'].includes(result.type);
    if (isPrecise) {
      this.objectAddress.set(formattedAddress);
      this.objectForm.latitude = parseFloat(latNum.toFixed(6));
      this.objectForm.longitude = parseFloat(lngNum.toFixed(6));
      this.objectLocationSet.set(true); this.bumpFormVersion();
      this.objectMap?.flyTo([latNum, lngNum], 17, { duration: 1 });
      this.objectMap?.once('moveend', () => {
        if (this.objectMarker) { this.objectMarker.setLatLng([latNum, lngNum]); }
        else { this.objectMarker = L.marker([latNum, lngNum], { icon: this.createMapIcon('O') }).addTo(this.objectMap!); }
      });
    } else {
      const zoomLevel = result.type === 'city' || result.type === 'administrative' ? 13 : result.type === 'suburb' || result.type === 'quarter' ? 15 : 14;
      this.objectMap?.flyTo([latNum, lngNum], zoomLevel, { duration: 1 });
    }
  }

  private preventBackspaceNavigation = (e: KeyboardEvent): void => {
    if (e.key === 'Backspace') {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
      if (!isInput) e.preventDefault();
    }
  };

  initActivityMap(): void {
    setTimeout(() => {
      const container = document.getElementById('activity-map');
      if (!container) return;
      if (this.activityMap) { this.activityMap.remove(); this.activityMap = null; this.activityMarker = null; }
      const dest = this.destination();
      const linkedObject = this.activityForm.objectId ? this.objects().find(o => o.id === this.activityForm.objectId) : null;
      const centerLat = linkedObject?.latitude ?? this.activityForm.latitude ?? dest?.latitude;
      const centerLng = linkedObject?.longitude ?? this.activityForm.longitude ?? dest?.longitude;
      if (centerLat == null || centerLng == null) { this.toastr.warning('Destination coordinates are not set. Map cannot be centered.'); return; }
      this.activityMap = L.map('activity-map').setView([centerLat, centerLng], (this.activityForm.latitude != null || linkedObject?.latitude != null) ? 15 : 13);
      setTimeout(() => this.activityMap?.invalidateSize(), 0);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: 'OpenStreetMap contributors' }).addTo(this.activityMap);
      this.boundsService.applyToMap(this.activityMap, this.destinationBounds);
      if (linkedObject?.latitude != null && linkedObject?.longitude != null) {
        this.activityMarker = L.marker([linkedObject.latitude, linkedObject.longitude], { icon: this.createMapIcon('A', '#f59e0b') }).addTo(this.activityMap);
        this.activityForm.latitude = linkedObject.latitude; this.activityForm.longitude = linkedObject.longitude;
        this.activityMap.setView([linkedObject.latitude, linkedObject.longitude], 15);
        this.activityLocationSet.set(true); return;
      }
      if (this.activityForm.latitude != null && this.activityForm.longitude != null) {
        this.activityMarker = L.marker([this.activityForm.latitude, this.activityForm.longitude], { icon: this.createMapIcon('A', '#f59e0b') }).addTo(this.activityMap);
        this.activityMap.setView([this.activityForm.latitude, this.activityForm.longitude], 15);
        this.activityLocationSet.set(true);
      }
      this.activityMap.off('click');
      this.activityMap.on('click', (e: L.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng;
        if (!this.boundsService.isInside(this.destinationBounds, lat, lng)) {
          this.ngZone.run(() => this.toastr.warning(`The selected location must be within ${this.destinationBounds?.name || 'your destination'}.`)); return;
        }
        if (this.activityMarker) { this.activityMarker.remove(); this.activityMarker = null; }
        this.activityMarker = L.marker([lat, lng], { icon: this.createMapIcon('A', '#f59e0b') }).addTo(this.activityMap!);
        this.ngZone.run(() => {
          this.activityForm.latitude = parseFloat(lat.toFixed(6)); this.activityForm.longitude = parseFloat(lng.toFixed(6));
          this.activityLocationSet.set(true); this.bumpFormVersion();
        });
        this.reverseGeocode(lat, lng, (address) => this.activityAddress.set(address));
      });
    }, 300);
  }

  destroyActivityMap(): void {
    if (this.activityMap) { this.activityMap.remove(); this.activityMap = null; this.activityMarker = null; }
  }

  searchActivityAddress(): void {
    const address = this.activityAddress();
    if (!address?.trim()) return;
    this.nominatimHttp.get<any[]>(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=5&accept-language=en&addressdetails=1${this.boundsService.viewboxParam(this.destinationBounds)}`
    ).subscribe({
      next: (results) => {
        if (!results?.length) return;
        const hasNumber = /\d/.test(this.activityAddress() ?? '');
        if (results.length === 1 || hasNumber) { this.selectActivitySuggestion(results[0]); return; }
        this.ngZone.run(() => { this.activityAddressSuggestions.set(results); this.openActivityOverlay(); });
      },
      error: () => this.activityAddressSuggestions.set([])
    });
  }

  selectActivitySuggestion(result: any): void {
    const latNum = parseFloat(result.lat);
    const lngNum = parseFloat(result.lon);
    this.activitySuggestionIdx = -1;
    this.activityAddressSuggestions.set([]);
    this.closeActivityOverlay();
    if (!this.boundsService.isInside(this.destinationBounds, latNum, lngNum)) {
      this.toastr.warning(`Address is outside ${this.destinationBounds?.name || 'your destination'}.`); return;
    }
    const a = result.address;
    const street = a?.road || a?.pedestrian || a?.footway || a?.park || a?.amenity || '';
    const number = a?.house_number || '';
    const neighbourhood = a?.suburb || a?.neighbourhood || a?.quarter || '';
    const city = a?.city || a?.town || a?.village || '';
    const streetPart = [street, number].filter(Boolean).join(' ');
    const formattedAddress = [streetPart, neighbourhood, city].filter(Boolean).join(', ');
    const isPrecise = a?.house_number || (a?.amenity && result.class === 'amenity') || (a?.tourism && result.class === 'tourism') || a?.leisure || a?.historic || ['house', 'building'].includes(result.type);
    if (isPrecise) {
      this.activityAddress.set(formattedAddress);
      this.activityForm.latitude = parseFloat(latNum.toFixed(6));
      this.activityForm.longitude = parseFloat(lngNum.toFixed(6));
      this.activityLocationSet.set(true); this.bumpFormVersion();
      this.activityMap?.flyTo([latNum, lngNum], 17, { duration: 1 });
      this.activityMap?.once('moveend', () => {
        if (this.activityMarker) { this.activityMarker.setLatLng([latNum, lngNum]); }
        else { this.activityMarker = L.marker([latNum, lngNum], { icon: this.createMapIcon('A', '#f59e0b') }).addTo(this.activityMap!); }
      });
    } else {
      const zoomLevel = result.type === 'city' || result.type === 'administrative' ? 13 : result.type === 'suburb' || result.type === 'quarter' ? 15 : 14;
      this.activityMap?.flyTo([latNum, lngNum], zoomLevel, { duration: 1 });
    }
  }

  onActivityObjectChange(): void {
    const linkedObject = this.activityForm.objectId ? this.objects().find(o => o.id === this.activityForm.objectId) : null;
    if (linkedObject?.latitude != null && linkedObject?.longitude != null) {
      this.activityForm.latitude = linkedObject.latitude; this.activityForm.longitude = linkedObject.longitude;
      this.activityLocationSet.set(true); this.activityAddress.set(linkedObject.address ?? null);
      if (this.activityMap) { this.activityMap.invalidateSize(); this.activityMap.setView([linkedObject.latitude, linkedObject.longitude], 15); }
      if (this.activityMarker) { this.activityMarker.setLatLng([linkedObject.latitude, linkedObject.longitude]); }
      else { this.activityMarker = L.marker([linkedObject.latitude, linkedObject.longitude], { icon: this.createMapIcon('A', '#f59e0b') }).addTo(this.activityMap!); }
      this.activityMap?.off('click');
      this.activityAddressSuggestions.set([]);
    } else {
      this.activityForm.latitude = null; this.activityForm.longitude = null;
      this.activityLocationSet.set(false); this.activityAddress.set(null);
      if (this.activityMarker) { this.activityMarker.remove(); this.activityMarker = null; }
      this.activityMap?.off('click');
      this.activityMap?.on('click', (e: L.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng;
        if (!this.boundsService.isInside(this.destinationBounds, lat, lng)) {
          this.ngZone.run(() => this.toastr.warning(`Pin must be within ${this.destinationBounds?.name || 'your destination'}.`)); return;
        }
        this.ngZone.run(() => {
          this.activityForm.latitude = parseFloat(lat.toFixed(6)); this.activityForm.longitude = parseFloat(lng.toFixed(6));
          this.activityLocationSet.set(true); this.bumpFormVersion();
        });
        if (this.activityMarker) { this.activityMarker.setLatLng([lat, lng]); }
        else { this.activityMarker = L.marker([lat, lng], { icon: this.createMapIcon('A', '#f59e0b') }).addTo(this.activityMap!); }
        this.reverseGeocode(lat, lng, (address) => this.activityAddress.set(address));
      });
    }
  }

  onActivityAddressInput(): void {
    const val = this.activityAddress() ?? '';
    if (val.trim().length < 3) { this.activityAddressSuggestions.set([]); this.closeActivityOverlay(); return; }
    this.activityAddressSearch$.next(val);
  }

  clampToPositive(value: number | null): number | null {
    if (value === null || value === undefined) return null;
    return value < 0 ? 0 : value;
  }

  initEventMap(): void {
    setTimeout(() => {
      const container = document.getElementById('event-map');
      if (!container) return;
      if (this.eventMap) { this.eventMap.remove(); this.eventMap = null; this.eventMarker = null; }
      const linkedObject = this.objects().find(o => o.id === this.eventForm.objectId);
      const dest = this.destination();
      const centerLat = linkedObject?.latitude ?? dest?.latitude;
      const centerLng = linkedObject?.longitude ?? dest?.longitude;
      if (centerLat == null || centerLng == null) return;
      this.eventMap = L.map('event-map', { dragging: false, zoomControl: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false }).setView([centerLat, centerLng], 15);
      setTimeout(() => this.eventMap?.invalidateSize(), 0);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: 'OpenStreetMap contributors' }).addTo(this.eventMap);
      if (linkedObject?.latitude != null && linkedObject?.longitude != null) {
        this.eventMarker = L.marker([linkedObject.latitude, linkedObject.longitude], { icon: this.createMapIcon('E', '#6366f1') }).addTo(this.eventMap);
      }
    }, 300);
  }

  destroyEventMap(): void {
    if (this.eventMap) { this.eventMap.remove(); this.eventMap = null; this.eventMarker = null; }
  }

  onEventObjectChange(): void {
    const linkedObject = this.objects().find(o => o.id === this.eventForm.objectId);
    if (linkedObject?.latitude == null || linkedObject?.longitude == null) {
      if (this.eventMarker) { this.eventMarker.remove(); this.eventMarker = null; } return;
    }
    this.eventMap?.setView([linkedObject.latitude, linkedObject.longitude], 15);
    if (this.eventMarker) { this.eventMarker.setLatLng([linkedObject.latitude, linkedObject.longitude]); }
    else { this.eventMarker = L.marker([linkedObject.latitude, linkedObject.longitude], { icon: this.createMapIcon('E', '#6366f1') }).addTo(this.eventMap!); }
  }

  readonly approvedObjects = computed(() => this.objects().filter(o => o.statusName?.toLowerCase() === 'approved'));

  onObjectImageChange(event: Event): void {
    const files = this.readSelectedImageFiles(event, this.objectRemainingImageSlots(), this.objectImageError);
    if (!files.length) return;
    this.objectImageFiles.update(current => [...current, ...files]);
    this.objectForm.imageFile = this.objectImageFiles()[0] ?? null;
    const previews = files.map((file) => URL.createObjectURL(file));
    this.objectImagePreviews.update(current => [...current, ...previews]);
    this.objectImagePreview.set(this.objectImagePreviews()[0] ?? null);
    this.bumpFormVersion();
  }

  onActivityImageChange(event: Event): void {
    const files = this.readSelectedImageFiles(event, this.activityRemainingImageSlots(), this.activityImageError);
    if (!files.length) return;
    this.activityImageFiles.update(current => [...current, ...files]);
    this.activityForm.imageFile = this.activityImageFiles()[0] ?? null;
    const previews = files.map((file) => URL.createObjectURL(file));
    this.activityImagePreviews.update(current => [...current, ...previews]);
    this.activityImagePreview.set(this.activityImagePreviews()[0] ?? null);
    this.bumpFormVersion();
  }

  onEventImageChange(event: Event): void {
    const files = this.readSelectedImageFiles(event, this.eventRemainingImageSlots(), this.eventImageError);
    if (!files.length) return;
    this.eventImageFiles.update(current => [...current, ...files]);
    this.eventForm.imageFile = this.eventImageFiles()[0] ?? null;
    const previews = files.map((file) => URL.createObjectURL(file));
    this.eventImagePreviews.update(current => [...current, ...previews]);
    this.eventImagePreview.set(this.eventImagePreviews()[0] ?? null);
    this.bumpFormVersion();
  }

  selectedImageLabel(files: File[]): string {
    if (files.length === 1) return files[0].name;
    return files.length ? `${files.length} photos selected` : '';
  }

  objectRemainingImageSlots(): number { return Math.max(0, this.maxImageUploadCount - this.objectImagePreviews().length); }
  activityRemainingImageSlots(): number { return Math.max(0, this.maxImageUploadCount - this.activityImagePreviews().length); }
  eventRemainingImageSlots(): number { return Math.max(0, this.maxImageUploadCount - this.eventImagePreviews().length); }

  removeObjectImage(index: number): void {
    this.removeImageAt(index, this.objectRetainedImageUrls, this.objectImageFiles, this.objectImagePreviews);
    this.objectForm.imageFile = this.objectImageFiles()[0] ?? null;
    this.objectImagePreview.set(this.objectImagePreviews()[0] ?? null);
    this.bumpFormVersion();
  }

  removeActivityImage(index: number): void {
    this.removeImageAt(index, this.activityRetainedImageUrls, this.activityImageFiles, this.activityImagePreviews);
    this.activityForm.imageFile = this.activityImageFiles()[0] ?? null;
    this.activityImagePreview.set(this.activityImagePreviews()[0] ?? null);
    this.bumpFormVersion();
  }

  removeEventImage(index: number): void {
    this.removeImageAt(index, this.eventRetainedImageUrls, this.eventImageFiles, this.eventImagePreviews);
    this.eventForm.imageFile = this.eventImageFiles()[0] ?? null;
    this.eventImagePreview.set(this.eventImagePreviews()[0] ?? null);
    this.bumpFormVersion();
  }

  startImageStripDrag(event: PointerEvent): void {
    const element = event.currentTarget as HTMLElement;
    this.imageStripDrag = { element, startX: event.clientX, scrollLeft: element.scrollLeft, moved: false };
    element.setPointerCapture?.(event.pointerId);
    element.classList.add('dragging');
  }

  dragImageStrip(event: PointerEvent): void {
    const drag = this.imageStripDrag;
    if (!drag) return;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 5) drag.moved = true;
    drag.element.scrollLeft = drag.scrollLeft - delta;
  }

  endImageStripDrag(event: PointerEvent): void {
    const drag = this.imageStripDrag;
    if (!drag) return;
    drag.element.releasePointerCapture?.(event.pointerId);
    drag.element.classList.remove('dragging');
    setTimeout(() => { if (this.imageStripDrag === drag) this.imageStripDrag = null; }, 0);
  }

  openImageLightbox(preview: string, event: MouseEvent): void {
    event.stopPropagation();
    if (this.imageStripDrag?.moved) return;
    this.lightboxImage.set(preview);
  }

  closeImageLightbox(): void { this.lightboxImage.set(null); }

  private readSelectedImageFiles(event: Event, remainingSlots: number, imageError: WritableSignal<string | null>): File[] {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    imageError.set(null);

    if (remainingSlots <= 0) {
      this.toastr.warning(`You can upload up to ${this.maxImageUploadCount} images.`);
      return [];
    }

    const { accepted, rejected } = splitImagesBySize(files);

    if (rejected.length) {
      const message = oversizedImageMessage(rejected);
      imageError.set(message);
      this.toastr.error(message);
      return [];
    }

    if (accepted.length > remainingSlots) {
      this.toastr.warning(`You can add ${remainingSlots} more image${remainingSlots === 1 ? '' : 's'}.`);
    }
    return accepted.slice(0, remainingSlots);
  }

  private removeImageAt(index: number, retainedSignal: WritableSignal<string[]>, fileSignal: WritableSignal<File[]>, previewSignal: WritableSignal<string[]>): void {
    if (index < 0 || index >= previewSignal().length) return;
    const retainedCount = retainedSignal().length;
    if (index < retainedCount) { retainedSignal.update(current => current.filter((_, i) => i !== index)); }
    else { const fileIndex = index - retainedCount; fileSignal.update(current => current.filter((_, i) => i !== fileIndex)); }
    previewSignal.update(current => current.filter((_, i) => i !== index));
  }

  private hasImageChanges(baselineUrls: string[], retainedUrls: string[], newFiles: File[]): boolean {
    if (newFiles.length > 0) return true;
    if (baselineUrls.length !== retainedUrls.length) return true;
    return baselineUrls.some((url, index) => url !== retainedUrls[index]);
  }

  onObjectPageChange(event: PaginatorState): void {
    const rows = event.rows ?? this.objectPageSize();
    this.objectPageSize.set(rows);
    this.refreshObjects(Math.floor((event.first ?? 0) / rows) + 1);
  }

  onActivityPageChange(event: PaginatorState): void {
    const rows = event.rows ?? this.activityPageSize();
    this.activityPageSize.set(rows);
    this.refreshActivities(Math.floor((event.first ?? 0) / rows) + 1);
  }

  onEventPageChange(event: PaginatorState): void {
    const rows = event.rows ?? this.eventPageSize();
    this.eventPageSize.set(rows);
    this.refreshEvents(Math.floor((event.first ?? 0) / rows) + 1);
  }

  onObjectSearchChange(): void { this.objectSearch$.next(); }
  onObjectStatusChange(): void { this.refreshObjects(1); }
  onActivitySearchChange(): void { this.activitySearch$.next(); }
  onActivityStatusChange(): void { this.refreshActivities(1); }
  onEventSearchChange(): void { this.eventSearch$.next(); }
  onEventStatusChange(): void { this.refreshEvents(1); }

  // ── Description change handlers ───────────────────────────────────
  onObjectDescriptionChange(value: string): void {
    this.objectForm.description = value.slice(0, this.DESCRIPTION_MAX_LENGTH);
    this.bumpFormVersion();
  }

  onActivityDescriptionChange(value: string): void {
    this.activityForm.description = value.slice(0, this.DESCRIPTION_MAX_LENGTH);
    this.bumpFormVersion();
  }

  onEventDescriptionChange(value: string): void {
    this.eventForm.description = value.slice(0, this.DESCRIPTION_MAX_LENGTH);
    this.bumpFormVersion();
  }

  private createMapIcon(type: 'O' | 'A' | 'E', color = '#239485'): L.DivIcon {
    const svgContent = type === 'O'
      ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="none"><polygon points="12,3 22,8 2,8" fill="#ffffff" opacity="0.9"/><rect x="4" y="8" width="2.5" height="8" fill="#ffffff"/><rect x="8.75" y="8" width="2.5" height="8" fill="#ffffff"/><rect x="13.5" y="8" width="2.5" height="8" fill="#ffffff"/><rect x="17.5" y="8" width="2.5" height="8" fill="#ffffff"/><rect x="2" y="16" width="20" height="2" fill="#ffffff"/><rect x="3.5" y="18" width="17" height="2.5" rx="0.5" fill="#ffffff"/></svg>`
      : type === 'E'
      ? `<svg viewBox="0 0 24 24" width="20" height="20"><rect x="4.5" y="6" width="15" height="13" rx="2.5" fill="none" stroke="#ffffff" stroke-width="1.9"/><path d="M8 4.3v3.2M16 4.3v3.2M4.5 9.5h15" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round"/><circle cx="9" cy="13" r="1" fill="#ffffff"/><circle cx="12" cy="13" r="1" fill="#ffffff"/><circle cx="15" cy="13" r="1" fill="#ffffff"/></svg>`
      : `<svg viewBox="0 0 24 24" width="20" height="20" fill="none"><circle cx="14.5" cy="3.5" r="1.5" fill="#ffffff"/><path d="M10 7.5l2.5 1.5L14 6.5" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 9.5l2 2.5-3 4" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 12l3.5 1-1 5" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 16l-1.5 4" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 18l2 2.5" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return L.divIcon({
      className: '',
      html: `<div style="width:34px;height:34px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);">${svgContent}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 34]
    });
  }

  onObjectAddressKeydown(e: KeyboardEvent): void {
    const suggestions = this.objectAddressSuggestions();
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.objectSuggestionIdx = Math.min(this.objectSuggestionIdx + 1, suggestions.length - 1); this.highlightObjectSuggestion(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.objectSuggestionIdx = Math.max(this.objectSuggestionIdx - 1, 0); this.highlightObjectSuggestion(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const idx = this.objectSuggestionIdx; if (idx >= 0 && suggestions[idx]) { this.selectObjectSuggestion(suggestions[idx]); } else if (suggestions.length > 0) { this.selectObjectSuggestion(suggestions[0]); } }
    else if (e.key === 'Escape') { this.objectAddressSuggestions.set([]); this.objectSuggestionIdx = -1; }
  }

  private highlightObjectSuggestion(): void {
    document.querySelectorAll('[id^="obj-suggestion-"]').forEach(el => el.classList.remove('focused'));
    const el = document.getElementById(`obj-suggestion-${this.objectSuggestionIdx}`);
    if (el) { el.classList.add('focused'); el.scrollIntoView({ block: 'nearest' }); }
  }

  onActivityAddressKeydown(e: KeyboardEvent): void {
    const suggestions = this.activityAddressSuggestions();
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.activitySuggestionIdx = Math.min(this.activitySuggestionIdx + 1, suggestions.length - 1); this.highlightActivitySuggestion(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.activitySuggestionIdx = Math.max(this.activitySuggestionIdx - 1, 0); this.highlightActivitySuggestion(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const suggestions = this.activityAddressSuggestions(); const idx = this.activitySuggestionIdx; if (idx >= 0 && suggestions[idx]) { this.selectActivitySuggestion(suggestions[idx]); } else if (suggestions.length > 0) { this.selectActivitySuggestion(suggestions[0]); } }
    else if (e.key === 'Escape') { this.activityAddressSuggestions.set([]); this.activitySuggestionIdx = -1; }
  }

  private highlightActivitySuggestion(): void {
    document.querySelectorAll('[id^="act-suggestion-"]').forEach(el => el.classList.remove('focused'));
    const el = document.getElementById(`act-suggestion-${this.activitySuggestionIdx}`);
    if (el) { el.classList.add('focused'); el.scrollIntoView({ block: 'nearest' }); }
  }

  private openObjectOverlay(): void {
    if (this.objectOverlayRef) return;
    const inputWidth = this.objectAddressInput.nativeElement.getBoundingClientRect().width;
    this.objectOverlayRef = this.overlay.create({
      positionStrategy: this.overlay.position().flexibleConnectedTo(this.objectAddressInput).withPositions([{ originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 }]),
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      width: `${inputWidth}px`,
    });
    const portal = new TemplatePortal(this.objectSuggestionsTemplate, this.viewContainerRef);
    this.objectOverlayRef.attach(portal);
    this.objectOverlayRef.backdropClick().subscribe(() => this.closeObjectOverlay());
  }

  private closeObjectOverlay(): void {
    this.objectOverlayRef?.detach();
    this.objectOverlayRef = null;
    this.objectAddressSuggestions.set([]);
  }

  private openActivityOverlay(): void {
    if (this.activityOverlayRef) return;
    const inputWidth = this.activityAddressInput.nativeElement.getBoundingClientRect().width;
    this.activityOverlayRef = this.overlay.create({
      positionStrategy: this.overlay.position().flexibleConnectedTo(this.activityAddressInput).withPositions([{ originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 }]),
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      width: `${inputWidth}px`,
    });
    const portal = new TemplatePortal(this.activitySuggestionsTemplate, this.viewContainerRef);
    this.activityOverlayRef.attach(portal);
    this.activityOverlayRef.backdropClick().subscribe(() => this.closeActivityOverlay());
  }

  private closeActivityOverlay(): void {
    this.activityOverlayRef?.detach();
    this.activityOverlayRef = null;
    this.activityAddressSuggestions.set([]);
  }

  get endMinDateTime(): Date {
    return this.eventForm.startDatetime ? new Date(this.eventForm.startDatetime.getTime()) : new Date();
  }

  requestToggleObjectActive(item: TouristObjectRecord): void { this.pendingAction.set({ type: 'toggle-object-active', item }); }
  requestToggleActivityActive(item: ActivityRecord): void { this.pendingAction.set({ type: 'toggle-activity-active', item }); }
  requestToggleEventActive(item: EventRecord): void { this.pendingAction.set({ type: 'toggle-event-active', item }); }

  toggleObjectActive(item: TouristObjectRecord): void {
    this.contentService.toggleObjectActive(item.id).subscribe({
      next: () => { this.toastr.success(`Object "${item.name}" ${item.isActive ? 'deactivated' : 'activated'}.`); this.refreshObjects(this.objectPage()); },
      error: () => this.toastr.error('Object active status could not be changed.')
    });
  }

  toggleActivityActive(item: ActivityRecord): void {
    this.contentService.toggleActivityActive(item.id).subscribe({
      next: () => { this.toastr.success(`Activity "${item.name}" ${item.isActive ? 'deactivated' : 'activated'}.`); this.refreshActivities(this.activityPage()); },
      error: () => this.toastr.error('Activity active status could not be changed.')
    });
  }

  toggleEventActive(item: EventRecord): void {
    this.contentService.toggleEventActive(item.id).subscribe({
      next: () => { this.toastr.success(`Event "${item.name}" ${item.isActive ? 'deactivated' : 'activated'}.`); this.refreshEvents(this.eventPage()); },
      error: () => this.toastr.error('Event active status could not be changed.')
    });
  }

  hasCoordinates(type: 'object' | 'activity' | 'event', item: TouristObjectRecord | ActivityRecord | EventRecord): boolean {
    if (type === 'object') { const o = item as TouristObjectRecord; return o.latitude != null && o.longitude != null; }
    if (type === 'activity') { const a = item as ActivityRecord; if (a.latitude != null && a.longitude != null) return true; const linked = a.objectId ? this.objects().find(o => o.id === a.objectId) : null; return linked?.latitude != null && linked?.longitude != null; }
    if (type === 'event') { const linked = this.objects().find(o => o.id === (item as EventRecord).objectId); return linked?.latitude != null && linked?.longitude != null; }
    return false;
  }

  showOnMap(type: 'object' | 'activity' | 'event', item: TouristObjectRecord | ActivityRecord | EventRecord): void {
    if (!this.hasCoordinates(type, item)) return;
    sessionStorage.setItem('mapState', JSON.stringify({ searchQuery: '', selectedCategory: 'all', addressQuery: '', addressFilter: '', proximityCenter: null, selectedKey: `${type}-${(item as any).id}` }));
    this.router.navigate(['/admin-destination/map']);
  }
}
