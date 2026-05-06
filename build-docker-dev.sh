#!/bin/bash
set -o errexit
set -o pipefail
set -o nounset

export BASE_DIR=$(cd "$(dirname "$BASH_SOURCE")" && pwd -P);
echo "BASE_DIR=${BASE_DIR}"

docker run -t --rm \
-v ${BASE_DIR}:/app \
-w /app \
node:20 /bin/bash -c "npm install && npm run build-prod"
