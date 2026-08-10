---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): an org-scoped metadata DELETE no longer evicts the env-wide registry entry (#6780)

`restoreArtifactRegistryView` — the three-tier heal that repairs the in-memory
`SchemaRegistry` after an overlay-row delete — was `(type, name)`-addressed and
org-blind. Every tier writes the PLAIN key (`removeRuntimeShadow` drops it, the
layer-2 re-register rewrites it, `removeOverlayEntry` retires it), and per
ADR-0005 that one plain-key entry belongs to the **env-wide** row: an org-scoped
overlay never enters the process-wide registry at all (#6602). `deleteMetaItem`
called the heal on all three of its paths without passing the delete's own
scope, so org A resetting **its own** customization reached in and evicted the
entry every other org and the control plane read.

Measured before the fix on an unscoped (control-plane) kernel — the shape #5086
found the flagship showcase booting with:

```
after env-wide save   : "Env grid"
after org A save      : "Env grid"     # #6602 holding — the org row stays out
delete receipt (org A) : { success: true, reset: true, … }
after org A DELETE    : undefined      # the eviction
rows left             : [{ name: "shared_grid", org: null, state: "active" }, …]
```

The env-wide row is still in `sys_metadata`; only its registry entry is gone.
While it is gone, direct registry readers answer as if the item does not exist
— ADR-0110 D3's declaration gate, `resolveRouteActionDeclaration`, and
fail-closed `assertObjectRegistered` (404). One tenant's "reset my
customization" therefore degraded every other tenant's runtime until restart.
The no-row **self-heal** branch was the cheaper door still: an org that had
never customized anything could evict the entry with a single no-op DELETE
(`reset: false`, "nothing to delete") — so a gate on the delete-ful branch
alone would have left it open.

The scope verdict now lives INSIDE the helper as a **required**
`organizationId` parameter — the `hydrateOverlayIntoRegistry` shape #6602 used
on the register side — rather than as a test repeated at each call site. There
are four call sites, not the two the report named: `deleteMetaItem` has three
(self-heal, post-`repo.delete`, legacy raw-engine path) and `revertCommit` one.
A required parameter makes the next caller answer at compile time; an optional
one would default an omission back to "env-wide" and reinstate the hole. PR
#6807's call-site gate on the revert limb is now redundant-not-contradictory
and was folded into the argument it passes — its pin still covers the batch
path, and it goes red if the gate is ever removed.

**Register wide, retire narrow.** The write-through's `object` carve-out stays
un-org-gated and deliberately does not transfer to removal: it rests on
`assertObjectRegistered` failing CLOSED, so a surplus entry degrades to
"listable but rowless" and the next reload heals it, whereas a wrongly retired
entry 404s data CRUD for every tenant.

Unchanged: row-level delete behaviour (an org-scoped delete still removes the
org row, and the org's next read falls through to the env-wide body); the
env-wide delete's full three-tier walk (#6687 tier 1 un-shadowing, #5079 tier 3
retirement); and the kernel-scope gate, which still guards re-registration
only because that is a fact about the kernel, not about the row.
