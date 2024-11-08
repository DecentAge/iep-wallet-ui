import 'jasmine';
import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';

import { ExpectedAssetDeletesComponent } from './expected-asset-deletes.component';

describe('ExpectedAssetDeletesComponent', () => {
  let component: ExpectedAssetDeletesComponent;
  let fixture: ComponentFixture<ExpectedAssetDeletesComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ ExpectedAssetDeletesComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ExpectedAssetDeletesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
