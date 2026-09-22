export interface FavouriteItem {
  id: number;
  entityId?: number | null;
  entityType?: string | null;
  destinationId?: number | null;
  destinationName?: string | null;
  destinationCountry?: string | null;
  title: string;
  location: string;
  imageUrl: string;
  price: number | null;
  currency?: string | null;
  averageRating: number | null;
  reviewCount: number | null;
  createdAt?: string | null;
}
