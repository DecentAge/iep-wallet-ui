import { Injectable } from '@angular/core';
import { BehaviorSubject } from "rxjs/BehaviorSubject";

@Injectable()
export class NewsCenterService {
    private newsDetails = new BehaviorSubject({});

    public readNews = this.newsDetails.asObservable();

    constructor() { }

    setNews(data: Object) {
        this.newsDetails.next(data);
    }

}
