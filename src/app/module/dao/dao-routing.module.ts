import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {ShowDaosComponent} from './show-daos/show-daos.component';
import {DaoComponent} from './dao.component';

const routes: Routes = [
    {
        path: 'show-daos',
        component: ShowDaosComponent
    },
    {
        path: 'create-dao',
        component: DaoComponent,
        data: {
            previousRoute: null,
            nextRoute: 'create-dao/founders'
        }
    },
    {
        path: 'create-dao/founders',
        component: DaoComponent,
        data: {
            previousRoute: 'create-dao',
            nextRoute: 'create-dao/approval-accounts'
        }
    },
    {
        path: 'create-dao/approval-accounts',
        component: DaoComponent,
        data: {
            previousRoute: 'create-dao/founders',
            nextRoute: 'create-dao/create-team'
        }
    },
    {
        path: 'create-dao/create-team',
        component: DaoComponent,
        data: {
            previousRoute: 'create-dao/approval-accounts',
            nextRoute: 'create-dao/team-members'
        }
    },
    {
        path: 'create-dao/team-members',
        component: DaoComponent,
        data: {
            previousRoute: 'create-dao/create-team',
            nextRoute: null
        }
    },
];

@NgModule({
    imports: [RouterModule.forChild(routes)],
    exports: [RouterModule],
})
export class DaoRoutingModule {
}
