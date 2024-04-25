import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { ShowTeamMembersComponent } from './show-team-members.component';

describe('ShowTeamMembersComponent', () => {
  let component: ShowTeamMembersComponent;
  let fixture: ComponentFixture<ShowTeamMembersComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ ShowTeamMembersComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ShowTeamMembersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
