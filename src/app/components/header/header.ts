import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { Auth } from '../../core/services/auth';
import { UserProfileComponent } from '../user-profile/user-profile';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';
import { buildApiUrl, buildAssetUrl } from '../../core/config/api';

interface NotificationItem {
  id: number;
  message: string;
  isRead: boolean;
  createdAt: string;
}

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterLink, UserProfileComponent, TranslatePipe],
  templateUrl: './header.html',
  styleUrl: './header.css'
})
export class HeaderComponent implements OnInit, OnDestroy {
  @Input() mode: 'full' | 'minimal' = 'full';

  isUserProfileOpen = false;
  isNotificationPanelOpen = false;
  isMobileMenuOpen = false;
  avatarUrl: string | null = null;
  notifications: NotificationItem[] = [];
  unreadNotificationCount = 0;
  private currentPath = '';
  private routerEventsSubscription?: Subscription;

  constructor(
    private readonly authService: Auth,
    private readonly http: HttpClient,
    private readonly translation: TranslationService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.setCurrentPath(this.router.url);
    this.routerEventsSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(event => this.setCurrentPath(event.urlAfterRedirects));
    this.loadNotifications();
    this.loadAvatar();
  }

  ngOnDestroy(): void {
    this.routerEventsSubscription?.unsubscribe();
  }

  get isLoggedIn(): boolean {
    return this.authService.isLoggedIn();
  }

  get isTourist(): boolean {
    return this.authService.getUserRole() === 'tourist';
  }

  get currentLanguage(): 'en' | 'sr' {
    return this.translation.currentLanguage();
  }

  isNavActive(section: 'home' | 'map' | 'favourites' | 'support'): boolean {
    switch (section) {
      case 'home':
        return this.currentPath === '/' || this.currentPath === '/tourist-dashboard';
      case 'map':
        return this.currentPath === '/map';
      case 'favourites':
        return this.currentPath === '/favourites' || this.currentPath.startsWith('/favourites/');
      case 'support':
        return this.currentPath === '/faq';
    }
  }

  setLanguage(language: 'en' | 'sr'): void {
    if (this.currentLanguage === language) {
      return;
    }

    this.translation.use(language);

    if (!this.isLoggedIn || !this.isTourist) {
      this.reloadCurrentPage();
      return;
    }

    this.http.put(buildApiUrl('users/me'), {
      preferredLanguageId: language === 'sr' ? 1 : 2
    }).subscribe({
      next: () => this.reloadCurrentPage(),
      error: () => this.reloadCurrentPage()
    });
  }

  private reloadCurrentPage(): void {
    window.location.reload();
  }

  onOpenProfile(): void {
    this.isUserProfileOpen = true;
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
  }

  closeMobileMenu(): void {
    this.isMobileMenuOpen = false;
  }

  closeUserProfile(): void {
    this.isUserProfileOpen = false;
    this.loadAvatar();
  }

  onAvatarChanged(avatarUrl: string | null): void {
    this.avatarUrl = avatarUrl;
  }

  toggleNotifications(): void {
    this.isNotificationPanelOpen = !this.isNotificationPanelOpen;
    if (this.isNotificationPanelOpen) {
      this.loadNotifications();
    }
  }

  markNotificationRead(notification: NotificationItem, event?: Event): void {
    event?.stopPropagation();
    const previousNotifications = [...this.notifications];
    this.setNotifications(this.notifications.filter(item => item.id !== notification.id));

    this.http.patch(buildApiUrl(`notifications/${notification.id}/read`), {}).subscribe({
      error: () => {
        this.setNotifications(previousNotifications);
      }
    });
  }

  markAllNotificationsRead(event?: Event): void {
    event?.stopPropagation();
    const previousNotifications = [...this.notifications];
    this.setNotifications([]);
    this.isNotificationPanelOpen = false;

    this.http.patch(buildApiUrl('notifications/read-all'), {}).subscribe({
      error: () => {
        this.setNotifications(previousNotifications);
        this.isNotificationPanelOpen = true;
      }
    });
  }

  private loadNotifications(): void {
    if (!this.isLoggedIn || !this.isTourist || this.mode !== 'full') {
      this.setNotifications([]);
      return;
    }

    this.http.get<NotificationItem[]>(buildApiUrl('notifications/unread')).subscribe({
      next: notifications => {
        this.setNotifications(notifications ?? []);
      },
      error: () => {
        this.setNotifications([]);
      }
    });
  }

  private loadAvatar(): void {
    if (!this.isLoggedIn || !this.isTourist || this.mode !== 'full') {
      this.avatarUrl = null;
      return;
    }

    this.http.get<any>(buildApiUrl('users/me')).subscribe({
      next: profile => {
        const touristProfile = profile?.touristProfile ?? {};
        this.avatarUrl = buildAssetUrl(profile?.avatarUrl ?? touristProfile?.avatarUrl) ?? null;
      },
      error: () => {
        this.avatarUrl = null;
      }
    });
  }

  private setNotifications(notifications: NotificationItem[]): void {
    this.notifications = notifications;
    this.unreadNotificationCount = notifications.filter(item => !item.isRead).length;
  }

  private setCurrentPath(url: string): void {
    const path = url.split('?')[0].split('#')[0].replace(/\/+$/, '');
    this.currentPath = path || '/';
  }
}
