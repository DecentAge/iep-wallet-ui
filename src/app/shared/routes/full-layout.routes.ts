import { Routes, RouterModule } from '@angular/router';

// Route for content layout with sidebar, navbar and footer.

export const FULL_ROUTES: Routes = [
    {
        path: 'dashboard',
        loadChildren: () => import('../../module/dashboard/dashboard.module').then(m => m.DashboardModule)
    },
    {
        path: 'account',
        loadChildren: () => import('../../module/account/account.module').then(m => m.AccountModule)
    },
    {
        path: 'messages',
        loadChildren: () => import('../../module/message/message.module').then(m => m.MessageModule)
    },
    {
        path: 'voting',
        loadChildren: () => import('../../module/voting/voting.module').then(m => m.VotingModule)
    },
    {
        path: 'wallet-settings',
        loadChildren: () => import('../../module/swapps/swapps.module').then(m => m.SwappsModule)
    },
    {
        path: 'assets',
        loadChildren: () => import('../../module/assets/assets.module').then(m => m.AssetsModule)
    },
    {
        path: 'aliases',
        loadChildren: () => import('../../module/aliases/aliases.module').then(m => m.AliasesModule)
    },
    {
        path: 'at',
        loadChildren: () => import('../../module/at/at.module').then(m => m.AtModule)
    },
    {
        path: 'crowdfunding',
        loadChildren: () => import('../../module/crowdfunding/crowdfunding.module').then(m => m.CrowdfundingModule)
    },
    {
        path: 'subscriptions',
        loadChildren: () => import('../../module/subscriptions/subscriptions.module').then(m => m.SubscriptionsModule)
    },
    {
        path: 'escrow',
        loadChildren: () => import('../../module/escrow/escrow.module').then(m => m.EscrowModule)
    },
    {
        path: 'shuffling',
        loadChildren: () => import('../../module/shuffling/shuffling.module').then(m => m.ShufflingModule)
    },
    {
        path: 'currencies',
        loadChildren: () => import('../../module/currencies/currencies.module').then(m => m.CurrenciesModule)
    },
    {
        path: 'tool',
        loadChildren: () => import('../../module/tools-pages/tools-pages.module').then(m => m.ToolsPagesModule)
    },
    {
        path: 'tools',
        loadChildren: () => import('../../module/extensions/extensions.module').then(m => m.ExtensionsModule)
    },
    {
        path: 'dao',
        loadChildren: () => import('../../module/dao/dao.module').then(m => m.DaoModule)
    }
];
