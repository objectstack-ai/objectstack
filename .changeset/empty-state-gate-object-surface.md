---
"@objectstack/spec": patch
---

chore(spec): the empty-state gate now scans platform-object definitions, where #3896 actually happened

#3945 added a gate requiring any *"empty = permissive"* statement in the spec to
be classified on purpose. It scanned `packages/spec/src/**/*.zod.ts` — and that
scope had a hole big enough to miss the bug it was built for.

The sentence that shipped #3896, *"leave empty to share every record"*, was the
`description` of `sys_sharing_rule.criteria_json`, which lives in
**`plugin-sharing`**. The gate could not see its own crime scene.

**Now scans `**/*.object.ts` anywhere under `packages/`** — plugins,
`platform-objects`, `metadata-core`, and the `create-objectstack` templates
(a starter file is the highest-leverage thing a model copies from). 214 → 290
files.

**It immediately found a real one.** `sys_user_permission_set.organization_id`
declares *"NULL = applies in every org context"*: a user↔permission-set grant with
no org scope applies everywhere. That is deliberate and load-bearing rather than
an oversight — ADR-0095 D3 / ADR-0068 D2 derive the `platform_admin` posture from
an **unscoped** `admin_full_access` grant specifically, and an org-scoped grant of
the same set must not confer it. So the empty state is not merely wider, it is the
distinguishing input to the highest privilege in the system. Registered `open`
with that rationale and both enforcement sites cited, which is the point: the
answer now lives somewhere other than a maintainer's memory.

Three fixes the new surface forced, each a case of the gate being wrong in a way
that mattered:

- **Repudiated prose no longer fires.** #3929's own comment on `criteria_json`
  reads *Deliberately NOT "leave empty to share everything"* — the gate flagged the
  sentence recording why the gate exists. Negation is now handled for the
  imperative form as well as the token form (`deny-all`), and the escape is
  deliberately narrow: the negator must be attached to the phrase, not merely
  present in the line, because a false negative here is a missed over-share.
- **The owning property is found by nesting, not by a name list.** A field's prose
  sits in a nested key, so the first attempt answered `description` for every
  platform-object hit; skipping doc slots then answered `required`, the sibling
  above it. What separates a field from its own config is indentation, so the
  resolver now takes the nearest key at a shallower indent.
- **The property-search window is per-surface.** A platform-object `description:`
  can sit 15+ lines below its field name; a `.zod.ts` statement sits beside its
  property. Widening globally would let `.zod.ts` narrative be mis-attributed to a
  distant property — turning a correct non-failing note into a wrong failure — so
  `.object.ts` gets a wider window and the schema surface keeps its tight one.

Also makes evidence resolution honest: entries are now parsed with the liveness
ledger's own `checkEvidence`, so prose around the paths works, several paths can
be cited, and another repo's path (`objectui: …`) is recorded without being
resolved here. The README already promised evidence resolved "like the ledger's";
a single raw-path `existsSync` quietly did not.

6 new unit tests (32 total). No runtime behaviour changes.
