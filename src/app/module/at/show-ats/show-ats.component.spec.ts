import 'jasmine';

import { ShowAtsComponent } from './show-ats.component';
import {async, ComponentFixture, TestBed} from "@angular/core/testing";

describe('ShowAtsComponent', () => {
  let component: ShowAtsComponent;
  let fixture: ComponentFixture<ShowAtsComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ ShowAtsComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ShowAtsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
