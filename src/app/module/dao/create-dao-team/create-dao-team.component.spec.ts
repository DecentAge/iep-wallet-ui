import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { CreateDaoTeamComponent } from './create-dao-team.component';

describe('CreateDaoTeamComponent', () => {
  let component: CreateDaoTeamComponent;
  let fixture: ComponentFixture<CreateDaoTeamComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ CreateDaoTeamComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(CreateDaoTeamComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
