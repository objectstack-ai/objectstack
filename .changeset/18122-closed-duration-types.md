---
'@objectstack/spec': minor
---

spec(shared): closed duration types `DurationMs` / `DurationSeconds` beside `EpochMs` (#18122)

Two new schemas and their type aliases, reachable on the **`@objectstack/spec/shared`** subpath — the same published surface `EpochMs` reaches consumers on, and the reason this is a `minor`: the entry gains exported symbols. The root `.` entry is deliberately untouched, because `EpochMs` is not on it either and mirroring the precedent means mirroring its width.

```ts
import { DurationMs, DurationSeconds } from '@objectstack/spec/shared';

// the unit rides on the VALUE; the default stays at the site
updateAge: DurationSeconds.default(60 * 60 * 24).describe('Session update frequency'),
```

Both are `z.number().int().nonnegative()`. Author state and parsed state coincide — no `.default()` and no `.transform()` on the type itself — so there is deliberately no `DurationMsParsed` / `DurationSecondsParsed`, and the isomorphism is pinned (ADR-0122).

**Why a type and not a longer name list.** `check:duration-unit-keys` (#14478, ruling B) reads one channel: a unit token in the key NAME, cross-checked against the `.describe()` prose. It deliberately declines to judge a key whose prose names no unit at all, because judging those by name alone was measured to fire 44 times and mostly on counts wearing a duration's vocabulary — `contextWindow`, `backoffMultiplier`, `snapshotInterval` ("every N events"). Ruling A on #18115 adds a second declaration channel instead: a duration declares its unit either on its value (one of these types) or as a token in its key name, and the 25-token name list retires from judge to hint.

**Why this refinement**, measured against the six genuine duration rows the ruling derives the unit set from — `shutdownTimeout`, `cors.maxAge`, `slideInterval`, `session.updateAge`, `meta.duration` and `FileValue.duration`. Three of the six already declare `.int()`, and both rows that carry a default default to an integer (`30000`, `60 * 60 * 24`). One declares `.min(0)` and one `.positive()`; none declares a negative floor, so `.nonnegative()` is the weakest floor every declared floor implies — and `.positive()` would be too strong, since a zero timeout means "do not wait" and one of the six already accepts it.

**Nothing else moves, on purpose.** This is step ① of three. No key is converted to the new types (#18124, step ③), and no gate behaviour changes (#18123, step ②): `check:duration-unit-keys` recognises exactly one identifier root today, `EpochMs`, so a key typed `DurationMs` is outside its population rather than exempted by it — the gate learns to read the new channel in step ②. `DurationMinutes` / `DurationHours` / `DurationDays` are deliberately absent: the unit set is derived from the conversion population, never declared ahead of it, so a third unit arrives in the PR that converts the row needing it.

Nothing an author can write today is removed, renamed or refused: the six rows still declare exactly what they declared before this landed.
