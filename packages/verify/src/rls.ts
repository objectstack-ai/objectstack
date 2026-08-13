// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Metadata-driven RLS cross-owner proofs — the #1994 invariant.
//
// #1994 ("member edits others' records") was a by-id write that skipped the
// row-level predicate: `driver.update(object, id, …)` builds no AST, so RLS
// never scoped it. The clean, app-agnostic invariant that catches it without
// interpreting each sharing rule:
//
//   A user who CANNOT READ a record must not be able to WRITE it.
//   ("You can't mutate what you can't see.")
//
// Derivation, per object: admin creates a record; a probe persona tries to read
// it, then tries to mutate it by id; we re-read as admin to see if the row
// actually changed. If the probe couldn't see it yet changed it, that's the
// #1994 class of hole — regardless of the app's sharing config.
//
// ## [#7685] Two defects that made this runner's green mean nothing
//
// **1. The probe was masked by the OBJECT gate.** The persona used to be a bare
// `signUp()` member holding no object grants, so `checkObjectPermission` answered
// 403 *before* record scope was ever consulted — and the runner recorded that
// 403 as `rls-consistent`. Measured on the stock showcase: 11 of 13 "consistent"
// verdicts were `GET 403` (the object gate) and only 2 were `GET 404` (record
// scope). The by-id-write class was therefore STRUCTURALLY unreachable on those
// 11: no platform change could have flipped them to `rls-hole`, so their green
// was not evidence of anything. `provisionRlsProbePersona` below mints the
// persona the class needs — object read+edit, no record-scope grants — and the
// per-object LIST reachability probe MEASURES that the object gate is open
// rather than assuming it, reporting `probe-blocked` (never a pass) when it is
// not.
//
// **2. A skip read as a pass, and cascaded.** A `showcase_account` auto-record
// 400 skipped that object AND every object with a required relation to it —
// 8 of 23 objects skipped on a stock run — while the summary line reported
// "0 HOLES" as if the run were a clean bill of health. A skip is exactly where
// the privately-reported #7665 defect hid. Two changes: an unsatisfiable create
// now falls back to ADOPTING an existing row (seed data) so one failure no
// longer cascades into its dependents, and the report separates PROVEN objects
// from NOT-PROVEN ones (`member-visible` / `probe-blocked` / `skipped`) in both
// the structured summary and the formatted output.
//
// ## [#7978] Position-authored narrowing — the class the base persona cannot reach
//
// The persona above holds NO positions by construction, so an app policy carrying
// `positions: [...]` is never APPLICABLE to it (`getApplicablePolicies` filters by
// the caller's positions): the object reads `member-visible`, and the app's own
// narrowing goes unexercised while only the platform gate underneath it is proven.
// That is precisely the authoring shape the real #7665 defect wore — the ordinary
// `showcase_contributor` persona, a `contributor` POSITION plus the matching set,
// against `positions: ['contributor']` rules.
//
// So a run now FANS OUT: one persona per position the app DECLARES
// (`declaredPositionNames`, read from `config.positions` — never a transcribed
// list, so a position added next month is covered without touching this file),
// each holding that position and nothing else, i.e. exactly the capability the app
// itself binds to it. The same invariant then runs unchanged for each.
//
// Three properties of the fan-out are deliberate:
//   • Probe TARGETS are established once and shared by every persona, so a
//     position costs 4 HTTP calls per object rather than re-deriving and
//     re-creating a record per persona.
//   • Each persona mutates with a DISTINCT marker, so "did the row change" stays
//     attributable to the persona that wrote it — and a SHORT one, because a probe
//     field's `maxLength` would truncate a long marker into a false negative.
//   • A position that yields no verdict is REPORTED, never dropped: an app
//     declaring no positions says so (`positionCoverage.note`), and a declared
//     position whose persona could not be provisioned lands in
//     `positionCoverage.notRun`. Neither contributes to `proven`.
//
// ⛔ What is STILL out of reach, stated so this green is not over-read either:
// narrowing that gates on a position held TOGETHER WITH some other condition — a
// business-unit anchor, an organization membership, a sharing-rule grant — since
// these personas hold the bare position, unanchored. And a position bound to a
// VAMA-carrying set (`showcase_auditor`, `showcase_ops`) reads every row by
// design, so it reports `member-visible`: honest, and not a proof. Per-position
// coverage is reported per position for exactly that reason — the fan-out must
// never be read as N× the reach.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { SecurityPlugin, securityDefaultPermissionSets, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { AUDIENCE_ANCHOR_POSITIONS } from '@objectstack/spec/identity';
import type { PermissionSet } from '@objectstack/spec/security';

import type { VerifyStack } from './harness.js';
import { deriveCrudCases, fillRelationalRefs } from './derive.js';

const PROBE_TYPES = new Set(['text', 'textarea', 'string']);
const MUTATION = 'rls-mutated-by-B';

