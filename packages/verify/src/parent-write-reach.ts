// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The parent-derived write reach family: for every object a stack declares
// `controlled_by_parent`, a principal's write on a detail record is what
// ADR-0055 §3 says it is.
//
// ## The promise, and where each half of it is read from
//
// ADR-0055 §3: "editing/deleting/creating a detail requires **edit** access to
// its master", and its 2026-09-07 amendment: the write gate walks the chain hop
// by hop to the first master that governs its own rows. The detail's OWN
// object permission is the first door. So for a principal P, a detail record D
// under a master record M, and a verb (edit, delete, create), the expected
// answer is a conjunction:
//
//   - P holds the verb on D's object — read from the server's effective object
//     permissions for P (`GET /auth/me/permissions`, the one merge of the sets
//     P holds, ADR-0124 D4), folded by the spec's `objectPermissionGrants`;
//   - P can edit M — MEASURED, never re-derived: an empty update of M as P,
//     which runs every write gate M has (the object gate, the record gate and,
//     for a master that is itself controlled by its parent, the master gate
//     above it) and changes no business value.
//
// Expected `allowed` iff both hold. ⛔ Nothing here resolves sharing,
// ownership, hierarchy or a chain: the master half is the engine's own answer
// on M, and the family's subject is that D's answer agrees with it.
//
// Which objects are in the population, and through which field, is the spec's
// own parse of the object (`ObjectSchema`): `sharingModel:
// 'controlled_by_parent'` and exactly one `master_detail` field (ADR-0055 §1).
//
// ## The door, and who walks through it
//
// The engine's write as the signed-in principal: the handle's `hooks.run` with
// `{ as: token }`, which makes the three calls the REST data ingress makes
// (`insert`, `update` by id, `delete` by id) with the caller's resolved
// context, the security middleware and the bound hooks included. It is the
// door, rather than the REST route itself, because only it keeps the refusal's
// own identity: the REST envelope names the ROUTE's object on every refusal
// (measured: a hook refusal naming another object comes back naming the
// route's) and carries no operation, so a hook's nested refusal on another
// object would read there as the detail's own. The engine's own write as the
// system principal bypasses authorization by design, so it is not in this
// family's population.
//
// The principals: three verifier personas whose permission sets this module
// authors from the app's own objects (registered at boot by
// `parentWriteReachSecurity`, granted by name, ADR-0131 D3/D4 — the RLS
// family's probe-persona path), and one persona per position the app declares
// (`provisionRlsPositionPersona`, whose whole capability is what the app binds
// to the position). Each persona meets two master chains: one another
// principal owns (so an all-records grant, not ownership, is what is
// exercised) and one the persona owns; and under each, a detail another
// principal owns and one the persona owns.
//
// ## Attribution is the control
//
// A refusal proves the conjunction held only when it is the platform's
// authorization refusal for this write: `PERMISSION_DENIED` with status 403
// whose `details` name the detail's object and the probed operation
// (`update`, `delete`, `insert`). Any other refusal (validation, a hook's own
// code, a refusal on another object, a uniqueness collision, a missing field)
// is `unattributed`, never proven.
//
// Run it on a fresh stack of its own, booted with
// `parentWriteReachSecurity(config)`: it writes, deletes and signs up.

