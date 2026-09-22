import { Component, inject, signal, computed, OnInit, NgZone, DestroyRef, WritableSignal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NgIf, NgClass, DatePipe, TitleCasePipe, DecimalPipe, NgFor } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ToastrService } from 'ngx-toastr';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminDestinationContentService } from '../content/content.service';
import { TouristObjectRecord, ActivityRecord, EventRecord } from '../../shared/admin-destination.models';
import { DestinationBounds, DestinationBoundsService } from '../../shared/destination-bounds.service';
import { DatePickerModule } from 'primeng/datepicker';
import { HttpBackend, HttpClient } from '@angular/common/http';
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

type DetailType = 'object' | 'activity' | 'event';
type DetailItem = TouristObjectRecord | ActivityRecord | EventRecord;

@Component({
  selector: 'app-admin-destination-content-detail',
  standalone: true,
  imports: [NgIf, NgClass, DatePipe, TitleCasePipe, NgFor, DecimalPipe, FormsModule, DatePickerModule],
  templateUrl: './content-detail.html',
  styleUrl: './content-detail.css'
})
export class AdminDestinationContentDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  public readonly router = inject(Router);
  private readonly contentService = inject(AdminDestinationContentService);
  private readonly toastr = inject(ToastrService);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly nominatimHttp = new HttpClient(inject(HttpBackend));
  private readonly boundsService = inject(DestinationBoundsService);
  private destinationBounds: DestinationBounds | null = null;

  readonly reviews = signal<any[]>([]);
  readonly reviewCount = signal(0);
  readonly averageRating = signal(0);
  readonly showAllReviews = signal(false);
  readonly formSnapshot = signal<string | null>(null);
  readonly formVersion = signal(0);

  readonly type = signal<DetailType>('object');
  readonly item = signal<DetailItem | null>(null);
  readonly isLoading = signal(false);
  readonly isSaving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly isEditing = signal(false);
  readonly imagePreview = signal<string | null>(null);
  readonly activeImageIndex = signal(0);
  readonly lightboxImage = signal<string | null>(null);
  readonly editImagePreviews = signal<string[]>([]);
  readonly editImageFiles = signal<File[]>([]);
  readonly editRetainedImageUrls = signal<string[]>([]);
  readonly editImageBaselineUrls = signal<string[]>([]);
  readonly maxImageUploadCount = 15;
  readonly DESCRIPTION_MAX_LENGTH = 500;
  readonly editImageError = signal<string | null>(null);
  readonly imageUploadHint = IMAGE_UPLOAD_HINT;
  readonly phonePlaceholder = PHONE_FORMAT_EXAMPLE;
  readonly phoneHelperText = PHONE_FORMAT_HELPER;
  readonly websitePlaceholder = 'https://example.com';
  readonly airbnbUrlPlaceholder = 'https://www.airbnb.com/rooms/123456';
  readonly bookingUrlPlaceholder = 'https://www.booking.com/hotel/rs/example.html';
  readonly urlHelperText = 'Use a full http:// or https:// URL.';

  private editMap: L.Map | null = null;
  private editMarker: L.Marker | null = null;
  readonly locationSet = signal(false);
  readonly editAddress = signal<string | null>(null);

  get minDateTime(): Date { return new Date(); }

  objectForm = {
    name: '', description: '', objectTypeId: 0,
    address: null as string | null,
    website: null as string | null,
    phone: null as string | null,
    latitude: null as number | null,
    longitude: null as number | null,
    airbnbUrl: null as string | null,
    bookingUrl: null as string | null,
    imageUrl: null as string | null,
    imageFile: null as File | null,
  };

  activityForm = {
    name: '', description: '', activityTypeId: 0,
    objectId: null as number | null,
    durationMinutes: null as number | null,
    price: null as number | null, currency: 'EUR',
    latitude: null as number | null, longitude: null as number | null,
    imageUrl: null as string | null,
    imageFile: null as File | null,
  };

  eventForm = {
    objectId: 0, eventTypeId: 0, name: '', description: '',
    startDatetime: null as Date | null, endDatetime: null as Date | null,
    capacity: null as number | null,
    price: null as number | null, currency: 'EUR',
    imageUrl: null as string | null,
    imageFile: null as File | null,
  };

  readonly statusClass = computed(() => {
    const s = (this.item() as any)?.statusName?.toLowerCase();
    if (s === 'approved') return 'approved';
    if (s === 'pending') return 'pending';
    if (s === 'rejected') return 'rejected';
    return '';
  });

  readonly isFormDirty = computed(() => {
    this.formVersion();
    const snap = this.formSnapshot();
    if (snap === null) return false;
    return this.getCurrentFormSnapshot() !== snap || this.hasImageChanges(
      this.editImageBaselineUrls(),
      this.editRetainedImageUrls(),
      this.editImageFiles()
    );
  });

  ngOnInit(): void {
    const type = this.route.snapshot.paramMap.get('type') as DetailType;
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.type.set(type);
    this.loadItem(type, id);

    this.boundsService.getBounds().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(b => {
      this.destinationBounds = b;
    });
  }

  private loadItem(type: DetailType, id: number): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    if (type === 'object') {
      this.contentService.getObjectById(id).subscribe({
        next: (item) => { this.setLoadedItem(item); this.isLoading.set(false); this.loadReviews(type, id); },
        error: () => { this.errorMessage.set('Item could not be loaded.'); this.isLoading.set(false); }
      });
    } else if (type === 'activity') {
      this.contentService.getActivityById(id).subscribe({
        next: (item) => { this.setLoadedItem(item); this.isLoading.set(false); this.loadReviews(type, id); },
        error: () => { this.errorMessage.set('Item could not be loaded.'); this.isLoading.set(false); }
      });
    } else {
      this.contentService.getEventById(id).subscribe({
        next: (item) => { this.setLoadedItem(item); this.isLoading.set(false); this.loadReviews(type, id); },
        error: () => { this.errorMessage.set('Item could not be loaded.'); this.isLoading.set(false); }
      });
    }
  }

  private loadReviews(type: DetailType, id: number): void {
    const pageSize = this.showAllReviews() ? 50 : 4;
    this.contentService.getReviews(type, id, pageSize, 'ratingDesc').subscribe({
      next: (res) => {
        this.reviews.set(res.reviews ?? []);
        this.reviewCount.set(res.totalReviews ?? 0);
        this.averageRating.set(res.averageRating ?? 0);
      }
    });
  }

  private setLoadedItem(item: DetailItem): void {
    this.item.set(item);
    this.activeImageIndex.set(0);
    this.showAllReviews.set(false);
  }

  startEdit(): void {
    const item = this.item();
    if (!item) return;
    const type = this.type();

    if (type === 'object') {
      const obj = item as TouristObjectRecord;
      const imageUrls = this.itemImages(obj);
      this.objectForm = {
        name: obj.name, description: obj.description ?? '',
        objectTypeId: obj.objectTypeId,
        address: obj.address ?? null,
        website: obj.website ?? null,
        phone: obj.phone ?? null,
        latitude: obj.latitude ?? null,
        longitude: obj.longitude ?? null,
        airbnbUrl: obj.airbnbUrl ?? null,
        bookingUrl: obj.bookingUrl ?? null,
        imageUrl: obj.imageUrl ?? null,
        imageFile: null,
      };
      this.editAddress.set(obj.address ?? null);
      this.setEditImages(imageUrls);
      this.locationSet.set(obj.latitude != null && obj.longitude != null);
    } else if (type === 'activity') {
      const act = item as ActivityRecord;
      const imageUrls = this.itemImages(act);
      this.activityForm = {
        name: act.name, description: act.description ?? '',
        activityTypeId: act.activityTypeId,
        objectId: act.objectId ?? null,
        durationMinutes: act.durationMinutes ?? null,
        price: act.price ?? null, currency: act.currency ?? 'EUR',
        latitude: act.latitude ?? null, longitude: act.longitude ?? null,
        imageUrl: act.imageUrl ?? null, imageFile: null,
      };
      this.setEditImages(imageUrls);
      this.locationSet.set(act.latitude != null && act.longitude != null);
    } else {
      const evt = item as EventRecord;
      const imageUrls = this.itemImages(evt);
      this.eventForm = {
        objectId: evt.objectId, eventTypeId: evt.eventTypeId,
        name: evt.name, description: evt.description ?? '',
        startDatetime: evt.startDatetime ? new Date(evt.startDatetime) : null,
        endDatetime: evt.endDatetime ? new Date(evt.endDatetime) : null,
        capacity: evt.capacity ?? null,
        price: evt.price ?? null, currency: evt.currency ?? 'EUR',
        imageUrl: evt.imageUrl ?? null, imageFile: null,
      };
      this.setEditImages(imageUrls);
    }

    this.editImageError.set(null);
    this.formSnapshot.set(this.getCurrentFormSnapshot());
    this.isEditing.set(true);
    setTimeout(() => this.initEditMap(), 200);
  }

  cancelEdit(): void {
    this.isEditing.set(false);
    this.destroyEditMap();
    this.imagePreview.set(null);
    this.clearEditImages();
    this.editImageError.set(null);
    this.formSnapshot.set(null);
  }

  bumpFormVersion(): void {
    this.formVersion.update(v => v + 1);
  }

  onObjectPhoneChange(value: string | null): void {
    this.objectForm.phone = sanitizePhoneInput(value);
    this.bumpFormVersion();
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

  saveEdit(): void {
    if (this.isSaving()) return;
    const type = this.type();
    const item = this.item();
    if (!item) return;
    if (type === 'object' && !this.validateObjectPhone()) return;
    if (this.editImageError()) { this.toastr.error(this.editImageError()!); return; }
    const id = (item as any).id;

    const imageFiles = this.editImageFiles();
    const retainedImageUrls = this.editRetainedImageUrls();
    const shouldSyncImages = this.hasImageChanges(this.editImageBaselineUrls(), retainedImageUrls, imageFiles);

    const doSave = () => {
      this.isSaving.set(true);
      const obs$ = type === 'object'
        ? (() => {
            const current = item as TouristObjectRecord;
            return this.contentService.updateObject(id, {
              name: this.objectForm.name,
              description: this.objectForm.description || null,
              objectTypeId: this.objectForm.objectTypeId,
              destinationId: current.destinationId,
              address: this.editAddress(),
              website: this.objectForm.website,
              phone: normalizePhone(this.objectForm.phone),
              latitude: this.objectForm.latitude,
              longitude: this.objectForm.longitude,
              airbnbUrl: this.objectForm.airbnbUrl,
              bookingUrl: this.objectForm.bookingUrl
            });
          })()
        : type === 'activity'
        ? (() => {
            const current = item as ActivityRecord;
            return this.contentService.updateActivity(id, {
              name: this.activityForm.name,
              description: this.activityForm.description || null,
              activityTypeId: this.activityForm.activityTypeId,
              destinationId: current.destinationId ?? null,
              objectId: this.activityForm.objectId,
              durationMinutes: this.activityForm.durationMinutes,
              price: this.activityForm.price,
              currency: this.activityForm.currency,
              latitude: this.activityForm.latitude,
              longitude: this.activityForm.longitude
            });
          })()
        : (() => {
            return this.contentService.updateEvent(id, {
              objectId: this.eventForm.objectId,
              eventTypeId: this.eventForm.eventTypeId,
              name: this.eventForm.name,
              description: this.eventForm.description || null,
              startDatetime: this.eventForm.startDatetime?.toISOString() ?? null,
              endDatetime: this.eventForm.endDatetime?.toISOString() ?? null,
              capacity: this.eventForm.capacity,
              price: this.eventForm.price,
              currency: this.eventForm.currency
            });
          })();

      (obs$ as any).subscribe({
        next: (updated: any) => {
          const finish = (imageUrls?: string[]) => {
            this.setLoadedItem(imageUrls ? { ...updated, imageUrl: imageUrls[0] ?? null, imageUrls } : updated);
            this.isSaving.set(false);
            this.isEditing.set(false);
            this.destroyEditMap();
            this.clearEditImages();
            this.toastr.success('Saved successfully.');
          };

          if (shouldSyncImages) {
            const upload$ = type === 'object'
              ? this.contentService.uploadObjectImage(id, imageFiles, retainedImageUrls)
              : type === 'activity'
              ? this.contentService.uploadActivityImage(id, imageFiles, retainedImageUrls)
              : this.contentService.uploadEventImage(id, imageFiles, retainedImageUrls);

            upload$.subscribe({
              next: (res) => finish(res.urls ?? (res.url ? [res.url] : [])),
              error: (error: unknown) => {
                this.toastr.error(extractApiErrorMessage(error, 'Image upload failed, but item data was saved.'));
                finish();
              }
            });
            return;
          }

          finish();
        },
        error: (error: unknown) => {
          this.isSaving.set(false);
          this.toastr.error(extractApiErrorMessage(error, 'Could not save changes.'));
        }
      });
    };

    doSave();
  }

  onImageChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const remainingSlots = this.remainingEditImageSlots();
    const selectedFiles = Array.from(input.files ?? []);
    input.value = '';
    this.editImageError.set(null);

    if (!selectedFiles.length) return;
    if (remainingSlots <= 0) {
      this.toastr.warning(`You can upload up to ${this.maxImageUploadCount} images.`);
      return;
    }

    const { accepted, rejected } = splitImagesBySize(selectedFiles);

    if (rejected.length) {
      const message = oversizedImageMessage(rejected);
      this.editImageError.set(message);
      this.toastr.error(message);
      return;
    }

    const files = accepted.slice(0, remainingSlots);

    if (this.type() === 'object') this.objectForm.imageFile = files[0] ?? null;
    else if (this.type() === 'activity') this.activityForm.imageFile = files[0] ?? null;
    else this.eventForm.imageFile = files[0] ?? null;

    this.editImageFiles.update(current => [...current, ...files]);
    this.editImagePreviews.update(current => [...current, ...files.map(file => URL.createObjectURL(file))]);
    this.imagePreview.set(this.editImagePreviews()[0] ?? null);
  }

  removeEditImage(index: number): void {
    this.removeImageAt(index, this.editRetainedImageUrls, this.editImageFiles, this.editImagePreviews);
    this.imagePreview.set(this.editImagePreviews()[0] ?? null);
  }

  remainingEditImageSlots(): number {
    return Math.max(0, this.maxImageUploadCount - this.editImagePreviews().length);
  }

  itemImages(item: DetailItem | null = this.item()): string[] {
    const source = item as any;
    if (!source) return [];
    if (Array.isArray(source.imageUrls) && source.imageUrls.length) return source.imageUrls.filter(Boolean);
    return source.imageUrl ? [source.imageUrl] : [];
  }

  activeImage(item: DetailItem | null = this.item()): string | null {
    const images = this.itemImages(item);
    return images[this.activeImageIndex()] ?? images[0] ?? null;
  }

  selectImage(index: number): void {
    this.activeImageIndex.set(index);
  }

  previousImage(): void {
    const images = this.itemImages();
    if (images.length < 2) return;
    this.activeImageIndex.update(index => (index - 1 + images.length) % images.length);
  }

  nextImage(): void {
    const images = this.itemImages();
    if (images.length < 2) return;
    this.activeImageIndex.update(index => (index + 1) % images.length);
  }

  openLightbox(imageUrl: string | null): void {
    if (imageUrl) this.lightboxImage.set(imageUrl);
  }

  closeLightbox(): void {
    this.lightboxImage.set(null);
  }

  onObjectDescriptionChange(value: string): void {
    this.objectForm.description = value.slice(0, this.DESCRIPTION_MAX_LENGTH);
    this.formVersion.update(v => v + 1);
  }

  onActivityDescriptionChange(value: string): void {
    this.activityForm.description = value.slice(0, this.DESCRIPTION_MAX_LENGTH);
    this.formVersion.update(v => v + 1);
  }

  onEventDescriptionChange(value: string): void {
    this.eventForm.description = value.slice(0, this.DESCRIPTION_MAX_LENGTH);
    this.formVersion.update(v => v + 1);
  }

  goBack(): void {
    const returnUrl = history.state?.returnUrl
      ?? sessionStorage.getItem('contentDetailReturnUrl')
      ?? '/admin-destination/content';
    sessionStorage.removeItem('contentDetailReturnUrl');
    this.router.navigateByUrl(returnUrl);
  }

  hasMappableLocation(): boolean {
    const item = this.item() as any;
    if (!item) return false;
    if (item.statusName?.toLowerCase() !== 'approved') return false;
    const type = this.type();
    if (type === 'event') return !!item.objectId;
    return item.latitude != null && item.longitude != null;
  }

  showOnMap(): void {
    const item = this.item() as any;
    if (!item) return;
    sessionStorage.setItem('mapState', JSON.stringify({
      searchQuery: '',
      selectedCategory: 'all',
      addressQuery: '',
      addressFilter: '',
      proximityCenter: null,
      selectedKey: `${this.type()}-${item.id}`,
    }));
    this.router.navigate(['/admin-destination/map']);
  }

  toggleAllReviews(): void {
    const item = this.item();
    if (!item) return;
    this.showAllReviews.update(value => !value);
    this.loadReviews(this.type(), (item as any).id);
  }

  private setEditImages(imageUrls: string[]): void {
    this.editImageFiles.set([]);
    this.editRetainedImageUrls.set(imageUrls);
    this.editImageBaselineUrls.set(imageUrls);
    this.editImagePreviews.set(imageUrls);
    this.imagePreview.set(imageUrls[0] ?? null);
  }

  private clearEditImages(): void {
    this.editImageFiles.set([]);
    this.editRetainedImageUrls.set([]);
    this.editImageBaselineUrls.set([]);
    this.editImagePreviews.set([]);
  }

  private removeImageAt(
    index: number,
    retainedSignal: WritableSignal<string[]>,
    fileSignal: WritableSignal<File[]>,
    previewSignal: WritableSignal<string[]>
  ): void {
    const retainedCount = retainedSignal().length;
    if (index < retainedCount) {
      retainedSignal.update(current => current.filter((_, i) => i !== index));
    } else {
      const fileIndex = index - retainedCount;
      fileSignal.update(current => current.filter((_, i) => i !== fileIndex));
    }
    previewSignal.update(current => current.filter((_, i) => i !== index));
  }

  private hasImageChanges(baselineUrls: string[], retainedUrls: string[], newFiles: File[]): boolean {
    if (newFiles.length > 0) return true;
    if (baselineUrls.length !== retainedUrls.length) return true;
    return baselineUrls.some((url, index) => url !== retainedUrls[index]);
  }

  private initEditMap(): void {
    const type = this.type();
    if (type === 'event') return;

    const containerId = 'detail-edit-map';
    const container = document.getElementById(containerId);
    if (!container) return;

    if (this.editMap) { this.editMap.remove(); this.editMap = null; this.editMarker = null; }

    const lat = type === 'object' ? this.objectForm.latitude : this.activityForm.latitude;
    const lng = type === 'object' ? this.objectForm.longitude : this.activityForm.longitude;
    const center: [number, number] = (lat != null && lng != null) ? [lat, lng] : [44.8176, 20.4569];

    this.editMap = L.map(containerId).setView(center, 14);
    setTimeout(() => this.editMap?.invalidateSize(), 0);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: 'OpenStreetMap contributors'
    }).addTo(this.editMap);

    this.boundsService.applyToMap(this.editMap, this.destinationBounds);

    if (lat != null && lng != null) {
      this.editMarker = L.marker([lat, lng], { icon: this.createMapIcon() }).addTo(this.editMap);
      this.locationSet.set(true);
    }

    this.editMap.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      if (!this.boundsService.isInside(this.destinationBounds, lat, lng)) {
        this.zone.run(() => this.toastr.warning(
          `Pin must be within ${this.destinationBounds?.name || 'your destination'}.`
        ));
        return;
      }
      if (this.editMarker) { this.editMarker.remove(); this.editMarker = null; }
      this.editMarker = L.marker([lat, lng], { icon: this.createMapIcon() }).addTo(this.editMap!);
      this.zone.run(() => {
        if (type === 'object') { this.objectForm.latitude = +lat.toFixed(6); this.objectForm.longitude = +lng.toFixed(6); }
        else { this.activityForm.latitude = +lat.toFixed(6); this.activityForm.longitude = +lng.toFixed(6); }
        this.locationSet.set(true);
        this.reverseGeocode(lat, lng, (addr) => this.editAddress.set(addr));
      });
    });
  }

  private destroyEditMap(): void {
    if (this.editMap) { this.editMap.remove(); this.editMap = null; this.editMarker = null; }
  }

  private reverseGeocode(lat: number, lng: number, cb: (a: string) => void): void {
    this.nominatimHttp.get<any>(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=en`
    ).subscribe({
      next: (data) => {
        if (data?.address) {
          const a = data.address;
          const street = [a.road || a.pedestrian || '', a.house_number || ''].filter(Boolean).join(' ');
          const city = a.city || a.town || a.village || '';
          const addr = [street, city, a.country || ''].filter(Boolean).join(', ');
          this.zone.run(() => cb(addr));
        }
      }, error: () => {}
    });
  }

  private createMapIcon(): L.DivIcon {
    return L.divIcon({
      className: '',
      html: `<div style="width:28px;height:28px;border-radius:50%;background:#239485;border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.25);"></div>`,
      iconSize: [28, 28], iconAnchor: [14, 14]
    });
  }

  asObject(): TouristObjectRecord | null { return this.type() === 'object' ? this.item() as TouristObjectRecord : null; }
  asActivity(): ActivityRecord | null { return this.type() === 'activity' ? this.item() as ActivityRecord : null; }
  asEvent(): EventRecord | null { return this.type() === 'event' ? this.item() as EventRecord : null; }

  private getCurrentFormSnapshot(): string {
    const type = this.type();
    if (type === 'object') return JSON.stringify(this.objectForm);
    if (type === 'activity') return JSON.stringify(this.activityForm);
    return JSON.stringify(this.eventForm);
  }
}
