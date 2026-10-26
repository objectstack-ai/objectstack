#!/usr/bin/env node
/**
 * Every key a designer's statically declared payload shape can emit must be a
 * key the installed spec schema that judges that shape accepts by name.
 *
 * Two oracles, because the designers PUT a two-level document. A field shape is
 * judged by `FieldSchema`, the parent object document by `ObjectSchema`, and
 * each shape in {@link PAYLOAD_SHAPES} names the one that judges it. The gate
 * shipped for objectui#5761 carried only the field oracle, so nothing checked
 * the document those fields are nested in — and objectui#6223 then found three
 * object-level keys (`group`, `sortOrder`, `relationships`) that `ObjectSchema`
 * refuses by name, sitting on the wire the whole time the gate was green.
 *
 * A THIRD and FOURTH oracle, because the permission matrix is a SECOND
 * authoring surface carrying the same two ingredients (objectui#6606). Its
 * statically declared shapes are in
 * `packages/app-shell/src/views/metadata-admin/permission-slice.ts`:
 * `PermissionSetDraft` is the record `PermissionMatrixEditor.doSave` hands to
 * `client.save`, and `ObjectPerm` is one authorization row inside that
 * record's `objects` map — nested exactly as a field shape is nested in the
 * object document. They are judged by `PermissionSetSchema` and
 * `ObjectPermissionSchema`. Nothing in this repo watched that surface before:
 * objectui#6595 (the retired `allowRestore` / `allowPurge` checkboxes) is an
 * instance of precisely this gate's class, and it arrived as a hand-written
 * card from the upstream retirement (objectstack#12497) rather than from CI.
 *
 * The permission entries are the same EMIT-SIDE check as everywhere else, and
 * deliberately so: `ObjectPerm` is a hand-written SUBSET of the spec's
 * `ObjectPermission` (it omits `allowExport`, `readScope`, `writeScope` —
 * objectui#6605). Under-coverage is a different question from the one this gate
 * answers and stays a separate card; a key the shape can EMIT that the schema
 * refuses is this one.
 *
 * The failure class (objectui#5761): a designer offers a control that
 * writes a key the spec refuses BY NAME. The author sees the control work
 * — and, in metadata-admin, sees the preview render it — then
 * `PUT /api/v1/meta/object/:name` returns a hard 422 `INVALID_METADATA` that
 * blocks EVERY subsequent save of that object until the key is stripped. The
 * author has no way to tell which key did it from the UI they were using.
 *
 * This repo has filed that same shape three times, and each instance took a
 * DIFFERENT correct resolution — which is what makes it a class rather than a
 * coincidence:
 *
 *   indexed          objectui#4644 — control retired + strip-on-load
 *   distance_metric  objectui#4687 — declaration removed (zero readers/writers)
 *   placeholder      objectui#4676 — producer moved: declared UPSTREAM,
 *                    objectstack#9019 / PR objectstack#9113, shipped in
 *                    `@objectstack/spec` 17.1.0
 *
 * What existed before this gate was three per-key tombstones, each keyed to one
 * literal: two independently maintained `RETIRED_FIELD_KEYS = ['indexed']` sets
 * (`packages/app-shell/src/views/metadata-admin/previews/object-fields-io.ts`
 * and `packages/plugin-designer/src/MetadataFieldsPage.tsx`) plus prose
 * tombstones in four more files. Every one of them was written AFTER an
 * instance was found in production. Nothing detected the next one, so instance
 * four would again be found by a user hitting a save-blocking 422 rather than
 * by CI.
 *
 * `scripts/check-spec-symbol-derivation.mjs` is NOT this guard and does not
 * overlap it: that one checks symbol NAME collisions between a local
 * declaration and a `@objectstack/spec` export. This one never looks at symbol
 * names — it compares KEY SETS, and the shapes it reads are deliberately named
 * nothing like the spec's.
 *
 * ── WHAT THIS GATE COVERS, AND WHAT IT DOES NOT ─────────────────────────────
 * Read this section before concluding that a key is safe because the gate is
 * green. The gate covers a SUBSET of the designer write path, and a guard that
 * reads as complete while covering a subset is the same declared-≠-actual
 * defect this file exists to close.
 *
 * COVERED — the statically declared payload shapes in {@link PAYLOAD_SHAPES}.
 * A key is visible to this gate when it is written as a property signature on
 * one of those interfaces. That is enough to have caught all three instances
 * above: `indexed` was a declared property of the designer field definition,
 * `distance_metric` a declared property, `placeholder` a declared property.
 * On the permission surface it is what will show `allowRestore` / `allowPurge`
 * on `ObjectPerm` the moment the spec bump carrying their retirement lands —
 * the return direction the filing card named.
 *
 * NOT COVERED — four ways a key can reach the payload without ever appearing as
 * a declared property:
 *
 *   1. `patchDef({...})` spreads. `ObjectFieldInspector` writes through many
 *      conditional `patchDef({ ... })` calls onto a `Record<string, unknown>`
 *      def. A key that reaches the payload ONLY through such a spread is
 *      OUTSIDE THIS GATE'S REACH — nothing declares it, so there is no property
 *      signature to read. Enumerating that set is not mechanical, which is the
 *      honest limit objectui#5761 states rather than hides.
 *   2. Index signatures. `ServerFieldSchema` declares `[key: string]: unknown`
 *      and `fromDesignerField` spreads `prev` verbatim to preserve unknown
 *      keys, so any key the SERVER sent round-trips back out untyped. The gate
 *      records the presence of an index signature (see `indexSignature` in the
 *      analysis) precisely so this hole is visible in its own output, but it
 *      cannot enumerate what flows through one.
 *   3. Untyped `Record<string, unknown>` field defs. `object-fields-io.ts`'s
 *      `readFields`/`writeFields` carry raw defs with no declared shape at all.
 *      Its round-trip is covered instead by an executable parity test — see
 *      `object-fields-io.field-schema-parity.test.ts`, which parses real
 *      round-tripped output through the real `FieldSchema` and carries the
 *      negative controls this gate's self-test carries.
 *   4. Value-level rejections. This gate is a check on key NAMES only. A key in
 *      the accept set whose VALUE `FieldSchema` refuses (wrong type, failed
 *      refinement) is green here and still a 422 in production.
 *
 * ── The accept set is read from the schema, never listed here ───────────────
 * All four oracles are strict zod objects: they refuse unknown keys with
 * `unrecognized_keys` rather than stripping them (objectstack#4001 closed the
 * silent-drop shape). Each accept set is read off the schema's own `shape` at
 * run time.
 *
 * WHICH SUBPATH each is read from is itself declared, in
 * {@link ORACLE_SPECIFIERS}, because it is not one subpath: measured against
 * `@objectstack/spec` 17.2.0, `/data` exports `FieldSchema` / `ObjectSchema`
 * and neither permission schema, while `/security` exports both permission
 * schemas. An oracle that map does not carry is an extraction ERROR —
 * defaulting to `/data` would silently read the wrong module and pass over
 * everything.
 *
 * It is read through a dynamic `import()`, NOT `createRequire`, and that is
 * load-bearing rather than stylistic. `@objectstack/spec` is a dual-package
 * build: `require` lands on `dist/data/index.js`, `import` on
 * `dist/data/index.mjs`, and `/security` carries the identical export map
 * (`dist/security/index.js` vs `dist/security/index.mjs`), so this reasoning
 * applies to the permission oracles unchanged. Those are two different module instances of the same
 * schema, so a CJS-resolving gate cannot be proven — by identity — to be
 * reading the build the app bundles against, and the two could drift with
 * nothing to notice. Importing makes the self-test's `===` against a plain
 * `import { FieldSchema } from '@objectstack/spec/data'` — and, for the
 * permission oracles, from `@objectstack/spec/security` — a real proof of
 * provenance, which is the assertion that rules out the whole
 * wrong-symbol failure mode. This is why the exported functions are async. A hardcoded copy would be the stale second definition this whole
 * family of gates exists to prevent, and — worse for a parity check — a wrongly
 * resolved or loosened schema produces a CONFIDENT GREEN over everything. So
 * extraction failure is an ERROR, never a pass: {@link ExtractionError} is
 * thrown when the spec cannot be resolved, when the shape cannot be walked, or
 * when a shape file no longer declares the interface this gate reads.
 *
 * The self-test (`scripts/__tests__/check-designer-field-key-parity.test.ts`)
 * carries the non-vacuity controls as executable assertions: a fixture
 * declaring an un-stripped `indexed` must be reported, a fixture declaring a
 * bogus key must be reported, and the resolved schema must be the INSTALLED
 * `@objectstack/spec` `FieldSchema` rather than a local structural look-alike
 * (`plugin-designer`'s own `ServerFieldSchema` is such a look-alike — it is one
 * of this gate's INPUTS, never its oracle).
 *
 * ── The ledger, and why the gate is a ratchet rather than a bug report ──────
 * The first run over `main` surfaced live offenders. Fixing them is NOT this
 * gate's job and was explicitly out of scope when it was built: the three
 * instances above took three different correct resolutions, so choosing one for
 * a given key is an adjudication a tooling card does not carry. Each surfaced
 * key is instead filed as its own card and recorded in
 * {@link KNOWN_UNPARSEABLE_KEYS} with that card's number.
 *
 * The ledger ratchets in BOTH directions, which is what keeps it from becoming
 * a place to hide:
 *
 *   - a refused key on a wire-bound shape that is NOT in the ledger is red, so
 *     no NEW instance can land;
 *   - a ledger entry whose key is no longer refused, or no longer declared, is
 *     ALSO red, so a fixed key cannot leave a stale entry behind that would
 *     silently re-admit the same spelling later.
 *
 * ── The tombstone registry is this gate's single source for RETIREMENT ──────
 * objectui#6699. The three drifted per-site retired-key literals converged into
 * one registry (objectui#6527, maintainer option B):
 * {@link RETIRED_KEY_REGISTRY_FILE}. A registry with no gate pinning it is a
 * convention, and conventions drift — the three literals it replaced are the
 * proof, each written AFTER an instance was found in production.
 *
 * So the retirement facts this gate uses are READ FROM THAT FILE, never copied
 * here. It is read from the TRACKED SOURCE with the same TypeScript AST walk
 * {@link PAYLOAD_SHAPES} are read with — deliberately NOT through the built
 * `@object-ui/types/internal/retired-field-keys` subpath, so this gate gains no
 * build precondition and keeps running on a cold cache. Extraction failure is
 * an {@link ExtractionError}, never a pass: a missing registry, a missing
 * constant, a tombstone with no `key`, or a `sites` record naming a site the
 * registry does not declare all stop the run.
 *
 * WHAT IS DERIVED — one rule, and it is the one the ledger could not state:
 *
 *   A RETIREMENT IS NOT WAIVABLE AT A SITE THAT STRIPS THE KEY. Where a wire
 *   shape IS one of the registry's strip sites (`stripSite` below) and the
 *   tombstone marks that site `true`, a {@link KNOWN_UNPARSEABLE_KEYS} row
 *   cannot quiet the key. The ledger is for keys whose resolution is still
 *   OPEN; a tombstoned key's resolution already happened, on the card the
 *   tombstone names. Re-declaring one and filing a fresh ledger row would
 *   re-open a settled retirement in silence — the ledger becoming the hiding
 *   place the ratchet note says it must never be. Such a violation is reported
 *   with the registry entry (key, retiring card, per-site columns) INSTEAD of
 *   the "file a card and record it" invitation the other violations carry.
 *
 * THE PER-SITE ASYMMETRY SURVIVES AS DATA, and that is load-bearing rather than
 * tidy. The registry is deliberately not nested, so this gate must never
 * flatten it into one "retired everywhere" key set:
 *
 *   - the rule above is evaluated PER (key, site) — the same key with a `false`
 *     column at the shape's own site stays an ordinary, ledgerable violation,
 *     because at that site the registry makes no claim to enforce. Measured on
 *     the registry as it stands: `sortOrder` is `true` at
 *     `metadataServiceCarryOver` and `false` at `metadataFieldsPageCarryOver`,
 *     one key with two verdicts.
 *   - `formula`'s READ-DOOR column is `false` — RULED, objectui#6526 option B:
 *     `ObjectFieldInspector` seeds its CEL editor from
 *     `def.expression ?? def.formula` and the first edit migrates it, so
 *     stripping on read destroys authored expression text. This gate never
 *     asserts, and never implies, that `formula` is stripped there: the read
 *     door has no statically declared payload shape at all (coverage note 3),
 *     so it is declared in {@link SITES_WITH_NO_DECLARED_SHAPE} and NOTHING is
 *     judged against it. Its column is reproduced verbatim in the citation, on
 *     the NOT-stripped side, which is the registry's own word for it.
 *   - a registry site accounted for NOWHERE — named by no shape and not
 *     declared shapeless — is an {@link ExtractionError}. That is what makes
 *     the registry the single SOURCE rather than a single copy: it cannot grow
 *     a site while this gate goes on judging the old three in silence.
 *
 * COLUMNS CONSUMED: `key`, `retiredBy`, `sites`. Columns deliberately NOT read
 * — `specEquivalent` is documentation and never an instruction to rename
 * (objectui#6043 refused exactly that rename for `formula`), and `defensive`
 * records how strong the EVIDENCE for a strip is, which is the registry's
 * verdict to keep and no input to a key-name parity comparison. Neither is
 * extracted, so neither can quietly acquire a meaning here.
 *
 * The registry's OWN contract — every tombstoned key being refused by the
 * installed `FieldSchema`, `formula`'s read-door column, `sortOrder`'s
 * single-site defensive verdict, per-site list parity — is pinned by
 * `packages/types/src/__tests__/retired-field-key-tombstones.test.ts` and is
 * deliberately NOT duplicated here. A second copy of an assertion is a second
 * thing to keep honest, which is the defect this whole family closes.
 */

