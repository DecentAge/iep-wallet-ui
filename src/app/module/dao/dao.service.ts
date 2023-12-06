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
import {AccountService} from '../account/account.service';
import {combineLatest, Observable} from 'rxjs';
import {Founder, TeamMember} from './team-members/interfaces';

@Injectable()
export class DaoService {

    static currentDAO: any = null;
    static currentDAOTeam: any = null;
    static currentDAOTeamFounders: Array<Founder> = [];
    public currentTeamMembers: Array<TeamMember> = [];
    private pendingTransactions: Array<string> = [];
    private currentDAOForm: any = null;
    private transactionBytes: any;
    private aliasURI: any;
    private accountId;

    constructor(
        private accountService: AccountService,
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
                        this.broadcastTransaction(this.transactionBytes).subscribe((result) => {
                            if (!!result.success) {
                                const title: string = this.commonService.translateAlertTitle('Success');
                                let msg: string = this.commonService.translateInfoMessage('success-broadcast-message');
                                msg += result.transaction;
                                alertFunctions.InfoAlertBox(title, msg, 'OK', 'success').then(() => {
                                    this.pendingTransactions.push(result.transaction);
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
        DaoService.currentDAO = daoData.name;
        this.currentDAOForm = daoData;
        this.createAsset(assetName, aliasName, daoData, `dao/create-dao/create-team`, '');
    }

    createTeam(daoName, teamData, aliasUri = '') {
        const assetName = `DAO${daoName}TT${teamData.prefix}`;
        const aliasName = `DAO${daoName}TN${teamData.name}TT${teamData.prefix}`;
        DaoService.currentDAOTeam = aliasName;
        const route = this.router.url.toString() === '/dao/create-dao/create-team' ?
            '/dao/create-dao/add-founders' : `/dao/show-daos/DAO${daoName}/teams`;
        this.createAsset(assetName, aliasName, teamData, route, aliasUri);
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
        return this.getAliases(daoName).pipe(
            map((response: any) => {
                if (!response) {
                    response = [];
                }
                const aliases = response.filter(r => r.aliasName.indexOf('TR') === -1);
                if (!aliases) {
                    return;
                }
                const tokenNames = [];
                aliases.forEach(el => {
                    tokenNames.push(
                        this.getAssetForDaoTeam(`${el.aliasName.split('TN').shift()}TT${el.aliasName.split('TT').pop()}`)
                    );
                });
                return combineLatest(tokenNames).pipe(map((res: any) => {
                    return {
                        res,
                        aliases
                    }
                }));
            })
        );
    }

    getTeamMembers(teamName: string) {
        const searchString = `${teamName.split('TT').shift()}`;
        return this.getAliases(`${searchString}TR`).pipe(
            map((response: any) => {
                if (!response) {
                    response = [];
                }
                const aliases = response;
                if (!aliases) {
                    return;
                }
                return aliases;
            })
        );
    }

    public getAssetForDaoTeam(startedWith: string) {
        return this.assetsService.serachAssets(`${startedWith}*`, {includeCounts: true});
    }

    transferTeamToken(teamToken) {
        if (teamToken.quantityQNT < 1) {
            const title: string = this.commonService.translateAlertTitle('Error');
            const errMsg: string = this.commonService.translateErrorMessageParams('Error',
                {errorCode: -1});
            alertFunctions.InfoAlertBox(title,
                errMsg,
                'OK',
                'error').then(() => {
            });
            return;
        }
        const quantity = teamToken.quantityQNT - 1;
        const publicKey = this.commonService.getAccountDetailsFromSession('publicKey');
        const asset = teamToken.asset;
        const recipientRS = teamToken.teamWallet;
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
                            'error').then(() => {
                        });
                    }
                });
            });
    }

    checkAccountExists(accountRS) {
        return this.accountService.checkAccountExists(accountRS);
    }

    showErrorMessage(response) {
        const title: string = this.commonService.translateAlertTitle('Error');
        const errMsg: string = this.commonService.translateErrorMessageParams('sorry-error-occurred',
            response);
        alertFunctions.InfoAlertBox(title,
            errMsg,
            'OK',
            'error').then(() => {
        });
    }

    getAccountDaos() {
        const accountRS = this.accountService.getAccountDetailsFromSession('accountRs');
        return this.getAliases().pipe(
            map((aliases: any) => {
                return aliases.filter(alias => alias.accountRS === accountRS);
            })
        );
    }

    addTeamMembers(currentDao, currentTeam, teamMembers) {
        const wallets = teamMembers.map((teamMember: TeamMember) => teamMember.teamMemberWallet);
        const checkWallets = wallets.map(wallet => this.checkAccountExists(wallet));
        combineLatest(checkWallets).subscribe((accounts) => {
            if (accounts.find((account: any) => account.errorCode && !account.account)) {
                const title: string = this.commonService.translateAlertTitle('Error');
                const errMsg: string = this.commonService.translateInfoMessage('try-later');
                alertFunctions.InfoAlertBox(title,
                    errMsg,
                    'OK',
                    'error').then(() => {
                });
                return;
            }

            const aliases = teamMembers.map((teamMember: TeamMember) =>
                `${currentTeam.split('TT').shift()}TR${teamMember.teamMemberRole}TT${currentTeam.split('TT').pop()}`);
            const teamToken = `${currentTeam.split('TN').shift()}TT${currentTeam.split('TT').pop()}`;

            const publicKey = this.commonService.getAccountDetailsFromSession('publicKey');
            const fee = 1;
            const secretPhraseHex = this.sessionStorageService.getFromSession(AppConstants.loginConfig.SESSION_ACCOUNT_PRIVATE_KEY);

            const aliasesToSet = [];
            aliases.map((a, index) => {
                aliasesToSet.push(this.aliasesService.setAlias(publicKey, a, `acct:${wallets[index]}@xin`, fee));
            })

            combineLatest(aliasesToSet).subscribe(response_ => {
                combineLatest(response_).subscribe(response => {
                    if (response.find((res: any) => res.errorCode)) {
                        const title: string = this.commonService.translateAlertTitle('Error');
                        const errMsg: string = this.commonService.translateInfoMessage('try-later');
                        alertFunctions.InfoAlertBox(title, errMsg, 'OK', 'error').then(() => {
                        });
                        return;
                    }
                    const aliasesTransactionsToBroadcast = [];
                    response.map((r: any) => {
                        const unsignedBytes = r.unsignedTransactionBytes;
                        const signatureHex = this.cryptoService.signatureHex(unsignedBytes, secretPhraseHex);
                        const transactionBytes = this.cryptoService.signTransactionHex(unsignedBytes, signatureHex);
                        aliasesTransactionsToBroadcast.push(this.broadcastTransaction(transactionBytes));
                    });
                    this.transferTeamTokens(teamToken, wallets, aliasesTransactionsToBroadcast, currentDao, currentTeam);
                })
            });
        });
    }

    transferTeamTokens(teamToken, wallets, aliasesTransactions, currentDao, currentTeam) {
        this.getAssetForDaoTeam(teamToken).pipe(map((response: any) => response.assets[0])).subscribe((token: any) => {
            if (!token || token.quantityQNT < 1) {
                const title: string = this.commonService.translateAlertTitle('Error');
                const errMsg: string = this.commonService.translateInfoMessage('try-later');
                alertFunctions.InfoAlertBox(title,
                    errMsg,
                    'OK',
                    'error').then(() => {
                });
                return;
            }
            const quantity = 1;
            const publicKey = this.commonService.getAccountDetailsFromSession('publicKey');
            const asset = token.asset;
            const fee = 1;
            const secretPhraseHex = this.sessionStorageService.getFromSession(AppConstants.loginConfig.SESSION_ACCOUNT_PRIVATE_KEY);

            const transferData = [];
            wallets.map((wallet, index) => {
                const qty = this.currentTeamMembers.length > 0 && this.currentTeamMembers[index]
                && this.currentTeamMembers[index].quantity ? this.currentTeamMembers[index].quantity : quantity;
                transferData.push(this.assetsService.transferAsset(publicKey, wallet, asset, qty, fee));
            });
            combineLatest(transferData).subscribe(success_ => {
                combineLatest(success_).subscribe(transferAssetsRequests => {
                    if (transferAssetsRequests.find((request: any) => request.errorCode)) {
                        const title: string = this.commonService.translateAlertTitle('Error');
                        const errMsg: string = this.commonService.translateInfoMessage('try-later');
                        alertFunctions.InfoAlertBox(title,
                            errMsg,
                            'OK',
                            'error').then(() => {
                        });
                    }
                    const transactionsToBroadcast = [];
                    transferAssetsRequests.map((request: any) => {
                        const unsignedBytes = request.unsignedTransactionBytes;
                        const signatureHex = this.cryptoService.signatureHex(unsignedBytes, secretPhraseHex);
                        const transactionBytes = this.cryptoService.signTransactionHex(unsignedBytes, signatureHex);
                        transactionsToBroadcast.push(this.broadcastTransaction(transactionBytes));
                    });
                    combineLatest([...aliasesTransactions, ...transactionsToBroadcast]).subscribe((broadcastedResponse: any) => {
                        const successTransactionsId = [];
                        const filedTransactionsId = [];
                        broadcastedResponse.map((response: any) => {
                            if (!!response.success) {
                                successTransactionsId.push(response.transaction);
                            } else {
                                filedTransactionsId.push(response.transaction);
                            }
                        });
                        if (successTransactionsId.length) {
                            const title: string = this.commonService.translateAlertTitle('Success');
                            let msg: string = this.commonService.translateInfoMessage('success-broadcast-transactions');
                            msg += successTransactionsId.join(', ');
                            alertFunctions.InfoAlertBox(title, msg, 'OK', 'success').then(() => {
                                if (filedTransactionsId.length) {
                                    const errorTitle: string = this.commonService.translateAlertTitle('Error');
                                    let errMsg: string = this.commonService.translateInfoMessage('unable-broadcast-transactions');
                                    errMsg += filedTransactionsId.join(', ');
                                    alertFunctions.InfoAlertBox(errorTitle,
                                        errMsg,
                                        'OK',
                                        'error').then();
                                } else {
                                    if (this.router.url.toString() === '/dao/create-dao/add-team-members') {
                                        this.router.navigate(['dao/show-daos']).then();
                                    } else {
                                        DaoService.currentDAO = currentDao;
                                        DaoService.currentDAOTeam = currentTeam;
                                        this.router.navigate([`dao/show-daos/${currentDao}/teams/${currentTeam}`]).then();
                                    }
                                }
                            });
                        } else if (filedTransactionsId.length) {
                            const title: string = this.commonService.translateAlertTitle('Error');
                            let errMsg: string = this.commonService.translateInfoMessage('unable-broadcast-transactions');
                            errMsg += filedTransactionsId.join(', ');
                            alertFunctions.InfoAlertBox(title,
                                errMsg,
                                'OK',
                                'error').then();
                        }
                    })
                })
            });
        });
    }

    public checkTransactions(): Observable<{ isPending: boolean, transactions: Array<any> }> {
        this.accountId = this.accountService.getAccountDetailsFromSession('accountId');
        return this.accountService.getAccountUnconfirmedTransactions(this.accountId).pipe(
            map((unconfirmedTransactions: any) => {
                let isPending = false;
                const transactions = unconfirmedTransactions
                    .unconfirmedTransactions.map(t => t.transaction).filter(uT => this.pendingTransactions.includes(uT));
                if (transactions.length > 0) {
                    isPending = true;
                }
                if (!isPending) {
                    this.pendingTransactions.length = 0;
                }
                return {
                    isPending,
                    transactions
                }
            }));
    }

    setAccountControl(approvalAccountsForm, teamAccount) {
        const quorum = approvalAccountsForm.quorum;
        const accounts = approvalAccountsForm.accounts;
        const fee = 1;
        this.accountService.getAccountPublicKey(teamAccount).subscribe((response: any) => {
            const publicKey = response.publicKey;
            const secretPhraseHex = this.sessionStorageService.getFromSession(
                AppConstants.loginConfig.SESSION_ACCOUNT_PRIVATE_KEY
            );
            this.accountService
                .setAccountControl(publicKey, quorum, accounts, fee)
                .subscribe(success => {
                    if (!success.errorCode) {
                        const unsignedBytes = success.unsignedTransactionBytes;
                        const signatureHex = this.cryptoService.signatureHex(
                            unsignedBytes,
                            secretPhraseHex
                        );
                        const transactionBytes = this.cryptoService.signTransactionHex(
                            unsignedBytes,
                            signatureHex
                        );

                        this.broadcastTransaction(transactionBytes).subscribe(res => {
                            if (!!res.success) {
                                const title: string = this.commonService.translateAlertTitle('Success');
                                let msg: string = this.commonService.translateInfoMessage('success-broadcast-message');
                                msg += res.transaction;
                                alertFunctions.InfoAlertBox(title, msg, 'OK', 'success').then(() => {
                                });
                            }
                        });
                    } else {
                        const title: string = this.commonService.translateAlertTitle('Error');
                        const errMsg: string = this.commonService.translateErrorMessageParams(
                            'sorry-error-occurred',
                            success
                        );
                        alertFunctions
                            .InfoAlertBox(title, errMsg, 'OK', 'error')
                            .then();
                    }
                });
        });
    }
}
