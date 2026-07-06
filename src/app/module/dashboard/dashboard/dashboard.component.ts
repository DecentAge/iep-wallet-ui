
import {forkJoin as observableForkJoin,  Observable } from 'rxjs';
import { ChartConfiguration, ChartData, ChartType } from 'chart.js';
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SessionStorageService } from '../../../services/session-storage.service';
import { DashboardService } from '../dashboard.service';
import { RootScope } from '../../../config/root-scope';
import { TranslateService } from '@ngx-translate/core';

@Component({
    selector: 'app-dashboard',
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {

    accountRs: string;
    accountValuation: number;
    balanceTQT: any;
    selectedLanguage: string;

    // XIN/USD price chart. XIN is pegged to 1 Satoshi, so XIN/USD = BTC/USD * 1e-8.
    showChart = false;
    lineChartType: ChartType = 'line';
    lineChartData: ChartData<'line'> = {
        labels: [],
        datasets: [{
            data: [],
            label: '1 XIN (USD)',
            fill: true,
            tension: 0.3,
            borderColor: '#E72D45',
            backgroundColor: 'rgba(231,45,69,0.15)',
            pointRadius: 0
        }]
    };
    lineChartOptions: ChartConfiguration<'line'>['options'] = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { title: { display: true, text: 'Price (USD)' } } }
    };


    constructor(private router: Router,
        private dashboardService: DashboardService,
        public translate: TranslateService,
        private sessionStorageService: SessionStorageService,
    ) {
        this.accountValuation = 0.00;
        this.accountRs = "";
    }

    ngOnInit() {
        this.getAccountAssetsAndBalances();
        this.getMarketData();
        this.redirectTo();
    }

    getQueryParams(url) {
        const paramArr = url.slice(url.indexOf('?') + 1).split('&');
        const params = {};
        paramArr.map(param => {
            const [key, val] = param.split('=');
            params[key] = decodeURIComponent(val);
        })
        return params;
    }

    redirectTo() {
        const redirectTo = localStorage.getItem('redirectTo');
        if (redirectTo) {
            const redirectToUrlParts = redirectTo.split('?');
            const params = this.getQueryParams(redirectToUrlParts[1]);
            this.router.navigate([redirectToUrlParts[0]], { queryParams: params });
            localStorage.removeItem('redirectTo');
        }
    }

    getAccountAssetsAndBalances() {

        RootScope.onChange.subscribe(data => {
            this.accountRs = data['accountRs'];
            this.balanceTQT = data['balanceTQT'];
        });
        RootScope.set({}); //force load again TODO: need to change implementation/reload
    };

    getMarketData() {
        // this.dashboardService.getMarketData('XIN', 'BTC').subscribe(data => {
        //     if(data.Response == 'Success'){
        //         let points = [];
        //         data.Data.map((val) => {
        //             points.push({
        //                 date: val.time * 1000,
        //                 value: val.close
        //             });
        //         });
        //         this.renderChart(points);
        //     }
        // })

        // XIN/USD daily history from the IEP market-cap backend (single, persisted source).
        // A failure is non-fatal (see interceptor) -> the chart just stays hidden.
        this.dashboardService.getXinHistory(365)
            .subscribe((res: any) => {
                if (Array.isArray(res) && res.length) {
                    this.lineChartData.labels = res.map((p: any) => p.date || new Date(p.timestamp).toLocaleDateString());
                    this.lineChartData.datasets[0].data = res.map((p: any) => p.price_usd);
                    this.showChart = true;
                }
            });
    }

    chartClicked() {

    }

    navigateTo(route) {
        this.router.navigate([route]);
    }

}
