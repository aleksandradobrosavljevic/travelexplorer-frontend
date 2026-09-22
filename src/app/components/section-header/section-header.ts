import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Params, RouterLink } from '@angular/router';

@Component({
  selector: 'app-section-header',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './section-header.html',
  styleUrl: './section-header.css'
})
export class SectionHeaderComponent {
  @Input() title: string = '';
  @Input() linkText: string = 'See all';
  @Input() routePath: string = '';
  @Input() queryParams: Params | null = null;
}
