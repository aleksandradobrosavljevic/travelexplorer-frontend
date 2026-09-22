import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NgIf, NgFor, NgClass, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ToastrService } from 'ngx-toastr';
import { environment } from '../../../../../environments/environment';
import { PublisherListItem } from '../users/users.service';
import { FormsModule } from '@angular/forms';
import { Auth } from '../../../../core/services/auth';
import { SelectModule } from 'primeng/select';

interface UserContentResponse {
  publisherId: number;
  publisherType: string;
  objects?: any[];
  activities?: any[];
  events?: any[];
}

@Component({
  selector: 'app-admin-destination-user-detail',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, DatePipe, FormsModule, SelectModule],
  templateUrl: './user-detail.html',
  styleUrl: './user-detail.css'
})
export class AdminDestinationUserDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly toastr = inject(ToastrService);
  private readonly apiUrl = environment.apiUrl;;

  readonly isToggling = signal(false);

  readonly publisher = signal<PublisherListItem | null>(null);
  readonly content = signal<UserContentResponse | null>(null);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly searchTerm = signal('');
  readonly statusFilter = signal('all');
  readonly sortFilter = signal('date-desc');

  readonly statusOptions = [
    { label: 'All statuses', value: 'all' },
    { label: 'Approved', value: 'Approved' },
    { label: 'Pending', value: 'Pending' },
    { label: 'Rejected', value: 'Rejected' }
  ];

  readonly sortOptions = [
    { label: 'Newest first', value: 'date-desc' },
    { label: 'Oldest first', value: 'date-asc' },
    { label: 'Name A–Z', value: 'name-asc' },
    { label: 'Name Z–A', value: 'name-desc' }
  ];

  readonly items = computed(() => {
    const c = this.content();
    if (!c) return [];
    return c.objects ?? c.activities ?? c.events ?? [];
  });

readonly filteredItems = computed(() => {
  let items = [...this.items()];

  if (this.searchTerm().trim()) {
    const q = this.searchTerm().trim().toLowerCase();
    items = items.filter(i => i.name?.toLowerCase().includes(q));
  }

  if (this.statusFilter() !== 'all') {
    items = items.filter(i => i.statusName === this.statusFilter());
  }

  switch (this.sortFilter()) {
    case 'date-asc':
      items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      break;
    case 'date-desc':
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      break;
    case 'name-asc':
      items.sort((a, b) => a.name?.localeCompare(b.name));
      break;
    case 'name-desc':
      items.sort((a, b) => b.name?.localeCompare(a.name));
      break;
  }

  return items;
});

  readonly contentType = computed(() => this.content()?.publisherType ?? '');

  private readonly auth = inject(Auth);
  readonly adminDestinationId = this.resolveAdminDestinationId(this.auth.getCurrentUser() as any);

  ngOnInit(): void {
    const userId = Number(this.route.snapshot.paramMap.get('id'));
    const state = history.state as { publisher?: PublisherListItem };
    if (state?.publisher) this.publisher.set(state.publisher);
    this.loadContent(userId);
  }

  private loadContent(userId: number): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.http.get<UserContentResponse>(`${this.apiUrl}/users/${userId}/content`).subscribe({
      next: (data) => { this.content.set(data); this.isLoading.set(false); },
      error: () => { this.errorMessage.set('Publisher content could not be loaded.'); this.isLoading.set(false); }
    });
  }

  goBack(): void {
    this.router.navigate(['/admin-destination/users']);
  }

  statusClass(status: string): string {
    switch (status?.toLowerCase()) {
      case 'approved': return 'approved';
      case 'pending': return 'pending';
      case 'rejected': return 'rejected';
      default: return '';
    }
  }
  
  toggleActive(): void {
    const pub = this.publisher();
    if (!pub) return;
  
    const userId = Number(this.route.snapshot.paramMap.get('id'));
    const isCurrentlyActive = pub.isActive;
    const reason = isCurrentlyActive ? 'Deactivated by destination admin' : 'Activated by destination admin';
  
    this.isToggling.set(true);
    this.http.patch(`${this.apiUrl}/users/${userId}/toggle-status`, { reason }).subscribe({
      next: () => {
        this.publisher.set({ ...pub, isActive: !isCurrentlyActive });
        this.toastr.success(isCurrentlyActive ? 'Publisher deactivated.' : 'Publisher activated.');
        this.isToggling.set(false);
      },
      error: () => {
        this.toastr.error('Failed to change status.');
        this.isToggling.set(false);
      }
    });
  }

  navigateToItem(item: any): void {
    const type = this.content()?.publisherType?.toLowerCase();
    this.router.navigate(['/admin-destination/content', type, item.id], {
      state: { returnUrl: this.router.url }
    });
  }

  private resolveAdminDestinationId(user: any): number | null {
    return user?.destinationId
      ?? user?.DestinationId
      ?? user?.adminProfile?.destinationId
      ?? user?.AdminProfile?.DestinationId
      ?? null;
  }
}