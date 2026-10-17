// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The parent-record read gate: a row about a record is readable when that
 * record is readable. One mechanism for the two append-only streams in this
 * package that name their parent in the ADR-0052 §5 ActivityPointer pair
 * (`object_name`, `record_id`):
 *
 *  - the activity stream's gate (`activity-read-visibility.ts`);
 *  - the compliance ledger's gate (`audit-log-read-visibility.ts`).
 *
 * Both are written once, as the system, and read by many callers. Neither
 * object has an owner column, and the parent is a different object on every
 * row, so neither OWD/sharing nor RLS can narrow them.
 *
 * ⛔ Nothing here derives readability. "Can this caller read that record" is
 * answered by the engine and the security service, through one of two
 * mechanisms this module chooses between per parent object, up front.
 *
 * ## The leaf (ADR-0139 D4): one branch per parent object, no pre-scan
 *
 * The parent objects are enumerated from the metadata registry: every
 * registered object outside the audit writer's `AUDIT_EXCLUDED_OBJECTS` (the
 * CRUD mirror writes no row about one) and outside the gated object itself,
 * plus the parents a gate declares its other producers name
 * ({@link ParentRecordGate.namedParents}). For each, one branch:
 *
 *     { object_name: P, record_id: { $in: ReadableIds.of(P) } }
 *
 * ORed together and ANDed into the read's `where`. The leaf means "the ids of
 * P this caller may read"; the engine composes it at its executor boundary
 * from the security service's `canReadObject` and `getReadFilter` for P
 * (ADR-0139 D2), and the driver evaluates it as one subquery against P's
 * table inside its own tenant wall (D3). So a list, its `total` and a grouped
 * count are one statement each, over every row the caller may read, on any
 * table size: there is no candidate window.
 *
 * A read whose own `where` names the parents its rows are about
 * ({@link namedParentObjects}: an equality or an `$in` on `object_name`,
 * ANDed in at the top) enumerates only the ones it names. A parent it does not
 * name is one no row of the read can be about, so its branch could select
 * nothing: the read answers the same rows through fewer branches, and the
 * bounded probe below reads only the named parents of its classes. A read of
 * any other shape keeps every branch.
 *
 * Rows the leaf excludes, exactly as the probe below does: a row naming no
 * parent or a non-machine name, an object this gate does not enumerate, the
 * gated object itself, or a parent that no longer exists (the subquery finds
 * no such id). A parent object the caller may not read is answered `$in: []`
 * by the engine's own `canReadObject` admission, before anything of that
 * object is read: no caller-scoped read of it happens, so its middleware
 * logs no denial for it.
 *
 * ## The bounded probe (ADR-0139 D5): three classes, by name, chosen up front
 *
 * The engine refuses to compose a leaf for three classes (`INTERNAL_ERROR` /
 * 500). This module routes each to the bounded probe BEFORE any leaf is
 * written — ⛔ never by catching that refusal:
 *
 *  1. **A delegated (on-behalf-of) caller** (ADR-0090 D10): the security
 *     service's read scope does not carry the delegator intersection, so no
 *     leaf is written at all; the whole read is the probe.
 *  2. **A parent an object-scoped read middleware narrows**
 *     (`hasObjectMiddleware`): its WHERE is built at read time and is no part
 *     of its read scope, so a leaf would be wider than a direct read.
 *  3. **A federated parent**, bound to another datasource than the gated
 *     object (`resolveEffectiveDatasource`): no driver evaluates a subquery
 *     across two datasources. On a deployment that registers the `telemetry`
 *     datasource, that is every parent of a ledger the lifecycle split routes
 *     there.
 *
 * Two more states send the WHOLE read to the probe, up front, and the gate
 * says so once for each:
 *
 *  - an engine that cannot answer those questions (no registry view, no
 *    `hasObjectMiddleware`, no `resolveEffectiveDatasource` — each optional on
 *    its contract) cannot tell a composable parent from a refused one;
 *  - a security service that answers no `canReadObject` (optional on
 *    `ISecurityService`), or no security service at all. The engine then
 *    admits a leaf's parent by `explain`, which answers a SYSTEM context "not
 *    allowed" (it explains a principal's access) where `canReadObject` admits
 *    it. This stream's withheld-update rule (`activity-field-redaction.ts`)
 *    re-reads the WHERE this gate writes as SYSTEM, so a leaf there would
 *    select nothing, and that rule would serve the update rows it never saw —
 *    rows whose every recorded change is withheld from the reader (measured
 *    on the real security plugin with `canReadObject` withdrawn). The probe's
 *    literal id lists mean the same thing under every context. With no
 *    security service, a leaf would select nothing for any caller.
 *
 * The probe, for the parents it is given (or for every row, for a whole-read
 * probe): pre-scan the parent pairs the query would touch under SYSTEM
 * context (bounded at {@link PARENT_GATE_SCAN_LIMIT}, in the caller's own
 * order), ask which of those parent OBJECTS the caller may read at all (the
 * security service's object-level read admission — see "A skipped object is
 * not an access attempt" below), ask which of those parents the caller can read
 * ({@link resolveReadableParentIds}: one caller-scoped read per admitted
 * parent object, never one per row), and emit one branch per parent object:
 *
 *     { object_name: OBJECT, record_id: { $in: READABLE_IDS } }
 *
 * Beyond the bound the probe fails CLOSED: the un-scanned rows are excluded,
 * and a warning says so. A probe that throws denies the whole read, and says
 * so. Restricted to the parents of classes 2 and 3, its window holds only the
 * rows naming those parents.
 *
 * ## What the read's own refusal does (ADR-0139 D3)
 *
 * A leaf is composed AFTER this gate hands the read on (`next()`), at the
 * engine's executor boundary, so a composition or driver refusal is the read's
 * own failure: it propagates to the caller and says why. ⛔ No consumer of
 * this module catches it into its deny-all sentinel; this module makes no
 * engine call for a leaf branch, so nothing it does can meet one.
 *
 * ## The outside class and the exemption
 *
 * The one declared exception is a gate's {@link ParentRecordGate.outsideClass}:
 * rows that name NO record and that the gate states are not about one. It is a
 * plain predicate on the gated object's own columns, ORed in beside the parent
 * branches, so it is evaluated by the driver like any filter, unbounded. A
 * gate that declares none (the activity stream) excludes those rows.
 *
 * The one declared exemption is a gate's
 * {@link ParentRecordGate.exemptCapability}: a caller holding that capability
 * is not narrowed by the gate at all, decided before anything else — nothing
 * is enumerated and nothing ANDed in. Only this gate is skipped: the object's
 * own grant, the other read seams on it (a field redaction, a query guard) and
 * every other gate still apply. Held means the caller's resolved
 * `systemPermissions`, the one capability set the request's authorization
 * resolver stamps on the execution context and every other capability check
 * reads. A gate that declares none (the activity stream) exempts no caller.
 *
 * ## A skipped object is not an access attempt
 *
 * The streams name many parent objects — every platform object the CRUD
 * mirror writes — and a caller typically holds no object-level read on most of
 * them. Read as the caller, each such object is refused by plugin-security's
 * middleware, which logs every refusal at WARN: one line per object per read,
 * twice for a list (its rows and its `total`), on every page that shows the
 * activity feed. Those lines are not access attempts — the gate excluding
 * those rows is the expected answer — and they buried the real denials.
 *
 * A leaf never reads its parent as the caller: the engine asks
 * `canReadObject` and answers a refused object `$in: []` without a read. The
 * probe asks the same question first, through the security service's
 * `canReadObject` (`ISecurityService`, `@objectstack/spec`) — the middleware's
 * own object-level read gate, arm for arm (its capability AND-gate, its CRUD
 * grant, its fail-closed posture and principal arms), which answers without
 * logging or throwing — and reads only the objects it admits. An object it
 * refuses contributes no readable id, exactly as its refused engine read did,
 * so the emitted WHERE and the rows served are unchanged; it is just never
 * read. ⛔ It is asked with the caller's own envelope (minus the
 * operation-private keys, as {@link resolveReadableParentIds} sends it): no
 * second derivation of authority, and no muting of the middleware's log — a
 * caller's own read of that object still logs its denial once.
 *
 * The admission only ever NARROWS what the probe reads: an admitted object is
 * still read as the caller, and that read still decides row scope, sharing,
 * RLS and every gate the middleware runs after its object-level arms. Fails
 * CLOSED: an admission that throws, or answers anything but `true`, refuses
 * that object. With no security service composed, or one whose contract omits
 * the optional `canReadObject`, there is no admission to ask, and every probed
 * parent object is read as the caller: the engine's middleware still decides,
 * so the absence can leave the answer only as it is, never widen it. (A leaf
 * with no usable security service is answered `$in: []` by the engine: fail
 * closed, said once by the engine.)
 */

