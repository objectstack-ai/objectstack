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
 *  - which schema judges each  → `getMetadataTypeSchema`, the canonical
 *    type→Zod registry;
 *  - whether linting is even meaningful → read off the schema itself (below).
 *
 * A third hand-written list of "types the lint covers" would have been the
 * #3786 shape all over again, inside the tool built to end it.
 *
 * ## Why it lives in `kernel/` and not beside its core in `data/`
 *
 * Covering every type means importing every schema. The comparator and guidance
 * tables stay in `data/authoring-key-lint.ts` (light, frontend-safe — the
 * `/data` subpath is consumed by browser bundles); this walker sits beside
 * `metadata-type-schemas.ts`, which already imports the world.
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
  type UnknownAuthoringKeyFinding,
} from '../data/authoring-key-lint';
import { FieldSchema } from '../data/field.zod';
import { PLURAL_TO_SINGULAR } from '../shared/metadata-collection.zod';
import { getMetadataTypeSchema } from './metadata-type-schemas';

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
    case 'pipe':
      return unwrap(d.in, depth + 1);
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
 */
export function listLintableAuthoringCollections(): LintableAuthoringCollection[] {
  const out: LintableAuthoringCollection[] = [];
  for (const [collection, type] of Object.entries(PLURAL_TO_SINGULAR)) {
    const schema = getMetadataTypeSchema(type);
    if (!schema) continue;
    const posture = keyPosture(schema);
    if (posture && posture.mode === 'strip' && posture.keys.size > 0) {
      out.push({ collection, type });
    }
  }
  return out;
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
 */
export function lintUnknownAuthoringKeys(rawStack: unknown): UnknownAuthoringKeyFinding[] {
  if (!isPlainRecord(rawStack)) return [];
  const out: UnknownAuthoringKeyFinding[] = [];

  for (const [collection, type] of Object.entries(PLURAL_TO_SINGULAR)) {
    const items = rawStack[collection];
    if (!Array.isArray(items) || items.length === 0) continue;
    const schema = getMetadataTypeSchema(type);
    if (!schema) continue;
    const posture = keyPosture(schema);
    if (!posture || posture.mode !== 'strip' || posture.keys.size === 0) continue;

    const guidance = GUIDANCE_BY_SURFACE[type] ?? EMPTY_GUIDANCE;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!isPlainRecord(item)) continue;
      const name = typeof item.name === 'string' && item.name ? item.name : String(i);
      const basePath = `${collection}.${name}`;
      lintAuthoredRecordKeys(item, posture.keys, guidance, type, basePath, out);

      // The one nested surface: an object's `fields` record, judged by
      // FieldSchema — where #4120 found the worst of the drift.
      if (type === 'object' && isPlainRecord(item.fields)) {
        const fieldPosture = keyPosture(FieldSchema);
        if (fieldPosture && fieldPosture.mode === 'strip' && fieldPosture.keys.size > 0) {
          for (const [fieldName, field] of Object.entries(item.fields)) {
            if (!isPlainRecord(field)) continue;
            lintAuthoredRecordKeys(
              field,
              fieldPosture.keys,
              FIELD_KEY_GUIDANCE,
              'field',
              `${basePath}.fields.${fieldName}`,
              out,
            );
          }
        }
      }
    }
  }
  return out;
}
