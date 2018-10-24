import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CryptoService } from '../../../../../services/crypto.service';
import { SessionStorageService } from '../../../../../services/session-storage.service';
import { AmountToQuantPipe } from '../../../../../pipes/amount-to-quant.pipe';
import { CommonService } from '../../../../../services/common.service';
import { Location } from '@angular/common';
import { AssetsService } from '../../../assets.service';
import { AppConstants } from '../../../../../config/constants';
import * as alertFunctions from '../../../../../shared/data/sweet-alerts';
import { DataStoreService } from '../../../../../services/data-store.service';

@Component({
    selector: 'app-cancel-order',
    templateUrl: './cancel-order.component.html',
    styleUrls: ['./cancel-order.component.scss']
})
export class CancelOrderComponent implements OnInit {

    offer: any = {};
    transactionBytes: any;

    validBytes: any;
    tx_fee: any;
    tx_amount: any;
    tx_total: any;
    cancelOrderForm: any = {
        'order': '',
        'name': '',
        'asset': '',
        'priceTQT': '',
        'quantityQNT': '',
        'fee': '',
        'type': '',
        'decimals': ''
    };

    unsignedTx: boolean;

    constructor(private commonService: CommonService,
        private route: ActivatedRoute,
        private router: Router,
        private assetsService: AssetsService,
        private sessionStorageService: SessionStorageService,
        private cryptoService: CryptoService,
        public amountToQuant: AmountToQuantPipe,
        private _location: Location) {
    }

    ngOnInit() {

        this.offer = DataStoreService.get('offer-details');
        if (!this.offer) {
            this._location.back();
        } else {
            this.cancelOrderForm = {
                'order': this.offer.order,
                'name': this.offer.name,
                'asset': this.offer.asset,
                'priceTQT': this.offer.priceTQT,
                'quantityQNT': this.offer.quantityQNT,
                'type': this.offer.type,
                'decimals': this.offer.decimals
            }
            this.cancelOrder();
        }
    }
    cancelOrder() {

        const cancelOrderForm = this.cancelOrderForm;
        const order = cancelOrderForm.order;
        const fee = 1;
        const type = cancelOrderForm.type;
        const publicKey = this.commonService.getAccountDetailsFromSession('publicKey');
        const secretPhraseHex = this.sessionStorageService.getFromSession(AppConstants.loginConfig.SESSION_ACCOUNT_PRIVATE_KEY);

        this.assetsService.cancelOrder(order, fee, publicKey, type)
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
                        alertFunctions.InfoAlertBox('Error',
                            '' + success.errorDescription + ' ' +
                            AppConstants.getNoConnectionMessage,
                            'OK',
                            'error').then((isConfirm: any) => {
                            });
                    }
                }, function (error) {
                    alertFunctions.InfoAlertBox('Error',
                        '' + AppConstants.getNoConnectionMessage,
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
                            this.router.navigate(['assets/my-open-orders/buy']);
                        });
                } else {
                    alertFunctions.InfoAlertBox('Error',
                        'Unable to broadcast transaction. Reason: ' + success.errorDescription,
                        'OK',
                        'error').then((isConfirm: any) => {
                            this.router.navigate(['assets/my-open-orders/buy']);
                        });
                }
            });
    };

    goBack() {
        this._location.back();
    }

}
