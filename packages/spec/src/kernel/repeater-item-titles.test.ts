// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #17232 — THE class guard for "a repeater's property-panel table shows the
// maker raw machine keys".
//
// Studio renders a `type: 'repeater'` form field as a table whose column
// headers read `items.properties[k].title ?? k` off the JSON Schema served by
// `GET /meta/types`. That schema is derived by
// `packages/metadata-protocol/src/protocol.ts` → `toJsonSchemaSafe`, i.e.
// `z.toJSONSchema(getMetadataTypeSchema(type), { unrepresentable: 'any' })`,
// and the bundle overlay (`resolveMetadataFormSchemaTitles`, #16458/#17227)
// only ever REPLACES a `title` that is already there. So an item schema with
// no `.meta({ title })` falls through to the raw key in EVERY locale, English
// included — a missing authoring label in the contract, not a translation gap.
//
// #16458 (PR #17227) titled exactly one repeater, `dashboard.header.actions`.
// The class was left silent: the 22nd repeater added next month reproduces the
// defect with every gate green. THIS FILE IS THE LOUDNESS. It enumerates every
// repeater declared across every `*.form.ts` in this package, derives each
// one's row schema through the platform's own predicate, and requires every
// row property to carry a title — with a shrink-only ledger of the carriers
// that are still owed one.
//
// The ledger is EXACT in both directions, which is what makes it a ratchet
// rather than a suppression list:
//
//   • a repeater that is NOT in the ledger MUST be fully titled — so a new
//     repeater is red on the day it lands, not a month later;
//   • a repeater that IS in the ledger MUST still be untitled — so titling one
//     and forgetting to delete its entry is also red, and the ledger can only
//     shrink.
//
// ⛔ Never add an entry to LEDGER to make this file green. An entry is a debt
// record for a carrier that predates this pin (and, for the four below, one
// held open by another PR's fence at the time it was written). A NEW untitled
// repeater is the defect this file exists to catch.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { getMetadataTypeSchema } from './metadata-type-schemas';

import { skillForm } from '../ai/skill.form';
import { agentForm } from '../ai/agent.form';
import { toolForm } from '../ai/tool.form';
import { flowForm } from '../automation/flow.form';
import { objectForm } from '../data/object.form';
import { fieldForm } from '../data/field.form';
import { hookForm } from '../data/hook.form';
import { positionForm } from '../identity/position.form';
import { actionForm } from '../ui/action.form';
import { appForm } from '../ui/app.form';
import { dashboardForm } from '../ui/dashboard.form';
import { datasetForm } from '../ui/dataset.form';
import { pageForm } from '../ui/page.form';
import { reportForm } from '../ui/report.form';
import { viewForm } from '../ui/view.form';

/**
 * Every `*.form.ts` in this package, by its export name. `check:generated`
 * does not police this list, so `it('covers every *.form.ts', …)` below reads
 * the directory listing this file cannot — it asserts the COUNT against the
 * form exports the domain barrels carry, which is what a new form file moves.
 */
const FORMS: ReadonlyArray<readonly [string, unknown]> = [
  ['actionForm', actionForm],
  ['agentForm', agentForm],
  ['appForm', appForm],
  ['dashboardForm', dashboardForm],
  ['datasetForm', datasetForm],
  ['fieldForm', fieldForm],
  ['flowForm', flowForm],
  ['hookForm', hookForm],
  ['objectForm', objectForm],
  ['pageForm', pageForm],
  ['positionForm', positionForm],
  ['reportForm', reportForm],
  ['skillForm', skillForm],
  ['toolForm', toolForm],
  ['viewForm', viewForm],
];

/**
 * Carriers still owed titles, as measured on `origin/main` at
 * e758131b3900eb13260f03643e295ca6d625c42b. SHRINK-ONLY — see the header.
 *
 * The four `dashboard.*` / `view.*` / `field.*` entries were fenced out of
 * #17232's round by in-flight PRs on their carrier files (#17474 `dashboard.zod.ts`,
 * #17360 `view.zod.ts`, #17477 `field.zod.ts` — `field.options` and
 * `object.fields.options` are the same `SelectOptionSchema`). This pin
 * OBSERVES them without editing them, which is why the count below is the
 * whole class and not the slice one PR could reach.
 */
const LEDGER: ReadonlySet<string> = new Set([
  'dashboard:widgets',
  'dashboard:globalFilters',
  'field:options',
  'object:fields.options',
  'view:columns',
  'view:sort',
  'view:tabs',
]);

/** `z.never().optional().describe('[REMOVED] …')` — `shared/retired-key.ts`. */
const RETIRED_PREFIX = '[REMOVED] ';

type Node = Record<string, any>;

/** Every `{ path, spec }` a form declares, composite/repeater children included. */
function* walkFormFields(fields: any[] | undefined, prefix = ''): Generator<{ path: string; spec: any }> {
  for (const f of fields ?? []) {
    if (!f || typeof f !== 'object' || !f.field) continue;
    const path = prefix ? `${prefix}.${f.field}` : String(f.field);
    yield { path, spec: f };
    if (Array.isArray(f.fields)) yield* walkFormFields(f.fields, path);
  }
}

