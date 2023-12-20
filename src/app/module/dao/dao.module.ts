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
import {FoundersComponent} from './founders/founders.component';
import {ApprovalAccountsComponent} from './approval-accounts/approval-accounts.component';
import {TeamMembersComponent} from './team-members/team-members.component';
import {ShowTeamsComponent} from './show-teams/show-teams.component';
import {CreateTeamsComponent} from './create-teams/create-teams.component';
import {CreateDaoTeamComponent} from './create-dao-team/create-dao-team.component';
import {AddTeamMembersComponent} from './team-members/add-team-members/add-team-members.component';
import {ShowTeamMembersComponent} from './team-members/show-team-members/show-team-members.component';

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
        CreateDaoTeamComponent,
        FoundersComponent,
        ApprovalAccountsComponent,
        TeamMembersComponent,
        ShowTeamsComponent,
        CreateTeamsComponent,
        AddTeamMembersComponent,
        ShowTeamMembersComponent
    ],
    providers: [
        AliasesService,
        AssetsService,
        DaoService,
        ArchwizardModule
    ],
    entryComponents: [
        AddTeamMembersComponent,
        ApprovalAccountsComponent,
        CreateDaoComponent,
        CreateDaoTeamComponent,
        CreateTeamsComponent,
        DaoComponent,
        FoundersComponent,
        TeamMembersComponent,
        ShowTeamMembersComponent
    ]
})
export class DaoModule {
}
