import { Injectable } from '@angular/core';
import { TranslationService } from '../i18n/translation.service';

type SupportedCurrency = 'RSD' | 'EUR';

@Injectable({
  providedIn: 'root'
})
export class PriceFormatService {
  private readonly rsdPerEur = 117.2;

  constructor(private translation: TranslationService) {}

  formatPrice(value: number | null | undefined, sourceCurrency: string | null | undefined = 'RSD'): string {
    if (value == null) {
      return '';
    }

    if (value === 0) {
      return this.translation.translate('common.free');
    }

    const targetCurrency = this.displayCurrency();
    const converted = this.convert(value, this.normalizeCurrency(sourceCurrency), targetCurrency);
    const formattedAmount = this.formatAmount(converted);

    return targetCurrency === 'RSD'
      ? `${formattedAmount} din`
      : `EUR ${formattedAmount}`;
  }

  convertToDisplayCurrency(value: number | null | undefined, sourceCurrency: string | null | undefined = 'RSD'): number {
    if (value == null) {
      return Number.MAX_SAFE_INTEGER;
    }

    return this.convert(value, this.normalizeCurrency(sourceCurrency), this.displayCurrency());
  }

  private displayCurrency(): SupportedCurrency {
    return this.translation.currentLanguage() === 'sr' ? 'RSD' : 'EUR';
  }

  private normalizeCurrency(value: string | null | undefined): SupportedCurrency {
    const normalized = (value ?? '').trim().toUpperCase();
    return normalized === 'EUR' ? 'EUR' : 'RSD';
  }

  private convert(value: number, sourceCurrency: SupportedCurrency, targetCurrency: SupportedCurrency): number {
    if (sourceCurrency === targetCurrency) {
      return value;
    }

    return targetCurrency === 'EUR'
      ? value / this.rsdPerEur
      : value * this.rsdPerEur;
  }

  private formatAmount(value: number): string {
    const rounded = Number(value.toFixed(2));
    const hasDecimals = !Number.isInteger(rounded);

    return new Intl.NumberFormat(this.translation.currentLanguage() === 'sr' ? 'sr-RS' : 'en-US', {
      minimumFractionDigits: hasDecimals ? 2 : 0,
      maximumFractionDigits: hasDecimals ? 2 : 0
    }).format(rounded);
  }
}
