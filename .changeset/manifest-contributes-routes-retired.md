---
"@objectstack/spec": minor
---

feat(spec): retire `contributes.routes` — the plugin-manifest block's last dead member (#10726, ADR-0049 enforce-or-remove; maintainer-ruled Option B 2026-08-22)

<!-- adr-0087: registered plugin-manifest-contributes-routes-retired -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

`contributes.routes` was the one member #10724's nine-member retirement
deliberately excluded: removing it needed a ruling, not a tombstone, because
the key was the only *declared* channel for a real capability (serving a
code-handler endpoint) and four published surfaces — a customer-published
skill among them — taught it as working machinery. The measurement (#10627,
controlled, three repos, cloud leg closed clean by #10812) is that nothing
ever read it: the HttpDispatcher never registered a prefix from the
declaration, so an entry parsed cleanly and served nothing. The maintainer
ruled Option B (remove; redirect the author-facing materials to the
imperative mount). The doc corrections landed first (PR #11327); this change
is the removal half, plus the two remaining teaching sites (#11328): the
worked manifest example in `plugin-rest-api.zod.ts` and the `router`
delivered-form comments in `metadata-plugin.zod.ts`.

**What is refused:** authoring `contributes.routes`. It is a `retiredKey()`
tombstone (neither `ManifestSchema` nor the `contributes` object is
`.strict()`, so a plain deletion would have silently stripped the key), so
authoring it is a `tsc` error and a parse error carrying the prescription.

**FROM → TO:**

- `contributes.routes: [{ prefix, service, methods? }]` → mount the route
  imperatively: resolve the `http.server` service from the plugin context and
  register the handler on `kernel:ready`; delete the key. A declarative
  endpoint over a pipeline the platform already runs (query/return records,
  trigger a flow) is `defineStack({ apis })`.

**What stays:** `contributes.kinds`, now the block's sole live member
(engine → `registry.registerKind`). Runtime behaviour is unchanged: nothing
ever read the key, so removing it removes no behaviour; a stored manifest
still carrying one degrades to a single `[metadata_spec_invalid]` log line at
registration rather than a boot failure.

D3 semantic entry `plugin-manifest-contributes-routes-retired`; no D2
conversion, because a package manifest is not a stack collection member
(`PLURAL_TO_SINGULAR` has no `packages`/`plugins` entry) and a conversion
would be a transform with no seam that ever runs.