import { resolveReadableParentIds, withoutOperationPrivateKeys } from '@objectstack/core';
import type {
  EngineSchemaRegistryView,
  IDataEngine,
  IObjectQLEngine,
  ISecurityService,
  SecurityContext,
} from '@objectstack/spec/contracts';
import { ReadableIds } from '@objectstack/spec/data';
import { AUDIT_EXCLUDED_OBJECTS } from './audit-writers.js';
import {
  type CommentAccessEngine,
  type CommentAccessLogger,
  type CommentReadMiddlewareCtx,
} from './comment-access-hooks.js';

/**
 * The single member of the security service's contract the probe consults: the
 * object-level read admission. OPTIONAL on the contract, so the gate handles
 * its absence by construction (see the module header).
 */
export type ParentObjectReadAdmission = Pick<ISecurityService, 'canReadObject'>;

/**
 * Resolves the security service on every read: the security plugin may
 * register after this one, and a resolver captured at install time would pin
 * "no service" for the life of the process.
 */
export type ParentObjectReadAdmissionSource = () => ParentObjectReadAdmission | null | undefined;

/**
 * The engine a parent-record gate reads through: the comment gate's slice,
 * plus the three questions that decide, per parent object, between a leaf and
 * the probe (ADR-0139 D5). Each is optional on its contract; without all
 * three the gate cannot tell a composable parent from a refused one.
 */
