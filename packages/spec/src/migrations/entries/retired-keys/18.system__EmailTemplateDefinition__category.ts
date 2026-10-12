// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #22876 — ADR-0049 enforce-or-remove. `EmailTemplateDefinition.category` lost
// its only consumer when ADR-0131 D6/D10 retired the `sys_email_template` row
// projection (a Setup column); after that nothing read it, and the Studio
// listing never built the filter facet its doc promised. Measured: no reader in
// plugin-email, service-messaging, plugin-auth, the metadata protocol, objectql,
// the runtime or the REST layer, and none at the `.objectui-sha` pin.
//
// `retiredKey()` on a `strictObject`, for the prescription and the `tsc`
// channel. Its enum, `system/EmailTemplateDefinitionCategory`, left with it
// (`RETIRED_DEFS_BY_MAJOR[18]`). The key was DEFAULTED (`'custom'`), so a 17.x
// parse wrote it into every template it emitted; the
// `acceptRetiredDefaultResidue` stage is NOT adopted (the
// `ai/Agent:memory.longTerm.store` precedent): built artifacts and stored rows
// are healed by the replayed D2 conversion `email-template-category-is-system-removed`,
// and an authored source that still writes it meets the prescription. The D3
// record is `email-template-category-is-system-retired`.
export const entry = 'system/EmailTemplateDefinition:category';
