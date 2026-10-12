// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The delete-behaviour family: every `deleteBehavior` a reference field
// declares is what a delete of the record it references does.
//
// ## What the family asks, and of whom
//
// The PROMISE is the declaration's. It is read from the field as the spec's own
// parse produces it (`FieldSchema` in `@objectstack/spec/data`), which is the
// value a built artifact carries: the parse materializes `set_null` on a
// `lookup` / `tree` that authors nothing, keeps an authored value verbatim, and
// leaves the key off a bare `master_detail`. What each of the three values
// means is the enum's own meaning ("what happens if referenced record is
// deleted"), as the published field reference states it:
//
//   - `cascade`  — the record holding the reference is deleted with it;
//   - `set_null` — the holder survives, and no longer references it;
//   - `restrict` — the delete is refused while the holder references it.
//
// The ANSWER is the engine's, asked through two delete doors, by id: the REST
// data route as the signed-in caller (`DELETE /data/:object/:id`, the door an
// app's user deletes through) and the engine's own delete as the system
// principal (the handle's `hooks.run` with `{ system: true }`, the door an
// integration, a system job or a `runAs: 'system'` flow deletes through).
// Only a by-id delete is asked: that is the delete the engine's referential
// pass runs for, so a predicate or multi-row delete is outside this family.
//
// ⛔ Nothing here resolves a behaviour. A declaration whose outcome is decided
// by an engine rule rather than by the declaration — a `set_null` on a REQUIRED
// reference (which cannot be cleared, so the engine escalates it), or a field
// whose parse carries no `deleteBehavior` at all (a bare `master_detail`, where
// the engine's default decides) — is EXCLUDED and named, never given an
// expectation copied from the engine. A family that re-spelled the engine's
// resolution table would be the hand re-derivation an app used to carry for
// exactly this check, one layer down.
//
// ## The probe
//
// Per field and per door: a fresh TARGET record of the object the field
// references and a fresh HOLDER record referencing it through the field, then
// the target is deleted and three rows are read back as the system: the target,
// the holder, and a BYSTANDER — a second holder, made once per field, that
// references a different record of the target object. The bystander is the
// control on the other direction: a delete that reached a record it was not
// asked about is a contradiction too, whatever the declaration says.
//
// Fixtures reuse the values the CRUD family synthesizes (`deriveCrudCases` /
// `fillRelationalRefs`), cut down to the fields the object requires (see
// `fixtureBody`), and are created through the REST door as the same caller. A
// field whose holder or target cannot be built from the app's metadata is
// reported `not-derivable` with the reason; a fixture the app refuses at run
// time leaves the probe `not-run`, with the refusal.
//
// ## Attribution is the control
//
// A `restrict` holds only when the engine refuses with `DELETE_RESTRICTED`
// naming the holder's object as the dependent (`dependentObject`, the
// structured half of the ADR-0112 envelope). Any other refusal — a hook's veto,
// a validation rule, a permission, a different relation — is `unattributed`:
// an engine that refused every delete would otherwise prove every `restrict`.
//
// Run it on a fresh stack of its own: it leaves rows behind (every `restrict`
// probe's target and holder, every bystander), and the records it creates would
// collide with another family's on a unique field.

import { FieldSchema, REFERENCE_VALUE_TYPES, isMultiValueField, referenceTargetOf } from '@objectstack/spec/data';
import { declaredCollection } from './artifact-collections.js';
import { deriveCrudCases, fillRelationalRefs, type CrudCase } from './derive.js';
import type { VerifyStack } from './harness.js';

/** A behaviour a declaration can state (`FieldSchema.deleteBehavior`). */
export type DeclaredDeleteBehavior = 'cascade' | 'set_null' | 'restrict';

/** The door a probe deletes through. */
export type DeleteBehaviorDoor = 'rest' | 'system';

const DOORS: readonly DeleteBehaviorDoor[] = ['rest', 'system'];
const BEHAVIORS: readonly DeclaredDeleteBehavior[] = ['cascade', 'set_null', 'restrict'];

