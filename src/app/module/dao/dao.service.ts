import {Injectable} from '@angular/core';
import {AppConstants} from '../../config/constants';
import * as alertFunctions from '../../shared/data/sweet-alerts';
import {map} from 'rxjs/operators';
import {AliasesService} from '../aliases/aliases.service';
import {AssetsService} from '../assets/assets.service';
import {CommonService} from '../../services/common.service';
import {CryptoService} from '../../services/crypto.service';
import {SessionStorageService} from '../../services/session-storage.service';
import {Router} from '@angular/router';
import {HttpProviderService} from '../../services/http-provider.service';
import {NodeService} from '../../services/node.service';

@Injectable()
export class DaoService {

    static currentDAO: any = null;
    private currentDAOForm: any = null;

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
        private http: HttpProviderService,
        private nodeService: NodeService,
        private sessionStorageService: SessionStorageService,
        private router: Router
    ) {
    }

    public get daoForm() {
        return this.currentDAOForm;
    }

    createAsset(assetName, aliasName, daoData, route = '', aliasURI = '') {
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

        this.assetsService.issueAsset(assetName, description, quantity, decimals, publicKey, fee)
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
                        this.aliasURI = aliasURI === '' ? success.transactionJSON.senderRS : aliasURI;
                        this.broadcastTransaction(this.transactionBytes).subscribe(result => {
                            if (!!result.success) {
                                this.setAlias(aliasName, route);
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

    setAlias(daoAliasName, route = '') {
        const publicKey = this.commonService.getAccountDetailsFromSession('publicKey');
        const alias = `acct:${this.aliasURI}@xin`;
        const fee = 1;
        const secretPhraseHex = this.sessionStorageService.getFromSession(AppConstants.loginConfig.SESSION_ACCOUNT_PRIVATE_KEY);

        this.aliasesService.setAlias(publicKey, daoAliasName, alias, fee)
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
                            if (!!result.success) {
                                const title: string = this.commonService.translateAlertTitle('Success');
                                let msg: string = this.commonService.translateInfoMessage('success-broadcast-message');
                                msg += result.transaction;
                                alertFunctions.InfoAlertBox(title, msg, 'OK', 'success').then(() => {
                                    if (route !== '') {
                                        this.router.navigate([route]).then();
                                    }
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
                    return {
                        success: true,
                        transaction: success.transaction
                    };
                } else {
                    const title: string = this.commonService.translateAlertTitle('Error');
                    const errMsg: string = this.commonService.translateErrorMessage('unable-broadcast-transaction', success);
                    alertFunctions.InfoAlertBox(title, errMsg, 'OK', 'error').then(() => {
                    });
                    return {
                        success: false,
                    }
                }
            }));
    };

    createDAO(daoData) {
        const assetName = `DAO${daoData.prefix}`;
        const aliasName = `DAO${daoData.name}`;
        DaoService.currentDAO = daoData;
        this.currentDAOForm = daoData;
        this.createAsset(assetName, aliasName, daoData, 'dao/create-dao/create-team', '');
    }

    createTeam(daoName, teamData, aliasUri = '') {
        const assetName = `DAO${daoName}TT${teamData.prefix}`;
        const aliasName = `DAO${daoName}TN${teamData.name}TT${teamData.prefix}`;
        this.createAsset(assetName, aliasName, teamData, '', aliasUri);
    }

    getAliases(daoName = '') {
        const prefix = daoName === '' ? 'DAO' : daoName;
        const params = {
            'requestType': 'getAliasesLike',
            'aliasPrefix': prefix,
        };

        return this.http.get(this.nodeService.getNodeUrl(), AppConstants.aliasesConfig.aliasesEndPoint, params).pipe(
            map((aliases: any) => {
                return daoName === '' ?
                    aliases.aliases.filter(alias => alias.aliasName.indexOf('TN') === -1 && alias.aliasName.indexOf('TT') === -1) :
                    aliases.aliases;
            })
        );
    };

    public getDaoTeams(daoName: string) {
        return this.getAliases(daoName);
    }

    public getAssetForDaoTeam(startedWith: string) {
        return this.assetsService.serachAssets(`${startedWith}*`);
    }

    transferTeamToken(currentDao, createTeamForm) {
        const params = {
            'requestType': 'getAccountPublicKey',
            'account': createTeamForm.teamWallet,
        };

        /*this.assetsService.serachAssets(`DAO${currentDao}TT${createTeamForm.prefix}`).subscribe((result) => {
            const quantity = result[0].quantityQNT;
            const publicKey = this.commonService.getAccountDetailsFromSession('publicKey');
            const asset = result[0].asset; // this.transferAssetForm.assetId;
            const recipientRS = createTeamForm.teamWallet;
            const fee = 1;
            const secretPhraseHex = this.sessionStorageService.getFromSession(AppConstants.loginConfig.SESSION_ACCOUNT_PRIVATE_KEY);

            this.assetsService.transferAsset(publicKey, recipientRS, asset, quantity, fee)
                .subscribe((success_) => {
                    success_.subscribe((success) => {
                        if (!success.errorCode) {
                            const unsignedBytes = success.unsignedTransactionBytes;
                            const signatureHex = this.cryptoService.signatureHex(unsignedBytes, secretPhraseHex);
                            this.transactionBytes = this.cryptoService.signTransactionHex(unsignedBytes, signatureHex);
                            this.broadcastTransaction(this.transactionBytes).subscribe((response) => {
                                if (!!response.success) {
                                    const title: string = this.commonService.translateAlertTitle('Success');
                                    let msg: string = this.commonService.translateInfoMessage('success-broadcast-message');
                                    msg += response.transaction;
                                    alertFunctions.InfoAlertBox(title, msg, 'OK', 'success').then(() => {
                                    });
                                }
                            });
                        } else {
                            const title: string = this.commonService.translateAlertTitle('Error');
                            const errMsg: string = this.commonService.translateErrorMessageParams('sorry-error-occurred',
                                success);
                            alertFunctions.InfoAlertBox(title,
                                errMsg,
                                'OK',
                                'error').then((isConfirm: any) => {
                            });
                        }
                    });
                });
        });*/
    }
}
