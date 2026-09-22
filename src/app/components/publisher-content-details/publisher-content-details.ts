import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { PublisherHeaderComponent } from '../publisher-header/publisher-header';
import { PublisherContentItem, PublisherContentService } from '../../services/publisher-content.service';
import { buildApiUrl } from '../../core/config/api';
import { PublisherStateService } from '../../services/publisher-state.service';

interface ReviewItem {
  id: number;
  touristFirstName: string;
  touristLastName: string;
  rating: number;
  comment?: string | null;
  createdAt: string;
}

@Component({
  selector: 'app-publisher-content-details',
  standalone: true,
  imports: [CommonModule, PublisherHeaderComponent],
  templateUrl: './publisher-content-details.html',
  styleUrl: './publisher-content-details.css'
})
export class PublisherContentDetailsComponent implements OnInit, OnDestroy {
  contentId: number | null = null;
  item = signal<PublisherContentItem | undefined>(undefined);
  reviews = signal<ReviewItem[]>([]);
  isLoading = signal(true);
  currentImageIndex = signal(0);
  private slideshowTimer: ReturnType<typeof setInterval> | null = null;
  private fromRoute: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private publisherContentService: PublisherContentService,
    private http: HttpClient,
    private sanitizer: DomSanitizer,
    private stateService: PublisherStateService
  ) {}

  ngOnInit(): void {
    this.fromRoute = this.stateService.detailsFrom();
    this.stateService.detailsFrom.set(null);
    const idParam = this.route.snapshot.paramMap.get('id');
    this.contentId = idParam ? +idParam : null;

    if (this.contentId !== null) {
      this.publisherContentService.getContentItemById(this.contentId).subscribe({
        next: (item) => {
          this.item.set(item);
          this.isLoading.set(false);
          this.loadReviews(item);
          this.startTimer();
        },
        error: () => {
          this.item.set(undefined);
          this.isLoading.set(false);
        }
      });
    } else {
      this.isLoading.set(false);
    }
  }

  ngOnDestroy(): void {
    if (this.slideshowTimer) clearInterval(this.slideshowTimer);
  }

  private loadReviews(item: PublisherContentItem): void {
    this.http.get<{ reviews?: ReviewItem[] }>(
      buildApiUrl(`review/target/${item.type}/${item.id}?page=1&pageSize=3`)
    ).subscribe({
      next: (response) => this.reviews.set(response.reviews ?? []),
      error: () => this.reviews.set([])
    });
  }

  goBack(): void {
    if (this.fromRoute === 'map') {
      this.router.navigate(['/publisher-map']);
    } else {
      this.router.navigate(['/publisher-my-content']);
    }
  }

  goToEdit(): void {
    const item = this.item();
    if (item) {
      this.stateService.detailsFrom.set('details');
      this.stateService.detailsId.set(item.id);
      this.router.navigate(['/publisher-edit-content', item.id]);
    }
  }

  goToReviews(): void {
    const item = this.item();
    if (item) {
      this.stateService.reviewsFocus.set({ contentId: item.id, openReviews: true });
      this.router.navigate(['/publisher-reviews'], {
        queryParams: { contentId: item.id, type: item.type, openReviews: true, returnToContent: true }
      });
    }
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'Draft': return 'status-draft';
      case 'Pending Approval': return 'status-pending';
      case 'Approved': return 'status-approved';
      case 'Rejected': return 'status-rejected';
      default: return '';
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'Approved': return '✓';
      case 'Rejected': return '✕';
      case 'Pending Approval': return '⏳';
      default: return '○';
    }
  }

  getTypeIconSvg(type: string): SafeHtml {
    let svg = '';
    switch (type) {
      case 'Object':
        svg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="9" width="18" height="12" rx="1"/>
          <path d="M9 21V9"/>
          <path d="M15 21V9"/>
          <path d="M1 9l11-6 11 6"/>
        </svg>`;
        break;
      case 'Activity':
        svg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="5" r="2"/>
          <path d="M12 7v6l3 3"/>
          <path d="M9 13l-3 3"/>
          <path d="M7 10H4"/>
          <path d="M20 10h-3"/>
        </svg>`;
        break;
      case 'Event':
        svg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>`;
        break;
      default:
        svg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>`;
    }
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  }

  getAverageRating(): number {
    const revs = this.reviews();
    if (!revs.length) return 0;
    return revs.reduce((sum, r) => sum + r.rating, 0) / revs.length;
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  }

  formatDateTime(dateStr: string): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  }

  showOnMap(): void {
    const item = this.item();
    if (!item) return;
    this.router.navigate(['/publisher-map'], {
      queryParams: {
        contentId: item.id,
        lat: item.latitude,
        lng: item.longitude,
        destinationId: item.destinationId ?? ''
      }
    });
  }

  getImages(): string[] {
    const item = this.item();
    if (!item) return [];
    return item.imageUrls?.length ? item.imageUrls : item.imageUrl ? [item.imageUrl] : [];
  }

  nextImage(): void {
    const images = this.getImages();
    if (images.length <= 1) return;
    this.currentImageIndex.update(i => (i + 1) % images.length);
    this.resetTimer();
  }

  prevImage(): void {
    const images = this.getImages();
    if (images.length <= 1) return;
    this.currentImageIndex.update(i => (i - 1 + images.length) % images.length);
    this.resetTimer();
  }

  goToImage(index: number): void {
    this.currentImageIndex.set(index);
    this.resetTimer();
  }

  private startTimer(): void {
    this.slideshowTimer = setInterval(() => {
      const images = this.getImages();
      if (images.length > 1) {
        this.currentImageIndex.update(i => (i + 1) % images.length);
      }
    }, 4000);
  }

  private resetTimer(): void {
    if (this.slideshowTimer) clearInterval(this.slideshowTimer);
    this.startTimer();
  }
}