/** Follow `$ref` into `$defs`. */
function deref(node: Node | undefined, root: Node, depth = 0): Node | undefined {
  let n = node;
  let d = 0;
  while (n && typeof n === 'object' && typeof n.$ref === 'string' && d++ < 8) {
    const m = /^#\/\$defs\/(.+)$/.exec(n.$ref);
    n = m ? root.$defs?.[m[1]] : undefined;
  }
  return n;
}

/** Merged `properties` of a node and of every union arm under it. */
function propertiesOf(node: Node | undefined, root: Node, depth = 0): Record<string, Node> {
  const n = deref(node, root);
  if (!n || typeof n !== 'object' || depth > 8) return {};
  const out: Record<string, Node> = { ...(n.properties ?? {}) };
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    for (const arm of n[key] ?? []) Object.assign(out, propertiesOf(arm, root, depth + 1));
  }
  return out;
}

/** Every node a union can resolve to, so an arm is never merged away. */
function candidates(node: Node | undefined, root: Node, depth = 0): Node[] {
  const n = deref(node, root);
  if (!n || typeof n !== 'object' || depth > 8) return [];
  const out = [n];
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    for (const arm of n[key] ?? []) out.push(...candidates(arm, root, depth + 1));
  }
  return out;
}

/** The child-key map a dotted path step looks up on: array rows, record values, or plain properties. */
function childrenOf(node: Node | undefined, root: Node, depth = 0): Record<string, Node> {
  const n = deref(node, root);
  if (!n || typeof n !== 'object' || depth > 8) return {};
  if (n.type === 'array' && n.items) return propertiesOf(n.items, root, depth + 1);
  if (n.additionalProperties && typeof n.additionalProperties === 'object') {
    return { ...propertiesOf(n, root, depth + 1), ...propertiesOf(n.additionalProperties, root, depth + 1) };
  }
  const direct = propertiesOf(n, root, depth + 1);
  if (Object.keys(direct).length) return direct;
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    for (const arm of n[key] ?? []) {
      const c = childrenOf(arm, root, depth + 1);
      if (Object.keys(c).length) return c;
    }
  }
  return {};
}

/**
 * Resolve a form field's dotted path to its schema node.
 *
 * Each step keeps EVERY union arm as a separate candidate rather than merging
 * them: `view` is a four-arm union in which `columns` is an object array on
 * the list arm and an INTEGER (form body columns) on the form arm, and a
 * merge silently keeps whichever arm zod emitted last.
 */
function resolveFieldNode(root: Node, segments: string[]): Node | undefined {
  let cursor = candidates(root, root);
  for (const seg of segments) {
    const next: Node[] = [];
    for (const node of cursor) {
      const kids = childrenOf(node, root);
      if (kids[seg]) next.push(...candidates(kids[seg], root));
    }
    if (next.length === 0) return undefined;
    cursor = next;
  }
  // A repeater is an ARRAY — prefer an object-item array arm over a scalar one.
  return (
    cursor.find((n) => n.type === 'array' && Object.keys(propertiesOf(n.items, root)).length > 0) ??
    cursor.find((n) => n.type === 'array') ??
    cursor[0]
  );
}

/** A repeater's ROW schema — the array's `items`, through refs and unions. */
function rowSchemaOf(node: Node | undefined, root: Node, depth = 0): Node | undefined {
  const n = deref(node, root);
  if (!n || typeof n !== 'object' || depth > 8) return undefined;
  if (n.type === 'array' && n.items && !Array.isArray(n.items)) return deref(n.items, root);
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    for (const arm of n[key] ?? []) {
      const r = rowSchemaOf(arm, root, depth + 1);
      if (r) return r;
    }
  }
  return undefined;
}

interface Carrier {
  /** `<metadata type>:<dotted form path>` — the ledger key. */
  id: string;
  type: string;
  path: string;
  /** Row properties an author may write — retired tombstones excluded. */
  authorable: string[];
  untitled: string[];
  /** Set when the row has no object shape at all (a scalar-item repeater). */
  scalarItems?: string;
}

/**
 * Derive every repeater carrier through the platform's own predicate.
 *
 * ⚠️ `io: 'input'` where the server's `toJsonSchemaSafe` takes zod's default
 * (`'output'`). The two agree on all fourteen other types; they part on
 * `action`, whose `ActionSchema` ends in a `.transform()` — the OUTPUT
 * derivation of a `ZodPipe` is `{}`, with no properties at all. `.meta({ title })`
 * rides both derivations identically, so the input shape is the one that can
 * see the authoring surface this pin is about. The output-side hole is a
 * separate defect and is not this pin's to hide.
 */
