// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #16325 — `cloud/tenant.zod.ts` left `@objectstack/spec` with the `./cloud` subpath
// (maintainer ruling, option B "cut by owner": the cloud control plane's contracts are
// the cloud repo's own declarations, not an open-source protocol). Prescription: the
// `cloud-subpath-retired` semantic entry of this major.
export const entry = 'cloud/ProvisionTenantResponse';
