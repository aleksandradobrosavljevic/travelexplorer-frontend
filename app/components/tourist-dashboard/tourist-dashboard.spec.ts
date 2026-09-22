import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TouristDashboardComponent } from './tourist-dashboard';

describe('TouristDashboard', () => {
  let component: TouristDashboardComponent;
  let fixture: ComponentFixture<TouristDashboardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TouristDashboardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TouristDashboardComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
