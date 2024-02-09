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
import {CreateTeamsComponent} from './create-teams/create-teams.component';
import {CreateDaoTeamComponent} from './create-dao-team/create-dao-team.component';
import {AddTeamMembersComponent} from './team-members/add-team-members/add-team-members.component';
import {ShowTeamMembersComponent} from './team-members/show-team-members/show-team-members.component';
import {SelectDaoTeamComponent} from './select-dao-team/select-dao-team.component';
import {AddTeamPollComponent} from './add-team-poll/add-team-poll.component';
import {ShowDaoPollsComponent} from './show-dao-polls/show-dao-polls.component';
import {PollsComponent} from '../voting/show-polls/polls/polls.component';
import {VotingModule} from '../voting/voting.module';
import {DaosComponent} from './show-daos/daos/daos.component';
import {ShowDaoDetailsComponent} from './dao-details/show-dao-details.component';
import {TeamsComponent} from './dao-details/teams/teams.component';
import {DaoMessagesComponent} from './dao-details/messages/dao-messages.component';
import {GeneralInfoComponent} from './dao-details/general-info/general-info.component';
import {DaoPollsComponent} from './dao-details/polls/dao-polls.component';
import {MessageService} from '../message/message.service';
import { DaoTeamMembersComponent } from './team-members/show-team-members/dao-team-members/dao-team-members.component';
import { DaoTeamMessagesComponent } from './team-members/show-team-members/dao-team-messages/dao-team-messages.component';
import { DaoTeamPollsComponent } from './team-members/show-team-members/dao-team-polls/dao-team-polls.component';

@NgModule({
    imports: [
        CommonModule,
        DaoRoutingModule,
        NgxDatatableModule,
        SharedModule,
        FormsModule,
        ArchwizardModule,
        VotingModule
    ],
    declarations: [
        ShowDaosComponent,
        CreateDaoComponent,
        DaoComponent,
        CreateDaoTeamComponent,
        FoundersComponent,
        ApprovalAccountsComponent,
        TeamMembersComponent,
        ShowDaoDetailsComponent,
        CreateTeamsComponent,
        AddTeamMembersComponent,
        ShowTeamMembersComponent,
        SelectDaoTeamComponent,
        AddTeamPollComponent,
        ShowDaoPollsComponent,
        DaosComponent,
        TeamsComponent,
        GeneralInfoComponent,
        DaoMessagesComponent,
        DaoPollsComponent,
        DaoTeamMembersComponent,
        DaoTeamMessagesComponent,
        DaoTeamPollsComponent
    ],
    providers: [
        AliasesService,
        ArchwizardModule,
        AssetsService,
        DaoService,
        MessageService
    ],
    entryComponents: [
        AddTeamMembersComponent,
        AddTeamPollComponent,
        ApprovalAccountsComponent,
        CreateDaoComponent,
        CreateDaoTeamComponent,
        CreateTeamsComponent,
        DaoComponent,
        FoundersComponent,
        TeamMembersComponent,
        ShowTeamMembersComponent,
        ShowDaoPollsComponent,
        PollsComponent
    ]
})
export class DaoModule {
}
