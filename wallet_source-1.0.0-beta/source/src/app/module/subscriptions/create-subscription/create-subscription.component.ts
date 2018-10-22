import { Component, OnInit } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonService } from '../../../services/common.service';
import { SubscriptionService } from '../subscription.service';
import { SessionStorageService } from '../../../services/session-storage.service';
import { AppConstants } from '../../../config/constants';
import { CryptoService } from '../../../services/crypto.service';
import { AmountToQuantPipe } from '../../../pipes/amount-to-quant.pipe';
import { AccountService } from '../../account/account.service';
import * as alertFunctions from '../../../shared/data/sweet-alerts';
import { AliasesService } from '../../aliases/aliases.service';

@Component({
    selector: 'app-create-subscription',
    templateUrl: './create-subscription.component.html',
    styleUrls: ['./create-subscription.component.scss']
})
export class CreateSubscriptionComponent implements OnInit {

    subscriptionForm: any = {
        recipientRS: '',
        amount: 0,
        interval: ''
    };
    accountDetails: any;
    data: any;

    transactionBytes: any;

    validBytes: any;
    tx_fee: any;
    tx_amount: any;
    tx_total: any;
    openBookMarks: boolean = false;

    constructor(private commonService: CommonService,
        private route: ActivatedRoute,
        private router: Router,
        private _location: Location,
        private subscriptionService: SubscriptionService,
        private sessionStorageService: SessionStorageService,
        public amountToQuant: AmountToQuantPipe,
        private cryptoService: CryptoService,
        public accountService: AccountService,
        public aliasesService: AliasesService) {
    }

    ngOnInit() {
    }

    bookmarkSelected(e) {
        this.subscriptionForm.recipientRS = e.data.account;
        this.openBookMarks = false;
    }

    searchAliases() {
        this.aliasesService.searchAlias(this.subscriptionForm.recipientRS).subscribe((success) => {
            var aliases = success.aliases || [];
            for (var i = 0; i < aliases.length; i++) {
                var alias = aliases[i];
                if (alias.aliasName.toUpperCase() === this.subscriptionForm.recipientRS.toUpperCase()) {
                    var aliasURI = alias.aliasURI;
                    var aliasType = aliasURI.split(':');
                    if (aliasType[0] === 'acct') {
                        var accountRS = aliasType[1].split('@')[0];
                        this.subscriptionForm.recipientRS = accountRS;
                        break;
                    }
                }
            }
        }, (error) => {

        });
    }

    createSubscription() {

        const recipientRS = this.subscriptionForm.recipientRS;
        const amountTQT = this.amountToQuant.transform(this.subscriptionForm.amount);
        const frequency = parseInt(this.subscriptionForm.interval) * 86400;

        const fee = 1;

        const senderPublicKey = this.accountService.getAccountDetailsFromSession('publicKey');
        const secretPhraseHex = this.sessionStorageService.getFromSession(AppConstants.loginConfig.SESSION_ACCOUNT_PRIVATE_KEY);

        this.accountService.getAccountDetails(recipientRS).subscribe((success) => {
            const recipientPublicKey = success['publicKey'];
            if (!success['errorCode'] || success['errorCode'] === 5) {
                this.accountDetails = success;
                if (!recipientPublicKey) {
                    alertFunctions.InfoAlertBox('Success',
                        'This account never had an outbound transaction. Make sure this account is the right one. In doubt, ask the account holder for his public key and add it on the former page to this transaction.',
                        'OK',
                        'success').then((isConfirm: any) => {
                        });
                }

                this.subscriptionService.createSubscription(
                    senderPublicKey,
                    recipientRS,
                    amountTQT,
                    frequency,
                    fee
                ).subscribe((_success) => {
                    _success.subscribe(result => {
                        if (!result.errorCode) {
                            const unsignedBytes = result.unsignedTransactionBytes;
                            const signatureHex = this.cryptoService.signatureHex(unsignedBytes, secretPhraseHex);
                            this.transactionBytes = this.cryptoService.signTransactionHex(unsignedBytes, signatureHex);
                            this.validBytes = true;

                            this.tx_fee = result.transactionJSON.feeTQT / 100000000;
                            this.tx_amount = result.transactionJSON.amountTQT / 100000000;
                            this.tx_total = this.tx_fee + this.tx_amount;

                        } else {
                            alertFunctions.InfoAlertBox('Sorry, an error occured! Reason: ' + result.errorDescription,
                                AppConstants.getNoConnectionMessage,
                                'OK',
                                'error').then((isConfirm: any) => {
                                });
                        }
                    })


                }, (err) => {
                    alertFunctions.InfoAlertBox('Sorry, an error occured! Reason: ' + err.errorDescription,
                        AppConstants.getNoConnectionMessage,
                        'OK',
                        'error').then((isConfirm: any) => {
                        });
                });

            } else {
                alertFunctions.InfoAlertBox('Sorry, an error occured! Reason: ' + success['errorDescription'],
                    AppConstants.getNoConnectionMessage,
                    'OK',
                    'error').then((isConfirm: any) => {
                    });
            }
        });
    }

    broadcastTransaction(transactionBytes) {
        this.commonService.broadcastTransaction(transactionBytes)
            .subscribe((success) => {
                if (!success.errorCode) {
                    alertFunctions.InfoAlertBox('Success',
                        'Transaction succesfull broadcasted with Id : ' + success.transaction,
                        'OK',
                        'success').then((isConfirm: any) => {
                            this.router.navigate(['/subscriptions/my-subscriptions']);
                        });
                } else {
                    alertFunctions.InfoAlertBox('Error',
                        'Unable to broadcast transaction. Reason: ' + success.errorDescription,
                        'OK',
                        'error').then((isConfirm: any) => {
                            this.router.navigate(['/subscriptions/create-subscription']);
                        });
                }


            });
    };

    loadBookmarkView() {
        this.openBookMarks = true;
    }

    goBack() {
        this.openBookMarks = false;
    }

}
