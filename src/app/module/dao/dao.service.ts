import {Injectable} from '@angular/core';
import {AppConstants} from '../../config/constants';
import * as alertFunctions from '../../shared/data/sweet-alerts';
import {map} from 'rxjs/operators';
import {AliasesService} from '../aliases/aliases.service';
import {AssetsService} from '../assets/assets.service';
import {CommonService} from '../../services/common.service';
import {CryptoService} from '../../services/crypto.service';
import {SessionStorageService} from '../../services/session-storage.service';

@Injectable()
export class DaoService {

    private transactionBytes: any;
    private validBytes: any;
    private tx_fee: any;
    private tx_amount: any;
    private tx_total: any;
    private aliasURI: any;

    constructor(
        private aliasesService: AliasesService,
        private assetsService: AssetsService,
        private commonService: CommonService,
        private cryptoService: CryptoService,
        private sessionStorageService: SessionStorageService,
    ) {
    }

    createAsset(daoData, wizard) {
        const name = `DAO${daoData.prefix}`;
        const description = daoData.description;
        const shares = daoData.quantity;
        const decimals = daoData.decimals;
        const quantity = parseInt(shares, 0) * (Math.pow(10, parseInt(decimals, 0)));
        const publicKey = this.commonService.getAccountDetailsFromSession('publicKey');
        const fee = 1;

        const secret = daoData.secretPhrase;
        let secretPhraseHex;

        if (secret) {
            secretPhraseHex = this.cryptoService.secretPhraseToPrivateKey(secret);
        } else {
            secretPhraseHex = this.sessionStorageService.getFromSession(AppConstants.loginConfig.SESSION_ACCOUNT_PRIVATE_KEY);
        }

        if (parseInt(shares, 0) === 1) {
            const title: string = this.commonService.translateAlertTitle('info');
            const msg: string = this.commonService.translateInfoMessage('issue-asset-info-msg');
            alertFunctions.InfoAlertBox(title, msg, 'OK', 'error').then(() => {
            });
            return;
        }

        this.assetsService.issueAsset(name, description, quantity, decimals, publicKey, fee)
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
                        this.aliasURI = success.transactionJSON.senderRS;
                        this.broadcastTransaction(this.transactionBytes).subscribe(result => {
                            if (!!result) {
                                this.setAlias(daoData.name, wizard);
                            }
                        });
                    } else {
                        console.log('success.errCode', success.errCode);
                        const title: string = this.commonService.translateAlertTitle('Error');
                        const errMsg: string = this.commonService.translateErrorMessageParams('sorry-error-occurred', success);
                        alertFunctions.InfoAlertBox(title, errMsg, 'OK', 'error').then(() => {
                        });
                    }
                });
            })
    }

    setAlias(daoAliasName, wizard) {
        const publicKey = this.commonService.getAccountDetailsFromSession('publicKey');
        const aliasName = `DAO${daoAliasName}`;
        const alias = `acct:${this.aliasURI}@xin`;
        const fee = 1;
        const secretPhraseHex = this.sessionStorageService.getFromSession(AppConstants.loginConfig.SESSION_ACCOUNT_PRIVATE_KEY);

        this.aliasesService.setAlias(publicKey, aliasName, alias, fee)
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
                        this.broadcastTransaction(this.transactionBytes).subscribe((result) => {
                            if (!!result) {
                                const title: string = this.commonService.translateAlertTitle('Success');
                                let msg: string = this.commonService.translateInfoMessage('success-broadcast-message');
                                msg += success.transaction;
                                alertFunctions.InfoAlertBox(title, msg, 'OK', 'success').then(() => {
                                    wizard.navigation.goToStep(3);
                                });
                            }
                        });
                    } else {
                        const title: string = this.commonService.translateAlertTitle('Error');
                        const errMsg: string = this.commonService.translateErrorMessageParams('sorry-error-occurred', success);
                        alertFunctions.InfoAlertBox(title, errMsg, 'OK', 'error').then(() => {
                        });
                    }
                });
            });
    }

    broadcastTransaction(transactionBytes) {
        return this.commonService.broadcastTransaction(transactionBytes)
            .pipe(map((success) => {
                if (!success.errorCode) {
                    return true;
                } else {
                    const title: string = this.commonService.translateAlertTitle('Error');
                    const errMsg: string = this.commonService.translateErrorMessage('unable-broadcast-transaction', success);
                    alertFunctions.InfoAlertBox(title, errMsg, 'OK', 'error').then(() => {
                    });
                    return false;
                }
            }));
    };

}
