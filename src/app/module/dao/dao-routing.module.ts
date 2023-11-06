import {NgModule} from '@angular/core';
import {Routes, RouterModule} from '@angular/router';
import {CreateDaoComponent} from './create-dao/create-dao.component';
import {ShowDaosComponent} from './show-daos/show-daos.component';

const routes: Routes = [
    {
        path: 'show-daos',
        component: ShowDaosComponent,
    },
    {
        path: 'create-dao',
        component: CreateDaoComponent,
    },
    {
        path: '**',
        component: CreateDaoComponent
    }
];

@NgModule({
    imports: [RouterModule.forChild(routes)],
    exports: [RouterModule],
})
export class DaoRoutingModule {
}