import ts from "typescript";
import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { isEntrypoint } from "./invoked-as.mjs";

/**
 * The wrapper-key vocabulary, shared with the TypeScript readers that walk the
 * same Zod internals (objectui#6923, ruled 2026-08-31 — objectui#5872 class (3)).
 *
 * A bare-node gate cannot import `@object-ui/test-support` itself: that entry is
 * TypeScript source with no build artefact. `/zod-wrapper-keys` is the subpath
 * the ruling gave the DATA — build-free JSON — so both language sides read the
 * same bytes. The WALK stays local on purpose: sharing a FUNCTION across this
 * boundary is explicitly outside that ruling.
 *
 * `createRequire` rather than `import ... with { type: "json" }`, and the
 * difference is load-bearing: this module is imported BOTH by `node` (the gate
 * run) and by Vite's SSR transform (its pin tests in `scripts/__tests__/`).
 * Measured — under the SSR transform the attributed JSON import yields no
 * default export, and the walk fails with "__vite_ssr_import_N__.default is not
 * iterable" instead of reading the list. `createRequire` is the same idiom
 * `loadSpecSchemas` below already uses, and behaves identically in both.
 */
const ZOD_WRAPPER_KEYS = createRequire(import.meta.url)(
  "@object-ui/test-support/zod-wrapper-keys"
);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** A gate that cannot read its inputs. Never a pass — see the header. */
export class ExtractionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExtractionError";
  }
}

