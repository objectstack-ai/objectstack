# Audit: downstream consumer census — `PointInTimeRestore` and the `plugin-detail` barrel (2026-09)

**Question** (objectui#7175): does anything *outside this repo* render
`@object-ui/plugin-detail`'s `PointInTimeRestore`?

**Why it exists**: objectui#7163 / PR #7172 measured that `PointInTimeRestore` has **zero
in-repo consumers** — barrel-exported only, no mount point anywhere in `objectui`. That
measurement was correct but it is *not* the question ADR-0049 enforce-or-remove needs
answered, because **"zero in-repo consumers" is not "zero consumers."** The component is
published public API; a downstream application may render it. This audit takes the
reading the in-repo one could not.

**Populations**: `objectstack-ai/hotcrm`, `objectstack-ai/cloud`.

⛔ **This audit does not retire anything.** Retiring a published component is
ADR-0049 / ADR-0087 (objectstack) and narrows public surface. This is the measurement that
makes that decision *possible*, not the decision.

---

## Conclusion (2026-09-24): the maintainer ruled **delete**

The decision this audit made possible has since been taken. On 2026-09-24 triage put the
question "delete the seven unregistered, unmounted `plugin-detail` exports?" to the
maintainer with a recommendation to delete, and relayed the reply on objectui#7192 (triage
comment 5819441716, which quotes it verbatim). The reply declined two other items by number
and approved the rest. The seven exports were among the rest, so the ruling is **delete**.

- **The gap this audit left open was closed first.** `cloud` was read on
  objectstack#14187 (all seven names, controls firing, zero). `hotcrm` is zero by
  construction: it depends on no `@object-ui/*` package (the objectui#7175 reading of
  2026-09-04).
- **Delivered by the pull request that closes objectui#7192 and objectui#7175**, on branch
  `claude/issue-7192-retire-seven-unmounted-detail-exports`. It deletes all seven components
  (`CommentInput`, `DiffView`, `InlineCreateRelated`, `MentionAutocomplete`,
  `PointInTimeRestore`, `RecordNavigationEnhanced`, `RelationshipGraph`), their own tests,
  their value and type exports from the barrel, and the i18n keys that only they read.
  Its changeset lists every removed export and the migration.
- **No replacement is kept "in case".** If a real consumer turns up, it gets a new card that
  says who needs the component and where, and the component comes back on that evidence.

The rest of this document is the audit as written on 2026-09-01. Its "does not retire" and
"does NOT claim" statements describe what this measurement established on its own, and they
stay as that record.

---

## Summary