/** One reference field of the app, and what the family can read from its declaration. */
export interface DeleteBehaviorCase {
  object: string;
  field: string;
  /** The declared field type (a member of `REFERENCE_VALUE_TYPES`). */
  type: string;
  /** Whether the declaration stores an array (`isMultiValueField`). */
  multiple: boolean;
  required: boolean;
  /** The object the field references (`referenceTargetOf`), when it names one. */
  target?: string;
  /** The behaviour the declaration states, as the spec's parse of the field carries it. */
  declared?: DeclaredDeleteBehavior;
  /** Why the declaration states no outcome this family can compare against. */
  excluded?: string;
  /** Why no target or holder record can be built from the app's metadata. */
  notDerivable?: string;
}

/**
 * Derive one case per declared reference field of every object the app
 * declares. A field the family cannot compare is still returned, `excluded`
 * (the declaration states no outcome of its own) or `notDerivable` (no fixture
 * can be built from the metadata), with the reason, so the report counts it.
 */
export function deriveDeleteBehaviorCases(config: any): DeleteBehaviorCase[] {
  const objects = declaredCollection(config, 'objects');
  const declaredObjects = new Set<string>(objects.map((o: any) => o?.name).filter(Boolean));
  const crud = new Map<string, CrudCase>(deriveCrudCases(config).map((c) => [c.object, c]));
  const cases: DeleteBehaviorCase[] = [];
  for (const obj of objects) {
    if (!obj?.name) continue;
    const fields: Record<string, any> = obj.fields ?? {};
    for (const [field, def] of Object.entries(fields)) {
      const type = typeof def?.type === 'string' ? def.type : '';
      if (!REFERENCE_VALUE_TYPES.has(type)) continue;
      const base = {
        object: obj.name as string,
        field,
        type,
        multiple: isMultiValueField({ type, multiple: def?.multiple === true }),
        required: def?.required === true,
      };
      let target: string | undefined;
      try {
        target = referenceTargetOf(def);
      } catch (e) {
        cases.push({ ...base, excluded: `the reference target is unreadable: ${clip((e as Error)?.message ?? e)}` });
        continue;
      }
      const parsed = FieldSchema.safeParse(def);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        cases.push({
          ...base,
          ...(target ? { target } : {}),
          excluded: `the declaration does not parse under the spec's FieldSchema (${issue?.path.join('.') || 'field'}: ${clip(issue?.message, 120)})`,
        });
        continue;
      }
      const declared = parsed.data.deleteBehavior as DeclaredDeleteBehavior | undefined;
      const c: DeleteBehaviorCase = { ...base, ...(target ? { target } : {}), ...(declared ? { declared } : {}) };
      if (!target) {
        c.excluded = 'names no target object';
      } else if (!declared) {
        c.excluded =
          `declares no deleteBehavior: the spec's parse carries none on this ${type} field, so what a delete ` +
          'does is the engine\'s default, not a declaration';
      } else if (declared === 'set_null' && base.required) {
        c.excluded =
          'set_null on a required reference: a required reference cannot be cleared, so what a delete does ' +
          'is the engine\'s escalation rule, not this declaration';
      } else if (!declaredObjects.has(target)) {
        c.notDerivable = `the target "${target}" is not an object this app declares, so no target record can be built from its metadata`;
      } else if (field === 'id' || def?.system === true || def?.readonly === true) {
        c.notDerivable =
          `${def?.readonly === true ? 'readonly' : 'system'}: the REST door drops a caller's value on this ` +
          'field, so no holder can reference the target through the door the family creates fixtures with';
      } else if (crud.get(obj.name)?.blocked) {
        c.notDerivable = `the holder object cannot be synthesized: ${crud.get(obj.name)!.blocked}`;
      } else if (crud.get(target)?.blocked) {
        c.notDerivable = `the target object cannot be synthesized: ${crud.get(target)!.blocked}`;
      }
      cases.push(c);
    }
  }
  return cases;
}

/** What one delete door answered. */
export interface DeleteBehaviorAnswer {
  /** `deleted` — the door answered success; `refused` — it refused with a code; `faulted` — a 5xx, or a throw with no code. */
  kind: 'deleted' | 'refused' | 'faulted';
  /** The HTTP status (REST door), or the refusal's own `status`. */
  status?: number;
  code?: string;
  /** The refusal's `object` and `dependentObject` (the `DELETE_RESTRICTED` envelope). */
  object?: string;
  dependentObject?: string;
  detail?: string;
}

