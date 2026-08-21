// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **Every metadata collection, not just objects** (#3786 follow-up to #4148).
 *
 * #4148 introduced the unknown-authoring-key lint for `object` and `field` — the
 * two surfaces #4120 caught real drift on. But those two were a sample, not the
 * population: of the 25 authorable metadata types, only four are `.strict()`
 * (`flow` / `permission` / `position` / `tool`, the #4001 Tier-A set). The other
 * eighteen strip an undeclared key exactly the way `field` did — an author who
 * misspells a key on a `page`, an `agent` or a `dashboard` gets the same
 * parse-clean-value-gone silence, with no lint watching.
 *
 * This walker closes that gap by DERIVING its coverage instead of listing it:
 *
 *  - which collections exist  → `PLURAL_TO_SINGULAR`, the same boundary map
 *    `normalizeStackInput` uses — so the lint sees exactly the collections the
 *    normalizer recognises, and a new collection registered there is covered
 *    the moment it exists;
 *  - which schema judges each  → the **stack schema's own slot** for that
 *    collection, injected by the caller (see below);
 *  - whether linting is even meaningful → read off that schema (below).
 *
 * A third hand-written list of "types the lint covers" would have been the
 * #3786 shape all over again, inside the tool built to end it.
 *
 * ## Which schema the posture is read from (#10039)
 *
 * The judging schema used to be `getMetadataTypeSchema(type)` — the canonical
 * type→Zod registry. That registry answers a different question than the one
 * this lint asks. It names the schema for a **persisted metadata body** of that
 * type; the schema `defineStack` applies to a **stack collection entry** is the
 * one in `ObjectStackDefinitionSchema`'s own shape, and for `view` the two are
 * not the same object at all:
 *
 *   - `getMetadataTypeSchema('view')` → `ViewMetadataSchema`, a strip-mode
 *     UNION over the three persisted runtime shapes (#3095);
 *   - `ObjectStackDefinitionSchema.shape.views` → `z.array(ViewSchema)`, and
 *     `ViewSchema` is the `.strict()` defineView CONTAINER.
 *
 * Reading posture off the registry therefore judged `views` lintable — "this
 * key is dropped at load" — while the parse one step later REFUSED the same key
 * loudly. That is precisely the second-disagreeing-voice failure the posture
 * rule exists to prevent, and which {@link lintUnknownStackKeys} already avoids
 * at the top level. Measured across all 29 collections, the registry and the
 * stack slot agree everywhere except `views` (`strip`/91 keys vs `strict`/15),
 * `themes` and `analyticsCubes` (unregistered in the type registry, `strict` in
 * the stack schema — skipped either way), so correcting the source removes
 * `views` from the lintable set and changes nothing else.
 *
 * The stack schema is **injected**, for the same reason and by the same route
 * as {@link lintUnknownStackKeys}: `stack.zod.ts` imports this module, so
 * importing `ObjectStackDefinitionSchema` back would close a cycle. It is a
 * REQUIRED parameter rather than an optional one — a caller that omits it
 * cannot be silently served the registry posture, because that fallback is the
 * bug itself.
 *
 * ## Why it lives in `kernel/` and not beside its core in `data/`
 *
 * The comparator and guidance tables stay in `data/authoring-key-lint.ts`
 * (light, frontend-safe — the `/data` subpath is consumed by browser bundles);
 * this walker sits beside `metadata-type-schemas.ts`, the module whose registry
 * it used to read. It no longer imports any schema of its own.
 *
 * ## What "lintable" means, per schema
 *
 * Read from the schema's own unknown-key posture, so the lint can never
 * disagree with the parse:
 *
 *  - **strip** (no catchall — zod's default) → LINT. The parse will silently
 *    drop unknown keys; this is the silence being reported.
 *  - **strict** (catchall `never`) → SKIP. The parse itself rejects loudly,
 *    with the schema's own tombstone guidance — a lint warning on top would be
 *    a second, possibly disagreeing voice.
 *  - **passthrough** (catchall `any`/`unknown`) → SKIP. Unknown keys survive
 *    the parse; nothing is dropped, so there is nothing to report.
 *  - **unions** → the union of the members' declared keys (an author may
 *    legally write any member's key); lintable only if at least one member
 *    strips and none passes unknowns through.
 */

import {
  lintAuthoredRecordKeys,
  isPlainRecord,
  FIELD_KEY_GUIDANCE,
  OBJECT_KEY_GUIDANCE,
  STACK_KEY_GUIDANCE,
  STACK_RUNTIME_MEMBERS,
  type UnknownAuthoringKeyFinding,
} from '../data/authoring-key-lint';
import { PLURAL_TO_SINGULAR } from '../shared/metadata-collection.zod';

const EMPTY_GUIDANCE: Readonly<Record<string, { to?: string; why?: string }>> = Object.freeze({});

/**
 * Curated guidance, per surface. Only `object` and `field` carry curated
 * tables today — every entry in them was found in the wild (#4120). Other
 * surfaces fall back to the edit-distance suggestion; grow a table here the
 * day a real drift is found on one, not before.
 */
const GUIDANCE_BY_SURFACE: Readonly<
  Record<string, Readonly<Record<string, { to?: string; why?: string }>>>
> = Object.freeze({
  object: OBJECT_KEY_GUIDANCE,
  field: FIELD_KEY_GUIDANCE,
});

/** How a schema treats a key it does not declare. */
type UnknownKeyMode = 'strip' | 'strict' | 'passthrough';

interface KeyPosture {
  /** Every key an author may legally write (union members contribute all). */
  keys: ReadonlySet<string>;
  mode: UnknownKeyMode;
}

/** Peel wrapper nodes until an object or union node is reached. */
function unwrap(schema: unknown, depth = 0): any {
  const s = schema as any;
  if (!s || depth > 25) return s;
  const d = s.def ?? s._def;
  if (!d) return s;
  switch (d.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'catch':
    case 'nonoptional':
      return unwrap(d.innerType, depth + 1);
    case 'lazy':
      return unwrap(d.getter(), depth + 1);
    case 'pipe': {
      // Two pipes, opposite authorable sides — the #4488 finding, applied here
      // at #5074. `a.transform(fn)` authors against the IN side (a is the
      // accepted input shape); `z.preprocess(fn, schema)` also compiles to a
      // pipe, but its IN side is the TRANSFORM and the authorable surface is
      // the OUT schema. Taking `def.in` unconditionally makes this walker
      // return the transform, report "not key-bearing", and go SILENT on the
      // type — the failure mode #4488 measured on `translation` and #5074
      // would have reproduced on `view` the moment `ViewMetadataSchema` gained
      // its console-decoration preprocess. A gate that stops covering a type is
      // worse than one that fails.
      const inner = unwrap(d.in, depth + 1);
      const innerType = (inner?.def ?? inner?._def)?.type;
      return innerType === 'transform' ? unwrap(d.out, depth + 1) : inner;
    }
    default:
      return s;
  }
}

/** The key set + unknown-key mode of a schema, or `null` if not key-bearing. */
function keyPosture(schema: unknown, depth = 0): KeyPosture | null {
  if (depth > 6) return null;
  const u = unwrap(schema);
  const d = u?.def ?? u?._def;

  if (d?.type === 'object') {
    const keys = new Set(Object.keys(d.shape ?? u.shape ?? {}));
    const catchall = d.catchall;
    if (!catchall) return { keys, mode: 'strip' };
    const catchallType = (catchall.def ?? catchall._def)?.type;
    return { keys, mode: catchallType === 'never' ? 'strict' : 'passthrough' };
  }

  if (d?.type === 'union' || d?.type === 'discriminated_union') {
    const members = (d.options ?? [])
      .map((o: unknown) => keyPosture(o, depth + 1))
      .filter((p: KeyPosture | null): p is KeyPosture => p !== null);
    if (members.length === 0) return null;
    const keys = new Set<string>(members.flatMap((m: KeyPosture) => [...m.keys]));
    // A passthrough member means an unknown key may legally SURVIVE the parse
    // (we cannot know pre-parse which member will match), so reporting it as
    // dropped would be a lie. One is enough to disqualify the whole union.
    if (members.some((m: KeyPosture) => m.mode === 'passthrough')) return { keys, mode: 'passthrough' };
    // With only strict members the parse is loud on its own.
    if (members.every((m: KeyPosture) => m.mode === 'strict')) return { keys, mode: 'strict' };
    return { keys, mode: 'strip' };
  }

  return null;
}

/**
 * The schema the parse applies to ONE ENTRY of `collection`, read off the stack
 * schema's own shape — see the `#10039` section of the module docblock for why
 * this and not `getMetadataTypeSchema(type)`.
 *
 * `undefined` when the stack schema declares no such collection (then there is
 * no parse for the walk to agree with, and an undeclared top-level key is
 * {@link lintUnknownStackKeys}'s subject, not this walker's) or declares it as
 * something with no per-entry schema to read.
 */
function collectionEntrySchema(stackSchema: unknown, collection: string): unknown {
  const u = unwrap(stackSchema);
  const d = u?.def ?? u?._def;
  if (d?.type !== 'object') return undefined;
  const shape = (typeof d.shape === 'function' ? d.shape() : d.shape) ?? {};
  const slot = shape[collection];
  if (!slot) return undefined;
  const su = unwrap(slot);
  const sd = su?.def ?? su?._def;
  // `views: z.array(ViewSchema).optional()` → the ELEMENT is what one entry is
  // judged by. `valueType` covers a record-shaped collection (none today, but
  // `normalizeStackInput` accepts map form, so the shape is not hypothetical).
  return sd?.element ?? sd?.valueType ?? undefined;
}

/** One collection the walker will lint, and why it qualifies. */
export interface LintableAuthoringCollection {
  /** Stack collection key, e.g. `'pages'`. */
  collection: string;
  /** Singular metadata type it holds, e.g. `'page'`. */
  type: string;
}

/**
 * The collections the walker covers, computed from the same sources it lints
 * with. Exported so the coverage TEST can assert the derivation has not quietly
 * shrunk — and so tooling can report what the evidence base actually spans.
 *
 * @param stackSchema `ObjectStackDefinitionSchema`, injected — see the module
 *   docblock. Required: the answer is a property of the parse, so there is no
 *   honest result without it.
 */
export function listLintableAuthoringCollections(
  stackSchema: unknown,
): LintableAuthoringCollection[] {
  const out: LintableAuthoringCollection[] = [];
  for (const [collection, type] of Object.entries(PLURAL_TO_SINGULAR)) {
    const schema = collectionEntrySchema(stackSchema, collection);
    if (!schema) continue;
    const posture = keyPosture(schema);
    if (posture && posture.mode === 'strip' && posture.keys.size > 0) {
      out.push({ collection, type });
    }
  }
  return out;
}

/**
 * How deep below a metadata item the walk goes. The descent is bounded by the
 * AUTHORED data, not by the schema, so this only matters for pathologically
 * nested input; 12 clears the deepest real shape (a page's nested region tree).
 */
const MAX_DESCENT_DEPTH = 12;

/**
 * Nested surfaces that report under their own name instead of the enclosing
 * metadata type, keyed by `<type>:<path relative to the item root>`.
 *
 * Only `object.fields` qualifies today. It is the surface #4120 mined for the
 * curated guidance table, and a finding on it has always said `field` rather
 * than `object` — callers and tests depend on that. Everything else nested
 * reports under its metadata type, which is the axis authors think in ("this is
 * a page problem"), and falls back to the edit-distance suggestion.
 */
const NESTED_SURFACES: Readonly<
  Record<string, { surface: string; guidance: Readonly<Record<string, { to?: string; why?: string }>> }>
> = Object.freeze({
  'object:fields': { surface: 'field', guidance: FIELD_KEY_GUIDANCE },
});

/**
 * Walk the authored value alongside its schema, reporting unknown keys at every
 * strip-mode object below the item root (#4001 evidence phase).
 *
 * Before this, the walk stopped at each metadata item's top level plus one
 * hard-coded descent into `object.fields`. That left 227 strip-mode objects
 * nested below those roots — `page.regions[].components[]`, `dashboard.widgets[]`,
 * `view.config.data`, `action.params[].options[]` — silently eating keys AND
 * contributing nothing to the evidence base the v18 strict close-out is meant to
 * be scheduled on. The two most-authored types were the worst off: `object` has
 * 71 such sites, `view` 49.
 *
 * Posture rules match {@link keyPosture}, so the lint never double-reports what
 * the parse already rejects:
 *   - `strict`      → silent, the parse is loud on its own.
 *   - `passthrough` → silent, the key legally survives.
 *   - `strip`       → reported, and the descent continues through it.
 *
 * Unions descend only when the authored value picks a branch unambiguously (a
 * discriminated union whose discriminator the author actually wrote). Otherwise
 * the merged posture from {@link keyPosture} is applied at this level and the
 * walk stops: guessing a branch would invent findings against a shape the author
 * never chose.
 *
 * **Every record is reported exactly once, here** (#10039). A union arm that
 * resolves a branch hands the SAME record on with `depth + 1`, so the report is
 * made by whichever arm finally resolves it — the picked branch's own key set
 * where there is one, the merged set where there is not. Nothing outside this
 * function reports; {@link lintUnknownKeysAgainstSchema} used to report the root
 * as well, which double-emitted every finding on a union root.
 */
function descend(
  schema: unknown,
  raw: unknown,
  path: string,
  relPath: string,
  surface: string,
  guidance: Readonly<Record<string, { to?: string; why?: string }>>,
  out: UnknownAuthoringKeyFinding[],
  depth: number,
): void {
  if (depth > MAX_DESCENT_DEPTH || raw == null) return;
  const u = unwrap(schema);
  const d = u?.def ?? u?._def;
  if (!d) return;

  if (d.type === 'union' || d.type === 'discriminated_union') {
    const branch = d.discriminator && isPlainRecord(raw)
      ? pickUnionBranch(d, raw[d.discriminator])
      : undefined;
    if (branch) {
      descend(branch, raw, path, relPath, surface, guidance, out, depth + 1);
      return;
    }
    const merged = keyPosture(u);
    if (merged?.mode === 'strip' && merged.keys.size > 0 && isPlainRecord(raw)) {
      lintAuthoredRecordKeys(raw, merged.keys, guidance, surface, path, out);
    }
    return;
  }

  if (d.type === 'object') {
    if (!isPlainRecord(raw)) return;
    const shape = (typeof d.shape === 'function' ? d.shape() : d.shape) ?? {};
    // The item root included: this walk owns every report, at every level
    // (#10039). It used to skip `depth === 0` because the caller reported the
    // root as well — but only the OBJECT arm skipped it. A union root fell
    // through to the arm above, which has no such guard, so the caller's report
    // and the union's merged report were both emitted for one authored key.
    {
      const posture = keyPosture(u);
      if (posture?.mode === 'strip' && posture.keys.size > 0) {
        lintAuthoredRecordKeys(raw, posture.keys, guidance, surface, path, out);
      }
    }
    for (const [key, child] of Object.entries(shape)) {
      if (!(key in raw)) continue;
      const childRel = relPath ? `${relPath}.${key}` : key;
      const override = NESTED_SURFACES[`${surface}:${childRel}`];
      descend(
        child,
        raw[key],
        `${path}.${key}`,
        childRel,
        override?.surface ?? surface,
        override?.guidance ?? guidance,
        out,
        depth + 1,
      );
    }
    return;
  }

  if (d.element) {
    if (!Array.isArray(raw)) return;
    for (let i = 0; i < raw.length; i++) {
      descend(d.element, raw[i], `${path}.${i}`, relPath, surface, guidance, out, depth + 1);
    }
    return;
  }

  if (d.valueType) {
    if (!isPlainRecord(raw)) return;
    for (const [key, value] of Object.entries(raw)) {
      // A record's KEYS are author-chosen names, so they never join relPath —
      // `object.fields` must stay `fields`, not `fields.owner`, or the override
      // above would miss every field but one.
      descend(d.valueType, value, `${path}.${key}`, relPath, surface, guidance, out, depth + 1);
    }
  }
}

/** The union member whose discriminator literal matches `value`, if exactly one does. */
function pickUnionBranch(unionDef: any, value: unknown): unknown {
  if (value === undefined) return undefined;
  for (const option of unionDef.options ?? []) {
    const od = unwrap(option);
    const shape = (() => {
      const dd = od?.def ?? od?._def;
      return typeof dd?.shape === 'function' ? dd.shape() : dd?.shape;
    })();
    const discDef = (() => {
      const s = unwrap(shape?.[unionDef.discriminator]);
      return s?.def ?? s?._def;
    })();
    const literals = discDef?.values ?? (discDef?.value !== undefined ? [discDef.value] : []);
    if (literals && [...literals].includes(value as never)) return option;
  }
  return undefined;
}

/**
 * Report every key an authored stack sets — on any item of any metadata
 * collection — that the item's schema does not declare: every value the parse
 * is about to discard silently.
 *
 * Pure and side-effect free. Runs on the **raw** (normalized but unparsed)
 * stack; after the parse the unknown keys no longer exist to report.
 *
 * @param rawStack The authored stack, after `normalizeStackInput` and before
 *   `ObjectStackDefinitionSchema.parse`.
 * @param stackSchema `ObjectStackDefinitionSchema`, injected — see the module
 *   docblock. Every collection's posture is read from this schema's own slot,
 *   because that is the parse the warning has to agree with.
 */
export function lintUnknownAuthoringKeys(
  rawStack: unknown,
  stackSchema: unknown,
): UnknownAuthoringKeyFinding[] {
  if (!isPlainRecord(rawStack)) return [];
  const out: UnknownAuthoringKeyFinding[] = [];

  for (const [collection, type] of Object.entries(PLURAL_TO_SINGULAR)) {
    const items = rawStack[collection];
    if (!Array.isArray(items) || items.length === 0) continue;
    const schema = collectionEntrySchema(stackSchema, collection);
    if (!schema) continue;
    const posture = keyPosture(schema);
    // NOT gated on the ROOT being `strip`. A strict root reports nothing at its
    // own level — the parse rejects unknown keys there, so warning as well
    // would double-report — but the shapes BELOW it are a separate question,
    // and most are still strip. Gating the whole collection on the root's
    // posture meant that closing a root silently switched off the warnings for
    // everything under it: when `object` went strict on the parse path, its 71
    // nested strip-mode sites stopped reporting in the same change, with
    // nothing anywhere to say so. Posture is a per-node property; this loop
    // now treats it as one.
    if (!posture || posture.keys.size === 0) continue;

    const guidance = GUIDANCE_BY_SURFACE[type] ?? EMPTY_GUIDANCE;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!isPlainRecord(item)) continue;
      const name = typeof item.name === 'string' && item.name ? item.name : String(i);
      out.push(...lintUnknownKeysAgainstSchema(schema, item, type, `${collection}.${name}`, guidance));
    }
  }
  return out;
}

/**
 * Report every key an authored VALUE sets — at its own level and at every
 * strip-mode object below it — that `schema` does not declare.
 *
 * This is the body {@link lintUnknownAuthoringKeys} runs per metadata item,
 * lifted so a caller holding its own (schema, value) pair can run the same walk
 * without re-deriving the posture rules. The rules are subtle enough to be worth
 * having exactly once: which wrapper nodes to peel (#4488/#5074's two opposite
 * pipes), when a union may be descended, and the strip/strict/passthrough split
 * that keeps this lint from becoming a second voice over a parse that already
 * rejects loudly.
 *
 * The caller that needs it (#5068) is `@objectstack/lint`'s component-props
 * gate: `PageComponent.properties` is `z.record(z.string(), z.unknown())`, so
 * the walk above stops dead at the carrier and everything under it is
 * unjudged — the props schema that DOES declare those keys
 * (`ComponentPropsMap[type]`) is reachable only by dispatching on the sibling
 * `type`, which no schema can express. The gate dispatches, then calls this.
 *
 * Pure and side-effect free. Runs on the authored (unparsed) value; after the
 * parse the unknown keys no longer exist to report.
 *
 * @param schema The Zod schema that declares `value`'s shape.
 * @param value The authored value.
 * @param surface The name a finding reports under (a metadata type, or any
 *   caller-chosen surface id such as a page-component type).
 * @param basePath Dotted path of `value` itself; every finding's `path` extends it.
 * @param guidance Optional curated rename/retirement table for this surface.
 */
export function lintUnknownKeysAgainstSchema(
  schema: unknown,
  value: unknown,
  surface: string,
  basePath: string,
  guidance: Readonly<Record<string, { to?: string; why?: string }>> = EMPTY_GUIDANCE,
): UnknownAuthoringKeyFinding[] {
  const out: UnknownAuthoringKeyFinding[] = [];
  if (!isPlainRecord(value)) return out;
  // Key-bearing check only. The REPORT for this record — root included — is
  // {@link descend}'s, so that every record is reported by exactly one place
  // (#10039); reporting here as well is what emitted a union root's finding
  // twice, invisibly through `defineStack` (its warn-once set absorbed the
  // second) and fully visible to every other caller of this function.
  const posture = keyPosture(schema);
  if (!posture || posture.keys.size === 0) return out;
  descend(schema, value, basePath, '', surface, guidance, out, 0);
  return out;
}

/**
 * Report every TOP-LEVEL key an authored stack sets that
 * `ObjectStackDefinitionSchema` does not declare (#4167).
 *
 * The walker above covers every metadata COLLECTION; this covers the envelope
 * those collections sit in. Same silence, one level up — and the level where it
 * is hardest to notice, because an undeclared top-level key reads as
 * configuration that took effect rather than as a typo. `storage` is the worked
 * example: `os serve` honoured it only on the one boot path that skips
 * `defineStack`, so a stack asking for S3 could silently get local disk.
 *
 * Separate from {@link lintUnknownAuthoringKeys} rather than folded into it
 * because the stack schema has to be INJECTED: `stack.zod.ts` imports this
 * module, so importing `ObjectStackDefinitionSchema` back would close a cycle.
 * A separate export keeps that requirement visible — a call site either asks
 * for this coverage or does not, and its absence shows up in a diff. An
 * optional parameter on the walker would be the same silent-loss shape this
 * whole rule family exists to report.
 *
 * @param rawStack The authored stack, after `normalizeStackInput` and before
 *   `ObjectStackDefinitionSchema.parse`.
 * @param stackSchema `ObjectStackDefinitionSchema`, injected — see above.
 */
export function lintUnknownStackKeys(
  rawStack: unknown,
  stackSchema: unknown,
): UnknownAuthoringKeyFinding[] {
  if (!isPlainRecord(rawStack)) return [];

  // Same posture rule the walker applies per collection: only a schema that
  // STRIPS unknown keys has a silence worth reporting. If the stack schema is
  // ever made strict, the parse rejects loudly on its own and this must go
  // quiet rather than become a second, possibly disagreeing voice.
  const posture = keyPosture(stackSchema);
  if (!posture || posture.mode !== 'strip' || posture.keys.size === 0) return [];

  // The runtime members are honoured OFF the authored bundle, so the parse
  // dropping them costs nothing — treating them as declared is what keeps the
  // lint from calling a working `onEnable` discarded. See STACK_RUNTIME_MEMBERS.
  const declared = new Set([...posture.keys, ...STACK_RUNTIME_MEMBERS]);

  const out: UnknownAuthoringKeyFinding[] = [];
  lintAuthoredRecordKeys(rawStack, declared, STACK_KEY_GUIDANCE, 'stack', 'stack', out);
  return out;
}
