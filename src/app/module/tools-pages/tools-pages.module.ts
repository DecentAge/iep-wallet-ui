import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ToolsPagesRoutingModule } from './tools-pages-routing.module';
import {NgbModule, NgbAccordionDirective, NgbAccordionItem, NgbAccordionModule} from "@ng-bootstrap/ng-bootstrap";
import { TransactionTypesComponent } from './transaction-types/transaction-types.component';
import { ServiceFeesComponent } from './service-fees/service-fees.component';
import { GenerateSignatureComponent } from './generate-signature/generate-signature.component';
import { ValidateSignatureComponent } from './validate-signature/validate-signature.component';
import { ParseTransactionComponent } from './parse-transaction/parse-transaction.component';
import { BroadcastTransactionComponent } from './broadcast-transaction/broadcast-transaction.component';
import { CalculateHashComponent } from './calculate-hash/calculate-hash.component';
import { ChainStatisticsComponent } from './chain-statistics/chain-statistics.component';
import { UserGuideComponent } from './user-guide/user-guide.component';
import {SharedModule} from "../../shared/shared.module";
import { ToolsService } from './tools.service';

@NgModule({
    imports: [
        CommonModule,
        ToolsPagesRoutingModule,
        FormsModule,
        NgbModule,
        SharedModule,
        NgbAccordionModule
    ],
    declarations: [
        TransactionTypesComponent,
        ServiceFeesComponent,
        GenerateSignatureComponent,
        ValidateSignatureComponent,
        ParseTransactionComponent,
        BroadcastTransactionComponent,
        CalculateHashComponent,
        ChainStatisticsComponent,
        UserGuideComponent
    ],
    providers: [
        ToolsService,
        NgbAccordionDirective
    ]
})
export class ToolsPagesModule {
}
