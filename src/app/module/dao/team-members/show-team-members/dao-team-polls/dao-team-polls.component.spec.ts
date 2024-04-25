import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { DaoTeamPollsComponent } from './dao-team-polls.component';

describe('DaoTeamPollsComponent', () => {
  let component: DaoTeamPollsComponent;
  let fixture: ComponentFixture<DaoTeamPollsComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ DaoTeamPollsComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(DaoTeamPollsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
