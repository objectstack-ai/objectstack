# @objectstack/organizations

## 17.4.0

### Minor Changes

- c677cda: Ship the multi-organization runtime as open source: `@objectstack/organizations` is now an
  Apache-2.0 package in this repository (ADR-0132).
  
  Single-database, row-level organization isolation was already open — the tenant Layer 0 wall,
  the three tenancy postures, the organization and invitation objects, better-auth's organization
  plugin, and the `requiresService: 'org-scoping'` Setup gates. What was closed was the one
  registrar of the `org-scoping` service, so an install that set `OS_TENANCY_POSTURE=isolated`
  could not enforce it: `serve` refused the boot, and the only way past was
  `OS_ALLOW_DEGRADED_TENANCY=1` — the wall configured but not enforced. This package is that
  missing registrar.
  
  It provides:
  
  - **`organization_id` auto-stamp on insert**, from the caller's active organization. A supplied
    — possibly forged — value is overwritten, never trusted.
  - **Per-organization seed replay** on `sys_organization` insert, from the app's own seed
    definitions. Never another organization's rows.
  - **Default-organization bootstrap** for the platform admin, idempotent.
  - **The walled-posture membership-policy gate**: a deployment that raises the wall must declare
    what a new user joins, or the boot is refused.
  
  Only the commercial **entitlement** stays closed. The open class carries no licence check of any
  kind and offers no hook for one; an enterprise deployment resolves the same package name to a
  private, licence-gated subclass through its own `workspace:*` declaration, so which class is
  mounted is decided by the manifest that declares the name.
  
  ⚠️ Shipping the registrar is not yet the same as an open install raising the wall: `objectstack
  serve` still resolves the runtime from the served app's own declaration and is not yet wired to
  mount this package off `OS_TENANCY_POSTURE`. That, and the isolation matrix run against a real
  registrar rather than a posture stub, are tracked separately.

### Patch Changes

