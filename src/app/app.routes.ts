import { Routes } from '@angular/router';
import { Login } from './components/login/login';
import { Register } from './components/register/register';
import { TouristDashboardComponent } from './components/tourist-dashboard/tourist-dashboard';
import { authGuard } from './core/guards/auth-guard';
import { roleGuard } from './core/guards/role-guard';
import { roleHomeGuard } from './core/guards/role-home-guard';
import { SectionPageComponent } from './components/section-page/section-page';
import { DetailsPageComponent } from './components/details-page/details-page';
import { ReviewsPageComponent } from './components/reviews-page/reviews-page';
import { MapsPageComponent } from './components/maps-page/maps-page';
import { FavouritesPageComponent } from './components/favourites-page/favourites-page';
import { FavouriteDestinationPageComponent } from './components/favourite-destination-page/favourite-destination-page';
import { VerifyEmail } from './components/verify-email/verify-email';
import { AdminDestinationLayoutComponent } from './components/admin-destination/layout/admin-destination-layout/admin-destination-layout';
import { AdminDestinationDashboardComponent } from './components/admin-destination/pages/dashboard/dashboard';
import { AdminDestinationContentComponent } from './components/admin-destination/pages/content/content';
import { AdminDestinationRequestsComponent } from './components/admin-destination/pages/requests/requests';
import { AdminDestinationReviewsComponent } from './components/admin-destination/pages/reviews/reviews';
import { AdminDestinationUsersComponent } from './components/admin-destination/pages/users/users';
import { AdminDestinationMapComponent } from './components/admin-destination/pages/map/map';
import { SuperAdminLayoutComponent } from './components/super-admin/layout/super-admin-layout/super-admin-layout';
import { AnalyticsComponent } from './components/super-admin/pages/analytics/analytics';
import { UsersComponent } from './components/super-admin/pages/users/users';
import { DestinationsComponent } from './components/super-admin/pages/destinations/destinations';
import { AuditLogComponent } from './components/super-admin/pages/audit-log/audit-log';
import { DestinationAdminsComponent } from './components/super-admin/pages/destination-admins/destination-admins';
import { MapComponent } from './components/super-admin/pages/map/map';

import { PublisherMyContentComponent } from './components/publisher-my-content/publisher-my-content';
import { PublisherAddNewContentComponent } from './components/publisher-add-new-content/publisher-add-new-content';
import { PublisherReviewsComponent } from './components/publisher-reviews/publisher-reviews';
import { PublisherContentDetailsComponent } from './components/publisher-content-details/publisher-content-details';
import { PublisherMapComponent } from './components/publisher-map/publisher-map';
import { PublisherSupportComponent } from './components/publisher-support/publisher-support';

import { noAuthGuard } from './core/guards/no-auth-guard';
import {
  adminDestinationContentResolver,
  adminDestinationDashboardResolver,
  adminDestinationMapResolver,
  adminDestinationRequestsResolver,
  adminDestinationReviewsResolver
} from './components/admin-destination/admin-destination.resolvers';
import { AdminDestinationContentDetailComponent } from './components/admin-destination/pages/content-detail/content-detail';
import { AdminDestinationUserDetailComponent } from './components/admin-destination/pages/user-detail/user-detail';