const fail = (message) => {
  throw new ExtractionError(message);
};

const readFile = (root, rel) => readFileSync(resolve(root, rel), "utf8");
const parse = (root, rel) =>
  ts.createSourceFile(rel, readFile(root, rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/**
 * The statically declared field payload shapes the designers write through.
 *
 * `reach` is what makes a finding actionable, and it is a claim about the
 * CODE, not a severity dial:
 *
 *   wire — the interface types a value that is handed to
 *          `client.meta.saveItem('object', …)`, i.e. it becomes the body of
 *          `PUT /api/v1/meta/object/:name`. A refused key declared here is a
 *          live 422 the moment the property is populated.
 *   ui   — the designer's in-memory model. Its keys reach the wire only
 *          through converters (`toFieldPayload`, `fromDesignerField`) whose
 *          RETURN TYPE is one of the `wire` shapes above, so a key declared
 *          here and on no `wire` shape cannot reach the payload through any
 *          statically declared path. Such keys are reported as `uiOnly` —
 *          visible, but not a violation. The moment one of them is added to a
 *          `wire` shape the `wire` scan catches it, so the classification is
 *          computed on every run rather than asserted once.
 *
 * `stripSite` is the retired-key registry's strip site this shape's FILE is, or
 * `null`. It is what lets the retirement rule be evaluated per (key, site)
 * instead of over a flattened key set — see the header. Every entry answers it
 * explicitly, no column left implicit: a shape that simply omitted it would opt
 * out of that rule in silence, which is the shape of every defect in this file's
 * history.
 */
export const PAYLOAD_SHAPES = [
  {
    id: "FieldMetadataPayload",
    file: "packages/app-shell/src/services/MetadataService.ts",
    interface: "FieldMetadataPayload",
    schema: "FieldSchema",
    reach: "wire",
    // `toFieldPayload` builds it; `saveFields` PUTs `fields.map(toFieldPayload)`
    // and `saveObject` PUTs it through `toObjectPayload`.
    writer: "MetadataService.saveFields / saveObject",
    // This file is ALSO the registry's `metadataServiceCarryOver` strip site
    // (`carryOver`, objectui#6488), which is why the retirement rule can be
    // evaluated per site here rather than over a flattened key set.
    stripSite: "metadataServiceCarryOver",
  },
  {
    id: "ServerFieldSchema",
    file: "packages/plugin-designer/src/MetadataFieldsPage.tsx",
    interface: "ServerFieldSchema",
    schema: "FieldSchema",
    reach: "wire",
    // `fromDesignerField` builds it; `MetadataFieldsPage` PUTs the assembled
    // `fields` map. Carries an index signature — see coverage note 2.
    writer: "MetadataFieldsPage.handleFieldsChange",
    // ALSO the registry's `metadataFieldsPageCarryOver` strip site.
    stripSite: "metadataFieldsPageCarryOver",
  },
  {
    id: "DesignerFieldDefinition",
    file: "packages/types/src/designer.ts",
    interface: "DesignerFieldDefinition",
    schema: "FieldSchema",
    reach: "ui",
    writer: "FieldDesigner (in-memory model)",
    stripSite: null,
  },
  {
    id: "ObjectMetadataPayload",
    file: "packages/app-shell/src/services/MetadataService.ts",
    interface: "ObjectMetadataPayload",
    schema: "ObjectSchema",
    reach: "wire",
    // `toObjectPayload` builds it; `saveObject` PUTs it whole to
    // `PUT /api/v1/meta/object/:name`, fields nested inside.
    writer: "MetadataService.saveObject",
    stripSite: null,
  },
  {
    id: "ServerObjectSchema",
    file: "packages/plugin-designer/src/MetadataObjectsPage.tsx",
    interface: "ServerObjectSchema",
    schema: "ObjectSchema",
    reach: "wire",
    // `handleObjectsChange` merges the manager's edits onto the raw server
    // payload and PUTs the result. Carries an index signature — coverage
    // note 2 applies here too, and with more force: this shape is BUILT by
    // spreading the server's own document.
    writer: "MetadataObjectsPage.handleObjectsChange",
    stripSite: null,
  },
  {
    id: "ObjectDefinition",
    file: "packages/types/src/designer.ts",
    interface: "ObjectDefinition",
    schema: "ObjectSchema",
    reach: "ui",
    writer: "ObjectManager (in-memory model)",
    stripSite: null,
  },
  {
    id: "PermissionSetDraft",
    file: "packages/app-shell/src/views/metadata-admin/permission-slice.ts",
    interface: "PermissionSetDraft",
    schema: "PermissionSetSchema",
    reach: "wire",
    // `PermissionMatrixEditor.doSave` writes it with
    // `client.save(type, name, toSave)`. At package scope `mergePermissionSlice`
    // first rebuilds it from a freshly-read base (ADR-0086 P0) — the merged
    // result is still this shape, so the declared keys are the same body either
    // way. Carries an index signature (coverage note 2), which here is a stated
    // contract rather than an oversight: a key this editor does not model is
    // carried through save untouched.
    writer: "PermissionMatrixEditor.doSave",
    stripSite: null,
  },
  {
    id: "ObjectPerm",
    file: "packages/app-shell/src/views/metadata-admin/permission-slice.ts",
    interface: "ObjectPerm",
    schema: "ObjectPermissionSchema",
    reach: "wire",
    // One authorization row inside `PermissionSetDraft.objects`, so it reaches
    // the very same saved body one level down — the field-in-object nesting
    // again, which is why it needs its own oracle rather than riding on the
    // record's.
    writer: "PermissionMatrixEditor.doSave (objects[name] row)",
    stripSite: null,
  },
];

/**
 * Keys this gate surfaced on the tree it landed on, each with the card that
 * owns its resolution. NOT a suppression list: see the header's ratchet note —
 * an entry that stops applying is as red as a key that is missing one.
 *
 * `oracle` scopes the entry to the schema that refuses the key, defaulting to
 * `FieldSchema`. It is load-bearing, not decoration: `sortOrder` is refused at
 * BOTH levels by two different schemas, and they are two different cards with
 * two different resolutions. Without the scope, one card's entry would absorb
 * the other level's occurrence and the gate would stay green over it.
 *
 * `spec` records the accepted spelling where the spec has one, because that is
 * the fact a resolver needs first and the fact most likely to be wrong in a
 * hurry. It is documentation for the card, never an instruction to rename:
 * objectui#4687 shows that "delete the declaration" is sometimes the right
 * answer even when a near-spelling exists.
 */
export const KNOWN_UNPARSEABLE_KEYS = {
  // objectui#6043 `formula` was resolved and its entry removed. The resolution
  // was NOT the rename this ledger's `spec` column recorded as available, which
  // is the header's point about `spec` being documentation and never an
  // instruction: `FieldSchema` accepts `expression` without parsing the CEL in
  // it, so renaming would have shipped the retired control's `price * quantity`
  // placeholder — bare field refs that evaluate to null under the `record`
  // scope — under a valid key name. The control was removed instead; the field
  // TYPE `formula` is unaffected and remains a valid spec `FieldType`.
  // objectui#6045 `sortOrder` (FIELD level) was resolved and its entry removed.
  // The resolution was objectui#4687's — delete the declaration — because the
  // key had zero readers and zero writers: `toFieldPayload` copied it, nothing
  // ever populated it, and `JSON.stringify` dropped the `undefined`. The `spec`
  // column recorded no equivalent and there was none to take: `sortable` is a
  // boolean ("whether field is sortable in list views"), and the spec models
  // field order by DECLARATION ORDER in the object's `fields` record rather
  // than by an index on the field. It was dropped from the wire shape
  // (`FieldMetadataPayload`), from its writer, and from the UI model
  // (`DesignerFieldDefinition`) in one go.
  //
  // The FIELD entry going away does not touch the OBJECT level: that spelling
  // is still refused by `ObjectSchema` and still declared on `ObjectDefinition`
  // (objectui#6223 kept it there as the Object Manager's display order), where
  // the gate reports it as `uiOnly`. That is why this entry was oracle-scoped:
  // removing it must not, and does not, quiet the other level.
  // objectui#6238 `enabled` (OBJECT level) was resolved and its entry removed.
  // The resolution was objectui#4687's for the declaration and a mechanism
  // change for the writers, and it needed both because the two halves failed
  // differently: `ObjectMetadataPayload` declared the key and `toObjectPayload`
  // never populated it (latent), while `deleteObject` / `deleteMetadataItem`
  // put it on the wire inside a hand-written tombstone `{ name, enabled: false,
  // _deleted: true }` that no declared shape described — coverage note 1, the
  // hole this gate states rather than hides.
  //
  // The `spec` column recorded no equivalent and there was none to take. The
  // near-spelling `enable` is `ObjectCapabilities`, a system-features module
  // object, so `enabled: false` -> `enable: false` fails on the VALUE where it
  // passes on the name; and the 42-key accept set has no on/off flag at all.
  // Measured before the fix: 25 of the 26 registered overlay schemas refuse
  // `enabled`/`_deleted` by name, and where a type's schema is tolerant
  // (`view`) or unregistered the framework stores the body verbatim while
  // nothing on the platform reads `_deleted` — a 422 on one side, a silent
  // no-op on the other, and no soft-delete convention to converge onto. Both
  // writers now call `client.meta.deleteItem`, i.e. the same
  // `DELETE /meta/:type/:name` `MetadataClient.reset` issues.
  //
  // Nothing about this entry's removal touches the FIELD oracle, and the
  // spelling is unrelated to `ObjectDefinition.isSystem` / the UI-only keys the
  // gate still reports below.
};

/**
 * The retired-field-key tombstone registry — this gate's single source for
 * WHICH KEYS ARE RETIRED and WHERE (objectui#6527, pinned here by
 * objectui#6699). See the header section for what is derived from it.
 *
 * The TRACKED SOURCE, not the built `@object-ui/types/internal/…` subpath: a
 * gate that needed `packages/types` built first would be unrunnable on a cold
 * cache, and this file already reads every other input off the AST.
 */
export const RETIRED_KEY_REGISTRY_FILE = "packages/types/src/internal/retired-field-keys.ts";

/**
 * Registry strip sites that deliberately have NO statically declared payload
 * shape, with the reason — the value is printed in the run log.
 *
 * `metadataAdminFieldsReadDoor` is `object-fields-io.ts`'s `readFields`, which
 * carries raw `Record<string, unknown>` field defs and declares no interface at
 * all: coverage note 3, the hole this gate states rather than hides (its
 * round-trip is pinned executably by `object-fields-io.field-schema-parity`
 * and `object-fields-io.retiredKeys`). So this gate judges NOTHING at that
 * site — which is also what keeps it clear of objectui#6526 option B: the read
 * door must NOT strip `formula`, and a gate with no assertion there cannot
 * drift into implying that it does.
 *
 * A registry site that is neither named by a shape's `stripSite` nor listed
 * here is an {@link ExtractionError}. Being shapeless is a recorded decision,
 * never a default.
 */
export const SITES_WITH_NO_DECLARED_SHAPE = {
  metadataAdminFieldsReadDoor:
    "no statically declared payload shape (coverage note 3) — nothing is judged at this site",
};

/** Peel `as const`, `satisfies T` and parentheses off an initializer. */
const unwrapExpression = (node) => {
  let current = node;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current))
  ) {
    current = current.expression;
  }
  return current;
};

