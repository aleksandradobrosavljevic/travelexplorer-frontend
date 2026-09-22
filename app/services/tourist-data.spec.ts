import { TestBed } from '@angular/core/testing';

import { TouristData } from './tourist-data';

describe('TouristData', () => {
  let service: TouristData;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TouristData);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
