#!/bin/bash
# Run the e2e suite inside the pinned Playwright image instead of against the
# host's browser. Visual baselines depend on the exact browser build and font
# stack, so capturing and replaying them here keeps them portable between a
# workstation and the test server.
#
#   ./run-in-docker.sh                        # whole suite
#   ./run-in-docker.sh --project=sanity       # any playwright argument
#   RUN_VISUAL=1 ./run-in-docker.sh --update-snapshots
#
# Requires the devnet stack from iep-docker-dev to be up on the host.
set -euo pipefail

IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.59.1-noble}"
E2E_DIR=$(cd "$(dirname "$0")" && pwd -P)

# Only forward variables that are actually set: an empty BASE_URL would win over
# the config's default and leave playwright with an unparsable base URL.
env_args=()
for var in BASE_URL RUN_VISUAL TEST_ACCOUNT_1_PASSPHRASE TEST_ACCOUNT_2_PASSPHRASE DEVNET_NODE_HOSTS SKIP_QUORUM_CHECK SKIP_FUNDED_CHECK CI; do
	[ -n "${!var:-}" ] && env_args+=(--env "${var}=${!var}")
done

exec docker run --rm \
	--network host \
	--add-host node-1:127.0.0.1 \
	--add-host node-2:127.0.0.1 \
	--add-host node-3:127.0.0.1 \
	--user "$(id -u):$(id -g)" \
	--env HOME=/tmp \
	"${env_args[@]}" \
	--volume "${E2E_DIR}:/e2e" \
	--workdir /e2e \
	"$IMAGE" \
	npx playwright test "$@"
