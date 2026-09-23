---
'@objectstack/cli': patch
---

`collect-docs.ts`'s module header no longer gives the retired ADR-0048 claim as the reason for the doc naming lints (#19359)

The header explained the naming lints with *"the metadata registry key carries
no package coordinate, so a bare-name collision silently overwrites across
packages"*. That is ADR-0048 §1.1 **context**, and the same ADR's §3.3/§3.4
overturned it: the write is already composite-keyed (§1.2 — *"The silence is in
the read, not the write"*), and *"The cross-package **throw is retired**; two
distinct packages coexist on the same bare name by construction."* The file
already declined that sentence by name 900 lines below, in
`lintDocNamesAcrossOwners` (#19248) — the correction just never reached the top
of the file.

**That one sentence justified two rules, and they do not rest on the same
thing**, so it was not carried up verbatim:

- `docs/duplicate-name` rests on **authoring hygiene**, the class ADR-0048 §3.4
  keeps by name. The header now points at `lintDocNamesAcrossOwners` instead of
  restating it — a second copy of a justification is how the first one went
  stale.
- `docs/namespace-prefix` / `docs/namespace-required` rest on the **flat link
  namespace**, which ADR-0048 never touched. A doc link is `[text](./NAME.md)`,
  a bare name with nowhere to put a package coordinate, flat on purpose so an
  editor or a GitHub preview resolves it natively (ADR-0046 §3.1/§3.3) — and
  this module keys on the prefix to tell a same-package link, which it checks,
  from a cross-package one, which it defers to publish. ADR-0048 §3.3 repaired
  metadata reads by ADDING a package-id argument to `getItem`; the link form has
  nowhere to put one, so nothing §3.4 retired was ever load-bearing here.

⛔ No behaviour changes. No rule, message, severity or accept set moves; the
only edited bytes are comment bytes.

**This ships, which is why it carries a changeset rather than
`skip-changeset`** — re-measured on this branch's rebuilt artifact rather than
inherited from #19248. `@objectstack/cli`'s published `files[]` is
`["dist","README.md","CHANGELOG.md"]` and the package builds with plain `tsc`
(`tsc -p tsconfig.build.json`; `removeComments` appears nowhere in the package
or the root configs), so comments are emitted into the tarball. Measured after
`turbo run build --filter=@objectstack/cli`: `npm pack --dry-run` lists
`dist/utils/collect-docs.js` at 50.5 kB among 537 files; the new clause is
present there (1 occurrence); the old bullet spelling is absent from all of
`dist` (0); the retired phrase now occurs exactly once in `dist`, inside the
quotation that declines it. `dist/**/*.d.ts` carries 0 occurrences, because the
block sits above the imports rather than on an exported symbol — so the
published JS bytes move while the declaration surface does not.