/**
 * The marker a POSITION persona writes. Distinct per persona so a changed row is
 * attributable to the persona that changed it — and deliberately SHORT: a probe
 * field declaring a small `maxLength` truncates a long marker, the ground-truth
 * re-read then fails to match, and a real hole reads as "row unchanged". A false
 * negative in this runner is the one outcome worse than no runner at all.
 */
function positionMutation(index: number): string {
  return `rls-mut-p${index + 1}`;
}

/** Default identity of the object-granted probe persona (`provisionRlsProbePersona`). */
export const RLS_PROBE_EMAIL = 'verify-rls-probe@objectstack.test';
const RLS_PROBE_PASSWORD = 'Rls-Probe-Pass-123';
const RLS_PROBE_PERMISSION_SET = 'verify_rls_probe';
const RLS_POSITION_PROBE_PASSWORD = 'Rls-Position-Probe-123';

/** Identity of the persona minted for one declared position. */
export function rlsPositionProbeEmail(position: string): string {
  return `verify-rls-pos-${String(position).toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}@objectstack.test`;
}

/**
 * Machine names of the positions the app DECLARES (`config.positions`), in
 * declaration order, deduplicated.
 *
 * ⛔ DERIVED, never transcribed. A hand-written roster is how a verifier quietly
 * stops covering the position someone adds next month — it keeps passing, over a
 * surface it no longer looks at. Reading the app's own declaration is also what
 * makes the fan-out app-agnostic: it is the same premise the rest of this runner
 * stands on (derive from metadata, interpret nothing).
 *
 * The two built-in AUDIENCE ANCHORS (`everyone`, `guest`) are excluded: no app
 * declares them (ADR-0090 D5/D9), every authenticated member already holds
 * `everyone` — so the base persona above covers it — and `guest` is the anonymous
 * audience, which no signed-up persona can hold at all. Filtering them here means
 * an app that mistakenly declares one still gets a truthful run instead of a
 * persona whose position assignment can never take effect.
 */
