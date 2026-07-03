#!/bin/bash
# Build the iep-wallet-ui Docker image and extract the built UI zip to
# ./build/iep-wallet-ui.zip. iep-node and iep-node-installer both consume
# that file (../iep-wallet-ui/build/iep-wallet-ui.zip) when bundling the
# desktop wallet.
set -o errexit
set -o pipefail
set -o nounset

# Run from this script's own directory so release-version.txt and the
# Dockerfile are resolved correctly regardless of caller's cwd.
cd "$(dirname "$BASH_SOURCE")"

RELEASE_VERSION=$(cat release-version.txt)
EXTRACT_CONTAINER=iep-wallet-ui-extr

docker build -t "decentage/iep-wallet-ui:${RELEASE_VERSION}" .

# Idempotent: docker rm -f returns 1 on missing containers in Docker <24.
docker rm -f "${EXTRACT_CONTAINER}" 2>/dev/null || true

CONTAINER_ID=$(docker create --name "${EXTRACT_CONTAINER}" "decentage/iep-wallet-ui:${RELEASE_VERSION}")
mkdir -p ./build
docker cp "${CONTAINER_ID}:/build/iep-wallet-ui.zip" ./build
docker rm "${CONTAINER_ID}" >/dev/null

ls -lh ./build/iep-wallet-ui.zip
