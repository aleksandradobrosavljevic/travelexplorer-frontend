import { Injectable } from '@angular/core';
import { FALLBACK_IMAGE_URL } from '../core/config/api';

export interface CardItem {
  id: number;
  image: string;
  title: string;
  location: string;
  rating: number;
  price: string;
  isFavorite: boolean;
  description: string;
}

export interface MapDataItem {
  id: number;
  name: string;
  category: 'hotel' | 'restaurant' | 'event' | 'activity';
  lat: number;
  lng: number;
  address: string;
  description: string;
  price: number;
  reviewCount: number;
  rating: number;
  image: string;
  isFavorite: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class TouristDataService {
  private featuredDestinations: CardItem[] = [
    {
      id: 1,
      image: FALLBACK_IMAGE_URL,
      title: 'Black Lake',
      location: 'Žabljak, Montenegro',
      rating: 4.9,
      price: 'From €35 / night',
      isFavorite: true,
      description:
        'A peaceful lake surrounded by forest and mountain scenery, perfect for walking, relaxing and taking photos.'
    },
    {
      id: 2,
      image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee',
      title: 'Durmitor Viewpoint',
      location: 'Durmitor National Park',
      rating: 4.8,
      price: 'From €20 / activity',
      isFavorite: false,
      description:
        'A scenic viewpoint with amazing panoramic views of Durmitor, ideal for hikers and nature lovers.'
    },
    {
      id: 3,
      image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e',
      title: 'Mountain Cabin',
      location: 'Žabljak',
      rating: 4.7,
      price: 'From €50 / night',
      isFavorite: false,
      description:
        'A cozy wooden stay in the mountains, great for a quiet weekend getaway in nature.'
    },
    {
      id: 4,
      image: 'https://images.unsplash.com/photo-1519046904884-53103b34b206',
      title: 'Canyon Adventure',
      location: 'Tara Canyon',
      rating: 4.9,
      price: 'From €40 / activity',
      isFavorite: true,
      description:
        'An exciting outdoor experience near Tara Canyon, suitable for travelers looking for adventure.'
    }
  ];

  private nearbyPlaces: CardItem[] = [
    {
      id: 5,
      image: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470',
      title: 'Eco Village',
      location: 'Near Žabljak',
      rating: 4.6,
      price: 'From €28 / night',
      isFavorite: false,
      description:
        'A charming eco stay near Žabljak, offering local atmosphere and a peaceful natural setting.'
    },
    {
      id: 6,
      image: 'https://images.unsplash.com/photo-1493246318656-5bfd4cfb29b8',
      title: 'Forest Walk',
      location: 'Durmitor',
      rating: 4.5,
      price: 'Free',
      isFavorite: false,
      description:
        'A simple and refreshing walk through forest trails, perfect for a calm afternoon outdoors.'
    },
    {
      id: 7,
      image: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429',
      title: 'Local Restaurant',
      location: 'Žabljak Center',
      rating: 4.8,
      price: 'From €15 / meal',
      isFavorite: true,
      description:
        'A popular local place with traditional dishes and a cozy atmosphere in the center of town.'
    },
    {
      id: 8,
      image: 'https://images.unsplash.com/photo-1510798831971-661eb04b3739',
      title: 'Lake Side Apartments',
      location: 'Black Lake Area',
      rating: 4.7,
      price: 'From €42 / night',
      isFavorite: false,
      description:
        'Comfortable apartments near the lake area, ideal for visitors who want easy access to nature.'
    }
  ];

  private recommendedNature: CardItem[] = [
    {
      id: 9,
      image: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470',
      title: 'Hidden Lake Escape',
      location: 'Near Black Lake',
      rating: 4.8,
      price: 'From €30 / night',
      isFavorite: false,
      description:
        'A relaxing stay close to a hidden lake area, tailored for visitors who enjoy calm nature escapes.'
    },
    {
      id: 10,
      image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e',
      title: 'Cozy Mountain Retreat',
      location: 'Žabljak Highlands',
      rating: 4.7,
      price: 'From €52 / night',
      isFavorite: false,
      description:
        'A warm retreat in the highlands with beautiful surroundings and a peaceful mountain feel.'
    },
    {
      id: 11,
      image: FALLBACK_IMAGE_URL,
      title: 'Forest Lake Walk',
      location: 'Durmitor National Park',
      rating: 4.9,
      price: 'Free',
      isFavorite: true,
      description:
        'A scenic walking route through forest and lake landscapes, ideal for slow exploration.'
    },
    {
      id: 12,
      image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee',
      title: 'Sunrise Viewpoint',
      location: 'Curevac',
      rating: 4.8,
      price: 'From €12 / activity',
      isFavorite: false,
      description:
        'A quiet viewpoint known for beautiful sunrise views and a peaceful natural atmosphere.'
    }
  ];

  private recommendedAdventure: CardItem[] = [
    {
      id: 13,
      image: 'https://images.unsplash.com/photo-1519046904884-53103b34b206',
      title: 'Tara Rafting Tour',
      location: 'Tara Canyon',
      rating: 5.0,
      price: 'From €45 / activity',
      isFavorite: true,
      description:
        'An adrenaline-filled rafting experience through the canyon, great for active travelers.'
    },
    {
      id: 14,
      image: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429',
      title: 'Sunset View Hike',
      location: 'Durmitor Trails',
      rating: 4.9,
      price: 'From €18 / activity',
      isFavorite: true,
      description:
        'A guided hike with stunning sunset views, designed for visitors who enjoy movement and scenery.'
    },
    {
      id: 15,
      image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee',
      title: 'Canyon Zipline Ride',
      location: 'Tara Bridge',
      rating: 4.7,
      price: 'From €25 / activity',
      isFavorite: false,
      description:
        'A thrilling zipline ride above the canyon area for those looking for a fast adventure.'
    },
    {
      id: 16,
      image: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470',
      title: 'Peak Challenge Route',
      location: 'Bobotov Kuk',
      rating: 4.8,
      price: 'From €22 / activity',
      isFavorite: false,
      description:
        'A more demanding route for hikers who want challenge, altitude and dramatic mountain views.'
    }
  ];

  private recommendedDefault: CardItem[] = [
    {
      id: 17,
      image: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470',
      title: 'Weekend Lake Stay',
      location: 'Black Lake Area',
      rating: 4.8,
      price: 'From €38 / night',
      isFavorite: false,
      description:
        'A balanced recommendation for a short stay near the lake with easy access to attractions.'
    },
    {
      id: 18,
      image: 'https://images.unsplash.com/photo-1519046904884-53103b34b206',
      title: 'Tara Canyon Adventure',
      location: 'Tara Canyon',
      rating: 4.9,
      price: 'From €42 / activity',
      isFavorite: true,
      description:
        'A mixed recommendation combining scenery and activity, good for first-time visitors.'
    },
    {
      id: 19,
      image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e',
      title: 'Mountain Cabin Weekend',
      location: 'Žabljak',
      rating: 4.7,
      price: 'From €50 / night',
      isFavorite: false,
      description:
        'A comfortable mountain weekend option with a classic cabin atmosphere and beautiful surroundings.'
    },
    {
      id: 20,
      image: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429',
      title: 'Local Food Experience',
      location: 'Žabljak Center',
      rating: 4.8,
      price: 'From €16 / meal',
      isFavorite: true,
      description:
        'A recommendation focused on local cuisine and authentic dining in the town center.'
    }
  ];

  private mapItems: MapDataItem[] = [
    {
      id: 101,
      name: 'Grand Vista Resort',
      category: 'hotel',
      lat: 43.1555,
      lng: 19.1226,
      address: '1240 Mountain Pass, Žabljak',
      description:
        'Luxury mountain accommodation with modern rooms, premium amenities and a peaceful atmosphere.',
      price: 250,
      reviewCount: 342,
      rating: 4.8,
      image:
        FALLBACK_IMAGE_URL,
      isFavorite: false
    },
    {
      id: 102,
      name: 'Durmitor Music Festival',
      category: 'event',
      lat: 43.1572,
      lng: 19.1172,
      address: 'Main Square, Žabljak',
      description:
        'Seasonal open-air event with music, local food and a vibrant mountain atmosphere.',
      price: 18,
      reviewCount: 264,
      rating: 4.7,
      image:
        'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?q=80&w=1200&auto=format&fit=crop',
      isFavorite: false
    },
    {
      id: 103,
      name: 'Black Lake Restaurant',
      category: 'restaurant',
      lat: 43.1466,
      lng: 19.0911,
      address: 'Black Lake, Žabljak',
      description:
        'Traditional food, warm ambiance and a beautiful natural setting near the lake.',
      price: 32,
      reviewCount: 185,
      rating: 4.6,
      image:
        'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=1200&auto=format&fit=crop',
      isFavorite: false
    },
    {
      id: 104,
      name: 'Canyon Adventure Tour',
      category: 'activity',
      lat: 43.1492,
      lng: 19.1048,
      address: 'Durmitor Adventure Base',
      description:
        'Outdoor guided experience with canyon routes, hiking and unforgettable views.',
      price: 65,
      reviewCount: 121,
      rating: 4.5,
      image:
        'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1200&auto=format&fit=crop',
      isFavorite: false
    },
    {
      id: 105,
      name: 'Pine Valley Hotel',
      category: 'hotel',
      lat: 43.1601,
      lng: 19.1321,
      address: 'Pine Valley Road, Žabljak',
      description:
        'Comfortable mountain hotel close to town, with cozy rooms and scenic surroundings.',
      price: 210,
      reviewCount: 210,
      rating: 4.4,
      image:
        'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?q=80&w=1200&auto=format&fit=crop',
      isFavorite: false
    }
  ];

  getFeaturedDestinations(): CardItem[] {
    return this.featuredDestinations.map(item => ({ ...item }));
  }

  getNearbyPlaces(): CardItem[] {
    return this.nearbyPlaces.map(item => ({ ...item }));
  }

  getRecommendedForPreference(
    preference: 'nature' | 'adventure' | 'default'
  ): CardItem[] {
    if (preference === 'nature') {
      return this.recommendedNature.map(item => ({ ...item }));
    }

    if (preference === 'adventure') {
      return this.recommendedAdventure.map(item => ({ ...item }));
    }

    return this.recommendedDefault.map(item => ({ ...item }));
  }

  getSectionItems(
    type: string,
    preference: 'nature' | 'adventure' | 'default' = 'default'
  ): CardItem[] {
    if (type === 'recommended') {
      return this.getRecommendedForPreference(preference);
    }

    if (type === 'popular') {
      return this.getFeaturedDestinations();
    }

    if (type === 'nearby') {
      return this.getNearbyPlaces();
    }

    return [];
  }

  getMapItems(): MapDataItem[] {
    return this.mapItems.map(item => ({ ...item }));
  }

  getItemById(itemId: number): CardItem | undefined {
    const dashboardItems = [
      ...this.featuredDestinations,
      ...this.nearbyPlaces,
      ...this.recommendedNature,
      ...this.recommendedAdventure,
      ...this.recommendedDefault
    ];

    const dashboardFound = dashboardItems.find(item => item.id === itemId);
    if (dashboardFound) {
      return { ...dashboardFound };
    }

    const mapFound = this.mapItems.find(item => item.id === itemId);
    if (mapFound) {
      return this.mapItemToCardItem(mapFound);
    }

    return undefined;
  }

  toggleFavorite(itemId: number): void {
    this.featuredDestinations = this.toggleInList(this.featuredDestinations, itemId);
    this.nearbyPlaces = this.toggleInList(this.nearbyPlaces, itemId);
    this.recommendedNature = this.toggleInList(this.recommendedNature, itemId);
    this.recommendedAdventure = this.toggleInList(this.recommendedAdventure, itemId);
    this.recommendedDefault = this.toggleInList(this.recommendedDefault, itemId);
    this.mapItems = this.toggleInMapList(this.mapItems, itemId);
  }

  private toggleInList(items: CardItem[], itemId: number): CardItem[] {
    return items.map(item =>
      item.id === itemId ? { ...item, isFavorite: !item.isFavorite } : item
    );
  }

  private toggleInMapList(items: MapDataItem[], itemId: number): MapDataItem[] {
    return items.map(item =>
      item.id === itemId ? { ...item, isFavorite: !item.isFavorite } : item
    );
  }

  private mapItemToCardItem(item: MapDataItem): CardItem {
  let priceSuffix = '/night';

  if (item.category === 'restaurant') {
    priceSuffix = '/meal';
  } else if (item.category === 'event') {
    priceSuffix = '/ticket';
  } else if (item.category === 'activity') {
    priceSuffix = '/person';
  }

  return {
    id: item.id,
    image: item.image,
    title: item.name,
    location: item.address,
    rating: item.rating,
    price: `$${item.price}${priceSuffix}`,
    isFavorite: item.isFavorite,
    description: item.description
  };
}
}
