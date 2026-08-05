---
"@objectstack/spec": patch
---

Put the 44 pre-helper alias tables under the alias-integrity gate — including the
collision claim they were never measured on.

`alias-integrity.test.ts` (#5013) judges alias tables built by `strictObject`,
which registers each one alongside the `.shape` it makes claims about. The 44
call sites that predate that helper call `strictUnknownKeyError` directly and
hand it a transcribed `knownKeys` array; with no shape to register, they sat
outside every claim the gate makes.

`strictUnknownKeyError` now records its own `{ surface, knownKeys, aliases,
guidance }` in an internal registry, and the gate judges that batch too. The
registration lives in the factory, so no schema module changed.

What each claim is worth on this batch differs, and the gate says so rather than
implying uniform coverage:

- **alias key is not a known key** and **alias target is a known key** are
  answered against the transcribed array. If that array has drifted from its
  schema, both answers inherit the drift — the gap `strictObject` exists to
  abolish, and only migrating a call site closes it (#5593).
- **no two alias keys share an `aliasProbe`** (#5481) loses nothing: a collision
  is a property of the table alone. These tables were **unmeasured** on it, not
  clean — #5481 postdates the measurement recorded in #5483 — and the sweep they
  had never had comes back clean at 52 tables.

The target claim found a real one on its first run: `ui/app.zod.ts` shares four
"start expanded" aliases across all nine navigation-item variants, but `expanded`
is declared on the `group` variant alone, so on the other eight the suggestion
names a key that variant also rejects — the second rejection this campaign
exists to end. Filed as #5555 (the fix rewrites author-facing message text) and
pinned here shrink-only, structurally, so nothing else can enter the tolerance.

Two supporting pieces, both deliberately visible rather than implicit: the walk
now forces error maps that build themselves on first use (`data/object.zod.ts`
defers its map around a temporal dead zone, and would otherwise never register),
and the six prose alias targets on `ui/app.zod.ts`'s navigation items —
`type: 'url' (with url)` and friends, which name a variant rather than a key —
are an enumerated allowlist scoped to that surface, with a staleness check that
fails if an entry stops being used.

The shrink-only ratchet at 44 is unchanged. What it discourages — a new call
site minting a fresh second copy of a key list — is exactly as undesirable as it
was before these tables gained a guard.
