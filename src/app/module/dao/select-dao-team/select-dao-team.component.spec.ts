import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { SelectDaoTeamComponent } from './select-dao-team.component';

describe('SelectDaoTeamComponent', () => {
  let component: SelectDaoTeamComponent;
  let fixture: ComponentFixture<SelectDaoTeamComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ SelectDaoTeamComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(SelectDaoTeamComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
