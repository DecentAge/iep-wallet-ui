import {Component, OnInit} from '@angular/core';
import {ROUTES} from './sidebar-routes.config';
import {ActivatedRoute, Router} from '@angular/router';
import {TranslateService} from '@ngx-translate/core';
import {LoginService} from '../../services/login.service';
import {RootScope} from '../../config/root-scope';
import {OptionService} from '../../services/option.service';

declare var $: any;

@Component({
    selector: 'app-sidebar',
    templateUrl: './sidebar.component.html',
    styleUrls: ['./sidebar.component.scss']
})

export class SidebarComponent implements OnInit {
    public menuItems: any[];
    public isExpertWallet: boolean;
    idArray = [];
    balanceTQT: any;

    options: any = {};

    $sidebar;
    $sidebar_content;
    $sidebar_img;
    $sidebar_img_container;
    $wrapper;

    openListItems;

    constructor(private router: Router,
                private route: ActivatedRoute,
                public translate: TranslateService,
                public loginService: LoginService,
                public optionService: OptionService,
    ) {
        this.balanceTQT = 0;

        this.$sidebar = $('.app-sidebar');
        this.$sidebar_content = $('.sidebar-content');
        this.$sidebar_img = this.$sidebar.data('image');
        this.$sidebar_img_container = $('.sidebar-background');
        this.$wrapper = $('.wrapper');
    }

    ngOnInit() {
        $.getScript('./assets/js/app-sidebar.js');
        this.menuItems = ROUTES.filter(menuItem => menuItem);
        this.isExpertWallet = this.loginService.isExpertWallet;

        RootScope.onChange.subscribe(data => {
            this.balanceTQT = data['balanceTQT'];
            this.options = data['options'];
        })
    }

    switchWallet() {
        this.idArray = [];
        this.idArray = $('.sidebar-content li.open').map(function () {
            return this.id;
        }).get();

        this.loginService.isExpertWallet = !this.isExpertWallet;
        this.loginService.applyChanges();
    }

    triggerClick() {
        $('ui-switch').trigger('click');
    }

    toggle($e, t) {

        var $this = $(t),
            listItem = $this.parent('li');

        if (listItem.hasClass('has-sub') && listItem.hasClass('open')) {
            this.collapse(listItem);
        }
        else {
            if (listItem.hasClass('has-sub')) {
                this.expand(listItem);
            }

            // If menu collapsible then do not take any action
            if (this.$sidebar_content.data('collapsible')) {
                return false;
            }
            // If menu accordion then close all except clicked once
            else {
                this.openListItems = listItem.siblings('.open');
                this.collapse(this.openListItems);
                listItem.siblings('.open').find('li.open').removeClass('open');
            }
        }
    }

    collapse($listItem) {
        var $subList = $listItem.children('ul');

        $(this).css('display', '');

        $(this).find('> li').removeClass('is-shown');

        $listItem.removeClass('open');
    }

    expand($listItem) {
        var $subList = $listItem.children('ul');
        var $children = $subList.children('li').addClass('is-hidden');

        $listItem.addClass('open');

        $(this).css('display', '');

        setTimeout(function () {
            $children.addClass('is-shown');
            $children.removeClass('is-hidden');
        }, 0);
    }

    //NGX Wizard - skip url change
    ngxWizardFunction(path: string) {
        if (path.indexOf('forms/ngx') !== -1)
            this.router.navigate(['forms/ngx/wizard'], {skipLocationChange: false});
    }
}
