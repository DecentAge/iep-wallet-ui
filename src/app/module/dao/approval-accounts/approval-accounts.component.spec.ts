import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { ApprovalAccountsComponent } from './approval-accounts.component';

describe('ApprovalAccountsComponent', () => {
  let component: ApprovalAccountsComponent;
  let fixture: ComponentFixture<ApprovalAccountsComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ ApprovalAccountsComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ApprovalAccountsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
