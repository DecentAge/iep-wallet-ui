import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { ShowDaoPollsComponent } from './show-dao-polls.component';

describe('ShowDaoPollsComponent', () => {
  let component: ShowDaoPollsComponent;
  let fixture: ComponentFixture<ShowDaoPollsComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ ShowDaoPollsComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ShowDaoPollsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