export type ParentRecordGateEngine = CommentAccessEngine & {
  /** The registry the parent objects are enumerated from. */
  registry?: Pick<EngineSchemaRegistryView, 'getAllObjects'>;
} & Partial<Pick<IObjectQLEngine, 'hasObjectMiddleware'>> &
  Partial<Pick<IDataEngine, 'resolveEffectiveDatasource'>>;

/** The engine reads a parent-record read gate answers for. */
export const PARENT_GATE_READ_OPS: ReadonlySet<string> = new Set(['find', 'findOne', 'count', 'aggregate']);

/** Bound on the probe's per-read candidate pre-scan — the comment gate's bound.
 * Beyond it the probe fails CLOSED (the un-scanned rows are excluded, never
 * leaked). The leaf has no bound. */
export const PARENT_GATE_SCAN_LIMIT = 2_000;

/**
 * Why a parent object is read through the bounded probe and not as a
 * `ReadableIds` leaf — ADR-0139 D5's three classes, by name, plus the engine
 * that cannot tell. Every value is decided before any leaf is written.
 */
export type ParentProbeClass =
  /** D5.1 — an on-behalf-of caller: the whole read is the probe. */
  | 'delegated-caller'
  /** D5.2 — an object-scoped read middleware narrows this parent. */
  | 'object-middleware'
  /** D5.3 — this parent is bound to another datasource than the gated object. */
  | 'federated-parent'
  /** The engine exposes no registry view, `hasObjectMiddleware` or
   * `resolveEffectiveDatasource`: the whole read is the probe. */
  | 'engine-cannot-classify'
  /** The security service answers no `canReadObject`, or none is composed:
   * the whole read is the probe (module header). */
  | 'no-object-admission';

/**
 * How one read reaches its parents: the parent objects written as leaves, and
 * the ones the probe reads, each with its class — or the one class that sends
 * the whole read to the probe.
 */
export type ParentReadPlan =
  | { probeWholeRead: 'delegated-caller' | 'engine-cannot-classify' | 'no-object-admission' }
  | {
      probeWholeRead: null;
      /** One `ReadableIds` leaf each, in name order. */
      leaves: string[];
      /** Read through the probe, each with its D5 class, in name order. */
      probed: Map<string, 'object-middleware' | 'federated-parent'>;
    };

const SYSTEM_CTX = { isSystem: true } as const;

