// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #19054 (ADR-0049 enforce-or-remove; maintainer ruling 2026-09-18, verbatim
// and untranslated: 「organizationField 撤出可授权面 同意你的建议」).
// `TenancyConfig.organizationField` named the column a platform row is STAMPED
// from, as opposed to the column the object is WALLED by (`tenantField`). On an
// ordinary object those are the same column, and the whole protocol declared it
// exactly once — on `sys_api_key`, a table this platform ships and no
// application authors. The `tenancy` block is `.strict()`, so the key is
// removed from the shape and its prescription is served from
// `TENANCY_RETIRED_KEY_GUIDANCE`. The divergence itself is unchanged: it moves
// to `PLATFORM_STAMP_ORGANIZATION_COLUMNS` in `@objectstack/metadata-core`, read
// by the three sanctioned platform-row writers alone. D2:
// `object-tenancy-organization-field-removed`.
export const entry = 'data/TenancyConfig:organizationField';
