import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { buildApiUrl } from '../../../../core/config/api';

export interface DestinationItem {
  id: number;
  destinationTypeId: number;
  destinationTypeName: string;
  name: string;
  country: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DestinationRequestDto {
  destinationTypeId: number;
  name: string;
  country: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
}

export interface DestinationTypeItem {
  id: number;
  name: string;
  description: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DestinationTypeRequestDto {
  name: string;
  description: string;
  isActive: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class DestinationsService {
  private readonly apiUrl = buildApiUrl('destinations');
  private readonly destinationTypesUrl = buildApiUrl('destination-types');

  constructor(private http: HttpClient) {}

  getDestinationsPage(page: number, pageSize: number): Observable<DestinationItem[]> {
    return this.http.get<DestinationItem[]>(`${this.apiUrl}?page=${page}&pageSize=${pageSize}`);
  }

  getAllDestinations(pageSize = 50): Observable<DestinationItem[]> {
    return this.http.get<DestinationItem[]>(`${this.apiUrl}?page=1&pageSize=${pageSize}`);
  }

  getDestinationTypes(): Observable<DestinationTypeItem[]> {
    return this.http.get<DestinationTypeItem[]>(this.destinationTypesUrl);
  }

  createDestination(payload: DestinationRequestDto): Observable<DestinationItem> {
    return this.http.post<{ destination: DestinationItem }>(this.apiUrl, {
      destination: payload,
      admin: null
    }).pipe(
      map((response) => response.destination)
    );
  }

  createDestinationType(payload: DestinationTypeRequestDto): Observable<DestinationTypeItem> {
    return this.http.post<DestinationTypeItem>(this.destinationTypesUrl, payload);
  }

  updateDestination(id: number, payload: DestinationRequestDto): Observable<DestinationItem> {
    return this.http.put<DestinationItem>(`${this.apiUrl}/${id}`, payload);
  }

  getDestinationById(id: number): Observable<DestinationItem> {
    return this.http.get<DestinationItem>(`${this.apiUrl}/${id}`);
  }

  deleteDestination(id: number): Observable<void> {
    return this.http.delete<void>(buildApiUrl(`destinations/${id}`));
  }

  updateDestinationType(id: number, payload: DestinationTypeRequestDto): Observable<DestinationTypeItem> {
    return this.http.put<DestinationTypeItem>(`${this.destinationTypesUrl}/${id}`, payload);
  }

  deleteDestinationType(id: number): Observable<void> {
    return this.http.delete<void>(`${this.destinationTypesUrl}/${id}`);
  }
}
