import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PublisherSupport } from './publisher-support';

describe('PublisherSupport', () => {
  let component: PublisherSupport;
  let fixture: ComponentFixture<PublisherSupport>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublisherSupport],
    }).compileComponents();

    fixture = TestBed.createComponent(PublisherSupport);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
