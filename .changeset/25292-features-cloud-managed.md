---
'@objectstack/spec': minor
---

feat(spec): declare the console flag `features.cloudManaged` — a `PUBLIC_AUTH_FEATURES` entry with a new hide-when-on gate semantics, and `AuthFeaturesConfigSchema` declares it

Clause-②: yes (widening)
Metadata-protocol: added

The managed (cloud-hosted, SSO-only) mode gets its console flag. People in a managed environment arrive through the organisation's identity provider, so the console hides the doors that would add them any other way.

- **`PublicAuthFeatureSemantics` gains `'hide-when-on'`.** The two existing semantics gate an input on a capability being present (`opt-in` lowers to `features.X == true`, `default-on` to `features.X != false`). The new one gates an input on a mode being absent: `featureGatePredicate` lowers it to `features.X != true`, so the input is hidden when the flag is on and visible when it is off or not served at all.
- **`PUBLIC_AUTH_FEATURES.cloudManaged`** (`surface: 'crud'`, `semantics: 'hide-when-on'`) books six gated inputs: the four `invite_user` actions (`sys_user`, `sys_member`, `sys_invitation`, `sys_organization`), `sys_user.actions.create_user` and `sys_user.actions.set_user_password`. `PUBLIC_AUTH_FEATURE_NAMES` lists it, so `requiresFeature: 'cloudManaged'` is now accepted on an action or param and lowers to `visible: features.cloudManaged != true`.
- **`AuthFeaturesConfigSchema.cloudManaged`** is an optional boolean on the `GET /api/v1/auth/config` response's `features`. Absent means not managed.

What to do: nothing. Every key and value accepted before is accepted unchanged, and every existing flag lowers to the same predicate as before.