/** Object machine-name shape (`ObjectSchema.name` in packages/spec). */
const OBJECT_NAME_RE = /^[a-z_][a-z0-9_]*$/;

/** The columns the probe pre-scans: the parent pair. */
const PARENT_COLUMNS = ['object_name', 'record_id'] as const;

/** The record a row is about. */
export interface ParentRecord {
  object: string;
  recordId: string;
}

/**
 * The rows of a gated object that name no record and are not about one, so
 * the record gate has nothing to judge them by.
 */
export interface OutsideClassRows {
  /**
   * The class as a WHERE on the gated object's own columns. A factory: every
   * read gets a fresh tree, so nothing downstream can edit a shared one.
   */
  where(): Record<string, unknown>;
}

/** What one gate is: its object, its log label, its sentinel and its class. */
export interface ParentRecordGate {
  /** The gated object. */
  object: string;
  /** Names the gate in its log lines. */
  seam: string;
  /** No real row matches it — the fail-closed answer. */
  denyAll: Readonly<Record<string, unknown>>;
  /** Absent: every row that names no parent record is excluded. */
  outsideClass?: OutsideClassRows;
  /**
   * A capability whose holder this gate does not narrow. Absent: no caller is
   * exempt. Must name a capability the platform declares and grants
   * deliberately; the ledger's is pinned against `PLATFORM_CAPABILITIES`.
   */
  exemptCapability?: string;
  /**
   * Parent objects inside `AUDIT_EXCLUDED_OBJECTS` that a producer of this
   * gate's rows OTHER than the CRUD mirror names, measured per writer. They are
   * enumerated like any parent, so a row about one is served exactly when its
   * record is readable. Absent: the gate's rows come from the mirror alone.
   */
  namedParents?: readonly string[];
}

/**
 * Whether the caller holds `capability`: its resolved `systemPermissions`, as
 * the request's authorization resolver stamped them on the execution context.
 * Absent, or not a list, is not held.
 */
function callerHoldsCapability(context: CommentReadMiddlewareCtx['context'], capability: string): boolean {
  const held = context?.systemPermissions;
  return Array.isArray(held) && held.includes(capability);
}

/**
 * The parent OBJECT a row of `gatedObject` names, or `null` when it names none
 * a gate can authorize.
 */
export function parseParentObject(
  row: Record<string, unknown> | null | undefined,
  gatedObject: string,
): string | null {
  const object = row?.object_name;
  if (typeof object !== 'string' || !OBJECT_NAME_RE.test(object)) return null;
  if (object === gatedObject) return null;
  return object;
}

/**
 * The parent record a row of `gatedObject` names, or `null` when it names none
 * a gate can authorize — which every gate treats as DENY unless the row is
 * declared outside its class.
 */
export function parseParentRecord(
  row: Record<string, unknown> | null | undefined,
  gatedObject: string,
): ParentRecord | null {
  const object = parseParentObject(row, gatedObject);
  const recordId = row?.record_id;
  if (object === null) return null;
  if (typeof recordId !== 'string' && typeof recordId !== 'number') return null;
  if (String(recordId) === '') return null;
  return { object, recordId: String(recordId) };
}

/**
 * Whether `context` reads on behalf of another user (ADR-0090 D10) — the
 * engine's own test for D5's first class, so the two agree by construction.
 */
function isDelegatedCaller(context: CommentReadMiddlewareCtx['context']): boolean {
  return Boolean((context as { onBehalfOf?: { userId?: unknown } } | undefined)?.onBehalfOf?.userId);
}

/** The machine names a comparand on `object_name` confines a row to, or `null` for a shape not read. */
function confinedObjectNames(comparand: unknown): string[] | null {
  const machineName = (v: unknown): v is string => typeof v === 'string' && OBJECT_NAME_RE.test(v);
  if (typeof comparand === 'string') return machineName(comparand) ? [comparand] : null;
  if (typeof comparand !== 'object' || comparand === null || Array.isArray(comparand)) return null;
  const operators = Object.keys(comparand);
  if (operators.length !== 1) return null;
  const operand = (comparand as Record<string, unknown>)[operators[0]];
  if (operators[0] === '$eq') return machineName(operand) ? [operand] : null;
  if (operators[0] === '$in') return Array.isArray(operand) && operand.every(machineName) ? [...operand] : null;
  return null;
}

