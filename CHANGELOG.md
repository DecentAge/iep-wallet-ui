# Changelog

## [Unreleased]

## [0.4.1] - 2026-06-24
### Changed
- Upgraded to Angular 20 (ng-bootstrap 19, TypeScript 5.8) on Node 22; reproducible npm ci builds.
- Replaced moment with native date handling; refreshed e2e tests; improved local-node handling for devnet.

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
