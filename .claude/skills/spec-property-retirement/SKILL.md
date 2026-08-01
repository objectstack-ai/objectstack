---
name: spec-property-retirement
description: >
  Internal playbook for retiring an authorable `packages/spec` property under
  ADR-0049 enforce-or-remove — choosing the removal route, the liveness-ledger
  discipline each route implies, the ADR-0087 conversion, the generated
  baselines, forms, docs and pin tests a removal needs, and the gates that fail
  when any of it is missing. Use when a metadata key is declared-but-unenforced
  and the job is to REMOVE it, or when a ledger `dead` verdict needs confirming
  before you act on it: "retire this property", "enforce-or-remove", "the ledger
  says dead", "remove the inert key", "close out the liveness worklist". NOT a
  customer-published skill — internal agent tooling (lives in .claude/, never in
  the published `skills/` dir).
metadata:
  # Hides this skill from interactive `npx skills add objectstack-ai/objectstack`
  # discovery, same as dogfood-verification. Enforced by
  # packages/create-objectstack/src/template-consistency.test.ts.
  internal: true
---

# Spec property retirement (ADR-0049 enforce-or-remove)

A parsed-but-unenforced property is a silent no-op; for a security or capability
property it is **false compliance** — `tool.permissions` promised an invocation
gate nothing enforced, `flow.active: false` never stopped a flow. ADR-0049 says
such a property must be **enforced**, marked **`experimental`**, or **absent**.
This skill is the third path: what a removal actually costs, and in what order.

Removing the key is maybe 5% of the work. The other 95% is that a key is
authorable in ~14 places, and **every gate that guards one of them fails
separately and sequentially** — one stale surface masks the rest, so you get one
red build per surface instead of one for all of them.

Read the verification side first: `packages/spec/liveness/README.md` (how a
verdict is reached, `verifiedAt`, why a preview renderer is not a consumer) and
AGENTS.md §"Touched `packages/spec`?" (the eight generated artifacts). This file
does not repeat them.

## 0. Before you remove: is removal the right disposition?

- [ ] **Is it security/capability-shaped?** Then ADR-0049 binds and inertness is
      a defect, not debt. `rls.enabled` was "live with wrong evidence" and
      actually UNREAD — a disabled policy kept contributing its grant. That one
      got **enforced**, not removed. Enforcement wins when the feature exists.
- [ ] **Is it docs-shaped?** `hook.label`, `hook.description`, `flow.description`
      have no runtime consumer and are **deliberately KEPT** — they document
      intent for the next reader (per ADR-0033, often a model). Record the
      exemption in the ledger `note` so the next audit doesn't re-litigate it.
      Benign display metadata (`description`, `tags`, `icon`) is never
      "misleading"; do not mark it `authorWarn` and do not retire it.
- [ ] **Is there a committed roadmap?** Then `experimental` + a
      `[EXPERIMENTAL — not enforced]` `.describe()` marker, not removal.
- [ ] **Same-major bookkeeping.** If an earlier conversion in the *same
      unreleased major* renames a key you are now deleting, **absorb** it: fold
      the rename into the removal and delete the rename entry. Composed, its
      effect is unobservable, and the conversion table's fixture-disjointness
      contract (§3) will fail if you stack them. Precedent: `agent.knowledge`
      swallowed the `topics`→`sources` rename pre-release.

## 1. The build is the referee — not the ledger

A ledger `dead` verdict is an **input** to removal, not a substitute for the
build's own proof. It is a claim with a timestamp, and code moves under it in
both directions (`flow.status` and `action.undoable` were both *understated*).

