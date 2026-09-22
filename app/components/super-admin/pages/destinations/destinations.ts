import { Component, OnInit, OnDestroy, NgZone, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Select } from 'primeng/select';
import { Paginator, PaginatorState } from 'primeng/paginator';
import { ToastrService } from 'ngx-toastr';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import {
  DestinationItem,
  DestinationRequestDto,
  DestinationTypeItem,
  DestinationTypeRequestDto,
  DestinationsService
} from './destinations.service';

type DestinationFormMode = 'add' | 'edit';
type ActiveDestinationsTab = 'destinations' | 'destinationTypes';

interface DestinationFormData {
  destinationTypeId: number | null;
  name: string;
  country: string;
  description: string;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
}

interface DestinationTypeFormData {
  name: string;
  description: string;
  isActive: boolean;
}

interface SelectOption {
  label: string;
  value: string;
}

interface CountryOption {
  code: string;
  name: string;
  label: string;
}

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  county?: string;
  state?: string;
  country?: string;
  country_code?: string;
  park?: string;
  nature_reserve?: string;
  peak?: string;
  mountain?: string;
  tourism?: string;
  amenity?: string;
  leisure?: string;
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  [key: string]: string | undefined;
}

interface NominatimReverseResult {
  name?: string;
  display_name?: string;
  class?: string;
  type?: string;
  addresstype?: string;
  address?: NominatimAddress;
}

interface DestinationDetection {
  name: string;
  countryCode: string;
  destinationTypeId: number | null;
  destinationTypeName: string | null;
}

@Component({
  selector: 'app-destinations',
  standalone: true,
  imports: [CommonModule, FormsModule, Select, Paginator],
  templateUrl: './destinations.html',
  styleUrl: './destinations.css'
})
export class DestinationsComponent implements OnInit, OnDestroy {
  // ── Signals ───────────────────────────────────────────────────────
  private destinations = signal<DestinationItem[]>([]);
  private allFilteredDestinations = signal<DestinationItem[]>([]);
  filteredDestinations = signal<DestinationItem[]>([]);
  destinationTypes = signal<DestinationTypeItem[]>([]);
  destinationTypeOptions = signal<DestinationTypeItem[]>([]);
  countryOptions = signal<CountryOption[]>([]);

  selectedDestinationForStatus = signal<DestinationItem | null>(null);
  isStatusConfirmOpen = signal(false);
  isFormOpen = signal(false);
  isDestinationTypeFormOpen = signal(false);
  isLoading = signal(false);
  isSubmitting = signal(false);
  selectedDestinationTypeForEdit = signal<DestinationTypeItem | null>(null);
  isDestinationTypeEditFormOpen = signal(false);
  destinationTypeEditFormData: DestinationTypeFormData = this.getEmptyDestinationTypeFormData();
  selectedDestinationTypeForStatus = signal<DestinationTypeItem | null>(null);
  isDestinationTypeStatusConfirmOpen = signal(false);

  // ── Pagination ────────────────────────────────────────────────────
  currentPage = signal(1);
  pageSize = signal(10);
  totalRecords = signal(0);

  // ── Computed ──────────────────────────────────────────────────────
  activeCount = computed(() => this.destinations().filter(d => d.isActive).length);
  inactiveCount = computed(() => this.destinations().filter(d => !d.isActive).length);
  activeDestinationTypesCount = computed(() => this.destinationTypes().filter(t => t.isActive).length);
  inactiveDestinationTypesCount = computed(() => this.destinationTypes().filter(t => !t.isActive).length);

  // ── Constants ─────────────────────────────────────────────────────
  readonly DESCRIPTION_MAX_LENGTH = 500;
  readonly DESTINATION_TYPE_DESCRIPTION_MAX_LENGTH = 500;

  // ── Plain state ───────────────────────────────────────────────────
  activeTab: ActiveDestinationsTab = 'destinations';
  searchTerm = '';
  selectedStatus = 'all';
  selectedType = 'all';
  formMode: DestinationFormMode = 'add';
  editingDestinationId: number | null = null;
  formData: DestinationFormData = this.getEmptyFormData();
  private destinationEditSnapshot: DestinationFormData | null = null;
  destinationTypeFormData: DestinationTypeFormData = this.getEmptyDestinationTypeFormData();
  private readonly fallbackCountryCodes = [
    'RS', 'ME', 'MN', 'BA', 'HR', 'SI', 'MK', 'AL', 'RO', 'BG', 'HU', 'GR', 'IT',
    'AT', 'DE', 'FR', 'ES', 'PT', 'NL', 'BE', 'CH', 'CZ', 'SK', 'PL', 'UA',
    'TR', 'GB', 'US'
  ];
  private readonly regionDisplayNames = this.createRegionDisplayNames();

