import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PublisherMyContent } from './publisher-my-content';

describe('PublisherMyContent', () => {
  let component: PublisherMyContent;
  let fixture: ComponentFixture<PublisherMyContent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublisherMyContent],
    }).compileComponents();

    fixture = TestBed.createComponent(PublisherMyContent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