export function declaredPositionNames(config: any): string[] {
  const anchors = AUDIENCE_ANCHOR_POSITIONS as readonly string[];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const declared of (config?.positions ?? []) as any[]) {
    const name = typeof declared === 'string' ? declared : declared?.name;
    if (typeof name !== 'string' || name.length === 0) continue;
    if (anchors.includes(name) || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export type RlsStatus =
  /** PROVEN: the probe could not read the row and could not mutate it. */
  | 'rls-consistent'
  /** PROVEN HOLE: the probe could not read the row yet mutated it by id. */
  | 'rls-hole'
  /** NOT PROVEN: the probe CAN read the row, so there is no cross-owner scenario here. */
  | 'member-visible'
  /** NOT PROVEN: the OBJECT gate refused the probe, so record scope was never consulted. */
  | 'probe-blocked'
  /** NOT PROVEN: no probe target could be established at all. */
  | 'skipped';

export interface RlsResult {
  object: string;
  status: RlsStatus;
  detail?: string;
  /**
   * How the probe target row was obtained. `adopted` means the derived admin
   * create was rejected and an existing (seeded) row was used instead — the
   * cascade-stopper. Absent when no target was established.
   */
  target?: 'created' | 'adopted';
}

/** Describes the persona the probe ran as, so a run's REACH is legible. */
export interface RlsProbeDescriptor {
  /** Human label for the persona (an email, or a fixture description). */
  label: string;
  /** How many objects the persona was granted object-level read+edit on. */
  grantedObjects?: number;
  /**
   * Set when the intended object-granted persona could NOT be provisioned and
   * the run fell back to a weaker one. A degraded run proves strictly less than
   * it appears to; callers surface it and fail rather than reporting success.
   */
  degraded?: string;
}

export interface RlsSummary {
  objects: number;
  consistent: number;
  holes: number;
  memberVisible: number;
  probeBlocked: number;
  skipped: number;
  /** Objects on which the by-id-write class was actually exercised. */
  proven: number;
  /** Objects the run did not exercise (`memberVisible + probeBlocked + skipped`). */
  unproven: number;
}

/** One persona's full pass over the app's objects. */
export interface RlsPositionRun {
  /** The declared position this persona holds — and holds alone. */
  position: string;
  probe: RlsProbeDescriptor;
  results: RlsResult[];
  unproven: Array<{ object: string; status: RlsStatus; detail?: string }>;
  summary: RlsSummary;
}

/**
 * What the position fan-out actually covered — reported so a skip can never read
 * as a pass (#7685's rule, applied to the fan-out itself, #7978).
 */
export interface RlsPositionCoverage {
  /** Positions the app DECLARES (`declaredPositionNames`) — the intended reach. */
  declared: string[];
  /** Positions a persona actually probed with. */
  ran: string[];
  /**
   * Declared positions with no verdict, and why. A provisioning failure lands
   * here rather than vanishing: the run proved strictly less than its numbers
   * suggest, and callers surface it (`objectstack verify` counts it as a hard
   * failure, exactly as it counts a degraded base persona).
   */
  notRun: Array<{ position: string; reason: string }>;
  /**
   * Set ONLY when the app declares no positions at all. "No position personas to
   * run" is a distinct statement from "the position personas found nothing" —
   * without it, an app with zero positions would silently read like an app whose
   * position-authored narrowing had been proven.
   */
  note?: string;
}

export interface RlsReport {
  app: string;
  /** Which persona drove the by-id probes. */
  probe: RlsProbeDescriptor;
  results: RlsResult[];
  /**
   * Every object the run did NOT prove, with the reason — surfaced separately
   * from `results` so "what did this run fail to look at" is one field, not a
   * filter a consumer has to remember to apply.
   */
  unproven: Array<{ object: string; status: RlsStatus; detail?: string }>;
  /**
   * The BASE (verifier-authored) persona's pass. Position personas each carry
   * their own summary in `positionRuns`; `totals` is the whole run.
   */
  summary: RlsSummary;
  /** [#7978] One entry per declared position a persona was provisioned for. */
  positionRuns: RlsPositionRun[];
  /** [#7978] Intended vs achieved position reach. */
  positionCoverage: RlsPositionCoverage;
  /**
   * [#7978] Every persona's verdicts summed — base + each position run. The unit
   * is one (object × persona) PROBE, not one object, so `totals.objects` exceeds
   * the app's object count whenever the fan-out ran. This is what a caller reads
   * to decide whether the run found holes: a hole a position persona found is
   * exactly as real as one the base persona found.
   */
  totals: RlsSummary;
}

/** A provisioned persona holding exactly one declared position. */
export interface RlsPositionPersonaInput {
  /** The declared position machine name this persona holds. */
  position: string;
  /** Bearer token for the persona. */
  token: string;
  /** Human label (an email) for the report. */
  label: string;
}

export interface RlsProofOptions {
  /**
   * The persona `memberToken` belongs to. Reporting only — every reachability
   * verdict below is MEASURED per object, never taken from this descriptor,
   * because a declared persona that silently failed to receive its grants is
   * precisely the state this runner must not report as a pass.
   */
  probe?: RlsProbeDescriptor;
  /**
   * [#7978] Personas holding one declared position each
   * (`provisionRlsPositionPersona`). Provisioning is the CALLER's job — it needs
   * a live stack and writes RBAC rows — while the reach they were SUPPOSED to
   * cover is derived here from the config, so a caller that provisions fewer
   * personas than the app declares shows up as `positionCoverage.notRun` rather
   * than as a quietly narrower run.
   */
  positionPersonas?: RlsPositionPersonaInput[];
  /**
   * Positions whose persona could not be provisioned, with the reason. Reported,
   * never swallowed — see {@link RlsPositionCoverage.notRun}.
   */
  positionFailures?: Array<{ position: string; error: string }>;
}

/** The identity + token of an object-granted probe persona. */
export interface RlsProbePersona {
  token: string;
  email: string;
  userId: string;
  /** Name of the minted `sys_permission_set` row. */
  permissionSet: string;
  /** Objects the minted set grants read+edit on. */
  grantedObjects: number;
}

function genId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
}

function rowsOf(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  const list = payload?.records ?? payload?.data ?? payload?.value;
  return Array.isArray(list) ? list : [];
}

/**
 * The probe persona's capability, derived from the app's own metadata: object
 * read+edit on every declared object, narrowed by an OWNER policy authored
 * `operation: 'select'` only.
 *
 * Both halves are load-bearing, and neither is a dial to soften:
 *
 * - **read+edit** is what stops `checkObjectPermission` answering 403 first.
 *   Without it the record-level gate is never consulted and the runner's verdict
 *   is about the object gate, not about RLS (#7685).
 * - **owner-scoped SELECT only** is what puts the persona OUTSIDE the record
 *   scope, which is the other half of #7665's acceptance criterion. It is also
 *   deliberately the exact AUTHORING SHAPE that was the hole: with no
 *   `update`-class predicate, a platform that does not derive the write scope
 *   from the caller's select narrowing lets the by-id PATCH through on a row the
 *   persona gets 404 on. So this set turns every object of every verified app
 *   into a live regression guard for that derivation — the runner answers
 *   `rls-hole` the day it stops holding.
 *
 * No `create`/`delete`, no positions, no system permissions: the persona owns
 * nothing, so the admin-created probe row is outside its scope by construction
 * rather than by fixture coincidence.
 *
 * ⚠️ The narrowing is VERIFIER-authored, so a `rls-consistent` verdict is a
 * statement about the PLATFORM's by-id-write gate — not a statement that the
 * app's own authored policies are right. The app's authorization config is what
 * the per-app dogfood proofs cover.
 */
export function rlsProbePermissionSet(config: any): PermissionSet {
  const objects: Record<string, { allowRead: boolean; allowEdit: boolean }> = {};
  const rowLevelSecurity: Array<Record<string, unknown>> = [];
  for (const o of (config?.objects ?? []) as any[]) {
    if (!o?.name) continue;
    objects[o.name] = { allowRead: true, allowEdit: true };
    rowLevelSecurity.push({
      name: `${o.name}_rls_probe_scope`,
      label: `RLS probe scope for ${o.name}`,
      description:
        'Verifier-authored owner narrowing (select only) — puts the probe persona outside the ' +
        'scope of every record it did not create, so the by-id-write class is reachable (#7685).',
      object: o.name,
      operation: 'select',
      using: 'created_by == current_user.id',
      enabled: true,
    });
  }
  return {
    name: RLS_PROBE_PERMISSION_SET,
    label: 'Verify RLS Probe',
    objects,
    rowLevelSecurity,
  } as unknown as PermissionSet;
}

/**
 * The `SecurityPlugin` an `objectstack verify --rls` boot needs: the platform
 * defaults, the app's own declared default profile, **and** the probe capability
 * above.
 *
 * The probe set must be REGISTERED at boot, not written as a bare
 * `sys_permission_set` row: `PermissionEvaluator.resolvePermissionSets` resolves
 * a name from metadata first, the bootstrap list second, and the DB row only as
 * a last resort — and that last-resort loader hydrates `objects` / `fields` /
 * `systemPermissions` / `tabPermissions` but NOT `rowLevelSecurity`. A row-only
 * probe set would therefore grant the object bits and silently drop the
 * narrowing, which is the one thing that makes the persona a probe at all.
 *
 * `appSecurityPluginOptions(config)` is carried through verbatim so the app's
 * declared default profile still resolves exactly as it does under `bootStack`'s
 * own default and under `objectstack serve` (#7001) — this plugin replaces that
 * default WHOLE, so anything it forgets to carry is silently missing from the
 * run.
 */
export function rlsProbeSecurity(config: any): SecurityPlugin {
  return new SecurityPlugin({
    ...(appSecurityPluginOptions(config) ?? {}),
    defaultPermissionSets: [...securityDefaultPermissionSets, rlsProbePermissionSet(config)],
  });
}

/**
 * Sign up the probe persona and GRANT it {@link rlsProbePermissionSet} — the
 * capability the #1994 class actually needs (object read+edit, owner-scoped
 * select, nothing else).
 *
 * Requires the stack to have been booted with {@link rlsProbeSecurity}, which is
 * what puts the set's `rowLevelSecurity` on the resolution path. This function
 * only writes the two RBAC link rows, and it writes them through the kernel's
 * ObjectQL engine under a system context, the same way `bootstrapPlatformAdmin`
 * seeds them: the persona is test SETUP, not the surface under test, so routing
 * it through the data door would make the proof depend on whether this
 * deployment happens to let an admin POST `sys_permission_set` — a second thing
 * that can fail for reasons unrelated to RLS.
 *
 * Throws when the stack has no ObjectQL engine or the user cannot be resolved.
 * Callers must NOT swallow that into a weaker persona silently: run degraded and
 * say so (`RlsProbeDescriptor.degraded`), or fail.
 */
export async function provisionRlsProbePersona(
  stack: VerifyStack,
  config: any,
  opts: { email?: string; password?: string } = {},
): Promise<RlsProbePersona> {
  const email = opts.email ?? RLS_PROBE_EMAIL;
  const password = opts.password ?? RLS_PROBE_PASSWORD;

  await stack.signUp(email, password);

  const ql = await stack.kernel.getServiceAsync<any>('objectql');
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') {
    throw new Error(
      'verify: cannot provision the RLS probe persona — no ObjectQL engine on this stack. ' +
        'The probe needs object-level read+edit grants, without which every by-id probe is ' +
        'masked by the object gate and the #1994 class is unreachable (#7685).',
    );
  }
  const sysCtx = { context: { isSystem: true } };

  const users = rowsOf(await ql.find('sys_user', { where: { email }, limit: 1 }, sysCtx));
  const userId = users[0]?.id;
  if (!userId) {
    throw new Error(`verify: cannot provision the RLS probe persona — no sys_user row for ${email}.`);
  }

  const probeSet = rlsProbePermissionSet(config);

  // The grant is keyed by ROW ID, and `resolveUserAuthzGrants` reads the row
  // only to learn its NAME — the definition then resolves from the registered
  // bootstrap list (`rlsProbeSecurity`), which is the copy that carries the
  // narrowing. Find-or-create so it works whether or not this boot already
  // seeded the registered set into the table.
  const existing = rowsOf(
    await ql.find('sys_permission_set', { where: { name: RLS_PROBE_PERMISSION_SET }, limit: 1 }, sysCtx),
  );
  let permissionSetId = existing[0]?.id;
  if (!permissionSetId) {
    permissionSetId = genId('ps');
    await ql.insert(
      'sys_permission_set',
      {
        id: permissionSetId,
        name: RLS_PROBE_PERMISSION_SET,
        label: probeSet.label,
        description:
          'Ephemeral persona minted by `objectstack verify --rls`: object-level read+edit on every ' +
          'declared object plus an owner-scoped SELECT narrowing, so a by-id refusal is attributable ' +
          'to the record gate rather than the object gate (#7685).',
        object_permissions: JSON.stringify(probeSet.objects ?? {}),
        field_permissions: '{}',
        system_permissions: '[]',
        row_level_security: JSON.stringify(probeSet.rowLevelSecurity ?? []),
        tab_permissions: '{}',
        active: true,
      },
      sysCtx,
    );
  }
  await ql.insert(
    'sys_user_permission_set',
    {
      id: genId('ups'),
      user_id: userId,
      permission_set_id: permissionSetId,
      organization_id: null,
      granted_by: null,
    },
    sysCtx,
  );

  // Re-sign-in so the probe's session is issued after the grant exists. The
  // per-request resolver reads the grant tables live, so this is belt-and-braces
  // — but a session minted before the row is exactly the shape that makes a
  // provisioning bug look like an enforcement result.
  const token = await stack.signIn(email, password);

  return {
    token,
    email,
    userId: String(userId),
    permissionSet: RLS_PROBE_PERMISSION_SET,
    grantedObjects: Object.keys(probeSet.objects ?? {}).length,
  };
}

