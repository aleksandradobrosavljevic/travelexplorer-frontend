import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PublisherAddNewContent } from './publisher-add-new-content';

describe('PublisherAddNewContent', () => {
  let component: PublisherAddNewContent;
  let fixture: ComponentFixture<PublisherAddNewContent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublisherAddNewContent],
    }).compileComponents();

    fixture = TestBed.createComponent(PublisherAddNewContent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