/** What one probe found. */
export interface DeleteBehaviorProbeResult {
  door: DeleteBehaviorDoor;
  /**
   * - `held`         — the delete did what the declaration says;
   * - `contradicted` — it did something else (a hard failure; see `detail`);
   * - `unattributed` — the delete was refused for a reason other than this relation;
   * - `failed`       — the door faulted, or answered in a way no behaviour accounts for;
   * - `not-run`      — the fixture could not be created (see `detail`).
   */
  outcome: 'held' | 'contradicted' | 'unattributed' | 'failed' | 'not-run';
  answer?: DeleteBehaviorAnswer;
  /** The holder's value for the field after the delete; `undefined` when the holder is gone. */
  holderValue?: unknown;
  /** Whether each record was still there after the delete. */
  targetRemains?: boolean;
  holderRemains?: boolean;
  detail?: string;
}

/**
 * - `proven`        — every door's probe held;
 * - `contradicted`  — some door's delete did not do what the declaration says (a hard failure);
 * - `failed`        — a door faulted and none contradicted (a hard failure);
 * - `inconclusive`  — some probe was unattributed or could not run, none contradicted or faulted;
 * - `excluded`      — the declaration states no outcome of its own (see `reason`);
 * - `not-derivable` — no fixture can be built from the app's metadata (see `reason`).
 */
export type DeleteBehaviorFieldStatus = 'proven' | 'contradicted' | 'failed' | 'inconclusive' | 'excluded' | 'not-derivable';

export interface DeleteBehaviorFieldResult {
  object: string;
  field: string;
  type: string;
  multiple: boolean;
  required: boolean;
  target?: string;
  declared?: DeclaredDeleteBehavior;
  status: DeleteBehaviorFieldStatus;
  reason?: string;
  probes: DeleteBehaviorProbeResult[];
}

export interface DeleteBehaviorReport {
  app: string;
  results: DeleteBehaviorFieldResult[];
  summary: {
    fields: number;
    /** Fields probed (neither excluded nor not-derivable), per declared behaviour. */
    probed: Record<DeclaredDeleteBehavior, number>;
    proven: number;
    contradicted: number;
    failed: number;
    inconclusive: number;
    excluded: number;
    notDerivable: number;
    probes: number;
    held: number;
    contradictions: number;
    unattributed: number;
    faults: number;
    notRun: number;
    /** `contradicted + failed` — the count a CI gate reads. */
    hardFailures: number;
  };
}

export interface DeleteBehaviorProofOptions {
  /** The delete doors to probe. Default: both, `rest` and `system`. */
  doors?: readonly DeleteBehaviorDoor[];
}

const clip = (s: unknown, n = 200): string => String(s ?? '').slice(0, n);

/** Does a stored reference value point at `id` — the id itself, or an array holding it? */
function references(value: unknown, id: string): boolean {
  if (Array.isArray(value)) return value.some((v) => String(v) === id);
  return value != null && String(value) === id;
}

/**
 * The fields of `objectDef` a uniqueness constraint covers: a field declaring a
 * `unique` scope, and every field of a unique `indexes[]` entry.
 */
function uniqueFields(objectDef: any): Set<string> {
  const out = new Set<string>();
  for (const [name, def] of Object.entries<any>(objectDef?.fields ?? {})) {
    if (def?.unique !== undefined && def?.unique !== false) out.add(name);
  }
  for (const index of Array.isArray(objectDef?.indexes) ? objectDef.indexes : []) {
    if (index?.unique) for (const f of Array.isArray(index.fields) ? index.fields : []) out.add(String(f));
  }
  return out;
}

const DAY_MS = 86_400_000;

/** A synthesized `date` / `datetime` value moved `days` later, in the same spelling. */
function laterBy(value: unknown, days: number): unknown {
  if (typeof value !== 'string' || days === 0) return value;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return value;
  const moved = new Date(at + days * DAY_MS).toISOString();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? moved.slice(0, 10) : moved;
}

