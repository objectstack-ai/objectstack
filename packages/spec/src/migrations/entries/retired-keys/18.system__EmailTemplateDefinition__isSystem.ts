// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #22876 — ADR-0049 enforce-or-remove. `EmailTemplateDefinition.isSystem`
// claimed a system template "SHOULD NOT be deleted by tenants", and nothing
// enforced it: its only consumers were the built-in seeder's stand-down and the
// `sys_email_template.is_system` column, both retired by ADR-0131 D6/D10. A
// built-in template is a code package's declaration, so an environment item
// over it can only be discarded, whatever this key says. Measured: no reader in
// this repository, and none at the `.objectui-sha` pin.
//
// `retiredKey()` on a `strictObject`, for the prescription and the `tsc`
// channel. The key was DEFAULTED (`false`), so a 17.x parse wrote it into every
// template it emitted; the `acceptRetiredDefaultResidue` stage is NOT adopted,
// for the reason `system/EmailTemplateDefinition:category` gives. The D2
// conversion is `email-template-category-is-system-removed`; the D3 record is
// `email-template-category-is-system-retired`.
export const entry = 'system/EmailTemplateDefinition:isSystem';
