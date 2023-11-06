import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { ShowDaosComponent } from './show-daos.component';

describe('ShowDaosComponent', () => {
  let component: ShowDaosComponent;
  let fixture: ComponentFixture<ShowDaosComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ ShowDaosComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ShowDaosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
