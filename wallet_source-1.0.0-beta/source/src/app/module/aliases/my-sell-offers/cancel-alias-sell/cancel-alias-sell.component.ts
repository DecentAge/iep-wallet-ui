import {Component, OnInit} from '@angular/core';
import {AmountToQuantPipe} from '../../../../pipes/amount-to-quant.pipe';
import {SessionStorageService} from '../../../../services/session-storage.service';
import {CommonService} from '../../../../services/common.service';
import {ActivatedRoute, Router} from '@angular/router';
import {CryptoService} from '../../../../services/crypto.service';
import {Location} from '@angular/common';
import {AliasesService} from '../../aliases.service';
import {AppConstants} from '../../../../config/constants';
import * as alertFunctions from '../../../../shared/data/sweet-alerts';

@Component({
    selector: 'app-cancel-alias-sell',
    templateUrl: './cancel-alias-sell.component.html',
    styleUrls: ['./cancel-alias-sell.component.scss']
})
export class CancelAliasSellComponent implements OnInit {

    data: any;
    transactionBytes: any;

    validBytes: any;
    tx_fee: any;
    tx_amount: any;
    tx_total: any;
    alias = {
        name: '',
        priceTQT: 0,
        recipientRS: ''
    };

    constructor(private commonService: CommonService,
                private route: ActivatedRoute,
                private router: Router,
                private aliasesService: AliasesService,
                private sessionStorageService: SessionStorageService,
                private cryptoService: CryptoService,
                public amountToQuant: AmountToQuantPipe,
                private _location: Location) {
    }

    ngOnInit() {
        this.route.queryParams.subscribe((params: any) => {
            if (!params) {
                this._location.back();
            } else {
                this.data = {
                    'aliasName': params.aliasName,
                    'priceTQT': params.priceTQT,
                    'recipientRS': params.aliasId
                }
            }
        })
        this.alias.name = this.data.aliasName;
        this.alias.priceTQT = this.data.priceTQT;
        this.alias.recipientRS = this.data.recipientRS;
    }

    cancelAlias() {
        const publicKey = this.commonService.getAccountDetailsFromSession('publicKey');
        const name = this.alias.name;
        const recipientRS = this.alias.recipientRS;
        const fee = 1;
        const secretPhraseHex = this.sessionStorageService.getFromSession(AppConstants.loginConfig.SESSION_ACCOUNT_PRIVATE_KEY);

        this.aliasesService.cancelAlias(publicKey, name, recipientRS, fee)
            .subscribe((success_) => {
                success_.subscribe((success) => {
                    if (!success.errorCode) {
                        const unsignedBytes = success.unsignedTransactionBytes;
                        const signatureHex = this.cryptoService.signatureHex(unsignedBytes, secretPhraseHex);
                        this.transactionBytes = this.cryptoService.signTransactionHex(unsignedBytes, signatureHex);

                        this.validBytes = true;
                        this.tx_fee = success.transactionJSON.feeTQT / 100000000;
                        this.tx_amount = success.transactionJSON.amountTQT / 100000000;
                        this.tx_total = this.tx_fee + this.tx_amount;
                    } else {
                        alertFunctions.InfoAlertBox('Sorry, an error occured! Reason: ' + success.errorDescription,
                            AppConstants.getNoConnectionMessage,
                            'OK',
                            'error').then((isConfirm: any) => {
                        });
                    }
                }, function (error) {
                    alertFunctions.InfoAlertBox('Error',
                        AppConstants.getNoConnectionMessage,
                        'OK',
                        'error').then((isConfirm: any) => {
                    });
                });
            })
    }

    broadcastTransaction(transactionBytes) {
        this.commonService.broadcastTransaction(transactionBytes)
            .subscribe((success) => {
                if (!success.errorCode) {
                    alertFunctions.InfoAlertBox('Success',
                        'Transaction succesfull broadcasted with Id : ' + success.transaction,
                        'OK',
                        'success').then((isConfirm: any) => {
                        this.router.navigate(['/aliases/my-sell-offers']);
                    });
                } else {
                    alertFunctions.InfoAlertBox('Error',
                        'Unable to broadcast transaction. Reason: ' + success.errorDescription,
                        'OK',
                        'error').then((isConfirm: any) => {
                        this.router.navigate(['/aliases/my-sell-offers']);
                    });
                }
            }, (error) => {

                alertFunctions.InfoAlertBox('Error',
                    AppConstants.getNoConnectionMessage,
                    'OK',
                    'error').then((isConfirm: any) => {

                });
            });
    };

    goBack() {
        this._location.back();
    }

}
