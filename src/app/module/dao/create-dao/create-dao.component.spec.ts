import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { CreateDaoComponent } from './create-dao.component';

describe('DaoComponent', () => {
  let component: CreateDaoComponent;
  let fixture: ComponentFixture<CreateDaoComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ CreateDaoComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(CreateDaoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
