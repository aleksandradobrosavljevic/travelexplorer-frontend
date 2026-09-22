import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export type PreviewCardEntityType = 'Object' | 'Activity' | 'Event';

export interface PreviewCardSelection {
  id: number;
  entityType: PreviewCardEntityType;
}

@Component({
  selector: 'app-preview-card',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './preview-card.html',
  styleUrl: './preview-card.css'
})
export class PreviewCardComponent {
  @Input() id!: number;
  @Input() entityType: PreviewCardEntityType = 'Object';
  @Input() image: string = '';
  @Input() title: string = '';
  @Input() location: string = '';
  @Input() rating: number = 0;
  @Input() price: string = '';
  @Input() isFavorite: boolean = false;

  @Output() favoriteToggled = new EventEmitter<PreviewCardSelection>();
  @Output() cardSelected = new EventEmitter<PreviewCardSelection>();

  onFavoriteClick(event: Event): void {
    event.stopPropagation();
    this.favoriteToggled.emit({ id: this.id, entityType: this.entityType });
  }

  onCardClick(): void {
    this.cardSelected.emit({ id: this.id, entityType: this.entityType });
  }
}
