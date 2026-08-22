// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #10054 — ADR-0049 enforce-or-remove (maintainer ruling 2026-08-21, executing
// the 2026-08-20 census verdict). `icon` on the object arm of
// `RecordHighlightsField` was declared, described (`Icon name (lucide icon
// key)`), and advertised on six author-facing surfaces — with ZERO read
// points, measured in every direction: objectui's renderer normalizes the
// authored object and carries `icon: f?.icon` into `HeaderHighlight`, whose
// chip has NO icon slot (its only `icon` occurrence is a button
// `size="icon"`); the key is structurally unable to travel
// `useRegisterHighlightFields`, which registers `names: string[]`; the Studio
// block designer publishes the field list as a `string[]` input, so the key
// was never designer-publishable; and all in-tree `record:highlights`
// producers author bare string arrays. The exact shape #8691 recorded for the
// reference-rail `icon`: declared and normalized, drawn by nothing — an
// authored value parsed clean and cost the author silently. The neighbouring
// `readonly` key is LIVE (#5176, HeaderHighlight's inline-edit gate) and is
// untouched.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8495 / PR #8666 precedent).
// The object arm is `strictObject`, so the route is strict deletion + a
// `guidance` entry carrying the prescription (no retiredKey tombstone — the
// key is out of the walked shape entirely, and the refusal is the arm's own
// named `unrecognized_keys`, unpacked through the zod-4 union collapse by
// `packages/lint/src/zod-issue-format.ts`; the `data/Metric:filters` route).
// Sources are rewritten by the D2 conversion
// `record-highlights-field-icon-removed`, which strips the key from the object
// entries of every `record:highlights` `fields[]` (pure lossless delete — the
// chip renders label and value only, so the key never had an effect to lose).
export const entry = 'ui/RecordHighlightsField:icon';
