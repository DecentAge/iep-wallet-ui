import { Component, OnInit } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../shared/auth/auth.service';
import * as alertFunctions from '../../shared/data/sweet-alerts';
import { OptionService } from '../../services/option.service';
import { Router } from '@angular/router';
import { LoginService } from '../../services/login.service';
import { AccountService } from '../../module/account/account.service';
import { SubscriptionService } from '../../module/subscriptions/subscription.service';
import { EscrowService } from '../../module/escrow/escrow.service';
import { CommonService } from '../../services/common.service';
import { ExtensionsService } from '../../module/extensions/extensions.service';
import { AddressService } from '../../module/account/address.service';
import { SwappService } from '../../services/swapp.service';

@Component({
    selector: 'app-navbar',
    templateUrl: './navbar.component.html',
    styleUrls: ['./navbar.component.scss']
})
export class NavbarComponent implements OnInit {
    currentLang = 'en';
    toggleClass = 'ft-maximize';
    connectionMode: string;
    approvals: any = 0;
    escrows: any = 0;
    subscriptions: any = 0;
    news_content: any = [];

    public isExpertWallet: boolean;
    public isMobile: boolean;

    constructor(
        public translate: TranslateService,
        public authService: AuthService,
        public optionService: OptionService,
        public router: Router,
        public loginService: LoginService,
        private accountService: AccountService,
        private commonsService: CommonService,
        private extensionsService: ExtensionsService,
        private escrowService: EscrowService,
        private subscriptionService: SubscriptionService,
        public addressService: AddressService,
        public swappService: SwappService
    ) {
        this.isMobile = false;
        const ua = navigator.userAgent;
        if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i.test(ua)) {
            this.isMobile = true;
        }
        this.optionService.optionsChanged$.subscribe(res => {
            this.ngOnInit();
        });
    }

    ngOnInit() {
        this.isExpertWallet = this.loginService.isExpertWallet;
        this.getBadges();
    }

    reload() {
        window.location.reload();
    }

    getBadges() {
        const accountRs = this.commonsService.getAccountDetailsFromSession(
            'accountRs'
        );
        this.accountService.getVoterPhasedTransactions(accountRs, '', '').subscribe(
            success => {
                const approvals = success['transactions'];
                this.approvals = approvals ? approvals.length : 0;
            },
            error => {
                this.approvals = 0;
            }
        );

        this.escrowService
            .getAccountEscrowTransactions(accountRs, '', '')
            .subscribe(
                success => {
                    const escrow = success['escrows'];
                    this.escrows = escrow ? escrow.length : 0;
                },
                error => {
                    this.escrows = 0;
                }
            );

        this.subscriptionService
            .getAccountSubscriptions(accountRs, '', '')
            .subscribe(
                success => {
                    const subscription = success['subscriptions'];
                    this.subscriptions = subscription ? subscription.length : 0;
                },
                (error) => {
                    this.subscriptions = 0;
                }
            );
    }
    getLatestNews() {
        this.extensionsService.getNews().subscribe(
            success => {
                this.news_content = success;
            },
            error => { }
        );
    }

    ChangeLanguage(language: string) {
        this.translate.use(language);
    }

    ToggleClass() {
        if (this.toggleClass === 'ft-maximize') {
            this.toggleClass = 'ft-minimize';
        } else {
            this.toggleClass = 'ft-maximize';
        }
    }

    acconutControl() {
        this.router.navigate(['account/control']).then();
    }

    myEscrow() {
        this.router.navigate(['escrow/my-escrow']).then();
    }

    mySubscription() {
        this.router.navigate(['subscriptions/my-subscriptions']).then();
    }

    newFoundation() {
        this.router.navigate(['extensions/newsviewer']).then();
    }

    sendToken() {
        this.router.navigate(['account/send']).then();
    }

    sendMessage() {
        this.router.navigate(['messages/send-message']).then();
    }

    sendAssets() {
        this.router.navigate(['assets/send-assets']).then();
    }

    showMyDaos() {
        this.router.navigate(['dao/show-daos/mobile']).then();
    }

    sendCurrency() {
        this.router.navigate(['currencies/send-currencies']).then();
    }

    openBookMarks() {
        this.router.navigate(['account/bookmark']).then();
    }

    logout() {
        let title: string;
        let text: string;
        let inputPlaceholder: string;
        let confirmButtonText: string;
        let cancelButtonText: string;
        this.translate.get('tool-pages.log-out').subscribe((res: any) => {
            title = res.title;
            text = res.text;
            inputPlaceholder = res.inputPlaceholder;
            confirmButtonText = res.confirmButtonText;
            cancelButtonText = res.cancelButtonText;
        });
        alertFunctions
            .confirmLogoutButton(
                title,
                text,
                inputPlaceholder,
                confirmButtonText,
                cancelButtonText
            )
            .then(
                result => {
                    if (result.value === 0 || result.value === 1) {
                        if (result.value === 1) {
                            // clear localstorage
                            const publicKey = this.commonsService.getAccountDetailsFromSession('publicKey');
                            this.swappService.clearSwapps();
                            this.optionService.clearOptions(
                                publicKey,
                                success => { },
                                error => { }
                            );
                            this.addressService.clearContacts(
                                publicKey,
                                success => { },
                                error => { }
                            );
                        }
                        setTimeout(() => {
                            this.authService.logout();
                        }, 500);
                    }
                },
                () => { }
            );
    }
}
