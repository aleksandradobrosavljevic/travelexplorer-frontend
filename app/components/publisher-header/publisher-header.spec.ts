import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PublisherHeader } from './publisher-header';

describe('PublisherHeader', () => {
  let component: PublisherHeader;
  let fixture: ComponentFixture<PublisherHeader>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublisherHeader],
    }).compileComponents();

    fixture = TestBed.createComponent(PublisherHeader);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
