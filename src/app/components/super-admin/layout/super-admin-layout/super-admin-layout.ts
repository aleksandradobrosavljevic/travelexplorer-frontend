import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FooterComponent } from '../../../footer/footer';
import { SuperAdminSidebarComponent } from '../super-admin-sidebar/super-admin-sidebar';

@Component({
  selector: 'app-super-admin-layout',
  standalone: true,
  imports: [RouterOutlet, SuperAdminSidebarComponent, FooterComponent],
  templateUrl: './super-admin-layout.html',
  styleUrl: './super-admin-layout.css'
})
export class SuperAdminLayoutComponent {}
