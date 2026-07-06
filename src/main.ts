import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { Chart, registerables } from 'chart.js';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';

// chart.js v3 is tree-shakeable: register all controllers/elements/scales once so
// ng2-charts (<canvas baseChart>) can render (e.g. the dashboard XIN/USD chart).
Chart.register(...registerables);

if (environment.production) {
  enableProdMode();
}

platformBrowserDynamic().bootstrapModule(AppModule);
