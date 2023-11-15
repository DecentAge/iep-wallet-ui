import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { ShowTeamsComponent } from './show-teams.component';

describe('ShowTeamsComponent', () => {
  let component: ShowTeamsComponent;
  let fixture: ComponentFixture<ShowTeamsComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ ShowTeamsComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ShowTeamsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