So: **attempt the removal, then let the build rule on it.** In the #3896
close-out, `view.form.data` was on the worklist as dead ("no form-path reader in
either repo") and the removal broke `gen:schema` — `defineForm` writes
`data: { provider: 'schema', schemaId }` onto every `*.form.ts`, and
`metadata-protocol` serves it to the metadata-admin pipeline. The right response
is **not** to force the removal: correct the ledger entry to `live` with the real
evidence and a `verifiedAt`, narrow the conversion, and pin the non-warn. One of
fourteen keys was refuted this way — budget for it.

Two corollaries:

- **`tsc` and the gates are your best sweepers.** A `retiredKey()` tombstone
  types the key `never`, so *every* authoring site in the monorepo fails to
  compile. Two of three `template: true` sites in `examples/app-showcase` were
  found by the tombstone after a grep missed them. Let the tombstone find the
  callers before you go hunting.
- **A grep can only prove presence.** To prove absence, close the call graph by
  hand (declaration → registration → accessor → *caller*) or author the property
  and boot the app. See the README's "How to verify a claim without fooling
  yourself" — including that `git grep -E` does not honour `\b` on macOS.

## 2. The fork: which removal route (decides everything downstream)

| Schema | Route | Mechanism |
|---|---|---|
| **not `.strict()`** | `retiredKey()` tombstone | `retiredKey(guidance)` in `packages/spec/src/shared/retired-key.ts` — `z.never({ error: () => guidance }).optional()`. Two channels: `tsc` (input type `never`) and the parse (the prescription itself, not "unrecognized key"). |
| **`.strict()`** | delete the key + guidance map | Delete from the shape; add an entry to a `*_RETIRED_KEY_GUIDANCE` record consumed by a `z.core.$ZodErrorMap` passed as `z.object(shape, { error: … }).strict()`. Reference: `packages/spec/src/ai/tool.zod.ts:29-93,180`. Also `object.zod.ts`'s `UNKNOWN_KEY_GUIDANCE` for object top-level keys. |
| **nothing parses it** | neither | A prescription nobody can receive is noise. Drop the baseline lines deliberately and say so in the changeset — precedent `packages/spec/src/kernel/plugin-runtime.zod.ts:243-248`. |

Never plain-delete a key from a non-strict schema: zod strips it silently and
you have replaced one silent no-op with another (the #2169 "Mark Done does
nothing" shape).

### ⚠ The ledger discipline is OPPOSITE per route — and the two failures are not symmetric

The liveness gate walks the **schema's shape** and looks up each property in
`packages/spec/liveness/<type>.json`. A `retiredKey()` is still a property in
that shape. Therefore:

| Route | Key still in the walked shape? | Its ledger entry |
|---|---|---|
| `retiredKey()` tombstone | **YES** (`z.never()` is a property) | **STAYS** — `status: "dead"`, a `verifiedAt`, and a `note` saying REMOVED + why the entry remains |
| strict removal | no | **DELETED**, along with any CLI advisory-lint expectation |

Both directions now fail CI, so getting it backwards is loud either way:

- deleting a **tombstoned** key's row reports it **UNCLASSIFIED** (14 at once in
  the #3896 sweep — the mistake this section exists to prevent);
- leaving a **strict-removed** key's row reports it as an **ORPHAN** row.

The orphan leg is new (`scripts/liveness/orphans.mts`). Until it landed, this
direction never failed at all — the gate walked the schema and looked rows up, so
a row whose key had left the shape was simply never asked about, and rotted in
place. That is how the report `aria`/`performance` rows outlived their keys by a
full release, deleted by hand only because someone happened to read the file. If
you hit the orphan error and the property really is still authorable, the fix is
the **walk**, not the row: a property the walk cannot see is a property the
ratchet cannot govern.

Note template for a tombstone entry (verbatim house style, e.g.
`liveness/action.json`):

> `REMOVED <date> (#<issue>) — tombstoned at the schema (retiredKey carries the prescription; authoring it is a tsc error and a parse error) and stripped from sources by the protocol-<N> conversion. The entry stays because retiredKey keeps the key in the walked shape (the rls.priority precedent); <what to do instead>.`

### Writing the guidance string

Five conventions, obeyed by all ~28 tombstones in tree:

1. Backticked **fully-qualified** key first — `` `flow.errorHandling.fallbackNodeId` ``, not the bare tail.
2. `was removed in @objectstack/spec <version> (#issue[, ADR-XXXX Dn])`.
3. An em-dash clause on **why it was inert or wrong** — "it never had an effect", "no renderer ever read it".
4. The imperative fix: for a rename, "use `<replacement>`" + "Rename the key; the value (…) is unchanged."; for a removal, "Delete the key." + **what the live mechanism actually is**.
5. ``Run `os migrate meta --from <N-1>` to rewrite it automatically.`` — **only** when a conversion rewrites sources. No message names a conversion id; the conversion is referenced by the CLI command.

This string *is* the migration doc for whoever hits it, including someone
jumping several majors at once, whom the load-path conversion no longer covers.

## 3. Register the surface (ADR-0087 D2/D3) — or the gate stops you

`scripts/build-schemas.ts` gate (b) fails any newly-tombstoned key with no
registered migration surface: the tombstone is audible only to whoever *hits*
it, while `spec-changes.json`, the generated upgrade guide and the
`spec_changes` MCP tool are the primary channel and would stay empty.

- [ ] **A `MetadataConversion`** in `packages/spec/src/conversions/registry.ts`:
      kebab-case `id` ending `-removed`, `toMajor`, one
      `emit({ from, to: '(removed)', path })` per key (use the shared `stripKeys`
      helper), and a `fixture` whose `expectedNotices` equals the **key** count,
      not the item count. Walkers (`mapCollection`, `mapFlowNodes`, `renameKey`)
      live in `conversions/walk.ts` and are copy-on-write — return the input
      reference untouched when nothing matched.
- [ ] **`surface` must end with the bare key.** The matcher is
      `surfaces.some((s) => s.endsWith('.' + key))` after
      `.flatMap((s) => s.split(' / '))`. Multi-key conversions join clauses with
      exactly `' / '` (house style since the tool sweep) and **each clause must
      end with its own key**. Caveat: only the last dotted segment is compared,
      so the schema name is never checked — `dashboard.aria` would satisfy
      `ui/FormView:aria`. Don't lean on the gate for attribution.
- [ ] **`retiredFromLoadPath: true`** — for a retirement, always. Two distinct
      justifications, and they are not interchangeable: for a *rename* it means
      "no alias window, deliberately" (the tombstone owns the refusal; the entry
      exists so `spec-changes.json` and `os migrate meta` still carry it); for a
      **default flip** it is load-bearing for correctness — a loader that
      auto-applied `field-required-notnull-explicit` would stamp NOT NULL onto
      17-authored `required: true`, silently restoring the tri-binding ADR-0113
      removed. Only `migrate meta --from <old>` may apply a flip, where "this
      source predates the split" is a fact rather than a guess.
- [ ] **A D3 chain step** in `packages/spec/src/migrations/registry.ts` — add the
      id to `MIGRATIONS_BY_MAJOR[N].conversionIds` and extend that step's
      `rationale`. `conversion.toMajor` **must equal** the step's major.
      ⚠ Nothing asserts "every conversion is wired into a step" directly, and a
      typo'd id is **silently skipped at replay**; the chain-replay test catches
      it only because an unwired fixture never reaches its `after`. So read that
      test's failure as "not wired", not "transform broken".
- [ ] **Fixtures must be DISJOINT — twice over.** Every fixture is replayed
      through the *whole* table and must equal exactly its own `after`, with
      every notice attributed to its own id. Keep `before` minimal and avoid
      other entries' keys (a new `objects[].fields` fixture must not carry a bare
      `required: true`, or the notNull conversion fires on it). Second
      constraint, easy to miss: a `retiredFromLoadPath` fixture must ALSO be
      untouched by every *live-window* conversion, since a separate test asserts
      it passes through the default load path with zero notices. This
      disjointness contract is what forces same-major absorption (§0).
- [ ] **Idempotence is by construction, not by test.** No test replays a
      conversion twice. A `stripKeys` deletion is idempotent (`if (!(key in
      next)) continue`) and `renameKey` refuses to clobber an existing canonical
      value; a default flip is **not** idempotent-safe and relies on its own
      guard plus `retiredFromLoadPath`. If your transform is none of those
      shapes, prove idempotence yourself — the CLI e2e
      (`packages/cli/test/migrate-meta.e2e.test.ts`) replays the migrated
      snapshot and asserts `applied` is empty.
- [ ] **Response-surface keys with no source to rewrite** register as a
      `SemanticMigration` (D3 `semantic[]`) with non-empty `reason` and
      `acceptanceCriteria` instead — `EnhancedApiError.fieldErrors` is the
      worked example.

## 4. The surface checklist

Work top to bottom; each line has a gate behind it.

- [ ] **Schema** — tombstone or strict removal (§2), plus the in-schema comment
      saying what was removed and what the live mechanism is.
- [ ] **Orphaned value schemas** — a key's `XxxConfigSchema` with no other
      consumer goes with it (`PerformanceConfigSchema`, `AIKnowledgeSchema`,
      `ToolCategorySchema`). An exported schema with no consumer is read as a
      capability by whoever finds it (#3950 precedent). This — and *only* this —
      moves `api-surface.json`: that snapshot prints type *references*, not
      expanded shapes, so it is blind to key-level narrowing (#3883 removed three
      keys from `defineAction`'s input and the snapshot did not change). Its gate
      also lives in a different workflow (`TypeScript Type Check`, not
      `Check Generated Artifacts`) and reads the built `dist/*.d.ts`.
- [ ] **Conversion + chain step** (§3).
- [ ] **Liveness ledger** — per §2's route table, with `verifiedAt`. Update the
      README's per-type row **and its counts** (that table has drifted badly
      once; regenerate the counts with the python snippet in the README rather
      than hand-editing).
- [ ] **Generated baselines** — `pnpm --filter @objectstack/spec gen:schema`
      moves `authorable-surface.json` (tombstone → a new `… [RETIRED]` line;
      strict removal → the line **vanishes**, which is gate (a)'s trip wire, so
      delete it in the same PR deliberately) and `json-schema.manifest.json`.
      Then `gen:spec-changes`, `gen:upgrade-guide`, `gen:api-surface`,
      `gen:docs`. See AGENTS.md for the you-changed-X → regenerate-Y table.
- [ ] **Forms** — prune the `{ field: '<key>' }` input from
      `packages/spec/src/**/*.form.ts`. A form input for an unenforced capability
      is the UI half of false compliance. Leave a one-line comment where it was.
- [ ] **i18n bundles** — pruning a form input changes the extracted labels:
      `pnpm i18n:extract` regenerates
      `packages/platform-objects/src/apps/translations/*.metadata-forms.generated.ts`
      (merge mode; a retirement is a pure deletion). Gated by `pnpm check:i18n`.
- [ ] **CLI advisory lint** — `packages/cli/src/utils/lint-liveness-properties.ts`
      is ledger-driven, so a retired key stops warning by itself; update its
      **test** to assert the non-warn ("the strict parse owns them now").
- [ ] **Pin tests** — one negative asserting the prescription itself
      (``.toThrow(/<key>.*removed.*use `<replacement>`/s)`` — the `s` flag is
      house style, since the message spans lines) and one positive asserting
      `not.toHaveProperty(key)` for the non-strict strip path. Reference
      `packages/spec/src/ai/agent.test.ts:69-95`.
- [ ] **Examples** — `examples/app-showcase/**` must stop authoring the key.
      `tsc` finds these for you on the tombstone route.
- [ ] **Published skills** — `skills/*/SKILL.md` teaching the key (tables,
      `defineX` examples) — gated by `check:skill-examples` and `check:skill-refs`.
- [ ] **Docs** — `content/docs/**` prose, tables and code blocks — **EXCEPT
      `content/docs/releases/`, which a code PR must never touch** (AGENTS.md
      Documentation Guardrails). Release notes are written centrally at release
      time from the changesets + the D2/D3 registries; the per-PR row this list
      used to require made `releases/v<major>.mdx` the repo's hottest conflict
      magnet. Your changeset (next item) is the input that reaches them. For
      the rest of `content/docs/**`: grep the key, then read the surrounding
      files — a removed key hides in a `defineFlow` example three sections from
      the reference table.
- [ ] **Changeset** — `major` for `@objectstack/spec`. AGENTS.md: a breaking
      changeset must carry the FROM → TO mapping and the one-line fix; it ships
      as `CHANGELOG.md` in the npm package and is what an upgrading agent greps
      after the tombstone error. `.changeset/tool-inert-keys-removed.md` is the
      model — its "The retirement kit:" section is the template to copy.

**A correction (§1) must propagate to every one of these lines too.** When
`form.data` flipped back to `live`, the ledger, the conversion and the tests were
all corrected — but the release-notes row and the ledger README row kept listing
it as removed, telling authors to delete a key `defineForm` writes. Found and
fixed a PR later. The correction path is the one nobody has a checklist for; use
this one.

## 5. Run the gates so they can actually fail

```bash
cd packages/spec && pnpm build          # REQUIRED first — see the dist trap below
for c in check:liveness check:empty-state check:authorable-surface check:docs \
         check:api-surface check:spec-changes check:upgrade-guide \
         check:skill-refs check:skill-docs check:skill-examples; do
  pnpm -s "$c" >/dev/null 2>&1; e=$?     # capture BEFORE anything else runs
  printf '%-28s %s\n' "$c" "$( [ $e -eq 0 ] && echo PASS || echo FAIL )"
done
cd ../.. && pnpm check:i18n && pnpm --filter @objectstack/spec test
```

`check:liveness`, `check:empty-state`, `check:skill-examples` have no generator —
a failure there is a real finding, not a stale artifact.

## 6. Traps that have each cost a red build

- **Stale `dist` (5+ false alarms in one line of work).** Packages load from
  `dist`. A local suite failing after you edited `src` usually means the dist is
  old, not that you broke it — `check:api-surface` reads `dist/*.d.ts` and will
  report phantom "breaking removals". `pnpm turbo run build --filter=<pkg>...`
  before you believe any local red, and before filing a bug about `main`.
- **`| tail -1` masks the exit code.** Piping a gate to `tail` reports the
  pipeline's status, so a failing gate reads as green. Capture `exit=$?`
  explicitly (as the loop above does). A liveness failure hid behind this.
- **Truncated greps miss authors.** `| head -8` hid the `SKILL.md`
  `defineSkill` example; `examples/` had three `template: true` sites, not one.
  Search files-by-context, then grep the key inside them — and treat `tsc` and
  the gates as the authoritative sweepers.
- **Sequential gates mask each other.** `Check Generated Artifacts` and
  `TypeScript Type Check` each run their gates in order and stop at the first
  failure. Regenerate everything up front; don't iterate one red build at a time.
- **A green CI can mean a dormant gate.** `check-generated` runs behind a
  `paths` filter in `ci.yml`; a path missing from it makes the gate silent on
  exactly the PRs that break it (the reason the filter carries
  `packages/spec/src/**` wholesale). If you add a generated artifact or a new
  input to one, add its paths in the same PR.
- **Editing only a conversion's `summary` still goes stale.** That string is
  copied verbatim into `spec-changes.json`'s `to` field and into the upgrade
  guide's table row, so a prose-only touch needs `gen:spec-changes` +
  `gen:upgrade-guide` like any other change.
- **`--check` mode is the gate; bare mode rewrites.** `gen:*` fixes the file,
  `check:*` is the same script asserting it was committed. Never "fix" a
  `check:*` failure by editing the generated file by hand.
