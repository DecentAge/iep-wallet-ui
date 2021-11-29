import { Pipe, PipeTransform } from '@angular/core';
import { AppConstants } from '../config/constants';
import * as moment from '../../../node_modules/moment';

@Pipe({
  name: 'timestamp'
})
export class TimestampPipe implements PipeTransform {

  transform(value: any, args?: any): any {
      try {
          let actual = value + AppConstants.baseConfig.EPOCH/1000;
          let momentObj = moment.unix(actual);
          return momentObj.format('DD.MM.YYYY HH:mm:ss');
      } catch (e) {
          console.error(e);
          return value;
      }
  }

}
