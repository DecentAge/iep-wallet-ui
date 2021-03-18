import { Observable } from 'rxjs/Observable';
import { Observer } from 'rxjs';
import { Subject } from 'rxjs/Subject';

export class RootScope {

    public static data: any = {};

    private static subject = new Subject<any>();

    public static onChange = RootScope.subject.asObservable();

    public static set(data: any) {

        RootScope.data = Object.assign(RootScope.data, data);
        RootScope.subject.next(RootScope.data);
    }
}