/**
 * The smallest record of `objectDef` the CRUD derivation can offer: the values
 * `deriveCrudCases` synthesized for the fields the object REQUIRES (its
 * required relations already filled), and nothing else, so every optional
 * field takes the app's own default instead of a synthesized value that some
 * rule of the app may refuse. Two adjustments keep fixtures from colliding with
 * each other and with the commonest record rules, and decide nothing about the
 * delete: each `date` / `datetime` value is one day later than the one declared
 * before it (a "starts before it ends" rule holds), and each unique-constrained
 * value is made distinct by `n`.
 */
function fixtureBody(body: Record<string, unknown>, objectDef: any, n: number): Record<string, unknown> {
  const unique = uniqueFields(objectDef);
  const out: Record<string, unknown> = {};
  let dates = 0;
  for (const [name, def] of Object.entries<any>(objectDef?.fields ?? {})) {
    if (def?.required !== true || !(name in body)) continue;
    let value = body[name];
    if (def?.type === 'date' || def?.type === 'datetime') value = laterBy(value, dates++);
    if (unique.has(name)) {
      if (typeof value === 'number') value = value + n;
      else if (typeof value === 'string') {
        const at = value.indexOf('@');
        value = at > 0 ? `${value.slice(0, at)}-${n}${value.slice(at)}` : `${value}-${n}`;
      }
    }
    out[name] = value;
  }
  return out;
}

/** Read the REST door's answer to a delete. */
async function readRestDelete(res: Response): Promise<DeleteBehaviorAnswer> {
  const status = res.status;
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (status >= 200 && status < 300) return { kind: 'deleted', status };
  if (status >= 500 || typeof body?.code !== 'string') {
    return { kind: 'faulted', status, ...(body?.code ? { code: body.code } : {}), detail: clip(body?.error ?? text) };
  }
  return {
    kind: 'refused',
    status,
    code: body.code,
    ...(typeof body.object === 'string' ? { object: body.object } : {}),
    ...(typeof body.dependentObject === 'string' ? { dependentObject: body.dependentObject } : {}),
    detail: clip(body.error ?? text),
  };
}

/** Read the system door's answer to a delete (a resolved answer, or the engine's own error). */
async function readSystemDelete(run: () => Promise<unknown>): Promise<DeleteBehaviorAnswer> {
  try {
    await run();
    return { kind: 'deleted' };
  } catch (e) {
    const err = e as { code?: unknown; status?: unknown; object?: unknown; dependentObject?: unknown; message?: unknown };
    if (typeof err?.code !== 'string') return { kind: 'faulted', detail: clip(err?.message ?? e) };
    return {
      kind: 'refused',
      code: err.code,
      ...(typeof err.status === 'number' ? { status: err.status } : {}),
      ...(typeof err.object === 'string' ? { object: err.object } : {}),
      ...(typeof err.dependentObject === 'string' ? { dependentObject: err.dependentObject } : {}),
      detail: clip(err.message),
    };
  }
}

/** The rows read back after one delete. */
interface DeleteObservation {
  answer: DeleteBehaviorAnswer;
  targetRemains: boolean;
  holderRemains: boolean;
  holderValue: unknown;
  bystanderRemains: boolean;
  bystanderValue: unknown;
}

/**
 * Compare one delete against its declaration. The whole verdict of the family
 * is this function: it reads the declared behaviour's meaning, and the rows the
 * engine left, and nothing else.
 */
