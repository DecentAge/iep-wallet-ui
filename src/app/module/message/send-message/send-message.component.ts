import {Component, OnInit} from '@angular/core';
import {FeeService} from 'app/services/fee.service';
import {AppConstants} from 'app/config/constants';
import {SessionStorageService} from 'app/services/session-storage.service';
import {AccountService} from '../../account/account.service';
import {AmountToQuantPipe} from 'app/pipes/amount-to-quant.pipe';
import {ActivatedRoute, Router} from '@angular/router';
import {CryptoService} from 'app/services/crypto.service';
import {MessageService} from '../message.service';
import * as alertFunctions from '../../../shared/data/sweet-alerts';
import {AliasesService} from '../../aliases/aliases.service';
import {Location} from '@angular/common';
import {CommonService} from 'app/services/common.service';
import {DaoService} from 'app/module/dao/dao.service';
import {forkJoin} from 'rxjs';

@Component({
    selector: 'app-send-message',
    templateUrl: './send-message.component.html',
    styleUrls: ['./send-message.component.scss']
})
export class SendMessageComponent implements OnInit {

    public hasReceiverPublicKey: boolean;
    validBytes = false;
    hasPublicKeyAdded = false;
    hasMessageAdded = false;
    sendMessageForm: any = {
        recipientRS: '',
        prunable: '',
        message: '',
        pubkey: ''
    };
    recipientImmutable = false;
    teamName = '';
    openBookMarks: boolean = false;
    isPrunable = [
        { label: 'On Chain (160 chars.)', value: 'false' },
        { label: 'Off Chain (24k chars.)', value: 'true' }
    ];
    accountDetails: any = '';
    encrypted: any;
    tx_fee: any;
    tx_amount: any;
    tx_total: any;
    transactionBytes: any;
    prunableAttachmentJSON: any;
    prunableAttachmentString: any;
    unsignedTx: any;
    aMessage: any;
    aprunableAttachmentJSON: any;
    transactionsToBroadcast = [];

    constructor(public feeService: FeeService,
        public sessionStorageService: SessionStorageService,
        public accountService: AccountService,
        public cryptoService: CryptoService,
        public amountToQuant: AmountToQuantPipe,
        public messageService: MessageService,
        public router: Router,
        public activatedRoute: ActivatedRoute,
        public aliasesService: AliasesService,
        private _location: Location,
        private daoService: DaoService,
        public commonService: CommonService) {
        this.hasReceiverPublicKey = false;
    }

    ngOnInit() {
        this.activatedRoute.queryParams.subscribe((params: any) => {
            if (params.recipient) {
                this.sendMessageForm.recipientRS = params.recipient;
                this.teamName = params.teamName;
                this.recipientImmutable = true;
            }
        });
        this.sendMessageForm.prunable = this.isPrunable[0].value;
    }

    setPublicKye() {
        this.hasReceiverPublicKey = !this.hasReceiverPublicKey;
        if (!this.hasReceiverPublicKey) {
            this.sendMessageForm.pubkey = '';
        }
    }

    onChangeMessageInfo() {
        const totalFee = this.feeService.getSetAccountFee(this.sendMessageForm.message);

        if (!this.sendMessageForm.fee || this.sendMessageForm.fee < totalFee) {
            this.sendMessageForm.fee = totalFee;
        }
    }

    bookmarkSelected(e) {
        this.sendMessageForm.recipientRS = e.data.account;
        this.openBookMarks = false;
    }

    loadBookmarkView() {
        this.router.navigate(['/account/send/bookmark-list-only'], { queryParams: { fromView: 'sendmessage' } });

    }

    goBack() {
        this._location.back();
        this.openBookMarks = false;
    }

    searchAliases() {
        this.aliasesService.searchAlias(this.sendMessageForm.recipientRS).subscribe((success) => {
            const aliases = success.aliases || [];
            for (let i = 0; i < aliases.length; i++) {
                const alias = aliases[i];
                if (alias.aliasName.toUpperCase() === this.sendMessageForm.recipientRS.toUpperCase()) {
                    const aliasURI = alias.aliasURI;
                    const aliasType = aliasURI.split(':');
                    if (aliasType[0] === 'acct') {
                        this.sendMessageForm.recipientRS = aliasType[1].split('@')[0];
                        break;
                    }
                }
            }
        });
    };

