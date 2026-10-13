---
'@objectstack/verify': patch
---

fix(verify): `bootStack` composes the artifact-less `MetadataPlugin` that `objectstack serve` gives a host configuration, so a stack's declared `apis` endpoints answer under the harness as they answer under `serve` (#23088)

Clause-②: no

`bootStack`'s `metadata` slot was the kernel's in-memory fallback, which has no endpoint matcher (`matchEndpoint`). So every `apis` endpoint a stack declared answered `404 ENDPOINT_NOT_FOUND` in a test boot while `objectstack serve` of the same stack served it, and the boot logged `AppPlugin`'s "no endpoint matcher" warning. The harness now composes `@objectstack/metadata`'s `MetadataPlugin` the way `serve` composes it for a host configuration: no artifact, `bootstrap: 'lazy'`, and `rootDir` set to `BootOptions.hostRoot`. It reads none of the stack, so `AppPlugin` stays the single registrar of the stack's metadata.

- A declared endpoint answers as it does under `serve`: `401` without a session where it is `authRequired`, and its declared answer with one. An undeclared path under the same mount keeps the bare `404`.
- A `MetadataPlugin` you pass in `BootOptions.extraPlugins`, or one your app declares in its own `plugins`, takes the composed one's place. Pass your own to boot an artifact-backed one.
- Two other answers of a test boot move with the slot: `GET /api/v1/discovery` reports the `metadata` service as `available` instead of `degraded`, and `GET /api/v1/dev/metadata-events` (the development-only metadata reload stream, mounted because `bootStack` boots in the development posture) answers `200` instead of `404`, as under `objectstack dev`. The `GET /api/v1/meta/TYPE` answers are unchanged, measured over 22 types on the showcase and CRM examples.
