import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MapsPage } from './maps-page';

describe('MapsPage', () => {
  let component: MapsPage;
  let fixture: ComponentFixture<MapsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapsPage],
    }).compileComponents();

    fixture = TestBed.createComponent(MapsPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