/**
 * [ADR-0139 D4] The parent objects a read's own `where` confines its rows to,
 * or `null` when it confines them to no set this can prove — and then every
 * enumerated parent keeps its branch.
 *
 * A confinement is a conjunct every row the read can match satisfies: a key of
 * the root condition, or of a condition inside a root `$and` (at any depth of
 * `$and`). Of those, three shapes on `object_name` are read: a plain value,
 * `{ $eq: V }` and `{ $in: [V, …] }`, each the only key of its comparand and
 * each `V` a machine name. Two distinct machine names (lowercase ASCII letters,
 * digits, `_`) compare unequal under every collation and coercion a driver
 * applies, so no row matches both a named value and the branch of a parent the
 * read does not name; a value of any other spelling (another case, a padded
 * string, a number) could, so its conjunct is not read. Several confinements
 * intersect. Anything else — an `$or`, a `$not`, any other operator — is passed
 * over: it is still a conjunct of the read, so it can only narrow the rows
 * further, and the set stays an over-approximation of the parents they name.
 */
export function namedParentObjects(where: unknown): ReadonlySet<string> | null {
  let named: Set<string> | null = null;
  const walk = (condition: unknown): void => {
    if (typeof condition !== 'object' || condition === null || Array.isArray(condition)) return;
    for (const [key, value] of Object.entries(condition)) {
      if (key === '$and' && Array.isArray(value)) {
        for (const sub of value) walk(sub);
        continue;
      }
      if (key !== 'object_name') continue;
      const confined = confinedObjectNames(value);
      if (confined === null) continue;
      const before: Set<string> | null = named;
      named = new Set(before === null ? confined : confined.filter((name) => before.has(name)));
    }
  };
  walk(where);
  return named;
}

/**
 * The parent objects one gate enumerates, in name order: every registered
 * object outside `AUDIT_EXCLUDED_OBJECTS` and outside the gated object, plus
 * the gate's {@link ParentRecordGate.namedParents} — `null` when the engine
 * exposes no registry view to enumerate.
 *
 * Given one read's own `where` (before any gate ANDs into it), only those the
 * read names ({@link namedParentObjects}), when it names any: a parent it does
 * not name is one no row of that read can be about.
 */
export function enumerateParentObjects(
  engine: ParentRecordGateEngine,
  gate: ParentRecordGate,
  where?: unknown,
): string[] | null {
  const getAllObjects = engine.registry?.getAllObjects;
  if (typeof getAllObjects !== 'function') return null;
  // Read at call time, never at module load: `audit-writers.ts` sits on an
  // import cycle with this module's consumers.
  const excluded = new Set<string>(AUDIT_EXCLUDED_OBJECTS);
  for (const named of gate.namedParents ?? []) excluded.delete(named);
  const readNames = namedParentObjects(where);
  const names = new Set<string>();
  for (const schema of getAllObjects.call(engine.registry) ?? []) {
    const name = (schema as { name?: unknown } | null | undefined)?.name;
    if (typeof name !== 'string' || !OBJECT_NAME_RE.test(name)) continue;
    if (name === gate.object || excluded.has(name)) continue;
    if (readNames !== null && !readNames.has(name)) continue;
    names.add(name);
  }
  return [...names].sort();
}

/**
 * [ADR-0139 D4, D5] How one read of `gate.object` by `context` reaches its
 * parents. Reads the context, whether the security service answers
 * `canReadObject` (`objectAdmission`, resolved by the caller), the read's own
 * `where` (the parents it names), the registry, the middleware registrations
 * and the datasource bindings only — it asks the security service nothing and
 * reads no row, so it decides the probe up front, never by catching a refusal.
 */
