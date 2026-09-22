import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PublisherMap } from './publisher-map';

describe('PublisherMap', () => {
  let component: PublisherMap;
  let fixture: ComponentFixture<PublisherMap>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublisherMap],
    }).compileComponents();

    fixture = TestBed.createComponent(PublisherMap);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