/** The initializer of `const <name> = …`, found anywhere in the file. */
const constInitializer = (sf, name) => {
  let found = null;
  const visit = (node) => {
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) {
          found = unwrapExpression(d.initializer);
        }
      }
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
};

/** The declared name of an object-literal property, or null. */
const propertyName = (prop) =>
  prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) ? prop.name.text : null;

/**
 * Read the tombstone registry off {@link RETIRED_KEY_REGISTRY_FILE}'s AST.
 *
 * Returns `{ file, sites, tombstones }` where each tombstone is
 * `{ key, retiredBy, sites: Record<site, boolean> }` — the three columns this
 * gate consumes. `specEquivalent` and `defensive` are deliberately not read;
 * see the header.
 *
 * Every failure here is an {@link ExtractionError}. A registry this gate cannot
 * read is the confident-green case: "no tombstones" would read as "nothing is
 * retired", which is precisely the drift objectui#6527 closed.
 *
 * The return type is spelled out because `tsconfig.scripts.json` INFERS this
 * file's types for the pin tests (`allowJs`, `checkJs: false`): the walk's
 * `ts.Node` narrowing is invisible to that inference, so without this the tests
 * would consume an `any` and their assertions would stop being checked.
 *
 * @param {string} [root]
 * @param {string} [rel]
 * @returns {{
 *   file: string,
 *   sites: string[],
 *   tombstones: { key: string, retiredBy: string, sites: Record<string, boolean> }[],
 * }}
 */
