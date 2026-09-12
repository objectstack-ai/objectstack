---
'@objectstack/platform-objects': minor
'@objectstack/cli': patch
---

fix(platform-objects,cli): the generated i18n staleness predicate judges every section a run generated, not two fixed names

`os i18n extract --no-objects-only --fill=default --source-hashes` emits
`apps` / `dashboards` / `pages` leaves and fills them from the source locale —
leaves carrying exactly the property the GENERATED staleness predicate exists to
judge — but the population that predicate walked was the fixed
`GENERATED_SECTIONS` list (`['objects', 'metadataForms']`). So no provenance
record was written for such a leaf, none was read back, and a `--fill=default`
copy left behind by a revised source kept being served as a superseded draft
with every i18n gate green. The hand-authored predicate does reach those paths,
but it judges against `LOCALE.source-hashes.ts`, which by construction carries
no entry for a leaf a generator produced. Neither mechanism covered them.

The population now follows the RUN, at both ends:

- **write** — `collectFilledFromHashes` takes a new **optional** fourth
  parameter, `sections?: readonly string[]`, defaulting to `GENERATED_SECTIONS`.
  `collectGeneratedLeaves` takes the same optional second parameter. Every
  existing call site compiles and behaves exactly as before; `os i18n extract`
  passes the sections it actually built.
- **read** — `findStaleFills` walks the sections the recorded table itself
  names. One run wrote that table, so the table is the record of what that run
  emitted, and the two ends cannot disagree about it. For every table committed
  today this resolves to `['objects', 'metadataForms']`, so no served byte moves.

Adding `'apps'` to `GENERATED_SECTIONS` was the other available shape and is
deliberately not taken: it would make `collectSourceLeaves` and
`collectGeneratedLeaves` walk one section — two predicates permanently on one
path — and it would assert `apps` is always generated, which is false for every
bundle set that ships. Both constants are unchanged and pinned unchanged.

Widening the generated population is safe in a way widening the hand-authored
one would not be, because the rule is self-discriminating per leaf: a record is
written only when `value === currentSource` or `previous[path] === hash(value)`,
so a leaf someone actually translated satisfies neither and stays
legacy-trusted however wide the walk. The section list was the only part of the
mechanism that could not tell a fill from a translation.

No committed bundle or companion byte moves in this repository. All nine
`--source-hashes` configs run the default `--objects-only`, whose commit layer
already narrows the run's table to the sections it emits a bundle for. The 387
hand-recorded digests across `zh-CN` / `ja-JP` / `es-ES` are neither read,
written, shadowed nor lost — `apps` stays in `HAND_AUTHORED_SECTIONS`,
`collectSourceHashes` still walks it, and the extractor still never writes that
file. Its header now states which table a maintainer keeps for a path that can
appear in both, and why the overlap cannot serve wrong text.