import { ObjectSchema, referenceCarrierOf } from '@objectstack/spec/data';
import { objectPermissionGrants, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { declaredCollection } from './artifact-collections.js';
import { deriveCrudCases, fillRelationalRefs, type CrudCase } from './derive.js';
import type { VerifyStack } from './harness.js';
import { declaredPositionNames, provisionRlsPositionPersona } from './rls.js';

/**
 * ADR-0055's amendment: the write gate walks at most `CBP_MAX_CHAIN_DEPTH`
 * (currently 8) controlled-by-parent masters and DENIES at the bound — a cost
 * ceiling, not a supported chain length. A detail with that many
 * controlled-by-parent masters above it is excluded: the engine refuses it by
 * design there, whatever its master answers.
 */
const CHAIN_DEPTH_BOUND = 8;

/** One `master_detail` link a write on a detail walks. */
export interface ParentWriteReachHop {
  /** The object holding the link. */
  object: string;
  /** Its `master_detail` field (the field key is the FK column). */
  field: string;
  /** The object that field references. */
  master: string;
}

/** One object the app declares `controlled_by_parent`, and the masters a write on it walks. */
export interface ParentWriteReachCase {
  object: string;
  /**
   * The detail's own link first, then each master's own link while that
   * master is itself `controlled_by_parent`. The last hop's master governs
   * its own rows.
   */
  hops: ParentWriteReachHop[];
  /** Why the declaration states no master this family can compare against. */
  excluded?: string;
  /** Why no detail under its master chain can be built from the app's metadata. */
  notDerivable?: string;
}

/** The verbs a detail write is probed with. */
export type ParentWriteReachVerb = 'edit' | 'delete' | 'create';

/** Who owns a fixture record: another principal, or the probing persona. */
export type ParentWriteReachOwner = 'other' | 'own';

/** What one write answered. */
export interface ParentWriteReachAnswer {
  /** `written` — the engine wrote; `refused` — a coded refusal; `faulted` — a 5xx, or a throw with no code. */
  kind: 'written' | 'refused' | 'faulted';
  status?: number;
  code?: string;
  /** The object and the operation the refusal's `details` name. */
  object?: string;
  operation?: string;
  detail?: string;
}

/** What one detail write found. */
export interface ParentWriteReachProbeResult {
  verb: ParentWriteReachVerb;
  /** Who owns the detail record written (a create writes a new one, owned by the persona). */
  detailOwner?: ParentWriteReachOwner;
  /** The conjunction: the persona holds the verb on the detail's object AND edited the master. */
  expected: 'allowed' | 'refused';
  /**
   * - `held`         — the write met the conjunction;
   * - `contradicted` — it met the other answer (a hard failure; see `detail`);
   * - `unattributed` — refused, but not by the platform's authorization refusal for this detail;
   * - `failed`       — the door faulted;
   * - `not-run`      — a fixture could not be written, or the record does not show what the door answered.
   */
  outcome: 'held' | 'contradicted' | 'unattributed' | 'failed' | 'not-run';
  answer?: ParentWriteReachAnswer;
  detail?: string;
}

/** One persona against one master chain of one detail object. */
export interface ParentWriteReachReach {
  persona: string;
  /** Who owns the master chain. */
  masters: ParentWriteReachOwner;
  /** `unreadable` — the persona cannot read the master, so the detail is outside its reach (not probed). */
  masterRead: 'readable' | 'unreadable' | 'unmeasured';
  /** The measured half: an empty update of the master as the persona. */
  masterEdit?: 'editable' | 'not-editable' | 'unmeasured';
  masterAnswer?: ParentWriteReachAnswer;
  /** The detail object's effective grants for the persona (`/auth/me/permissions`). */
  grants?: Record<ParentWriteReachVerb, boolean>;
  /** Why this reach has no probe. */
  reason?: string;
  probes: ParentWriteReachProbeResult[];
}

/**
 * - `proven`        — every probe held;
 * - `contradicted`  — some probe met the other answer (a hard failure);
 * - `failed`        — a door faulted and none contradicted (a hard failure);
 * - `inconclusive`  — some probe was unattributed or could not run, a master's edit reach could not be measured, or no probe ran;
 * - `excluded`      — the declaration names no master this family can compare against (see `reason`);
 * - `not-derivable` — no detail under its master chain can be built from the app's metadata (see `reason`).
 */
export type ParentWriteReachObjectStatus = 'proven' | 'contradicted' | 'failed' | 'inconclusive' | 'excluded' | 'not-derivable';

export interface ParentWriteReachObjectResult {
  object: string;
  hops: ParentWriteReachHop[];
  status: ParentWriteReachObjectStatus;
  reason?: string;
  reaches: ParentWriteReachReach[];
}

/** A principal the family writes as. */
export interface ParentWriteReachPersona {
  /** `master-all-records`, `detail-only`, `master-all-records-no-delete`, or `position:<name>`. */
  name: string;
  kind: 'verifier' | 'position';
  label: string;
  status: 'run' | 'not-run';
  reason?: string;
  /** The permission sets the server resolved for it (`/auth/me/permissions`). */
  permissionSets?: string[];
}

export interface ParentWriteReachReport {
  app: string;
  /** The one door asked: the engine's write as the signed-in principal. The system door bypasses authorization by design and is not. */
  door: 'user';
  personas: ParentWriteReachPersona[];
  results: ParentWriteReachObjectResult[];
  summary: {
    objects: number;
    /** Objects probed (neither excluded nor not-derivable). */
    probed: number;
    proven: number;
    contradicted: number;
    failed: number;
    inconclusive: number;
    excluded: number;
    notDerivable: number;
    personas: { run: number; notRun: number };
    /** Persona × master chain pairs: probed, outside the persona's read reach, or with an unmeasured master. */
    reaches: { probed: number; unreadable: number; unmeasured: number };
    /** Probes per verb. */
    probes: Record<ParentWriteReachVerb, number>;
    held: number;
    contradictions: number;
    unattributed: number;
    faults: number;
    notRun: number;
    /** `contradicted + failed` objects, plus personas that could not be provisioned — the count a CI gate reads. */
    hardFailures: number;
  };
}

const clip = (s: unknown, n = 200): string => String(s ?? '').slice(0, n);

// ── The population ──────────────────────────────────────────────────────────

/** The spec's parse of an object, or the reason it does not parse. */
function parseObject(obj: any): { data?: any; reason?: string } {
  const parsed = ObjectSchema.safeParse(obj);
  if (parsed.success) return { data: parsed.data };
  const issue = parsed.error.issues[0];
  return { reason: `the object does not parse under the spec's ObjectSchema (${issue?.path.join('.') || 'object'}: ${clip(issue?.message, 120)})` };
}

/** A parsed object's one `master_detail` link, or why it states none. */
function masterLinkOf(name: string, parsed: any): { hop?: ParentWriteReachHop; reason?: string } {
  const links = Object.entries<any>(parsed?.fields ?? {}).filter(([, f]) => f?.type === 'master_detail');
  if (links.length === 0) {
    return { reason: `${name} declares no master_detail field, so it names no master (ADR-0055 §1: exactly one)` };
  }
  if (links.length > 1) {
    return {
      reason:
        `${name} declares ${links.length} master_detail fields (${links.map(([k]) => k).join(', ')}), so which master ` +
        'governs it is not a fact the declaration states (ADR-0055 §1: exactly one)',
    };
  }
  const [field, def] = links[0]!;
  let master: string | undefined;
  try {
    master = referenceCarrierOf({ reference: def?.reference }, 'verify parent write reach') ?? undefined;
  } catch (e) {
    return { reason: `${name}.${field}: ${clip((e as Error)?.message, 160)}` };
  }
  return master ? { hop: { object: name, field, master } } : { reason: `${name}.${field} names no master object` };
}

/**
 * Derive one case per object the app declares `controlled_by_parent`, as the
 * spec's parse of the object states it, with the chain of masters a write on
 * it walks. An object the family cannot compare is still returned,
 * `excluded` or `notDerivable`, with the reason, so the report counts it.
 */
export function deriveParentWriteReachCases(config: any): ParentWriteReachCase[] {
  const crud = new Map<string, CrudCase>(deriveCrudCases(config).map((c) => [c.object, c]));
  const byName = new Map<string, any>();
  for (const obj of declaredCollection(config, 'objects')) if (obj?.name) byName.set(obj.name, obj);
  const parsed = new Map<string, { data?: any; reason?: string }>();
  const parse = (name: string) => {
    if (!parsed.has(name)) parsed.set(name, parseObject(byName.get(name)));
    return parsed.get(name)!;
  };

  const cases: ParentWriteReachCase[] = [];
  for (const [name, obj] of byName) {
    const own = parse(name);
    if (own.reason) {
      if (obj?.sharingModel === 'controlled_by_parent') cases.push({ object: name, hops: [], excluded: own.reason });
      continue;
    }
    if (own.data.sharingModel !== 'controlled_by_parent') continue;

    const c: ParentWriteReachCase = { object: name, hops: [] };
    const visited = new Set<string>([name]);
    let current = name;
    let currentParsed = own.data;
    for (;;) {
      const link = masterLinkOf(current, currentParsed);
      if (!link.hop) {
        c.excluded = current === name ? link.reason : `its master ${current} is controlled_by_parent, and ${link.reason}`;
        break;
      }
      c.hops.push(link.hop);
      const master = link.hop.master;
      if (!byName.has(master)) {
        c.excluded = `the master ${master} is not an object this app declares, so no master record can be built from its metadata`;
        break;
      }
      const m = parse(master);
      if (m.reason) {
        c.excluded = `the master ${master}: ${m.reason}`;
        break;
      }
      if (m.data.sharingModel !== 'controlled_by_parent') break;
      if (visited.has(master)) {
        c.excluded = `the master chain re-enters ${master} (a cycle): the engine's write gate refuses by its cycle guard, whatever a master answers`;
        break;
      }
      visited.add(master);
      if (c.hops.length >= CHAIN_DEPTH_BOUND) {
        c.excluded =
          `the master chain reaches ${CHAIN_DEPTH_BOUND} controlled_by_parent masters, the write gate's depth bound ` +
          "(ADR-0055's amendment), where it refuses by design whatever a master answers";
        break;
      }
      current = master;
      currentParsed = m.data;
    }
    if (!c.excluded) {
      for (const objectName of [name, ...c.hops.map((h) => h.master)]) {
        const blocked = crud.get(objectName)?.blocked;
        if (blocked) {
          c.notDerivable = objectName === name
            ? `the detail cannot be synthesized: ${blocked}`
            : `the master ${objectName} cannot be synthesized: ${blocked}`;
          break;
        }
      }
    }
    cases.push(c);
  }
  return cases;
}

// ── The verifier personas ───────────────────────────────────────────────────

/** The three verifier personas: the set each holds, and the email it signs up with. */
const VERIFIER_PERSONAS = [
  { name: 'master-all-records', set: 'verify_parent_write_master_all', email: 'verify-parent-write-master-all@objectstack.test' },
  { name: 'detail-only', set: 'verify_parent_write_detail_only', email: 'verify-parent-write-detail-only@objectstack.test' },
  { name: 'master-all-records-no-delete', set: 'verify_parent_write_no_delete', email: 'verify-parent-write-no-delete@objectstack.test' },
] as const;
const VERIFIER_PASSWORD = 'Parent-Write-Probe-123';
const OWNER_EMAIL = 'verify-parent-write-owner@objectstack.test';

/**
 * The verifier personas' permission sets, authored from the app's own
 * objects. A DETAIL is every probed object and every master above it that is
 * itself controlled by its parent (its rows' access is derived, so it is a
 * detail of the next master); a ROOT is the master each chain ends at, which
 * governs its own rows.
 *
 * - `verify_parent_write_master_all` — the root by the all-records grant
 *   (`modifyAllRecords`), the details read / create / edit / delete: every
 *   write is expected allowed.
 * - `verify_parent_write_detail_only` — the root readable (`viewAllRecords`)
 *   but not editable, the details read / create / edit / delete: every write
 *   is expected refused, by the master.
 * - `verify_parent_write_no_delete` — the root by the all-records grant, the
 *   details read / create / edit: an edit and a create are expected allowed,
 *   and a delete refused by the detail's own permission (the master's
 *   all-records grant widens which rows, never which verbs).
 */
function parentWriteReachPermissionSets(config: any): PermissionSet[] {
  const details = new Set<string>();
  const roots = new Set<string>();
  for (const c of deriveParentWriteReachCases(config)) {
    if (c.excluded || c.notDerivable) continue;
    details.add(c.object);
    c.hops.forEach((h, i) => (i === c.hops.length - 1 ? roots.add(h.master) : details.add(h.master)));
  }
  const set = (name: string, label: string, detail: Record<string, boolean>, root: Record<string, boolean>) =>
    ({
      name,
      label,
      objects: {
        ...Object.fromEntries([...details].map((o) => [o, { ...detail }])),
        ...Object.fromEntries([...roots].map((o) => [o, { ...root }])),
      },
    }) as unknown as PermissionSet;
  const all = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
  const modifyAll = { allowRead: true, allowEdit: true, modifyAllRecords: true };
  return [
    set(VERIFIER_PERSONAS[0].set, 'Verify parent write: master by all-records grant', all, modifyAll),
    set(VERIFIER_PERSONAS[1].set, 'Verify parent write: detail only', all, { allowRead: true, viewAllRecords: true }),
    set(VERIFIER_PERSONAS[2].set, 'Verify parent write: master by all-records grant, no detail delete', {
      allowRead: true, allowCreate: true, allowEdit: true,
    }, modifyAll),
  ];
}

/**
 * The `SecurityPlugin` a parent-write-reach boot needs: the platform defaults,
 * the app's own declared default profile, and the three verifier personas'
 * sets. Registered at boot because a set's definition comes from the registry
 * alone (ADR-0131 D3/D4), exactly as `rlsProbeSecurity` registers the RLS
 * probe's set; a stack booted without it runs the position personas only and
 * reports the verifier personas not run.
 */
export function parentWriteReachSecurity(config: any): SecurityPlugin {
  return new SecurityPlugin({
    ...(appSecurityPluginOptions(config) ?? {}),
    defaultPermissionSets: [...securityDefaultPermissionSets, ...parentWriteReachPermissionSets(config)],
  });
}

// ── The door ────────────────────────────────────────────────────────────────

/** The server's effective permissions for the caller: `GET /auth/me/permissions`, or why it gave none. */
async function effectivePermissions(stack: VerifyStack, token: string): Promise<{ objects?: Record<string, any>; sets: string[]; reason?: string }> {
  try {
    const res = await stack.apiAs(token, 'GET', '/auth/me/permissions');
    const payload = (await res.json().catch(() => undefined)) as { objects?: unknown; permissionSets?: unknown } | undefined;
    const sets = Array.isArray(payload?.permissionSets) ? payload!.permissionSets.map(String) : [];
    if (res.status !== 200 || !payload?.objects || typeof payload.objects !== 'object') {
      return { sets, reason: `GET /auth/me/permissions answered ${res.status}: no effective grants to read` };
    }
    return { objects: payload.objects as Record<string, any>, sets };
  } catch (e) {
    return { sets: [], reason: `GET /auth/me/permissions faulted: ${clip((e as Error)?.message ?? e)}` };
  }
}

/** One write through the engine as the signed-in principal, and what it answered. */
async function write(
  stack: VerifyStack,
  token: string,
  object: string,
  operation: 'insert' | 'update' | 'delete',
  input: Record<string, unknown>,
): Promise<ParentWriteReachAnswer & { id?: string }> {
  try {
    const answered = (await stack.hooks.run(object, operation, input, { as: token })) as { id?: unknown } | boolean | undefined;
    const id = typeof answered === 'object' && answered?.id != null ? String(answered.id) : undefined;
    return { kind: 'written', ...(id ? { id } : {}) };
  } catch (e) {
    const err = e as { code?: unknown; status?: unknown; statusCode?: unknown; details?: any; message?: unknown };
    const status = typeof err?.status === 'number' ? err.status : typeof err?.statusCode === 'number' ? err.statusCode : undefined;
    if (typeof err?.code !== 'string' || (status !== undefined && status >= 500)) {
      return { kind: 'faulted', ...(status !== undefined ? { status } : {}), detail: clip(err?.message ?? e) };
    }
    return {
      kind: 'refused',
      code: err.code,
      ...(status !== undefined ? { status } : {}),
      ...(typeof err.details?.object === 'string' ? { object: err.details.object } : {}),
      ...(typeof err.details?.operation === 'string' ? { operation: err.details.operation } : {}),
      detail: clip(err.message),
    };
  }
}

/** The platform's authorization refusal of `operation` on `object`. */
const deniedFor = (answer: ParentWriteReachAnswer, object: string, operation: string): boolean =>
  answer.kind === 'refused' && answer.code === 'PERMISSION_DENIED' && answer.status === 403
  && answer.object === object && answer.operation === operation;

const plain = (a: ParentWriteReachAnswer): ParentWriteReachAnswer => ({
  kind: a.kind,
  ...(a.status !== undefined ? { status: a.status } : {}),
  ...(a.code !== undefined ? { code: a.code } : {}),
  ...(a.object !== undefined ? { object: a.object } : {}),
  ...(a.operation !== undefined ? { operation: a.operation } : {}),
  ...(a.detail !== undefined && a.kind !== 'written' ? { detail: a.detail } : {}),
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** A `date` / `datetime` value moved `days` later, in the same spelling. */
function laterBy(value: string, days: number): string {
  const at = Date.parse(value);
  if (Number.isNaN(at) || days === 0) return value;
  const moved = new Date(at + days * DAY_MS).toISOString();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? moved.slice(0, 10) : moved;
}

/** The `k`-th distinct value of a sample `base`. */
function vary(base: string | number, k: number): string | number {
  if (typeof base === 'number') return base + k;
  if (/^\d{4}-\d{2}-\d{2}/.test(base)) return laterBy(base, k);
  const at = base.indexOf('@');
  if (at > 0) return `${base.slice(0, at)}-p${k}${base.slice(at)}`;
  if (/^https?:\/\//.test(base)) return `${base.replace(/\/$/, '')}/p${k}`;
  if (/^\+\d+$/.test(base)) return `${base}${k}`;
  return `${base}-p${k}`;
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
 * The smallest record of `objectDef` the CRUD derivation can offer (the
 * unique-scope family's fixture shape): its values for the fields the object
 * REQUIRES, so every optional field takes the app's own default. Each `date` /
 * `datetime` is one day after the one declared before it, and each
 * unique-constrained value is made distinct by `n`.
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

// ── The verdict ─────────────────────────────────────────────────────────────

/** The grant key a verb is read from on the detail's effective permission. */
const GRANT: Record<ParentWriteReachVerb, 'allowEdit' | 'allowDelete' | 'allowCreate'> = {
  edit: 'allowEdit',
  delete: 'allowDelete',
  create: 'allowCreate',
};

/** The engine operation each verb is written as, and named by in a refusal's `details`. */
const OPERATION: Record<ParentWriteReachVerb, 'update' | 'delete' | 'insert'> = {
  edit: 'update',
  delete: 'delete',
  create: 'insert',
};

/**
 * Compare one detail write against the conjunction. The whole verdict of the
 * family is this function: it reads the expectation, the door's answer and
 * whether the record shows the write, and nothing else.
 */
function judge(
  c: ParentWriteReachCase,
  probe: { verb: ParentWriteReachVerb; expected: 'allowed' | 'refused'; why: string },
  answer: ParentWriteReachAnswer,
  /** Whether the record shows the write (`undefined` when it cannot say). */
  landed: boolean | undefined,
): Pick<ParentWriteReachProbeResult, 'outcome' | 'detail'> {
  if (answer.kind === 'faulted') return { outcome: 'failed', detail: `the door faulted: ${answer.status ?? ''} ${answer.detail ?? ''}` };
  if (answer.kind === 'refused') {
    if (!deniedFor(answer, c.object, OPERATION[probe.verb])) {
      return {
        outcome: 'unattributed',
        detail:
          `refused for another reason: ${answer.code}${answer.status ? ` (${answer.status})` : ''}` +
          `${answer.object || answer.operation ? ` naming ${answer.operation ?? '?'} on ${answer.object ?? '?'}` : ''} ${answer.detail ?? ''}`,
      };
    }
    if (landed === true) return { outcome: 'contradicted', detail: `the ${probe.verb} was refused, yet the record shows it landed` };
    if (probe.expected === 'refused') return { outcome: 'held' };
    return { outcome: 'contradicted', detail: `${probe.why}, and the ${probe.verb} was refused (403 PERMISSION_DENIED)` };
  }
  if (landed === false) return { outcome: 'not-run', detail: `the engine answered the ${probe.verb} written, but the record does not show it` };
  if (probe.expected === 'allowed') return { outcome: 'held' };
  return { outcome: 'contradicted', detail: `${probe.why}, and the ${probe.verb} was admitted` };
}

function objectStatus(reaches: ParentWriteReachReach[]): { status: ParentWriteReachObjectStatus; reason?: string } {
  const probes = reaches.flatMap((r) => r.probes);
  if (probes.some((p) => p.outcome === 'contradicted')) return { status: 'contradicted' };
  if (probes.some((p) => p.outcome === 'failed')) return { status: 'failed' };
  const open = probes.filter((p) => p.outcome === 'unattributed' || p.outcome === 'not-run');
  const unmeasured = reaches.filter((r) => r.masterRead === 'unmeasured' || r.masterEdit === 'unmeasured');
  if (open.length > 0 || unmeasured.length > 0 || probes.length === 0) {
    const first = open[0]?.detail ?? unmeasured[0]?.reason;
    return {
      status: 'inconclusive',
      reason: probes.length === 0 && unmeasured.length === 0
        ? 'no probe could be run: no persona reads a master of this object'
        : `${open.length} of ${probes.length} write(s) unattributed or not run, ${unmeasured.length} master(s) unmeasured: ${clip(first, 160)}`,
    };
  }
  return { status: 'proven' };
}

// ── The run ─────────────────────────────────────────────────────────────────

interface RunningPersona extends ParentWriteReachPersona {
  token: string;
  userId: string;
  /** The effective object permissions the server answered for it. */
  objects: Record<string, any>;
}

/**
 * Run the parent-derived write reach family against a live stack: every
 * persona (the three verifier personas, then one per declared position)
 * writes every probed detail object's records through the engine as itself —
 * edit, delete and create — under a master chain another principal owns and
 * one it owns, and each answer is compared with the conjunction. Returns a
 * structured report; a per-object failure is collected, not thrown.
 */
export async function runParentWriteReachProofs(stack: VerifyStack, config: any): Promise<ParentWriteReachReport> {
  const cases = deriveParentWriteReachCases(config);
  const crud = new Map<string, CrudCase>(deriveCrudCases(config).map((c) => [c.object, c]));
  const objectDefs = new Map<string, any>();
  for (const o of declaredCollection(config, 'objects')) if (o?.name) objectDefs.set(o.name, o);
  const hasOwnerColumn = (object: string): boolean => {
    try {
      return 'owner_id' in ((stack.metadata.object(object) as any)?.fields ?? {});
    } catch {
      return false;
    }
  };

  // ── The principals ────────────────────────────────────────────────────────
  const ownerToken = await stack.signUp(OWNER_EMAIL);
  const ownerId = String((await stack.contextFor(ownerToken)).userId);
  const personas: RunningPersona[] = [];
  const notRun: ParentWriteReachPersona[] = [];

  const admit = async (base: ParentWriteReachPersona, token: string): Promise<void> => {
    const userId = String((await stack.contextFor(token)).userId);
    const me = await effectivePermissions(stack, token);
    if (!me.objects) {
      notRun.push({ ...base, status: 'not-run', reason: me.reason });
      return;
    }
    personas.push({ ...base, status: 'run', permissionSets: me.sets, token, userId, objects: me.objects });
  };

  for (const v of VERIFIER_PERSONAS) {
    const base: ParentWriteReachPersona = { name: v.name, kind: 'verifier', label: v.email, status: 'run' };
    try {
      const first = await stack.signUp(v.email, VERIFIER_PASSWORD);
      const userId = (await stack.contextFor(first)).userId;
      // [ADR-0131 D4] The grant names its set; the set itself is registered at
      // boot by `parentWriteReachSecurity`, never written as a row.
      await stack.seed('sys_user_permission_set', [{ user_id: userId, permission_set: v.set }]);
      const token = await stack.signIn(v.email, VERIFIER_PASSWORD);
      const me = await effectivePermissions(stack, token);
      if (!me.sets.includes(v.set)) {
        notRun.push({
          ...base,
          status: 'not-run',
          reason:
            `the grant names ${v.set}, and the server does not resolve it for the persona: boot the stack with ` +
            '`parentWriteReachSecurity(config)`, which registers it (a grant naming an unregistered set confers nothing)',
        });
        continue;
      }
      await admit(base, token);
    } catch (e) {
      notRun.push({ ...base, status: 'not-run', reason: clip((e as Error)?.message ?? e) });
    }
  }
  for (const position of declaredPositionNames(config)) {
    const email = `verify-parent-write-pos-${position.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}@objectstack.test`;
    const base: ParentWriteReachPersona = { name: `position:${position}`, kind: 'position', label: email, status: 'run' };
    try {
      const p = await provisionRlsPositionPersona(stack, position, { email });
      await admit(base, p.token);
    } catch (e) {
      notRun.push({ ...base, status: 'not-run', reason: clip((e as Error)?.message ?? e) });
    }
  }

  // ── Fixtures: through the seed door, as system, owned as each probe needs ──
  let counter = 0;
  const bases = new Map<string, { id?: string; reason?: string }>();

  async function seedRecord(object: string, overrides: Record<string, unknown>, owner: string): Promise<{ id?: string; reason?: string }> {
    const c = crud.get(object);
    if (!c || c.blocked) return { reason: c?.blocked ?? `object ${object} is not derived` };
    const ids = new Map<string, string>();
    for (const ref of c.relationalRefs ?? []) {
      if (!ref.required || ref.field in overrides) continue;
      const dep = await baseRecord(ref.target);
      if (!dep.id) return { reason: `required relation ${ref.field} → ${ref.target}: ${dep.reason}` };
      ids.set(ref.target, dep.id);
    }
    const refs = (c.relationalRefs ?? []).filter((r) => !(r.field in overrides));
    const { body, missing } = fillRelationalRefs({ ...c, relationalRefs: refs }, ids);
    if (missing) return { reason: missing };
    const row = { ...fixtureBody(body, objectDefs.get(object), ++counter), ...overrides, ...(hasOwnerColumn(object) ? { owner_id: owner } : {}) };
    try {
      const [written] = await stack.seed(object, [row]);
      return written?.id != null ? { id: String(written.id) } : { reason: `the seed of ${object} returned no id` };
    } catch (e) {
      const err = e as { code?: unknown; message?: unknown };
      return { reason: `the seed of ${object} was refused: ${typeof err?.code === 'string' ? `${err.code} ` : ''}${clip(err?.message, 160)}` };
    }
  }

  async function baseRecord(object: string): Promise<{ id?: string; reason?: string }> {
    const known = bases.get(object);
    if (known) return known;
    bases.set(object, { reason: `the base ${object} record is being created` });
    const made = await seedRecord(object, {}, ownerId);
    bases.set(object, made);
    return made;
  }

  /** The master chain, root first, every record owned by `owner`; returns the immediate master's id. */
  async function seedChain(c: ParentWriteReachCase, owner: string): Promise<{ id?: string; reason?: string }> {
    let parent: string | undefined;
    for (let i = c.hops.length - 1; i >= 0; i--) {
      const object = c.hops[i]!.master;
      const above = c.hops[i + 1];
      const made = await seedRecord(object, above ? { [above.field]: parent } : {}, owner);
      if (!made.id) return { reason: `the master chain's ${object} record: ${made.reason}` };
      parent = made.id;
    }
    return { id: parent };
  }

  const row = async (object: string, id: string) => (await stack.rows(object, { id }))[0];

  // ── Probes ────────────────────────────────────────────────────────────────
  const results: ParentWriteReachObjectResult[] = [];
  for (const c of cases) {
    if (c.excluded) {
      results.push({ object: c.object, hops: c.hops, status: 'excluded', reason: c.excluded, reaches: [] });
      continue;
    }
    if (c.notDerivable) {
      results.push({ object: c.object, hops: c.hops, status: 'not-derivable', reason: c.notDerivable, reaches: [] });
      continue;
    }
    const { field, master } = c.hops[0]!;
    const root = c.hops[c.hops.length - 1]!.master;
    const detailOwnerColumn = hasOwnerColumn(c.object);
    const reaches: ParentWriteReachReach[] = [];
    const othersChain = await seedChain(c, ownerId);

    for (const p of personas) {
      const entry = p.objects?.[c.object];
      const grants: Record<ParentWriteReachVerb, boolean> = {
        edit: objectPermissionGrants(entry, GRANT.edit),
        delete: objectPermissionGrants(entry, GRANT.delete),
        create: objectPermissionGrants(entry, GRANT.create),
      };
      for (const masters of ['other', 'own'] as const) {
        const reach: ParentWriteReachReach = { persona: p.name, masters, masterRead: 'unmeasured', probes: [] };
        reaches.push(reach);
        if (masters === 'own' && !hasOwnerColumn(root)) {
          reach.reason = `${root} has no owner column, so no principal owns a master chain of ${c.object}`;
          reach.masterRead = 'unreadable';
          continue;
        }
        const chain = masters === 'other' ? othersChain : await seedChain(c, p.userId);
        if (!chain.id) {
          reach.reason = chain.reason;
          continue;
        }
        const masterId = chain.id;

        // The measured half: can this persona read, then edit, the master?
        let readable: boolean | undefined;
        try {
          readable = (await stack.rows(master, { id: masterId }, { as: p.token })).length > 0;
        } catch (e) {
          const err = e as { code?: unknown; message?: unknown };
          if (err?.code === 'PERMISSION_DENIED') readable = false;
          else reach.reason = `the read of ${master} as the persona faulted: ${clip(err?.message ?? e, 160)}`;
        }
        if (readable === undefined) continue;
        if (!readable) {
          reach.masterRead = 'unreadable';
          reach.reason =
            `the persona's read of ${master} returns no row: the master is outside its read reach, so its details are ` +
            "too (a write to a record the caller cannot read is the RLS family's subject)";
          continue;
        }
        reach.masterRead = 'readable';
        const edit = await write(stack, p.token, master, 'update', { id: masterId });
        reach.masterAnswer = plain(edit);
        reach.masterEdit = edit.kind === 'written' ? 'editable' : deniedFor(edit, master, 'update') ? 'not-editable' : 'unmeasured';
        reach.grants = grants;
        if (reach.masterEdit === 'unmeasured') {
          reach.reason = `the empty update of ${master} answered ${edit.code ?? edit.kind}, not a write gate's verdict on it: its edit reach could not be measured`;
          continue;
        }

        const expect = (verb: ParentWriteReachVerb) => {
          const holds = grants[verb];
          const editable = reach.masterEdit === 'editable';
          return {
            verb,
            expected: holds && editable ? ('allowed' as const) : ('refused' as const),
            why:
              `the persona ${holds ? 'holds' : 'lacks'} ${GRANT[verb]} on ${c.object} and ` +
              `${editable ? 'edited' : 'was refused an edit of'} its master ${master}`,
          };
        };

        for (const detailOwner of detailOwnerColumn ? (['other', 'own'] as const) : (['other'] as const)) {
          const d = await seedRecord(c.object, { [field]: masterId }, detailOwner === 'own' ? p.userId : ownerId);
          if (!d.id) {
            for (const verb of ['edit', 'delete'] as const) {
              const e = expect(verb);
              reach.probes.push({ verb, detailOwner, expected: e.expected, outcome: 'not-run', detail: `the detail record: ${d.reason}` });
            }
            continue;
          }
          {
            const e = expect('edit');
            const before = await row(c.object, d.id);
            const answer = await write(stack, p.token, c.object, 'update', { id: d.id });
            const after = await row(c.object, d.id);
            const stamp = before && 'updated_at' in before ? after?.updated_at !== before.updated_at : undefined;
            reach.probes.push({ verb: 'edit', detailOwner, expected: e.expected, answer: plain(answer), ...judge(c, e, answer, stamp) });
          }
          {
            const e = expect('delete');
            const answer = await write(stack, p.token, c.object, 'delete', { id: d.id });
            const gone = !(await row(c.object, d.id));
            reach.probes.push({ verb: 'delete', detailOwner, expected: e.expected, answer: plain(answer), ...judge(c, e, answer, gone) });
          }
        }
        {
          const e = expect('create');
          const cc = crud.get(c.object)!;
          const ids = new Map<string, string>();
          let reason: string | undefined;
          for (const ref of cc.relationalRefs ?? []) {
            if (!ref.required || ref.field === field) continue;
            const dep = await baseRecord(ref.target);
            if (!dep.id) {
              reason = `required relation ${ref.field} → ${ref.target}: ${dep.reason}`;
              break;
            }
            ids.set(ref.target, dep.id);
          }
          if (reason) {
            reach.probes.push({ verb: 'create', expected: e.expected, outcome: 'not-run', detail: reason });
          } else {
            const refs = (cc.relationalRefs ?? []).filter((r) => r.field !== field);
            const { body } = fillRelationalRefs({ ...cc, relationalRefs: refs }, ids);
            const answer = await write(stack, p.token, c.object, 'insert', {
              ...fixtureBody(body, objectDefs.get(c.object), ++counter),
              [field]: masterId,
            });
            const made = answer.kind === 'written' && answer.id ? await row(c.object, answer.id) : undefined;
            const landed = answer.kind === 'written' ? made !== undefined && String(made?.[field]) === masterId : undefined;
            reach.probes.push({ verb: 'create', expected: e.expected, answer: plain(answer), ...judge(c, e, answer, landed) });
          }
        }
      }
    }
    results.push({ object: c.object, hops: c.hops, ...objectStatus(reaches), reaches });
  }

  const all = results.flatMap((r) => r.reaches.flatMap((x) => x.probes));
  const allReaches = results.flatMap((r) => r.reaches);
  const count = (s: ParentWriteReachObjectStatus) => results.filter((r) => r.status === s).length;
  const reported: ParentWriteReachPersona[] = [
    ...personas.map((p) => ({
      name: p.name,
      kind: p.kind,
      label: p.label,
      status: p.status,
      ...(p.permissionSets ? { permissionSets: p.permissionSets } : {}),
    })),
    ...notRun,
  ];
  return {
    app: config?.manifest?.id ?? config?.manifest?.namespace ?? 'app',
    door: 'user',
    personas: reported,
    results,
    summary: {
      objects: results.length,
      probed: results.filter((r) => r.status !== 'excluded' && r.status !== 'not-derivable').length,
      proven: count('proven'),
      contradicted: count('contradicted'),
      failed: count('failed'),
      inconclusive: count('inconclusive'),
      excluded: count('excluded'),
      notDerivable: count('not-derivable'),
      personas: { run: personas.length, notRun: notRun.length },
      reaches: {
        probed: allReaches.filter((r) => r.probes.length > 0).length,
        unreadable: allReaches.filter((r) => r.masterRead === 'unreadable').length,
        unmeasured: allReaches.filter((r) => r.masterRead === 'unmeasured' || r.masterEdit === 'unmeasured').length,
      },
      probes: {
        edit: all.filter((p) => p.verb === 'edit').length,
        delete: all.filter((p) => p.verb === 'delete').length,
        create: all.filter((p) => p.verb === 'create').length,
      },
      held: all.filter((p) => p.outcome === 'held').length,
      contradictions: all.filter((p) => p.outcome === 'contradicted').length,
      unattributed: all.filter((p) => p.outcome === 'unattributed').length,
      faults: all.filter((p) => p.outcome === 'failed').length,
      notRun: all.filter((p) => p.outcome === 'not-run').length,
      hardFailures: count('contradicted') + count('failed') + notRun.length,
    },
  };
}

/** Pretty one-line-per-object summary for logs. */
export function formatParentWriteReachReport(report: ParentWriteReachReport): string {
  const lines: string[] = [`\n=== objectstack verify — parent-derived write reach — ${report.app} ===`];
  lines.push('  door: the engine write as each persona (insert, update and delete by id); the system door bypasses authorization and is not asked');
  const ran = report.personas.filter((p) => p.status === 'run');
  lines.push(`  personas: ${ran.map((p) => p.name).join(', ') || 'none'}`);
  for (const p of report.personas.filter((x) => x.status === 'not-run')) {
    lines.push(`  ⛔ persona ${p.name} NOT RUN — ${p.reason ?? ''}`);
  }
  for (const r of report.results) {
    const chain = r.hops.length > 0 ? ` (${r.hops.map((h) => `${h.object}.${h.field} → ${h.master}`).join(', ')})` : '';
    const probes = r.reaches.flatMap((x) => x.probes.map((p) => ({ ...p, persona: x.persona, masters: x.masters })));
    if (r.status === 'proven') {
      lines.push(`  ✓ ${r.object}${chain}  held on ${probes.length} write(s)`);
    } else if (r.status === 'contradicted' || r.status === 'failed') {
      const bad = probes.filter((p) => p.outcome === (r.status === 'contradicted' ? 'contradicted' : 'failed'));
      lines.push(`  ✗ ${r.object}${chain}  ${r.status === 'contradicted' ? 'CONTRADICTED' : 'FAULTED'} on ${bad.length} of ${probes.length} write(s):`);
      for (const p of bad.slice(0, 12)) {
        lines.push(
          `      ${p.persona}, masters ${p.masters === 'own' ? 'its own' : "another's"}, ${p.verb}` +
            `${p.detailOwner ? ` (detail ${p.detailOwner === 'own' ? 'its own' : "another's"})` : ''}: ${clip(p.detail, 220)}`,
        );
      }
      if (bad.length > 12) lines.push(`      … and ${bad.length - 12} more`);
    } else if (r.status === 'inconclusive') {
      lines.push(`  ~ ${r.object}${chain}  inconclusive: ${r.reason ?? ''}`);
    } else {
      lines.push(`  – ${r.object}${chain}  ${r.status}: ${r.reason ?? ''}`);
    }
  }
  const s = report.summary;
  lines.push(
    `  ── ${s.proven} proven, ${s.contradicted} CONTRADICTED, ${s.failed} FAILED, ${s.inconclusive} inconclusive, ` +
      `${s.excluded} excluded, ${s.notDerivable} not derivable ` +
      `(${s.personas.run} persona(s) run, ${s.personas.notRun} not run; ${s.reaches.probed} reach(es) probed, ` +
      `${s.reaches.unreadable} outside read reach, ${s.reaches.unmeasured} unmeasured; ` +
      `writes: ${s.probes.edit} edit, ${s.probes.delete} delete, ${s.probes.create} create — ${s.held} held, ` +
      `${s.contradictions} contradicted, ${s.unattributed} unattributed, ${s.faults} faulted, ${s.notRun} not run)`,
  );
  return lines.join('\n');
}
