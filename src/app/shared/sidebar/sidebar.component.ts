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
        //$.getScript('./assets/js/app-sidebar.js');
        this.menuItems = ROUTES.filter(menuItem => menuItem);
        this.isExpertWallet = this.loginService.isExpertWallet;

        RootScope.onChange.subscribe(data => {
            this.balanceTQT = data['balanceTQT'];
            this.options = data['options'];
        });

        this.registerSidebarScripts();
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

    registerSidebarScripts() {
        const $sidebar = $('.app-sidebar');
        const $wrapper = $('.wrapper');
        const that = this;

        if ($(window).width() < 992) {
            $sidebar.addClass('hide-sidebar');
            $wrapper.removeClass('nav-collapsed menu-collapsed');
        }
        $(window).resize(function () {
            if ($(window).width() < 992) {
                $sidebar.addClass('hide-sidebar');
                $wrapper.removeClass('nav-collapsed menu-collapsed');
            }
            if ($(window).width() > 991) {
                $sidebar.removeClass('hide-sidebar');
                if ($('.toggle-icon').attr('data-toggle') === 'collapsed' && $wrapper.not('.nav-collapsed menu-collapsed')) {
                    $wrapper.addClass('nav-collapsed menu-collapsed');
                }
            }
        });

        $('.navbar-toggle-1').on('click', function (e) {
            e.stopPropagation();
            $sidebar.toggleClass('hide-sidebar');
        });

        $('.logo-text').on('click', function () {
            let $sidebar_content = $('.sidebar-content');
            var listItem = $sidebar_content.find('li.open.has-sub'),
                activeItem = $sidebar_content.find('li.active');
            let openItem;

            if (listItem.hasClass('has-sub') && listItem.hasClass('open')) {
                that.collapse(listItem);
                listItem.removeClass('open');
                if (activeItem.closest('li.has-sub')) {
                    openItem = activeItem.closest('li.has-sub');
                    that.expand(openItem);
                    openItem.addClass('open');
                }
            }
            else {
                if (activeItem.closest('li.has-sub')) {
                    openItem = activeItem.closest('li.has-sub');
                    that.expand(openItem);
                    openItem.addClass('open');
                }
            }
        });

        $(document).on('click', '.navigation li:not(.has-sub):not(.wallet-switch)', function () {
            if ($(window).width() < 992) {
                $sidebar.addClass('hide-sidebar');
            }
        });

        $(document).on('click', '.logo-text', function () {
            if ($(window).width() < 992) {
                $sidebar.addClass('hide-sidebar');
            }
        });

        $('html').on('click', function (e) {
            if ($(window).width() < 992) {
                if (!$sidebar.hasClass('hide-sidebar') && $sidebar.has(e.target).length === 0) {
                    $sidebar.addClass('hide-sidebar');
                }
            }
        });

        $('#sidebarClose').on('click', function () {
            $sidebar.addClass('hide-sidebar');
        });

        $('.noti-list').perfectScrollbar();
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
