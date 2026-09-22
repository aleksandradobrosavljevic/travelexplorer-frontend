import { Component, inject, signal, OnInit } from '@angular/core';
import { NgIf, NgFor, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { AdminDestinationUsersService, PublisherListItem } from './users.service';

@Component({
  selector: 'app-admin-destination-users',
  standalone: true,
  imports: [NgIf, NgFor, DatePipe],
  templateUrl: './users.html',
  styleUrl: './users.css'
})
export class AdminDestinationUsersComponent implements OnInit {
  private readonly usersService = inject(AdminDestinationUsersService);
  private readonly router = inject(Router);
  private readonly toastr = inject(ToastrService);

  readonly publishers = signal<PublisherListItem[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.loadPublishers();
  }

  loadPublishers(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.usersService.getPublishers().subscribe({
      next: (data) => { this.publishers.set(data); this.isLoading.set(false); },
      error: () => { this.errorMessage.set('Publishers could not be loaded.'); this.isLoading.set(false); }
    });
  }

  goToPublisher(item: PublisherListItem): void {
    this.router.navigate(['/admin-destination/users', item.userId], {
      state: { publisher: item }
    });
  }

  trackById(_: number, item: PublisherListItem): number {
    return item.userId;
  }
}