export function planParentReads(
  engine: ParentRecordGateEngine,
  gate: ParentRecordGate,
  context: CommentReadMiddlewareCtx['context'],
  objectAdmission: boolean,
  where?: unknown,
): ParentReadPlan {
  if (isDelegatedCaller(context)) return { probeWholeRead: 'delegated-caller' };
  if (!objectAdmission) return { probeWholeRead: 'no-object-admission' };
  const parents = enumerateParentObjects(engine, gate, where);
  const hasObjectMiddleware = engine.hasObjectMiddleware;
  const datasourceOf = engine.resolveEffectiveDatasource;
  if (parents === null || typeof hasObjectMiddleware !== 'function' || typeof datasourceOf !== 'function') {
    return { probeWholeRead: 'engine-cannot-classify' };
  }
  // `undefined` is "rides the default driver", for the gated object and a
  // parent alike: two `undefined`s are one datasource, and an explicit binding
  // to the default driver's own name reads as another one, which sends that
  // parent to the probe — the bound, never a refused read.
  const outer = datasourceOf.call(engine, gate.object);
  const leaves: string[] = [];
  const probed = new Map<string, 'object-middleware' | 'federated-parent'>();
  for (const parent of parents) {
    if (hasObjectMiddleware.call(engine, parent)) probed.set(parent, 'object-middleware');
    else if (datasourceOf.call(engine, parent) !== outer) probed.set(parent, 'federated-parent');
    else leaves.push(parent);
  }
  return { probeWholeRead: null, leaves, probed };
}

/** The whole-read probe states a gate has already reported, per engine and seam. */
const wholeReadProbeReported = new WeakMap<object, Set<string>>();

const WHOLE_READ_PROBE_WHY: Readonly<Record<'engine-cannot-classify' | 'no-object-admission', string>> = {
  'engine-cannot-classify':
    'the engine exposes no registry view, hasObjectMiddleware() or resolveEffectiveDatasource(), so it cannot ' +
    'say which parent objects a ReadableIds leaf can be composed for',
  'no-object-admission':
    'the security service answers no canReadObject() (or none is registered), so a ReadableIds leaf would be ' +
    'admitted by explain(), which refuses the SYSTEM re-read of this WHERE that the withheld-update rule makes',
};

function reportWholeReadProbeOnce(
  engine: object,
  logger: CommentAccessLogger,
  gate: ParentRecordGate,
  why: 'engine-cannot-classify' | 'no-object-admission',
): void {
  let reported = wholeReadProbeReported.get(engine);
  if (!reported) wholeReadProbeReported.set(engine, (reported = new Set()));
  const key = `${gate.seam} :: ${why}`;
  if (reported.has(key)) return;
  reported.add(key);
  logger.warn(
    `[audit] ${gate.seam}: ${WHOLE_READ_PROBE_WHY[why]}: every read is answered by the bounded probe (at most ` +
      `${PARENT_GATE_SCAN_LIMIT} candidate rows, fail-closed). Reported once for this engine.`,
  );
}

/** Whether the security service `getAdmission` resolves answers `canReadObject`. */
function hasObjectAdmission(getAdmission: ParentObjectReadAdmissionSource): boolean {
  try {
    return typeof getAdmission()?.canReadObject === 'function';
  } catch {
    // `getService` throws on an empty slot: no security service is composed.
    return false;
  }
}

/**
 * The parent objects of `objects` the caller may read at all, by the security
 * service's object-level read admission — or `null` when none is composed (no
 * service, or one without the optional `canReadObject`), in which case every
 * object is left to the caller-scoped read. Asked once per object, before any
 * of them is read as the caller; see the module header.
 */
async function admittedParentObjects(
  objects: Iterable<string>,
  callerEnvelope: Record<string, unknown>,
  getAdmission: ParentObjectReadAdmissionSource,
  logger: CommentAccessLogger,
  gate: ParentRecordGate,
): Promise<Set<string> | null> {
  let admission: ParentObjectReadAdmission | null | undefined;
  try {
    admission = getAdmission();
  } catch {
    // `getService` throws on an empty slot: no security service is composed.
    admission = undefined;
  }
  const canReadObject = admission?.canReadObject;
  if (typeof canReadObject !== 'function') return null;

  const admitted = new Set<string>();
  for (const object of objects) {
    try {
      // `=== true`: an answer that is not a plain yes refuses (fail closed).
      if ((await canReadObject.call(admission, object, { ...callerEnvelope } as SecurityContext)) === true) {
        admitted.add(object);
      }
    } catch (err) {
      // The contract: a throw is a refusal. It is a fault, not a denial, so it
      // is said — and this object's rows are excluded, never read unjudged.
      logger.warn(
        `[audit] ${gate.seam}: the object-level read admission for '${object}' failed — its rows are ` +
          `excluded from this read (fail-closed) (${(err as Error)?.message ?? err})`,
      );
    }
  }
  return admitted;
}

