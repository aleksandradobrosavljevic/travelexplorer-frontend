import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PublisherReviews } from './publisher-reviews';

describe('PublisherReviews', () => {
  let component: PublisherReviews;
  let fixture: ComponentFixture<PublisherReviews>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublisherReviews],
    }).compileComponents();

    fixture = TestBed.createComponent(PublisherReviews);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
