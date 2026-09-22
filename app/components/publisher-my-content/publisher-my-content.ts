import { Component, OnInit, OnDestroy, signal, computed, HostListener, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute  } from '@angular/router';
import { PublisherHeaderComponent } from '../publisher-header/publisher-header';
import {
  PublisherContentItem,
  PublisherContentService,
  PublisherContentType,
  ReferenceOption,
} from '../../services/publisher-content.service';
import { ToastrService } from 'ngx-toastr';
import { switchMap } from 'rxjs';
import { Select } from 'primeng/select';
import { PublisherStateService } from '../../services/publisher-state.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';

@Component({
  selector: 'app-publisher-my-content',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PublisherHeaderComponent, Select, TranslatePipe],
  templateUrl: './publisher-my-content.html',
  styleUrl: './publisher-my-content.css'
})
export class PublisherMyContentComponent implements OnInit, OnDestroy {
  private readonly translation = inject(TranslationService);
  private readonly typeTranslationKeys: Record<string, string> = {
    beach: 'beach',
    church: 'church',
    hotel: 'hotel',
    museum: 'museum',
    restaurant: 'restaurant',
    viewpoint: 'viewpoint',
    'view point': 'viewpoint',
    hiking: 'hiking',
    fishing: 'fishing',
    cycling: 'cycling',
    swimming: 'swimming',
    kayaking: 'kayaking',
    concert: 'concert',
    festival: 'festival',
    exhibition: 'exhibition',
    sports: 'sports',
  };

  contentItems = signal<PublisherContentItem[]>([]);
  publisherContentType = signal<PublisherContentType>('Object');
  isLoading = signal(true);
  isLoadingMore = signal(false);
  typeOptions = signal<ReferenceOption[]>([]);
  errorMessage = signal('');
  hasMore = signal(true);

  searchTerm = signal('');
  showDeleteModal = signal(false);
  itemToDelete = signal<PublisherContentItem | null>(null);
  statusFilter = signal('all');
  typeFilter = signal('all');
  sortFilter = signal('date-desc');

  statusOptions = computed(() => {
    this.translation.currentLanguage();
    return [
      { label: this.translation.translate('publisher.myContent.allStatuses'), value: 'all' },
      { label: this.translation.translate('publisher.myContent.statuses.approved'), value: 'Approved' },
      { label: this.translation.translate('publisher.myContent.statuses.pending'), value: 'Pending' },
      { label: this.translation.translate('publisher.myContent.statuses.rejected'), value: 'Rejected' },
    ];
  });

  sortOptions = computed(() => {
    this.translation.currentLanguage();
    return [
      { label: this.translation.translate('sort.dateNewest'), value: 'date-desc' },
      { label: this.translation.translate('sort.dateOldest'), value: 'date-asc' },
      { label: this.translation.translate('publisher.myContent.sortNameAsc'), value: 'name-asc' },
      { label: this.translation.translate('publisher.myContent.sortNameDesc'), value: 'name-desc' },
    ];
  });

  typeSelectOptions = computed(() => {
    this.translation.currentLanguage();
    return [
      { label: this.translation.translate('publisher.myContent.allTypes'), value: 'all' },
      ...this.typeOptions().map(t => ({ label: this.typeNameLabel(t.name), value: String(t.id) }))
    ];
  });

  filteredItems = computed(() => {
    let items = [...this.contentItems()];
    if (this.typeFilter() !== 'all') {
      items = items.filter(i => {
        const typeId = i.objectTypeId ?? i.activityTypeId ?? i.eventTypeId;
        return String(typeId) === this.typeFilter();
      });
    }
    return items;
  });

