# Changelog

## [Unreleased]

## [0.4.3] - 2026-10-08
### Fixed
- Fixed the alias trading flow so withdrawing a sale no longer transfers the alias away.
- Fixed chain-viewer so peers and node details query the peerexplorer backend, the unconfirmed reload and Details buttons work, and block-transaction-details links point to the correct location.
- Fixed poll-voters to hand over the existing transaction instead of issuing a second fetch.
- Fixed the asset trader so the compiler URL uses its own config key and errors are surfaced.

## [0.4.2] - 2026-10-05
### Added
- Show the order total on the trade desk confirm step (#64).

### Fixed
- Generate Signature wrote the genesis epoch constant into the token instead of the current time (every token showed timestamp -2009084416, so its age could not be checked and it never expired); it now writes the seconds since genesis, as the node does.
- Search Assets finds assets while their name is still being typed (prefix search), by asset id and by a word of the description; an error from the node no longer breaks the result table.
- Expected Asset Transfers and Expected Asset Deletes rendered no rows; Expected Order Details threw on every asset id and scaled a second asset with the decimals of the first; Order Trade Details never looked up bid orders.
- "Remove filter" on All Assets restores the default sort order.
- Pay the dividend "Amount per Share" per share instead of per QNT (#60).
- Keep the trade desk's Buy/Sell buttons locked while the counter order book is empty (#63).
- Prefill the edit-alias form with the prefix and URI of the alias being edited.
- Round instead of truncate when converting shares and amounts to quantities.
- Fix defects across the write masks for assets, currencies, aliases, shuffling and crowdfunding, plus further defects surfaced across the wallet modules.

## [0.4.1] - 2026-07-06
### Added
- XIN/USD price chart on the wallet dashboard (chart.js via ng2-charts).

### Changed
- Upgraded to Angular 20 (ng-bootstrap 19, TypeScript 5.8) on Node 22; reproducible npm ci builds.
- Replaced moment with native date handling; refreshed e2e tests; improved local-node handling for devnet.
- XIN price and history are now sourced from the IEP market-cap backend as the single source, with a fallback when the price is unavailable.

### Fixed
- Prevented the "Bad Connection" modal from triggering on optional cross-origin requests.
- Fixed the production build output path so deployed builds are served correctly.

## [0.3.x and earlier]

# Release 0.3.3

# Release 0.3.2
- added readme
- added network to website title (mainnet/testnet)
- reverted passphrase restriction
- added message to alert users with low security passphrases

# Release 0.3.1
- Pass host argument to 'ng serve' to fix connection denial issue
- removed whiles which shdul be excluded from the project
- added dockerfile to build a docker image for the IEP wallet
- run the wallet on nginx web server
- use testnet by default
- moved base root folder to root
- added dockerignore file
- changed image name to decentage/XXXX:latest
- upgraded cli and angular to v6
- Create dependabot.yml
- update cli version in docker
- Serve from wallet path
- node script to run ng serve with process.env params
- add prestart script
- introduced new environment variables concept
- expanded env variables
- cleanup nginx startup script
- validate passphrase