/**
 * [ADR-0139 D5] The bounded probe's branches for one read: one `$in` of the
 * readable ids per parent object, for the rows naming one of `restrictTo` — or
 * for every row when `restrictTo` is `null` (a whole-read probe).
 */
async function probeBranches(
  engine: CommentAccessEngine,
  ctx: CommentReadMiddlewareCtx,
  logger: CommentAccessLogger,
  gate: ParentRecordGate,
  getAdmission: ParentObjectReadAdmissionSource,
  restrictTo: { parents: string[]; why: string } | null,
): Promise<Array<Record<string, unknown>>> {
  // The parent pairs the query would touch, read under SYSTEM context (the
  // caller may not see the rows yet; that is what is being decided). The
  // caller's own order rides along, so on a table larger than the scan bound
  // the window scanned is the window the caller pages through.
  const orderBy = (ctx.ast as { orderBy?: unknown } | undefined)?.orderBy;
  const callerWhere = ctx.ast?.where as Record<string, unknown> | undefined;
  const onlyParents = restrictTo ? { object_name: { $in: [...restrictTo.parents] } } : undefined;
  const where = onlyParents ? (callerWhere ? { $and: [callerWhere, onlyParents] } : onlyParents) : (callerWhere ?? {});
  const candidates = await engine.find(gate.object, {
    where,
    fields: [...PARENT_COLUMNS],
    ...(Array.isArray(orderBy) && orderBy.length > 0 ? { orderBy } : {}),
    limit: PARENT_GATE_SCAN_LIMIT,
    context: { ...SYSTEM_CTX },
  });
  if (!candidates.length) return [];
  if (candidates.length >= PARENT_GATE_SCAN_LIMIT) {
    // Not silent (fail-closed truncation): rows beyond the scan window are
    // excluded, so a very broad read may omit rows the caller could see. A
    // record timeline scopes by `object_name` + `record_id` and never hits it.
    logger.warn(
      `[audit] ${gate.seam}: the bounded probe's candidate pre-scan ` +
        `(${restrictTo ? restrictTo.why : 'the whole read'}) hit the ${PARENT_GATE_SCAN_LIMIT}-row cap; the ` +
        'visibility filter for these rows is fail-closed and may omit visible rows — scope the query by ' +
        'object_name and record_id',
    );
  }

  /** parent object → (record id as compared → the value as STORED). The stored
   * value is what the emitted filter carries, so it can only match rows the
   * pre-scan actually saw spelled that way. */
  const byObject = new Map<string, Map<string, unknown>>();
  const allowed = restrictTo ? new Set(restrictTo.parents) : null;
  for (const row of candidates) {
    const parent = parseParentRecord(row, gate.object);
    if (!parent || (allowed && !allowed.has(parent.object))) continue;
    let ids = byObject.get(parent.object);
    if (!ids) byObject.set(parent.object, (ids = new Map()));
    if (!ids.has(parent.recordId)) ids.set(parent.recordId, row.record_id);
  }
  if (byObject.size === 0) return [];

  // The one readability answer — one caller-scoped read per parent object the
  // caller may read at all. An object the object-level admission refuses is
  // not read: it contributes no readable id, as its refused read did, and it
  // logs no denial for a skip the caller never asked for.
  const callerEnvelope = withoutOperationPrivateKeys((ctx.context ?? {}) as Record<string, unknown>);
  const admitted = await admittedParentObjects(byObject.keys(), callerEnvelope, getAdmission, logger, gate);
  const idSets = new Map<string, Set<string>>();
  for (const [object, ids] of byObject) {
    if (admitted && !admitted.has(object)) continue;
    idSets.set(object, new Set(ids.keys()));
  }
  const readable = idSets.size > 0 ? await resolveReadableParentIds(engine, ctx.context, idSets) : new Map<string, Set<string>>();

  // One branch per parent object that kept at least one readable record.
  const branches: Array<Record<string, unknown>> = [];
  for (const [object, ids] of byObject) {
    const visible = readable.get(object);
    if (!visible) continue;
    const kept: unknown[] = [];
    for (const [recordId, stored] of ids) if (visible.has(recordId)) kept.push(stored);
    if (kept.length) branches.push({ object_name: object, record_id: { $in: kept } });
  }
  return branches;
}

