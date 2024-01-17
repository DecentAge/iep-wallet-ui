import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {ShowDaosComponent} from './show-daos/show-daos.component';
import {DaoComponent} from './dao.component';
import {CreateTeamsComponent} from './create-teams/create-teams.component';
import {TeamMembersComponent} from './team-members/team-members.component';
import {ShowTeamMembersComponent} from './team-members/show-team-members/show-team-members.component';
import {ApprovalAccountsComponent} from './approval-accounts/approval-accounts.component';
import {AddTeamPollComponent} from './add-team-poll/add-team-poll.component';
import {ShowDaoPollsComponent} from './show-dao-polls/show-dao-polls.component';
import {DaosComponent} from './show-daos/daos/daos.component';
import {ShowDaoDetailsComponent} from './dao-details/show-dao-details.component';
import {GeneralInfoComponent} from './dao-details/general-info/general-info.component';
import {TeamsComponent} from './dao-details/teams/teams.component';
import {DaoPollsComponent} from './dao-details/polls/dao-polls.component';
import {DaoMessagesComponent} from './dao-details/messages/dao-messages.component';
import {DaoTeamMembersComponent} from './team-members/show-team-members/dao-team-members/dao-team-members.component';
import {DaoTeamMessagesComponent} from './team-members/show-team-members/dao-team-messages/dao-team-messages.component';
import {DaoTeamPollsComponent} from './team-members/show-team-members/dao-team-polls/dao-team-polls.component';

const routes: Routes = [
    {
        path: 'create-dao',
        component: DaoComponent,
        data: {
            previousRoute: null,
            nextRoute: 'create-dao/add-founders'
        }
    },
    {
        path: 'create-dao/add-founders',
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
            nextRoute: 'create-dao/add-team-members'
        }
    },
    {
        path: 'create-dao/add-team-members',
        component: DaoComponent,
        data: {
            previousRoute: 'create-dao/create-team',
            nextRoute: null
        }
    },
    {
        path: 'show-daos',
        component: ShowDaosComponent,
        children: [
            {
                path: '',
                pathMatch: 'full',
                redirectTo: 'all'
            },
            {
                path: 'my',
                component: DaosComponent,
                data: {
                    mode: 'my'
                }
            },
            {
                path: 'mobile',
                component: DaosComponent,
                data: {
                    mode: 'mobile'
                }
            },
            {
                path: 'all',
                component: DaosComponent,
                data: {
                    mode: 'all'
                }
            }
        ]
    },
    {
        path: 'approval-accounts',
        component: ApprovalAccountsComponent
    },
    {
        path: 'show-daos/:mode/:daoName',
        component: ShowDaoDetailsComponent,
        children: [
            {
                path: '',
                pathMatch: 'full',
                redirectTo: 'general-info'
            },
            {
                path: 'general-info',
                component: GeneralInfoComponent
            },
            {
                path: 'teams',
                component: TeamsComponent
            },
            {
                path: 'messages',
                component: DaoMessagesComponent
            },
            {
                path: 'polls',
                component: DaoPollsComponent
            }
        ]
    },
    {
        path: 'show-daos/:mode/:daoName/teams/:teamName',
        component: ShowTeamMembersComponent,
        children: [
            {
                path: '',
                pathMatch: 'full',
                redirectTo: 'members'
            },
            {
                path: 'members',
                component: DaoTeamMembersComponent
            },
            {
                path: 'messages',
                component: DaoTeamMessagesComponent
            },
            {
                path: 'polls',
                component: DaoTeamPollsComponent
            }
        ]
    },
    {
        path: 'create-teams',
        component: CreateTeamsComponent
    },
    {
        path: 'add-team-members',
        component: TeamMembersComponent
    },
    {
        path: 'show-polls/:daoId',
        component: ShowDaoPollsComponent,
        data: {
            pollType: 'DAO',
            title: 'DAO Polls'
        }
    },
    {
        path: 'add-team-poll',
        component: AddTeamPollComponent
    }
];

@NgModule({
    imports: [RouterModule.forChild(routes)],
    exports: [RouterModule],
})
export class DaoRoutingModule {
}
