// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #22876 — `system/EmailTemplateDefinitionCategory` (the `category` enum: auth /
// notification / workflow / marketing / custom) left with
// `EmailTemplateDefinition.category`: that key was its ONLY consumer (the #3950
// rule — an exported value schema with no consumer reads as a capability). The
// `sys_email_template` object spells its own column options and never imported
// it. See `retired-keys/18.system__EmailTemplateDefinition__category.ts` for the
// retirement record.
export const entry = 'system/EmailTemplateDefinitionCategory';
