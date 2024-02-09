import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { DaoTeamMembersComponent } from './dao-team-members.component';

describe('DaoTeamMembersComponent', () => {
  let component: DaoTeamMembersComponent;
  let fixture: ComponentFixture<DaoTeamMembersComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ DaoTeamMembersComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(DaoTeamMembersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
