import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { DaoMessagesComponent } from './dao-messages.component';

describe('MessagesComponent', () => {
  let component: DaoMessagesComponent;
  let fixture: ComponentFixture<DaoMessagesComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ DaoMessagesComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(DaoMessagesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
