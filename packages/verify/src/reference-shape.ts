// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The reference-value shape family (ADR-0104 D1): every client-writable
// reference field refuses a value its declared stored shape refuses.
//
// ## What the family asks, and of whom
//
// The PROMISE is the declaration's, read from the one contract that owns it:
// `valueSchemaFor(field, 'stored')` in `@objectstack/spec/data` says a
// single-valued `lookup` / `master_detail` / `user` / `tree` stores a record-id
// string, and a `multiple: true` one stores an array of them. The ANSWER is the
// engine's, asked through the real write doors: the REST data routes as the
// signed-in caller (`POST /data/:object`, `PATCH /data/:object/:id`), and the
// engine's own write as the system principal (the handle's `hooks.run` with
// `{ system: true }`, the door an integration, a system job or a `runAs:
// 'system'` flow takes).
//
// ⛔ Nothing here decides whether a value is acceptable. The spec decides what
// the declaration promises; the engine decides what happens; this file only
// compares the two. A family that re-derived the engine's verdict would be the
// hand-built stand-in an app used to carry for exactly this check, and would
// need a second test to keep the copy honest.
//
// ## The probes, and why these three
//
// One wrong-shaped value per kind an author (human or AI) is known to write
// into a reference column: a boolean (an absent link written as `false`), a
// number, and an embedded record object (the EXPANDED read shape written back,
// the mistake the spec's own `ReferenceIdValueSchema` message names). A
// multi-valued field gets each as an array element, because a bare scalar is
// wrapped into an array upstream of the validator — that wrapping is the
// engine's documented normalization, not a shape question.
//
// Every probe is checked against the spec contract at derivation time: a probe
// the stored schema ACCEPTS cannot test a refusal, so it is dropped and named
// rather than reported as a hole.
//
// ## Attribution is the control
//
// A refusal counts only when the engine NAMES the probed field (`fields[]` on
// the `VALIDATION_FAILED` answer). A refusal that names something else — an app
// validation rule, a hook's throw, a required field the derived record could
// not satisfy — is `unattributed`, never `refused`: an engine that refused
// everything would otherwise satisfy every probe. The insert probes ride on the
// record `deriveCrudCases` synthesizes, so the rest of the write is one the app
// can accept; when that base record could not be created, the update probes do
// not run and say why.

import { REFERENCE_VALUE_TYPES, isMultiValueField, referenceTargetOf, valueSchemaFor } from '@objectstack/spec/data';
import { declaredCollection } from './artifact-collections.js';
import { deriveCrudCases, fillRelationalRefs, type CrudCase } from './derive.js';
import type { VerifyStack } from './harness.js';

/** The kinds of wrong-shaped value written into a reference field. */
export type ReferenceShapeProbeKind = 'boolean' | 'number' | 'embedded-record';

/** The write door a probe goes through. */
export type ReferenceShapeDoor = 'rest' | 'system';

/** The write operation a probe makes. */
export type ReferenceShapeOperation = 'insert' | 'update';

const PROBE_KINDS: readonly ReferenceShapeProbeKind[] = ['boolean', 'number', 'embedded-record'];
const DOORS: readonly ReferenceShapeDoor[] = ['rest', 'system'];
const OPERATIONS: readonly ReferenceShapeOperation[] = ['insert', 'update'];

/**
 * The id an embedded-record probe carries when the field's target has no
 * record of its own on the stack (a `user` field, or a target the CRUD
 * derivation could not create). Shaped like a record id, so the probe differs
 * from a valid value in its SHAPE only.
 */
export const REFERENCE_SHAPE_PROBE_ID = 'verify_reference_shape_probe';

/** One reference field the family covers, or names as outside the property. */
export interface ReferenceShapeCase {
  object: string;
  field: string;
  /** The declared field type (a member of `REFERENCE_VALUE_TYPES`). */
  type: string;
  /** Whether the declaration stores an array (`isMultiValueField`). */
  multiple: boolean;
  /** The object the field points at (`referenceTargetOf`), when it names one. */
  target?: string;
  /** Why the property does not apply to this field; when set, `probes` is empty. */
  excluded?: string;
  /** The probes this field gets. */
  probes: ReferenceShapeProbeKind[];
  /** Probes the spec's stored-shape contract accepts for this field, so they cannot test a refusal. */
  droppedProbes?: Array<{ kind: ReferenceShapeProbeKind; reason: string }>;
}

