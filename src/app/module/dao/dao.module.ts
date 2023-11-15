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
import {DaoComponent} from './dao.component';
import {CreateTeamComponent} from './create-team/create-team.component';
import {FoundersComponent} from './founders/founders.component';
import {ApprovalAccountsComponent} from './approval-accounts/approval-accounts.component';
import {TeamMembersComponent} from './team-members/team-members.component';
import { ShowTeamsComponent } from './show-teams/show-teams.component';

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
        CreateDaoComponent,
        DaoComponent,
        CreateTeamComponent,
        FoundersComponent,
        ApprovalAccountsComponent,
        TeamMembersComponent,
        ShowTeamsComponent
    ],
    providers: [
        AliasesService,
        AssetsService,
        DaoService,
        ArchwizardModule
    ],
    entryComponents: [DaoComponent, CreateDaoComponent, FoundersComponent, ApprovalAccountsComponent, CreateTeamComponent, TeamMembersComponent]
})
export class DaoModule {
}