/** The identity + token of a persona holding exactly one declared position. */
export interface RlsPositionPersona {
  position: string;
  token: string;
  email: string;
  userId: string;
}

/**
 * [#7978] Sign up a persona and give it ONE declared position — nothing else.
 *
 * Deliberately the opposite construction from {@link provisionRlsProbePersona}:
 * that one authors its own capability so the PLATFORM's by-id-write gate is
 * reachable; this one authors NOTHING. Its whole capability is whatever the app
 * binds to the position (`sys_position_permission_set` → the app's own permission
 * sets, narrowing and all), which is what makes it a probe of the APP's authored
 * policy rather than of a policy the verifier invented. It also reproduces
 * #7665's persona exactly: a bare `contributor` on the showcase is the shape that
 * defect wore.
 *
 * The assignment is one `sys_user_position` row — the platform's source of truth
 * for "who holds which position" (ADR-0057 D4 / ADR-0090 D3), keyed by the
 * position's MACHINE NAME, which is how `ctx.positions` is keyed downstream.
 * Written under a system context through ObjectQL for the same reason the base
 * persona's grants are: provisioning is test SETUP, and routing it through the
 * data door would make the proof depend on whether this deployment lets an admin
 * POST RBAC rows — a second thing that can fail for reasons unrelated to RLS.
 *
 * ⚠️ The row is deliberately UNANCHORED (`business_unit_id: null`): a BU anchor
 * would add depth-scoped visibility on top of the position and the verdict would
 * no longer be attributable to the position-gated policy alone.
 *
 * Throws when the stack has no ObjectQL engine or the user cannot be resolved.
 * Callers must NOT swallow that: report the position as not-run
 * (`RlsPositionCoverage.notRun`) so the missing reach is visible.
 */