  private currentPage = 1;
  private readonly pageSize = 10;
  private isDestroyed = false;
  private filtersInitialized = false;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private publisherContentService: PublisherContentService,
    private toastr: ToastrService,
    private stateService: PublisherStateService
  ) {
    // Čuva filtere u URL i state
    effect(() => {
      const params: Record<string, string> = {};
      if (this.searchTerm()) params['search'] = this.searchTerm();
      if (this.statusFilter() !== 'all') params['status'] = this.statusFilter();
      if (this.typeFilter() !== 'all') params['type'] = this.typeFilter();
      if (this.sortFilter() !== 'date-desc') params['sort'] = this.sortFilter();
      this.stateService.myContentParams.set(params);
      this.router.navigate([], { queryParams: params, replaceUrl: true });
    });

    // Reload kad se filter promeni, ali ne pri inicijalizaciji
    effect(() => {
      this.searchTerm();
      this.statusFilter();
      this.sortFilter();
      if (!this.filtersInitialized) return;
      this.loadFirstPage();
    });
  }

  ngOnInit(): void {
    const saved = this.stateService.myContentParams();
    if (Object.keys(saved).length) {
      this.searchTerm.set(saved['search'] ?? '');
      this.statusFilter.set(saved['status'] ?? 'all');
      this.typeFilter.set(saved['type'] ?? 'all');
      this.sortFilter.set(saved['sort'] ?? 'date-desc');
    } else {
      const params = this.route.snapshot.queryParamMap;
      this.searchTerm.set(params.get('search') ?? '');
      this.statusFilter.set(params.get('status') ?? 'all');
      this.typeFilter.set(params.get('type') ?? 'all');
      this.sortFilter.set(params.get('sort') ?? 'date-desc');
    }
    this.filtersInitialized = true;
    this.loadFirstPage();
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
  }

  @HostListener('window:scroll')
  onScroll(): void {
    if (this.isLoadingMore() || !this.hasMore() || this.isLoading()) return;
    const scrollPosition = window.innerHeight + window.scrollY;
    const threshold = document.body.offsetHeight - 200;
    if (scrollPosition >= threshold) {
      this.loadNextPage();
    }
  }

  loadMore(): void {
    this.loadNextPage();
  }

  applyFilters(): void {}

  private getActiveFilters() {
    return {
      search: this.searchTerm() || undefined,
      statusName: this.statusFilter() !== 'all' ? this.statusFilter() : undefined,
      sort: this.mapSort(this.sortFilter()),
    };
  }

  private mapSort(sortFilter: string): string | undefined {
    switch (sortFilter) {
      case 'date-desc': return 'dateNewest';
      case 'date-asc':  return 'dateOldest';
      case 'name-asc':  return 'nameAsc';
      case 'name-desc': return 'nameDesc';
      default: return undefined;
    }
  }

  private loadFirstPage(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.currentPage = 1;
    this.hasMore.set(true);

    this.publisherContentService.getCurrentPublisherContentType().pipe(
      switchMap(contentType => {
        this.publisherContentType.set(contentType);
        this.loadTypeOptions(contentType);
        return this.publisherContentService.getContentItems(1, this.pageSize, this.getActiveFilters());
      })
    ).subscribe({
      next: (items) => {
        this.contentItems.set(items);
        this.hasMore.set(items.length >= this.pageSize);
        this.isLoading.set(false);
      },
      error: () => {
        this.contentItems.set([]);
        this.errorMessage.set(this.translation.translate('publisher.myContent.loadError'));
        this.isLoading.set(false);
      }
    });
  }

  private loadTypeOptions(contentType: PublisherContentType): void {
    const obs = contentType === 'Object'
      ? this.publisherContentService.getObjectTypes()
      : contentType === 'Activity'
      ? this.publisherContentService.getActivityTypes()
      : this.publisherContentService.getEventTypes();

    obs.subscribe({
      next: (types) => this.typeOptions.set(types),
      error: () => this.typeOptions.set([])
    });
  }

  private loadNextPage(): void {
    this.isLoadingMore.set(true);
    this.currentPage++;

    this.publisherContentService.getContentItems(this.currentPage, this.pageSize, this.getActiveFilters()).subscribe({
      next: (items) => {
        if (this.isDestroyed) return;
        this.contentItems.update(existing => [...existing, ...items]);
        this.hasMore.set(items.length >= this.pageSize);
        this.isLoadingMore.set(false);
      },
      error: () => {
        if (this.isDestroyed) return;
        this.currentPage--;
        this.isLoadingMore.set(false);
      }
    });
  }

  onView(item: PublisherContentItem): void {
    this.stateService.detailsFrom.set('my-content');
    this.router.navigate(['/publisher-content-details', item.id]);
  }

  onEdit(item: PublisherContentItem): void {
    this.router.navigate(['/publisher-edit-content', item.id]);
  }

  onDelete(item: PublisherContentItem): void {
    this.itemToDelete.set(item);
    this.showDeleteModal.set(true);
  }

  confirmDelete(): void {
    const item = this.itemToDelete();
    if (!item) return;
    this.publisherContentService.deleteContentItem(item.id).subscribe({
      next: () => {
        this.toastr.success(this.translation.translate('publisher.myContent.deleteSuccess'));
        this.loadFirstPage();
        this.closeDeleteModal();
      },
      error: () => {
        this.toastr.error(this.translation.translate('publisher.myContent.deleteError'));
        this.closeDeleteModal();
      }
    });
  }

  closeDeleteModal(): void {
    this.showDeleteModal.set(false);
    this.itemToDelete.set(null);
  }

  onShowOnMap(item: PublisherContentItem): void {
    if (!item.latitude || !item.longitude) {
      this.toastr.warning(this.translation.translate('publisher.myContent.noLocationWarning'));
      return;
    }
    this.router.navigate(['/publisher-map'], {
      queryParams: {
        contentId: item.id,
        lat: item.latitude,
        lng: item.longitude,
        destinationId: item.destinationId ?? ''
      }
    });
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'Draft': return 'status-draft';
      case 'Pending Approval': return 'status-pending';
      case 'Pending': return 'status-pending';
      case 'Approved': return 'status-approved';
      case 'Rejected': return 'status-rejected';
      default: return '';
    }
  }

  statusLabel(status: string): string {
    const normalized = status.trim().toLowerCase();
    const keyByStatus: Record<string, string> = {
      draft: 'publisher.myContent.statuses.draft',
      pending: 'publisher.myContent.statuses.pending',
      'pending approval': 'publisher.myContent.statuses.pending',
      approved: 'publisher.myContent.statuses.approved',
      rejected: 'publisher.myContent.statuses.rejected',
    };

    return this.translateWithFallback(keyByStatus[normalized] ?? '', status);
  }

  contentTypeLabel(plural = false): string {
    const keyByType: Record<PublisherContentType, string> = {
      Object: plural ? 'publisher.myContent.contentTypes.objects' : 'publisher.myContent.contentTypes.object',
      Activity: plural ? 'publisher.myContent.contentTypes.activities' : 'publisher.myContent.contentTypes.activity',
      Event: plural ? 'publisher.myContent.contentTypes.events' : 'publisher.myContent.contentTypes.event',
    };

    return this.translation.translate(keyByType[this.publisherContentType()]);
  }

  formatDate(dateStr: string): string {
    const locale = this.translation.currentLanguage() === 'sr' ? 'sr-RS' : 'en-US';
    return new Date(dateStr).toLocaleDateString(locale, {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  }

  getTypeName(item: PublisherContentItem): string {
    const typeId = item.objectTypeId ?? item.activityTypeId ?? item.eventTypeId;
    const found = this.typeOptions().find(t => t.id === typeId);
    return found?.name ? this.typeNameLabel(found.name) : '-';
  }

  typeNameLabel(name: string): string {
    const normalized = name.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    const typeKey = this.typeTranslationKeys[normalized] ?? normalized.replace(/\s+/g, '');
    return this.translateWithFallback(`publisher.map.subtypes.${typeKey}`, name);
  }

  private translateWithFallback(key: string, fallback: string): string {
    if (!key) return fallback;
    this.translation.currentLanguage();
    const translated = this.translation.translate(key);
    return translated === key ? fallback : translated;
  }

  resetFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set('all');
    this.typeFilter.set('all');
    this.sortFilter.set('date-desc');
  }
}
