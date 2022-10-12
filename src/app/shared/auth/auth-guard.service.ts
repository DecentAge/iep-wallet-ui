import { CanActivate, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {

  excludingUrls: Array<string>;
  qrPaymentEntrypoints: Array<string>;

  constructor(private authService: AuthService, private router: Router) {
    this.excludingUrls = [
      '/login',
      '/welcome'
    ]

    this.qrPaymentEntrypoints = [
      'account/send/simple',
      '/assets/show-assets/transfer-asset',
      '/currencies/show-currencies/transfer-currency',
    ]
  }

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot) {
    this.qrPaymentEntrypoints.forEach((entrypoint) => {
      if (state.url.startsWith(entrypoint)) {
        localStorage.setItem('redirectTo', state.url);
      }
    })

    if(this.excludingUrls.indexOf(state.url) > -1){
      if(this.authService.isAuthenticated()){
        this.router.navigate(['/dashboard']);
        return false;
      }else{
        return true;
      }
    }else{
      if(this.authService.isAuthenticated()){
        return true;
      }else{
        this.router.navigate(['/welcome']);
        return false;
      }
    }
  }
}
