import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {DaoRoutingModule} from './dao-routing.module';
import {DaoService} from './dao.service';
import {NgxDatatableModule} from '@swimlane/ngx-datatable';
import {SharedModule} from '../../shared/shared.module';
import {FormsModule} from '@angular/forms';
import {ArchwizardModule} from 'angular-archwizard';
import {AliasesService} from '../aliases/aliases.service';
import {ShowDaosComponent} from './show-daos/show-daos.component';
import {CreateDaoComponent} from './create-dao/create-dao.component';
import {AssetsService} from '../assets/assets.service';

@NgModule({
    imports: [
        CommonModule,
        DaoRoutingModule,
        NgxDatatableModule,
        SharedModule,
        FormsModule,
        ArchwizardModule
    ],
    declarations: [
        ShowDaosComponent,
        CreateDaoComponent
    ],
    providers: [
        AliasesService,
        AssetsService,
        DaoService
    ]
})
export class DaoModule {
}
