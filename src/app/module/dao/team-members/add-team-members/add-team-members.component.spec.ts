import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { AddTeamMembersComponent } from './add-team-members.component';

describe('AddTeamMembersComponent', () => {
  let component: AddTeamMembersComponent;
  let fixture: ComponentFixture<AddTeamMembersComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ AddTeamMembersComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(AddTeamMembersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