    createAndSignTransaction(transactionOptions, secretPhraseHex) {
        const requests = [this.messageService.sendMessage(
          transactionOptions.senderPublicKey,
          transactionOptions.recipientRS,
          1,
          transactionOptions.data,
          transactionOptions.nonce,
          transactionOptions.recipientPublicKey,
          transactionOptions.prunable
        )];
        if (this.recipientImmutable && this.teamName !== '') {
            this.daoService.getTeamMembers(this.teamName).subscribe(teamMembers => {
                if (teamMembers.length > 10) {
                    alertFunctions.InfoAlertBox(
                      'Warning',
                      'There are more than 10 team members!',
                      'OK',
                      'warning'
                    ).then();
                }
                const teamMembersWallets = teamMembers.map(teamMember => teamMember.aliasURI.split('acct:').pop().split('@xin').shift());
                const teamMembersAccountsRequests = [];
                teamMembersWallets.map(wallet => {
                    teamMembersAccountsRequests.push(this.messageService.getAccountDetails(wallet));
                });
                const senderPublicKey = this.messageService.getAccountDetailsFromSession('publicKey');

                forkJoin(teamMembersAccountsRequests).subscribe(resp => {
                    resp.map((recipient: any) => {
                        const recipientRS = recipient.accountRS;
                        let fee = 1; // sendForm.fee;
                        const secret = this.sendMessageForm.secretPhrase;
                        const message = this.sendMessageForm.message;
                        const pubkey = this.sendMessageForm.pubkey;
                        const prunable = this.sendMessageForm.prunable;
                        let hasPublicKeyAdded = false;
                        let hasMessageAdded = false;
                        let hasSecretAdded = false;
                        if (pubkey && pubkey.length > 0) {
                            hasPublicKeyAdded = true;
                        }
                        if (message && message.length > 0) {
                            hasMessageAdded = true;
                        }
                        if (secret && secret.length > 0) {
                            hasSecretAdded = true;
                        }
                        if (!fee) {
                            fee = 1;
                        }
                        this.hasPublicKeyAdded = hasPublicKeyAdded;
                        this.hasMessageAdded = hasMessageAdded;

                        let recipientPublicKey = recipient.publicKey;
                        if (!recipientPublicKey && hasPublicKeyAdded) {
                            recipientPublicKey = pubkey;
                        }
                        if (!recipient.errorCode || recipient.errorCode === 5) {
                            if (!recipientPublicKey && !hasPublicKeyAdded && hasMessageAdded) {
                                const title: string = this.commonService.translateAlertTitle('Error');
                                const msg: string =
                                  this.commonService.translateInfoMessage('send-simple-account-outbound-transaction-info-msg');
                                alertFunctions.InfoAlertBox(title,
                                  msg,
                                  'OK',
                                  'error').then(() => {
                                });
                                return;
                            }

                            let encrypted = { data: '', nonce: '' };
                            if (hasMessageAdded) {
                                if (!recipientPublicKey) {
                                    recipientPublicKey = pubkey;
                                }
                                encrypted = this.cryptoService.encryptMessage(message, secretPhraseHex, recipientPublicKey);
                            }

                            const transOptions = {
                                'senderPublicKey': senderPublicKey,
                                'recipientRS': recipientRS,
                                'fee': fee,
                                'data': encrypted.data,
                                'nonce': encrypted.nonce,
                                'recipientPublicKey': recipientPublicKey,
                                'prunable': prunable,
                            };
                            requests.push(
                              this.messageService.sendMessage(
                                transOptions.senderPublicKey,
                                transOptions.recipientRS,
                                1,
                                transOptions.data,
                                transOptions.nonce,
                                transOptions.recipientPublicKey,
                                transOptions.prunable
                              ));

                            if (this.encrypted.data === '') {
                                this.encrypted = '';
                            }

                        } else {
                            const title: string = this.commonService.translateAlertTitle('Error');
                            const errMsg: string = this.commonService.translateErrorMessageParams( 'sorry-error-occurred',
                              recipient);
                            alertFunctions.InfoAlertBox(title,
                              errMsg,
                              'OK',
                              'error').then((isConfirm: any) => {
                            });
                        }
                    });
                    forkJoin(requests).subscribe((success_) => {
                        forkJoin(success_).subscribe((success: any[]) => {
                            success.map((s: any, index ) => {
                                if (index === 0) {
                                    if (!s.errorCode) {
                                        const unsignedBytes = s.unsignedTransactionBytes;
                                        const signatureHex = this.cryptoService.signatureHex(unsignedBytes, secretPhraseHex);
                                        const transactionBytes = this.cryptoService.signTransactionHex(unsignedBytes, signatureHex);

                                        this.transactionBytes = transactionBytes;

                                        this.tx_fee = s.transactionJSON.feeTQT / 100000000;
                                        this.tx_amount = s.transactionJSON.amountTQT / 100000000;
                                        this.tx_total = this.tx_fee + this.tx_amount;

                                        this.prunableAttachmentJSON = s.transactionJSON.attachment;
                                        this.prunableAttachmentString = JSON.stringify(s.transactionJSON.attachment);

                                        this.validBytes = true;

                                        return transactionBytes;
                                    } else {
                                        const title: string = this.commonService.translateAlertTitle('Error');
                                        const errMsg: string = this.commonService.translateErrorMessageParams( 'sorry-error-occurred',
                                          s);
                                        alertFunctions.InfoAlertBox(title,
                                          errMsg,
                                          'OK',
                                          'error').then(() => {
                                        });
                                    }
                                } else {
                                    const unsignedBytes = s.unsignedTransactionBytes;
                                    const signatureHex = this.cryptoService.signatureHex(unsignedBytes, secretPhraseHex);
                                    const transactionBytes = this.cryptoService.signTransactionHex(unsignedBytes, signatureHex);

                                    this.transactionsToBroadcast.push(transactionBytes);
                                }
                            })
                        });
                    });
                });
            });
        }
    };

