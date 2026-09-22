import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, Observable, expand, map, reduce } from 'rxjs';
import { buildApiUrl } from '../../../../core/config/api';

export interface UserItem {
  id: number;
  email: string;
  role: string;
  isActive: boolean;
  firstName?: string | null;
  lastName?: string | null;
  organizationName?: string | null;
}

export interface ToggleUserStatusRequest {
  reason: string;
}

@Injectable({
  providedIn: 'root'
})
export class UsersService {
  constructor(private http: HttpClient) {}

  getUsers(): Observable<UserItem[]> {
    return this.getUsersPage(1, 50).pipe(
      expand(result => result.rows.length === 50 ? this.getUsersPage(result.page + 1, 50) : EMPTY),
      reduce((rows, result) => [...rows, ...result.rows], [] as UserItem[])
    );
  }

  toggleUserStatus(userId: number, request: ToggleUserStatusRequest): Observable<UserItem> {
    return this.http.patch<UserItem>(buildApiUrl(`users/${userId}/toggle-status`), request);
  }

  private getUsersPage(page: number, pageSize: number): Observable<{ page: number; rows: UserItem[] }> {
    return this.http.get<any>(buildApiUrl(`users?page=${page}&pageSize=${pageSize}`)).pipe(
      map(response => ({
        page,
        rows: Array.isArray(response) ? response : response?.items ?? response?.data ?? []
      }))
    );
  }
}
