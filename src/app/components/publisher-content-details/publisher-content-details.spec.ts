import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PublisherContentDetails } from './publisher-content-details';

describe('PublisherContentDetails', () => {
  let component: PublisherContentDetails;
  let fixture: ComponentFixture<PublisherContentDetails>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublisherContentDetails],
    }).compileComponents();

    fixture = TestBed.createComponent(PublisherContentDetails);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