/** The value one probe writes, with `id` standing in the embedded record. */
export function referenceShapeProbeValue(kind: ReferenceShapeProbeKind, multiple: boolean, id: string): unknown {
  const value = kind === 'boolean' ? false : kind === 'number' ? 42 : { id };
  return multiple ? [value] : value;
}

/**
 * Derive one case per declared reference field of every object the app
 * declares. Fields the caller does not write — declared `readonly` (the write
 * path drops a caller's value) or `system` (the engine owns it) — are returned
 * `excluded`, with the reason, so the report says why they were not probed.
 */
export function deriveReferenceShapeCases(config: any): ReferenceShapeCase[] {
  const cases: ReferenceShapeCase[] = [];
  for (const obj of declaredCollection(config, 'objects')) {
    if (!obj?.name) continue;
    const fields: Record<string, any> = obj.fields ?? {};
    for (const [field, def] of Object.entries(fields)) {
      const type = typeof def?.type === 'string' ? def.type : '';
      if (!REFERENCE_VALUE_TYPES.has(type)) continue;
      const multiple = isMultiValueField({ type, multiple: def?.multiple === true });
      const target = referenceTargetOf(def);
      const base = { object: obj.name as string, field, type, multiple, ...(target ? { target } : {}) };
      if (field === 'id' || def?.system === true) {
        cases.push({ ...base, excluded: 'system (the engine owns this field)', probes: [] });
        continue;
      }
      if (def?.readonly === true) {
        cases.push({ ...base, excluded: 'readonly (the write path drops a caller\'s value)', probes: [] });
        continue;
      }
      const stored = valueSchemaFor({ type, multiple: def?.multiple === true }, 'stored');
      const probes: ReferenceShapeProbeKind[] = [];
      const droppedProbes: Array<{ kind: ReferenceShapeProbeKind; reason: string }> = [];
      for (const kind of PROBE_KINDS) {
        if (stored.safeParse(referenceShapeProbeValue(kind, multiple, REFERENCE_SHAPE_PROBE_ID)).success) {
          droppedProbes.push({ kind, reason: 'the spec\'s stored-shape contract accepts this value' });
        } else {
          probes.push(kind);
        }
      }
      cases.push({ ...base, probes, ...(droppedProbes.length ? { droppedProbes } : {}) });
    }
  }
  return cases;
}

/** What the engine answered one probe. */
export interface ReferenceShapeProbeResult {
  door: ReferenceShapeDoor;
  operation: ReferenceShapeOperation;
  probe: ReferenceShapeProbeKind;
  /**
   * - `refused`      — the engine refused the write and named this field;
   * - `admitted`     — the write landed (the property does NOT hold here);
   * - `unattributed` — refused, but the engine named something else;
   * - `failed`       — the door faulted (a 5xx, or a throw carrying no refusal code);
   * - `not-run`      — the probe could not be written (see `detail`).
   */
  outcome: 'refused' | 'admitted' | 'unattributed' | 'failed' | 'not-run';
  /** The HTTP status (REST door). */
  status?: number;
  /** The code the engine named the field with on a refusal; otherwise the answer's own code. */
  code?: string;
  /** The value the engine answered for the field, when it admitted the write. */
  stored?: unknown;
  detail?: string;
}

/**
 * - `proven`       — every probe was refused, naming the field;
 * - `holes`        — at least one probe was admitted (a hard failure);
 * - `failed`       — a door faulted on a probe and none was admitted (a hard failure);
 * - `inconclusive` — some probe was unattributed or could not run, none admitted or faulted;
 * - `excluded`     — the property does not apply (see `reason`).
 */
export type ReferenceShapeFieldStatus = 'proven' | 'holes' | 'failed' | 'inconclusive' | 'excluded';