export async function provisionRlsPositionPersona(
  stack: VerifyStack,
  position: string,
  opts: { email?: string; password?: string } = {},
): Promise<RlsPositionPersona> {
  const email = opts.email ?? rlsPositionProbeEmail(position);
  const password = opts.password ?? RLS_POSITION_PROBE_PASSWORD;

  await stack.signUp(email, password);

  const ql = await stack.kernel.getServiceAsync<any>('objectql');
  if (!ql || typeof ql.find !== 'function' || typeof ql.insert !== 'function') {
    throw new Error(
      `verify: cannot provision the RLS position persona for '${position}' — no ObjectQL engine on ` +
        'this stack. Without the position assignment the app\'s position-gated policies are not ' +
        'applicable to the persona, so the app-authored narrowing is unreachable (#7978).',
    );
  }
  const sysCtx = { context: { isSystem: true } };

  const users = rowsOf(await ql.find('sys_user', { where: { email }, limit: 1 }, sysCtx));
  const userId = users[0]?.id;
  if (!userId) {
    throw new Error(
      `verify: cannot provision the RLS position persona for '${position}' — no sys_user row for ${email}.`,
    );
  }

  await ql.insert(
    'sys_user_position',
    {
      id: genId('up'),
      user_id: userId,
      position,
      business_unit_id: null,
      organization_id: null,
      granted_by: null,
      reason: `Ephemeral persona minted by \`objectstack verify --rls\`: holds '${position}' and nothing else, so the app's own position-gated RLS narrowing is exercised (#7978).`,
    },
    sysCtx,
  );

  // Re-sign-in after the assignment exists, for the same reason the base persona
  // does: a session minted before the row is exactly the shape that makes a
  // provisioning bug look like an enforcement result.
  const token = await stack.signIn(email, password);

  return { position, token, email, userId: String(userId) };
}

/** The id of an existing row of `object`, read as admin, or null. */
async function firstExistingId(stack: VerifyStack, adminToken: string, object: string): Promise<string | null> {
  const res = await stack.apiAs(adminToken, 'GET', `/data/${object}?$top=1`);
  if (res.status !== 200) return null;
  let payload: any;
  try {
    payload = await res.json();
  } catch {
    return null;
  }
  const id = rowsOf(payload)[0]?.id;
  return id ? String(id) : null;
}