export const routes: Routes = [
  { path: '', component: TouristDashboardComponent, canActivate: [roleHomeGuard] },
  { path: 'login', component: Login, canActivate: [noAuthGuard] },
  { path: 'register', component: Register, canActivate: [noAuthGuard] },
  { path: 'verify-email', component: VerifyEmail },
  { path: 'publisher', redirectTo: 'publisher-my-content', pathMatch: 'full' },
  { path: 'publisher/places', redirectTo: 'publisher-my-content', pathMatch: 'full' },
  { path: 'publisher/places/new', redirectTo: 'publisher-add-new-content', pathMatch: 'full' },
  { path: 'publisher/places/:id/edit', redirectTo: 'publisher-edit-content/:id', pathMatch: 'full' },

  // Stari publisher-profile URL -> redirect na my-content (profil se sada otvara kroz panel u headeru)
  { path: 'publisher-profile', redirectTo: 'publisher-my-content', pathMatch: 'full' },

  {
    path: 'tourist-dashboard',
    component: TouristDashboardComponent,
    canActivate: [authGuard, roleGuard],
    data: { role: 'tourist' }
  },

  {
    path: 'section/:type',
    component: SectionPageComponent
  },
  {
    path: 'section/:type/:preference',
    component: SectionPageComponent
  },
  {
    path: 'details/:entityType/:id',
    component: DetailsPageComponent
  },
  {
    path: 'details/:id',
    component: DetailsPageComponent
  },
  {
    path: 'reviews/:entityType/:id',
    component: ReviewsPageComponent
  },
  {
    path: 'map',
    component: MapsPageComponent
  },
  { path: 'maps', redirectTo: 'map', pathMatch: 'full' },

  {
    path: 'favourites/destination/:destinationKey',
    component: FavouriteDestinationPageComponent,
    canActivate: [authGuard, roleGuard],
    data: { role: 'tourist' }
  },

  {
    path: 'favourites',
    component: FavouritesPageComponent,
    canActivate: [authGuard, roleGuard],
    data: { role: 'tourist' }
  },

  {
    path: 'faq',
    loadComponent: () => import('./components/faq-page/faq-page').then(m => m.FaqPageComponent)
  },

  {
    path: 'publisher-my-content',
    component: PublisherMyContentComponent,
    canActivate: [authGuard, roleGuard],
    data: { role: 'publisher' }
  },
  {
    path: 'publisher-add-new-content',
    component: PublisherAddNewContentComponent,
    canActivate: [authGuard, roleGuard],
    data: { role: 'publisher' }
  },
  {
    path: 'publisher-reviews',
    component: PublisherReviewsComponent,
    canActivate: [authGuard, roleGuard],
    data: { role: 'publisher' }
  },
  {
    path: 'publisher-edit-content/:id',
    component: PublisherAddNewContentComponent,
    canActivate: [authGuard, roleGuard],
    data: { role: 'publisher' }
  },
  {
    path: 'publisher-content-details/:id',
    component: PublisherContentDetailsComponent,
    canActivate: [authGuard, roleGuard],
    data: { role: 'publisher' }
  },
  {
    path: 'publisher-map',
    component: PublisherMapComponent,
    canActivate: [authGuard, roleGuard],
    data: { role: 'publisher' }
  },
  {
    path: 'publisher-support',
    component: PublisherSupportComponent,
    canActivate: [authGuard, roleGuard],
    data: { role: 'publisher' }
  },

  {
    path: 'super-admin',
    component: SuperAdminLayoutComponent,
    canActivate: [authGuard, roleGuard],
    data: { role: 'super_admin' },
    children: [
      { path: '', redirectTo: 'analytics', pathMatch: 'full' },
      { path: 'analytics', component: AnalyticsComponent },
      { path: 'users', component: UsersComponent },
      { path: 'destinations', component: DestinationsComponent },
      { path: 'audit-log', component: AuditLogComponent },
      { path: 'destination-admins', component: DestinationAdminsComponent },
      { path: 'map', component: MapComponent }
    ]
  },

  {
    path: 'admin-destination',
    component: AdminDestinationLayoutComponent,
    canActivate: [authGuard, roleGuard],
    data: { role: 'admin' },
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', component: AdminDestinationDashboardComponent, resolve: { analytics: adminDestinationDashboardResolver } },
      { path: 'content', component: AdminDestinationContentComponent, resolve: { contentContext: adminDestinationContentResolver } },
      { path: 'content/:type/:id', component: AdminDestinationContentDetailComponent },
      { path: 'map', component: AdminDestinationMapComponent, resolve: { mapContext: adminDestinationMapResolver } },
      { path: 'requests', component: AdminDestinationRequestsComponent, resolve: { requests: adminDestinationRequestsResolver } },
      { path: 'reviews', component: AdminDestinationReviewsComponent, resolve: { reviews: adminDestinationReviewsResolver } },
      { path: 'users', component: AdminDestinationUsersComponent},
      { path: 'users/:id', component: AdminDestinationUserDetailComponent }
    ]
  },

  { path: 'provider-dashboard', redirectTo: 'publisher' },
  { path: 'publisher-dashboard', redirectTo: 'publisher' },
  { path: '**', redirectTo: '' }
];
