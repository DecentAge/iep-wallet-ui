const { execSync } = require('child_process');

console.log(`ng serve --host 0.0.0.0 --port 4200 --base-href /`)

execSync(`ng serve --host 0.0.0.0 --port 4200 --base-href /`, { stdio: 'inherit' });
