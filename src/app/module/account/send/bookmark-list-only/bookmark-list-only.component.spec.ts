import 'jasmine';
import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';

import { BookmarkListOnlyComponent } from './bookmark-list-only.component';

describe('BookmarkListOnlyComponent', () => {
  let component: BookmarkListOnlyComponent;
  let fixture: ComponentFixture<BookmarkListOnlyComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ BookmarkListOnlyComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(BookmarkListOnlyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
