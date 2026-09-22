import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AdminDestinationSidebarComponent } from '../admin-destination-sidebar/admin-destination-sidebar';

@Component({
  selector: 'app-admin-destination-layout',
  standalone: true,
  imports: [RouterOutlet, AdminDestinationSidebarComponent],
  templateUrl: './admin-destination-layout.html',
  styleUrl: './admin-destination-layout.css'
})
export class AdminDestinationLayoutComponent {}