export function readRetiredKeyRegistry(root = REPO_ROOT, rel = RETIRED_KEY_REGISTRY_FILE) {
  if (!existsSync(resolve(root, rel))) {
    fail(
      `the retired-field-key registry ${rel} does not exist — it moved, or was deleted.\n` +
        "    Re-point this gate at it (objectui#6527 made it the single source for retirement);\n" +
        "    an unreadable registry is never a pass, and a copied key list here is the drift it closed."
    );
  }
  const sf = parse(root, rel);

  const sitesNode = constInitializer(sf, "RETIRED_FIELD_KEY_SITES");
  if (!sitesNode || !ts.isArrayLiteralExpression(sitesNode)) {
    fail(
      `\`RETIRED_FIELD_KEY_SITES\` is not an array literal in ${rel} — the registry's shape changed.\n` +
        "    Fix the walk; do NOT hardcode the site list here."
    );
  }
  const sites = sitesNode.elements.map((el) => {
    if (!ts.isStringLiteral(el)) {
      fail(`\`RETIRED_FIELD_KEY_SITES\` in ${rel} holds a non-string element — the walk cannot read it.`);
    }
    return el.text;
  });
  if (sites.length === 0) {
    fail(`\`RETIRED_FIELD_KEY_SITES\` in ${rel} is empty — a registry with no sites cannot be checked against.`);
  }

  const tombstonesNode = constInitializer(sf, "RETIRED_FIELD_KEY_TOMBSTONES");
  if (!tombstonesNode || !ts.isArrayLiteralExpression(tombstonesNode)) {
    fail(
      `\`RETIRED_FIELD_KEY_TOMBSTONES\` is not an array literal in ${rel} — the registry's shape changed.\n` +
        "    Fix the walk; an empty read would report every retired key as un-retired."
    );
  }
  if (tombstonesNode.elements.length === 0) {
    fail(
      `\`RETIRED_FIELD_KEY_TOMBSTONES\` in ${rel} is empty — read as "nothing is retired", which is the\n` +
        "    silent-green case this gate exists to prevent. If the last tombstone really was retired,\n" +
        "    that is a decision to record, not to infer from an empty array."
    );
  }

  const tombstones = tombstonesNode.elements.map((element, index) => {
    const obj = unwrapExpression(element);
    if (!obj || !ts.isObjectLiteralExpression(obj)) {
      fail(`tombstone #${index + 1} in ${rel} is not an object literal — the walk cannot read it.`);
    }
    const props = obj.properties.filter((p) => ts.isPropertyAssignment(p));
    const valueOf = (name) => props.find((p) => propertyName(p) === name)?.initializer ?? null;

    const keyNode = valueOf("key");
    if (!keyNode || !ts.isStringLiteral(keyNode)) {
      fail(
        `tombstone #${index + 1} in ${rel} declares no string \`key\` — a nameless tombstone retires nothing,\n` +
          "    and reading past it would drop a retirement this gate is supposed to hold."
      );
    }
    const key = keyNode.text;

    const retiredByNode = valueOf("retiredBy");
    if (!retiredByNode || !ts.isStringLiteral(retiredByNode)) {
      fail(
        `the \`${key}\` tombstone in ${rel} declares no string \`retiredBy\` — the citation this gate prints\n` +
          "    instead of inviting a ledger row would name no card, which is worse than no citation."
      );
    }

    const sitesValue = valueOf("sites");
    if (!sitesValue || !ts.isObjectLiteralExpression(sitesValue)) {
      fail(
        `the \`${key}\` tombstone in ${rel} declares no \`sites\` record — per-site applicability is the\n` +
          "    registry's load-bearing half (objectui#6526 / objectui#6527); it must never be inferred."
      );
    }
    /** @type {Record<string, boolean>} */
    const siteFlags = {};
    for (const prop of sitesValue.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        fail(`the \`${key}\` tombstone's \`sites\` record in ${rel} holds an entry the walk cannot read.`);
      }
      const site = propertyName(prop);
      if (site === null) {
        fail(`the \`${key}\` tombstone's \`sites\` record in ${rel} holds a computed key — it cannot be read statically.`);
      }
      if (!sites.includes(site)) {
        fail(
          `the \`${key}\` tombstone in ${rel} names the site \`${site}\`, which \`RETIRED_FIELD_KEY_SITES\` does not declare.\n` +
            "    One of the two is stale; reading past it would evaluate the retirement against a site that does not exist."
        );
      }
      const value = prop.initializer;
      if (value.kind !== ts.SyntaxKind.TrueKeyword && value.kind !== ts.SyntaxKind.FalseKeyword) {
        fail(
          `the \`${key}\` tombstone's \`${site}\` column in ${rel} is not a boolean literal.\n` +
            "    A column this gate cannot read is a column it must not guess at."
        );
      }
      siteFlags[site] = value.kind === ts.SyntaxKind.TrueKeyword;
    }
    return { key, retiredBy: retiredByNode.text, sites: siteFlags };
  });

  return { file: rel, sites, tombstones };
}

