import { Component, OnInit } from '@angular/core';
import { ShareToQuantityPipe } from '../../../../../pipes/share-to-quantity.pipe';
import { CryptoService } from '../../../../../services/crypto.service';
import { AppConstants } from '../../../../../config/constants';
import { AliasesService } from '../../../../aliases/aliases.service';
import { SessionStorageService } from '../../../../../services/session-storage.service';
import { Location } from '@angular/common';
import { AssetsService } from '../../../assets.service';
import * as alertFunctions from '../../../../../shared/data/sweet-alerts';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonService } from '../../../../../services/common.service';

@Component({
    selector: 'app-delete-shares',
    templateUrl: './delete-shares.component.html',
    styleUrls: ['./delete-shares.component.scss']
})
export class DeleteSharesComponent implements OnInit {
    transactionBytes: any;

    validBytes: any;
    tx_fee: any;
    tx_amount: any;
    tx_total: any;
    deleteAssetForm = {
        'assetId': '',
        'name': '',
        'quantity': 0,
        'decimals': ''
    };
    unsignedTx: boolean;

    constructor(private commonService: CommonService,
        private route: ActivatedRoute,
        private router: Router,
        private assetsService: AssetsService,
        private aliasesService: AliasesService,
        private sessionStorageService: SessionStorageService,
        private cryptoService: CryptoService,
        public shareToQuantityPipe: ShareToQuantityPipe,
        private _location: Location) {
    }

    ngOnInit() {
        this.route.queryParams.subscribe((params: any) => {
            if (!params.id) {
                this._location.back();
            } else {
                const assetId = params.id;
                this.assetsService.getAsset(assetId, true).subscribe((success: any) => {
                    this.deleteAssetForm.assetId = success.asset;
                    this.deleteAssetForm.decimals = success.decimals;
                    this.deleteAssetForm.name = success.name;
                }, (error) => {
                });
            }
        })
    }

    deleteAssetShares() {
        const quantity = this.shareToQuantityPipe.transform(this.deleteAssetForm.quantity, this.deleteAssetForm.decimals);
        const publicKey = this.commonService.getAccountDetailsFromSession('publicKey');
        const asset = this.deleteAssetForm.assetId;
        const fee = 1;
        const secretPhraseHex = this.sessionStorageService.getFromSession(AppConstants.loginConfig.SESSION_ACCOUNT_PRIVATE_KEY);

        this.assetsService.deleteAssetShares(asset, quantity, fee, publicKey)
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
                            'Sorry, an error occured! Reason: ' + success.errorDescription + ' ' + AppConstants.getNoConnectionMessage,
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
                            this.router.navigate(['/assets/show-assets']);
                        });
                } else {
                    alertFunctions.InfoAlertBox('Error',
                        'Unable to broadcast transaction. Reason: ' + success.errorDescription,
                        'OK',
                        'error').then((isConfirm: any) => {
                            this.router.navigate(['/assets/show-assets']);
                        });
                }
            });
    };

    goBack() {
        this._location.back();
    }

}
