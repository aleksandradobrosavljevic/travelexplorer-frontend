import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../environments/environment';

export interface PublisherListItem {
  userId: number;
  email: string;
  isActive: boolean;
  organizationName?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  website?: string | null;
  publisherTypeName?: string | null;
  joinedAt: string;
}

@Injectable({ providedIn: 'root' })
export class AdminDestinationUsersService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  getPublishers(): Observable<PublisherListItem[]> {
    return this.http.get<PublisherListItem[]>(`${this.apiUrl}/users/publishers`);
  }
}