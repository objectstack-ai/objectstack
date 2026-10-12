// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The unique-scope family: every field a stack declares `unique` collides as
// its declared scope says.
//
// ## What the family asks, and of whom
//
// The PROMISE is the declaration's, read from the field as the spec's own
// parse produces it (`FieldSchema` in `@objectstack/spec/data`), which is the
// value a built artifact carries: an authored scope is kept verbatim, and an
// `autonumber` that authors no `unique` parses to `'organization'`. What each
// scope means is `UniqueScopeSchema`'s published meaning (ADR-0120 D1, D3):
//
//   - `true` / `'organization'` — one holder per organization: a second
//     record holding the value in the SAME organization is refused, and a
//     record in ANOTHER organization may hold it too;
//   - `'global'` — one holder across the whole installation: refused in both;
//   - on an object with no organization column (`isTenancyDisabled`, ADR-0066)
//     both per-organization spellings degrade to the column alone, so the
//     value is installation-wide there too.
//
// The ANSWER is the engine's, asked through two write doors: the REST data
// route as a signed-in caller (`POST /data/:object`, `PATCH /data/:object/:id`)
// and the engine's own write as the system principal (the handle's
// `hooks.run` with `{ system: true }`, the door an import, a migration, a seed
// replay or a `runAs: 'system'` flow writes through).
//
// ## The two legs, and which boot runs them
//
//   - `within` — the second holder is written into the organization the first
//     was: on a `single`-posture boot that is the install's one organization
//     (the untenanted install: no wall, every write lands in it), on a walled
//     boot one organization of the wall. Expected: refused, always.
//   - `across` — the second holder is written into ANOTHER organization.
//     Only a walled boot (`os verify --multi-tenant`) has two; on a `single`
//     boot the leg is reported NOT RUN, with the reason, never skipped
//     silently. Expected: admitted for a per-organization scope, refused for
//     `'global'` and for an object with no organization column.
//
// On a walled boot the family provisions the second organization the way a
// user makes one: a fresh sign-up that creates its workspace
// (`POST /auth/organization/create`). The system door names each organization
// on the row (`organization_id`), which is how a system writer must address
// one under a wall (an org-less system write is refused there).
//
// ⛔ Nothing here resolves a scope. A field whose scope is decided by something
// other than its declaration is EXCLUDED or NOT DERIVABLE and named, never
// given an expectation copied from the engine.
//
// ## Attribution is the control
//
// A refusal proves a collision only when it is the platform's unique refusal
// (`UNIQUE_VIOLATION` at the REST door, `DUPLICATE_RECORD` at the system door,
// naming the probed object) AND it is this field's: either the refusal names
// the probed field, or it names none and a TWIN — the same record with only the
// probed value changed — is admitted. The twin is needed because a
// per-organization constraint is an expression index, and the driver names the
// index, not the column, so the refusal carries no `field` (that is
// `uniqueViolationColumn`'s contract: an index name is never reported as a
// column). Any other refusal — a hook's own dedupe, a validation rule, a
// permission, a constraint on another field — is `unattributed`: an engine
// that refused every write would otherwise prove every scope.
//
// Run it on a fresh stack of its own: it writes duplicates by design, and the
// records it creates would collide with another family's on a unique field.

import {
  FieldSchema,
  REFERENCE_VALUE_TYPES,
  RUNTIME_OWNED_FIELD_TYPES,
  isGlobalUnique,
  isMultiValueField,
  isTenancyDisabled,
  isUniqueDeclared,
} from '@objectstack/spec/data';
import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
import { declaredCollection } from './artifact-collections.js';
import { deriveCrudCases, fillRelationalRefs, type CrudCase } from './derive.js';
import type { VerifyStack } from './harness.js';

/** A scope a declaration can state (`UniqueScopeSchema`, minus `false`). */
export type DeclaredUniqueScope = true | 'organization' | 'global';

/** The door a probe writes through. */
export type UniqueScopeDoor = 'rest' | 'system';

/** Whether the second holder is written into the same organization or another one. */
export type UniqueScopeLeg = 'within' | 'across';

/** The write that offers the second holder: a new record, or an existing one changed to the value. */
export type UniqueScopeOperation = 'insert' | 'update';

const DOORS: readonly UniqueScopeDoor[] = ['rest', 'system'];

/** The platform's unique refusal, per door (`DuplicateRecordError`; ADR-0112). */
const UNIQUE_REFUSAL: Record<UniqueScopeDoor, string> = { rest: 'UNIQUE_VIOLATION', system: 'DUPLICATE_RECORD' };

/** Derived on read, never stored: no duplicate of one can be written. */
const DERIVED_TYPES = new Set(['formula', 'summary', 'rollup']);

