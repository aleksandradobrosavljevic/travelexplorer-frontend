import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal, NgZone, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PublisherHeaderComponent } from '../publisher-header/publisher-header';
import * as L from 'leaflet';
import { HttpBackend, HttpClient } from '@angular/common/http';
import { Select } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { PublisherStateService } from '../../services/publisher-state.service';

import {
  ObjectReferenceOption,
  PublisherContentPayload,
  PublisherContentService,
  PublisherContentType,
  ReferenceOption,
} from '../../services/publisher-content.service';
import { ToastrService } from 'ngx-toastr';
import { forkJoin } from 'rxjs';
import { buildAssetUrl } from '../../core/config/api';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';
import {
  PHONE_FORMAT_EXAMPLE,
  PHONE_PATTERN,
  normalizePhone,
  sanitizePhoneInput
} from '../../core/utils/phone-format';
import { MAX_IMAGE_FILE_SIZE_MB, oversizedImageMessage, splitImagesBySize } from '../../core/utils/image-upload-limits';

const DefaultIcon = L.icon({
  iconUrl: 'marker-icon.png',
  shadowUrl: 'marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

@Component({
  selector: 'app-publisher-add-new-content',
  standalone: true,
  imports: [CommonModule, FormsModule, PublisherHeaderComponent, Select, DatePickerModule, TranslatePipe],
  templateUrl: './publisher-add-new-content.html',
  styleUrl: './publisher-add-new-content.css'
})
export class PublisherAddNewContentComponent implements OnInit, OnDestroy {
  readonly maxImageCount = 15;
  readonly DESCRIPTION_MAX_LENGTH = 500;

  isEditMode = signal(false);
  contentId = signal<number | null>(null);
  contentType = signal<PublisherContentType>('Object');
  isLoading = signal(true);
  objectTypeOptions = signal<ReferenceOption[]>([]);
  activityTypeOptions = signal<ReferenceOption[]>([]);
  eventTypeOptions = signal<ReferenceOption[]>([]);
  objectOptions = signal<ObjectReferenceOption[]>([]);
  selectedImageFiles = signal<File[]>([]);
  imagePreviewUrls = signal<string[]>([]);
  retainedImageUrls = signal<string[]>([]);
  imageBaselineUrls = signal<string[]>([]);
  lightboxImage = signal<string | null>(null);
  isSaving = signal(false);
  destinationOptions = signal<ReferenceOption[]>([]);
  locationSet = signal(false);
  formErrors = signal<{[key: string]: string}>({});
  hasChanges = signal(false);
  readonly phonePlaceholder = PHONE_FORMAT_EXAMPLE;
  readonly maxImageFileSizeMb = MAX_IMAGE_FILE_SIZE_MB;
  imageError = signal<string | null>(null);

  // p-datepicker radi sa Date objektima, drzimo ih odvojeno
  startDateValue = signal<Date | null>(null);
  endDateValue = signal<Date | null>(null);

  // Min date za start: now
  readonly minStartDate = new Date();

  mapSearchQuery = signal('');
  mapSearchResults = signal<{ display_name: string; lat: string; lon: string; _type: string }[]>([]);
  isMapSearching = signal(false);
  private mapSearchTimer: ReturnType<typeof setTimeout> | null = null;

  isDestinationSelected = computed(() => this.formData().destinationId != null);

  private destOutlineLayer: L.Rectangle | null = null;
  private destMaskLayer: L.Polygon | null = null;
  private lastBlockedToastAt = 0;

  readonly currencyOptions = [
    { label: 'RSD', value: 'RSD' },
    { label: 'EUR', value: 'EUR' },
    { label: 'USD', value: 'USD' },
  ];

  private locationMap: L.Map | null = null;
  private locationMarker: L.Marker | null = null;
  private originalFormData: string = '';
  private mapClickEnabled = true;
  private currentDestBounds: L.LatLngBounds | null = null;
  private nominatimHttp: HttpClient;
  private imageStripDrag: {
    element: HTMLElement;
    startX: number;
    scrollLeft: number;
    moved: boolean;
    previewUrl: string | null;
  } | null = null;

  formData = signal<PublisherContentPayload>({
    title: '',
    description: '',
    latitude: null,
    longitude: null,
    location: null,
    startDateTime: '',
    endDateTime: null,
    capacity: null,
    price: null,
    currency: 'RSD',
    airbnbLink: '',
    bookingLink: '',
    objectTypeId: null,
    activityTypeId: null,
    eventTypeId: null,
    objectId: null,
    destinationId: null,
    durationMinutes: null,
    website: null,
    phone: null,
  });

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private publisherContentService: PublisherContentService,
    private toastr: ToastrService,
    private ngZone: NgZone,
    private httpBackend: HttpBackend,
    private stateService: PublisherStateService,
    private translation: TranslationService
  ) {
    this.nominatimHttp = new HttpClient(httpBackend);
  }

  t(key: string, params?: Record<string, string | number | null | undefined>): string {
    return this.translation.translate(key, params);
  }

  contentTypeLabel(): string {
    const keyByType: Record<PublisherContentType, string> = {
      Object: 'publisher.addContent.contentTypes.object',
      Activity: 'publisher.addContent.contentTypes.activity',
      Event: 'publisher.addContent.contentTypes.event'
    };
    return this.t(keyByType[this.contentType()]);
  }

  // Konverzija Date → ISO string za formData
  // Konverzija Date → lokalni ISO string (bez UTC shift-a)
  private dateToLocalIso(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
  }

  onStartDateChange(date: Date | null): void {
    this.startDateValue.set(date);
    this.formData.update(f => ({ ...f, startDateTime: date ? this.dateToLocalIso(date) : '' }));
    this.checkChanges();
  }

  onEndDateChange(date: Date | null): void {
    this.endDateValue.set(date);
    this.formData.update(f => ({ ...f, endDateTime: date ? this.dateToLocalIso(date) : null }));
    this.checkChanges();
  }

  // Konverzija ISO string → Date za p-datepicker (tretira kao lokalno vreme)
  private isoToDate(iso: string | null | undefined): Date | null {
    if (!iso) return null;
    // Ako string nema Z ili +offset, parsuj kao lokalno vreme
    const normalized = iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso)
      ? iso
      : iso.replace('T', 'T'); // ostavi kao jeste, new Date() ce ga tretirati kao lokalno
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d;
  }

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      this.isEditMode.set(true);
      this.contentId.set(+idParam);
    }
    this.publisherContentService.getCurrentPublisherContentType().subscribe({
      next: (contentType) => {
        this.contentType.set(contentType);
        this.loadReferenceData();
      },
      error: () => {
        this.isLoading.set(false);
        this.toastr.error(this.t('publisher.addContent.typeLoadError'));
      }
    });
  }

  ngOnDestroy(): void {
    this.revokeBlobPreviews();
  }

  onDescriptionChange(value: string): void {
    this.formData.update(f => ({ ...f, description: value.slice(0, this.DESCRIPTION_MAX_LENGTH) }));
    this.checkChanges();
  }

  loadContentForEdit(id: number): void {
    this.publisherContentService.getContentItemById(id).subscribe({
      next: (existingItem) => {
        this.contentType.set(existingItem.type);
        this.formData.set({
          title: existingItem.title,
          description: existingItem.description,
          latitude: existingItem.latitude ?? null,
          longitude: existingItem.longitude ?? null,
          location: null,
          startDateTime: existingItem.startDateTime,
          endDateTime: existingItem.endDateTime ?? null,
          capacity: existingItem.capacity,
          price: existingItem.price,
          currency: existingItem.currency ?? 'RSD',
          airbnbLink: existingItem.airbnbLink,
          bookingLink: existingItem.bookingLink,
          objectTypeId: existingItem.objectTypeId ?? null,
          activityTypeId: existingItem.activityTypeId ?? null,
          eventTypeId: existingItem.eventTypeId ?? null,
          objectId: existingItem.objectId ?? null,
          destinationId: existingItem.destinationId ?? null,
          durationMinutes: existingItem.durationMinutes ?? null,
          website: existingItem.website ?? null,
          phone: existingItem.phone ?? null,
        });

        // Postavi Date vrednosti za p-datepicker
        this.startDateValue.set(this.isoToDate(existingItem.startDateTime));
        this.endDateValue.set(this.isoToDate(existingItem.endDateTime));

        if (existingItem.latitude && existingItem.longitude) {
          this.locationSet.set(true);
          this.reverseGeocode(existingItem.latitude, existingItem.longitude, () => {
            this.originalFormData = JSON.stringify(this.formData());
          });
        } else {
          this.originalFormData = JSON.stringify(this.formData());
        }

        this.hasChanges.set(false);
        this.selectedImageFiles.set([]);
        this.revokeBlobPreviews();
        const existingImageUrls = (existingItem.imageUrls?.length ? existingItem.imageUrls : existingItem.imageUrl ? [existingItem.imageUrl] : [])
          .map((url) => buildAssetUrl(url))
          .filter((url): url is string => !!url);
        this.retainedImageUrls.set(existingImageUrls);
        this.imageBaselineUrls.set(existingImageUrls);
        this.imagePreviewUrls.set(existingImageUrls);
        this.isLoading.set(false);

        const loadObjects = (destId: number) => {
          this.publisherContentService.getObjectsByDestination(destId).subscribe({
            next: (objects) => {
              this.objectOptions.set(objects);
              if (existingItem.objectId) {
                const obj = objects.find(o => o.id === existingItem.objectId);
                if (obj?.latitude && obj?.longitude) {
                  this.mapClickEnabled = false;
                }
              }
              this.formData.update(f => ({
                ...f,
                objectId: existingItem.objectId ?? null,
                eventTypeId: existingItem.eventTypeId ?? f.eventTypeId,
                startDateTime: existingItem.startDateTime ?? f.startDateTime,
                endDateTime: existingItem.endDateTime ?? f.endDateTime,
                capacity: existingItem.capacity ?? f.capacity,
                destinationId: destId
              }));
              this.originalFormData = JSON.stringify(this.formData());
              this.hasChanges.set(false);
              this.initLocationMap();
            },
            error: () => {
              this.initLocationMap();
            }
          });
        };

        if (existingItem.destinationId) {
          loadObjects(existingItem.destinationId);
        } else if (existingItem.objectId) {
          this.publisherContentService.getObjectDestination(existingItem.objectId).subscribe({
            next: (destId) => {
              if (destId) {
                loadObjects(destId);
              } else {
                this.initLocationMap();
              }
            },
            error: () => { this.initLocationMap(); }
          });
        } else {
          this.originalFormData = JSON.stringify(this.formData());
          this.hasChanges.set(false);
          this.initLocationMap();
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.toastr.error(this.t('publisher.addContent.itemLoadError'));
      }
    });
  }

  private reverseGeocode(lat: number, lng: number, onComplete?: () => void): void {
    this.nominatimHttp.get<any>(
      `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=en`
    ).subscribe({
      next: (data) => {
        this.ngZone.run(() => {
          const props = data?.features?.[0]?.properties;
          const address = props
            ? [props.name, props.street, props.city, props.state, props.country].filter(Boolean).join(', ')
            : '';
          this.formData.update(f => ({ ...f, location: address }));
          this.mapSearchQuery.set(address);
          this.checkChanges();
          onComplete?.();
        });
      },
      error: () => {
        onComplete?.();
      }
    });
  }

  onMapSearchInput(value: string): void {
    this.mapSearchQuery.set(value);
    if (this.mapSearchTimer) clearTimeout(this.mapSearchTimer);
    const query = value.trim();
    if (!query) {
      this.mapSearchResults.set([]);
      this.isMapSearching.set(false);
      return;
    }
    this.mapSearchTimer = setTimeout(() => this.searchLocation(query), 400);
  }

  private searchLocation(query: string): void {
    this.isMapSearching.set(true);
    const bounds = this.currentDestBounds;
    let url = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(query) + '&limit=10&lang=en';
    if (bounds) {
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      url += `&bbox=${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;
      const center = bounds.getCenter();
      url += `&lat=${center.lat}&lon=${center.lng}&location_bias_scale=1.0`;
    }
    fetch(url)
      .then(r => r.json())
      .then((response: any) => {
        const features = response?.features ?? [];
        const mapped = features.map((f: any) => ({
          display_name: [f.properties?.name, f.properties?.city, f.properties?.state, f.properties?.country].filter(Boolean).join(', '),
          lat: String(f.geometry?.coordinates?.[1]),
          lon: String(f.geometry?.coordinates?.[0]),
          _type: f.properties?.type ?? 'city'
        }));
        const filtered = bounds
          ? mapped.filter((r: { lat: string; lon: string }) =>
              bounds.contains([parseFloat(r.lat), parseFloat(r.lon)]))
          : mapped;
        this.ngZone.run(() => {
          this.mapSearchResults.set(filtered.slice(0, 5));
          this.isMapSearching.set(false);
        });
      })
      .catch(() => {
        this.ngZone.run(() => {
          this.mapSearchResults.set([]);
          this.isMapSearching.set(false);
        });
      });
  }

  selectSearchResult(result: { display_name: string; lat: string; lon: string; _type: string }): void {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;

    if (this.currentDestBounds && !this.currentDestBounds.contains([lat, lng])) {
      this.toastr.warning(this.t('publisher.addContent.locationOutsideDestination'));
      return;
    }

    this.mapSearchResults.set([]);
    this.mapSearchQuery.set(result.display_name);
    this.formData.update(f => ({ ...f, latitude: lat, longitude: lng, location: result.display_name }));
    this.locationSet.set(true);
    this.checkChanges();

    const zoom = result._type === 'house' ? 17 : result._type === 'city' ? 12 : 14;
    const drop = () => {
      if (!this.locationMap) return;
      if (this.locationMarker) this.locationMarker.remove();
      this.locationMarker = L.marker([lat, lng], { icon: this.createPinIcon() }).addTo(this.locationMap!);
      this.locationMap.flyTo([lat, lng], zoom, { duration: 0.6 });
    };
    if (this.locationMap) drop(); else setTimeout(drop, 300);
  }

  clearMapSearch(): void {
    this.mapSearchQuery.set('');
    this.mapSearchResults.set([]);
  }

  private createPinIcon(): L.DivIcon {
    return L.divIcon({
      className: '',
      html: `<svg viewBox="0 0 24 24" width="32" height="32">
        <path d="M12 22s6-5.5 6-11a6 6 0 1 0-12 0c0 5.5 6 11 6 11Z" fill="#239485" stroke="#ffffff" stroke-width="1.5"/>
        <circle cx="12" cy="11" r="2.5" fill="#ffffff"/>
      </svg>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32]
    });
  }

  clearMapPin(): void {
    if (this.locationMarker && this.locationMap) {
      this.locationMap.removeLayer(this.locationMarker);
      this.locationMarker = null;
    }
    this.formData.update(f => ({ ...f, latitude: null, longitude: null, location: null }));
    this.locationSet.set(false);
    this.mapSearchQuery.set('');
    this.mapSearchResults.set([]);
    this.mapClickEnabled = true;
    this.checkChanges();
  }

  private initLocationMap(): void {
    setTimeout(() => {
      const mapEl = document.getElementById('locationMap');
      if (!mapEl) return;

      if (this.locationMap) {
        this.locationMap.remove();
        this.locationMap = null;
      }

      const lat = this.formData().latitude ?? 44.0165;
      const lng = this.formData().longitude ?? 21.0059;
      const zoom = this.formData().latitude ? 15 : 7;

      this.locationMap = L.map('locationMap', {
        zoomControl: false
      }).setView([lat, lng], zoom);

      L.control.zoom({ position: 'bottomleft' }).addTo(this.locationMap);

      if (!this.formData().latitude && !this.formData().longitude) {
        this.onDestinationSelected(this.formData().destinationId ?? null, true);
      } else {
        this.applyCurrentDestinationBounds();
      }

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(this.locationMap);

      if (this.formData().latitude && this.formData().longitude) {
        this.locationMarker = L.marker([lat, lng], { icon: this.createPinIcon() }).addTo(this.locationMap);
      }

      this.locationMap.on('click', (e: L.LeafletMouseEvent) => {
        if (!this.mapClickEnabled) return;

        const { lat, lng } = e.latlng;

        if (this.currentDestBounds && !this.currentDestBounds.contains([lat, lng])) {
          this.toastr.warning(this.t('publisher.addContent.locationOutsideDestination'));
          return;
        }

        if (this.locationMarker) this.locationMarker.remove();
        this.locationMarker = L.marker([lat, lng], { icon: this.createPinIcon() }).addTo(this.locationMap!);
        this.formData.update(f => ({ ...f, latitude: lat, longitude: lng }));
        this.locationSet.set(true);
        this.checkChanges();
        this.reverseGeocode(lat, lng);
      });
    }, 150);
  }

  onDestinationSelected(destinationId: number | null, skipObjectReset: boolean = false): void {
    this.mapSearchResults.set([]);
    this.mapSearchQuery.set('');

    if (!destinationId) {
      this.currentDestBounds = null;
      this.mapClickEnabled = true;
      this.formData.update(f => ({ ...f, destinationId: null }));
      this.clearDestinationBoundsLayers();
      return;
    }

    this.currentDestBounds = null;
    this.mapClickEnabled = true;
    this.formData.update(f => ({ ...f, destinationId }));

    const dest = this.destinationOptions().find(d => d.id === destinationId);

    if (dest) {
      if (dest.boundMinLat && dest.boundMaxLat && dest.boundMinLng && dest.boundMaxLng) {
        this.currentDestBounds = L.latLngBounds(
          [Number(dest.boundMinLat), Number(dest.boundMinLng)],
          [Number(dest.boundMaxLat), Number(dest.boundMaxLng)]
        );
      } else if (dest.latitude && dest.longitude) {
        const r = 0.15;
        this.currentDestBounds = L.latLngBounds(
          [Number(dest.latitude) - r, Number(dest.longitude) - r],
          [Number(dest.latitude) + r, Number(dest.longitude) + r]
        );
      }

      const applyVisuals = () => {
        if (!this.locationMap) return;
        if (this.currentDestBounds) {
          this.applyDestinationBoundsToMap(this.currentDestBounds);
        } else if (dest.latitude && dest.longitude) {
          this.locationMap.setView([dest.latitude!, dest.longitude!], 12);
        }
      };
      if (this.locationMap) {
        applyVisuals();
      } else {
        setTimeout(applyVisuals, 300);
      }
    }

    this.publisherContentService.getObjectsByDestination(destinationId).subscribe({
      next: (objects) => {
        this.objectOptions.set(objects);
        if (!skipObjectReset) {
          this.formData.update(f => ({ ...f, objectId: null }));
        }
      },
      error: () => {}
    });

    this.checkChanges();
  }

  private applyCurrentDestinationBounds(): void {
    const destinationId = this.formData().destinationId;
    if (!destinationId || !this.locationMap) return;
    const dest = this.destinationOptions().find(d => d.id === destinationId);
    if (!dest) return;

    let bounds: L.LatLngBounds | null = null;
    if (dest.boundMinLat && dest.boundMaxLat && dest.boundMinLng && dest.boundMaxLng) {
      bounds = L.latLngBounds(
        [Number(dest.boundMinLat), Number(dest.boundMinLng)],
        [Number(dest.boundMaxLat), Number(dest.boundMaxLng)]
      );
    } else if (dest.latitude && dest.longitude) {
      const r = 0.15;
      bounds = L.latLngBounds(
        [Number(dest.latitude) - r, Number(dest.longitude) - r],
        [Number(dest.latitude) + r, Number(dest.longitude) + r]
      );
    }
    if (bounds) {
      this.currentDestBounds = bounds;
      const hasPin = this.formData().latitude !== null && this.formData().longitude !== null;
      this.applyDestinationBoundsToMap(bounds, !hasPin);
    }
  }

  private applyDestinationBoundsToMap(bounds: L.LatLngBounds, fit: boolean = true): void {
    if (!this.locationMap) return;
    this.clearDestinationBoundsLayers();

    this.destOutlineLayer = L.rectangle(bounds, {
      color: '#239485',
      weight: 2,
      fill: false,
      interactive: false
    }).addTo(this.locationMap);

    const worldRing: L.LatLngExpression[] = [
      [90, -180], [90, 180], [-90, 180], [-90, -180]
    ];
    const boundsRing: L.LatLngExpression[] = [
      [bounds.getSouth(), bounds.getWest()],
      [bounds.getSouth(), bounds.getEast()],
      [bounds.getNorth(), bounds.getEast()],
      [bounds.getNorth(), bounds.getWest()]
    ];
    this.destMaskLayer = L.polygon([worldRing, boundsRing], {
      stroke: false,
      fillColor: '#0f172a',
      fillOpacity: 0.35,
      interactive: false
    }).addTo(this.locationMap);

    this.locationMap.setMaxBounds(bounds.pad(0.15));
    const fittedZoom = this.locationMap.getBoundsZoom(bounds, false);
    this.locationMap.setMinZoom(Math.max(2, fittedZoom - 2));
    if (fit) {
      this.locationMap.fitBounds(bounds, { padding: [16, 16] });
    }
  }

  private clearDestinationBoundsLayers(): void {
    if (this.locationMap) {
      if (this.destOutlineLayer) {
        this.locationMap.removeLayer(this.destOutlineLayer);
      }
      if (this.destMaskLayer) {
        this.locationMap.removeLayer(this.destMaskLayer);
      }
      this.locationMap.setMaxBounds(null as unknown as L.LatLngBoundsExpression);
      this.locationMap.setMinZoom(0);
    }
    this.destOutlineLayer = null;
    this.destMaskLayer = null;
  }

  notifyDestinationRequired(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const now = Date.now();
    if (now - this.lastBlockedToastAt < 1500) return;
    this.lastBlockedToastAt = now;
    this.toastr.warning(this.t('publisher.addContent.selectDestinationWarning'));
  }

  onDestinationSelectClick(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const value = select.value === 'null' ? null : +select.value;
    this.onDestinationSelected(value);
  }

  onObjectSelected(objectId: number | null): void {
    this.checkChanges();

    if (!objectId) {
      this.mapClickEnabled = true;
      return;
    }

    const id = Number(objectId);
    const selectedObject = this.objectOptions().find(o => Number(o.id) === id);
    if (!selectedObject) return;

    if (selectedObject.destinationId) {
      this.formData.update(f => ({ ...f, destinationId: Number(selectedObject.destinationId) }));
    }

    const lat = Number(selectedObject.latitude);
    const lng = Number(selectedObject.longitude);

    if (lat && lng) {
      this.mapClickEnabled = false;
      this.formData.update(f => ({ ...f, latitude: lat, longitude: lng }));
      this.locationSet.set(true);

      const doZoom = () => {
        if (!this.locationMap) return;
        if (this.locationMarker) this.locationMarker.remove();
        this.locationMarker = L.marker([lat, lng], { icon: this.createPinIcon() }).addTo(this.locationMap!);
        this.locationMap.setView([lat, lng], 16);
      };

      if (this.locationMap) {
        doZoom();
      } else {
        setTimeout(doZoom, 400);
      }

      this.reverseGeocode(lat, lng);
    } else {
      this.mapClickEnabled = true;
    }

    this.checkChanges();
  }

  checkChanges(): void {
    if (!this.isEditMode()) return;
    const current = JSON.stringify(this.formData());
    this.hasChanges.set(
      current !== this.originalFormData
      || this.hasImageChanges(this.imageBaselineUrls(), this.retainedImageUrls(), this.selectedImageFiles())
    );
  }

  onPhoneChange(value: string | null): void {
    this.formData.update(data => ({ ...data, phone: sanitizePhoneInput(value) || null }));
    this.checkChanges();
  }

  goBack(): void {
    const from = this.stateService.detailsFrom();
    const detailsId = this.stateService.detailsId();
    this.stateService.detailsFrom.set(null);
    this.stateService.detailsId.set(null);
    if (from === 'details' && detailsId) {
      this.router.navigate(['/publisher-content-details', detailsId]);
    } else {
      this.router.navigate(['/publisher-my-content']);
    }
  }

  onSubmitForApproval(): void {
    if (this.imageError()) {
      this.toastr.error(this.imageError()!);
      return;
    }

    if (!this.validateForm()) return;
    this.isSaving.set(true);
    const payload = { ...this.formData(), phone: normalizePhone(this.formData().phone) };

    if (this.isEditMode() && this.contentId() !== null) {
      this.publisherContentService.updateContentItem(this.contentId()!, {
        ...payload,
        type: this.contentType()
      }).subscribe({
        next: (item) => this.finishSave(item.id, this.t('publisher.addContent.updateSuccess')),
        error: (error) => {
          this.isSaving.set(false);
          const msg = error?.error?.message ?? error?.error ?? error?.message ?? this.t('publisher.addContent.updateFailed');
          this.toastr.error(typeof msg === 'string' ? msg : this.t('publisher.addContent.updateFailed'));
        }
      });
    } else {
      this.publisherContentService.createContentItem(this.contentType(), payload).subscribe({
        next: (item) => this.finishSave(item.id, this.t('publisher.addContent.submitSuccess')),
        error: (error) => {
          this.isSaving.set(false);
          const msg = error?.error?.message ?? error?.error ?? error?.message ?? this.t('publisher.addContent.submitFailed');
          this.toastr.error(typeof msg === 'string' ? msg : this.t('publisher.addContent.submitFailed'));
        }
      });
    }
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.imageError.set(null);

    const remainingSlots = this.remainingImageSlots();
    if (remainingSlots <= 0) {
      this.toastr.warning(this.t('publisher.addContent.maxImagesWarning', { count: this.maxImageCount }));
      return;
    }

    const { accepted, rejected } = splitImagesBySize(files);

    if (rejected.length) {
      const fallbackMessage = oversizedImageMessage(rejected);
      const message = this.t('publisher.addContent.imageTooLarge', {
        limit: this.maxImageFileSizeMb,
        names: rejected.map(file => file.name).join(', ')
      });
      this.imageError.set(message || fallbackMessage);
      this.toastr.error(message || fallbackMessage);
      return;
    }

    const acceptedFiles = accepted.slice(0, remainingSlots);
    if (accepted.length > remainingSlots) {
      this.toastr.warning(this.t('publisher.addContent.remainingImagesWarning', { count: remainingSlots }));
    }

    if (!acceptedFiles.length) return;

    const previews = acceptedFiles.map((file) => URL.createObjectURL(file));
    this.selectedImageFiles.update(current => [...current, ...acceptedFiles]);
    this.imagePreviewUrls.update(current => [...current, ...previews]);
    this.checkChanges();
  }

  remainingImageSlots(): number {
    return Math.max(0, this.maxImageCount - this.imagePreviewUrls().length);
  }

  removeImage(index: number): void {
    if (index < 0 || index >= this.imagePreviewUrls().length) return;

    const retainedCount = this.retainedImageUrls().length;
    const previewUrl = this.imagePreviewUrls()[index];

    if (index < retainedCount) {
      this.retainedImageUrls.update(current => current.filter((_, i) => i !== index));
    } else {
      const fileIndex = index - retainedCount;
      this.selectedImageFiles.update(current => current.filter((_, i) => i !== fileIndex));
      if (previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    }

    this.imagePreviewUrls.update(current => current.filter((_, i) => i !== index));
    this.checkChanges();
  }

  startImageStripDrag(event: PointerEvent): void {
    if (event.button !== 0 || this.isImageStripControl(event.target)) return;

    const element = event.currentTarget as HTMLElement;
    this.imageStripDrag = {
      element,
      startX: event.clientX,
      scrollLeft: element.scrollLeft,
      moved: false,
      previewUrl: this.getImageStripPreviewUrl(event.target)
    };
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

    const shouldOpenPreview = event.type === 'pointerup' && !drag.moved && drag.previewUrl !== null;
    drag.element.releasePointerCapture?.(event.pointerId);
    drag.element.classList.remove('dragging');
    if (shouldOpenPreview) {
      this.lightboxImage.set(drag.previewUrl);
    }

    setTimeout(() => {
      if (this.imageStripDrag === drag) this.imageStripDrag = null;
    }, 0);
  }

  openImageLightbox(preview: string, event: Event): void {
    event.stopPropagation();
    if (this.imageStripDrag?.moved) return;
    this.lightboxImage.set(preview);
  }

  closeImageLightbox(): void {
    this.lightboxImage.set(null);
  }

  private isImageStripControl(target: EventTarget | null): boolean {
    return target instanceof HTMLElement
      && !!target.closest('button, input, label, a, .image-add-card, .image-remove-btn');
  }

  private getImageStripPreviewUrl(target: EventTarget | null): string | null {
    if (!(target instanceof HTMLElement)) return null;
    return target.closest<HTMLElement>('.image-thumb')?.dataset['previewUrl'] ?? null;
  }

  private loadReferenceData(): void {
    forkJoin({
      objectTypes: this.publisherContentService.getObjectTypes(),
      activityTypes: this.publisherContentService.getActivityTypes(),
      eventTypes: this.publisherContentService.getEventTypes(),
      destinations: this.publisherContentService.getDestinations()
    }).subscribe({
      next: ({ objectTypes, activityTypes, eventTypes, destinations }) => {
        this.objectTypeOptions.set(objectTypes);
        this.activityTypeOptions.set(activityTypes);
        this.eventTypeOptions.set(eventTypes);
        this.destinationOptions.set(destinations);

        const current = this.formData();
        if (!this.isEditMode() && !current.eventTypeId && eventTypes.length > 0)
          this.formData.update(f => ({ ...f, eventTypeId: eventTypes[0].id }));
        if (!this.isEditMode() && !current.objectTypeId && objectTypes.length > 0)
          this.formData.update(f => ({ ...f, objectTypeId: objectTypes[0].id }));
        if (!this.isEditMode() && !current.activityTypeId && activityTypes.length > 0)
          this.formData.update(f => ({ ...f, activityTypeId: activityTypes[0].id }));

        if (this.isEditMode() && this.contentId() !== null) {
          this.loadContentForEdit(this.contentId()!);
        } else {
          this.isLoading.set(false);
          this.initLocationMap();
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.toastr.error(this.t('publisher.addContent.referenceLoadError'));
      }
    });
  }

  private validateForm(): boolean {
    const data = this.formData();
    const errors: {[key: string]: string} = {};

    const isValidUrl = (url: string): boolean => {
      const pattern = /^https?:\/\/(www\.)?[a-zA-Z0-9][a-zA-Z0-9\-]*(\.[a-zA-Z0-9][a-zA-Z0-9\-]*)*\.[a-z]{2,3}(\/[^\s]*)?$/;
      return pattern.test(url);
    };

    if (!data.title.trim()) {
      errors['title'] = this.t('publisher.addContent.validation.titleRequired');
    } else if (data.title.trim().length < 2) {
      errors['title'] = this.t('publisher.addContent.validation.titleMin');
    } else if (data.title.trim().length > 200) {
      errors['title'] = this.t('publisher.addContent.validation.titleMax');
    }

    if (!data.latitude || !data.longitude)
      errors['locationMap'] = this.t('publisher.addContent.validation.locationRequired');

    if (this.contentType() === 'Object') {
      if (!data.destinationId)
        errors['destinationId'] = this.t('publisher.addContent.validation.destinationRequired');
      if (!data.objectTypeId)
        errors['objectTypeId'] = this.t('publisher.addContent.validation.objectTypeRequired');
      if (data.phone && !PHONE_PATTERN.test(data.phone))
        errors['phone'] = this.t('publisher.addContent.validation.phoneInvalid', { example: this.phonePlaceholder });
      if (data.website && !isValidUrl(data.website))
        errors['website'] = this.t('publisher.addContent.validation.websiteInvalid');
      if (data.airbnbLink && !isValidUrl(data.airbnbLink))
        errors['airbnbLink'] = this.t('publisher.addContent.validation.airbnbInvalid');
      if (data.bookingLink && !isValidUrl(data.bookingLink))
        errors['bookingLink'] = this.t('publisher.addContent.validation.bookingInvalid');
    }

    if (this.contentType() === 'Activity') {
      if (!data.destinationId)
        errors['destinationId'] = this.t('publisher.addContent.validation.destinationRequired');
      if (!data.activityTypeId)
        errors['activityTypeId'] = this.t('publisher.addContent.validation.activityTypeRequired');
      if (data.durationMinutes !== null && data.durationMinutes !== undefined) {
        if (!Number.isInteger(Number(data.durationMinutes)) || Number(data.durationMinutes) < 1)
          errors['durationMinutes'] = this.t('publisher.addContent.validation.durationPositive');
        if (Number(data.durationMinutes) > 10000)
          errors['durationMinutes'] = this.t('publisher.addContent.validation.durationMax');
      }
      if (data.price !== null && data.price !== undefined) {
        if (isNaN(Number(data.price)) || Number(data.price) < 0)
          errors['price'] = this.t('publisher.addContent.validation.pricePositive');
        if (Number(data.price) > 10000000)
          errors['price'] = this.t('publisher.addContent.validation.priceMax');
      }
      if (data.phone && !PHONE_PATTERN.test(data.phone))
        errors['phone'] = this.t('publisher.addContent.validation.phoneInvalid', { example: this.phonePlaceholder });
      if (data.website && !isValidUrl(data.website))
        errors['website'] = this.t('publisher.addContent.validation.websiteInvalid');
      if (data.airbnbLink && !isValidUrl(data.airbnbLink))
        errors['airbnbLink'] = this.t('publisher.addContent.validation.airbnbInvalid');
      if (data.bookingLink && !isValidUrl(data.bookingLink))
        errors['bookingLink'] = this.t('publisher.addContent.validation.bookingInvalid');
    }

    if (this.contentType() === 'Event') {
      if (!data.destinationId)
        errors['destinationId'] = this.t('publisher.addContent.validation.destinationRequired');
      if (!data.eventTypeId)
        errors['eventTypeId'] = this.t('publisher.addContent.validation.eventTypeRequired');
      if (!data.objectId)
        errors['objectId'] = this.t('publisher.addContent.validation.relatedObjectRequired');
      if (!data.startDateTime) {
        errors['startDateTime'] = this.t('publisher.addContent.validation.startRequired');
      } else {
        if (new Date(data.startDateTime) < new Date())
          errors['startDateTime'] = this.t('publisher.addContent.validation.startFuture');
        if (data.endDateTime) {
          if (new Date(data.endDateTime) <= new Date(data.startDateTime))
            errors['endDateTime'] = this.t('publisher.addContent.validation.endAfterStart');
        }
      }
      if (data.capacity !== null && data.capacity !== undefined) {
        if (!Number.isInteger(Number(data.capacity)) || Number(data.capacity) < 0)
          errors['capacity'] = this.t('publisher.addContent.validation.capacityPositive');
        if (Number(data.capacity) > 1000000)
          errors['capacity'] = this.t('publisher.addContent.validation.capacityMax');
      }
      if (data.price !== null && data.price !== undefined) {
        if (isNaN(Number(data.price)) || Number(data.price) < 0)
          errors['price'] = this.t('publisher.addContent.validation.pricePositive');
        if (Number(data.price) > 10000000)
          errors['price'] = this.t('publisher.addContent.validation.priceMax');
      }
    }

    this.formErrors.set(errors);

    if (Object.keys(errors).length > 0) {
      const firstKey = Object.keys(errors)[0];
      const el = document.getElementById(firstKey);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }

    return true;
  }

  private finishSave(contentId: number, successMessage: string): void {
    const files = this.selectedImageFiles();
    const shouldSyncImages = this.hasImageChanges(this.imageBaselineUrls(), this.retainedImageUrls(), files);
    const from = this.stateService.detailsFrom();
    const detailsId = this.stateService.detailsId();
    this.stateService.detailsFrom.set(null);
    this.stateService.detailsId.set(null);

    const navigate = () => {
      if (from === 'details' && detailsId) {
        this.router.navigate(['/publisher-content-details', detailsId]);
      } else {
        this.router.navigate(['/publisher-my-content']);
      }
    };

    if (!shouldSyncImages) {
      this.isSaving.set(false);
      this.toastr.success(successMessage);
      navigate();
      return;
    }

    this.resolveImageUpload(contentId, files, this.retainedImageUrls()).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.toastr.success(successMessage);
        navigate();
      },
      error: () => {
        this.isSaving.set(false);
        this.toastr.warning(this.t('publisher.addContent.imageUploadFailed'));
        navigate();
      }
    });
  }

  private resolveImageUpload(contentId: number, files: File[], retainedImageUrls: string[]) {
    switch (this.contentType()) {
      case 'Object': return this.publisherContentService.uploadObjectImages(contentId, files, retainedImageUrls, true);
      case 'Activity': return this.publisherContentService.uploadActivityImages(contentId, files, retainedImageUrls, true);
      case 'Event': return this.publisherContentService.uploadEventImages(contentId, files, retainedImageUrls, true);
    }
  }

  private hasImageChanges(baselineUrls: string[], retainedUrls: string[], newFiles: File[]): boolean {
    if (newFiles.length > 0) return true;
    if (baselineUrls.length !== retainedUrls.length) return true;
    return baselineUrls.some((url, index) => url !== retainedUrls[index]);
  }

  private revokeBlobPreviews(): void {
    for (const url of this.imagePreviewUrls()) {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }
  }
}