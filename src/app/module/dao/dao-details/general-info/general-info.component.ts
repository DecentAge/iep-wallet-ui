import {Component, OnInit} from '@angular/core';
import {AccountService} from '../../../account/account.service';
import {AssetsService} from '../../../assets/assets.service';
import {DaoService} from '../../dao.service';
import {ActivatedRoute, Router} from '@angular/router';
import {Page} from '../../../../config/page';
import {ShowDaosMode} from '../../enums';

@Component({
    selector: 'app-general-info',
    templateUrl: './general-info.component.html',
    styleUrls: ['./general-info.component.scss']
})
export class GeneralInfoComponent implements OnInit {

    public page = new Page();
    public rows = new Array<any>();
    public daoName = '';
    public teamTokens;
    public accountRs;
    public editMode = false;
    public webPageUrl;
    public chatChannelUrl;
    public sharedDataLinkUrl;
    public sharedDataLinkAlias;
    public webPageUrlAlias;
    public chatChannelUrlAlias;
    public daoAccountRs = null;
    public viewMode: ShowDaosMode;

    constructor(
        private accountService: AccountService,
        private assetsService: AssetsService,
        private daoService: DaoService,
        private router: Router,
        private route: ActivatedRoute,
    ) {
    }

    ngOnInit() {
        this.daoName = DaoService.currentDAO;
        this.viewMode = DaoService.showDaoMode;
        this.daoService.getDAOAlias(this.daoName).subscribe((alias: any) => {
            this.daoAccountRs = alias.accountRS;
        });
        this.accountRs = this.accountService.getAccountDetailsFromSession('accountRs');
        this.daoService.getDaoExternalLinks(this.daoName).subscribe((response) => {
            if (response.webPageUrl.length > 0) {
                this.webPageUrlAlias = response.webPageUrl.shift()
                this.webPageUrl = this.webPageUrlAlias.aliasURI.split('url:').pop().split('@xin').shift();
            }
            if (response.chatChannel.length > 0) {
                this.chatChannelUrlAlias = response.chatChannel.shift();
                this.chatChannelUrl = this.chatChannelUrlAlias.aliasURI.split('url:').pop().split('@xin').shift();
            }
            if (response.sharedDataLink.length > 0) {
                this.sharedDataLinkAlias = response.sharedDataLink.shift();
                this.sharedDataLinkUrl = this.sharedDataLinkAlias.aliasURI.split('url:').pop().split('@xin').shift();
            }
        });
    }

    toggleEditMode() {
        this.editMode = !this.editMode;
    }

    updateExternalDaoInfo() {
        this.daoService.updateExternalDaoInfo(this.daoName, this.webPageUrl, this.chatChannelUrl, this.sharedDataLinkUrl);
        this.editMode = false;
    }
}
