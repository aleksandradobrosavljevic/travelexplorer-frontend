import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-rejection-reason-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rejection-reason-dialog.html',
  styleUrl: './rejection-reason-dialog.css'
})
export class RejectionReasonDialogComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() title = 'Rejection reason';
  @Input() message = 'Enter a reason before rejecting this item.';
  @Input() confirmLabel = 'Continue';
  @Input() cancelLabel = 'Cancel';

  @Output() confirmed = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  reason = '';
  showValidation = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']?.currentValue) {
      this.reason = '';
      this.showValidation = false;
    }
  }

  confirm(): void {
    const trimmedReason = this.reason.trim();

    if (!trimmedReason) {
      this.showValidation = true;
      return;
    }

    this.confirmed.emit(trimmedReason);
    this.reason = '';
    this.showValidation = false;
  }

  cancel(): void {
    this.reason = '';
    this.showValidation = false;
    this.cancelled.emit();
  }
}