function judge(
  c: DeleteBehaviorCase,
  ids: { target: string; otherTarget: string },
  o: DeleteObservation,
): Pick<DeleteBehaviorProbeResult, 'outcome' | 'detail'> {
  const { answer } = o;
  if (answer.kind === 'faulted') return { outcome: 'failed', detail: `the door faulted: ${answer.detail ?? ''}` };
  // The refusal is this relation's when the engine names the holder's object as
  // the dependent of the target it was asked to delete.
  const refusedHere =
    answer.kind === 'refused' &&
    answer.code === 'DELETE_RESTRICTED' &&
    answer.dependentObject === c.object &&
    (answer.object === undefined || answer.object === c.target);
  if (answer.kind === 'refused' && !refusedHere) {
    return { outcome: 'unattributed', detail: `refused for another reason: ${answer.code}${answer.status ? ` (${answer.status})` : ''} ${answer.detail ?? ''}` };
  }
  if (!o.bystanderRemains || !references(o.bystanderValue, ids.otherTarget)) {
    return {
      outcome: 'contradicted',
      detail: o.bystanderRemains
        ? `a holder referencing another ${c.target} record was changed (now ${JSON.stringify(o.bystanderValue)})`
        : `a holder referencing another ${c.target} record was deleted`,
    };
  }
  if (c.declared === 'restrict') {
    if (!refusedHere) return { outcome: 'contradicted', detail: 'declared restrict, and the delete was not refused' };
    if (!o.targetRemains) return { outcome: 'failed', detail: 'the delete was refused, and the target is gone' };
    if (!o.holderRemains || !references(o.holderValue, ids.target)) {
      return { outcome: 'contradicted', detail: 'declared restrict: the delete was refused, and the holder was changed anyway' };
    }
    return { outcome: 'held' };
  }
  if (refusedHere) {
    return { outcome: 'contradicted', detail: `declared ${c.declared}, and the delete was refused naming this relation (${answer.detail ?? ''})` };
  }
  if (o.targetRemains) return { outcome: 'failed', detail: 'the door answered success, and the target is still there' };
  if (c.declared === 'cascade') {
    if (o.holderRemains) {
      return { outcome: 'contradicted', detail: `declared cascade, and the holder survived (its ${c.field} is ${JSON.stringify(o.holderValue)})` };
    }
    return { outcome: 'held' };
  }
  // set_null
  if (!o.holderRemains) return { outcome: 'contradicted', detail: 'declared set_null, and the holder was deleted' };
  if (references(o.holderValue, ids.target)) {
    return { outcome: 'contradicted', detail: `declared set_null, and the holder still references the deleted record (${JSON.stringify(o.holderValue)})` };
  }
  return { outcome: 'held' };
}

function fieldStatus(probes: DeleteBehaviorProbeResult[]): { status: DeleteBehaviorFieldStatus; reason?: string } {
  if (probes.some((p) => p.outcome === 'contradicted')) return { status: 'contradicted' };
  if (probes.some((p) => p.outcome === 'failed')) return { status: 'failed' };
  const open = probes.filter((p) => p.outcome === 'unattributed' || p.outcome === 'not-run');
  if (open.length > 0 || probes.length === 0) {
    return {
      status: 'inconclusive',
      reason: probes.length === 0
        ? 'no probe could be run'
        : `${open.length} of ${probes.length} probe(s) unattributed or not run: ${clip(open[0]?.detail, 160)}`,
    };
  }
  return { status: 'proven' };
}

/**
 * Run the delete-behaviour family against a live stack: fixtures are created
 * through the REST door as the authenticated `token`, and each target is
 * deleted through every door in `options.doors` (the REST door as that caller,
 * the engine's delete as the system principal). Returns a structured report;
 * never throws on a per-field failure (collects them).
 */