/**
 * A probe target: the row every persona runs the invariant against, plus the
 * plain-text field they mutate.
 *
 * [#7978] Establishing these ONCE is what keeps the position fan-out affordable:
 * the admin creates (or adopts) one row per object for the whole run, and each
 * persona then costs 4 HTTP calls per object instead of re-deriving and
 * re-creating a record of its own. It is also more honest — every persona is
 * judged against the same ground truth rather than a row of its own that some
 * app-level validation may have shaped differently.
 */
interface ProbeTarget {
  object: string;
  id: string;
  /** Plain-text field the personas mutate. */
  field: string;
  origin: NonNullable<RlsResult['target']>;
  /** Detail suffix recording an adopted target. */
  via: string;
}

/** Either an object that never got a target (recorded once, replayed per persona) or one that did. */
type ProbeCase = { object: string; skipped: RlsResult } | { object: string; target: ProbeTarget };

async function establishProbeTargets(
  stack: VerifyStack,
  adminToken: string,
  config: any,
): Promise<ProbeCase[]> {
  const cases = deriveCrudCases(config);
  const out: ProbeCase[] = [];
  // Admin-created (or adopted) ids, threaded so a detail's required relation
  // points at a real master (topological order created it first) — lets the
  // #1994 invariant reach relationship-dense objects, not just the leaves.
  const createdIds = new Map<string, string>();

  for (const c of cases) {
    const skip = (detail: string): void => {
      out.push({ object: c.object, skipped: { object: c.object, status: 'skipped', detail } });
    };
    if (c.blocked) { skip(c.blocked); continue; }

    // A plain-text field to mutate (avoid email/url/phone — their format checks
    // would reject the probe for a benign reason, masking the RLS signal).
    const probe = (c.asserts ?? []).find((a) => PROBE_TYPES.has(a.type));
    if (!probe) { skip('no plain-text probe field'); continue; }

    let resolved = fillRelationalRefs(c, createdIds);
    if (resolved.missing) {
      // [#7685] Stop the CASCADE. An upstream object whose derived record the
      // app's own validation rejects used to skip every dependent object too
      // (one `showcase_account` 400 → four further skips). The dependency only
      // needs SOME real master row, not one this run created — so adopt an
      // existing (seeded) one before giving up.
      let adopted = false;
      for (const ref of c.relationalRefs ?? []) {
        if (!ref.required || createdIds.has(ref.target)) continue;
        const existing = await firstExistingId(stack, adminToken, ref.target);
        if (existing) { createdIds.set(ref.target, existing); adopted = true; }
      }
      if (adopted) resolved = fillRelationalRefs(c, createdIds);
    }
    if (resolved.missing) { skip(resolved.missing); continue; }

    // Admin (owner) creates the record — or, when the app's own validation
    // rejects the derived body, adopt an existing row so the object is still
    // probed instead of silently dropping out of the run.
    let target: NonNullable<RlsResult['target']> = 'created';
    let id: string | null = null;
    let createDetail = '';
    const created = await stack.apiAs(adminToken, 'POST', `/data/${c.object}`, resolved.body);
    if (created.status < 300) {
      const cj = (await created.json()) as any;
      const createdId = cj?.id ?? cj?.record?.id;
      if (createdId) id = String(createdId);
      else createDetail = 'admin create returned no id';
    } else {
      createDetail = `admin create failed (${created.status})`;
    }
    if (!id) {
      const existing = await firstExistingId(stack, adminToken, c.object);
      if (existing) { id = existing; target = 'adopted'; }
    }
    if (!id) {
      skip(`${createDetail}; no existing ${c.object} row to adopt`);
      continue;
    }
    createdIds.set(c.object, id);
    const via = target === 'adopted' ? ` [target adopted from existing rows — ${createDetail}]` : '';
    out.push({ object: c.object, target: { object: c.object, id, field: probe.field, origin: target, via } });
  }

  return out;
}

/**
 * Run the #1994 invariant over every established target as ONE persona.
 *
 * `mutation` is that persona's marker — see {@link positionMutation}. Two
 * personas probing the same row must write different markers, or the second
 * would read the first's successful write as its own (a fabricated hole) and its
 * own refused write as a change (a fabricated pass).
 */
