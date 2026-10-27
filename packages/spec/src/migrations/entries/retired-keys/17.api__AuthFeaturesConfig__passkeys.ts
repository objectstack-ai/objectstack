// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #7481 — the `/api/v1/auth/config` `features` payload stops advertising the
// two capabilities no client can act on (maintainer ruling 2026-08-11,
// declared = enforced: a deployer must not be able to flip a flag that does
// nothing anywhere). `passkeys` is the emptier of the pair — no login UI reads
// it AND no better-auth passkey plugin is wired behind it.
//
// Registered here but NOT in `src/conversions/registry.ts`, for the same reason
// as the `api/ListNotifications{Request,Response}:cursor` pair: this is a
// RESPONSE surface — the server mints it on every `GET /auth/config` and
// nobody authors or persists an `AuthFeaturesConfig` — so there is no source
// for `os migrate meta` to rewrite. The prescription reaches consumers as the
// D3 semantic entry `auth-config-unadvertised-reserved-features` plus this
// tombstone, the `EnhancedApiError.fieldErrors` disposition.
//
// The withdrawal is conditional, not permanent: the flags return in the change
// that ships the login UI (objectui#4179). Until then the standing record is
// `PUBLIC_AUTH_FEATURES_NOT_ADVERTISED` in `kernel/public-auth-features.ts`.
export const entry = 'api/AuthFeaturesConfig:passkeys';