/**
 * Oracle name -> the PUBLISHED SUBPATH its schema is exported from.
 *
 * Declared here rather than inlined at the import because it is the seam that
 * decides WHICH MODULE INSTANCE judges a payload, and it is not one subpath:
 * the permission schemas are not on `/data` (measured, `@objectstack/spec`
 * 17.2.0). `/security` has the same dual-package export map as `/data`, so the
 * header's provenance argument carries over verbatim and the self-test pins
 * each of the four by reference identity against a plain `import` from the
 * subpath named here.
 *
 * An oracle a shape names and this map does not carry is an
 * {@link ExtractionError} — never a default. Falling back to `/data` for an
 * unknown oracle is the confident-green failure this whole file exists to
 * prevent.
 */
export const ORACLE_SPECIFIERS = {
  FieldSchema: "@objectstack/spec/data",
  ObjectSchema: "@objectstack/spec/data",
  PermissionSetSchema: "@objectstack/spec/security",
  ObjectPermissionSchema: "@objectstack/spec/security",
};

/** The oracle names a shape may name, in the order they are reported. */
export const ORACLES = Object.keys(ORACLE_SPECIFIERS);

/**
 * The keys the INSTALLED schema named by `exportName` accepts, read off the
 * schema itself.
 *
 * Resolved through the published subpath {@link ORACLE_SPECIFIERS} names for
 * that oracle — the same entry point the runtime parses with — so this is the
 * schema that actually judges a save, not a local look-alike. Extraction
 * failure throws; see the header.
 */
export async function schemaAcceptSet(exportName, importSpec = (id) => import(id)) {
  const specifier = Object.prototype.hasOwnProperty.call(ORACLE_SPECIFIERS, exportName)
    ? ORACLE_SPECIFIERS[exportName]
    : null;
  if (!specifier) {
    fail(
      `no spec subpath is declared for the oracle \`${exportName}\` — add it to ORACLE_SPECIFIERS.\n` +
        "    Falling back to another subpath would resolve the wrong module (or nothing) and\n" +
        "    pass over every key the real schema refuses."
    );
  }
  let data;
  try {
    data = await importSpec(specifier);
  } catch (err) {
    fail(
      `cannot resolve ${specifier} — run \`pnpm install\` first.\n` +
        "    This gate reads the spec's own schema; it has no hardcoded fallback by design.\n" +
        `    (${err && err.message})`
    );
  }
  const schema = data[exportName];
  if (!schema) {
    fail(
      `${specifier} no longer exports \`${exportName}\` — the accept set cannot be derived.\n` +
        "    Re-point this gate at the schema that judges that payload; do NOT hardcode a key list."
    );
  }
  const keys = shapeKeys(schema);
  if (!keys || keys.length === 0) {
    fail(
      `could not resolve \`${exportName}\`'s shape from ${specifier}.\n` +
        "    The schema's internal representation changed. Fix the walk — falling back to a\n" +
        "    hardcoded key list would make this gate the stale copy it exists to prevent."
    );
  }
  return { schema, accept: new Set(keys), origin: specOrigin() };
}

/** {@link schemaAcceptSet} pinned to the field oracle. */
export async function fieldSchemaAcceptSet(importSpec = (id) => import(id)) {
  return schemaAcceptSet("FieldSchema", importSpec);
}

/** {@link schemaAcceptSet} pinned to the object oracle. */
export async function objectSchemaAcceptSet(importSpec = (id) => import(id)) {
  return schemaAcceptSet("ObjectSchema", importSpec);
}

/**
 * The file the accept set was read from, for the run log. `createRequire` is
 * used ONLY here — `import.meta.resolve` is not available in every Node this
 * repo runs on, and this string never feeds a comparison, only the output.
 */
function specOrigin() {
  try {
    return createRequire(import.meta.url).resolve("@objectstack/spec/package.json").replace(/package\.json$/, "");
  } catch {
    return "(unresolved)";
  }
}

/** Walk a zod schema's wrappers down to the object `shape` it carries. */
function shapeKeys(node, depth = 0, seen = new Set()) {
  if (!node || depth > 8 || seen.has(node)) return null;
  seen.add(node);
  const shapeOf = (v) => (v && typeof v === "object" ? Object.keys(v) : null);
  if (node.shape) return shapeOf(node.shape);
  const def = node._def ?? node.def ?? node._zod?.def;
  if (!def) return null;
  if (def.shape) return shapeOf(def.shape);
  for (const key of ZOD_WRAPPER_KEYS) {
    const found = def[key] ? shapeKeys(def[key], depth + 1, seen) : null;
    if (found) return found;
  }
  return null;
}

/**
 * Property-signature names declared on one interface, plus whether it carries
 * an index signature (the untyped hole recorded in coverage note 2).
 *
 * The interface is searched for anywhere in the file, not only at top level:
 * `ServerFieldSchema` is a module-local, non-exported declaration in a `.tsx`,
 * and a top-level-statements-only walk would silently return nothing for it —
 * which for a parity gate reads as "this shape declares no bad keys".
 */
export function declaredKeys(root, shape) {
  const rel = shape.file;
  if (!existsSync(resolve(root, rel))) {
    fail(
      `${rel} does not exist — the payload shape \`${shape.interface}\` moved or was deleted.\n` +
        "    Re-point this gate at it; a missing input is never a pass."
    );
  }
  const sf = parse(root, rel);
  let decl = null;
  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === shape.interface) decl = node;
    if (!decl) ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!decl) {
    fail(
      `\`interface ${shape.interface}\` not found in ${rel}.\n` +
        "    The payload shape moved or was renamed; re-point this gate at it."
    );
  }
  const keys = decl.members
    .filter(ts.isPropertySignature)
    .map((m) => (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : null))
    .filter((n) => n !== null);
  if (keys.length === 0) {
    fail(`\`${shape.interface}\` in ${rel} declares no properties — extraction failed.`);
  }
  const indexSignature = decl.members.some((m) => ts.isIndexSignatureDeclaration(m));
  return { keys, indexSignature };
}

/** The oracle a shape names, defaulting to the field one for older entries. */
const oracleOf = (shape) => shape.schema ?? "FieldSchema";

/**
 * Compare every declared payload key against the accept set OF THE ORACLE THAT
 * JUDGES ITS SHAPE.
 *
 * Returns
 * `{ accept, accepts, origin, registry, shapes, violations, uiOnly, staleLedger }`.
 * `violations` is what makes the gate red; `uiOnly` and `staleLedger` are
 * reported too — `staleLedger` is red as well (see the header's
 * both-directions ratchet).
 *
 * `registry` is the tombstone registry read from `root`
 * ({@link readRetiredKeyRegistry}). A violation or `uiOnly` entry whose key is
 * a FIELD tombstone carries a `retired` citation, and a violation the registry
 * retires AT THAT SHAPE'S OWN STRIP SITE additionally carries
 * `waiverRefused: true` — the ledger row that would have quieted it is refused
 * and reported as stale. See the header for why the rule is per (key, site) and
 * never over a flattened key set.
 *
 * Reach is resolved WITHIN an oracle, never across one. A key is `uiOnly` when
 * no wire shape *judged by the same schema* declares it: `group` is a legal
 * `FieldSchema` key and a refused `ObjectSchema` key at the same time, so a
 * single pooled wire-key set would have let an object-level key hide behind a
 * field-level shape that legitimately declares the same spelling.
 */
