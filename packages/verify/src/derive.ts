// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Metadata-driven proof derivation.
//
// The platform's apps are 100% declarative metadata, so a baseline runtime
// contract can be DERIVED from the metadata itself — no hand-written tests. This
// is the seed of `objectstack verify`: point it at any app (a framework example
// OR a third-party app like hotcrm) and it auto-generates "author this object →
// write it → read it back → assert type fidelity" for every object, then runs
// it against the real in-process stack.
//
// v0 derived per-object CRUD round-trip cases and SKIPPED any object with a
// required relation (lookup / master_detail) — it had no target id to write.
// v1 (ADR-0055 P0) closes that gap with RELATED-RECORD TOPOLOGICAL SYNTHESIS:
// build the object dependency graph from required relational fields, topologically
// order it (targets before dependents), and have the runner thread real ids — so
// relationship-dense objects (the core of real apps) are verified, not skipped.
// What it still can't satisfy (required-reference cycles, external/missing targets)
// is reported `blocked` with a precise reason — the gate stays honest.

/* eslint-disable @typescript-eslint/no-explicit-any */

const COMPUTED = new Set(['formula', 'summary', 'autonumber', 'rollup', 'vector']);
const RELATIONAL = new Set(['lookup', 'master_detail', 'master-detail', 'masterdetail', 'tree']);
const STRUCTURED = new Set(['composite', 'repeater', 'record', 'location', 'address']);
const MEDIA = new Set(['image', 'file', 'avatar', 'video', 'audio', 'signature', 'qrcode']);
const SYSTEM_NAMES = new Set([
  'id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'owner',
  'space', 'instance_state', 'record_id', 'is_deleted',
]);

export type AssertKind = 'equal' | 'set' | 'none';
export interface DerivedAssert {
  field: string;
  type: string;
  value: unknown;
  kind: AssertKind;
}
/** A relational field to fill with a real target id at run time (threaded by the runner). */
export interface RelationalRef {
  field: string; // the FK field key on this object
  target: string; // the referenced object name
  required: boolean;
  multiple: boolean; // store as an array of ids
}
export interface CrudCase {
  object: string;
  blocked?: string; // why this object can't be auto-CRUD'd (e.g. required-reference cycle)
  body?: Record<string, unknown>;
  asserts?: DerivedAssert[];
  skippedFields?: Array<{ name: string; type: string; reason: string }>;
  relationalRefs?: RelationalRef[]; // resolved against created-record ids by the runner
}

function clampNum(f: any, fallback: number): number {
  const { min, max, step } = f;
  let v = fallback;
  if (typeof min === 'number' && v < min) v = min;
  if (typeof max === 'number' && v > max) v = max;
  if (typeof step === 'number' && typeof min === 'number') {
    v = min + step * Math.round((v - min) / step);
  }
  return v;
}

/** Synthesize a valid value for a field type, or null if not synthesizable. */
function synth(type: string, f: any): { value: unknown; kind: AssertKind } | null {
  switch (type) {
    case 'text': case 'textarea': case 'string':
    case 'markdown': case 'html': case 'richtext': case 'code':
      return { value: 'verify-sample', kind: 'equal' };
    case 'email': return { value: 'verify@example.com', kind: 'equal' };
    case 'url': return { value: 'https://example.com', kind: 'equal' };
    case 'phone': return { value: '+14155550100', kind: 'equal' };
    case 'color': return { value: '#3366CC', kind: 'equal' };
    case 'number': return { value: clampNum(f, 7), kind: 'equal' };
    case 'currency': return { value: clampNum(f, 100), kind: 'equal' };
    case 'percent': return { value: clampNum(f, 50), kind: 'equal' };
    case 'rating': return { value: clampNum(f, Math.min(3, f.max ?? 5)), kind: 'equal' };
    case 'slider': case 'progress': return { value: clampNum(f, 25), kind: 'equal' };
    case 'boolean': case 'toggle': return { value: true, kind: 'equal' };
    case 'date': return { value: '2024-03-15', kind: 'equal' };
    case 'datetime': return { value: '2024-03-15T08:30:00.000Z', kind: 'equal' };
    case 'time': return { value: '14:30:00', kind: 'equal' };
    case 'json': return { value: { sample: true }, kind: 'equal' };
    case 'select': case 'radio': {
      const opt = f.options?.[0]?.value;
      return opt != null ? { value: opt, kind: 'equal' } : null;
    }
    case 'multiselect': case 'checkboxes': {
      const opt = f.options?.[0]?.value;
      return opt != null ? { value: [opt], kind: 'set' } : null;
    }
    case 'tags': return { value: ['alpha', 'beta'], kind: 'set' };
    // Opaque-on-read: write a value but don't assert a round-trip (hashed/encrypted).
    case 'password': case 'secret': return { value: 'Sample-Secret-123', kind: 'none' };
    default: return null;
  }
}

