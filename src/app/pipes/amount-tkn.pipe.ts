import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
    name: 'amountTkn',
    standalone: false
})
export class AmountTknPipe implements PipeTransform {

  transform(value: any, args?: any): any {
      if (!value) {
          value = 0;
      }
      const amount = parseFloat(value);
      return amount.toLocaleString('en-US', {minimumFractionDigits: 2});
  }

}