export async function analyze(root = REPO_ROOT, options = {}) {
  const shapes = options.shapes ?? PAYLOAD_SHAPES;
  const ledger = options.ledger ?? KNOWN_UNPARSEABLE_KEYS;
  const needed = [...new Set(shapes.map(oracleOf))];

  /** oracle name -> accept set. `acceptSet` (singular) applies to every oracle. */
  const accepts = new Map();
  let origin = "(injected)";
  for (const name of needed) {
    if (options.acceptSets && options.acceptSets[name]) {
      accepts.set(name, options.acceptSets[name]);
    } else if (options.acceptSet) {
      accepts.set(name, options.acceptSet);
    } else {
      const resolved = await schemaAcceptSet(name, options.importSpec);
      accepts.set(name, resolved.accept);
      origin = resolved.origin;
    }
  }

  const registry = readRetiredKeyRegistry(root);

  // The gate's link to the registry, checked in BOTH directions before a
  // single key is compared — a link that has silently come apart would leave
  // the retirement rule applying to nothing while the run still reads green.
  for (const shape of shapes) {
    if (shape.stripSite && !registry.sites.includes(shape.stripSite)) {
      fail(
        `\`${shape.id}\` names the strip site \`${shape.stripSite}\`, which ${registry.file} does not declare.\n` +
          "    The site was renamed or removed; re-point the shape at the registry's own name. Reading past\n" +
          "    it would silently stop enforcing that site's retirements."
      );
    }
  }
  // Scoped to this gate's OWN declared surface, never to `options.shapes`: it
  // is a statement about which sites this gate has adjudicated, which a fixture
  // tree cannot answer.
  const shapedSites = new Set(PAYLOAD_SHAPES.map((s) => s.stripSite).filter(Boolean));
  const unaccounted = registry.sites.filter(
    (site) => !shapedSites.has(site) && !Object.prototype.hasOwnProperty.call(SITES_WITH_NO_DECLARED_SHAPE, site)
  );
  if (unaccounted.length > 0) {
    fail(
      `${registry.file} declares strip site(s) \`${unaccounted.join("`, `")}\` this gate accounts for nowhere.\n` +
        "    Either a payload shape at that site names it via `stripSite`, or it is recorded in\n" +
        "    SITES_WITH_NO_DECLARED_SHAPE with the reason. Silence would let the registry grow a site\n" +
        "    while this gate went on judging only the old ones."
    );
  }

  /** key -> its FIELD tombstone. The registry is a field-key registry. */
  const tombstones = new Map(registry.tombstones.map((t) => [t.key, t]));

  /**
   * The registry's word on `key` AT `shape`, or null.
   *
   * `inForce` is the per-site half: true only where the shape IS a strip site
   * and the tombstone's column for THAT site is `true`. A flattened "is
   * retired anywhere" test would decide `sortOrder` at `MetadataFieldsPage`
   * and `formula` at the read door in the direction the registry refused.
   */
  const retirementAt = (shape, key) => {
    if (oracleOf(shape) !== "FieldSchema") return null;
    const tombstone = tombstones.get(key);
    if (!tombstone) return null;
    const site = shape.stripSite ?? null;
    return {
      retiredBy: tombstone.retiredBy,
      site,
      inForce: site !== null && tombstone.sites[site] === true,
      strippedAt: registry.sites.filter((s) => tombstone.sites[s] === true),
      notStrippedAt: registry.sites.filter((s) => tombstone.sites[s] !== true),
    };
  };

  const read = shapes.map((shape) => ({ shape, ...declaredKeys(root, shape) }));

  /** oracle name -> every key declared on a wire shape judged by that oracle. */
  const wireKeysByOracle = new Map(
    needed.map((name) => [
      name,
      new Set(read.filter((r) => r.shape.reach === "wire" && oracleOf(r.shape) === name).flatMap((r) => r.keys)),
    ])
  );

  const violations = [];
  const uiOnly = [];
  const ledgered = new Set();

  /** key -> the retirement that refused a ledger row for it, with its oracle. */
  const refusedWaivers = new Map();

  for (const { shape, keys } of read) {
    const oracle = oracleOf(shape);
    const accept = accepts.get(oracle);
    for (const key of keys) {
      if (accept.has(key)) continue;
      const retired = retirementAt(shape, key);
      if (shape.reach === "ui" && !wireKeysByOracle.get(oracle).has(key)) {
        uiOnly.push({ shape: shape.id, file: shape.file, key, oracle, retired });
        continue;
      }
      const entry = Object.prototype.hasOwnProperty.call(ledger, key) ? ledger[key] : null;
      const waivable = Boolean(entry) && (entry.oracle ?? "FieldSchema") === oracle;
      // A retirement IN FORCE at this shape's own strip site is not waivable —
      // its resolution already happened, on the card the tombstone names, and a
      // fresh ledger row would re-open it in silence.
      if (waivable && !(retired && retired.inForce)) {
        ledgered.add(`${key}\u0000${oracle}`);
        continue;
      }
      if (waivable) refusedWaivers.set(key, { oracle, retired });
      violations.push({
        shape: shape.id,
        file: shape.file,
        writer: shape.writer,
        key,
        oracle,
        retired,
        waiverRefused: waivable,
      });
    }
  }

  // Both-directions ratchet: an entry that no longer applies must not survive.
  const ledgerOracle = (key) => ledger[key].oracle ?? "FieldSchema";
  /** key -> the oracles whose shapes still declare it. */
  const declaredUnder = new Map();
  for (const r of read) {
    for (const key of r.keys) {
      if (!declaredUnder.has(key)) declaredUnder.set(key, new Set());
      declaredUnder.get(key).add(oracleOf(r.shape));
    }
  }

  const acceptedBy = (key) =>
    [...new Set(read.filter((r) => r.keys.includes(key)).map((r) => oracleOf(r.shape)))].filter((name) =>
      accepts.get(name).has(key)
    );
  const staleLedger = Object.keys(ledger)
    .filter((key) => !ledgered.has(`${key}\u0000${ledgerOracle(key)}`))
    .map((key) => {
      // The registry's answer comes first and is the most specific: this row
      // was not honoured because the key is RETIRED at the site that declares
      // it. Reporting it as merely "unreachable" would send the reader looking
      // for a shape that is right there.
      const refused = refusedWaivers.get(key);
      if (refused && refused.oracle === ledgerOracle(key)) {
        return {
          key,
          reason:
            `the registry retires it (${refused.retired.retiredBy}) and \`${refused.retired.site}\` strips it — ` +
            "a retirement cannot be waived by a ledger row",
        };
      }
      // Scoped to the entry's own oracle: a key still declared somewhere, but
      // no longer on any shape THIS entry could apply to, is exactly as stale
      // as one nothing declares at all.
      if (!declaredUnder.get(key)?.has(ledgerOracle(key))) {
        return { key, reason: "no payload shape declares it any more" };
      }
      const accepting = acceptedBy(key);
      // Every shape that still declares it is judged by a schema that now
      // accepts it — the objectui#4676 shape, where the producer moved upstream.
      const stillRefused = read.some(
        (r) =>
          r.keys.includes(key) &&
          oracleOf(r.shape) === ledgerOracle(key) &&
          !accepts.get(oracleOf(r.shape)).has(key)
      );
      if (accepting.length > 0 && !stillRefused) {
        return { key, reason: `\`${accepting.join("` / `")}\` now accepts it` };
      }
      return { key, reason: "it is no longer reachable from a wire-bound shape" };
    });

  // `accept` is kept as the field oracle's set for callers that predate the
  // second oracle; `accepts` is the full map.
  return {
    accept: accepts.get("FieldSchema") ?? accepts.get(needed[0]),
    accepts,
    origin,
    registry,
    shapes: read,
    violations,
    uiOnly,
    staleLedger,
  };
}

