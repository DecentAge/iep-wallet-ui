import {Injectable} from '@angular/core';
import {HttpProviderService} from '../../services/http-provider.service';
import {NodeService} from '../../services/node.service';
import {AppConstants} from '../../config/constants';
import {OptionService} from '../../services/option.service';
import {SessionStorageService} from '../../services/session-storage.service';
import {TransactionService} from '../../services/transaction.service';
import {map} from 'rxjs/operators';
import {VotingModels} from './enums';
import {NavigationExtras, Router} from '@angular/router';

@Injectable()
export class VotingService {

    constructor(
        private http: HttpProviderService,
        private nodeService: NodeService,
        private optionsService: OptionService,
        private sessionStorageService: SessionStorageService,
        private transactionService: TransactionService,
        private router: Router
    ) {

    }

    getPolls(firstIndex, lastIndex, includeFinished) {
        const params = {
            'requestType': 'getAllPolls',
            'firstIndex': firstIndex,
            'lastIndex': lastIndex,
            'includeFinished': includeFinished
        };

        return this.http.get(this.nodeService.getNodeUrl(), AppConstants.pollConfig.pollEndPoint, params);
    }

    getAllPolls() {
        const params = {
            'requestType': 'getAllPolls',
            'includeFinished': true
        };

        return this.http.get(this.nodeService.getNodeUrl(), AppConstants.pollConfig.pollEndPoint, params).pipe(
            map((pollsResponse: any) => pollsResponse.polls.filter(poll => poll.votingModel === VotingModels.Asset))
        );
    }

    getAccountPolls(account, firstIndex, lastIndex, includeFinished) {
        const params = {
            'requestType': 'getPolls',
            'account': account,
            'firstIndex': firstIndex,
            'lastIndex': lastIndex,
            'includeFinished': includeFinished
        };

        return this.http.get(this.nodeService.getNodeUrl(), AppConstants.pollConfig.pollEndPoint, params);
    }

    getPoll(pollId) {
        const params = {
            'requestType': 'getPoll',
            'poll': pollId
        };

        return this.http.get(this.nodeService.getNodeUrl(), AppConstants.pollConfig.pollEndPoint, params);
    }

    getPollData(pollId) {
        const params = {
            'requestType': 'getPollResult',
            'poll': pollId
        };

        return this.http.get(this.nodeService.getNodeUrl(), AppConstants.pollConfig.pollEndPoint, params);
    }

    searchPolls(query, firstIndex, lastIndex) {
        const params = {
            'requestType': 'searchPolls',
            'query': query,
            'includeFinished': true,
            'firstIndex': firstIndex,
            'lastIndex': lastIndex
        };

        return this.transactionService.createTransaction(params, {}, {});
    }

    castVote(publicKey, pollId, optionNames, fee) {
        const params = {
            'publicKey': publicKey,
            'requestType': 'castVote',
            'poll': pollId,
            'feeTQT': parseInt('' + fee * AppConstants.baseConfig.TOKEN_QUANTS, 10),
            'broadcast': 'false',
            'deadline': this.optionsService.getOption('DEADLINE', publicKey)
        };
        optionNames.map((option, index) => {
            params[optionNames[index]] = '1';
        });

        return this.transactionService.createTransaction(params, {}, {});
    }

    getOptionNames(pollOptions, votedOptions) {
        return votedOptions.map((votedOption) =>  {
            const index = pollOptions.indexOf(votedOption);
            return this.getOptionNameFormat(index);
        });
    }

    getOptionName(number) {
        return number > 9 ? 'option' + number : 'option0' + number;
    }

    createPoll(pollJson) {
        let params  = {
            'requestType': 'createPoll',
            'publicKey': pollJson.publicKey,
            'name': pollJson.name,
            'description': pollJson.description,
            'feeTQT': parseInt('' + pollJson.fee * AppConstants.baseConfig.TOKEN_QUANTS, 10),
            'deadline': this.optionsService.getOption('DEADLINE', pollJson.publicKey),
            'broadcast': 'false',
            'minNumberOfOptions': pollJson.minNumberOfOptions,
            'maxNumberOfOptions': pollJson.maxNumberOfOptions,
            'minRangeValue': pollJson.minRangeValue,
            'maxRangeValue': pollJson.maxRangeValue,
            'minBalanceModel': pollJson.minBalanceModel,
            'minBalance': pollJson.minBalance,
            'finishHeight': pollJson.finishHeight,
            'votingModel': pollJson.votingModel
        };

        if (pollJson.holding) {
            params['holding'] = pollJson.holding;
        }

        params = this.fillOptionsToJson(params, pollJson.options);

        const hasPhasing = this.sessionStorageService.getFromSession(AppConstants.controlConfig.SESSION_ACCOUNT_CONTROL_HASCONTROL_KEY);

        if (hasPhasing) {
            const currentPhasingFinishHeight = AppConstants.DEFAULT_OPTIONS.TX_HEIGHT + pollJson.currentHeight;
            if (currentPhasingFinishHeight > parseInt(pollJson.finishHeight, 10)) {
                params['phasingFinishHeight'] = parseInt(pollJson.finishHeight, 10) - 1000;
            }
        }

        return this.transactionService.createTransaction(params, {}, {});
    }

    getPollVotes(pollId, firstIndex, lastIndex) {
        const params = {
            'requestType': 'getPollVotes',
            'poll': pollId,
            'includeWeights': 'true',
            'firstIndex': firstIndex,
            'lastIndex': lastIndex,
            'includeFinished': true
        };

        return this.http.get(this.nodeService.getNodeUrl(), AppConstants.pollConfig.pollEndPoint, params);
    }

    fillOptionsToJson(pollJson, pollOptions) {
        if (pollOptions) {
            const length = pollOptions.length;
            for (let i = 0; i < length; i++) {
                pollJson[this.getOptionName(i)] = pollOptions[i];
            }
        }
        return pollJson;
    }

    getOptionNameFormat(i) {
        if (i !== -1) {
            return i > 9 ? 'vote' + i : 'vote0' + i;
        }
    }

    getDaoTeamTokens(daoName) {
        const params = {
            'requestType': 'searchAssets',
            'query': `${daoName}TT*`,
        };

        return this.http.get(this.nodeService.getNodeUrl(), AppConstants.aliasesConfig.aliasesEndPoint, params);
    }

    detailsActions(event) {
        const navigationExtras: NavigationExtras = {
            queryParams: {
                id: event.poll
            }
        };
        switch (event.action) {
            case 'result':
                this.router.navigate(['/voting/show-polls/result'], navigationExtras).then();
                break;
            case 'details':
                this.router.navigate(['/voting/show-polls/details'], navigationExtras).then();
                break;
            case 'vote':
                this.router.navigate(['/voting/show-polls/vote'], navigationExtras).then();
                break;
            case 'voters':
                this.router.navigate(['/voting/show-polls/voters'], navigationExtras).then();
                break;
        }
    }

    getDays(value) {
        const currentHeight = this.sessionStorageService.getFromSession(AppConstants.baseConfig.SESSION_CURRENT_BLOCK);
        let days: number;

        if (currentHeight && currentHeight < value) {
            days = (parseInt(value, 10) - currentHeight) / 1440;
        } else {
            days = 0;
        }

        if (days < 0) {
            days = 0;
        }

        return days.toLocaleString('en-US', {maximumFractionDigits: 2, minimumFractionDigits: 2});
    }
}