export interface ReferenceShapeFieldResult {
  object: string;
  field: string;
  type: string;
  multiple: boolean;
  status: ReferenceShapeFieldStatus;
  reason?: string;
  probes: ReferenceShapeProbeResult[];
  droppedProbes?: Array<{ kind: ReferenceShapeProbeKind; reason: string }>;
}

export interface ReferenceShapeReport {
  app: string;
  results: ReferenceShapeFieldResult[];
  summary: {
    fields: number;
    proven: number;
    holes: number;
    failed: number;
    inconclusive: number;
    excluded: number;
    probes: number;
    refused: number;
    admitted: number;
    unattributed: number;
    notRun: number;
    /** `holes + failed` — the count a CI gate reads. */
    hardFailures: number;
  };
}

export interface ReferenceShapeProofOptions {
  /** The write doors to probe. Default: both, `rest` and `system`. */
  doors?: readonly ReferenceShapeDoor[];
}

/** The base record each object's probes ride on, built the way the CRUD family builds it. */
interface BaseRecord {
  body?: Record<string, unknown>;
  id?: string;
  /** Why the insert probes cannot run (no derivable body). */
  noBody?: string;
  /** Why the update probes cannot run (no created record). */
  noRecord?: string;
}

const clip = (s: unknown, n = 200): string => String(s ?? '').slice(0, n);

/**
 * A variant of the base body whose `unique: true` values differ from every
 * other variant's, so an admitted probe insert is not then refused by the
 * uniqueness index for colliding with the base record — a refusal that would
 * read as `unattributed` and hide the hole.
 */
function distinctBody(body: Record<string, unknown>, objectDef: any, n: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  const fields: Record<string, any> = objectDef?.fields ?? {};
  for (const [name, value] of Object.entries(body)) {
    if (fields[name]?.unique !== true) continue;
    if (typeof value === 'number') out[name] = value + n;
    else if (typeof value === 'string') {
      const at = value.indexOf('@');
      out[name] = at > 0 ? `${value.slice(0, at)}-${n}${value.slice(at)}` : `${value}-${n}`;
    }
  }
  return out;
}

async function buildBaseRecords(
  stack: VerifyStack,
  token: string,
  crudCases: CrudCase[],
  createdIds: Map<string, string>,
): Promise<Map<string, BaseRecord>> {
  const bases = new Map<string, BaseRecord>();
  for (const c of crudCases) {
    if (c.blocked) {
      bases.set(c.object, { noBody: c.blocked, noRecord: c.blocked });
      continue;
    }
    const { body, missing } = fillRelationalRefs(c, createdIds);
    if (missing) {
      bases.set(c.object, { noBody: missing, noRecord: missing });
      continue;
    }
    let res: Response;
    try {
      res = await stack.apiAs(token, 'POST', `/data/${c.object}`, body);
    } catch (e) {
      bases.set(c.object, { body, noRecord: `base record create threw: ${clip((e as Error)?.message ?? e)}` });
      continue;
    }
    const text = await res.text();
    if (res.status >= 300) {
      bases.set(c.object, { body, noRecord: `base record refused (${res.status}): ${clip(text)}` });
      continue;
    }
    let id: unknown;
    try {
      const parsed = JSON.parse(text) as { id?: unknown; record?: { id?: unknown } };
      id = parsed?.id ?? parsed?.record?.id;
    } catch {
      /* answered below */
    }
    if (id == null) {
      bases.set(c.object, { body, noRecord: 'base record create returned no id' });
      continue;
    }
    createdIds.set(c.object, String(id));
    bases.set(c.object, { body, id: String(id) });
  }
  return bases;
}

/** Read the REST door's answer to one probe. */
async function readRestAnswer(res: Response, field: string): Promise<Omit<ReferenceShapeProbeResult, 'door' | 'operation' | 'probe'>> {
  const status = res.status;
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (status >= 200 && status < 300) return { outcome: 'admitted', status, stored: body?.record?.[field] };
  if (status >= 500) return { outcome: 'failed', status, code: body?.code, detail: clip(body?.error ?? text) };
  const named = Array.isArray(body?.fields) ? body.fields.find((f: any) => f?.field === field) : undefined;
  if (named) return { outcome: 'refused', status, code: named.code };
  return { outcome: 'unattributed', status, code: body?.code, detail: clip(body?.error ?? text) };
}

