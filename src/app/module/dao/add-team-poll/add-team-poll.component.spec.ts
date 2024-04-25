import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { AddTeamPollComponent } from './add-team-poll.component';

describe('AddTeamPollComponent', () => {
  let component: AddTeamPollComponent;
  let fixture: ComponentFixture<AddTeamPollComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ AddTeamPollComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(AddTeamPollComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
