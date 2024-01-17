import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { DaosComponent } from './daos.component';

describe('DaosComponent', () => {
  let component: DaosComponent;
  let fixture: ComponentFixture<DaosComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ DaosComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(DaosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
