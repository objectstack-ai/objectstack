// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #21180 — ADR-0087 D2, immediate retirement, by the maintainer's ruling E on
// #21079 (comment 5933054144), which reverses the #7467 ruling that had
// declared the key. The block opted a lookup / `master_detail` / `user` field
// on an ANONYMOUS public form into a record-search picker served by an
// unauthenticated route (`GET /forms/:slug/lookup/:field`). The ruling retired
// the capability: the route is deleted, and the public-form resolve route now
// leaves those three field types off the anonymous rendering unconditionally.
// Zero producers measured before the ruling — no example, template, plugin or
// first-party UI caller declared one.
//
// `retiredKey()` on the form field's shape, for the prescription. Sources are
// rewritten by the D2 conversion `form-field-public-picker-removed`; the D3
// record is `form-field-public-picker-retired`.
//
// Registered under 18, not 17: the tombstone ships on the 17.x line
// (launch-window convention — accept-set narrowings ride minor releases) and
// the prescription lives at the major boundary where `migrate meta` users look.
export const entry = 'ui/FormField:publicPicker';
