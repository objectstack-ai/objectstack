// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #14788 — ADR-0049 enforce-or-remove (maintainer ruling 2026-09-03, option
// D). `SessionUserSchema.language` (`api/auth.zod.ts`) was declared with a
// permanent default of `'en'` and described as "Preferred language", and had
// no producer and no consumer anywhere: no session endpoint wrote it, no
// client read it (objectui measured at its pinned sha: zero readers of
// `SessionUser.language`; its only in-repo mentions were the schema's own
// unit test). A reader trusting the published contract received a constant
// that was not the user's language — the "declared ≠ honoured" shape, made
// worse by the fact that the user's real preference had just landed as a
// first-class column (`sys_user.locale`, #13881) the session type could not
// see. The ruling retires the dead key and makes `GET /auth/me/localization`
// the one read face for the signed-in user's language (`locale`: the user's
// own `sys_user.locale` when set → the request's `Accept-Language` → the
// deployment default); no replacement field joins the session contract until
// a session endpoint really produces one.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8495 / PR #8666 precedent).
// The schema is a non-strict `z.object`, so the route is a `retiredKey()`
// tombstone (a bare delete would strip the key silently, ADR-0104). A RESPONSE
// surface — the server mints a `SessionUser` and nobody authors or persists
// one — so, like `api/AuthFeaturesConfig:passkeys`, there is no source for
// `os migrate meta` to rewrite and no D2 conversion; the prescription reaches
// consumers through this tombstone plus the D3 semantic entry
// `session-user-language-retired`.
export const entry = 'api/SessionUser:language';
