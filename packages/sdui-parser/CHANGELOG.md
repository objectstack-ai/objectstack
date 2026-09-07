# @objectstack/sdui-parser

## 17.4.0

## 17.3.0

### Minor Changes

- 2182bd1: sdui-parser: `interpretBrace` materializes the JS literal subset, in lockstep with objectui
  
  The html tier's braced attribute values accepted strict JSON only, so the spelling every
  JSX author and every AI author writes — `columns={['name','amount']}` — compiled to the
  deferred `{ $expr }` marker that nothing downstream evaluates, and the author's data
  binding vanished at render. Under the maintainer's ruling on objectui#6614 (Q1-A,
  2026-08-28) `interpretBrace` now materializes the JS **literal subset**: exactly two
  widenings over JSON — single-quoted strings (value position and key position) and unquoted
  identifier object keys.
  
  Everything else JSON refuses is still refused and still becomes `{ $expr }`: trailing
  commas, comments, array holes, spreads, `undefined` / `NaN` / `Infinity`, `+1` / `.5` /
  `1.` / `0x1f`, template literals, and every genuine expression. `JSON.parse` still runs
  first and untouched, so strict-JSON behaviour is invariant by construction, and the subset
  contains no identifier lookup and no operator — the widening moves habitual spellings onto
  the materialized side, it does not move the data/code boundary (ADR-0080: this tier parses,
  never executes).
  
  An authored `__proto__` key is written as an own data property, the way `JSON.parse` gives
  it, never through the prototype setter — a plain assignment in the unquoted-key path would
  hand untrusted page source a prototype-pollution lever the strict-JSON path never had.
  
  The `inert-expression` diagnostic message is reworded to match: the old text advised
  writing the value as JSON with double-quoted strings and keys, which now names a legal
  spelling as the wrong one. Diagnostic **codes** are unchanged.
