import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PublisherProfilePanel } from './publisher-profile-panel';

describe('PublisherProfilePanel', () => {
  let component: PublisherProfilePanel;
  let fixture: ComponentFixture<PublisherProfilePanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublisherProfilePanel],
    }).compileComponents();

    fixture = TestBed.createComponent(PublisherProfilePanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
