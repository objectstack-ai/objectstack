---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): OIDC SSO provider registration works again — stop emitting the retired `oidcConfig.mapping.id` key (#8193)

Registering an external OIDC identity provider through the `sys_sso_provider`
`register_sso_provider` action failed **every time**, with HTTP 400:

```
[body.oidcConfig.mapping] Unrecognized key: "id"
```

Not intermittent and not configuration-dependent — the OIDC half of the
registration bridge was unusable for every deployment, and nothing was
persisted. SAML registration was unaffected.

The bridge unconditionally emitted a claim mapping of
`{ id, email, name }`. `@better-auth/sso` declares `oidcConfig.mapping` as a
**strict** object, so a member it does not declare is rejected outright rather
than ignored.

**`id` was not a key that moved — it was retired upstream.** In 1.6.20 the
mapping was a plain (non-strict) object that did carry `id`, and the plugin
honoured it when resolving the federated user. The pinned 1.7.0-rc.2 removes the
member and reads the federated subject from the OIDC `sub` claim directly, then
cross-checks it against the ID token. There is consequently no new home for the
key: `extraFields` is the one open member of the strict object, but a value
placed at `extraFields.id` is overwritten by `sub` before it is ever used, so
re-homing the key there would have looked configured while doing nothing.

The emitted mapping is now `{ email, name }` — the two members the strict schema
requires — and the email/name claim mappings collected by the form continue to
work exactly as before.

**The user-ID claim mapping is now refused instead of ignored.** Because the
subject claim is no longer configurable at all, a registration that asks for a
non-`sub` user-ID claim is answered with a clear `INVALID_REQUEST` explaining
that the subject is always read from `sub`, rather than being accepted and
silently discarded. Leaving the field empty — or setting it to `sub`, the value
the form suggests — registers as normal.

Pinned by a regression test that drives the real `/sso/register` endpoint of a
real better-auth instance, so the emitted body is judged by the installed
package's own schema and the next dependency bump that moves this surface fails
loudly instead of shipping.