- Updated dependencies [fe0d9a4]
- Updated dependencies [ecd2158]
- Updated dependencies [f2b5e46]
- Updated dependencies [2ed6be6]
- Updated dependencies [ed7243d]
- Updated dependencies [6ba0db4]
- Updated dependencies [625b0c3]
- Updated dependencies [233222e]
- Updated dependencies [07f40e5]
- Updated dependencies [ceb4877]
- Updated dependencies [e9fcd6b]
- Updated dependencies [90e7e6d]
- Updated dependencies [2bdabe6]
- Updated dependencies [ca326b5]
- Updated dependencies [8f404a5]
- Updated dependencies [d4c2cb1]
- Updated dependencies [68437d4]
- Updated dependencies [abb140c]
- Updated dependencies [2e6a2ea]
- Updated dependencies [8333a6c]
- Updated dependencies [3e3ecb0]
- Updated dependencies [3030369]
- Updated dependencies [8e500f2]
- Updated dependencies [d5d8d50]
- Updated dependencies [e08892d]
- Updated dependencies [ae05f2e]
- Updated dependencies [b548e43]
- Updated dependencies [c463d03]
- Updated dependencies [64bd6a3]
- Updated dependencies [13c48c2]
- Updated dependencies [b0529e1]
- Updated dependencies [66dc6ab]
- Updated dependencies [6f94458]
- Updated dependencies [6e67b86]
- Updated dependencies [132742f]
- Updated dependencies [85a2459]
- Updated dependencies [50dc214]
- Updated dependencies [e89fa92]
- Updated dependencies [e9fcd6b]
- Updated dependencies [8976ea1]
- Updated dependencies [56fe8c2]
- Updated dependencies [acabd24]
- Updated dependencies [ab50c8f]
- Updated dependencies [6491463]
- Updated dependencies [89cf4d6]
- Updated dependencies [21c5dcb]
- Updated dependencies [6d4d5d3]
- Updated dependencies [ed5d557]
- Updated dependencies [bca21f7]
- Updated dependencies [e9fcd6b]
- Updated dependencies [2025b1f]
- Updated dependencies [1a7a7c9]
- Updated dependencies [e9fcd6b]
- Updated dependencies [ef3a138]
- Updated dependencies [68d5dfd]
- Updated dependencies [3e21cf0]
- Updated dependencies [4cfc93b]
- Updated dependencies [efd6b43]
- Updated dependencies [859ded3]
- Updated dependencies [fa125f3]
- Updated dependencies [74628d9]
- Updated dependencies [a646120]
- Updated dependencies [6f1ce7d]
- Updated dependencies [7778115]
- Updated dependencies [2c753fe]
- Updated dependencies [52804cd]
- Updated dependencies [3f89967]
- Updated dependencies [53cf263]
- Updated dependencies [21aabbc]
- Updated dependencies [9c270bb]
- Updated dependencies [76c8c5a]
- Updated dependencies [cfb64a6]
- Updated dependencies [088f761]
- Updated dependencies [a84e1ce]
- Updated dependencies [bf1054a]
- Updated dependencies [d8d2776]
- Updated dependencies [222dc0f]
- Updated dependencies [e9fcd6b]
- Updated dependencies [32c917d]
- Updated dependencies [f9a3c32]
- Updated dependencies [41cbc54]
- Updated dependencies [f502898]
- Updated dependencies [51ae731]
- Updated dependencies [af7edfe]
- Updated dependencies [9f39897]
- Updated dependencies [b60f48b]
- Updated dependencies [c78c918]
- Updated dependencies [142c01c]
- Updated dependencies [4ca358d]
- Updated dependencies [cf9bda4]
- Updated dependencies [784cb92]
- Updated dependencies [7629f4d]
- Updated dependencies [51df9fd]
- Updated dependencies [a7da4de]
- Updated dependencies [de0bcdd]
- Updated dependencies [70f7d6d]
- Updated dependencies [c677cda]
- Updated dependencies [6acb37e]
- Updated dependencies [554a160]
- Updated dependencies [f7da71e]
- Updated dependencies [7f745c3]
- Updated dependencies [9e9f03a]
- Updated dependencies [5eb24f8]
- Updated dependencies [2a3decc]
- Updated dependencies [cc00df2]
- Updated dependencies [cc00df2]
- Updated dependencies [f4e6adf]
- Updated dependencies [ee4a59b]
- Updated dependencies [4db3c61]
- Updated dependencies [5ca314a]
- Updated dependencies [e0af1a8]
- Updated dependencies [4771bd9]
- Updated dependencies [414c1fc]
- Updated dependencies [22c0279]
- Updated dependencies [0db2947]
- Updated dependencies [92b5d7f]
- Updated dependencies [613bfbd]
- Updated dependencies [abae16a]
- Updated dependencies [094b8fd]
- Updated dependencies [c7aca0d]
- Updated dependencies [c1d8f98]
- Updated dependencies [8e0b297]
- Updated dependencies [d4f9b2a]
- Updated dependencies [5f7fa1d]
- Updated dependencies [87f0ccc]
- Updated dependencies [aedbaef]
- Updated dependencies [a727043]
- Updated dependencies [c5d6803]
- Updated dependencies [10d05bb]
- Updated dependencies [69602e5]
- Updated dependencies [c3ce76c]
- Updated dependencies [7936b29]
- Updated dependencies [46803fa]
- Updated dependencies [c2a336c]
- Updated dependencies [9f890d3]
- Updated dependencies [0bb2318]
- Updated dependencies [f7db8f4]
- Updated dependencies [1ecee3e]
- Updated dependencies [9408b7f]
- Updated dependencies [e9fcd6b]
- Updated dependencies [9bcd9be]
- Updated dependencies [b398ad2]
- Updated dependencies [99261a7]
- Updated dependencies [81b426f]
- Updated dependencies [001af1c]
- Updated dependencies [fb77aa5]
- Updated dependencies [3d3f60e]
- Updated dependencies [581d8f8]
- Updated dependencies [f81afe3]
- Updated dependencies [40a44b9]
- Updated dependencies [f89812e]
- Updated dependencies [7a7fb03]
- Updated dependencies [8fd246d]
  - @objectstack/spec@17.4.0
  - @objectstack/core@17.4.0
  - @objectstack/plugin-auth@17.4.0
  - @objectstack/types@17.4.0
