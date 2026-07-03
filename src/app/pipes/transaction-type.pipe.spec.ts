import { TransactionTypePipe } from './transaction-type.pipe';

describe('TransationType', () => {
    it('create an instance', () => {
        const pipe = new TransactionTypePipe();
        expect(pipe).toBeTruthy();
    });
});
