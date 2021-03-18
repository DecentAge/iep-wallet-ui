import { Injectable } from '@angular/core';
import { CryptoService } from './crypto.service';
import { SessionStorageService } from './session-storage.service';
import { AppConstants } from '../config/constants';

@Injectable()
export class LoginService {
  isExpertWallet = false;
  watchList : Array<any>;

  constructor(public cryptoService: CryptoService, public sessionStorageService: SessionStorageService) { 
    this.watchList = [];
  }

  generatePassPhrase(){
    return this.cryptoService.generatePassPhrase();
  }

  calculateAccountDetailsFromSecret(secret, storeToSession){
    this.sessionStorageService.deleteFromSession(AppConstants.loginConfig.SESSION_ACCOUNT_DETAILS_KEY);
    this.sessionStorageService.deleteFromSession(AppConstants.loginConfig.SESSION_ACCOUNT_PRIVATE_KEY);

    var accountDetails = this.cryptoService.getAccountDetails(secret);

    if (storeToSession) {
        this.sessionStorageService.saveToSession(AppConstants.loginConfig.SESSION_ACCOUNT_DETAILS_KEY, accountDetails);
    }

    // $rootScope.$broadcast('reload-options');

    return accountDetails;
  }

  calculatePrivateKeyFromSecret(secret, storeToSession) {

    this.sessionStorageService.deleteFromSession(AppConstants.loginConfig.SESSION_ACCOUNT_PRIVATE_KEY);

    var privateKey = this.cryptoService.secretPhraseToPrivateKey(secret);

    if (storeToSession) {
      this.sessionStorageService.saveToSession(AppConstants.loginConfig.SESSION_ACCOUNT_PRIVATE_KEY, privateKey);
    }

    return privateKey;
  };

  pushToWatch(isExpertView,_this){
    this.watchList.push({_this:_this,isExpertView:isExpertView})
  }

  applyChanges(){
    var _this = this;
    this.watchList.forEach(view => {
      if(view.isExpertView){
          if(_this.isExpertWallet) {
              view._this.viewContainer.clear();
              view._this.viewContainer.createEmbeddedView(view._this.templateRef);
          }else{
              view._this.viewContainer.clear();
          }
      }else{
          
          if(typeof(view.isExpertView) == "undefined"){
            view._this.viewContainer.clear();
            view._this.viewContainer.createEmbeddedView(view._this.templateRef);
          }else{
              if(_this.isExpertWallet) {
                view._this.viewContainer.clear();
              }else{
                view._this.viewContainer.createEmbeddedView(view._this.templateRef);
              }
          }
      }
    });
  }

}
