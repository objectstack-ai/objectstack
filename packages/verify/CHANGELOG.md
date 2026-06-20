# @objectstack/verify

## 9.11.0

### Minor Changes

- 4c213c2: Master-detail "controlled by parent" permissions (ADR-0055).

  A detail object can now declare `sharingModel: 'controlled_by_parent'`: its read/write access is derived from its master record, with no authored RLS.

  - `@objectstack/spec`: `controlled_by_parent` added to the authorable `object.sharingModel` enum.
  - `@objectstack/plugin-security`: reads inject `masterFK IN (accessible master ids)` (resolved from the master's own RLS, reusing the existing filter machinery — zero RLS-compiler changes); by-id writes (insert/update/delete) to a detail now require edit access to its master, closing the #1994-class by-id hole for derived access.
  - `@objectstack/verify`: related-record **topological synthesis** — `deriveCrudCases` no longer skips objects with required relations; it builds the object dependency graph, orders it topologically, and threads real target ids, so relationship-dense objects (and the master-detail RLS proof) are verifiable. Honest `blocked` verdicts remain for required-reference cycles and external/missing targets.

  v1 limits (per ADR-0055): the accessible-master id set is unbounded (large-tenant scale is a documented future limit), and master-detail chains are single-level (not transitively traversed).

- a8e4f3b: `bootStack` gains an opt-in `automation` boot option. When set, it registers `@objectstack/service-automation` so the app's authored flows are pulled from the registry and `POST /api/v1/automation/:name/trigger` actually executes their nodes against the real in-process stack. This makes flow-node execution + variable wiring verifiable end-to-end (ADR-0054 Phase 2), mirroring the existing `multiTenant` opt-in. Default is `false`, so the standard boot stays lean for apps that don't exercise flows.
- fd2e1a2: Add `@objectstack/verify` — boot any ObjectStack app in-process and verify it through the real HTTP stack: auto-derived CRUD round-trip fidelity (`runCrudVerification`) plus the cross-owner RLS invariant (`runRlsProofs`, "you can't write what you can't read"). Also adds an `objectstack verify` CLI command that runs these proofs against an app config and exits non-zero on real failures.

  Extracted from the internal dogfood regression gate so third-party and template authors can run the same runtime proofs against their own apps. The private `@objectstack/dogfood` package now consumes this library for its golden regression tests.

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [e7f6539]
- Updated dependencies [fa8964d]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [751f5cf]
- Updated dependencies [5a5a9fe]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/plugin-sharing@9.11.0
  - @objectstack/rest@9.11.0
  - @objectstack/plugin-security@9.11.0
  - @objectstack/objectql@9.11.0
  - @objectstack/runtime@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/driver-sqlite-wasm@9.11.0
  - @objectstack/plugin-auth@9.11.0
  - @objectstack/plugin-hono-server@9.11.0
  - @objectstack/plugin-org-scoping@9.11.0
  - @objectstack/service-analytics@9.11.0
  - @objectstack/service-automation@9.11.0
  - @objectstack/service-settings@9.11.0
