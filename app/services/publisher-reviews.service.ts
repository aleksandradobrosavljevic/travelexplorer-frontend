import { Injectable } from '@angular/core';
import { EMPTY, expand, map, Observable, reduce, throwError } from 'rxjs';
import { PublisherContentType } from './publisher-content.service';
import { HttpClient } from '@angular/common/http';
import { buildApiUrl } from '../core/config/api';

export interface PublisherReviewItem {
  id: number;
  contentId: number;
  contentTitle: string;
  contentType: PublisherContentType;
  touristName: string;
  rating: number;
  comment: string;
  date: string;
  reply?: string;
}

export interface PublisherReviewSummaryItem {
  contentId: number;
  contentTitle: string;
  contentType: PublisherContentType;
  status?: string | null;
  destinationName?: string | null;
  reviewCount: number;
  averageRating: number;
}

export interface PublisherReviewSummaryPage {
  items: PublisherReviewSummaryItem[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

@Injectable({
  providedIn: 'root'
})
export class PublisherReviewsService {
  constructor(
    private readonly http: HttpClient
  ) {}

  getReviewSummaries(
    page = 1,
    pageSize = 8,
    filters: { search?: string; sort?: string; contentId?: number | null } = {}
  ): Observable<PublisherReviewSummaryPage> {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize)
    });

    if (filters.search?.trim()) {
      params.set('search', filters.search.trim());
    }

    if (filters.sort) {
      params.set('sort', filters.sort);
    }

    if (filters.contentId) {
      params.set('contentId', String(filters.contentId));
    }

    return this.http.get<{
      items?: any[];
      totalItems?: number;
      page?: number;
      pageSize?: number;
      totalPages?: number;
    }>(buildApiUrl(`review/publisher/summary?${params.toString()}`)).pipe(
      map(response => ({
        items: (response.items ?? []).map(item => this.mapSummary(item)),
        totalItems: Number(response.totalItems ?? 0),
        page: Number(response.page ?? page),
        pageSize: Number(response.pageSize ?? pageSize),
        totalPages: Math.max(1, Number(response.totalPages ?? 1))
      }))
    );
  }

  getReviewsForContent(
    contentType: PublisherContentType,
    contentId: number,
    pageSize = 100
  ): Observable<PublisherReviewItem[]> {
    return this.getContentReviewsPage(contentType, contentId, 1, pageSize).pipe(
      expand(page => page.page < page.totalPages
        ? this.getContentReviewsPage(contentType, contentId, page.page + 1, pageSize)
        : EMPTY
      ),
      reduce((items, page) => [...items, ...page.reviews], [] as PublisherReviewItem[])
    );
  }

  saveReply(): Observable<never> {
    return throwError(() => new Error('Backend trenutno nema endpoint za reply na review.'));
  }

  private getContentReviewsPage(
    contentType: PublisherContentType,
    contentId: number,
    page: number,
    pageSize: number
  ): Observable<{
    page: number;
    totalPages: number;
    reviews: PublisherReviewItem[];
  }> {
    return this.http.get<{ reviews: any[]; totalPages?: number; totalReviews?: number }>(
      buildApiUrl(`review/target/${contentType}/${contentId}?page=${page}&pageSize=${pageSize}&sort=dateNewest`)
    ).pipe(
      map(response => {
        const reviews = (response.reviews ?? []).map(review => this.mapReview(review));
        const totalPages = Number(response.totalPages)
          || Math.max(1, Math.ceil(Number(response.totalReviews ?? reviews.length) / pageSize));

        return { page, totalPages, reviews };
      })
    );
  }

  private mapSummary(item: any): PublisherReviewSummaryItem {
    return {
      contentId: item.contentId,
      contentTitle: item.contentTitle ?? '',
      contentType: (item.contentType as PublisherContentType) ?? 'Object',
      status: item.status ?? null,
      destinationName: item.destinationName ?? null,
      reviewCount: Number(item.reviewCount ?? 0),
      averageRating: Number(item.averageRating ?? 0)
    };
  }

  private mapReview(review: any): PublisherReviewItem {
    return {
      id: review.id,
      contentId: review.objectId ?? review.activityId ?? review.eventId,
      contentTitle: review.contentName ?? '',
      contentType: (review.contentType as PublisherContentType) ?? 'Object',
      touristName: `${review.touristFirstName} ${review.touristLastName}`.trim(),
      rating: review.rating,
      comment: review.comment ?? '',
      date: review.createdAt,
      reply: ''
    };
  }
}