async function probeAsPersona(
  stack: VerifyStack,
  adminToken: string,
  personaToken: string,
  probeCases: ProbeCase[],
  mutation: string,
): Promise<RlsResult[]> {
  const results: RlsResult[] = [];

  for (const probeCase of probeCases) {
    if ('skipped' in probeCase) { results.push({ ...probeCase.skipped }); continue; }
    const { object, id, field, origin, via } = probeCase.target;

    // ── Reachability, MEASURED (#7685) ────────────────────────────────────────
    // Does the object-level gate let this persona through at all? A 403 on the
    // plain LIST means `checkObjectPermission` refuses before record scope is
    // consulted, so nothing below could ever observe the by-id-write class on
    // this object — and recording that as `rls-consistent` (which is what this
    // runner did for 11 of 13 "consistent" showcase objects) is a false pass.
    const list = await stack.apiAs(personaToken, 'GET', `/data/${object}?$top=1`);
    if (list.status === 403) {
      results.push({
        object,
        status: 'probe-blocked',
        target: origin,
        detail:
          `the probe persona holds no object-level READ grant on ${object} (LIST 403), so the ` +
          'object gate answers before record scope — the by-id-write class was NOT exercised here. ' +
          `Not a pass.${via}`,
      });
      continue;
    }

    // Probe: can they SEE it?
    const bRead = await stack.apiAs(personaToken, 'GET', `/data/${object}/${id}`);
    let canRead = false;
    if (bRead.status === 200) {
      const rec = ((await bRead.json()) as any)?.record;
      canRead = !!rec && rec.id === id;
    }

    // Probe: try to MUTATE it by id.
    const bWrite = await stack.apiAs(personaToken, 'PATCH', `/data/${object}/${id}`, { [field]: mutation });

    // Ground truth: re-read as admin — did the row actually change?
    const after = await stack.apiAs(adminToken, 'GET', `/data/${object}/${id}`);
    const afterVal = (((await after.json()) as any)?.record ?? {})[field];
    const changed = afterVal === mutation;

    if (canRead) {
      results.push({
        object,
        status: 'member-visible',
        target: origin,
        detail:
          'the probe can read this object — not a cross-owner scenario, so the by-id-write class is ' +
          `not exercised here (no record-scope narrowing reaches this persona, or read is granted)${via}`,
      });
    } else if (changed) {
      results.push({
        object,
        status: 'rls-hole',
        target: origin,
        detail: `the probe cannot read it (GET ${bRead.status}) yet MUTATED it by id (PATCH ${bWrite.status}) — by-id write bypassed RLS (#1994 class)${via}`,
      });
    } else {
      results.push({
        object,
        status: 'rls-consistent',
        target: origin,
        detail: `the probe cannot read (GET ${bRead.status}) and could not mutate (PATCH ${bWrite.status}, row unchanged)${via}`,
      });
    }
  }

  return results;
}

function summarize(results: RlsResult[]): RlsSummary {
  const count = (s: RlsStatus): number => results.filter((r) => r.status === s).length;
  const consistent = count('rls-consistent');
  const holes = count('rls-hole');
  const memberVisible = count('member-visible');
  const probeBlocked = count('probe-blocked');
  const skipped = count('skipped');
  return {
    objects: results.length,
    consistent,
    holes,
    memberVisible,
    probeBlocked,
    skipped,
    proven: consistent + holes,
    unproven: memberVisible + probeBlocked + skipped,
  };
}

function notProven(results: RlsResult[]): Array<{ object: string; status: RlsStatus; detail?: string }> {
  return results
    .filter((r) => r.status === 'member-visible' || r.status === 'probe-blocked' || r.status === 'skipped')
    .map((r) => ({ object: r.object, status: r.status, detail: r.detail }));
}

function sumSummaries(all: RlsSummary[]): RlsSummary {
  return all.reduce<RlsSummary>(
    (acc, s) => ({
      objects: acc.objects + s.objects,
      consistent: acc.consistent + s.consistent,
      holes: acc.holes + s.holes,
      memberVisible: acc.memberVisible + s.memberVisible,
      probeBlocked: acc.probeBlocked + s.probeBlocked,
      skipped: acc.skipped + s.skipped,
      proven: acc.proven + s.proven,
      unproven: acc.unproven + s.unproven,
    }),
    { objects: 0, consistent: 0, holes: 0, memberVisible: 0, probeBlocked: 0, skipped: 0, proven: 0, unproven: 0 },
  );
}