/** Read the system door's answer (a resolved row, or the engine's own error). */
async function readSystemAnswer(
  write: () => Promise<unknown>,
  field: string,
): Promise<Omit<ReferenceShapeProbeResult, 'door' | 'operation' | 'probe'>> {
  try {
    const row = (await write()) as Record<string, unknown> | undefined;
    return { outcome: 'admitted', stored: row?.[field] };
  } catch (e) {
    const err = e as { code?: unknown; fields?: unknown; message?: unknown };
    const named = Array.isArray(err?.fields) ? (err.fields as any[]).find((f) => f?.field === field) : undefined;
    if (named) return { outcome: 'refused', code: named.code };
    if (typeof err?.code === 'string') return { outcome: 'unattributed', code: err.code, detail: clip(err.message) };
    return { outcome: 'failed', detail: clip(err?.message ?? e) };
  }
}

function fieldStatus(probes: ReferenceShapeProbeResult[]): { status: ReferenceShapeFieldStatus; reason?: string } {
  if (probes.some((p) => p.outcome === 'admitted')) return { status: 'holes' };
  if (probes.some((p) => p.outcome === 'failed')) return { status: 'failed' };
  const open = probes.filter((p) => p.outcome === 'unattributed' || p.outcome === 'not-run');
  if (open.length > 0 || probes.length === 0) {
    return {
      status: 'inconclusive',
      reason: probes.length === 0
        ? 'no probe could be written'
        : `${open.length} of ${probes.length} probe(s) not attributed to this field or not run: ${clip(open[0]?.detail ?? open[0]?.code, 160)}`,
    };
  }
  return { status: 'proven' };
}

/**
 * Run the reference-value shape family against a live stack, writing as the
 * authenticated `token` on the REST door and as the system principal on the
 * engine door. Returns a structured report; never throws on a per-field
 * failure (collects them).
 *
 * Run it on its own fresh stack: its probe inserts land rows when a door admits
 * them, and the base records it creates would collide with another family's
 * on a unique field.
 */
