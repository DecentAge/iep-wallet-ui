import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { DaoPollsComponent } from './dao-polls.component';

describe('DaoPollsComponent', () => {
  let component: DaoPollsComponent;
  let fixture: ComponentFixture<DaoPollsComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ DaoPollsComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(DaoPollsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