/** "the bounded probe's parents, by class" — how a restricted probe names itself. */
function describeProbed(probed: ReadonlyMap<string, ParentProbeClass>): string {
  const byClass = new Map<string, string[]>();
  for (const [parent, why] of probed) {
    const list = byClass.get(why) ?? [];
    list.push(parent);
    byClass.set(why, list);
  }
  return [...byClass].map(([why, parents]) => `${why}: ${parents.join(', ')}`).join('; ');
}

/** AND `filter` into the read's WHERE, never replacing the caller's own. */
export function andIntoWhere(ctx: CommentReadMiddlewareCtx, filter: unknown): void {
  if (!ctx.ast) return;
  ctx.ast.where = ctx.ast.where ? { $and: [ctx.ast.where, filter] } : filter;
}

/**
 * The parent-visibility WHERE for one read of `gate.object`: `null` only when
 * the caller holds the gate's exempt capability (nothing to narrow);
 * otherwise one branch per parent object enumerated for this read (the ones
 * the read's own `where` names, when it names any) — a `ReadableIds` leaf, or
 * the bounded probe's `$in` of readable ids for D5's classes — plus the
 * outside class's predicate, ORed; or the gate's deny-all sentinel when no
 * branch remains, or when the probe fails.
 *
 * `getAdmission` resolves the security service whose object-level read
 * admission the probe asks before any parent object is read as the caller
 * (module header, "A skipped object is not an access attempt").
 *
 * Never throws for a fault of its own: the probe's failure is answered with
 * the deny-all sentinel and said. A leaf is composed by the engine after this
 * returns, so its refusal is the read's (module header, ADR-0139 D3).
 */
export async function computeParentRecordFilter(
  engine: ParentRecordGateEngine,
  ctx: CommentReadMiddlewareCtx,
  logger: CommentAccessLogger,
  gate: ParentRecordGate,
  getAdmission: ParentObjectReadAdmissionSource,
): Promise<unknown | null> {
  // 0. The gate's declared exemption, decided before anything else.
  if (gate.exemptCapability && callerHoldsCapability(ctx.context, gate.exemptCapability)) return null;

  // 1. Leaf or probe, per parent object the read can be about, before any
  //    branch is written. The read's own `where`, as it reached this gate.
  const plan = planParentReads(engine, gate, ctx.context, hasObjectAdmission(getAdmission), ctx.ast?.where);
  if (plan.probeWholeRead === 'engine-cannot-classify' || plan.probeWholeRead === 'no-object-admission') {
    reportWholeReadProbeOnce(engine, logger, gate, plan.probeWholeRead);
  }

  const branches: Array<Record<string, unknown>> = [];
  // 2. One ReadableIds leaf per composable parent object (ADR-0139 D4).
  if (plan.probeWholeRead === null) {
    for (const parent of plan.leaves) {
      branches.push({ object_name: parent, record_id: { $in: ReadableIds.of(parent) } });
    }
  }

  // 3. The bounded probe for D5's classes (ADR-0139 D5), fail-closed.
  const restrictTo =
    plan.probeWholeRead !== null
      ? null
      : plan.probed.size > 0
        ? { parents: [...plan.probed.keys()], why: describeProbed(plan.probed) }
        : undefined;
  if (restrictTo !== undefined) {
    try {
      branches.push(...(await probeBranches(engine, ctx, logger, gate, getAdmission, restrictTo)));
    } catch (err) {
      // A probe failure must never fall open into a leak.
      logger.warn(
        `[audit] ${gate.seam}: the bounded probe ` +
          `(${restrictTo ? restrictTo.why : `the whole read: ${plan.probeWholeRead}`}) failed, denying all ` +
          `(${(err as Error)?.message ?? err})`,
      );
      return gate.denyAll;
    }
  }

  // 4. The rows declared outside the gate's class, as a predicate.
  if (gate.outsideClass) branches.push(gate.outsideClass.where());
  if (branches.length === 0) return gate.denyAll;
  return branches.length === 1 ? branches[0] : { $or: branches };
}