/** The target object a relational field references (snake_case object name), or null. */
function relationTarget(f: any): string | null {
  const ref = f?.reference ?? f?.reference_to ?? f?.referenceTo;
  return typeof ref === 'string' && ref.length > 0 ? ref : null;
}

interface Draft {
  name: string;
  body: Record<string, unknown>;
  asserts: DerivedAssert[];
  skippedFields: Array<{ name: string; type: string; reason: string }>;
  relationalRefs: RelationalRef[];
  requiredTargets: string[]; // referenced objects that MUST exist + be ordered-before
  blocked?: string;
}

/**
 * Derive one CRUD round-trip case per authorable object, in DEPENDENCY ORDER.
 *
 * Required relational fields no longer block the object outright: the referenced
 * target is created first (topological order) and the runner threads its real id
 * in. Only genuinely unsatisfiable shapes are `blocked`:
 *  - a required relation whose target is missing from the app config (external), or
 *  - a required-reference cycle (incl. a required self-reference), or
 *  - a required relation whose target is itself blocked (cascade), or
 *  - a required non-relational field that can't be synthesized (unchanged from v0).
 */
export function deriveCrudCases(config: any): CrudCase[] {
  const objects: any[] = config?.objects ?? [];
  const byName = new Map<string, any>();
  for (const o of objects) if (o?.name) byName.set(o.name, o);
  const dsByName = new Map<string, any>();
  for (const ds of (config?.datasources ?? [])) if (ds?.name) dsByName.set(ds.name, ds);

  const drafts = new Map<string, Draft>();

  // ── Pass 1: per-object field classification ───────────────────────────────
  for (const obj of objects) {
    if (!obj?.name) continue;
    const fields: Record<string, any> = obj?.fields ?? {};
    const d: Draft = {
      name: obj.name, body: {}, asserts: [], skippedFields: [], relationalRefs: [], requiredTargets: [],
    };

    // Federated (external) objects are read-only unless BOTH the datasource and
    // the object opt into writes (ADR-0015 write gate). The CRUD probe insert is
    // correctly rejected by the gate for them, so mark the case blocked (skipped)
    // rather than letting a guaranteed-rejected insert surface as a failure.
    if (obj.external) {
      const ds = obj.datasource ? dsByName.get(obj.datasource) : undefined;
      const writable = ds?.external?.allowWrites === true && obj.external?.writable === true;
      if (!writable) {
        d.blocked = `external read-only object (federated datasource "${obj.datasource ?? 'default'}"; no inserts)`;
        drafts.set(obj.name, d);
        continue;
      }
    }

    for (const [name, f] of Object.entries(fields)) {
      const type = String((f as any)?.type ?? '').toLowerCase();
      const isRequired = !!(f as any)?.required;
      if (SYSTEM_NAMES.has(name) || (f as any)?.system || (f as any)?.readonly) continue;
      if (COMPUTED.has(type)) continue;

      if (RELATIONAL.has(type)) {
        const target = relationTarget(f);
        if (!target) {
          if (isRequired) { d.blocked = `required ${type} field "${name}" has no \`reference\` target`; break; }
          d.skippedFields.push({ name, type, reason: 'relation-missing-reference' });
          continue;
        }
        if (!byName.has(target)) {
          // External / cross-app target — we can't synthesize a record for it.
          if (isRequired) { d.blocked = `required ${type} field "${name}" → target "${target}" not in app config`; break; }
          d.skippedFields.push({ name, type, reason: `relation-target-external:${target}` });
          continue;
        }
        d.relationalRefs.push({ field: name, target, required: isRequired, multiple: !!(f as any)?.multiple });
        if (isRequired) d.requiredTargets.push(target);
        continue;
      }

      if (STRUCTURED.has(type) || MEDIA.has(type)) {
        if (isRequired) { d.blocked = `required ${type} field "${name}" (needs structured/media value)`; break; }
        d.skippedFields.push({ name, type, reason: 'unsynthesizable-optional' });
        continue;
      }

      const s = synth(type, f);
      if (!s) {
        if (isRequired) { d.blocked = `required field "${name}" of type "${type}" is not synthesizable`; break; }
        d.skippedFields.push({ name, type, reason: 'no-synth' });
        continue;
      }
      d.body[name] = s.value;
      if (s.kind !== 'none') d.asserts.push({ field: name, type, value: s.value, kind: s.kind });
    }

    drafts.set(obj.name, d);
  }

  // ── Pass 2: cascade-block on missing/blocked required targets (to fixpoint) ─
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of drafts.values()) {
      if (d.blocked) continue;
      for (const t of d.requiredTargets) {
        const td = drafts.get(t);
        if (!td || td.blocked) {
          d.blocked = `required relational target "${t}" is ${!td ? 'missing' : 'not synthesizable'}`;
          changed = true;
          break;
        }
      }
    }
  }

  // ── Pass 3: topological order (targets before dependents) over required edges ─
  const emitted = new Set<string>();
  const order: string[] = [];
  const live = [...drafts.values()].filter((d) => !d.blocked).map((d) => d.name);
  let progress = true;
  while (progress) {
    progress = false;
    for (const name of live) {
      if (emitted.has(name)) continue;
      const d = drafts.get(name)!;
      if (d.requiredTargets.every((t) => emitted.has(t))) {
        emitted.add(name);
        order.push(name);
        progress = true;
      }
    }
  }
  // Residue = a required-reference cycle (incl. required self-reference).
  for (const name of live) {
    if (!emitted.has(name)) drafts.get(name)!.blocked = 'unsatisfiable required-reference cycle';
  }

  // ── Assemble: ordered live cases first, then blocked ones ──────────────────
  const cases: CrudCase[] = [];
  for (const name of order) {
    const d = drafts.get(name)!;
    cases.push({
      object: d.name,
      body: d.body,
      asserts: d.asserts,
      skippedFields: d.skippedFields,
      ...(d.relationalRefs.length ? { relationalRefs: d.relationalRefs } : {}),
    });
  }
  for (const d of drafts.values()) {
    if (d.blocked) cases.push({ object: d.name, blocked: d.blocked });
  }
  return cases;
}

/**
 * Resolve a case's relational fields against the registry of already-created
 * record ids, returning the body to POST. When a REQUIRED target has no created
 * record (its own creation failed at run time), returns a `missing` reason so the
 * caller can skip rather than POST an invalid body.
 */
export function fillRelationalRefs(
  c: CrudCase,
  created: Map<string, string>,
): { body: Record<string, unknown>; missing?: string } {
  const body: Record<string, unknown> = { ...(c.body ?? {}) };
  for (const ref of c.relationalRefs ?? []) {
    const id = created.get(ref.target);
    if (id == null) {
      if (ref.required) return { body, missing: `required relation "${ref.field}" → no created "${ref.target}" record` };
      continue; // optional: leave unset
    }
    body[ref.field] = ref.multiple ? [id] : id;
  }
  return { body };
}