async function main() {
  let result;
  try {
    result = await analyze();
  } catch (err) {
    if (err instanceof ExtractionError) {
      console.error("designer-field-key-parity: EXTRACTION FAILED\n");
      console.error(`    ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const { accepts, origin, registry, shapes, violations, uiOnly, staleLedger } = result;
  for (const [name, accept] of accepts) {
    console.log(`designer-field-key-parity: ${name} accepts ${accept.size} keys`);
  }
  console.log(`  oracle: ${origin}`);
  for (const { shape, keys, indexSignature } of shapes) {
    console.log(
      `  ${shape.id.padEnd(24)} ${String(keys.length).padStart(2)} declared  [${shape.reach}] vs ${(shape.schema ?? "FieldSchema").padEnd(22)}` +
        (indexSignature ? "  (+ index signature — see coverage note 2)" : "")
    );
  }
  // The registry, and the per-site map this gate judges it through. Printed
  // every run so a silently empty extraction cannot read as "nothing is
  // retired" in a green log.
  console.log(
    `\n  Retired-key registry: ${registry.file} — ${registry.tombstones.length} tombstones over ${registry.sites.length} sites`
  );
  for (const site of registry.sites) {
    const shape = PAYLOAD_SHAPES.find((s) => s.stripSite === site);
    console.log(
      `    ${site.padEnd(28)} ${shape ? `-> ${shape.id} (${shape.file})` : `-- ${SITES_WITH_NO_DECLARED_SHAPE[site]}`}`
    );
  }

  if (uiOnly.length) {
    console.log("\n  UI-only keys (declared on no wire-bound shape of the same oracle, so out of reach of a PUT):");
    for (const u of uiOnly) {
      console.log(
        `    ${u.key.padEnd(16)} (${u.shape}, vs ${u.oracle})` +
          (u.retired ? `  [retired ${u.retired.retiredBy}]` : "")
      );
    }
  }
  const ledgerKeys = Object.keys(KNOWN_UNPARSEABLE_KEYS);
  if (ledgerKeys.length) {
    console.log("\n  Ledgered — refused, filed, resolution owned by its card:");
    for (const key of ledgerKeys) {
      const e = KNOWN_UNPARSEABLE_KEYS[key];
      console.log(
        `    ${key.padEnd(14)} ${e.card}  [${e.oracle ?? "FieldSchema"}]` +
          (e.spec ? `  (spec spells it \`${e.spec}\`)` : "  (no spec equivalent)")
      );
    }
  }

  if (staleLedger.length) {
    console.error("\ndesigner-field-key-parity: STALE LEDGER ENTRIES\n");
    for (const s of staleLedger) {
      console.error(`    ${s.key} — ${s.reason}`);
    }
    console.error(
      "\n    Remove the entry. A ledger entry that no longer applies silently re-admits\n" +
        "    that spelling the next time someone declares it.\n"
    );
  }

  if (violations.length) {
    console.error("\ndesigner-field-key-parity: KEYS THE SPEC REFUSES BY NAME\n");
    // Grouped by KEY, not by site: one key declared on three shapes is one
    // decision to make, and reading it three times obscures that.
    const byKey = new Map();
    for (const v of violations) {
      if (!byKey.has(v.key)) byKey.set(v.key, []);
      byKey.get(v.key).push(v);
    }
    for (const [key, sites] of byKey) {
      console.error(`    ${key}`);
      for (const v of sites) {
        console.error(`        declared on ${v.shape} (${v.file})`);
        console.error(`        written by  ${v.writer}`);
        console.error(`        refused by  ${v.oracle}`);
        if (!v.retired) continue;
        // The registry's own words, per site — never flattened to "retired".
        console.error(`        RETIRED by  ${v.retired.retiredBy} (${registry.file})`);
        console.error(`          stripped at      ${v.retired.strippedAt.join(", ") || "(no site)"}`);
        console.error(`          NOT stripped at  ${v.retired.notStrippedAt.join(", ") || "(none)"}`);
        if (v.retired.inForce) {
          console.error(
            `          this shape IS the \`${v.retired.site}\` strip site, which strips this key:\n` +
              "          the retirement is in force here and a KNOWN_UNPARSEABLE_KEYS row cannot waive it." +
              (v.waiverRefused ? " The row present for it is reported as stale above." : "")
          );
        }
      }
    }
    console.error(
      "\n    Each of these makes `PUT /api/v1/meta/object/:name` return 422 INVALID_METADATA,\n" +
        "    which blocks EVERY subsequent save of the object until the key is cleared.\n" +
        "    The three prior instances took three different correct resolutions (retire the\n" +
        "    control, delete the declaration, move the producer upstream) — so file a card and\n" +
        "    record it in KNOWN_UNPARSEABLE_KEYS rather than picking one here.\n" +
        "\n    EXCEPT where a key is printed as RETIRED and in force above: that adjudication is\n" +
        "    already made, on the card the tombstone names. The resolution there is to remove the\n" +
        "    declaration (or to overturn the tombstone in the registry, with a ruling) — never to\n" +
        "    add a ledger row, which would re-open a settled retirement in silence.\n"
    );
  }

  if (violations.length || staleLedger.length) process.exit(1);
  console.log("\ndesigner-field-key-parity: OK");
}

if (isEntrypoint(import.meta.url)) {
  await main();
}