- 2a5c1cd: html tier: a braced attribute value that is not strict JSON now draws an `inert-expression` warning instead of vanishing silently
  
  `interpretBrace` materializes strict-JSON values only; anything else — the
  single-quoted array every JSX author writes (`columns={['name','amount']}`),
  unquoted object keys, any JS expression — compiles to the deferred `{ $expr }`
  marker, and nothing downstream evaluates that marker: this tier parses, never
  executes (ADR-0080), and no renderer consumes `$expr`. The value reached the
  renderer as an opaque object, defensive non-array/non-object reads degraded it
  to "not declared", and the author's binding vanished with zero diagnostics
  anywhere — a production page's `list-view` rendered its row count and toolbar
  with no data columns, through eight `columns` spellings (objectui#6598). That
  is ADR-0078's prohibited parsed-but-silently-inert state.
  
  `validateTree` now emits a warning-severity `inert-expression` diagnostic when a
  declared input's value is the `$expr` marker, with the fix in the message: write
  the value as JSON (double-quoted strings and keys).
  
  This is the lockstep port of objectui PR #6613 into this repo's hoisted copy of
  the parser. There are two copies, and the invariant is that both agree on the
  accepted grammar **and** on diagnostic codes — if they drift, the save gate and
  the renderer speak different dialects, and a page can save clean and render
  inert. The emitted diagnostic is byte-equal to objectui's.
  
  Warning, not error, per the objectui#5709 posture for inert authored keys: this
  reports an **already**-inert state, so the accept/reject set does not move.
  Pages that compiled before still compile, and a warning is non-gating on every
  consuming surface in this repo (`runtime-gate` files warnings as advisories, not
  as write refusals; `os lint` exits non-zero on error-severity findings only).
  The silence is what changed. Escalating the severity, widening the accepted
  literal grammar (single-quoted strings, unquoted keys), and wiring the registry
  manifest into `validate-jsx-pages` — without which this warning is recorded in
  compile output but displayed by no production surface — are separate decisions
  tracked on objectui#6614 and its follow-ups.
- 0e68ed2: html tier: an authored `type=` attribute is now refused at parse time instead of overwriting the component discriminator
  
  On a `kind:'html'` page the tag name **is** the node's `type`, so a `type` attribute is a
  name collision with the envelope's own discriminator. The parser now refuses it with one
  `forbidden-attr` error naming **both** the tag and the attribute — *Attribute "type" is
  not allowed on `<flex>` — on this tier the tag name IS the component…* — replacing two
  outcomes, neither good:
  
  - the value named another **registered** type (`<flex type="grid">`): the tree carried the
    author's value as its discriminator, `validateTree` resolved `grid` in the manifest,
    every check passed, and the page rendered a grid where the author wrote a flex — **zero
    diagnostics**, on the one tier whose premise is that unreviewed, AI-authored source is
    safe to accept;
  - the value named **nothing** registered (`<object-chart type="bar">`, the shape a
    react-tier author carries across): `unknown-component` naming `"bar"`, which reads as a
    missing plugin rather than as an attribute that should not be there.
  
  Alongside the refusal, `parseElement` builds the node as `{ ...props, type: tag }` rather
  than `{ type: tag, ...props }` — defense in depth, and correct only *because* the
  attribute is refused loudly: reversing the spread alone would trade a silent overwrite for
  a silent discard.
  
  The react tier is unaffected: its `specType` rescue (objectui#2880) stays where it lives
  and is deliberately **not** carried over — the two tiers are two source formats, and a
  consumer-side alias on a second tier is the tolerance ADR-0080's amendment declined.
  `validate.ts`'s `BASE_PROPS` is unchanged (`type` is correct there for every other
  member), and no warning grace period is introduced.
  
  **This narrows what the html tier accepts**: a page that compiles today with a `type=`
  attribute will be refused. The in-repo migration surface was measured before the change
  and is **zero** — no html-tier page source under `content/docs/**` or the example apps
  carries one. Maintainer ruling 2026-09-01, recorded as an amendment on ADR-0080.
- 8beb3de: html tier: a dashboard widget `options` key that reaches no renderer now draws an `unconsumed-widget-option` warning naming the consumed set
  
  `@objectstack/spec`'s `DashboardWidgetOptionsSchema` ends in `.passthrough()`
  ("declared query keys + open renderer extras"), so ANY key parses, validates
  and lints cleanly — including one no renderer reads. That is how a dashboard
  shipped `options: { invert: true }` on a gauge with a comment saying what it
  was believed to do and rendered the un-inverted measure with no diagnostic
  anywhere (objectui#5709). The 2026-08-23 maintainer ruling on that card: open
  extras stay open — they just stop being **silent**. A key that reaches no
  renderer draws a **warning** naming the consumed set.
  
  objectui's copy of this parser has emitted that warning since the ruling
  landed; this repo's hoisted copy emitted nothing, so the same authored page
  produced a diagnostic on one surface and silence on the other — the dialect
  split the two copies' invariant forbids (objectstack#12719 — both copies agree
  on the accepted grammar **and** on diagnostic codes). `validateTree` now ends
  its known-component branch with `checkDashboardWidgetOptions(node)`, and the
  new module is a byte-equal port of objectui's save for one token (the emitted
  `code` is spelled as an inline literal rather than through the exported
  constant, so this repo's ADR-0112 vocabulary gate can classify it — called out
  at the site, and pinned equal to the constant by test), so the emitted `code`,
  `severity`, `message` and census scope are identical.
  
  The warning is scoped to the only spec-legal render path: a `dashboard` /
  `dashboard-grid` host, a widget with a `dataset`, not in the legacy
  `component` format, and not carrying the spec's own
  `suppressWarnings: ['unconsumed-widget-option']` escape hatch. The consumed set
  is the five keys `DashboardWidgetOptionsSchema` declares (`dateGranularity`,
  `sortBy`, `sortOrder`, `limit`, `stageOrder`) plus `description`, the metric
  sub-caption channel `translateDashboard` writes into `options`.
  
  New exports for third-party manifest consumers: `checkDashboardWidgetOptions`,
  `CONSUMED_WIDGET_OPTION_KEYS`, `DASHBOARD_WIDGET_HOST_TYPES` and
  `UNCONSUMED_WIDGET_OPTION` (the diagnostic code, which is also the id
  `suppressWarnings` suppresses).
  
  Unlike the union-arm port that preceded it, this change is **additive**: it
  reports an already-inert state and emits `warning` only, so what this copy
  accepts and rejects is exactly where it stood — pinned by a dedicated test.
  Today it is latent in the production gate anyway: this repo resolves no
  `sdui.manifest.json`, so `validateJsxPages` runs parse-only and `validateTree`
  is not reached from it. Wiring that manifest (the second gap recorded on
  objectstack#12719, still unowned) is what makes this author-visible, and this
  port lands ahead of that wiring deliberately.
- 4a9f461: html tier: a union-typed manifest input is now coarse-type-checked over every declared arm instead of drawing no diagnostic at all
  
  `ManifestInput.type` now carries ONE coarse kind, or an ARRAY of kinds when the
  key's contract is a union (objectui#3832). Before this change, this copy's
  `checkType` was the older single-arm `switch (input.type)`: a manifest input
  declaring a union fell through `default: return null` and drew **no diagnostic
  at all** — silence indistinguishable from a value that validated cleanly —
  while objectui's copy checked every arm. The same authored page produced
  diagnostics on one surface and none on the other: the dialect split the two
  parser copies' invariant forbids (objectstack#12719 — both copies agree on the
  accepted grammar **and** on diagnostic codes).
  
  `validateTree`'s coarse check now clears a prop when **any** declared arm
  accepts the value, and when **no** arm accepts it emits **one** `type-mismatch`
  diagnostic naming every arm — at `error` severity when an `enum` arm is
  present (an enum's closed list is the one fact this layer can be certain
  about), `warning` otherwise. A single-arm input produces the byte-identical
  diagnostic it always did, `invalid-enum` included. `generateDts` emits a
  TypeScript union for a union declaration, and `manifestFromConfigs`
  canonicalizes union declarations through the new `input-type.ts` module
  (`inputTypeArms`, `canonicalizeInputType`, `MANIFEST_INPUT_TYPES` — all
  exported, so third-party manifest consumers read arms through the same
  accessor the gate does).
  
  This is the lockstep port of the objectui#3832 ruling into this repo's hoisted
  copy of the parser — the ported check is byte-equal to objectui's. It changes
  what the save gate accepts and rejects for union-typed inputs: a value fitting
  no arm of an enum-carrying union now draws an `error` where it previously drew
  nothing. Today that change is latent in the production gate — this repo
  resolves no `sdui.manifest.json`, so `validateJsxPages` runs parse-only; wiring
  the manifest (the second gap recorded on objectstack#12719) is what makes it
  author-visible, and this port lands ahead of that wiring deliberately.

### Patch Changes

- 34f60b7: The JSX-source parser no longer deletes the space that separates a text run
  from an adjacent sibling element. `parseChildren` collapsed each text run's
  whitespace to a single space (correct — that is HTML's own whitespace model)
  and then `.trim()`ed it (not correct — HTML collapses a whitespace run to one
  space, it does not delete it), so `A <strong>x</strong> page` compiled to
  `['A', {strong}, 'page']` and the words ran together wherever that tree is
  rendered.
  
  The rule now applied: collapse the run, then keep one leading space when a
  sibling precedes it and one trailing space when a sibling element follows it;
  at the parent's own start/end the edge space is still dropped, so
  `<p>  hi  </p>` still compiles to `['hi']`. It is deliberately mechanical — it
  invents no block/inline taxonomy for a schema tree that has none. Its one
  bounded cost is that a whitespace-only run between two siblings survives as a
  single space, so a pretty-printed `<ul>` gains one `' '` child per inter-item
  gap; the tests pin that bound. This matches the rule the downstream copy of
  this parser already applies, so the two agree on the tree they produce.

## 17.2.0

## 17.1.0

## 17.0.0

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- cc2de0e: chore(packaging): 20 packages stop publishing their sources, tests and build tooling (#4248)

  These 20 packages declared no `files` field, so npm fell back to packing the
  whole package directory. `npm pack --dry-run` on `@objectstack/plugin-webhooks`
  listed **21 files** — 15 under `src/`, three of them unit tests
  (`auto-enqueuer.test.ts`, `bootstrap-declared-webhooks.test.ts`, …), plus the
  build-time `scripts/i18n-extract.config.ts`. `dist/` lands on top of that at
  publish time rather than instead of it, so consumers were installing the
  TypeScript sources and the test suite alongside the artifact they asked for.

  Each now declares `"files": ["dist", "README.md"]`, matching the 29 packages
  that already did. Nothing a consumer imports moves: every `main` / `types` /
  `exports` target in all 20 already resolved inside `dist/`, which the new
  `check:published-files` guard verifies rather than assumes. The visible change
  is a smaller install and a smaller dependency-scanning surface — `npm pack` on
  `@objectstack/plugin-webhooks` now yields 2 files plus `dist/`.

  The other half of the fix is the gate. Half the packages declaring `files` and
  half not was the #3786 shape — a hand-copied convention with nothing enforcing
  it, where whoever forgets the line gets no signal at all. `check:published-files`
  (new, wired into the always-required `lint` job) holds every non-private
  workspace package to four invariants: `files` is **declared**; it is
  **sufficient** (covers every entry point, so tightening a whitelist cannot ship
  a package that fails to resolve); it is **minimal** (admits no test, test-harness
  config or build script); and anything beyond `dist` + `README.md` is
  **registered** with a reason, reconciled in both directions so a stale exemption
  is an error rather than dead text. `@objectstack/spec` is the one package with
  registered extras — its `.zod.ts` sources, JSON Schemas, liveness ledgers and
  `CHANGELOG.md` are product, not build input.

  This also closes an assumption #4206 was resting on. Excluding `<pkg>/scripts/**`
  from the docs-drift implementation test is sound only while no package publishes
  `scripts/` as runtime code; that held, but it held because someone read all three
  offenders by hand. It is now checked on every PR.

## 17.0.0-rc.6

## 17.0.0-rc.5

## 17.0.0-rc.4

## 17.0.0-rc.2

## 17.0.0-rc.1

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- cc2de0e: chore(packaging): 20 packages stop publishing their sources, tests and build tooling (#4248)

  These 20 packages declared no `files` field, so npm fell back to packing the
  whole package directory. `npm pack --dry-run` on `@objectstack/plugin-webhooks`
  listed **21 files** — 15 under `src/`, three of them unit tests
  (`auto-enqueuer.test.ts`, `bootstrap-declared-webhooks.test.ts`, …), plus the
  build-time `scripts/i18n-extract.config.ts`. `dist/` lands on top of that at
  publish time rather than instead of it, so consumers were installing the
  TypeScript sources and the test suite alongside the artifact they asked for.

  Each now declares `"files": ["dist", "README.md"]`, matching the 29 packages
  that already did. Nothing a consumer imports moves: every `main` / `types` /
  `exports` target in all 20 already resolved inside `dist/`, which the new
  `check:published-files` guard verifies rather than assumes. The visible change
  is a smaller install and a smaller dependency-scanning surface — `npm pack` on
  `@objectstack/plugin-webhooks` now yields 2 files plus `dist/`.

  The other half of the fix is the gate. Half the packages declaring `files` and
  half not was the #3786 shape — a hand-copied convention with nothing enforcing
  it, where whoever forgets the line gets no signal at all. `check:published-files`
  (new, wired into the always-required `lint` job) holds every non-private
  workspace package to four invariants: `files` is **declared**; it is
  **sufficient** (covers every entry point, so tightening a whitelist cannot ship
  a package that fails to resolve); it is **minimal** (admits no test, test-harness
  config or build script); and anything beyond `dist` + `README.md` is
  **registered** with a reason, reconciled in both directions so a stale exemption
  is an error rather than dead text. `@objectstack/spec` is the one package with
  registered extras — its `.zod.ts` sources, JSON Schemas, liveness ledgers and
  `CHANGELOG.md` are product, not build input.

  This also closes an assumption #4206 was resting on. Excluding `<pkg>/scripts/**`
  from the docs-drift implementation test is sound only while no package publishes
  `scripts/` as runtime code; that held, but it held because someone read all three
  offenders by hand. It is now checked on every PR.

## 17.0.0-rc.0

## 16.1.0

## 16.0.0

## 16.0.0-rc.1

## 16.0.0-rc.0

## 15.1.1

## 15.1.0

## 15.0.0

## 14.8.0

## 14.7.0

## 14.6.0

## 14.5.0

## 14.4.0

## 14.3.0

## 14.2.0

## 14.1.0

## 14.0.0

## 13.0.0

## 12.6.0

## 12.5.0

## 12.4.0

## 12.3.0

## 12.2.0

## 12.1.0

## 12.0.0

## 11.10.0

## 11.9.0

## 11.8.0

## 11.7.0

## 11.6.0

## 11.5.0

## 11.4.0

## 11.3.0

## 11.2.0

### Minor Changes

- 012c046: ADR-0080 M3b: hoist the constrained JSX-source → SchemaNode compiler into framework as `@objectstack/sdui-parser` (its canonical home — pure, isomorphic, zero React). Parse, never execute: whitelist-sanitizing parser + manifest validation + `JSX.IntrinsicElements` codegen. Consumed server-side by the (forthcoming) `os build` save-gate for `kind:'jsx'` pages, and re-exportable by `@object-ui/sdui-parser` on the client.
