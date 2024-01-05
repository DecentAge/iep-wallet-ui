import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {ShowDaosComponent} from './show-daos/show-daos.component';
import {DaoComponent} from './dao.component';
import {ShowTeamsComponent} from './show-teams/show-teams.component';
import {CreateTeamsComponent} from './create-teams/create-teams.component';
import {AddTeamMembersComponent} from './team-members/add-team-members/add-team-members.component';
import {TeamMembersComponent} from './team-members/team-members.component';
import {ShowTeamMembersComponent} from './team-members/show-team-members/show-team-members.component';
import {ApprovalAccountsComponent} from './approval-accounts/approval-accounts.component';
import {AddTeamPollComponent} from './add-team-poll/add-team-poll.component';
import {ShowDaoPollsComponent} from './show-dao-polls/show-dao-polls.component';
import {PollsComponent} from '../voting/show-polls/polls/polls.component';

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
        component: ShowDaosComponent
    },
    {
        path: 'approval-accounts',
        component: ApprovalAccountsComponent
    },
    {
        path: 'show-daos/:daoName/teams',
        component: ShowTeamsComponent
    },
    {
        path: 'show-daos/:daoName/teams/:teamName',
        component: ShowTeamMembersComponent
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
