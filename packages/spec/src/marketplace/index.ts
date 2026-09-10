// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Marketplace Protocol — the package & marketplace FORMAT.
 *
 * What a package author needs to describe, version, localise and publish a
 * package, and what the marketplace answers with:
 * - Package identity and translations (`package.zod`)
 * - Immutable package versions and their manifest declarations (`package-version.zod`)
 * - Listing, submission, review, search and install request/response shapes (`marketplace.zod`)
 * - The listing-localisation resolver shared by every surface (`package-l10n`)
 * - The on-disk `objectstack.manifest.json` template descriptor (`template-manifest.zod`)
 *
 * Until #16325 these five modules lived under `./cloud` beside the cloud
 * control plane's own row contracts (environments, tenants, the developer
 * portal, marketplace administration, the app store). Those contracts are not
 * an open-source protocol — their producer and their consumers both live in
 * the closed cloud repo — so they left `@objectstack/spec` with the `./cloud`
 * subpath (maintainer direction, verbatim: 「我一直觉得 cloud 的协议应该放在云端，
 * 没必要开源」). This half stays, because a package author needs it: the
 * open-source CLI's `os package publish` path speaks `CreatePackageRequestSchema`,
 * and `api/package-api.zod.ts` builds on `ArtifactReferenceSchema`.
 */
export * from './marketplace.zod';
export * from './package.zod';
export * from './package-l10n';
export * from './package-version.zod';
export * from './template-manifest.zod';
