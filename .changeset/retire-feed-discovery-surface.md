---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": patch
"@objectstack/client": patch
---

**Breaking (discovery response shape): retire the residual feed capability surface (#3180, follow-up to #1959 / ADR-0052 §5).**

The feed backend was retired long ago; #1959 removed the feed contracts + SDK. This
removes the last discovery/dispatcher references to it, and fixes a real bug where the
`comments` capability was permanently `false`.

- `@objectstack/spec` — `WellKnownCapabilitiesSchema.feed` and `ApiRoutesSchema.feed`
  (`routes.feed`) are **removed**, and the `/api/v1/feed` entry is dropped from
  `DEFAULT_DISPATCHER_ROUTES`. FROM → TO: clients reading `discovery.capabilities.feed`
  or `discovery.routes.feed` → use `discovery.capabilities.comments`; comments/activity
  are served by the generic data API on `sys_comment` / `sys_activity`
  (`/api/v1/data/sys_comment/…`).
- `@objectstack/metadata-protocol` — `getDiscovery()` no longer emits the always-`false`
  `feed` service/capability. **Bug fix:** the `comments` capability previously keyed off
  the deleted `'feed'` service (so it was permanently `false` after #1955); it now tracks
  the presence of the `sys_comment` object (provided by the always-on audit slate), so
  `declared === enforced`.
- `@objectstack/client` — the internal `feed: '/api/v1/feed'` route constant is removed
  (it only existed to satisfy the now-removed `ApiRoutes.feed` type; no client code used it).
