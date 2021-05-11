import { Injectable } from '@angular/core';
import { AppConstants } from '../config/constants';

@Injectable()
export class SessionStorageService {

    constructor() { }

    saveToSession = function (key, value) {
        sessionStorage[key] = JSON.stringify(value);

        setTimeout(() => {
            try {
                delete sessionStorage[key];
            } catch (e) {
                sessionStorage[key] = undefined;
            }
        }, AppConstants.baseConfig.SESSION_STORAGE_EXPIRATION);
    };

    getFromSession = function (key): any {
        if (sessionStorage[key]) {
            return JSON.parse(sessionStorage[key]);
        } else {
            return sessionStorage[key];
        }
    };

    deleteFromSession = function (key) {
        try {
            delete sessionStorage[key];
        } catch (e) {
            sessionStorage[key] = undefined;
        }
    };

    resetSession = function () {
        sessionStorage.clear();
    };
}
