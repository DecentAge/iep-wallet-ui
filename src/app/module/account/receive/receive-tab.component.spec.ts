import 'jasmine';
import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';

import { ReceiveTabComponent } from './receive-tab.component';

describe('ReceiveTabComponent', () => {
  let component: ReceiveTabComponent;
  let fixture: ComponentFixture<ReceiveTabComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ ReceiveTabComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ReceiveTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