/** The declared types whose values this family can vary, so every probe gets a fresh one. */
const VARIABLE_TYPES = new Set([
  'text', 'textarea', 'string', 'markdown', 'html', 'richtext', 'code', 'email', 'url', 'phone',
  'number', 'currency', 'percent', 'date', 'datetime',
]);

/** One field the app declares unique, and what the family can read from its declaration. */
export interface UniqueScopeCase {
  object: string;
  field: string;
  type: string;
  /** The scope the declaration states, as the spec's parse of the field carries it. */
  declared?: DeclaredUniqueScope;
  /** `'organization'` for `true` and `'organization'` (synonyms), `'global'` for `'global'`. */
  scope?: 'organization' | 'global';
  /** Whether the object carries an organization column (`false` = `tenancy.enabled: false`). */
  organizationColumn: boolean;
  /** What a second holder in ANOTHER organization meets. */
  across?: 'admitted' | 'refused';
  /** The doors the field is probed through. */
  doors: UniqueScopeDoor[];
  /** Why the REST door is not one of them. */
  restExcluded?: string;
  /** Why the across leg is not run for this field. */
  acrossExcluded?: string;
  /** Why the declaration states nothing this family can compare against. */
  excluded?: string;
  /** Why no record holding a fresh value of the field can be built from the app's metadata. */
  notDerivable?: string;
}

/** A field's scalar sample, or `undefined` with the reason when there is none. */
interface ValueSource {
  /** The CRUD derivation's sample for the field's type, varied per probe. */
  base?: string | number;
  /** For a reference field: the object a fresh value is a new record of. */
  target?: string;
  reason?: string;
}

function valueSource(type: string, field: string, def: any, objectName: string, crud: CrudCase | undefined): ValueSource {
  if (REFERENCE_VALUE_TYPES.has(type)) {
    if (isMultiValueField({ type, multiple: def?.multiple === true })) {
      return { reason: 'a multi-valued reference: its value is a list, not one value two records can share' };
    }
    const ref = crud?.relationalRefs?.find((r) => r.field === field);
    return ref
      ? { target: ref.target }
      : { reason: 'its target is not an object this app declares, so no record to reference can be built from its metadata' };
  }
  const synthAs = RUNTIME_OWNED_FIELD_TYPES.has(type) ? 'text' : type;
  if (!VARIABLE_TYPES.has(synthAs)) {
    return { reason: `a ${type} value space is too small or too closed to give every probe a fresh value` };
  }
  // The CRUD derivation's own sample, asked of a one-field object: it skips a
  // readonly, system or runtime-issued field, and an autonumber stores text.
  const probe = { objects: [{ name: objectName, fields: { [field]: { ...def, type: synthAs, readonly: false, system: false, required: false } } }] };
  const sample = deriveCrudCases(probe)[0]?.body?.[field];
  return typeof sample === 'string' || typeof sample === 'number'
    ? { base: sample }
    : { reason: `the CRUD derivation synthesizes no ${type} value` };
}

/**
 * Derive one case per field the app declares unique, over every object it
 * declares. The population is the field-level declaration (`FieldSchema.unique`
 * after the spec's parse); a unique `indexes[]` entry is a different surface
 * with its own meaning of bare `true` and is not in it. A field the family
 * cannot compare is still returned, `excluded` or `notDerivable`, with the
 * reason, so the report counts it.
 */
