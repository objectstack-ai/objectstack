---
'@objectstack/spec': patch
'@objectstack/core': patch
---

fix(spec,core): every ADR-0049 tombstone names the npm release that actually carries its removal, and a gate keeps it that way (#18048)

Clause-②: no

Thirty-six sites across fifteen files dated a removal to `@objectstack/spec 18`.
There is no npm 18, and under ADR-0087's level ruling (Amended 2026-09-13) there
will not be one as the carrier for a retirement: *"A tombstone names the npm
release it ships in, ⛔ never the protocol major […] a retirement shipping
`minor` lands in `17.x.y`"*. An author who met one of these was sent to a
version that does not exist. A sibling repository had already hung a cleanup
schedule on "the PR that pushes `@objectstack/spec` to 18" — an event that will
never come.

**The number was determined per site from `packages/spec/CHANGELOG.md`, not
pasted.** The sites split cleanly in two, and the two halves take different
spellings because different things are known about them:

- **Already shipped ⇒ the release that carries it.** The three
  `PluginHealthCheck` restart keys (`b72db01`), `HotReloadConfig.stateStrategy`
  / `distributedConfig` (`4635f3e`), `HotReloadConfig.watchPatterns`
  (`ee3595c`) and the form-view `options[].default` narrowing (`c459da6`) all
  landed in **`17.3.0`**, which is published. These say `17.3.0` — the version
  an upgrading reader greps in the CHANGELOG.
- **Not shipped yet ⇒ the bare published major `17`.** The seven cron-typed
  positions, the `scheduled` cache-warmup strategy and the three
  `PluginStartupResult` members are still unreleased changesets, so the carrier
  minor is unknown at authoring time and any digit would be a guess — the same
  guess that produced this defect. ADR-0087 guarantees the major: a pre-GA
  retirement ships `minor`, so the carrier is some `17.x.y`. Bare `17` asserts
  exactly what is known, cannot go stale as minors accumulate, and is the house
  form already on 588 other sites.

**Why `Clause-②: no`.** Every affected string is a docblock, a doc page, or a
`retiredKey()` / `guidance` MESSAGE. The key is refused before and after, so the
accept/reject result does not move for any input. The control that decides it:
the phrase has 0 hits across `packages/*/api-surface` and
`packages/*/export-origins`, so no published declaration baseline carries these
sentences and none moves.

**No protocol-major reference is altered.** `toMajor: 18`, `step18` and the
`PROTOCOL_VERSION` ladder are correct and untouched — ADR-0087: *"the two move
independently"*.

**Three sites are deliberately left saying 18**, because they quote the wrong
number in order to forbid it: the ADR-0087 ruling itself, and the two
`docs/v17-docs-sweep.md` rows that carry this class's detection fingerprint.
Four more say `99` on purpose — a synthetic "next major" fixture that must name
a version that does not exist.

**A gate lands with the prose**, because this is the class's second appearance:
ten sites of it were corrected by hand in July with no gate, and the card closed
`completed`. `pnpm check:future-spec-major` derives the class from
`packages/spec/package.json` at runtime — a major above the published one, never
a hardcoded 18 — joins string-concatenation, JSDoc and plain-wrap line breaks
before matching, and reads the backticked package name, because each of those is
an independent way for a matcher to read zero and print green.