| Population | Channel | Positive control | `PointInTimeRestore` | Verdict |
| --- | --- | --- | --- | --- |
| `objectui` (in-repo, re-confirmed) | local worktree @ `899730e0a` | `RecordComments` mounted 2x in `DetailView.tsx` | 0 mounts | unrendered here (confirms #7163) |
| `hotcrm` @ `a6be39a3d` | anonymous shallow git clone | **HIT** — 104 `plugin-detail` node references | **0 on every spelling** | **zero — measured** |
| `cloud` | none reachable | n/a | n/a | ⚠️ **NOT MEASURED** |

**Headline**: no measured consumer, anywhere, renders `PointInTimeRestore` — and in
`hotcrm` it is not merely absent, it is **structurally unreachable** (see below). One
population, `cloud`, could not be read at all and is reported as its own category.

⚠️ **NOT MEASURED is not zero and not green.** `cloud` is unread, not clean.

---

## Channel evidence

Each clone's exit code was captured **before any pipe**, beside a same-shape control.

| Command | Exit | Reading |
| --- | --- | --- |
| `git clone --depth 1 .../hotcrm.git` | **0** | 828 tracked files at `a6be39a3d` |
| `git clone --depth 1 .../objectui.git` (control) | **0** | 6039 tracked files at `899730e0a` |
| `git clone --depth 1 .../cloud.git` | **128** | `could not read Username` — auth wall |
| `git ls-remote .../cloud.git` | **128** | same wall, second command shape |
| `git ls-remote .../hotcrm.git` (control) | **0** | refs listed |
| session repo-attach for `cloud` | error | `you don't have access to objectstack-ai/cloud` |

`cloud` was refused on **three independent channels**, two of which returned a live
control in the same breath. It is unreadable from this seat, not empty.

---

## The reachability argument — stronger than the grep

`hotcrm` is a **metadata application**. It declares UI as JSON-ish metadata rendered by
objectui; it does **not** import objectui as a library:

- `@object-ui/*` appears in exactly **3** `hotcrm` files, and all three are **prose
  comments** (`crm.app.ts:169`, `account_detail.page.ts:32`,
  `scripts/analytics-reconcile/macros.ts:5`).
- Real imports of any `@object-ui` package: **0**. `hotcrm`'s `package.json` depends on
  `@objectstack/*` only.

So the only channel by which `hotcrm` can reach an objectui component is a **registered
component type string** in metadata. And:

> `PointInTimeRestore` is **never** passed to `ComponentRegistry.register`. `plugin-detail`
> makes 16 registrations; none of them is this component. There is no auto-registration —
> no `Object.entries(...)`/`forEach(register)` pattern exists in the barrel (0 hits).

⇒ `PointInTimeRestore` **has no type string**, so a metadata app cannot name it. The zero
below is therefore not a lucky grep; it is what the architecture requires.

---

## The `hotcrm` reading

**Positive control — same repo, same instrument, same channel** (`plugin-detail`
components that `hotcrm` actually mounts):

| Node type | References in `hotcrm` |
| --- | --- |
| `record:details` | 31 |
| `record:related_list` | 21 |
| `record:highlights` | 17 |
| `record:activity` | 16 |
| `record:path` | 12 |
| `record:chatter` | 4 |
| `record:history` | 3 |
| **total** | **104** |

The instrument resolves 104 references to *this very package* in *this very repo*. It is
productive here, so a zero from it is a reading.

**Target — every spelling, all zero:**

| Spelling probed | Hits in `hotcrm` | Same probe in `objectui` (control) |
| --- | --- | --- |
| `point[-_ ]?in[-_ ]?time[-_ ]?restore`, case-insensitive | **0** | 26 |
| `PointInTimeRestore` exact identifier | **0** | 26 |
| `PointInTimeRestoreProps` | **0** | 3 |
| `RevisionEntry` (the co-exported type) | **0** | 5 |
| loose `point[-_ ]?in[-_ ]?time` | **0** | 30 |
| `import(...PointInTime...)` lazy form | **0** | 0 |
| `plugin-detail` package specifier | **0** | 870 |

The separator/case-insensitive pattern covers named import, namespace member, re-export,
kebab (`point-in-time-restore`), snake (`point_in_time_restore`) and camel spellings in
one shot. **The identical pattern set returns 26 hits in `objectui`** — the probes fire.

**Every semantic near-miss attributed.** One hit for `snapshot.*restore`:
`test/forecast-manual-override.test.ts:279` — *"deleting the manual row restores automated
snapshotting"*. Forecast snapshots, unrelated to revision history. Not a render.

Non-zero hits for sibling *identifiers* (`DetailSection` 4, `CommentInput` 3, and so on)
were each read: all are prose comments, test docstrings, or `@objectstack/spec/ui` type
names such as `RecordRelatedListProps`. Since `hotcrm` has zero objectui imports, none can
be a render.

---

## Bonus: `PointInTimeRestore` is not an isolate

Once the instrument answers "is X reachable", it answers it for X's siblings for free. Of
`plugin-detail`'s **29** component-shaped barrel exports, **7** are neither registered
(no metadata type string) nor mounted anywhere in this repo:

| Unregistered **and** unmounted | Registered? | In-repo mounts |
| --- | --- | --- |
| `CommentInput` | no | 0 |
| `DiffView` | no | 0 |
| `InlineCreateRelated` | no | 0 |
| `MentionAutocomplete` | no | 0 |
| **`PointInTimeRestore`** | no | 0 |
| `RecordNavigationEnhanced` | no | 0 |
| `RelationshipGraph` | no | 0 |

None of the seven has a dynamic reference either (`React.lazy`, `createElement`, or a
string literal of its own name): 0 for all seven.

⇒ `PointInTimeRestore` is the **visible instance of a seven-member class**, not a one-off.
That is the difference between one retirement card and an enforce-or-remove ledger. This
audit does not act on the other six; it records them.

⚠️ Unmounted is **not** the same as unreachable-and-dead. `RecordComments` is also
unregistered, yet `DetailView` mounts it directly at `:1479` and `:1705` — a component can
be perfectly live through a sibling's JSX without ever having a type string. The class
above is specifically *both* doors closed.

---

## Method — re-runnable, and its one recorded failure

Deliberately **not committed as a test**: it clones external repositories, so it cannot
run in CI, and a committed test that cannot run renders as coverage while measuring
nothing (objectui#7183). It is recorded here instead, to be re-run by hand.

```bash
git clone --depth 1 https://github.com/objectstack-ai/hotcrm.git /tmp/hotcrm   # exit BEFORE any pipe
# controls first, target second; every count printed as an integer, never blank
grep -rIF --exclude-dir=.git 'record:details' /tmp/hotcrm | wc -l               # expect > 0
grep -rIE --exclude-dir=.git -i 'point[-_ ]?in[-_ ]?time[-_ ]?restore' /tmp/hotcrm | wc -l
```

⚠️ **Two instrument traps, both hit during this audit.**

1. `git grep -c` prints **nothing**, not `0`, on no match. Every count above is piped
   through `wc -l` so a zero is always a printed integer.
2. The in-repo mount probe first used `<Name[[:space:]/>]` and reported **0 mounts for
   `RecordComments`** — a component known to be mounted twice. Cause: grep is
   line-oriented and these JSX tags end the line (`<RecordComments` with props on the
   following lines), so the trailing character class could never match. Fixed to
   `<Name($|[[:space:]/>])`, which returns the expected 2. **The whole sibling table was
   re-derived after the fix and gated on that control passing.** A probe that cannot see
   its own known-positive is not measuring.

Counts are from `main` at audit time — a baseline, not a frozen census.

---

## What this audit does NOT claim

- ⛔ Not that `PointInTimeRestore` should be retired. That is ADR-0049 / ADR-0087, it
  narrows public surface, and it is a decision this audit only makes *possible*.
- ⛔ Not that `cloud` is clean. `cloud` is **unread**.
- ⛔ Not that the other six unmounted exports are dead. They are unmounted and
  unregistered *here*; they have had no downstream census of their own.
- ⛔ Not that PR #7172's i18n sweep was wrong. It was reviewed and upheld.

Refs: objectui#7175 (this census) · objectui#7163 / PR #7172 (the in-repo measurement and
the sweep) · objectui#7183 (why this is not a committed test) · objectstack ADR-0049,
ADR-0087.