export function deriveUniqueScopeCases(config: any): UniqueScopeCase[] {
  const crud = new Map<string, CrudCase>(deriveCrudCases(config).map((c) => [c.object, c]));
  const cases: UniqueScopeCase[] = [];
  for (const obj of declaredCollection(config, 'objects')) {
    if (!obj?.name) continue;
    const organizationColumn = !isTenancyDisabled(obj);
    for (const [field, def] of Object.entries<any>(obj.fields ?? {})) {
      const type = typeof def?.type === 'string' ? def.type : '';
      const parsed = FieldSchema.safeParse(def);
      if (!parsed.success) {
        if (def?.unique === undefined || def?.unique === false) continue;
        const issue = parsed.error.issues[0];
        cases.push({
          object: obj.name, field, type, organizationColumn, doors: [],
          excluded: `the declaration does not parse under the spec's FieldSchema (${issue?.path.join('.') || 'field'}: ${clip(issue?.message, 120)})`,
        });
        continue;
      }
      const declared = parsed.data.unique;
      if (!isUniqueDeclared(declared)) continue;
      const scope = isGlobalUnique(declared) ? 'global' : 'organization';
      const c: UniqueScopeCase = {
        object: obj.name,
        field,
        type,
        declared: declared as DeclaredUniqueScope,
        scope,
        organizationColumn,
        across: scope === 'global' || !organizationColumn ? 'refused' : 'admitted',
        doors: [...DOORS],
      };
      if (field === 'id' || def?.system === true || def?.readonly === true || RUNTIME_OWNED_FIELD_TYPES.has(type)) {
        c.doors = ['system'];
        c.restExcluded =
          `${RUNTIME_OWNED_FIELD_TYPES.has(type) ? `runtime-issued (${type})` : def?.readonly === true ? 'readonly' : 'system'}: ` +
          "the REST door drops a caller's value on this field, so no caller can offer a duplicate there";
      }
      if (typeof obj.tenancy?.tenantField === 'string' && obj.tenancy.tenantField !== 'organization_id') {
        c.acrossExcluded = `the object names its own tenant column (${obj.tenancy.tenantField}), and the family addresses an organization by organization_id`;
      }
      const source = DERIVED_TYPES.has(type) ? undefined : valueSource(type, field, def, obj.name, crud.get(obj.name));
      if (!source) {
        c.excluded = `a ${type} value is derived on read, not stored, so no second record can hold it`;
      } else if (source.reason) {
        c.notDerivable = source.reason;
      } else if (crud.get(obj.name)?.blocked) {
        c.notDerivable = `the object cannot be synthesized: ${crud.get(obj.name)!.blocked}`;
      } else if (source.target && crud.get(source.target)?.blocked) {
        c.notDerivable = `the referenced object cannot be synthesized: ${crud.get(source.target)!.blocked}`;
      } else if (source.target && !c.acrossExcluded) {
        c.acrossExcluded = 'a reference value is a record of one organization, so another organization cannot offer the same one';
      }
      cases.push(c);
    }
  }
  return cases;
}

/** What one write answered. */
export interface UniqueScopeAnswer {
  /** `written` — the door answered success; `refused` — it refused with a code; `faulted` — a 5xx, or a throw with no code. */
  kind: 'written' | 'refused' | 'faulted';
  /** The HTTP status (REST door), or the refusal's own `status`. */
  status?: number;
  code?: string;
  /** The refusal's `object` and `field` (the unique refusal names `field` only when the driver named a column). */
  object?: string;
  field?: string;
  detail?: string;
}

/** What one probe found. */
export interface UniqueScopeProbeResult {
  leg: UniqueScopeLeg;
  door: UniqueScopeDoor;
  operation: UniqueScopeOperation;
  /** What the declaration says the second holder meets. */
  expected: 'refused' | 'admitted';
  /**
   * - `held`         — the write met what the declaration says;
   * - `contradicted` — it met something else (a hard failure; see `detail`);
   * - `unattributed` — refused, but not by this field's unique constraint;
   * - `failed`       — the door faulted;
   * - `not-run`      — a fixture could not be written, or the write path changed what it was handed.
   */
  outcome: 'held' | 'contradicted' | 'unattributed' | 'failed' | 'not-run';
  /** The second holder's write. */
  answer?: UniqueScopeAnswer;
  /** The attribution control: the same record with only the probed value changed, when a refusal named no field. */
  twin?: 'written' | 'refused' | 'not-run';
  detail?: string;
}

/**
 * - `proven`        — every probe held;
 * - `contradicted`  — some probe met something other than the declaration (a hard failure);
 * - `failed`        — a door faulted and none contradicted (a hard failure);
 * - `inconclusive`  — some probe was unattributed or could not run, none contradicted or faulted;
 * - `excluded`      — the declaration states nothing comparable (see `reason`);
 * - `not-derivable` — no record holding a fresh value can be built from the app's metadata (see `reason`).
 */
export type UniqueScopeFieldStatus = 'proven' | 'contradicted' | 'failed' | 'inconclusive' | 'excluded' | 'not-derivable';

export interface UniqueScopeFieldResult {
  object: string;
  field: string;
  type: string;
  declared?: DeclaredUniqueScope;
  scope?: 'organization' | 'global';
  organizationColumn: boolean;
  across?: 'admitted' | 'refused';
  doors: UniqueScopeDoor[];
  restExcluded?: string;
  acrossExcluded?: string;
  status: UniqueScopeFieldStatus;
  reason?: string;
  probes: UniqueScopeProbeResult[];
}

