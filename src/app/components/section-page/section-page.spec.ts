import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SectionPage } from './section-page';

describe('SectionPage', () => {
  let component: SectionPage;
  let fixture: ComponentFixture<SectionPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionPage],
    }).compileComponents();

    fixture = TestBed.createComponent(SectionPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
