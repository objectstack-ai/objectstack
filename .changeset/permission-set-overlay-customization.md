---
"@objectstack/plugin-security": minor
---

Package-owned permission sets are now customizable through the standard environment metadata overlay (ADR-0094 D5, revised — closes framework#2898 by making the overlay FIRST-CLASS instead of rejecting it).

- An env-scope `saveMetaItem('permission', …)` on a package-owned set is a real customization: the awaited projector applies the effective (overlay-wins) body to the `sys_permission_set` record while preserving its `managed_by:'package'` + `package_id` provenance, and the evaluator enforces it.
- A data-door edit of a packaged set (Setup PATCH) is translated into exactly that overlay — no more flat 403; a data-door "delete" removes the overlay and RESETS the record to the shipped declaration (the row survives).
- The ADR-0086 two-doors data gate narrows to what stays structurally true: forging package provenance through the admin door remains refused, as do the lifecycle ops with no overlay translation (`transfer`/`restore`/`purge`) on package rows; kernels without a metadata overlay layer keep the legacy full refusal.
- Cross-package roles compose via positions (bind several packages' sets); overlays narrow. Rationale: rejecting the overlay would make `permission` the one type whose declared `allowOrgOverride: true` is a lie, and clone-to-customize forks away from vendor baseline updates.

Note the standard overlay trade, now applicable to permission sets: while an overlay pins a set, later vendor baseline changes (including tightenings) don't take effect for that name until the overlay is reset or re-authored — surfaced by the Studio layered diff and covered by ADR-0091 recertification.

Also lands a dogfood proof (`showcase-permission-projection`) covering the full ADR-0094 invariant set — write-through, awaited projection, declared-set edit becomes an enforced overlay, package-set customize/reset lifecycle — registered in the liveness proof registry.