export interface UniqueScopeReport {
  app: string;
  /** The boot the family ran on, and the legs it could run there. */
  boot: {
    posture?: string;
    walled: boolean;
    legs: { within: 'run'; across: 'run' | 'not-run' };
    /** Why the across leg did not run, when it did not. */
    acrossNotRun?: string;
  };
  results: UniqueScopeFieldResult[];
  summary: {
    fields: number;
    /** Fields probed (neither excluded nor not-derivable), per declared scope. */
    probed: { organization: number; global: number };
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

export interface UniqueScopeProofOptions {
  /** The write doors to probe. Default: both, `rest` and `system`. */
  doors?: readonly UniqueScopeDoor[];
}

const clip = (s: unknown, n = 200): string => String(s ?? '').slice(0, n);

const DAY_MS = 86_400_000;

/** A `date` / `datetime` value moved `days` later, in the same spelling. */
function laterBy(value: string, days: number): string {
  const at = Date.parse(value);
  if (Number.isNaN(at) || days === 0) return value;
  const moved = new Date(at + days * DAY_MS).toISOString();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? moved.slice(0, 10) : moved;
}

/** The `k`-th fresh value of a field whose sample is `base`. */
function vary(base: string | number, k: number): string | number {
  if (typeof base === 'number') return base + k;
  if (/^\d{4}-\d{2}-\d{2}/.test(base)) return laterBy(base, k);
  const at = base.indexOf('@');
  if (at > 0) return `${base.slice(0, at)}-u${k}${base.slice(at)}`;
  if (/^https?:\/\//.test(base)) return `${base.replace(/\/$/, '')}/u${k}`;
  if (/^\+\d+$/.test(base)) return `${base}${k}`;
  return `${base}-u${k}`;
}

/** Does a stored value equal the value written (a date read back in another spelling counts)? */
function holds(stored: unknown, value: unknown): boolean {
  if (stored === value) return true;
  if (stored == null || value == null) return false;
  if (typeof value === 'number') return Number(stored) === value;
  if (typeof value === 'string' && typeof stored === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return Date.parse(stored) === Date.parse(value);
  }
  return String(stored) === String(value);
}

/** The fields of `objectDef` a uniqueness constraint covers: a declared field scope, or a unique index entry. */
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

/**
 * The smallest record of `objectDef` the CRUD derivation can offer: its values
 * for the fields the object REQUIRES (required relations already filled), so
 * every optional field takes the app's own default. Each `date` / `datetime`
 * is one day after the one declared before it, and each unique-constrained
 * value is made distinct by `n`, so a fixture collides with nothing but the
 * value a probe writes on purpose.
 */
function fixtureBody(body: Record<string, unknown>, objectDef: any, n: number): Record<string, unknown> {
  const unique = uniqueFields(objectDef);
  const out: Record<string, unknown> = {};
  let dates = 0;
  for (const [name, def] of Object.entries<any>(objectDef?.fields ?? {})) {
    if (def?.required !== true || !(name in body)) continue;
    let value = body[name];
    if ((def?.type === 'date' || def?.type === 'datetime') && typeof value === 'string') value = laterBy(value, dates++);
    if (unique.has(name) && (typeof value === 'string' || typeof value === 'number')) value = vary(value, n);
    out[name] = value;
  }
  return out;
}

/** A writer: one door, as one principal, into one organization. */
interface Writer {
  label: string;
  door: UniqueScopeDoor;
  /** The organization a system writer names on the row; a REST writer's is its session's. */
  stamp?: string;
  insert(object: string, row: Record<string, unknown>): Promise<UniqueScopeAnswer & { id?: string }>;
  update(object: string, id: string, patch: Record<string, unknown>): Promise<UniqueScopeAnswer>;
}

async function readRest(res: Response): Promise<UniqueScopeAnswer & { id?: string }> {
  const status = res.status;
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (status >= 200 && status < 300) {
    const id = body?.id ?? body?.record?.id;
    return { kind: 'written', status, ...(id != null ? { id: String(id) } : {}) };
  }
  if (status >= 500 || typeof body?.code !== 'string') {
    return { kind: 'faulted', status, ...(body?.code ? { code: body.code } : {}), detail: clip(body?.error ?? text) };
  }
  return {
    kind: 'refused',
    status,
    code: body.code,
    ...(typeof body.object === 'string' ? { object: body.object } : {}),
    ...(typeof body.field === 'string' ? { field: body.field } : {}),
    detail: clip(body.error ?? text),
  };
}

async function readSystem(run: () => Promise<unknown>): Promise<UniqueScopeAnswer & { id?: string }> {
  try {
    const row = (await run()) as { id?: unknown } | undefined;
    return { kind: 'written', ...(row?.id != null ? { id: String(row.id) } : {}) };
  } catch (e) {
    const err = e as { code?: unknown; status?: unknown; object?: unknown; field?: unknown; message?: unknown };
    if (typeof err?.code !== 'string') return { kind: 'faulted', detail: clip(err?.message ?? e) };
    return {
      kind: 'refused',
      code: err.code,
      ...(typeof err.status === 'number' ? { status: err.status } : {}),
      ...(typeof err.object === 'string' ? { object: err.object } : {}),
      ...(typeof err.field === 'string' ? { field: err.field } : {}),
      detail: clip(err.message),
    };
  }
}

function restWriter(stack: VerifyStack, token: string, label: string): Writer {
  const call = async (method: string, path: string, body: unknown) => {
    try {
      return await readRest(await stack.apiAs(token, method, path, body));
    } catch (e) {
      return { kind: 'faulted' as const, detail: clip((e as Error)?.message ?? e) };
    }
  };
  return {
    label,
    door: 'rest',
    insert: (object, row) => call('POST', `/data/${object}`, row),
    update: (object, id, patch) => call('PATCH', `/data/${object}/${id}`, patch),
  };
}

function systemWriter(stack: VerifyStack, label: string, stamp: string | undefined, organizationColumn: (object: string) => boolean): Writer {
  const stamped = (object: string, row: Record<string, unknown>) =>
    stamp && organizationColumn(object) ? { ...row, organization_id: stamp } : row;
  return {
    label,
    door: 'system',
    ...(stamp ? { stamp } : {}),
    insert: (object, row) => readSystem(() => stack.hooks.run(object, 'insert', stamped(object, row), { system: true })),
    update: (object, id, patch) => readSystem(() => stack.hooks.run(object, 'update', { ...patch, id }, { system: true })),
  };
}

/** The observation one probe's verdict is read from. */
interface UniqueScopeObservation {
  answer: UniqueScopeAnswer;
  twin?: 'written' | 'refused' | 'not-run';
  /** The first holder still holds the value after the second write. */
  holderHolds: boolean;
  /** When the second write was admitted: the second record holds the value. */
  secondHolds?: boolean;
  /** When the second write was admitted: both records carry the same organization. */
  sameOrganization?: boolean;
}

/**
 * Compare one second-holder write against its declaration. The whole verdict
 * of the family is this function: it reads the declared scope's meaning, the
 * door's answer and the rows the engine left, and nothing else.
 */
function judge(
  c: UniqueScopeCase,
  probe: { leg: UniqueScopeLeg; door: UniqueScopeDoor; operation: UniqueScopeOperation; expected: 'refused' | 'admitted' },
  o: UniqueScopeObservation,
): Pick<UniqueScopeProbeResult, 'outcome' | 'detail'> {
  const { answer } = o;
  const declared = `declared unique: ${JSON.stringify(c.declared)}`;
  if (answer.kind === 'faulted') return { outcome: 'failed', detail: `the door faulted: ${answer.detail ?? ''}` };
  if (answer.kind === 'refused') {
    const unique = answer.code === UNIQUE_REFUSAL[probe.door] && (answer.object === undefined || answer.object === c.object);
    if (!unique) {
      return { outcome: 'unattributed', detail: `refused for another reason: ${answer.code}${answer.status ? ` (${answer.status})` : ''} ${answer.detail ?? ''}` };
    }
    if (answer.field !== undefined && answer.field !== c.field) {
      return { outcome: 'unattributed', detail: `refused by the unique constraint on another field (${answer.field})` };
    }
    // A refusal naming no field is this field's when the only change that
    // turns it into an admitted write is the probed value: an update changes
    // nothing else, and an insert's twin changes nothing else.
    if (answer.field === undefined && probe.operation === 'insert' && o.twin !== 'written') {
      return {
        outcome: 'unattributed',
        detail: `the unique refusal names no field, and the same record with only ${c.field} changed was ${o.twin === 'refused' ? 'refused too' : 'not written'}`,
      };
    }
    if (probe.expected === 'refused') return { outcome: 'held' };
    return {
      outcome: 'contradicted',
      detail:
        `${declared}, and a record in another organization was refused the value: the constraint is ` +
        "installation-wide, and its refusal tells that organization the value is held elsewhere",
    };
  }
  if (o.secondHolds === false) return { outcome: 'not-run', detail: `the write path changed the ${c.field} value it was handed` };
  if (!o.holderHolds) return { outcome: 'unattributed', detail: `the first holder no longer holds the value: the write path moved it` };
  if (c.organizationColumn && probe.leg === 'within' && o.sameOrganization === false) {
    return { outcome: 'not-run', detail: 'the write path placed the second record in another organization' };
  }
  if (c.organizationColumn && probe.leg === 'across' && o.sameOrganization === true) {
    return { outcome: 'not-run', detail: 'both records landed in one organization' };
  }
  if (probe.expected === 'admitted') return { outcome: 'held' };
  const where = probe.leg === 'within' ? 'in the same organization' : 'in another organization';
  return { outcome: 'contradicted', detail: `${declared}, and a second record holding the value ${where} was admitted (${probe.operation})` };
}

function fieldStatus(probes: UniqueScopeProbeResult[]): { status: UniqueScopeFieldStatus; reason?: string } {
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

/** The organization an execution context carries, if any. */
async function organizationOf(stack: VerifyStack, token: string): Promise<string | undefined> {
  try {
    const tenantId = (await stack.contextFor(token))?.tenantId;
    return typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : undefined;
  } catch {
    return undefined;
  }
}

/** A fresh sign-up that creates its own organization, the way a user makes a workspace. */
async function provisionOrganization(stack: VerifyStack, tag: string): Promise<{ token: string; organization: string }> {
  const token = await stack.signUp(`verify-unique-scope-${tag}@objectstack.test`);
  const slug = `verify-unique-scope-${tag}`;
  const res = await stack.apiAs(token, 'POST', '/auth/organization/create', { name: `Verify unique scope ${tag}`, slug });
  if (res.status >= 300) throw new Error(`POST /auth/organization/create answered ${res.status}: ${clip(await res.text())}`);
  const organization = await organizationOf(stack, token);
  if (!organization) throw new Error('the new organization is not the sign-up\'s active organization');
  return { token, organization };
}

/**
 * Run the unique-scope family against a live stack: the `within` leg through
 * every door in `options.doors` (the REST door as the signed-in `token`, the
 * engine's write as the system principal), and on a walled boot the `across`
 * leg into a second organization the family provisions. Returns a structured
 * report; never throws on a per-field failure (collects them).
 */
export async function runUniqueScopeProofs(
  stack: VerifyStack,
  token: string,
  config: any,
  options: UniqueScopeProofOptions = {},
): Promise<UniqueScopeReport> {
  const doors = options.doors ?? DOORS;
  const cases = deriveUniqueScopeCases(config);
  const crud = new Map<string, CrudCase>(deriveCrudCases(config).map((c) => [c.object, c]));
  const objectDefs = new Map<string, any>();
  for (const o of declaredCollection(config, 'objects')) if (o?.name) objectDefs.set(o.name, o);
  const organizationColumn = (object: string) => !isTenancyDisabled(objectDefs.get(object));

  // ── The boot, and the writers each leg writes through ──────────────────────
  let posture: TenancyPosture | undefined;
  try {
    posture = stack.tenancy()?.posture as TenancyPosture | undefined;
  } catch {
    posture = undefined;
  }
  const walled = posture !== undefined && postureEnforcesWall(posture);
  const writers = new Map<string, Writer>();
  let acrossNotRun: string | undefined;
  if (!walled) {
    writers.set('rest:a', restWriter(stack, token, 'REST as the signed-in caller'));
    writers.set('system:a', systemWriter(stack, 'system', undefined, organizationColumn));
    acrossNotRun =
      `this boot's tenancy posture is '${posture ?? 'unknown'}': no organization wall, one organization, so there ` +
      'is no second organization to write into (boot org-scoped, `os verify --multi-tenant`, to run it)';
  } else {
    let a: { token: string; organization: string } | undefined;
    const own = await organizationOf(stack, token);
    try {
      a = own ? { token, organization: own } : await provisionOrganization(stack, 'a');
      const b = await provisionOrganization(stack, 'b');
      if (b.organization === a.organization) throw new Error('the second organization is the first one');
      writers.set('rest:b', restWriter(stack, b.token, `REST as a member of ${b.organization}`));
      writers.set('system:b', systemWriter(stack, `system into ${b.organization}`, b.organization, organizationColumn));
    } catch (e) {
      acrossNotRun = `the second organization could not be provisioned: ${clip((e as Error)?.message ?? e)}`;
    }
    const first = a ?? { token, organization: own };
    writers.set('rest:a', restWriter(stack, first.token, `REST as a member of ${first.organization ?? 'no organization'}`));
    writers.set('system:a', systemWriter(stack, `system into ${first.organization ?? 'no organization'}`, first.organization, organizationColumn));
  }

  // ── Fixtures, per writer: base records for required relations, made once ──
  const bases = new Map<string, Map<string, { id?: string; reason?: string }>>();
  const createdIds = new Map<string, Map<string, string>>();
  let variant = 0;

  async function create(
    w: Writer,
    object: string,
    overrides: Record<string, unknown>,
    n: number = ++variant,
  ): Promise<{ id?: string; reason?: string; answer?: UniqueScopeAnswer }> {
    const c = crud.get(object);
    if (!c || c.blocked) return { reason: c?.blocked ?? `object ${object} not derived` };
    for (const ref of c.relationalRefs ?? []) {
      if (!ref.required || ref.target === object) continue;
      const dep = await base(w, ref.target);
      if (!dep.id) return { reason: `required relation ${ref.field} → ${ref.target}: ${dep.reason}` };
    }
    const ids = createdIds.get(w.label) ?? new Map<string, string>();
    createdIds.set(w.label, ids);
    const { body, missing } = fillRelationalRefs(c, ids);
    if (missing) return { reason: missing };
    const answer = await w.insert(object, { ...fixtureBody(body, objectDefs.get(object), n), ...overrides });
    if (answer.kind !== 'written') return { answer, reason: `${w.label}: create ${object} ${answer.kind} (${answer.code ?? answer.status ?? ''}): ${answer.detail ?? ''}` };
    return answer.id ? { id: answer.id, answer } : { answer, reason: `${w.label}: create ${object} returned no id` };
  }

  async function base(w: Writer, object: string): Promise<{ id?: string; reason?: string }> {
    const mine = bases.get(w.label) ?? new Map<string, { id?: string; reason?: string }>();
    bases.set(w.label, mine);
    const known = mine.get(object);
    if (known) return known;
    mine.set(object, { reason: `base ${object} record is being created` });
    const made = await create(w, object, {});
    if (made.id) {
      const ids = createdIds.get(w.label) ?? new Map<string, string>();
      ids.set(object, made.id);
      createdIds.set(w.label, ids);
    }
    mine.set(object, made);
    return made;
  }

  const row = async (object: string, id: string) => (await stack.rows(object, { id }))[0];

  // ── Probes ─────────────────────────────────────────────────────────────────
  const results: UniqueScopeFieldResult[] = [];
  for (const c of cases) {
    const head = {
      object: c.object,
      field: c.field,
      type: c.type,
      ...(c.declared !== undefined ? { declared: c.declared, scope: c.scope, across: c.across } : {}),
      organizationColumn: c.organizationColumn,
      doors: c.doors,
      ...(c.restExcluded ? { restExcluded: c.restExcluded } : {}),
      ...(c.acrossExcluded ? { acrossExcluded: c.acrossExcluded } : {}),
    };
    if (c.excluded) {
      results.push({ ...head, status: 'excluded', reason: c.excluded, probes: [] });
      continue;
    }
    if (c.notDerivable) {
      results.push({ ...head, status: 'not-derivable', reason: c.notDerivable, probes: [] });
      continue;
    }
    const source = valueSource(c.type, c.field, objectDefs.get(c.object)?.fields?.[c.field], c.object, crud.get(c.object));
    // Probe values draw on the fixtures' counter, so no probe value equals a fixture's.
    const fresh = async (w: Writer): Promise<{ value?: unknown; reason?: string }> => {
      if (source.base !== undefined) return { value: vary(source.base, ++variant) };
      const t = await create(w, source.target!, {});
      return t.id ? { value: t.id } : { reason: `a record to reference: ${t.reason}` };
    };
    const probes: UniqueScopeProbeResult[] = [];

    /** Write the first holder of a fresh value through `w`, and confirm it holds it. */
    const holder = async (w: Writer): Promise<{ id?: string; value?: unknown; reason?: string }> => {
      const v = await fresh(w);
      if (v.reason) return { reason: v.reason };
      const h = await create(w, c.object, { [c.field]: v.value });
      if (!h.id) return { reason: `the first holder: ${h.reason}` };
      const stored = (await row(c.object, h.id))?.[c.field];
      if (!holds(stored, v.value)) return { reason: `the first holder as written does not hold the value (${c.field} is ${JSON.stringify(stored)})` };
      return { id: h.id, value: v.value };
    };

    const offerInsert = async (leg: UniqueScopeLeg, first: Writer, second: Writer): Promise<void> => {
      const expected = leg === 'within' ? 'refused' : c.across!;
      const base = { leg, door: second.door, operation: 'insert' as const, expected };
      const h = await holder(first);
      if (!h.id) return void probes.push({ ...base, outcome: 'not-run', detail: h.reason });
      const n = ++variant;
      const d = await create(second, c.object, { [c.field]: h.value }, n);
      if (!d.answer) return void probes.push({ ...base, outcome: 'not-run', detail: `the second holder: ${d.reason}` });
      let twin: UniqueScopeObservation['twin'];
      if (d.answer.kind === 'refused' && d.answer.field === undefined) {
        const v = await fresh(second);
        const t = v.reason ? undefined : await create(second, c.object, { [c.field]: v.value }, n);
        twin = !t?.answer ? 'not-run' : t.answer.kind === 'written' ? 'written' : 'refused';
      }
      const holderRow = await row(c.object, h.id);
      const secondRow = d.id ? await row(c.object, d.id) : undefined;
      const observation: UniqueScopeObservation = {
        answer: d.answer,
        ...(twin ? { twin } : {}),
        holderHolds: holds(holderRow?.[c.field], h.value),
        ...(d.id ? {
          secondHolds: holds(secondRow?.[c.field], h.value),
          sameOrganization: (holderRow?.organization_id ?? null) === (secondRow?.organization_id ?? null),
        } : {}),
      };
      probes.push({ ...base, answer: d.answer, ...(twin ? { twin } : {}), ...judge(c, base, observation) });
    };

    const offerUpdate = async (w: Writer): Promise<void> => {
      const base = { leg: 'within' as const, door: w.door, operation: 'update' as const, expected: 'refused' as const };
      const h = await holder(w);
      if (!h.id) return void probes.push({ ...base, outcome: 'not-run', detail: h.reason });
      const other = await fresh(w);
      const e = other.reason ? { reason: other.reason } : await create(w, c.object, { [c.field]: other.value });
      if (!e.id) return void probes.push({ ...base, outcome: 'not-run', detail: `the record to change: ${e.reason}` });
      const answer = await w.update(c.object, e.id, { [c.field]: h.value });
      const holderRow = await row(c.object, h.id);
      const changed = await row(c.object, e.id);
      const observation: UniqueScopeObservation = {
        answer,
        holderHolds: holds(holderRow?.[c.field], h.value),
        ...(answer.kind === 'written' ? {
          secondHolds: holds(changed?.[c.field], h.value),
          sameOrganization: (holderRow?.organization_id ?? null) === (changed?.organization_id ?? null),
        } : {}),
      };
      probes.push({ ...base, answer, ...judge(c, base, observation) });
    };

    for (const door of doors) {
      if (!c.doors.includes(door)) continue;
      const w = writers.get(`${door}:a`)!;
      await offerInsert('within', w, w);
      await offerUpdate(w);
    }
    if (!acrossNotRun && !c.acrossExcluded) {
      for (const door of doors) {
        if (!c.doors.includes(door)) continue;
        // A system write to an object with no organization column names no
        // organization, so its across write is the within write again.
        if (door === 'system' && !c.organizationColumn) continue;
        await offerInsert('across', writers.get(`${door}:a`)!, writers.get(`${door}:b`)!);
      }
    }
    results.push({ ...head, ...fieldStatus(probes), probes });
  }

  const all = results.flatMap((r) => r.probes);
  const count = (s: UniqueScopeFieldStatus) => results.filter((r) => r.status === s).length;
  const probed = (scope: 'organization' | 'global') =>
    results.filter((r) => r.scope === scope && r.status !== 'excluded' && r.status !== 'not-derivable').length;
  return {
    app: config?.manifest?.id ?? config?.manifest?.namespace ?? 'app',
    boot: {
      ...(posture ? { posture } : {}),
      walled,
      legs: { within: 'run', across: acrossNotRun ? 'not-run' : 'run' },
      ...(acrossNotRun ? { acrossNotRun } : {}),
    },
    results,
    summary: {
      fields: results.length,
      probed: { organization: probed('organization'), global: probed('global') },
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
    },
  };
}

/** Pretty one-line-per-field summary for logs. */
export function formatUniqueScopeReport(report: UniqueScopeReport): string {
  const lines: string[] = [`\n=== objectstack verify — declared unique scope — ${report.app} ===`];
  const b = report.boot;
  lines.push(
    `  boot: ${b.posture ?? 'unknown'} posture${b.walled ? ', walled' : ''}; within leg run; across leg ` +
      (b.legs.across === 'run' ? 'run' : `NOT RUN — ${b.acrossNotRun ?? ''}`),
  );
  for (const r of report.results) {
    const name = `${r.object}.${r.field} <${r.type}${r.organizationColumn ? '' : ', no organization column'}>`;
    const declared = r.declared !== undefined ? ` unique: ${JSON.stringify(r.declared)}` : '';
    const legs = (p: UniqueScopeProbeResult) => `${p.leg} ${p.door} ${p.operation}`;
    if (r.status === 'proven') {
      lines.push(`  ✓ ${name}${declared}  held on ${r.probes.length} write(s) (${r.probes.map(legs).join(', ')})`);
    } else if (r.status === 'contradicted' || r.status === 'failed') {
      const bad = r.probes.filter((p) => p.outcome === (r.status === 'contradicted' ? 'contradicted' : 'failed'));
      lines.push(`  ✗ ${name}${declared}  ${r.status === 'contradicted' ? 'CONTRADICTED' : 'FAULTED'} on ${bad.length} of ${r.probes.length} write(s):`);
      for (const p of bad) lines.push(`      ${legs(p)}: ${clip(p.detail, 200)}`);
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
      `(probed: ${s.probed.organization} per organization, ${s.probed.global} global; ` +
      `${s.probes} writes: ${s.held} held, ${s.contradictions} contradicted, ${s.unattributed} unattributed, ${s.faults} faulted, ${s.notRun} not run)`,
  );
  return lines.join('\n');
}
