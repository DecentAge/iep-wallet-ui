import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { CryptoService } from '../../../services/crypto.service';
import { AmountToQuantPipe } from '../../../pipes/amount-to-quant.pipe';
import { CommonService } from '../../../services/common.service';
import { SessionStorageService } from '../../../services/session-storage.service';
import { CurrenciesService } from '../currencies.service';
import * as alertFunctions from '../../../shared/data/sweet-alerts';
import { AppConstants } from '../../../config/constants';

@Component({
    selector: 'app-send-currencies',
    templateUrl: './send-currencies.component.html',
    styleUrls: ['./send-currencies.component.scss']
})
export class SendCurrenciesComponent implements OnInit {
    openBookMarks: boolean = false;

    transactionBytes: any;
    validBytes: any;
    unsignedTx: boolean;

    f: any = {
        currencyId: '',
        units: '',
        recipientRS: '',
    };

    constructor(private commonService: CommonService,
        private route: ActivatedRoute,
        private router: Router,
        private sessionStorageService: SessionStorageService,
        private cryptoService: CryptoService,
        public amountToQuant: AmountToQuantPipe,
        private currenciesService: CurrenciesService,
        private _location: Location) {
    }

    ngOnInit() {
    }

    sendCurrency() {
        const publicKey = this.commonService.getAccountDetailsFromSession('publicKey');
        const secretPhraseHex = this.sessionStorageService.getFromSession(
            AppConstants.loginConfig.SESSION_ACCOUNT_PRIVATE_KEY
        );
        const fee = 1;

        this.currenciesService.transferCurrency(
            publicKey,
            this.f.recipientRS,
            this.f.currencyId,
            this.f.units,
            fee
        ).subscribe((success_) => {
            success_.subscribe((success) => {
                if (!success.errorCode) {
                    const unsignedBytes = success.unsignedTransactionBytes;
                    const signatureHex = this.cryptoService.signatureHex(unsignedBytes, secretPhraseHex);
                    this.transactionBytes = this.cryptoService.signTransactionHex(unsignedBytes, signatureHex);
                    this.validBytes = true;
                } else {
                    const title: string = this.commonService.translateAlertTitle('Error');
                    const errMsg: string = this.commonService.translateErrorMessageParams('sorry-error-occurred', success);
                    alertFunctions.InfoAlertBox(title, errMsg, 'OK', 'error');
                }
            });
        });
    }

    broadcastTransaction(transactionBytes) {
        this.commonService.broadcastTransaction(transactionBytes)
            .subscribe((success) => {
                if (!success.errorCode) {
                    const title: string = this.commonService.translateAlertTitle('Success');
                    let msg: string = this.commonService.translateInfoMessage('success-broadcast-message');
                    msg += success.transaction;
                    alertFunctions.InfoAlertBox(title, msg, 'OK', 'success').then(() => {
                        this.router.navigate(['/currencies/show-currencies']);
                    });
                } else {
                    const title: string = this.commonService.translateAlertTitle('Error');
                    const errMsg: string = this.commonService.translateErrorMessage('unable-broadcast-transaction', success);
                    alertFunctions.InfoAlertBox(title, errMsg, 'OK', 'error');
                }
            });
    }

    loadBookmarkView() {
        this.openBookMarks = true;
    }

    goBack() {
        this._location.back();
    }
}
