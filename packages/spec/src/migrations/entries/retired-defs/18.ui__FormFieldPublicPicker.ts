// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// `ui/FormFieldPublicPicker` (`displayFields`, `maxResults`, `filter`,
// `object`) leaves with its only carrier, `FormFieldBaseSchema.publicPicker`,
// tombstoned in this same major under ADR-0087 D2 by the maintainer's ruling E
// on #21079: anonymous public forms no longer offer record search, so nothing
// replaces the shape — a fixed choice is a `select` field with static
// `options`, and a record choice belongs on a form behind sign-in. See
// `retired-keys/18.ui__FormField__publicPicker.ts` for the retirement record.
export const entry = 'ui/FormFieldPublicPicker';
