
import {forkJoin as observableForkJoin, Observable} from 'rxjs';
import { Component, OnInit } from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {SessionStorageService} from '../../../../../services/session-storage.service';
import {AssetsService} from '../../../assets.service';
import {AccountService} from '../../../../account/account.service';
import {Page} from '../../../../../config/page';
import {Location} from '@angular/common';

@Component({
  selector: 'app-expected-order-details',
  templateUrl: './expected-order-details.component.html',
  styleUrls: ['./expected-order-details.component.scss']
})
export class ExpectedOrderDetailsComponent implements OnInit {
    asset: any = {};
    decimals: any;

    askOrdersPage = new Page();
    askOrdersRows = new Array<any>();
    enableSell: any;
    bidLength: any;

    bidOrdersPage = new Page();
    bidOrdersRows = new Array<any>();
    enableBuy: any;
    askLength: any;
    expectedOrderForm: any = {}
    activeTab: any;

    constructor(private router: Router,
                private sessionStorageService: SessionStorageService,
                private assetsService: AssetsService,
                private route: ActivatedRoute,
                private accountService: AccountService,
                private _location: Location) {
    }

  ngOnInit() {
      this.bidOrdersPage.totalElements = 0;
      this.bidOrdersPage.totalPages = 0;
      this.askOrdersPage.totalElements = 0;
      this.askOrdersPage.totalPages = 0;
  }
    onSearchChange(assetId) {
        if (assetId !== '') {
            this.getAskOrders();
            this.getBidOrders();
        }
    }
    goBack() {
        this._location.back();
    }
    getAskOrders(pageInfo?){
        if(!pageInfo){
            pageInfo = {offset: 0};
        }

        this.askOrdersPage.pageNumber = pageInfo.offset;

        var asset = this.expectedOrderForm.asset;

        observableForkJoin([this.assetsService.getExpectedAskOrders(asset), this.assetsService.getAsset(asset, true)])
            .subscribe((successNext: any) => {
                let [offersResponse, assetDetailsResponse] = successNext;
                this.decimals = assetDetailsResponse.decimals;
                this.askOrdersRows = offersResponse.askOrders || [];
                this.bidLength = this.askOrdersRows.length;
                if (this.askOrdersPage.pageNumber === 0 && this.askOrdersRows.length < 10) {
                    this.askOrdersPage.totalElements = this.askOrdersRows.length;
                } else if (this.askOrdersPage.pageNumber > 0 && this.askOrdersRows.length < 10) {
                    this.askOrdersPage.totalElements = this.askOrdersPage.pageNumber * 10 + this.askOrdersRows.length;
                    this.askOrdersPage.totalPages = this.askOrdersPage.pageNumber;
                }
            });
    }
    getBidOrders(pageInfo?){

        if(!pageInfo){
            pageInfo = {offset: 0};
        }

        this.bidOrdersPage.pageNumber = pageInfo.offset;

        var asset = this.expectedOrderForm.asset;

        observableForkJoin([this.assetsService.getExpectedBidOrders(asset), this.assetsService.getAsset(asset, true)])
            .subscribe((successNext: any) => {
                let [offersResponse, assetDetailsResponse] = successNext;
                this.decimals = assetDetailsResponse.decimals;
                this.bidOrdersRows = offersResponse.bidOrders || [];
                this.askLength = this.bidOrdersRows.length;
                if (this.bidOrdersPage.pageNumber === 0 && this.bidOrdersRows.length < 10) {
                    this.bidOrdersPage.totalElements = this.bidOrdersRows.length;
                } else if (this.bidOrdersPage.pageNumber > 0 && this.bidOrdersRows.length < 10) {
                    this.bidOrdersPage.totalElements = this.bidOrdersPage.pageNumber * 10 + this.bidOrdersRows.length;
                    this.bidOrdersPage.totalPages = this.bidOrdersPage.pageNumber;
                }
            });
    }

}
