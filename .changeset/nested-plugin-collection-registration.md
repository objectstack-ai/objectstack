---
"@objectstack/objectql": patch
---

fix(objectql): a nested plugin registers `jobs` / `emailTemplates` / `tools` / `skills` — four collections it silently dropped

**This changes boot behaviour for packages that already ship today.** A package
whose artifacts arrive through a nested plugin (`manifest.plugins[]`) and that
declares any of `jobs`, `emailTemplates`, `tools` or `skills` previously
registered **nothing** for those collections: no refusal, no diagnostic, no
ADR-0010 provenance stamp. After this change the same package registers them,
stamped to the parent package — so `/meta/job`, `/meta/email_template`,
`/meta/tool` and `/meta/skill` begin answering for it, the email plugin's
`sys_email_template` materializer (#4509) begins seeing its templates, and the
AI protocol begins resolving its tools and skills. Anything that has been
compensating for the silence — a duplicate declaration hoisted to the top-level
manifest, a hand-seeded `sys_email_template` row — will now find the collection
already registered.

`engine.ts` reaches the provenance-stamping seam (`registerItem` →
`applyProtection`, the only place `_packageId` / `_provenance` are written) from
two entry points, and each carried its **own copy** of the collection list. The
copies had drifted by exactly those four. `capabilities` hit the same divergence
and was patched into the second copy by hand (#5870) without the rest of the two
lists being diffed, which is how these four survived it.

So the copies are gone rather than reconciled: both entry points now read one
module-scope `METADATA_ARRAY_KEYS`. The two loops were measured against each
other first — they differ in which object they read, which package id they stamp
(both resolve to the same parent package), a per-key `debug` line, and the
manifest seam's aggregated-view expansion and warn-on-nameless-item. Every one
of those is a loop-body difference; none is a reason for the two seams to
enumerate different collections. `check:stack-collection-maps` correspondingly
pins one ObjectQL enumeration instead of two, and its waiver row recording the
divergence is removed with the divergence (#6242's ratchet handshake).

Refs: #7049, #6242, #5870, #4509, ADR-0010.
