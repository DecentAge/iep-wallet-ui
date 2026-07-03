const { execSync } = require('child_process');

console.log(`ng serve --host 0.0.0.0 --port ${parseInt(process.env.PORT)} --allowed-hosts all`);

execSync(`npm -v`, {stdio: 'inherit'});
execSync(`ng serve --host 0.0.0.0 --port ${parseInt(process.env.PORT)} --allowed-hosts all`, { stdio: 'inherit' });