  // ── Dropdown options ──────────────────────────────────────────────
  statusFilterOptions: SelectOption[] = [
    { label: 'All Statuses', value: 'all' },
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' }
  ];

  formStatusOptions = [
    { label: 'Active', value: true },
    { label: 'Inactive', value: false }
  ];

  typeFilterOptions = signal<{ label: string; value: string }[]>([
    { label: 'All Types', value: 'all' }
  ]);

  // ── Mini map ──────────────────────────────────────────────────────
  private miniMap: L.Map | null = null;
  private miniMapMarker: L.Marker | null = null;
  mapSearchQuery = '';
  isMapSearching = signal(false);
  isDetectingDestination = signal(false);
  destinationDetectionMessage = signal('');
  mapSearchResults = signal<any[]>([]);
  dropdownTop = signal(0);
  dropdownLeft = signal(0);
  dropdownWidth = signal(0);
  coordLat = signal<number | null>(null);
  coordLng = signal<number | null>(null);
  private mapSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private reverseGeocodeRequestId = 0;
  private lastAutoDetectedName = '';

  constructor(
    private destinationsService: DestinationsService,
    private toastr: ToastrService,
    private router: Router,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    this.rebuildCountryOptions();
    this.loadDestinationTypes();
    this.loadDestinations();
  }

  ngOnDestroy(): void {
    this.destroyMiniMap();
    if (this.mapSearchTimer) clearTimeout(this.mapSearchTimer);
  }

  loadDestinations(): void {
    this.isLoading.set(true);
    this.destinationsService.getAllDestinations().subscribe({
      next: (data) => {
        this.destinations.set(data);
        this.rebuildCountryOptions(data);
        this.applyFilters();
        this.isLoading.set(false);
      },
      error: () => {
        this.toastr.error('Failed to load destinations.');
        this.isLoading.set(false);
      }
    });
  }

  loadDestinationTypes(): void {
    this.destinationsService.getDestinationTypes().subscribe({
      next: (data) => {
        this.destinationTypes.set(data);
        this.destinationTypeOptions.set(data);
        this.typeFilterOptions.set([
          { label: 'All Types', value: 'all' },
          ...data.map(t => ({ label: t.name, value: String(t.id) }))
        ]);
      },
      error: () => {
        this.toastr.error('Failed to load destination types.');
      }
    });
  }

  setActiveTab(tab: ActiveDestinationsTab): void {
    this.activeTab = tab;
  }

  getEmptyFormData(): DestinationFormData {
    return { destinationTypeId: null, name: '', country: '', description: '', latitude: null, longitude: null, isActive: true };
  }

  getEmptyDestinationTypeFormData(): DestinationTypeFormData {
    return { name: '', description: '', isActive: true };
  }

