import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SuperAdminSidebar } from './super-admin-sidebar';

describe('SuperAdminSidebar', () => {
  let component: SuperAdminSidebar;
  let fixture: ComponentFixture<SuperAdminSidebar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SuperAdminSidebar],
    }).compileComponents();

    fixture = TestBed.createComponent(SuperAdminSidebar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
