# Build Versioning

Atomic Payments uses semantic package versions plus runtime build metadata.

## Current Version

Current build version: `1.1.0`

## Runtime Endpoints

- `GET /v1/build` returns the service, package version, build channel, build SHA, build timestamp, and deploy environment.
- `GET /v1/health` includes the same build metadata with readiness status.
- `GET /v1/project/progress` includes the same build metadata with project completion reporting.

## CI/CD Environment

Production builds should set:

- `ATOMIC_BUILD_SHA`
- `ATOMIC_BUILD_TIMESTAMP`
- `ATOMIC_BUILD_CHANNEL`

`npm run check:deploy` fails strict production readiness if the package version is not semantic or if production build SHA/timestamp metadata is missing.

## Release Notes

Record user-facing or operational changes in `CHANGELOG.md` for each version.