  private createRegionDisplayNames(): Intl.DisplayNames | null {
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      return null;
    }
  }

  private getSupportedCountryCodes(): string[] {
    const intlWithRegionList = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
    try {
      return intlWithRegionList.supportedValuesOf?.('region') ?? this.fallbackCountryCodes;
    } catch {
      return this.fallbackCountryCodes;
    }
  }

  private normalizeCountryCode(value: string | null | undefined): string {
    const code = (value ?? '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : '';
  }

  private resolveCountryName(value: string | null | undefined): string {
    const raw = (value ?? '').trim();
    if (!raw) return '';
    const code = this.normalizeCountryCode(raw);
    if (code) return this.regionDisplayNames?.of(code) ?? raw;
    return raw;
  }

  private createCountryOption(codeValue: string): CountryOption | null {
    const code = this.normalizeCountryCode(codeValue);
    if (!code) return null;
    const name = this.regionDisplayNames?.of(code) ?? code;
    return { code, name, label: `${code} (${name})` };
  }

  private rebuildCountryOptions(destinations: DestinationItem[] = this.destinations()): void {
    const backendCodes = destinations
      .map(destination => this.normalizeCountryCode(destination.country))
      .filter(Boolean);

    const allCodes = Array.from(new Set([
      ...backendCodes,
      ...this.getSupportedCountryCodes(),
      ...this.fallbackCountryCodes
    ]));

    const options = allCodes
      .map(code => this.createCountryOption(code))
      .filter((option): option is CountryOption => option !== null)
      .sort((a, b) => {
        const aFromBackend = backendCodes.includes(a.code);
        const bFromBackend = backendCodes.includes(b.code);
        if (aFromBackend !== bFromBackend) return aFromBackend ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    this.countryOptions.set(options);
  }

  applyFilters(): void {
    const normalizedSearch = this.searchTerm.trim().toLowerCase();
    const filtered = this.destinations().filter((destination) => {
      const matchesSearch =
        normalizedSearch === '' ||
        destination.name.toLowerCase().includes(normalizedSearch) ||
        destination.country.toLowerCase().includes(normalizedSearch) ||
        (destination.description ?? '').toLowerCase().includes(normalizedSearch);

      const matchesStatus =
        this.selectedStatus === 'all' ||
        (this.selectedStatus === 'active' && destination.isActive) ||
        (this.selectedStatus === 'inactive' && !destination.isActive);

      const matchesType =
        this.selectedType === 'all' ||
        destination.destinationTypeId === Number(this.selectedType);

      return matchesSearch && matchesStatus && matchesType;
    });

    this.allFilteredDestinations.set(filtered);
    this.totalRecords.set(filtered.length);
    this.currentPage.set(1);
    this.applyPage();
  }

  private applyPage(): void {
    const page = this.currentPage();
    const size = this.pageSize();
    const start = (page - 1) * size;
    this.filteredDestinations.set(this.allFilteredDestinations().slice(start, start + size));
  }

  onPageChange(event: PaginatorState): void {
    this.currentPage.set((event.page ?? 0) + 1);
    this.pageSize.set(event.rows ?? 10);
    this.applyPage();
  }

  onSearchChange(): void { this.applyFilters(); }
  onStatusChange(): void { this.applyFilters(); }
  onTypeChange(): void { this.applyFilters(); }

  clearAllFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = 'all';
    this.selectedType = 'all';
    this.applyFilters();
    this.toastr.success('Filters cleared.');
  }

  openAddForm(): void {
    this.formMode = 'add';
    this.editingDestinationId = null;
    this.formData = this.getEmptyFormData();
    const options = this.destinationTypeOptions();
    if (options.length > 0) this.formData.destinationTypeId = options[0].id;
    this.coordLat.set(null);
    this.coordLng.set(null);
    this.destinationDetectionMessage.set('');
    this.lastAutoDetectedName = '';
    this.isFormOpen.set(true);
    this.mapSearchQuery = '';
    this.mapSearchResults.set([]);
    setTimeout(() => this.initMiniMap(), 300);
  }

  openEditForm(destination: DestinationItem): void {
    this.formMode = 'edit';
    this.editingDestinationId = destination.id;
    this.formData = {
      destinationTypeId: destination.destinationTypeId,
      name: destination.name,
      country: this.resolveCountryName(destination.country),
      description: destination.description ?? '',
      latitude: destination.latitude,
      longitude: destination.longitude,
      isActive: destination.isActive
    };
    this.destinationEditSnapshot = { ...this.formData };
    this.coordLat.set(destination.latitude);
    this.coordLng.set(destination.longitude);
    this.destinationDetectionMessage.set('');
    this.lastAutoDetectedName = '';
    this.isFormOpen.set(true);
    this.mapSearchQuery = '';
    this.mapSearchResults.set([]);
    setTimeout(() => this.initMiniMap(destination.latitude, destination.longitude), 300);
  }

  closeForm(): void {
    this.destroyMiniMap();
    this.mapSearchQuery = '';
    this.mapSearchResults.set([]);
    this.coordLat.set(null);
    this.coordLng.set(null);
    this.destinationDetectionMessage.set('');
    this.isDetectingDestination.set(false);
    this.lastAutoDetectedName = '';
    this.isFormOpen.set(false);
    this.formMode = 'add';
    this.editingDestinationId = null;
    this.formData = this.getEmptyFormData();
  }

  // ── Mini map ──────────────────────────────────────────────────────
  private initMiniMap(lat?: number | null, lng?: number | null): void {
    this.destroyMiniMap();
    const container = document.getElementById('destination-mini-map');
    if (!container) return;

    const centerLat = lat ?? 44.0;
    const centerLng = lng ?? 20.0;
    const zoom = lat ? 10 : 5;
    const worldBounds = L.latLngBounds(L.latLng(-85, -180), L.latLng(85, 180));

    this.miniMap = L.map('destination-mini-map', {
      zoomControl: true,
      scrollWheelZoom: true,
      minZoom: 2,
      maxBounds: worldBounds,
      maxBoundsViscosity: 0.8
    }).setView([centerLat, centerLng], zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      noWrap: true
    }).addTo(this.miniMap);

    if (lat && lng) {
      this.miniMapMarker = L.marker([lat, lng], { icon: this.createMiniMarkerIcon() }).addTo(this.miniMap);
    }

    this.miniMap.on('click', (e: L.LeafletMouseEvent) => {
      const clickedLat = Math.round(e.latlng.lat * 1e6) / 1e6;
      const clickedLng = Math.round(e.latlng.lng * 1e6) / 1e6;
      this.setSelectedMapLocation(clickedLat, clickedLng, { detect: true });
    });
  }

  private setSelectedMapLocation(
    lat: number,
    lng: number,
    options: { flyTo?: boolean; zoom?: number; detect?: boolean } = {}
  ): void {
    const roundedLat = Math.round(lat * 1e6) / 1e6;
    const roundedLng = Math.round(lng * 1e6) / 1e6;

    this.ngZone.run(() => {
      this.formData = { ...this.formData, latitude: roundedLat, longitude: roundedLng };
      this.coordLat.set(roundedLat);
      this.coordLng.set(roundedLng);
      this.destinationDetectionMessage.set('');
    });

    if (this.miniMap) {
      if (this.miniMapMarker) {
        this.miniMapMarker.setLatLng([roundedLat, roundedLng]);
      } else {
        this.miniMapMarker = L.marker([roundedLat, roundedLng], { icon: this.createMiniMarkerIcon() }).addTo(this.miniMap);
      }

      if (options.flyTo) {
        this.miniMap.flyTo([roundedLat, roundedLng], options.zoom ?? 12, { duration: 0.6 });
      }
    }

    if (options.detect) {
      void this.detectDestinationFromCoordinates(roundedLat, roundedLng);
    }
  }

  private destroyMiniMap(): void {
    this.reverseGeocodeRequestId++;
    if (this.miniMap) {
      this.miniMap.remove();
      this.miniMap = null;
      this.miniMapMarker = null;
    }
  }

  clearMapPin(): void {
    this.reverseGeocodeRequestId++;
    this.ngZone.run(() => {
      this.formData = { ...this.formData, latitude: null, longitude: null };
      this.coordLat.set(null);
      this.coordLng.set(null);
      this.destinationDetectionMessage.set('');
      this.isDetectingDestination.set(false);
    });
    if (this.miniMapMarker && this.miniMap) {
      this.miniMap.removeLayer(this.miniMapMarker);
      this.miniMapMarker = null;
    }
  }

  // ── Map search ────────────────────────────────────────────────────
  onMapSearchChange(event?: Event): void {
    if (this.mapSearchTimer) clearTimeout(this.mapSearchTimer);
    const query = this.mapSearchQuery.trim();
    if (!query) { this.mapSearchResults.set([]); return; }
    if (event?.target) {
      const input = (event.target as HTMLElement).closest('.map-search-box');
      if (input) {
        const rect = input.getBoundingClientRect();
        this.ngZone.run(() => {
          this.dropdownTop.set(rect.bottom + 4);
          this.dropdownLeft.set(rect.left);
          this.dropdownWidth.set(rect.width);
        });
      }
    }
    this.mapSearchTimer = setTimeout(() => this.searchLocation(query), 400);
  }

  private searchLocation(query: string): void {
    this.isMapSearching.set(true);
    const url = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(query) + '&limit=5&lang=en';
    fetch(url)
      .then(r => r.json())
      .then((response: any) => {
        const results = (response?.features ?? []).map((f: any) => ({
          display_name: [f.properties?.name, f.properties?.city, f.properties?.state, f.properties?.country].filter(Boolean).join(', '),
          lat: String(f.geometry?.coordinates?.[1]),
          lon: String(f.geometry?.coordinates?.[0]),
          _type: f.properties?.type ?? 'city'
        }));
        this.ngZone.run(() => {
          this.mapSearchResults.set(results);
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

  selectSearchResult(result: any): void {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    this.mapSearchQuery = result.display_name;
    this.mapSearchResults.set([]);
    if (!this.miniMap) return;
    const zoom = result._type === 'house' ? 17 : result._type === 'city' ? 11 : 14;
    this.setSelectedMapLocation(lat, lng, { flyTo: true, zoom, detect: true });
  }

  clearMapSearch(): void {
    this.mapSearchQuery = '';
    this.mapSearchResults.set([]);
  }

  private async detectDestinationFromCoordinates(lat: number, lng: number): Promise<void> {
    const requestId = ++this.reverseGeocodeRequestId;
    this.ngZone.run(() => {
      this.isDetectingDestination.set(true);
      this.destinationDetectionMessage.set('Detecting location...');
    });

    const url = [
      'https://nominatim.openstreetmap.org/reverse',
      `?lat=${encodeURIComponent(String(lat))}`,
      `&lon=${encodeURIComponent(String(lng))}`,
      '&format=jsonv2',
      '&addressdetails=1',
      '&zoom=12',
      '&accept-language=en'
    ].join('');

    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (requestId !== this.reverseGeocodeRequestId) return;

      if (!response.ok) {
        throw new Error(`Reverse geocoding failed with status ${response.status}`);
      }

      const data = await response.json() as NominatimReverseResult;
      if (requestId !== this.reverseGeocodeRequestId) return;

      const detection = this.buildDestinationDetection(data);
      this.ngZone.run(() => this.applyDestinationDetection(detection));
    } catch {
      if (requestId !== this.reverseGeocodeRequestId) return;
      this.ngZone.run(() => {
        this.destinationDetectionMessage.set('Location detected, but details could not be resolved.');
      });
    } finally {
      if (requestId === this.reverseGeocodeRequestId) {
        this.ngZone.run(() => this.isDetectingDestination.set(false));
      }
    }
  }

  private buildDestinationDetection(data: NominatimReverseResult): DestinationDetection {
    const address = data.address ?? {};
    const destinationTypeId = this.inferDestinationTypeId(data, address);
    const destinationTypeName = destinationTypeId
      ? this.destinationTypeOptions().find(type => type.id === destinationTypeId)?.name ?? null
      : null;

    return {
      name: this.pickDestinationName(data, address, destinationTypeName),
      countryCode: this.detectCountryCode(address),
      destinationTypeId,
      destinationTypeName
    };
  }

  private applyDestinationDetection(detection: DestinationDetection): void {
    let didApply = false;
    const currentName = this.formData.name.trim();
    const shouldReplaceName = !!detection.name
      && (!currentName || (!!this.lastAutoDetectedName && currentName === this.lastAutoDetectedName));

    if (detection.countryCode) {
      this.ensureCountryOption(detection.countryCode);
    }

    this.formData = {
      ...this.formData,
      name: shouldReplaceName ? detection.name : this.formData.name,
      country: detection.countryCode || this.formData.country,
      destinationTypeId: detection.destinationTypeId ?? this.formData.destinationTypeId
    };

    if (shouldReplaceName) {
      this.lastAutoDetectedName = detection.name;
      didApply = true;
    }

    if (detection.countryCode || detection.destinationTypeId) {
      didApply = true;
    }

    const pieces = [
      detection.name,
      detection.destinationTypeName,
      detection.countryCode
    ].filter(Boolean);

    this.destinationDetectionMessage.set(
      didApply && pieces.length
        ? `Detected ${pieces.join(', ')}.`
        : 'Pin set. Destination details were not detected.'
    );
  }

  private pickDestinationName(
    data: NominatimReverseResult,
    address: NominatimAddress,
    destinationTypeName: string | null
  ): string {
    const normalizedType = this.normalizeTypeName(destinationTypeName ?? '');

    if (normalizedType === 'naturepark') {
      return this.firstNonEmpty(address.nature_reserve, address.park, data.name, address.municipality, address.city, address.town, address.village, address.county, address.state);
    }

    if (normalizedType === 'sparesort') {
      return this.firstNonEmpty(data.name, address.tourism, address.amenity, address.city, address.town, address.village, address.municipality, address.county);
    }

    if (normalizedType === 'mountain') {
      return this.firstNonEmpty(address.mountain, address.peak, data.name, address.county, address.state);
    }

    if (normalizedType === 'village') {
      return this.firstNonEmpty(address.village, address.hamlet, address.municipality, data.name, address.county, address.state);
    }

    return this.firstNonEmpty(
      address.city,
      address.town,
      address.municipality,
      address.village,
      address.hamlet,
      address.county,
      data.name,
      address.state,
      data.display_name?.split(',')[0]
    );
  }

  private detectCountryCode(address: NominatimAddress): string {
    const directCode = this.normalizeCountryCode(address.country_code);
    if (directCode) return directCode;

    const countryName = this.cleanDetectedText(address.country);
    if (!countryName) return '';

    return this.countryOptions().find(option =>
      option.name.toLowerCase() === countryName.toLowerCase()
      || option.label.toLowerCase().includes(`(${countryName.toLowerCase()})`)
    )?.code ?? '';
  }

  private ensureCountryOption(countryCode: string): void {
    const code = this.normalizeCountryCode(countryCode);
    if (!code || this.countryOptions().some(option => option.code === code)) return;

    const option = this.createCountryOption(code);
    if (!option) return;

    this.countryOptions.set(
      [...this.countryOptions(), option].sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  private inferDestinationTypeId(data: NominatimReverseResult, address: NominatimAddress): number | null {
    const candidates = this.inferDestinationTypeCandidates(data, address);
    return this.findDestinationTypeIdByCandidates(candidates);
  }

  private inferDestinationTypeCandidates(data: NominatimReverseResult, address: NominatimAddress): string[] {
    const className = this.cleanDetectedText(data.class).toLowerCase();
    const osmType = this.cleanDetectedText(data.type).toLowerCase();
    const addressType = this.cleanDetectedText(data.addresstype).toLowerCase();
    const text = [
      className,
      osmType,
      addressType,
      data.name,
      data.display_name,
      address.park,
      address.nature_reserve,
      address.peak,
      address.mountain,
      address.tourism,
      address.amenity,
      address.leisure
    ].map(value => this.cleanDetectedText(value).toLowerCase()).join(' ');

    if (this.containsAny(text, ['spa', 'banja', 'thermal', 'wellness', 'hot spring', 'resort'])) {
      return ['SpaResort', 'City'];
    }

    if (this.containsAny(text, ['mountain', 'peak', 'ridge', 'volcano', 'planina'])) {
      return ['Mountain', 'NaturePark', 'City'];
    }

    if (
      osmType === 'national_park'
      || osmType === 'nature_reserve'
      || osmType === 'protected_area'
      || this.containsAny(text, ['national park', 'nature park', 'nature reserve', 'protected area', 'park prirode'])
    ) {
      return ['NaturePark', 'Mountain', 'City'];
    }

    if (
      osmType === 'village'
      || osmType === 'hamlet'
      || addressType === 'village'
      || addressType === 'hamlet'
      || !!address.village
      || !!address.hamlet
    ) {
      return ['Village', 'City'];
    }

    return ['City', 'Village'];
  }

  private findDestinationTypeIdByCandidates(candidates: string[]): number | null {
    const types = this.destinationTypeOptions();

    for (const candidate of candidates) {
      const normalizedCandidate = this.normalizeTypeName(candidate);
      const match = types.find(type => this.normalizeTypeName(type.name) === normalizedCandidate);
      if (match) return match.id;
    }

    const aliases: Record<string, string[]> = {
      NaturePark: ['nationalpark', 'naturepark', 'naturereserve', 'protectedarea', 'park'],
      SpaResort: ['sparesort', 'spa', 'banja', 'resort'],
      Mountain: ['mountain', 'mountains', 'planina', 'peak'],
      Village: ['village', 'hamlet'],
      City: ['city', 'town', 'municipality']
    };

    for (const candidate of candidates) {
      const aliasValues = aliases[candidate] ?? [];
      const match = types.find(type => aliasValues.includes(this.normalizeTypeName(type.name)));
      if (match) return match.id;
    }

    return null;
  }

  private normalizeTypeName(value: string): string {
    return this.cleanDetectedText(value).replace(/[\s_-]+/g, '').toLowerCase();
  }

  private containsAny(text: string, needles: string[]): boolean {
    return needles.some(needle => text.includes(needle));
  }

  private firstNonEmpty(...values: Array<string | undefined>): string {
    for (const value of values) {
      const cleaned = this.cleanDetectedText(value);
      if (cleaned) return cleaned;
    }

    return '';
  }

  private cleanDetectedText(value: string | undefined): string {
    return (value ?? '').trim();
  }

  private createMiniMarkerIcon(): L.DivIcon {
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

  // ── Error parsing ─────────────────────────────────────────────────
  private parseErrorMessage(error: any): string {
    if (!error) return 'An unexpected error occurred.';

    if (typeof error.error === 'string' && error.error.trim()) {
      return error.error;
    }

    if (error.error && typeof error.error === 'object') {
      const body = error.error;
      if (body.errors && typeof body.errors === 'object') {
        const messages = Object.values(body.errors)
          .flat()
          .filter((m): m is string => typeof m === 'string');
        if (messages.length > 0) return messages.join(' ');
      }
      if (typeof body.message === 'string' && body.message.trim()) return body.message;
      if (typeof body.title === 'string' && body.title.trim()) return body.title;
    }

    return 'An unexpected error occurred.';
  }

  // ── Description change handlers ───────────────────────────────────
  onDescriptionChange(value: string): void {
    this.formData.description = value.slice(0, this.DESCRIPTION_MAX_LENGTH);
  }

  onDestinationTypeDescriptionChange(value: string): void {
    this.destinationTypeFormData.description = value.slice(0, this.DESTINATION_TYPE_DESCRIPTION_MAX_LENGTH);
  }

  onDestinationTypeEditDescriptionChange(value: string): void {
    this.destinationTypeEditFormData.description = value.slice(0, this.DESTINATION_TYPE_DESCRIPTION_MAX_LENGTH);
  }
  
  // ── Change detection (enable Save only when edited) ───────────────
  hasDestinationChanges(): boolean {
    if (this.formMode !== 'edit') return true;
    const snap = this.destinationEditSnapshot;
    if (!snap) return true;
    const f = this.formData;
    return f.destinationTypeId !== snap.destinationTypeId
      || f.name.trim() !== snap.name.trim()
      || f.country.trim() !== snap.country.trim()
      || (f.description ?? '').trim() !== (snap.description ?? '').trim()
      || f.latitude !== snap.latitude
      || f.longitude !== snap.longitude
      || f.isActive !== snap.isActive;
  }

  hasDestinationTypeEditChanges(): boolean {
    const type = this.selectedDestinationTypeForEdit();
    if (!type) return false;
    const f = this.destinationTypeEditFormData;
    return f.name.trim() !== type.name.trim()
      || f.description.trim() !== type.description.trim()
      || f.isActive !== type.isActive;
  }

  // ── Save ──────────────────────────────────────────────────────────
  saveDestination(): void {
    const trimmedName = this.formData.name.trim();
    const selectedCountryName = this.formData.country.trim();
    const trimmedDescription = this.formData.description.trim();

    if (!this.formData.destinationTypeId || !trimmedName || !selectedCountryName) {
      this.toastr.warning('Please fill in destination type, name and country.');
      return;
    }

    if (!this.countryOptions().some(option => option.name === selectedCountryName)) {
      this.toastr.warning('Please select a valid country from the list.');
      return;
    }

    if (trimmedDescription.length > this.DESCRIPTION_MAX_LENGTH) {
      this.toastr.warning(`Description must not exceed ${this.DESCRIPTION_MAX_LENGTH} characters.`);
      return;
    }

    const payload: DestinationRequestDto = {
      destinationTypeId: this.formData.destinationTypeId,
      name: trimmedName,
      country: selectedCountryName,
      description: trimmedDescription || null,
      latitude: this.formData.latitude,
      longitude: this.formData.longitude,
      isActive: this.formData.isActive
    };

    this.isSubmitting.set(true);

    if (this.formMode === 'add') {
      this.destinationsService.createDestination(payload).subscribe({
        next: () => {
          this.toastr.success('Destination created successfully.');
          this.isSubmitting.set(false);
          this.closeForm();
          this.loadDestinations();
        },
        error: (error) => {
          this.toastr.error(this.parseErrorMessage(error));
          this.isSubmitting.set(false);
        }
      });
    } else if (this.editingDestinationId !== null) {
      this.destinationsService.updateDestination(this.editingDestinationId, payload).subscribe({
        next: () => {
          this.toastr.success('Destination updated successfully.');
          this.isSubmitting.set(false);
          this.closeForm();
          this.loadDestinations();
        },
        error: (error) => {
          this.toastr.error(this.parseErrorMessage(error));
          this.isSubmitting.set(false);
        }
      });
    }
  }

  viewOnMap(destination: DestinationItem): void {
    this.router.navigate(['/super-admin/map'], { queryParams: { destinationId: destination.id, from: 'destinations' } });
  }

  // ── Destination Type form ─────────────────────────────────────────
  openDestinationTypeForm(): void {
    this.destinationTypeFormData = this.getEmptyDestinationTypeFormData();
    this.isDestinationTypeFormOpen.set(true);
  }

  closeDestinationTypeForm(): void {
    this.isDestinationTypeFormOpen.set(false);
    this.destinationTypeFormData = this.getEmptyDestinationTypeFormData();
  }

  saveDestinationType(): void {
    const trimmedName = this.destinationTypeFormData.name.trim();
    const trimmedDescription = this.destinationTypeFormData.description.trim();
    if (!trimmedName || !trimmedDescription) { this.toastr.warning('Please fill in name and description.'); return; }
    if (trimmedDescription.length > this.DESTINATION_TYPE_DESCRIPTION_MAX_LENGTH) {
      this.toastr.warning(`Description must not exceed ${this.DESTINATION_TYPE_DESCRIPTION_MAX_LENGTH} characters.`);
      return;
    }
    const payload: DestinationTypeRequestDto = { name: trimmedName, description: trimmedDescription, isActive: this.destinationTypeFormData.isActive };
    this.destinationsService.createDestinationType(payload).subscribe({
      next: () => { this.toastr.success('Destination type created successfully.'); this.closeDestinationTypeForm(); this.loadDestinationTypes(); },
      error: (error) => { this.toastr.error(this.parseErrorMessage(error)); }
    });
  }

  // ── Status confirm ────────────────────────────────────────────────
  openStatusConfirm(destination: DestinationItem): void {
    this.selectedDestinationForStatus.set(destination);
    this.isStatusConfirmOpen.set(true);
  }

  closeStatusConfirm(): void {
    this.selectedDestinationForStatus.set(null);
    this.isStatusConfirmOpen.set(false);
  }

  confirmStatusChange(): void {
    const destination = this.selectedDestinationForStatus();
    if (!destination) return;
    const payload: DestinationRequestDto = {
      destinationTypeId: destination.destinationTypeId,
      name: destination.name,
      country: this.resolveCountryName(destination.country),
      description: destination.description,
      latitude: destination.latitude,
      longitude: destination.longitude,
      isActive: !destination.isActive
    };
    this.destinationsService.updateDestination(destination.id, payload).subscribe({
      next: () => {
        this.toastr.success(`Destination ${!destination.isActive ? 'activated' : 'deactivated'} successfully.`);
        this.closeStatusConfirm();
        setTimeout(() => this.loadDestinations());
      },
      error: (error) => { this.toastr.error(this.parseErrorMessage(error)); }
    });
  }

  getStatusClass(isActive: boolean): string {
    return isActive ? 'status-active' : 'status-inactive';
  }

  formatDate(dateValue: string): string {
    if (!dateValue) return '-';
    return new Date(dateValue).toLocaleDateString();
  }

  formatCoordinate(value: number | null): string {
    return value === null ? '-' : String(value);
  }

  // ── Destination Type edit ─────────────────────────────────────────
  openDestinationTypeEditForm(type: DestinationTypeItem): void {
    this.selectedDestinationTypeForEdit.set(type);
    this.destinationTypeEditFormData = { name: type.name, description: type.description, isActive: type.isActive };
    this.isDestinationTypeEditFormOpen.set(true);
  }

  closeDestinationTypeEditForm(): void {
    this.isDestinationTypeEditFormOpen.set(false);
    this.selectedDestinationTypeForEdit.set(null);
    this.destinationTypeEditFormData = this.getEmptyDestinationTypeFormData();
  }

  saveDestinationTypeEdit(): void {
    const type = this.selectedDestinationTypeForEdit();
    if (!type) return;
    const trimmedName = this.destinationTypeEditFormData.name.trim();
    const trimmedDescription = this.destinationTypeEditFormData.description.trim();
    if (!trimmedName || !trimmedDescription) { this.toastr.warning('Please fill in name and description.'); return; }
    if (trimmedDescription.length > this.DESTINATION_TYPE_DESCRIPTION_MAX_LENGTH) {
      this.toastr.warning(`Description must not exceed ${this.DESTINATION_TYPE_DESCRIPTION_MAX_LENGTH} characters.`);
      return;
    }
    const payload: DestinationTypeRequestDto = { name: trimmedName, description: trimmedDescription, isActive: this.destinationTypeEditFormData.isActive };
    this.destinationsService.updateDestinationType(type.id, payload).subscribe({
      next: () => { this.toastr.success('Destination type updated successfully.'); this.closeDestinationTypeEditForm(); this.loadDestinationTypes(); },
      error: (error) => { this.toastr.error(this.parseErrorMessage(error)); }
    });
  }

  openDestinationTypeStatusConfirm(type: DestinationTypeItem): void {
    this.selectedDestinationTypeForStatus.set(type);
    this.isDestinationTypeStatusConfirmOpen.set(true);
  }

  closeDestinationTypeStatusConfirm(): void {
    this.selectedDestinationTypeForStatus.set(null);
    this.isDestinationTypeStatusConfirmOpen.set(false);
  }

  confirmDestinationTypeStatusChange(): void {
    const type = this.selectedDestinationTypeForStatus();
    if (!type) return;
    const payload: DestinationTypeRequestDto = { name: type.name, description: type.description, isActive: !type.isActive };
    this.destinationsService.updateDestinationType(type.id, payload).subscribe({
      next: () => { this.toastr.success(`Destination type ${!type.isActive ? 'activated' : 'deactivated'} successfully.`); this.closeDestinationTypeStatusConfirm(); this.loadDestinationTypes(); },
      error: (error) => { this.toastr.error(this.parseErrorMessage(error)); }
    });
  }
}