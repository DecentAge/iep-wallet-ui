import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { ShowDaoDetailsComponent } from './show-dao-details.component';

describe('ShowDaoDetailsComponent', () => {
  let component: ShowDaoDetailsComponent;
  let fixture: ComponentFixture<ShowDaoDetailsComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ ShowDaoDetailsComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ShowDaoDetailsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
