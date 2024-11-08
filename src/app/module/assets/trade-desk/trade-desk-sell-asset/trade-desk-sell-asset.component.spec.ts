import 'jasmine';
import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';

import { TradeDeskSellAssetComponent } from './trade-desk-sell-asset.component';

describe('TradeDeskSellAssetComponent', () => {
  let component: TradeDeskSellAssetComponent;
  let fixture: ComponentFixture<TradeDeskSellAssetComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ TradeDeskSellAssetComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(TradeDeskSellAssetComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
