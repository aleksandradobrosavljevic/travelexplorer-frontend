import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DestinationAdmins } from './destination-admins';

describe('DestinationAdmins', () => {
  let component: DestinationAdmins;
  let fixture: ComponentFixture<DestinationAdmins>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DestinationAdmins],
    }).compileComponents();

    fixture = TestBed.createComponent(DestinationAdmins);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
