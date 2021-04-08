const { execSync } = require('child_process');

console.log(`ng serve --host 0.0.0.0 --port ${parseInt(process.env.PORT)} --base-href ${process.env.PUBLIC_PATH}/`)

execSync(`ng serve --host 0.0.0.0 --port ${parseInt(process.env.PORT)} --base-href ${process.env.PUBLIC_PATH}/`, { stdio: 'inherit' });