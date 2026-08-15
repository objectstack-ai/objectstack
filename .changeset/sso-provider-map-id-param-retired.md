---
"@objectstack/platform-objects": patch
"@objectstack/plugin-auth": patch
---

fix(platform-objects): drop the dead `mapId` ("Map: User ID claim") param from `register_sso_provider` — the OIDC subject claim is not configurable (#8222)

<!-- adr-0087: not-required (no-migration-prescription) One action PARAM is
removed from a UI action declaration, plus the generated i18n entries that
carried its label/helpText. `params` are the form fields an `type: 'api'` action
collects for its request body — not an authorable metadata property, not a field,
not a stored column, so there is nothing to tombstone and no conversion to
register. No stored `sys_sso_provider` row changes shape: the param was only ever
a transient form input, and since #8193/#8221 the bridge has not forwarded it to
better-auth at all. The runtime accept set does not move. -->

The `register_sso_provider` action on `sys_sso_provider` offered an optional
**"Map: User ID claim"** text field (`mapId`), with helpText reading *"Optional.
ID-token claim mapped to the user ID. Defaults to `sub`."*

**That capability no longer exists.** It was retired upstream in
`@better-auth/sso@1.7.0-rc.2`:

- `oidcConfig.mapping` is a `z.strictObject` whose members are
  `{ email, emailVerified?, name, image?, extraFields? }` — there is no `id`;
- the federated subject is hard-wired to the OIDC `sub` claim
  (`id: readStringClaim(rawUserInfo, "sub")` and `id: idToken.sub`), then
  cross-checked (`id_token_subject_missing`,
  `id_token_userinfo_subject_mismatch`);
- `extraFields` is not an escape hatch — it is spread **before** `id` in the
  profile literal, so an `extraFields.id` is overwritten by `sub` before anything
  reads it.

`1.6.20` did honour `mapping.id` (`id: rawUserInfo[mapping.id || "sub"]`); the
version bump deleted the member.

So the field's only accepted values were "empty" and the `sub` it already
defaulted to. #8193 (PR #8221) stopped the bridge emitting the retired key and —
rather than accept a value it would silently discard — made a non-`sub` value
answer `INVALID_REQUEST`. That left the last half of the problem: **the form
still advertised a free-form optional field that 400s on anything meaningful.**
Removing it restores declared = enforced. Nothing else about registration moves:
the runtime accept set is unchanged, and a registration that never sent `mapId`
behaves exactly as before.

`mapEmail` and `mapName` are untouched — they map to live `oidcMappingSchema`
members and are still honoured.

**The bridge-side guard in `plugin-auth`'s `register-sso-provider.ts` is kept**,
and its refusal test with it. The admin form was only one caller: a direct API
client, a script, or a stale cached console bundle can still put `mapId` on the
wire, and telling those callers plainly still beats discarding the value in
silence. Only the guard's doc comment changed, to stop describing `mapId` as a
field the form sends.

The generated translation bundles (`*.objects.generated.ts`, all four locales)
were **regenerated**, not hand-edited, so the retired label disappears from every
locale rather than lingering as a stale entry.
