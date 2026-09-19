---
'@objectstack/spec': minor
---

fix(spec): `spec-changes.json`'s aggregate export diff declares the release pair it really spans (#18978)

Clause-②: yes (widening) — one new OPTIONAL key on a published artifact (`aggregate.surfaceScope`)
and one new optional field on `SpecChangesSchema`. Nothing is renamed, retired or reshaped: the
schema still ACCEPTS a record without it, every existing key keeps its spelling and meaning, and
`perMajor` and the `release` section are byte-identical. Contract-review tier.

`aggregate.added` / `aggregate.removed` are not registry-derived. A release-time api-surface diff
fills them by comparing the artifact being published against the previously **published** one, so
they span **one release** — while the record they sit in is keyed by protocol major (`from: 10,
to: 17`) and every entry carries only `since: 17` / `removedIn: 17`, with
`perMajor[16 → 17].added` at `0` beside it. Nothing in the file distinguished one minor's slice
from the whole major-boundary delta.

Measured on the published `@objectstack/spec@17.4.0` Release asset: `aggregate.added` = **225**,
`aggregate.removed` = **51**, every entry `since`/`removedIn` = 17 — and set-identical to a
recomputed `17.3.0 → 17.4.0` diff of the two tarballs' own `api-surface/` snapshots. It was the
minor's delta wearing a major's label.

**What ships now.** A record whose export arrays are non-empty carries the version pair they were
diffed between:

```bash
jq '.aggregate | {from, to, surfaceScope, added: (.added | length), removed: (.removed | length)}' \
  node_modules/@objectstack/spec/spec-changes.json
```

- `surfaceScope: { fromVersion, toVersion }` present ⇒ `added`/`removed` span exactly that
  published-version pair. ⛔ They are **not** the `from` → `to` major delta, and never were.
- `surfaceScope` absent ⇒ the record carries no export diff at all and `added`/`removed` are
  empty. ⛔ Read that as "this record does not say", never as "nothing was added between `from`
  and `to`" — the same rule the `release` section already states for itself.
- `from` / `to` still answer the major-boundary question for `converted` / `migrated`, which are
  registry-derived and unaffected.

**Refused at the producer and at the publish gate, in both directions.** The generator reads the
previous version off the previous artifact's own `package.json`, omits the arrays loudly when it
cannot read one, and refuses outright to write a non-empty unlabelled array.
`scripts/check-release-spec-changes.mjs` — which until now checked the `release` section and not
the aggregate — recomputes the aggregate's claim from the two tarballs and refuses an absent,
mislabelled or untrue scope. Its self-test roster grows from 15 batteries to 23.

**Nothing previously honest moved.** The committed registry-only projection and every `perMajor`
record carry no new key at all; the committed `spec-changes.json` changes on its `$comment` line
and nowhere else. The published schema is deliberately not narrowed — every manifest published so
far carries an unscoped diff and must keep parsing.
