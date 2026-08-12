---
'@objectstack/plugin-security': patch
'@objectstack/plugin-hono-server': patch
'@objectstack/spec': patch
---

fix(security): an app-declared permission baseline COMPOSES with the platform `member_default` instead of replacing it (#7555)

A permission set marked `isDefault: true` used to become the deployment's ONLY
baseline: `SecurityPlugin`'s `fallbackPermissionSet` held a single name, and an
app's declared set went into it, so every member of that app silently lost the
platform floor. Measured on the showcase (#7555): a fresh member is served all
10 built-in Account nav entries and 7/7 of the objects behind them answer 403,
because `showcase_member_default` names no `sys_*` object and `member_default`
was no longer in force for anyone in that app.

That is the ADR-0090 D5 fallback cliff in its second spelling — D5 rules the
baseline additive without exception ("The fallback cliff is abolished. …
`everyone` is additive like any other position: baseline ∪ explicit, always")
and narrows `isDefault` to a package-authored *suggestion*, "never a runtime
fallback".

The human baseline is now the list of names it always was: the declared set
**plus** the platform `member_default`, deduped. Both are pushed into the
per-request resolution, both back the post-resolution fallback and the ADR-0106
D7 metadata-plane resolution, and both are bound to the `everyone` audience
anchor at boot so `security/explain` and the Setup UI report the default a
request actually applies. The composed list is published as a new
`security.baselinePermissionSets` service, which `/auth/me/permissions` and
`/me/apps` read so the capability and tab surface cannot disagree with the data
plane; `security.fallbackPermissionSet` is unchanged and still means "the single
name this deployment declared".

Deliberately unchanged:

- **Agent principals** keep exactly their ADR-0090 D10 restricted ceiling — the
  composed human baseline is unreachable from `principalKind: 'agent'`.
- **`fallbackPermissionSet: null`** still disables the baseline entirely; the
  composition never re-adds one.
- **`member_default`'s own grant rows**, the D5/D9 high-privilege anchor-binding
  gate, and #5491's narrowing of the platform baseline to explicit-allow.

An app that declares no `isDefault` set resolves `['member_default']` and is
byte-for-byte unaffected.
