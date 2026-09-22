import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { PublisherContentService } from '../../services/publisher-content.service';
import { PublisherProfilePanelComponent } from '../publisher-profile-panel/publisher-profile-panel';
import { TranslationService } from '../../core/i18n/translation.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { buildApiUrl, buildAssetUrl } from '../../core/config/api';

@Component({
  selector: 'app-publisher-header',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, PublisherProfilePanelComponent, TranslatePipe],
  templateUrl: './publisher-header.html',
  styleUrls: ['./publisher-header.css']
})
export class PublisherHeaderComponent implements OnInit {
  organizationName = signal<string>('');
  avatarUrl = signal<string | null>(null);
  isProfileOpen = signal<boolean>(false);

  constructor(
    private publisherContentService: PublisherContentService,
    private translation: TranslationService,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    this.loadProfileSummary();
  }

  private loadProfileSummary(): void {
    this.publisherContentService.getUserProfile().subscribe({
      next: (userProfile) => {
        const name = userProfile?.publisherProfile?.organizationName?.trim();
        this.organizationName.set(name || '');
        this.avatarUrl.set(buildAssetUrl(userProfile?.avatarUrl) ?? null);
      },
      error: () => {
        this.organizationName.set('');
        this.avatarUrl.set(null);
      }
    });
  }

  openProfile(): void {
    this.isProfileOpen.set(true);
  }

  get currentLanguage(): 'en' | 'sr' {
    return this.translation.currentLanguage();
  }

  setLanguage(language: 'en' | 'sr'): void {
    if (this.currentLanguage === language) {
      return;
    }

    this.translation.use(language);
    this.http.put(buildApiUrl('users/me'), {
      preferredLanguageId: language === 'sr' ? 1 : 2
    }).subscribe({ error: () => {} });
  }

  closeProfile(): void {
    this.isProfileOpen.set(false);
  }

  onAvatarChanged(avatarUrl: string | null): void {
    this.avatarUrl.set(avatarUrl);
  }
}