export async function runDeleteBehaviorProofs(
  stack: VerifyStack,
  token: string,
  config: any,
  options: DeleteBehaviorProofOptions = {},
): Promise<DeleteBehaviorReport> {
  const doors = options.doors ?? DOORS;
  const cases = deriveDeleteBehaviorCases(config);
  const crud = new Map<string, CrudCase>(deriveCrudCases(config).map((c) => [c.object, c]));
  const objectDefs = new Map<string, any>();
  for (const o of declaredCollection(config, 'objects')) if (o?.name) objectDefs.set(o.name, o);

  // One base record per object a fixture's REQUIRED relations reach, created
  // on first need, so a fixture's other references point at real records.
  const createdIds = new Map<string, string>();
  const bases = new Map<string, { id?: string; reason?: string }>();
  let variant = 0;

  async function create(object: string, overrides: Record<string, unknown>): Promise<{ id?: string; reason?: string }> {
    const c = crud.get(object);
    if (!c || c.blocked) return { reason: c?.blocked ?? `object ${object} not derived` };
    for (const ref of c.relationalRefs ?? []) {
      if (!ref.required || ref.target === object) continue;
      const dep = await base(ref.target);
      if (!dep.id) return { reason: `required relation ${ref.field} → ${ref.target}: ${dep.reason}` };
    }
    const { body, missing } = fillRelationalRefs(c, createdIds);
    if (missing) return { reason: missing };
    const row = { ...fixtureBody(body, objectDefs.get(object), ++variant), ...overrides };
    let res: Response;
    try {
      res = await stack.apiAs(token, 'POST', `/data/${object}`, row);
    } catch (e) {
      return { reason: `create ${object} threw: ${clip((e as Error)?.message ?? e)}` };
    }
    const text = await res.text();
    if (res.status >= 300) return { reason: `create ${object} refused (${res.status}): ${clip(text)}` };
    let id: unknown;
    try {
      const parsed = JSON.parse(text) as { id?: unknown; record?: { id?: unknown } };
      id = parsed?.id ?? parsed?.record?.id;
    } catch {
      /* answered below */
    }
    return id == null ? { reason: `create ${object} returned no id` } : { id: String(id) };
  }

  async function base(object: string): Promise<{ id?: string; reason?: string }> {
    const known = bases.get(object);
    if (known) return known;
    bases.set(object, { reason: `base ${object} record is being created` });
    const made = await create(object, {});
    if (made.id) createdIds.set(object, made.id);
    bases.set(object, made);
    return made;
  }

  const firstRow = async (object: string, id: string) => (await stack.rows(object, { id }))[0];

  const results: DeleteBehaviorFieldResult[] = [];
  for (const c of cases) {
    const head = {
      object: c.object,
      field: c.field,
      type: c.type,
      multiple: c.multiple,
      required: c.required,
      ...(c.target ? { target: c.target } : {}),
      ...(c.declared ? { declared: c.declared } : {}),
    };
    if (c.excluded) {
      results.push({ ...head, status: 'excluded', reason: c.excluded, probes: [] });
      continue;
    }
    if (c.notDerivable) {
      results.push({ ...head, status: 'not-derivable', reason: c.notDerivable, probes: [] });
      continue;
    }
    const target = c.target!;
    const ref = (id: string) => (c.multiple ? [id] : id);
    const probes: DeleteBehaviorProbeResult[] = [];

    // The bystander: a holder of another record of the target object, made once per field.
    const other = await create(target, {});
    const bystander = other.id ? await create(c.object, { [c.field]: ref(other.id) }) : other;
    if (!other.id || !bystander.id) {
      for (const door of doors) probes.push({ door, outcome: 'not-run', detail: `bystander fixture: ${bystander.reason}` });
      results.push({ ...head, ...fieldStatus(probes), probes });
      continue;
    }

    for (const door of doors) {
      const t = await create(target, {});
      const h = t.id ? await create(c.object, { [c.field]: ref(t.id) }) : t;
      if (!t.id || !h.id) {
        probes.push({ door, outcome: 'not-run', detail: `fixture: ${h.reason}` });
        continue;
      }
      // The write path may change what it was handed (a hook, a default): a
      // holder that does not reference its target tests nothing.
      const made = await firstRow(c.object, h.id);
      if (!references(made?.[c.field], t.id)) {
        probes.push({ door, outcome: 'not-run', detail: `the holder as created does not reference the target (${c.field} is ${JSON.stringify(made?.[c.field])})` });
        continue;
      }
      let answer: DeleteBehaviorAnswer;
      if (door === 'rest') {
        try {
          answer = await readRestDelete(await stack.apiAs(token, 'DELETE', `/data/${target}/${t.id}`));
        } catch (e) {
          answer = { kind: 'faulted', detail: clip((e as Error)?.message ?? e) };
        }
      } else {
        const targetId = t.id;
        answer = await readSystemDelete(() => stack.hooks.run(target, 'delete', { id: targetId }, { system: true }));
      }
      const targetRow = await firstRow(target, t.id);
      const holderRow = await firstRow(c.object, h.id);
      const bystanderRow = await firstRow(c.object, bystander.id);
      const observation: DeleteObservation = {
        answer,
        targetRemains: targetRow !== undefined,
        holderRemains: holderRow !== undefined,
        holderValue: holderRow?.[c.field],
        bystanderRemains: bystanderRow !== undefined,
        bystanderValue: bystanderRow?.[c.field],
      };
      probes.push({
        door,
        answer,
        targetRemains: observation.targetRemains,
        holderRemains: observation.holderRemains,
        ...(observation.holderRemains ? { holderValue: observation.holderValue } : {}),
        ...judge(c, { target: t.id, otherTarget: other.id }, observation),
      });
    }
    results.push({ ...head, ...fieldStatus(probes), probes });
  }

  const all = results.flatMap((r) => r.probes);
  const count = (s: DeleteBehaviorFieldStatus) => results.filter((r) => r.status === s).length;
  const probed = Object.fromEntries(
    BEHAVIORS.map((b) => [b, results.filter((r) => r.declared === b && r.status !== 'excluded' && r.status !== 'not-derivable').length]),
  ) as Record<DeclaredDeleteBehavior, number>;
  const summary = {
    fields: results.length,
    probed,
    proven: count('proven'),
    contradicted: count('contradicted'),
    failed: count('failed'),
    inconclusive: count('inconclusive'),
    excluded: count('excluded'),
    notDerivable: count('not-derivable'),
    probes: all.length,
    held: all.filter((p) => p.outcome === 'held').length,
    contradictions: all.filter((p) => p.outcome === 'contradicted').length,
    unattributed: all.filter((p) => p.outcome === 'unattributed').length,
    faults: all.filter((p) => p.outcome === 'failed').length,
    notRun: all.filter((p) => p.outcome === 'not-run').length,
    hardFailures: count('contradicted') + count('failed'),
  };
  return { app: config?.manifest?.id ?? config?.manifest?.namespace ?? 'app', results, summary };
}