function deriveCarriers(): Carrier[] {
  const carriers: Carrier[] = [];
  for (const [, form] of FORMS) {
    const f = form as any;
    const type = f?.data?.schemaId as string | undefined;
    if (!type) continue;
    const zodSchema = getMetadataTypeSchema(type);
    if (!zodSchema) continue;
    const root = z.toJSONSchema(zodSchema, { unrepresentable: 'any', io: 'input' }) as Node;
    const fields = (f.sections ?? []).flatMap((s: any) => s.fields ?? []);
    for (const { path, spec } of walkFormFields(fields)) {
      if (spec.type !== 'repeater') continue;
      const carrier: Carrier = { id: `${type}:${path}`, type, path, authorable: [], untitled: [] };
      const node = resolveFieldNode(root, path.split('.'));
      const row = rowSchemaOf(node, root);
      const props = row ? propertiesOf(row, root) : {};
      if (Object.keys(props).length === 0) {
        carrier.scalarItems = String(row?.type ?? 'unresolved');
        carriers.push(carrier);
        continue;
      }
      for (const [key, raw] of Object.entries(props)) {
        const prop = deref(raw, root);
        // A retired key is a parse-time refusal, not an authorable column.
        if (typeof prop?.description === 'string' && prop.description.startsWith(RETIRED_PREFIX)) continue;
        carrier.authorable.push(key);
        const title = prop?.title;
        if (typeof title !== 'string' || title.length === 0) carrier.untitled.push(key);
      }
      carriers.push(carrier);
    }
  }
  return carriers;
}

const CARRIERS = deriveCarriers();
const OBJECT_ROW_CARRIERS = CARRIERS.filter((c) => !c.scalarItems);

describe('#17232 — the repeater survey itself (controls before verdicts)', () => {
  it('walks every form this package exports, and finds repeaters in exactly the forms that declare one', () => {
    // Lit control — the walk really ran.
    expect(FORMS.length).toBe(15);
    expect(CARRIERS.length).toBeGreaterThan(20);

    const carrying = new Set(CARRIERS.map((c) => c.type));
    // Lit: four domains declare repeaters.
    for (const type of ['action', 'dashboard', 'flow', 'view', 'report', 'skill']) {
      expect(carrying.has(type), `${type} declares a repeater`).toBe(true);
    }
    // Dark: forms that declare NO repeater must contribute none. A walk that
    // matched everything, or nothing, cannot pass both halves.
    for (const type of ['agent', 'tool', 'hook', 'position']) {
      expect(carrying.has(type), `${type} declares no repeater`).toBe(false);
    }
  });

  it('resolves every repeater to a real row schema — an unresolved path is a hole in the survey, not a pass', () => {
    for (const c of CARRIERS) {
      if (c.scalarItems) {
        // The one legitimate shape with no row properties: `action.locations`
        // is an array of enum STRINGS, so the panel renders no column headers
        // at all and there is no machine key to leak. Pinned by name so a
        // future object-shaped repeater cannot land here silently.
        expect(c.id, 'the only repeater with no object row shape').toBe('action:locations');
        expect(c.scalarItems).toBe('string');
        continue;
      }
      expect(c.authorable.length, `${c.id} resolved to a row schema with no authorable properties`).toBeGreaterThan(0);
    }
  });

  it('excludes retired keys from the authorable row — a tombstone is a parse error, not a column', () => {
    const flowNodes = CARRIERS.find((c) => c.id === 'flow:nodes');
    expect(flowNodes, 'flow.nodes is a repeater').toBeDefined();
    // Lit: the row really was read.
    expect(flowNodes!.authorable).toContain('inputSchema');
    // Dark: `flow.nodes[].outputSchema` is a `retiredKey` tombstone.
    expect(flowNodes!.authorable).not.toContain('outputSchema');
  });
});

describe('#17232 — every repeater row property carries a JSON Schema title', () => {
  for (const carrier of OBJECT_ROW_CARRIERS) {
    const owed = LEDGER.has(carrier.id);
    it(`${carrier.id}${owed ? ' (ledger: still owed titles)' : ''}`, () => {
      if (owed) {
        // Shrink-only: a ledger entry that has been paid must be DELETED, so
        // the ledger can never quietly outlive the debt it records.
        expect(
          carrier.untitled.length,
          `${carrier.id} is fully titled now — delete its LEDGER entry in this file`,
        ).toBeGreaterThan(0);
        return;
      }
      expect(
        carrier.untitled,
        `${carrier.id}: these row properties have no \`.meta({ title })\`, so Studio's property-panel ` +
          `table prints the raw key as the column header in every locale, English included. Author an ` +
          `English title on the item schema — ⛔ do not add this carrier to LEDGER.`,
      ).toEqual([]);
    });
  }

  it('the ledger names only carriers that exist — a stale entry is a rule guarding nothing', () => {
    const ids = new Set(CARRIERS.map((c) => c.id));
    for (const id of LEDGER) {
      expect(ids.has(id), `LEDGER names '${id}', which no form declares any more — delete it`).toBe(true);
    }
  });

  it('dashboard.header.actions stays titled — the one carrier #17227 closed', () => {
    const c = CARRIERS.find((x) => x.id === 'dashboard:header.actions');
    expect(c, 'dashboard.header.actions is a repeater').toBeDefined();
    expect(c!.authorable).toEqual(['label', 'actionUrl', 'actionType', 'icon']);
    expect(c!.untitled).toEqual([]);
  });
});
