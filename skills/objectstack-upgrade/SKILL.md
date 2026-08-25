---
name: objectstack-upgrade
description: >
  Upgrade an ObjectStack metadata project across a protocol major — run the
  deterministic conversion chain, then work the semantic residue the chain
  cannot express (intent choices, custom code on retired APIs, stale prose) to
  a decision with the project's owner, and finish with a green `validate` plus
  a human-readable upgrade report. Use when a project is on an older protocol
  major and must move to the current one, when `@objectstack/spec` was bumped
  across a major and metadata or code stopped parsing, when a parse or `tsc`
  error quotes a `[REMOVED]` prescription, or when asked to "upgrade to v17" /
  "升级到 v17" / "一键升级元数据项目". Do not use to author new metadata (the
  domain skills cover that), to design a retirement in the ObjectStack platform
  repo itself (that is the platform's own internal playbook), or to hand-write
  a rewrite the conversion chain already applies — running the chain is always
  the first step, never a fallback.
license: Apache-2.0
compatibility: >
  Needs `@objectstack/spec` and `@objectstack/cli` at the TARGET major
  (`os migrate meta` replays the chain from `MIGRATION_SUPPORT_FLOOR`, protocol
  10 at the time of writing). No network access required — every instruction
  source this skill harvests ships inside the installed `@objectstack/spec`
  package.
metadata:
  author: objectstack-ai
  version: "1.0"
  domain: process
  tags: upgrade, migration, protocol, major, retired-keys, tombstone, conversions, validate, report
---

# Upgrading an ObjectStack metadata project across a protocol major

This skill turns one session into an **upgrade agent** working on somebody
else's metadata project. It has one job: take a project authored against
protocol `N` and leave it authored against the current major, with the change
**proved** rather than asserted.

> **preflight → mechanical chain → semantic residue → acceptance report**

The upgrade is deliberately split into three layers, and the split is the whole
design. Two of them are not yours.

| Layer | Who owns it | What it is |
|:--|:--|:--|
| **1 · Mechanical** | The CLI. **You invoke it, you never re-implement it.** | `os migrate meta` replays the ADR-0087 conversion chain: deterministic, idempotent, fixture-tested, per-hop attributable. |
| **2 · Semantic residue** | **You, with the project's owner.** | Everything a conversion cannot express: intent choices, custom code calling retired APIs, prose that still teaches the old shape. |
| **3 · Acceptance** | The gates. | Typed + parse-gated metadata, a green `validate`, and a report a human can read. |

## ⛔ The boundary — read this before the first command

**Never hand-write a rewrite the chain already applies.** If a key was renamed,
the conversion table knows the rename; running the chain attributes each rewrite
to a hop and proves the result is schema-valid. A hand-edit does neither, and it
silently diverges the moment the chain gains an entry.

**Never add a tolerant read to make old metadata load.** No `??` alias, no
"accept both spellings" branch, no coercion in the project's own code. A key was
retired because nothing enforced it or because exactly one spelling survives;
re-admitting the old one at the consumer is how the defect the retirement closed
comes back inside the customer's repo, where no gate can see it.

**Never resolve a residue item by guessing the owner's intent.** The residue
exists precisely because it is a business decision. The rule for when you decide
alone and when you ask is in [Layer 2](#decide-alone-or-ask) — it is the most
important paragraph in this skill.

**Never report "upgraded" without the acceptance artifacts.** `validate` green
plus the report is the machine criterion. Absent either, the status is
*in progress*, whatever the diff looks like.

---

## Quickstart

```bash
# 0 · preflight — what major is this project on, what major is installed?
grep -rn "protocol" objectstack.config.ts package.json | head
node -p "require('@objectstack/spec/package.json').version"

# 1 · mechanical — replay the chain (reads the config, writes nothing but --out)
os validate > .upgrade/validate-before.txt 2>&1 || true   # the control, kept
os migrate meta --from 16 --step
os migrate meta --from 16 --json > .upgrade/migrate.json
os migrate meta --from 16 --out .upgrade/migrated.stack.json

# 2 · semantic residue — harvest the prescriptions, then work each item
node -e "console.log(require('fs').readFileSync(require.resolve('@objectstack/spec/package.json').replace('package.json','spec-changes.json'),'utf8'))" > .upgrade/spec-changes.json
grep -rho '\[REMOVED\][^"]*' node_modules/@objectstack/spec/json-schema/ | sort -u > .upgrade/tombstones.txt

# 3 · acceptance — all four, not three
os validate                      # green (compare against validate-before.txt)
tsc --noEmit                     # tombstones type the retired keys as `never`
os migrate meta --from 17        # must say "Nothing to migrate"
# → write .upgrade/REPORT.md (template in §3.4)
```

Everything below is the long form of those four steps.

---

## 0 · Preflight

### Establish the FROM major — do not guess it

`--from` is the protocol major the metadata was **authored** against, not the
one installed. Three sources, in order of authority:

1. **`manifest.protocol`** in the stack config (`'16.0.0'` → `--from 16`). This
   is the declared answer and the kernel checks it at load time.
2. **The last `@objectstack/spec` major the project ever installed** — read the
   lockfile history (`git log -p pnpm-lock.yaml | grep -m5 '@objectstack/spec'`)
   when the manifest is absent or stale.
3. **Ask.** A manifest that says 16 on a project last touched two years ago is a
   claim, not a measurement. If (1) and (2) disagree, the lower one is the safe
   `--from` — the chain is idempotent, so replaying a hop that has already been
   applied is a no-op, while skipping a hop loses its rewrites.

Arriving several majors late is the designed-for case. `os migrate meta --from 10`
replays every step in order; there is no penalty for lateness and no requirement
to upgrade one major at a time.

### Make the work reviewable before you change anything

```bash
git checkout -b upgrade/protocol-17
mkdir -p .upgrade         # every artifact this skill produces lands here
```

The `.upgrade/` directory is the deliverable's workspace: the machine outputs
(`migrate.json`, `migrated.stack.json`, `spec-changes.json`, `tombstones.txt`)
and the human output (`REPORT.md`). Keeping them in the repo for the review, and
deleting them on merge, is the usual arrangement — decide it with the owner.

---

## 1 · Mechanical layer — invoke the chain

### What `os migrate meta` actually does

```bash
os migrate meta --from 16                       # replay 16 → current
os migrate meta --from 16 --step                # per-hop checkpoint (bisect a failure)
os migrate meta --from 16 --to 17               # stop at a specific major
os migrate meta --from 16 --json                # machine-readable result
os migrate meta --from 16 --out migrated.json   # write the canonicalized stack
```

It loads the stack config, normalizes it **without** applying the load-time
conversion pass, replays each major's conversions as a chain hop, and then
parses the result against the current schema to prove the output is valid. What
it prints:

- **`Applied N mechanical change(s)`** — one line per rewritten site, as
  `path: from → to (conversionId)`. This is the diff, already attributed.
- **`N manual change(s) require your judgment`** — the chain's semantic entries
  for the majors you crossed, each with a `why` and a `verify` line. These are
  Layer 2's input, not a warning to dismiss.
- **`Migrated stack is schema-valid`** — or the warning that it is not yet,
  which means a residue item is still blocking the parse.
- **Pending data migrations**, when the chain crosses into a major with
  per-deployment data gates — see below.

### ⚠ The one fact that surprises every operator

**`os migrate meta` does not rewrite your source files.** It rewrites the
loaded stack *in memory* and reports the diff. The only file it writes is
`--out`, a JSON snapshot.

This is deliberate: rewriting a TypeScript config through an AST is lossy — it
drops comments, reorders keys, and cannot see values that come from imports or
expressions. So the mechanical layer gives you a **provably valid target** and
the **attributed list of edits**, and porting those edits into the project's own
sources is yours. Work from the printed list, one `conversionId` at a time; use
`--out` as the oracle you diff against, never as the file you ship.

```bash
os migrate meta --from 16 --out .upgrade/migrated.stack.json
# then, after porting the edits into the real sources:
os migrate meta --from 17 --out .upgrade/recheck.json   # should apply 0 changes
```

That last line is the cheapest possible proof that the port is complete: replay
the chain from the *target* major and it must find nothing to do.

### Stored rows: rehydration replays the same conversions

A deployment's `sys_metadata` rows are the other subject. They are handled for
you at read time — the metadata loader and the ObjectQL plugin both pass each
stored row through `applyConversionsToStoredItem`, which replays the conversion
chain over a single item **including entries retired from the load path**. A row
written under protocol 16 therefore rehydrates in its protocol-17 shape without
anybody editing it.

What that does and does not mean:

- **You do not hand-edit `sys_metadata`.** Ever. A row at rest has no author to
  ask, so the replay is unconditional and complete by design.
- **The rows on disk stay in their old shape** until something rewrites them.
  Rehydration is a read-time projection.
- To make it durable, run the stored pass — read-only by default:

  ```bash
  os migrate meta --stored                     # preview, writes nothing
  os migrate meta --stored --type view --type object   # narrow the pass
  os migrate meta --stored --apply             # rewrite the rows (prompts)
  ```

  `--stored` takes no `--from`: a stored row carries its own history, so the
  pass replays the whole chain. The authored-source flags and the stored-only
  flags are mutually exclusive, and mixing them is refused rather than ignored.

### Data migrations are not metadata migrations

When the chain crosses into a major carrying per-deployment data gates, the
command ends by naming them — for the 16 → 17 crossing, and only when the
project's own metadata declares the field classes each gate is about:

| Command | What staying un-run costs |
|:--|:--|
| `os migrate files-to-references` | Media values only warn instead of being enforced, and released files are never collected. |
| `os migrate value-shapes` | Stored reference and structured-JSON values are not checked against their field contracts; a malformed value only warns. |

Both are dry-run by default; `--apply` is the only writing mode. They run
**against each deployment's database**, once per deployment, and nothing in the
metadata upgrade can run them or tell whether they have run. Not running them is
safe — enforcement simply stays off. Carry them into the report as *pending*, by
name, so a gate nobody was told about is not served by nobody.

---

## 2 · Semantic residue — the part that is yours

A conversion can rename a key, drop a dead one, or lift a value onto its
declared block. It cannot make a decision. Everything it cannot do lands here.

### 2.1 Harvest the instruction sources — all of them ship

The prescriptions are not on a docs site you have to be online for. They ship
inside the installed package. **Measured** against the published
`@objectstack/spec` file list:

| Source | Where, in a consumer project | Carries |
|:--|:--|:--|
| **Chain result** | `os migrate meta --from N --json` → `.specChanges` | The conversions + semantic entries for exactly the majors you cross. **Start here** — it is computed from the installed spec, so it can never be stale. |
| **D4 projection** | `node_modules/@objectstack/spec/spec-changes.json` | The same data for every major, offline: `perMajor[].converted` and `perMajor[].migrated`. |
| **Tombstone prescriptions** | `node_modules/@objectstack/spec/json-schema/**` and `src/**/*.zod.ts` | Every retired key's `[REMOVED] …` fix-it text, greppable. |
| **FROM → TO tables** | `node_modules/@objectstack/spec/CHANGELOG.md` | The per-retirement narrative, including the "what to write instead" table. This is why the package ships its changelog. |
| **The error itself** | Your parse / `tsc` output | The same prescription string, delivered at the moment you hit it. |

```bash
# every tombstone prescription the installed spec carries, deduped
grep -rho '\[REMOVED\][^"]*' node_modules/@objectstack/spec/json-schema/ | sort -u

# the FROM → TO table for one retired key
grep -n -B4 -A20 'transform' node_modules/@objectstack/spec/CHANGELOG.md | less
```

> **Not reachable from a consumer project**, so do not send anyone there: the
> conversion and migration registries (`src/conversions/registry.ts`,
> `src/migrations/registry.ts`) and the platform repo's generated upgrade guide
> are **not** in the published package — only `src/**/*.zod.ts` is. Their
> consumer-facing projection is `spec-changes.json` and the chain's own `--json`
> output, which is exactly what the table above points at.

### 2.2 The three residue classes

**R1 · Intent choice — a key was retired with no single lossless target.**
The conversion drops the key (so the project parses) and, where it matters,
emits a notice naming the site. What the key was *for* still has to go
somewhere, and where is a business statement.

**R2 · Custom code calling a retired API.** The chain's semantic entries name
these: a service slot that no longer exists, an engine method that was removed,
a context field that was renamed. Metadata parses fine; the project's own
TypeScript is what breaks — or worse, keeps compiling while reading `undefined`.

**R3 · Prose that still teaches the old shape.** READMEs, comments, ADRs, seed
fixtures, and the project's own AI conventions file. Nothing fails, and the next
agent to read the repo re-authors the retired shape from it.

### 2.3 A worked R1 — the retired field-mapping `transform`

The shape in a protocol-16 project:

```jsonc
{
  "connectors": [{
    "name": "sap_erp",
    "fieldMappings": [
      { "source": "order_value", "target": "order_total",
        "transform": { "type": "javascript", "expression": "value / 100" } }
    ]
  }]
}
```

The chain deletes the key (`field-mapping-transform-removed`) and the schema
tombstones it, so the parse error *is* the prescription: the union had five
members and **no runtime ever executed any of them**, so nothing is lost by
deleting the key — but the customer wrote it because they wanted a
transformation, and that need is real even though the key never served it.

The prescription names two live targets, and choosing between them is the
business decision:

| If the intent was… | The v17 home is… |
|:--|:--|
| per-row value shaping on an import | **Import mapping** `mapping.fieldMapping[].transform` — a flat string enum (`none`/`constant`/`map`/`split`/`join`/`lookup`) with settings in `params`, executed row by row by the REST import path. |
| multi-source, multi-stage transformation | an **ETL transformation step**. |
| nothing — the value was already correct | delete the key and record that the transformation never ran. |

That third row is not a joke and it is frequently the truth: the member never
executed, so the connector has been landing raw values for as long as it has
been running. Whether the downstream data is therefore wrong is a question only
the owner can answer, and it is exactly the kind of finding the report exists to
surface.

<a id="decide-alone-or-ask"></a>

### 2.4 Decide alone, or ask the owner

**Decide it yourself when all three hold:**

1. **The prescription names exactly one target.** The tombstone or conversion
   summary gives a single FROM → TO, with the value unchanged.
2. **The evidence is in the project.** A grep in the repo settles it — the skill
   that already owns the tool, the import that already exists, the field the
   predicate already references.
3. **Being wrong fails a gate.** A mistaken choice breaks `tsc` or `validate`
   rather than changing behaviour quietly.

**Ask the owner when any one of these holds:**

1. **Two or more real targets, and the choice is a business statement** — the
   `transform` case above.
2. **The change is observable without a test failing** — security posture
   (an authentication default), row visibility (an access predicate), retry
   counts, retention. A wrong call here ships silently and is discovered by an
   auditor.
3. **Capability has to be re-declared somewhere new**, so choosing wrong
   *removes* a capability instead of breaking a build. Agent tooling that has to
   move inside a specific skill is the canonical shape.
4. **The source is dead or undocumented in their repo** — nothing to decide
   from. Say so; do not invent a rationale.

**How to ask.** One message, per item, carrying: the site (file and path), the
prescription verbatim, the options with what each costs, your recommendation and
why, and what you will verify once they choose. Never a bare "how should I
handle `transform`?" — that hands the reading work back to the person with the
least context about the diff.

**While you wait, do not stall the upgrade.** Park the item in the report as
`AWAITING DECISION`, keep the mechanical layer complete, and keep going. A
project can be schema-valid with open residue items; it just is not *done*.

### 2.5 Working an R2 — retired APIs in the project's own code

The chain's semantic entries are the search list. For each one, the surface it
names is a string you grep for in the project's own source:

```bash
# from the chain's own output — the surfaces it says it cannot fix for you
os migrate meta --from 16 --json | node -e "
  let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
    for (const t of JSON.parse(s).todos) console.log(t.surface);
  })"
# then, for each surface, search the project (not node_modules)
grep -rn "<surface-token>" src/ app/ --include='*.ts' --include='*.tsx'
```

Two traps that have cost real upgrades a lap:

- **A renamed context field keeps compiling.** When a read moves from one key to
  another and the old key is simply absent afterwards, the code reads
  `undefined` and every branch quietly takes its false path. Verify against a
  real dispatch, not a fixture — invoke the path and assert the value observed
  under the canonical key.
- **A rename is not always the fix.** If the old read was itself wrong, renaming
  it migrates the defect rather than the code. Read the semantic entry's
  `reason` before applying its `replacement`.

### 2.6 Working an R3 — the prose sweep

Run it last, once the shapes are settled, and run it over the whole repo:

```bash
# every retired key name the installed spec knows, as a search list
grep -rho '\[REMOVED\] `[^`]*`' node_modules/@objectstack/spec/json-schema/ \
  | sed 's/.*`\(.*\)`.*/\1/' | sort -u > .upgrade/retired-names.txt
```

Then sweep the project's `*.md`, comments, seed fixtures, and its AI conventions
file. The conventions file matters most: it is what the next agent loads before
it writes anything, so a retired shape left there re-enters the codebase on the
next feature, long after the upgrade closed.

---

## 3 · Acceptance — what "upgraded" means

Four artifacts. Three are machine-checked; the fourth is the one a human reads.

### 3.1 Typed

```bash
tsc --noEmit
```

A retired key is not merely absent from the schema — it is declared as a
tombstone whose input type is `never`. Assigning anything to it fails to
compile, at the authoring site, before anything runs. A green `tsc` is therefore
positive evidence that no retired key survives in typed sources.

### 3.2 Parse-gated

The same tombstone rejects at parse time, and the rejection carries the
prescription rather than a generic "unrecognized key". This is the channel that
catches metadata `tsc` cannot see: JSON files, database rows, anything built at
runtime. You do not have to do anything to enable it — but you **do** have to
prove it is live for this project, because a schema that silently strips is
indistinguishable from one that accepts. See
[the reverse check](#reverse-check).

### 3.3 Validate

```bash
os validate            # green is the criterion
os validate --strict   # warnings become errors — agree with the owner whether this is the bar
```

`os validate` runs two passes: the protocol schema (where tombstones reject) and
the author-time rule set. Read the two separately — a rule finding about a
missing sharing model or an options-less choice field is a **pre-existing**
project-quality issue, not upgrade residue. Establish which is which by running
`os validate` **once before you start**, on the un-upgraded source, and keeping
that output as the control. Fixing the project's standing lint debt may be a
welcome side-effect, but it is not this upgrade, and it must not be reported as
part of it.

> ### ⚠ A green `validate` does NOT mean the chain has nothing left to do
>
> Some conversions are **migration-chain-only**: the loader deliberately does
> not apply them and no tombstone rejects the old shape, because the change is a
> default flip rather than a rename — auto-applying it would stamp a constraint
> onto sources that deliberately omit it. The 16 → 17 crossing has one:
> `field-required-notnull-explicit`, which writes the physical `storage.notNull`
> that `required` used to imply on its own.
>
> A project carrying only that shape validates **green** while the chain still
> has work. So `validate` green is necessary and not sufficient, and the
> criterion that closes the gap is the replay:
>
> ```bash
> os migrate meta --from <target-major>    # must report "Nothing to migrate"
> ```
>
> Run both. A report that cites only `validate` cannot see this class at all.

### 3.4 The report — the human half

The upgrade is not finished by a passing command; it is finished by a document a
maintainer can read in five minutes and a year from now. Write
`.upgrade/REPORT.md`:

```markdown
# Protocol 16 → 17 upgrade — <project>

**Status:** complete | complete with N open decisions
**Spec:** <installed @objectstack/spec version>  ·  **Chain:** 16 → 17
**Verified:** `os validate` green · `tsc --noEmit` green · replay-from-17 applies 0 changes

## 1 · Mechanical (applied by the chain)

| Site | Change | Conversion |
|:--|:--|:--|
| `objects[crm_lead].fields.name` | `required: true` → `+ storage.notNull: true` | `field-required-notnull-explicit` |
| … | | |

_N sites, M conversions. Ported into sources from `os migrate meta --out`._

## 2 · Semantic residue (decided)

### `connector.fieldMappings[].transform` — RESOLVED
- **Site:** `src/connectors/sap.ts:24`
- **Prescription:** <verbatim from the tombstone>
- **Options:** import-mapping `transform` · ETL step · delete
- **Decision:** delete — owner confirmed the values arrive pre-scaled.
  _Decided by: <who>, <date>._
- **Verified:** `os validate` green; connector sync run against staging, 200 rows, values unchanged.

## 3 · Open decisions

| Item | Site | Options | Recommendation | Blocking? |
|:--|:--|:--|:--|:--|
| `agent.tools` → which skill | `src/ai/support-bot.ts:12` | `case_management` · new skill | `case_management` | no — parses without it |

## 4 · Pending, per deployment

- [ ] `os migrate files-to-references` — media values only warn until it passes.
- [ ] `os migrate value-shapes` — stored reference/JSON values unchecked until it passes.
- [ ] `os migrate meta --stored --apply` — rows rehydrate correctly today; this makes it durable.

## 5 · Not changed, and why

- <retired surface the project never used>  — no occurrences.
```

Section 5 earns its place: "we looked and it was not there" is a finding, and
without it the next reader cannot tell a surface that was checked from one that
was missed.

<a id="reverse-check"></a>

### 3.5 Prove the gate is real, do not assume it

Before you report the parse gate as acceptance evidence, make it fire once.
Take a value the chain *would* have converted, put it back after migrating, and
parse:

```bash
# a stack that still carries a retired key, fed straight to the schema
os validate .upgrade/residue-probe.config.mjs
```

Predict the direction **before** you run it. There are three real outcomes and
you must say which you expect:

1. **Rejected with the prescription** — a tombstoned key. This is what a
   tombstone looks like when it works:

   ```
   ✗ connectors.0.fieldMappings.0.transform
     invalid_type: `FieldMapping.transform` … was removed in @objectstack/spec
     17.0.0 (ADR-0049) … Delete the key. The transform pipeline that IS
     enforced is the import mapping's … Run `os migrate meta --from 16` to
     rewrite it automatically.
     expected: never
   ```

   Note what the error is not: not "unrecognized key", not a deprecation label.
   The fix-it text *is* the error.

2. **Accepted, and the chain rewrites it** — a conversion with a live load-path
   acceptance window. Your evidence for that key is the chain's diff, not the
   parse gate.

3. **Accepted, and the chain still rewrites it** — a migration-chain-only
   conversion (§3.3). `validate` cannot see this class at all; only the replay
   can.

Record which one you actually got. A check whose expected direction you did not
state in advance proves nothing, and "it passed" is a different fact in each of
the three cases.

---

## The v17 prescription set, as of `17.0.0-rc.5`

This section is a **pinned reading**, not a live list. It was measured from the
spec sources at the `17.0.0-rc.5` publish and is deliberately bounded so that
entries registered after that publish are a visible *delta* rather than a silent
contradiction.

| Reading | Value at `17.0.0-rc.5` |
|:--|:--|
| `@objectstack/spec` version | `17.0.0-rc.5` (protocol `17.0.0`) |
| Chain support floor | protocol 10 |
| D2 conversions for major 17 | **45** |
| D3 semantic entries for major 17 | **29** |
| `retiredKey()` tombstones in shipped `*.zod.ts` | **113**, across 32 files |
| Distinct `[REMOVED]` prescriptions in shipped `json-schema/` | **96** |

`RETIRED_KEYS_BY_MAJOR[17]` — every authorable key formally tombstoned under the
exact-key registry at this publish (3 entries, one retirement: the property is
declared once and inherited by two extending schemas, so it is registered three
times):

- `data/ExternalFieldMapping:transform`
- `integration/ConnectorFieldMapping:transform`
- `shared/FieldMapping:transform`

`RETIRED_DEFS_BY_MAJOR[17]` — every whole schema def unpublished at this publish
(1 entry):

- `shared/FieldMappingTransform`

> **Why these two tables are short and the counts above are not.** They record
> retirements registered under the exact-key gates that created them, which are
> newer than most of protocol 17's work; they are explicitly *not* a backfill of
> every retirement ever. The 45 conversions and 113 tombstones are the real size
> of the v17 surface. Use the tables to answer "was this retirement formally
> registered", and the conversions/tombstones to answer "what do I have to
> change" — the second question is the upgrade's question.

### How this table is refreshed

**Never hand-edit the numbers above from memory.** Re-measure against whatever
spec the project has installed — one command per row:

```bash
# protocol version, support floor, and the per-major conversion / semantic counts
node -e "
  const p = require.resolve('@objectstack/spec/package.json');
  const j = require(p.replace('package.json','spec-changes.json'));
  const e = j.perMajor.find(x => x.to === 17);
  console.log(j.protocolVersion, 'floor', j.supportFloor, '| 16→17:',
              e.converted.length, 'converted,', e.migrated.length, 'semantic');
"

# tombstone prescriptions actually present in this install
grep -rho '\[REMOVED\][^"]*' node_modules/@objectstack/spec/json-schema/ | sort -u | wc -l
```

If a reading disagrees with the table, **the install wins** — the table is a
snapshot of one publish, and post-`rc.5` registrations are expected to add
entries. Record the delta in the upgrade report rather than editing this
section's pinned numbers; the pin is what makes a later disagreement legible
instead of invisible.

---

## The v17-canonical shapes, compiled

What the protocol-16 shapes in this skill's examples look like after the
upgrade. This block is type-checked against the published spec, so it cannot rot
into teaching a shape that no longer compiles:

<!-- os:check -->
```typescript
import { ObjectSchema } from '@objectstack/spec/data';
import { defineAgent } from '@objectstack/spec/ai';

// `conditionalRequired` → `requiredWhen`; `required` now also states the
// physical constraint explicitly via `storage.notNull`.
export const Lead = ObjectSchema.create({
  name: 'crm_lead',
  sharingModel: 'public_read_write',
  label: 'Lead',
  fields: {
    name: { type: 'text', required: true, storage: { notNull: true } },
    status: { type: 'select', required: true, storage: { notNull: true } },
    due_date: { type: 'date', requiredWhen: 'record.stage == "closed"' },
    notes: { type: 'textarea' },
  },
});

// Agent capability is reached through skills — there is no inline tool list.
export const SupportBot = defineAgent({
  name: 'support_bot',
  label: 'Support Bot',
  role: 'Front-line support triage',
  instructions: 'Answer support questions and open cases when needed.',
  skills: ['case_management'],
});
```

---

## Failure modes

| Symptom | What it actually is | Fix |
|:--|:--|:--|
| `migrate meta` reports changes, but the files are unchanged | Working as designed — the command writes nothing but `--out`. | Port the printed edits into the sources, then replay from the target major to confirm 0 changes. |
| Replay from the target major still applies changes | The port is incomplete, or a source builds metadata at runtime from a shape the chain never saw. | Diff against `--out`; grep for the `conversionId`'s surface in code that constructs metadata dynamically. |
| `validate` green, but a feature silently stopped working | An R2 residue item: code reading a renamed key now reads `undefined`. | Exercise the path for real. A green parse says nothing about a `??` chain in the project's own code. |
| `validate` green from the start, so "there was nothing to upgrade" | A migration-chain-only conversion — no tombstone rejects it, so nothing complains. | Replay the chain anyway. `validate` green is necessary, not sufficient; see [3.3](#33-validate). |
| `validate` reports findings that have nothing to do with retired keys | The author-time rule pass, not the schema pass. | Diff against the pre-upgrade `validate` control. Pre-existing findings are not this upgrade's scope. |
| A retired key round-trips without error | The schema carrying it is not strict and the key is being stripped, or the key still has a live load-path window. | Determine which — the two need different acceptance evidence. See [the reverse check](#reverse-check). |
| `--apply` refused / stored-only flag rejected | `--apply`, `--yes`, `--force`, `--type`, `--database-url` mean something only with `--stored`. | Add `--stored`, or drop the flag; the authored-source chain has nothing to write to. |
| `MigrationFloorError` | `--from` is older than the chain's support floor. | Upgrade to the floor by an older route first; the floor is a release-policy boundary, not an oversight. |

## Guardrails (binding)

1. **Run the chain first, always.** It is the only source of an attributed,
   schema-proved diff.
2. **One conversion id per commit**, where the project's review culture allows
   it. The `conversionId` is the commit's subject line and its justification.
3. **No tolerant reads, ever** — not in the metadata, not in the project's code.
   A retirement that gets re-admitted at the consumer is a defect that moved
   into a repo with no gate over it.
4. **Ask about intent, decide about mechanics.** The split in
   [2.4](#decide-alone-or-ask) is the contract with the project's owner.
5. **The report is a deliverable, not a summary.** No report, not done.
6. **Never leave a pending per-deployment data migration unnamed.** A gate
   nobody was told about is served by nobody.

## Cross-skill routing

- Authoring the corrected metadata — load the domain skill for the shape you are
  fixing (**data**, **ui**, **automation**, **ai**, **api**, **i18n**).
- Any CEL predicate you rewrite while resolving a residue item — load
  **formula**.
- Runtime, plugin, and CLI questions the upgrade turns up — load **platform**.
- This skill covers the **consumption** side of a retirement. Designing one
  inside the ObjectStack platform repo is a different job with its own internal
  playbook, and it is not this one.
