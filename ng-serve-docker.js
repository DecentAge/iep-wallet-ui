const { execSync } = require('child_process');

console.log(`ng serve --host 0.0.0.0 --port ${parseInt(process.env.PORT)} --disable-host-check`);

//execSync("envsub src/env.config.js.template src/env.config.js")
execSync(`npm -v`, {stdio: 'inherit'});
execSync(`ng serve --host 0.0.0.0 --port ${parseInt(process.env.PORT)} --disable-host-check`, { stdio: 'inherit' });