export async function runReferenceShapeProofs(
  stack: VerifyStack,
  token: string,
  config: any,
  options: ReferenceShapeProofOptions = {},
): Promise<ReferenceShapeReport> {
  const doors = options.doors ?? DOORS;
  const cases = deriveReferenceShapeCases(config);
  const objectDefs = new Map<string, any>();
  for (const o of declaredCollection(config, 'objects')) if (o?.name) objectDefs.set(o.name, o);

  const createdIds = new Map<string, string>();
  const probed = new Set(cases.filter((c) => !c.excluded).map((c) => c.object));
  const bases = probed.size > 0
    ? await buildBaseRecords(stack, token, deriveCrudCases(config), createdIds)
    : new Map<string, BaseRecord>();

  let variant = 0;
  const results: ReferenceShapeFieldResult[] = [];
  for (const c of cases) {
    const head = { object: c.object, field: c.field, type: c.type, multiple: c.multiple };
    if (c.excluded) {
      results.push({ ...head, status: 'excluded', reason: c.excluded, probes: [] });
      continue;
    }
    const base = bases.get(c.object) ?? { noBody: 'object not derived', noRecord: 'object not derived' };
    const id = (c.target && createdIds.get(c.target)) || REFERENCE_SHAPE_PROBE_ID;
    const probes: ReferenceShapeProbeResult[] = [];
    for (const door of doors) {
      for (const operation of OPERATIONS) {
        for (const probe of c.probes) {
          const value = referenceShapeProbeValue(probe, c.multiple, id);
          const at = { door, operation, probe } as const;
          if (operation === 'insert' && !base.body) {
            probes.push({ ...at, outcome: 'not-run', detail: base.noBody });
            continue;
          }
          if (operation === 'update' && !base.id) {
            probes.push({ ...at, outcome: 'not-run', detail: base.noRecord });
            continue;
          }
          const input = operation === 'insert'
            ? { ...distinctBody(base.body!, objectDefs.get(c.object), ++variant), [c.field]: value }
            : { [c.field]: value };
          let answer: Omit<ReferenceShapeProbeResult, 'door' | 'operation' | 'probe'>;
          if (door === 'rest') {
            try {
              const res = operation === 'insert'
                ? await stack.apiAs(token, 'POST', `/data/${c.object}`, input)
                : await stack.apiAs(token, 'PATCH', `/data/${c.object}/${base.id}`, input);
              answer = await readRestAnswer(res, c.field);
            } catch (e) {
              answer = { outcome: 'failed', detail: clip((e as Error)?.message ?? e) };
            }
          } else {
            answer = await readSystemAnswer(
              () => operation === 'insert'
                ? stack.hooks.run(c.object, 'insert', input, { system: true })
                : stack.hooks.run(c.object, 'update', { ...input, id: base.id }, { system: true }),
              c.field,
            );
          }
          probes.push({ ...at, ...answer });
        }
      }
    }
    results.push({
      ...head,
      ...fieldStatus(probes),
      probes,
      ...(c.droppedProbes ? { droppedProbes: c.droppedProbes } : {}),
    });
  }

  const all = results.flatMap((r) => r.probes);
  const count = (s: ReferenceShapeFieldStatus) => results.filter((r) => r.status === s).length;
  const summary = {
    fields: results.length,
    proven: count('proven'),
    holes: count('holes'),
    failed: count('failed'),
    inconclusive: count('inconclusive'),
    excluded: count('excluded'),
    probes: all.length,
    refused: all.filter((p) => p.outcome === 'refused').length,
    admitted: all.filter((p) => p.outcome === 'admitted').length,
    unattributed: all.filter((p) => p.outcome === 'unattributed').length,
    notRun: all.filter((p) => p.outcome === 'not-run').length,
    hardFailures: count('holes') + count('failed'),
  };
  return { app: config?.manifest?.id ?? config?.manifest?.namespace ?? 'app', results, summary };
}

/** Pretty one-line-per-field summary for logs. */
export function formatReferenceShapeReport(report: ReferenceShapeReport): string {
  const lines: string[] = [`\n=== objectstack verify — reference-value shapes (ADR-0104) — ${report.app} ===`];
  for (const r of report.results) {
    const name = `${r.object}.${r.field} <${r.type}${r.multiple ? ', multiple' : ''}>`;
    if (r.status === 'proven') {
      const codes = [...new Set(r.probes.map((p) => p.code).filter(Boolean))].join(', ');
      lines.push(`  ✓ ${name}  ${r.probes.length} wrong-shape write(s) refused (${codes})`);
    } else if (r.status === 'holes' || r.status === 'failed') {
      const bad = r.probes.filter((p) => p.outcome === (r.status === 'holes' ? 'admitted' : 'failed'));
      lines.push(`  ✗ ${name}  ${r.status === 'holes' ? 'ADMITTED' : 'FAULTED ON'} ${bad.length} of ${r.probes.length} wrong-shape write(s):`);
      for (const p of bad) {
        const what = p.outcome === 'admitted' ? `stored ${JSON.stringify(p.stored)}` : (p.detail ?? '');
        lines.push(`      ${p.door} ${p.operation} ${p.probe}${p.status ? ` → ${p.status}` : ''}: ${clip(what, 160)}`);
      }
    } else if (r.status === 'inconclusive') {
      lines.push(`  ~ ${name}  inconclusive: ${r.reason ?? ''}`);
    } else {
      lines.push(`  – ${name}  excluded: ${r.reason ?? ''}`);
    }
  }
  const s = report.summary;
  lines.push(
    `  ── ${s.proven} proven, ${s.holes} with holes, ${s.failed} FAILED, ${s.inconclusive} inconclusive, ${s.excluded} excluded ` +
      `(${s.probes} probes: ${s.refused} refused, ${s.admitted} admitted, ${s.unattributed} unattributed, ${s.notRun} not run)`,
  );
  return lines.join('\n');
}
