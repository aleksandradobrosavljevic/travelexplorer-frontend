import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';

type SupportedLanguage = 'en' | 'sr';
type TranslationDictionary = Record<string, unknown>;

@Injectable({
  providedIn: 'root'
})
export class TranslationService {
  private readonly dictionaries = signal<Record<SupportedLanguage, TranslationDictionary>>({
    en: {},
    sr: {}
  });
  private readonly loadingLanguages = new Set<SupportedLanguage>();

  readonly currentLanguage = signal<SupportedLanguage>('en');

  constructor(private http: HttpClient) {
    this.use(this.getStoredLanguage());
  }

  use(language: string | null | undefined): void {
    const normalizedLanguage = this.normalizeLanguage(language);
    this.currentLanguage.set(normalizedLanguage);
    localStorage.setItem('selectedLanguage', normalizedLanguage === 'sr' ? 'sr-RS' : 'en-US');
    localStorage.setItem('appLanguage', normalizedLanguage);
    this.ensureLanguageLoaded(normalizedLanguage);

    if (normalizedLanguage !== 'en') {
      this.ensureLanguageLoaded('en');
    }
  }

  translate(key: string, params?: Record<string, string | number | null | undefined>): string {
    const language = this.currentLanguage();
    const value = this.lookup(this.dictionaries()[language], key)
      ?? this.lookup(this.dictionaries().en, key)
      ?? key;

    const text = typeof value === 'string' ? value : key;
    return this.interpolate(text, params);
  }

  normalizeLanguage(language: string | null | undefined): SupportedLanguage {
    const value = (language ?? '').trim().toLowerCase();

    if (value.startsWith('sr') || value === 'serbian') {
      return 'sr';
    }

    return 'en';
  }

  private ensureLanguageLoaded(language: SupportedLanguage): void {
    if (Object.keys(this.dictionaries()[language]).length > 0 || this.loadingLanguages.has(language)) {
      return;
    }

    this.loadingLanguages.add(language);

    this.http.get<TranslationDictionary>(`/i18n/${language}.json`).subscribe({
      next: (dictionary) => {
        this.dictionaries.update((current) => ({
          ...current,
          [language]: dictionary ?? {}
        }));
        this.loadingLanguages.delete(language);
      },
      error: () => {
        this.loadingLanguages.delete(language);
      }
    });
  }

  private getStoredLanguage(): SupportedLanguage {
    return this.normalizeLanguage(
      localStorage.getItem('appLanguage')
      ?? localStorage.getItem('selectedLanguage')
      ?? 'en'
    );
  }

  private lookup(dictionary: TranslationDictionary, key: string): unknown {
    return key.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') {
        return undefined;
      }

      return (current as Record<string, unknown>)[segment];
    }, dictionary);
  }

  private interpolate(text: string, params?: Record<string, string | number | null | undefined>): string {
    if (!params) {
      return text;
    }

    return Object.entries(params).reduce(
      (result, [key, value]) => result.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), String(value ?? '')),
      text
    );
  }
}
