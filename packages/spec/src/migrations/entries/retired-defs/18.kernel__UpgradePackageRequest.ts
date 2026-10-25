// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #25608 — `kernel/UpgradePackageRequest`, retired whole with `kernel/package-upgrade.zod.ts`
// (ADR-0049 enforce-or-remove; maintainer ruling A of 2026-10-19 on the
// package lifecycle classes, item 3). It declared the request body of the unserved package upgrade.
// Zero readers in objectstack, objectui and hotcrm. No carrier key and no
// authored document, so no tombstone and no D2 conversion — this table plus
// the D3 semantic entry `kernel-package-upgrade-family-retired` are the
// declaration.
export const entry = 'kernel/UpgradePackageRequest';
