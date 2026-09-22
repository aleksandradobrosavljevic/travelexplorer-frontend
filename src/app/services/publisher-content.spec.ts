import { TestBed } from '@angular/core/testing';

import { PublisherContent } from './publisher-content';

describe('PublisherContent', () => {
  let service: PublisherContent;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PublisherContent);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
