import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { EMPTY, Observable, expand, forkJoin, map, reduce } from 'rxjs';
import { buildApiUrl } from '../../../../core/config/api';

export interface DestinationAdminItem {
  id: number;
  userId: number;
  destinationId: number;
  fullName: string;
  email: string;
  assignedDestination: string;
  phone: string;
  status: 'Active' | 'Inactive';
  role: 'Destination Admin';
}

export interface UserLookupResult {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

@Injectable({
  providedIn: 'root'
})
export class DestinationAdminsService {
  constructor(private readonly http: HttpClient) {}

  getDestinationAdmins(): Observable<DestinationAdminItem[]> {
    return forkJoin({
      admins: this.http.get<any[]>(buildApiUrl('admins')),
      users: this.getAllUsers(),
    }).pipe(
      map(({ admins, users }) => {
        const usersById = new Map((users ?? []).map((user) => [user.id, user]));

        return (admins ?? []).map((admin) => {
          const user = usersById.get(admin.userId);
          return {
            id: admin.id,
            userId: admin.userId,
            destinationId: admin.destinationId,
            fullName: `${admin.firstName ?? ''} ${admin.lastName ?? ''}`.trim(),
            email: user?.email ?? '',
            assignedDestination: admin.destinationName ?? '',
            phone: '-',
            status: user?.isActive ? 'Active' : 'Inactive',
            role: 'Destination Admin' as const
          };
        });
      })
    );
  }

  getAvailableDestinations(): Observable<string[]> {
    return this.getAllDestinations().pipe(
      map((destinations) => (destinations ?? []).map((item) => item.name))
    );
  }

  updateDestinationAdmin(admin: DestinationAdminItem, firstName: string, lastName: string, destinationId: number): Observable<any> {
    return this.http.put(buildApiUrl(`admins/${admin.id}`), {
      userId: admin.userId,
      destinationId,
      firstName,
      lastName
    });
  }

  toggleDestinationAdminStatus(admin: DestinationAdminItem): Observable<any> {
    return this.http.patch(buildApiUrl(`users/${admin.userId}/toggle-status`), {
      reason: `Status changed for destination admin ${admin.fullName}.`
    });
  }

  getDestinationIdByName(name: string): Observable<number | null> {
    return this.getAllDestinations().pipe(
      map((destinations) => {
        const destination = (destinations ?? []).find((item) => item.name === name);
        return destination?.id ?? null;
      })
    );
  }

  deleteDestinationAdmin(id: number): Observable<any> {
    return this.http.delete(buildApiUrl(`admins/${id}`));
  }

  getUserIdByEmail(email: string): Observable<number | null> {
    return this.getAllUsers().pipe(
      map((users) => {
        const user = (users ?? []).find((u) => u.email === email);
        return user?.id ?? null;
      })
    );
  }

  getUserByEmail(email: string): Observable<UserLookupResult | null> {
    return this.http.get<any[]>(buildApiUrl('users?page=1&pageSize=100')).pipe(
      map((users) => {
        const user = (users ?? []).find((u) => u.email === email);
        if (!user) return null;
        return {
          id: user.id,
          firstName: user.firstName ?? '',
          lastName: user.lastName ?? '',
          email: user.email ?? ''
        };
      })
    );
  }

  createDestinationAdmin(userId: number, destinationId: number, firstName: string, lastName: string): Observable<any> {
    return this.http.post(buildApiUrl('admins'), {
      userId,
      destinationId,
      firstName,
      lastName
    });
  }

  private getAllUsers(pageSize = 50): Observable<any[]> {
    return this.getUsersPage(1, pageSize).pipe(
      expand(result => result.rows.length === pageSize
        ? this.getUsersPage(result.page + 1, pageSize)
        : EMPTY
      ),
      reduce((rows, result) => [...rows, ...result.rows], [] as any[])
    );
  }

  private getUsersPage(page: number, pageSize: number): Observable<{ page: number; rows: any[] }> {
    return this.http.get<any>(buildApiUrl(`users?page=${page}&pageSize=${pageSize}`)).pipe(
      map(response => ({
        page,
        rows: Array.isArray(response) ? response : response?.items ?? response?.data ?? []
      }))
    );
  }

  private getAllDestinations(pageSize = 50): Observable<any[]> {
    return this.getDestinationsPage(1, pageSize).pipe(
      expand(result => result.rows.length === pageSize
        ? this.getDestinationsPage(result.page + 1, pageSize)
        : EMPTY
      ),
      reduce((rows, result) => [...rows, ...result.rows], [] as any[])
    );
  }

  private getDestinationsPage(page: number, pageSize: number): Observable<{ page: number; rows: any[] }> {
    return this.http.get<any>(buildApiUrl(`destinations?page=${page}&pageSize=${pageSize}`)).pipe(
      map(response => ({
        page,
        rows: Array.isArray(response) ? response : response?.items ?? response?.data ?? []
      }))
    );
  }
}
