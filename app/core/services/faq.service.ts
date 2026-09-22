import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { buildApiUrl } from '../config/api';

export interface FaqEntry {
  id: number;
  category: string;
  question: string;
  answerHtml: string;
}

export interface SupportRequest {
  name: string;
  email: string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class FaqService {
  private readonly apiUrl = buildApiUrl('faqs');

  constructor(private readonly http: HttpClient) {}

  getFaqs(options?: { search?: string; category?: string }): Observable<FaqEntry[]> {
    const headers = new HttpHeaders({
      'Accept-Language': this.getSelectedLanguage(),
    });
    let params = new HttpParams();
    const search = options?.search?.trim();
    const category = options?.category?.trim();

    if (search) {
      params = params.set('search', search);
    }

    if (category && category !== 'All') {
      params = params.set('category', category);
    }

    return this.http
      .get<FaqEntry[]>(this.apiUrl, { headers, params })
      .pipe(
        map((entries) => entries ?? []),
        catchError(() => of([]))
      );
  }

  sendSupportRequest(request: SupportRequest): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/contact-support`, request);
  }

  private getSelectedLanguage(): string {
    const selectedLanguage = localStorage.getItem('selectedLanguage');
    if (selectedLanguage) {
      return selectedLanguage;
    }

    return 'en-US';
  }
}
