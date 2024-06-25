#!/bin/bash
set -o errexit
set -o pipefail
set -o nounset

RELEASE_VERSION=$(cat release-version.txt)
docker build -t decentage/iep-wallet-ui:${RELEASE_VERSION} .

docker container list --all
docker rm -f iep-wallet-ui-extr
set +e
CONTAINER_ID=$(docker create --name iep-wallet-ui-extr decentage/iep-wallet-ui:${RELEASE_VERSION})
echo "CONTAINER_ID=${CONTAINER_ID}"
mkdir -p ./build
docker cp ${CONTAINER_ID}:/build/iep-wallet-ui.zip ./build
ls -alt ./build
docker rm ${CONTAINER_ID}
