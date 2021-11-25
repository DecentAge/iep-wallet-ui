import {Component, OnInit, ViewEncapsulation} from '@angular/core';
import { NodeService } from '../../services/node.service';
import { LocalhostService } from '../../services/localhost.service';

@Component({
    selector: 'app-sync-progress',
    templateUrl: './progress.component.html',
    styleUrls: ['./progress.component.scss'],
    encapsulation: ViewEncapsulation.None
})
export class ProgressSyncComponent implements OnInit {

    timerId: any;
    peerState: null;

    totalProgress: number;
    blocksLeft: number;
    estimate: string;

    estimateTimeStart: number;
    estimateBlocksStart: number;

    hidden: boolean;

    dots: string;

    constructor(
        public localhostService: LocalhostService,
        public nodeService: NodeService
    ) {
        this.totalProgress = 0;
        this.blocksLeft = 0;
        this.dots = '';
        this.estimate = 'calculating...';

        const getPeerState = (delay = 5000) => {
            this.timerId = setTimeout(() => {
                this.updateProgress();

                if (this.blocksLeft !== 0) {
                    getPeerState();
                }
            }, delay);
        };

        getPeerState(0);
    }

    ngOnInit() {
        setInterval(() => {
            if (this.dots.length > 3) {
                this.dots = '';
            }
            this.dots = this.dots + '.';
        }, 1500);
    }

    updateProgress() {
        this.localhostService.getPeerState(this.nodeService.getNodeUrl())
            .subscribe((success) => {
                this.peerState = success;

                this.calculateProgress();
            });
    }

    calculateProgress() {
        if (this.peerState !== null) {

            const state = this.peerState as any;
            const lastNumBlocks = 5000;

            let percentageTotal = 0;
            let blocksLeft;
            if (state.lastBlockchainFeederHeight && state.numberOfBlocks <= state.lastBlockchainFeederHeight) {
                percentageTotal = Math.round((state.numberOfBlocks / state.lastBlockchainFeederHeight) * 100);
                blocksLeft = state.lastBlockchainFeederHeight - state.numberOfBlocks;
            }
            if (!blocksLeft || blocksLeft < lastNumBlocks / 2) {
                // TOTAL PROGRESS DONE
                console.log('TOTAL PROGRESS DONE');
                this.totalProgress = 100;
            } else {
                // TOTAL PROGRESS = percentageTotal
                console.log('TOTAL PROGRESS', percentageTotal);
                this.totalProgress = percentageTotal;
            }
            if (blocksLeft) {
                // display blocksLeft
                console.log('BLOCKS LEFT', blocksLeft);
                this.blocksLeft = blocksLeft;

                if (!this.estimateBlocksStart) {
                    this.estimateBlocksStart = blocksLeft;
                    this.estimateTimeStart = new Date().getTime();
                }
            }

            this.calculateEstimate();
        }
    }

    calculateEstimate() {
        const now = new Date().getTime();

        const blocksLoaded = this.estimateBlocksStart - this.blocksLeft;
        const secondsElapsed = (now - this.estimateTimeStart) / 1000;
        const secondsPerBlock = secondsElapsed / blocksLoaded;

        const secondsRemaining = secondsPerBlock * this.blocksLeft;
        this.estimate = this.secondsToHms(secondsRemaining);
    }

    secondsToHms(d) {
        d = Number(d);
        const h = Math.floor(d / 3600);
        const m = Math.floor(d % 3600 / 60);
        const s = Math.floor(d % 3600 % 60);

        const hDisplay = h > 0 ? h + (h === 1 ? ' hour, ' : ' hours, ') : '';
        const mDisplay = m > 0 ? m + (m === 1 ? ' minute, ' : ' minutes, ') : '';
        const sDisplay = s > 0 ? s + (s === 1 ? ' second' : ' seconds') : '';
        return hDisplay + mDisplay + sDisplay;
    }
}
