import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MessagesComponent } from './messages/messages.component';
import { SendMessageComponent } from './send-message/send-message.component';
import { MessageRoutingModule } from './message-routing.module';
import { MessageService } from './message.service';
import { NgxDatatableModule } from '@swimlane/ngx-datatable';
import { SharedModule } from 'app/shared/shared.module';
import { ReadMessageComponent } from './read-message/read-message.component';
import { FormsModule } from '@angular/forms';
import { ArchwizardModule } from '../../shared/archwizard';
import { AliasesService } from '../aliases/aliases.service';
import {DaoModule} from 'app/module/dao/dao.module';

@NgModule({
    imports: [
        CommonModule,
        MessageRoutingModule,
        NgxDatatableModule,
        SharedModule,
        FormsModule,
        ArchwizardModule,
        DaoModule
    ],
    declarations: [
        MessagesComponent,
        SendMessageComponent,
        ReadMessageComponent
    ],
    providers: [
        MessageService,
        AliasesService
    ]
})
export class MessageModule { }