/** Pretty one-line-per-field summary for logs. */
export function formatDeleteBehaviorReport(report: DeleteBehaviorReport): string {
  const lines: string[] = [`\n=== objectstack verify — declared delete behaviour — ${report.app} ===`];
  for (const r of report.results) {
    const name = `${r.object}.${r.field} <${r.type}${r.multiple ? ', multiple' : ''}${r.required ? ', required' : ''}${r.target ? ` → ${r.target}` : ''}>`;
    const declared = r.declared ? ` ${r.declared}` : '';
    if (r.status === 'proven') {
      lines.push(`  ✓ ${name}${declared}  held on ${r.probes.length} delete(s) (${r.probes.map((p) => p.door).join(', ')})`);
    } else if (r.status === 'contradicted' || r.status === 'failed') {
      const bad = r.probes.filter((p) => p.outcome === (r.status === 'contradicted' ? 'contradicted' : 'failed'));
      lines.push(`  ✗ ${name}${declared}  ${r.status === 'contradicted' ? 'CONTRADICTED' : 'FAULTED'} on ${bad.length} of ${r.probes.length} delete(s):`);
      for (const p of bad) lines.push(`      ${p.door}: ${clip(p.detail, 200)}`);
    } else if (r.status === 'inconclusive') {
      lines.push(`  ~ ${name}${declared}  inconclusive: ${r.reason ?? ''}`);
    } else {
      lines.push(`  – ${name}${declared}  ${r.status}: ${r.reason ?? ''}`);
    }
  }
  const s = report.summary;
  lines.push(
    `  ── ${s.proven} proven, ${s.contradicted} CONTRADICTED, ${s.failed} FAILED, ${s.inconclusive} inconclusive, ` +
      `${s.excluded} excluded, ${s.notDerivable} not derivable ` +
      `(probed: ${s.probed.cascade} cascade, ${s.probed.set_null} set_null, ${s.probed.restrict} restrict; ` +
      `${s.probes} deletes: ${s.held} held, ${s.contradictions} contradicted, ${s.unattributed} unattributed, ${s.faults} faulted, ${s.notRun} not run)`,
  );
  return lines.join('\n');
}