    getAndVerifyAccount(sendTokenForm) {

        const recipientRS = this.sendMessageForm.recipientRS;
        let fee = 1; // sendForm.fee;
        const secret = this.sendMessageForm.secretPhrase;

        const message = this.sendMessageForm.message;
        const pubkey = this.sendMessageForm.pubkey;
        const prunable = this.sendMessageForm.prunable;

        let hasPublicKeyAdded = false;
        let hasMessageAdded = false;
        let hasSecretAdded = false;

        if (pubkey && pubkey.length > 0) {
            hasPublicKeyAdded = true;
        }
        if (message && message.length > 0) {
            hasMessageAdded = true;
        }
        if (secret && secret.length > 0) {
            hasSecretAdded = true;
        }

        if (!fee) {
            fee = 1;
        }

        this.hasPublicKeyAdded = hasPublicKeyAdded;
        this.hasMessageAdded = hasMessageAdded;

        const senderPublicKey = this.messageService.getAccountDetailsFromSession('publicKey');
        let secretPhraseHex;
        if (hasSecretAdded) {
            secretPhraseHex = this.cryptoService.secretPhraseToPrivateKey(secret);
        } else {
            secretPhraseHex = this.sessionStorageService.getFromSession(AppConstants.loginConfig.SESSION_ACCOUNT_PRIVATE_KEY);
        }

        this.messageService.getAccountDetails(recipientRS).subscribe((success: any) => {

            let recipientPublicKey = success.publicKey;

            if (!recipientPublicKey && hasPublicKeyAdded) {
                recipientPublicKey = pubkey;
            }

            if (!success.errorCode || success.errorCode === 5) {

                this.accountDetails = success;

                if (!recipientPublicKey && !hasPublicKeyAdded && hasMessageAdded) {
                    const title: string = this.commonService.translateAlertTitle('Error');
                    const msg: string = this.commonService.translateInfoMessage('send-simple-account-outbound-transaction-info-msg');
                    alertFunctions.InfoAlertBox(title,
                        msg,
                        'OK',
                        'error').then(() => {
                        });
                    return;
                }

                let encrypted = { data: '', nonce: '' };
                if (hasMessageAdded) {
                    if (!recipientPublicKey) {
                        recipientPublicKey = pubkey;
                    }
                    encrypted = this.cryptoService.encryptMessage(message, secretPhraseHex, recipientPublicKey);
                    this.encrypted = JSON.stringify(encrypted);
                } else {
                    this.encrypted = encrypted;
                }

                const transactionOptions = {
                    'senderPublicKey': senderPublicKey,
                    'recipientRS': recipientRS,
                    'fee': fee,
                    'data': encrypted.data,
                    'nonce': encrypted.nonce,
                    'recipientPublicKey': recipientPublicKey,
                    'prunable': prunable,
                };

                this.createAndSignTransaction(transactionOptions, secretPhraseHex);

                if (this.encrypted.data === '') {
                    this.encrypted = '';
                }

            } else {
                const title: string = this.commonService.translateAlertTitle('Error');
                const errMsg: string = this.commonService.translateErrorMessageParams( 'sorry-error-occurred',
                success);
                alertFunctions.InfoAlertBox(title,
                    errMsg,
                    'OK',
                    'error').then((isConfirm: any) => {
                    });
            }
        });
    };

    broadcastMessage(transactionBytes, prunableAttachmentJSON) {
        forkJoin([
            this.messageService.broadcastMessage(transactionBytes, prunableAttachmentJSON),
          ...this.transactionsToBroadcast.map(transaction => this.messageService.broadcastMessage(transaction, prunableAttachmentJSON))
        ]).subscribe((success: any) => {
            if (!success[0].errorCode) {
                const title: string = this.commonService.translateAlertTitle('Success');
                let msg: string = this.commonService.translateInfoMessage('success-broadcast-message');
                msg += success[0].transaction;
                alertFunctions.InfoAlertBox(title,
                    msg,
                    'OK',
                    'success').then((isConfirm: any) => {
                        if (this.recipientImmutable) {
                            this._location.back();
                            return;
                        }
                        this.router.navigate(['/account/transactions/pending']);
                    });
            } else {
                const title: string = this.commonService.translateAlertTitle('Error');
                const errMsg: string = this.commonService.translateErrorMessage('unable-broadcast-transaction', success[0]);
                alertFunctions.InfoAlertBox(title,
                    errMsg,
                    'OK',
                    'error').then((isConfirm: any) => {
                    });
            }

        });
    };

}
