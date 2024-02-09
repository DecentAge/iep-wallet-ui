import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { DaoTeamMessagesComponent } from './dao-team-messages.component';

describe('DaoTeamMessagesComponent', () => {
  let component: DaoTeamMessagesComponent;
  let fixture: ComponentFixture<DaoTeamMessagesComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ DaoTeamMessagesComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(DaoTeamMessagesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