export async function runRlsProofs(
  stack: VerifyStack,
  adminToken: string,
  memberToken: string,
  config: any,
  opts: RlsProofOptions = {},
): Promise<RlsReport> {
  const probeCases = await establishProbeTargets(stack, adminToken, config);

  // The base (verifier-authored) persona — the platform half, unchanged.
  const results = await probeAsPersona(stack, adminToken, memberToken, probeCases, MUTATION);
  const summary = summarize(results);

  // [#7978] One pass per declared position the caller could provision. Each is a
  // separate run with its own summary: a position bound to a VAMA-carrying set
  // reads everything and proves nothing, and rolling that into one number would
  // claim reach the fan-out does not have.
  const positionRuns: RlsPositionRun[] = [];
  const personas = opts.positionPersonas ?? [];
  for (let i = 0; i < personas.length; i += 1) {
    const persona = personas[i];
    const personaResults = await probeAsPersona(
      stack, adminToken, persona.token, probeCases, positionMutation(i),
    );
    positionRuns.push({
      position: persona.position,
      probe: { label: persona.label },
      results: personaResults,
      unproven: notProven(personaResults),
      summary: summarize(personaResults),
    });
  }

  // Intended reach is DERIVED from the app, so a caller that provisioned fewer
  // personas than the app declares reports a gap instead of a narrower run.
  const declared = declaredPositionNames(config);
  const ran = positionRuns.map((r) => r.position);
  const failures = opts.positionFailures ?? [];
  const notRun = [...new Set([...declared, ...failures.map((f) => f.position)])]
    .filter((position) => !ran.includes(position))
    .map((position) => ({
      position,
      reason:
        failures.find((f) => f.position === position)?.error ??
        'no persona was provisioned for this declared position — the app-authored narrowing it gates was NOT exercised',
    }));

  const positionCoverage: RlsPositionCoverage = {
    declared,
    ran,
    notRun,
    ...(declared.length === 0
      ? { note: 'this app declares no positions — there are no position personas to run, so nothing here was proven about position-gated narrowing' }
      : {}),
  };

  return {
    app: config?.manifest?.id ?? 'app',
    probe: opts.probe ?? { label: 'unspecified persona' },
    results,
    unproven: notProven(results),
    summary,
    positionRuns,
    positionCoverage,
    totals: sumSummaries([summary, ...positionRuns.map((r) => r.summary)]),
  };
}

function statusMark(status: RlsStatus): string {
  return status === 'rls-hole' ? '✗✗'
    : status === 'rls-consistent' ? '✓'
      : status === 'member-visible' ? '·'
        : status === 'probe-blocked' ? '!'
          : '–';
}

function summaryLine(s: RlsSummary): string {
  return (
    `${s.proven} PROVEN (${s.consistent} consistent, ${s.holes} HOLES) · ` +
    `${s.unproven} NOT PROVEN (${s.memberVisible} member-visible, ${s.probeBlocked} probe-blocked, ${s.skipped} skipped)`
  );
}

export function formatRlsReport(report: RlsReport): string {
  const lines: string[] = [`\n=== objectstack verify (RLS / #1994) — ${report.app} ===`];
  for (const r of report.results) {
    lines.push(`  ${statusMark(r.status)} ${r.object}  [${r.status}] ${r.detail ?? ''}`);
  }
  const s = report.summary;
  const p = report.probe;
  lines.push(
    `  ── probe persona: ${p.label}${p.grantedObjects != null ? ` (object read+edit on ${p.grantedObjects} object(s))` : ''}`,
  );
  if (p.degraded) {
    lines.push(`  ⛔ DEGRADED RUN — ${p.degraded}`);
    lines.push('     Every verdict below proves LESS than it reads: without object-level grants the');
    lines.push('     object gate answers before record scope, so the by-id-write class is unreachable.');
  }
  lines.push(`  ── ${summaryLine(s)}`);
  // A skip must never read as a pass (#7685). The old summary line reported
  // "0 HOLES" over a run that had actually looked at 15 of 23 objects.
  if (s.unproven > 0) {
    lines.push(
      `  ⚠ ${s.unproven} of ${s.objects} object(s) were NOT proven — this run is not a clean bill of health.`,
    );
  }
  if (s.objects > 0 && s.probeBlocked === s.objects) {
    lines.push(
      '  ⛔ EVERY object was probe-blocked — the persona holds no object grants at all, so this run',
      '     established nothing. Check that the probe persona was provisioned.',
    );
  }

  // ── [#7978] Position personas ──────────────────────────────────────────────
  // Per position, never rolled into one number: a position bound to a
  // VAMA-carrying set reads every row and proves nothing, so a combined line
  // would claim N× the reach the fan-out actually has.
  const cov = report.positionCoverage;
  lines.push(
    `\n  ── position personas (#7978) — ${cov.ran.length} of ${cov.declared.length} declared position(s) probed`,
  );
  if (cov.note) lines.push(`     · ${cov.note}`);
  for (const run of report.positionRuns) {
    const rs = run.summary;
    lines.push(`  ▸ ${run.position}  (${run.probe.label})  ${summaryLine(rs)}`);
    const proven = run.results.filter((r) => r.status === 'rls-consistent').map((r) => r.object);
    if (proven.length > 0) lines.push(`      ✓ proven: ${proven.join(', ')}`);
    for (const r of run.results.filter((x) => x.status === 'rls-hole')) {
      lines.push(`      ✗✗ ${r.object}  [rls-hole] ${r.detail ?? ''}`);
    }
    if (rs.proven === 0) {
      lines.push(
        `      ⚠ this persona proved NOTHING — every object was member-visible, probe-blocked or skipped.`,
      );
    }
  }
  for (const missing of cov.notRun) {
    lines.push(`  ⛔ position '${missing.position}' was NOT probed — ${missing.reason}`);
  }

  const t = report.totals;
  if (report.positionRuns.length > 0 || cov.notRun.length > 0) {
    lines.push(`  ══ all personas: ${summaryLine(t)}   [unit: one object × persona probe]`);
  }
  return lines.join('\n');
}
