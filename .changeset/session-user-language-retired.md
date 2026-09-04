---
"@objectstack/spec": minor
---

feat(spec): retire `SessionUser.language` — the session contract's never-produced "preferred language" (#14788, ADR-0049)

<!-- adr-0087: registered session-user-language-retired -->

**BREAKING** key removal on a published session type, landing after the
v17.0.0 cut (the lockstep launch-window convention ships it as `minor`; the
prescription is registered under protocol major 18 — `api/SessionUser:language`
in `RETIRED_KEYS_BY_MAJOR[18]` plus the D3 semantic entry
`session-user-language-retired` — where `os migrate meta` users will look).

`SessionUserSchema.language` (`api/auth.zod.ts`) was declared
`z.string().default('en')` and described as "Preferred language", and had no
producer and no consumer anywhere: no session endpoint ever wrote it, no client
ever read it (objectui measured at its pinned sha: zero readers; the only
in-repo mentions were the schema's own unit test). A reader trusting the
published contract got a constant that was not the user's language — while the
user's real preference had just landed as the first-class column
`sys_user.locale` (#13881), which the session type could not see. Three
spellings of one concept on the published surface, none of them right. The
maintainer ruled option D (2026-09-03): retire the dead key under ADR-0049
enforce-or-remove and make `GET /auth/me/localization` the ONE read face for
the signed-in user's language. No replacement field joins the session contract
until a session endpoint really produces one — no dual-spelling window.

FROM → TO:

- `SessionUser.language` / `SessionUserParsed.language` → *(removed)*. Read
  the signed-in user's language from `GET /auth/me/localization` → `locale`,
  which now resolves the user's own `sys_user.locale` when set → the request's
  `Accept-Language` → the deployment default (`@objectstack/plugin-hono-server`
  in the same release).

One-line fix: delete the key. A producer still writing it fails `tsc`
(`never` input type) and fails to parse with this prescription; a reader still
keying on it now reads `undefined` instead of a permanent `'en'`, and should
read `locale` off `/auth/me/localization` instead.

The retirement kit:

- **`retiredKey()` tombstone** (the schema is a non-strict `z.object`, so a bare
  delete would have stripped the key silently — ADR-0104): writing `language`
  is a `tsc` error and a parse error carrying the prescription, on
  `SessionUserSchema` and through both envelopes that embed it
  (`SessionResponse.data.user`, `UserProfileResponse.data`).
- **ADR-0087 registration**: `api/SessionUser:language` under major 18 plus
  the D3 semantic entry `session-user-language-retired`. A RESPONSE surface —
  the server mints a `SessionUser`, nobody authors or persists one — so there
  is no source for a D2 conversion to rewrite (the
  `api/AuthFeaturesConfig:passkeys` disposition).
- **generated baselines**: `authorable-surface/api.json` carries the
  `[RETIRED]` row; `authorable-defaults/api.json` drops the `= "en"` default;
  `spec-changes.json`, the upgrade guide and `content/docs/references/api/auth.mdx`
  regenerated.
- **pins** in `api/auth.test.ts`: the prescription on parse, absence (no default
  minted) on a clean parse, both envelopes refusing the key, and a
  `packages/spec/src`-scoped scan for any reader of `.language` off a
  `SessionUser`.
- zero in-tree producers or readers, so no in-repo source changes ride along
  beyond the endpoint change shipped with it.
