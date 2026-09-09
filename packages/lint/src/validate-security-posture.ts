// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D7] Security-domain publish linter.
 *
 * Every rule here is traceable to an observed failure class (the taxonomy
 * grows by incident, per the ADR):
 *
 * | Rule                                    | Origin                          |
 * |-----------------------------------------|---------------------------------|
 * | security-owd-unset            (error)   | objectui#2348 leave_request 事故 |
 * | security-owd-alias            (error)   | ADR-0090 D4 canonical enum — UNPARSED intakes only, see § Intake |
 * | security-external-wider       (error)   | ADR-0090 D11 external ≤ internal|
 * | security-wildcard-vama        (error)   | ADR-0066 superuser wildcard     |
 * | security-anchor-high-privilege(error)   | ADR-0090 D5/D9 anchors — declared `everyone` suggestions (`isDefault: true`) only; a `guest`-bound set is outside a package-time linter's sight and is the bind-time gate's alone (#16110) |
 * | security-role-word            (error)   | ADR-0090 D3 vocabulary freeze — own function/registry entry since #8310 |
 * | security-book-audience-unknown-set(warn)| ADR-0046 §6.7 { permissionSet } |
 * | security-private-no-readscope (info)    | admin-intent mismatch class     |
 * | security-master-detail-ungranted(warn)  | framework#2700 os-tianshun-mtc#43|
 * | security-grant-expired-at-authoring(err)| ADR-0091 D2 resolution filtering|
 * | security-delegation-missing-reason(err) | ADR-0091 D3 dual audit          |
 * | security-cbp-no-relation      (error)   | #7503 (runtime refusal #7474)   |
 * | security-cbp-ambiguous-relation(error)  | #14747 order-dependent master   |
 *
 * Per ADR-0049 discipline these are NOT advisory security: every `error` rule
 * BUT ONE mirrors a runtime enforcement point (D1 fail-closed OWD default, D4
 * zod enum + fail-closed evaluator, D5/D9 anchor binding gate, D3 rename wave)
 * — the lint moves the failure from runtime-deny to author-time fix-it.
 * `security-anchor-high-privilege` mirrors that gate for the one suggestion a
 * package can actually declare (`isDefault: true` → the `everyone` anchor,
 * `suggested-audience-bindings.ts`'s "the only declarable suggestion"); a set
 * an operator binds to `guest` at install time is a decision ADR-0090 D9
 * ("a package may suggest bindings … the admin confirms each individually")
 * puts past authoring, so this rule is not — and cannot be — coverage for an
 * app-authored anchor set bound to `guest` (#16110). That binding is held by
 * the runtime's own `describeAnchorForbiddenBits(set, 'guest')` gate instead.
 *
 * The exception INVERTS that argument rather than weakening it.
 * `security-cbp-ambiguous-relation` has no runtime refusal to mirror precisely
 * BECAUSE the runtime does not refuse: it silently PICKS a winner by field
 * declaration order, so there is no later runtime verdict for the author to
 * discover, and author time is the only place the ambiguity can surface at all
 * (#14747). What it does satisfy is the admissibility bar the #7503 push site
 * below states — a self-contained property of the object document, with no
 * per-permission-set nuance to adjudicate and no legitimate reading.
 *
 * The non-`error` rules are the ones with NO hard runtime refusal behind them
 * AND no such certainty:
 * master-detail-ungranted mirrors a runtime gate (the ADR-0055 object-level
 * CRUD check) but flags a *likely* misconfiguration whose per-permission-set
 * nuance it cannot fully adjudicate; book-audience-unknown-set and
 * private-no-readscope flag intent mismatches, not guaranteed denials.
 *
 * Pure `(stack) => Finding[]`; accepts the NORMALIZED stack input (works both
 * pre- and post-zod-parse, so `os lint` catches what the zod gate would
 * reject in `os compile` — with a better message).
 *
 * ## Scope — the keys this rule reads, and the ones it deliberately does not
 *
 * Registered `input: 'parsed'` (`authoring-rules.ts`), so on the compile path
 * it sees `ObjectStackSchema`'s output. Every key it reads is one the spec
 * DECLARES, checked structurally against the live `.shape` in
 * `validate-security-posture.test.ts`. Two reads that were not, until #5017:
 *
 * - `objects[].security.sharingModel` — **there is no `security` envelope on an
 *   object.** `ObjectSchema` declares the OWD dials flat (`sharingModel`,
 *   `externalSharingModel`, `publicSharing`) and is strict, so a stack nesting
 *   one under `security` is refused by name rather than stripped. Nothing could
 *   reach that fallback; what it did instead was describe an authorization
 *   surface that does not exist, in the security linter of all places.
 * - `objects[].fields[].reference_to` — a rejected alias of `reference`
 *   (`field.zod.ts:331`).
 *
 * Alias tolerance belongs at the schema's refusal, not in a consumer (Prime
 * Directive #12). Here it also silently downgraded a NAMED rejection into an
 * inert branch — and an inert branch in a security linter reads, to the next
 * author, as a gate that is watching (#4984, #5009, #5017).
 *
 * ## Intake — which doors can reach `security-owd-alias` at all (#16109)
 *
 * `sharingModel` and `externalSharingModel` are CLOSED enums on `ObjectSchema`
 * (ADR-0090 D4 / D11): every value `OWD_ALIAS_FIX` names — both the D4
 * aliases a shipped schema once accepted and the wrong-layer spellings it
 * never did, two histories declared as two maps below — and every other
 * non-canonical string, is refused by the schema with `invalid_value`. So on
 * any door that PARSES before the registry runs, this rule's alias branches
 * are unreachable by construction — the object never arrives. Measured on
 * this package's dist (the pins live in `authoring-rule-input-tier.test.ts`,
 * "security-owd-alias reaches the rule only through the unparsed doors"):
 *
 * | door                                                        | alias reaches the rule? |
 * |-------------------------------------------------------------|-------------------------|
 * | `defineStack(x)` (strict default) — every TS config that     | no — refused at load    |
 * |   `os init` scaffolds, hence `os validate`/`os build`/       |                         |
 * |   `os lint` on such a config                                 |                         |
 * | `os validate` / `os compile` schema step on a RAW config     | no — stops before rules |
 * | `saveMetaItem` (Studio / REST `/meta` / MCP) — the runtime   | no — 422 before the gate|
 * |   publish gate runs AFTER `getMetadataTypeSchema('object')`   |                         |
 * | a pre-D4 stored `sys_metadata` sibling in the gate's universe | no — cancels in the diff|
 * | **`os lint` on a RAW object-literal config** (never parses;   | **yes — fires**         |
 * |   `loadConfig` returns the default export as authored, and   |                         |
 * |   `owd-legacy-read-aliases` is `retiredFromLoadPath`, so      |                         |
 * |   `normalizeStackInput` leaves the alias intact)              |                         |
 * | **`defineStack(x, { strict: false })`**                        | **yes — fires**         |
 * | **`check:doc-security-posture`** (docs gate: statically        | **yes — fires**; its    |
 * |   evaluated `ObjectSchema.create({...})` literals, no parse)   | self-test asserts it    |
 * | **`runRuntimeAuthoringRules` / `validateSecurityPosture`      | **yes — fires**         |
 * |   called directly with an unparsed item** (exported API)      |                         |
 *
 * Read the two alias branches below accordingly: they are NOT a second
 * opinion on the enum, and they are dead on the parsed doors on purpose. They
 * exist so the UNPARSED doors — `os lint` first, the docs gate second — name
 * the canonical replacement instead of letting a retired or wrong-layer
 * spelling ride to `os build`, where the enum's generic `invalid_value` is the
 * only message. A
 * consumer crediting this rule id as live `error` coverage on a
 * `defineStack`-authored app is crediting the wrong gate: on that door the
 * credit belongs to the schema's closed enum.
 */

import { describeAnchorForbiddenBits } from '@objectstack/spec/security';
import { indexObjectGraph, recordsOf, type ObjectGraph } from './object-graph.js';

export const SECURITY_OWD_UNSET = 'security-owd-unset';
export const SECURITY_OWD_ALIAS = 'security-owd-alias';
export const SECURITY_EXTERNAL_WIDER = 'security-external-wider-than-internal';
export const SECURITY_WILDCARD_VAMA = 'security-wildcard-vama';
export const SECURITY_ANCHOR_HIGH_PRIVILEGE = 'security-anchor-high-privilege';
export const SECURITY_ROLE_WORD = 'security-role-word';
export const SECURITY_BOOK_AUDIENCE_UNKNOWN_SET = 'security-book-audience-unknown-set';
export const SECURITY_PRIVATE_NO_READSCOPE = 'security-private-no-readscope';
export const SECURITY_MASTER_DETAIL_UNGRANTED = 'security-master-detail-ungranted';
export const SECURITY_FLS_UNQUALIFIED_KEY = 'security-fls-unqualified-key';
export const SECURITY_FLS_UNKNOWN_FIELD = 'security-fls-unknown-field';
export const SECURITY_GRANT_EXPIRED_AT_AUTHORING = 'security-grant-expired-at-authoring';
export const SECURITY_DELEGATION_MISSING_REASON = 'security-delegation-missing-reason';
export const SECURITY_CBP_NO_RELATION = 'security-controlled-by-parent-no-relation';
export const SECURITY_CBP_AMBIGUOUS_RELATION = 'security-controlled-by-parent-ambiguous-relation';

export type SecuritySeverity = 'error' | 'warning' | 'info';

export interface SecurityFinding {
  severity: SecuritySeverity;
  /** Diagnostic rule id (`security-*`). */
  rule: string;
  /** Human-readable location, e.g. `object "leave_request"`. */
  where: string;
  /** Config path, e.g. `objects[3].sharingModel`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

const CANONICAL_OWD = ['private', 'public_read', 'public_read_write', 'controlled_by_parent'] as const;
/**
 * [ADR-0090 D4] The legacy `sharingModel` spellings a shipped schema once
 * ACCEPTED, and the canonical value each becomes. D4 names exactly these
 * THREE — "The legacy aliases `read`, `read_write`, `full` are **removed from
 * the zod enum**" — and only these three have a retirement behind them: the
 * `owd-legacy-read-aliases` ADR-0087 stored-row conversion for the two `read*`
 * spellings, and the `13.owd-full-alias-removed` semantic entry for `full`.
 */
const OWD_RETIRED_ALIAS_FIX: Record<string, string> = {
  read: 'public_read',
  read_write: 'public_read_write',
  full: 'public_read_write',
};

/**
 * Wrong-layer / misspelling fix-its: values NO shipped schema ever accepted
 * *here*. They are NOT retired aliases, and nothing sits behind them to
 * retire — no ADR-0087 conversion, no semantic-migration entry, and none is
 * possible, because a conversion rewrites a spelling some shipped schema once
 * took and the stored population for these is zero by construction (#16517
 * read the enum's whole lifetime over complete history; `public` appears in no
 * version of it).
 *
 * `public` is kept here rather than deleted because it catches a real
 * authoring mistake. THREE neighbouring keys on the same `ObjectSchema` take
 * `'public'` legally — `access.default` (`z.enum(['public', 'private'])`,
 * ADR-0066) and `publicSharing.allowedAudiences`
 * (`z.enum(['public', 'link_only', 'signed_in', 'email'])`) — and off-schema
 * so does the sharing runtime's own internal vocabulary,
 * `effectiveSharingModel(): 'private' | 'read' | 'public'`. `sharingModel` is
 * the one neighbour that refuses it, and it fails CLOSED to `private` with no
 * notice on the read path, so this fix-it is the author's only signal.
 */
const OWD_WRONG_LAYER_FIX: Record<string, string> = {
  public: 'public_read_write',
};

/** Every value this rule offers a fix-it for — both provenance groups. */
const OWD_ALIAS_FIX: Record<string, string> = { ...OWD_RETIRED_ALIAS_FIX, ...OWD_WRONG_LAYER_FIX };
/** D11 ordering for external ≤ internal (controlled_by_parent excluded). */
const OWD_WIDTH: Record<string, number> = {
  private: 0,
  public_read: 1,
  public_read_write: 2,
};

/**
 * The object's org-wide default.
 *
 * `sharingModel` is the whole of it. There is no `objects[].security` envelope
 * to fall back to and there never was: `ObjectSchema.shape` carries
 * `sharingModel` / `externalSharingModel` / `publicSharing` flat, declares no
 * `security` key, and is strict — a stack nesting the OWD under `security` is
 * REFUSED ("Unrecognized key(s) on this object: `security`"), not stripped. So
 * the fallback removed in #5017 could not run for any stack an author can ship;
 * what it could do is tell the next reader that `object.security.sharingModel`
 * is a real authorization surface. See the `## Scope` note on this module.
 */
function owdOf(obj: AnyRec): unknown {
  return obj.sharingModel;
}

/**
 * The provenance half of an alias finding's message.
 *
 * The two halves of `OWD_ALIAS_FIX` do not share a history, so one sentence
 * cannot serve both: calling `public` "a retired alias (ADR-0090 D4)" asserts
 * an acceptance that never happened, and sends the reader looking for the
 * conversion and the semantic entry that would exist if it had. The fix-it is
 * identical either way; only this clause differs.
 *
 * The sibling keys are named undotted on purpose: the receiver-coverage
 * meta-test in this rule's test file scans the module's CODE text for
 * `receiver.key` reads and cannot tell one inside a message string from a real
 * read, so a dotted spelling here would present as an undeclared read off a
 * receiver that does not exist.
 */
function owdAliasProvenance(value: string): string {
  return OWD_RETIRED_ALIAS_FIX[value]
    ? `is a retired alias (ADR-0090 D4)`
    : `is not an OWD value and never was — ADR-0090 D4 retired 'read', 'read_write' and 'full', ` +
        `not this. '${value}' is legal on the neighbouring keys 'access' (its 'default') and ` +
        `'publicSharing' (its 'allowedAudiences'), just not on this one`;
}

/**
 * A platform / system object: one the tenant did not author.
 *
 * Exported (#9612) so the runtime gate's package-closure narrowing keeps
 * system objects unconditionally inside the closure using THIS predicate,
 * rather than a second opinion about what "system" means. A package that
 * references a platform object, judged against a closure that omitted it,
 * would report an unresolved reference that is not there — so the two
 * readings have to be one reading.
 */
export function isSystemObject(obj: AnyRec): boolean {
  return obj.isSystem === true || String(obj.name ?? '').startsWith('sys_');
}

/** snake_case identifier contains the reserved token `role`/`roles`. */
function identifierHasRoleToken(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((tok) => tok === 'role' || tok === 'roles');
}

/** Free-text label contains the whole word `role(s)` (case-insensitive). */
function labelHasRoleWord(label: unknown): boolean {
  if (typeof label !== 'string') return false;
  return /\brole(s)?\b/i.test(label);
}

/**
 * The `reference` target a relationship field points at.
 *
 * `reference` is the only spelling `FieldSchema` declares; `reference_to` (like
 * `referenceTo` / `relatedTo` / `target`) is a rejected alias the strict error
 * map renames for the author, so a field carrying it does not parse (#5017).
 */
function refOf(def: AnyRec): string | undefined {
  const r = def.reference as unknown;
  return typeof r === 'string' && r ? r : undefined;
}

/**
 * The first `master_detail` field on an object, if any — its presence is what
 * makes the object a DETAIL (the child side of a master-detail; ADR-0055).
 * Works for both the array and name-keyed-map field forms (`recordsOf` folds the
 * map key into `name`).
 */
function firstMasterDetailField(obj: AnyRec): { name: string; parent?: string } | undefined {
  for (const f of recordsOf(obj.fields)) {
    if (f.type === 'master_detail') {
      return { name: String(f.name ?? '?'), parent: refOf(f) };
    }
  }
  return undefined;
}

/** A master relation the platform can derive `controlled_by_parent` access from. */
interface CbpRelation {
  /** The field that answers. */
  field: string;
  /** `master_detail` or `lookup`. */
  type: string;
  /** The object it references. */
  master: string;
}

/**
 * [#7503] The master-relation precedence, as ONE table both CBP rules read.
 *
 * A point-for-point mirror of `resolveCbpRelation` in
 * `packages/plugins/plugin-security/src/security-plugin.ts` — the SAME
 * three-step fallback, in the same order, with the same "must also carry a
 * reference target" condition folded into each step (`pick` there requires
 * `pred(f) && ref(f)`, so a `master_detail` naming no target resolves nothing):
 *
 *   1. a `required` `master_detail` with a reference, else
 *   2. ANY `master_detail` with a reference, else
 *   3. a `required` `lookup` with a reference.
 *
 * `required` is read for truthiness, not `=== true`, because the runtime does
 * (`f?.required`) — mirroring the gate means mirroring its coercions too.
 *
 * The tiers are a table rather than a `??` chain spelled twice because the
 * no-relation rule and the ambiguity rule (#14747) must not be able to disagree
 * about which tier wins: one says "no tier matched", the other says "the tier
 * that matched holds more than one candidate", and those are answers to the
 * same question. The `label` is author-facing — it appears in the ambiguity
 * message, so the tier the author is told about is the tier that was tested.
 *
 * The one DELIBERATE divergence from the runtime is the reference spelling. The
 * runtime accepts `reference ?? reference_to ?? referenceTo`; `refOf` here
 * accepts only `reference`, the sole spelling `FieldSchema` declares. The
 * aliases do not parse (strict schema, #5017), so for any stack an author can
 * ship the two agree; re-introducing the alias fallback here would restore
 * precisely the inert branch #5017 removed, and on the pre-parse path the
 * schema already names the real defect (the alias key) rather than this rule
 * guessing past it.
 */
const CBP_TIERS: ReadonlyArray<{ label: string; pred: (f: AnyRec) => boolean }> = [
  { label: 'required master_detail', pred: (f) => f.type === 'master_detail' && !!f.required },
  { label: 'any master_detail', pred: (f) => f.type === 'master_detail' },
  { label: 'required lookup', pred: (f) => f.type === 'lookup' && !!f.required },
];

/**
 * [#7503 / #14747] The WINNING tier and EVERY candidate in it, in declaration
 * order — `undefined` when no tier matches (nothing to derive access from).
 *
 * Only the winning tier is reported on, and that is not a simplification: the
 * runtime's `??` chain stops at the first tier that resolves, so a tie in a
 * lower tier is masked by a higher tier's single winner and is not a decision
 * the platform ever makes. Reordering fields inside a masked tier changes
 * nothing, and reporting it would be reporting a non-defect.
 */
function cbpMasterCandidates(obj: AnyRec): { tier: string; candidates: CbpRelation[] } | undefined {
  const entries = recordsOf(obj.fields);
  for (const { label, pred } of CBP_TIERS) {
    const matched = entries.filter((f) => pred(f) && refOf(f));
    if (matched.length > 0) {
      return {
        tier: label,
        candidates: matched.map((f) => ({
          field: String(f.name ?? '?'),
          type: String(f.type),
          master: refOf(f) as string,
        })),
      };
    }
  }
  return undefined;
}

/**
 * [#7503] The relation a `controlled_by_parent` object derives its access from,
 * or `undefined` when the platform has nothing to derive from.
 *
 * The runtime's winner, exactly: `Array.prototype.find` over a tier is the
 * first element `filter` over that same tier keeps, and the first tier with a
 * candidate is the tier the `??` chain stops at — so `candidates[0]` of the
 * winning tier IS `pick(...) ?? pick(...) ?? pick(...)`, with the ambiguity the
 * runtime resolves by position now visible to the caller instead of discarded.
 */
function resolveCbpRelation(obj: AnyRec): CbpRelation | undefined {
  return cbpMasterCandidates(obj)?.candidates[0];
}

/**
 * Does a per-object permission entry open the object-level CRUD gate at all?
 * Any of the four CRUD bits, or a super-user bypass (View/Modify All Data),
 * counts — this mirrors the runtime `checkObjectPermission` gate (ADR-0066 D2):
 * that gate returns true if ANY set contributes one of these for the object.
 */
function grantsObjectAccess(p: AnyRec): boolean {
  return (
    p.allowRead === true ||
    p.allowCreate === true ||
    p.allowEdit === true ||
    p.allowDelete === true ||
    p.viewAllRecords === true ||
    p.modifyAllRecords === true
  );
}

/**
 * Validate the security posture of a stack. Returns findings (empty = clean).
 * `error` findings gate the build in `os compile`; `info` is advisory.
 *
 * `opts.nowMs` injects the clock for the ADR-0091 authoring-time expiry rule
 * (tests); production callers omit it.
 */
export function validateSecurityPosture(stack: AnyRec, opts?: { nowMs?: number }): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const objects = recordsOf(stack.objects);
  const permissionSets = recordsOf(stack.permissions);

  // ── D1/D4/D11: per-object OWD posture ────────────────────────────────
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj || typeof obj !== 'object') continue;
    const objName = typeof obj.name === 'string' ? obj.name : `(object ${i})`;
    const objPath = `objects[${i}]`;
    const owd = owdOf(obj);
    const external = obj.externalSharingModel;

    if (!isSystemObject(obj)) {
      if (owd == null) {
        findings.push({
          severity: 'error',
          rule: SECURITY_OWD_UNSET,
          where: `object "${objName}"`,
          path: `${objPath}.sharingModel`,
          message:
            `custom object "${objName}" declares no sharingModel (OWD). The runtime fails ` +
            `CLOSED to 'private' (ADR-0090 D1), but the baseline must be an authored decision, ` +
            `not an accident — this is the exact shape of the leave_request incident (objectui#2348).`,
          hint:
            `Declare sharingModel explicitly: 'private' (owner + shares; recommended default), ` +
            `'public_read', 'public_read_write', or 'controlled_by_parent' (master-detail children).`,
        });
      } else if (typeof owd === 'string' && OWD_ALIAS_FIX[owd]) {
        // Reachable ONLY through the unparsed doors (`os lint` on a raw
        // config, `strict: false`, the docs gate, a direct call) — the D4 enum
        // refuses this value on every parsed door before the registry runs.
        // See "## Intake" in this module's docblock (#16109).
        findings.push({
          severity: 'error',
          rule: SECURITY_OWD_ALIAS,
          where: `object "${objName}"`,
          path: `${objPath}.sharingModel`,
          message:
            `sharingModel '${owd}' ${owdAliasProvenance(owd)}. The runtime fails CLOSED ` +
            `to 'private' on unknown values, so this object is NOT ${owd === 'read' ? 'readable' : 'writable'} org-wide.`,
          hint: `Replace with the canonical value: sharingModel: '${OWD_ALIAS_FIX[owd]}'.`,
        });
      } else if (typeof owd === 'string' && !(CANONICAL_OWD as readonly string[]).includes(owd)) {
        findings.push({
          severity: 'error',
          rule: SECURITY_OWD_ALIAS,
          where: `object "${objName}"`,
          path: `${objPath}.sharingModel`,
          message:
            `sharingModel '${owd}' is not a canonical OWD value; the runtime fails CLOSED to 'private'.`,
          hint: `Use one of: ${CANONICAL_OWD.join(', ')}.`,
        });
      }
    }

    // ── [#7503] controlled_by_parent with nothing to derive access FROM ──
    // The object says "my access comes from my master" and names no master.
    // Both runtime halves of ADR-0055 already refuse this shape, and neither
    // is a judgement call the linter has to second-guess:
    //   - writes → 422 INVALID_METADATA (`MasterDetailRelationMissingError`,
    //     the #7474 split — a metadata defect, explicitly NOT an access verdict)
    //   - reads  → `computeControlledByParentFilter` returns RLS_DENY_FILTER,
    //     so every read is denied too (defense-in-depth, whose own comment says
    //     "spec validation should prevent authoring it" — this rule is that).
    // So it is `error`, not advisory: it mirrors a hard runtime enforcement
    // point exactly (the ADR-0090 D7 / ADR-0049 criterion at the head of this
    // file), and the defect is a self-contained property of the object document
    // — no per-permission-set nuance to adjudicate, no legitimate reading.
    //
    // NOT exempted for system objects, unlike the D1 unset-OWD rule above: the
    // runtime refusal does not exempt them either, and an object declaring a
    // derivation it cannot perform is broken on its own terms, independent of
    // who may author it.
    if (owd === 'controlled_by_parent' && !resolveCbpRelation(obj)) {
      findings.push({
        severity: 'error',
        rule: SECURITY_CBP_NO_RELATION,
        where: `object "${objName}"`,
        path: `${objPath}.sharingModel`,
        message:
          `"${objName}" declares sharingModel 'controlled_by_parent' but has no relation the platform ` +
          `can derive access from. ADR-0055 resolves the master through a required master_detail, then ` +
          `any master_detail, then a required lookup — each of which must also name a reference target — ` +
          `and this object matches none of the three. At runtime every read is DENIED and every write is ` +
          `refused with 422 INVALID_METADATA (#7474), so the object is unusable rather than merely locked down.`,
        hint:
          `Add the master relation this object is derived from, e.g. fields.parent: ` +
          `{ type: 'master_detail', reference: '<master_object>', required: true }. If the object has no ` +
          `master, its baseline is its own decision — use sharingModel: 'private' (owner + shares), ` +
          `'public_read', or 'public_read_write'.`,
      });
    }

    // ── [#14747] controlled_by_parent whose master is decided by ORDER ────
    // The opposite defect to the one above: not zero candidates, but TWO OR
    // MORE in the tier that wins. `pick` is `find` here and in the runtime, so
    // the master is whichever candidate the field map happens to list first —
    // field declaration order, a property that carries no authored meaning.
    // Moving a field up or down a schema file is a review-invisible edit that
    // reads as cosmetic, and it silently repoints the record-level security of
    // every row of the object. Nothing reports it at runtime: the platform does
    // not refuse, it picks (#14747).
    //
    // `error`, not advisory, and for the INVERSE of the usual reason — there is
    // no runtime refusal to mirror BECAUSE the runtime silently decides, which
    // makes author time the only place this can ever surface. The
    // admissibility bar is the one the rule above states and this shape meets
    // identically: a self-contained property of the object document, no
    // per-permission-set nuance to adjudicate, and no legitimate reading — two
    // tied candidates is not an author saying which master they meant. See the
    // ADR-0049 paragraph in the module header.
    //
    // NOT exempted for system objects, for the same reason the rule above is
    // not: the ambiguity is a property of the document, independent of who may
    // author it.
    const cbpTier = owd === 'controlled_by_parent' ? cbpMasterCandidates(obj) : undefined;
    if (cbpTier && cbpTier.candidates.length > 1) {
      const winner = cbpTier.candidates[0];
      const roster = cbpTier.candidates
        .map((cand) => `"${cand.field}" (${cand.type} -> "${cand.master}")`)
        .join(', ');
      findings.push({
        severity: 'error',
        rule: SECURITY_CBP_AMBIGUOUS_RELATION,
        where: `object "${objName}"`,
        path: `${objPath}.fields`,
        message:
          `"${objName}" declares sharingModel 'controlled_by_parent' and ${cbpTier.candidates.length} of its ` +
          `fields tie for the master relation: ${roster}. ADR-0055 resolves the master through a required ` +
          `master_detail, then any master_detail, then a required lookup, and takes the FIRST match in the ` +
          `tier that wins — here the ${cbpTier.tier} tier — so which object this one derives its access from ` +
          `is decided by FIELD DECLARATION ORDER. Today "${winner.field}" wins and every row's record-level ` +
          `access derives from "${winner.master}"; reordering these fields moves that security boundary to ` +
          `another object, and the runtime reports nothing when it does.`,
        hint:
          `Leave exactly ONE candidate in the winning tier, so the master is authored rather than positional. ` +
          `Either promote the intended master into a higher tier — make it the object's only required ` +
          `master_detail ({ type: 'master_detail', reference: '<master_object>', required: true }) — or demote ` +
          `the others in this tier (drop required, or change the relation type). Precedence is required ` +
          `master_detail, then any master_detail, then a required lookup; only a tie inside the tier that ` +
          `WINS is ambiguous.`,
      });
    }

    // D11: external dial present on any object (system included) must obey
    // external ≤ internal. controlled_by_parent inherits the master's pair.
    if (typeof external === 'string') {
      if (OWD_ALIAS_FIX[external]) {
        // Same intake note as the `sharingModel` alias branch above: the D11
        // enum is closed, so only the unparsed doors can deliver this value.
        findings.push({
          severity: 'error',
          rule: SECURITY_OWD_ALIAS,
          where: `object "${objName}"`,
          path: `${objPath}.externalSharingModel`,
          message: `externalSharingModel '${external}' ${owdAliasProvenance(external)}.`,
          hint: `Replace with the canonical value: externalSharingModel: '${OWD_ALIAS_FIX[external]}'.`,
        });
      } else if (
        typeof owd === 'string' &&
        external in OWD_WIDTH &&
        owd in OWD_WIDTH &&
        OWD_WIDTH[external] > OWD_WIDTH[owd]
      ) {
        findings.push({
          severity: 'error',
          rule: SECURITY_EXTERNAL_WIDER,
          where: `object "${objName}"`,
          path: `${objPath}.externalSharingModel`,
          message:
            `externalSharingModel '${external}' is WIDER than the internal sharingModel '${owd}' — ` +
            `the external baseline must never exceed the internal one (ADR-0090 D11).`,
          hint: `Narrow externalSharingModel to '${owd}' or below (ordering: private < public_read < public_read_write).`,
        });
      }
    }
  }

  // [#16108] The object graph, for the FLS field-existence rule below. Built
  // ONCE here rather than per permission set: `indexObjectGraph` walks every
  // object's whole field map, and a stack with N sets would otherwise pay for
  // that walk N times to answer the same question.
  //
  // ⚠️ This is the SHARED index every field-existence rule in this package
  // resolves through (`object-graph.ts`), not a second field-set reader written
  // for this rule — the three skips it encodes (an object this stack does not
  // define, an object with no readable field map, registry-injected system
  // columns) are exactly the three this rule must take, and re-deriving them
  // here would be the drift that module exists to prevent.
  const flsGraph: ObjectGraph = indexObjectGraph(stack);

  // ── ADR-0066 / D5/D9: permission-set posture ─────────────────────────
  for (let i = 0; i < permissionSets.length; i++) {
    const ps = permissionSets[i];
    if (!ps || typeof ps !== 'object') continue;
    const psName = typeof ps.name === 'string' ? ps.name : `(permission set ${i})`;
    const psPath = `permissions[${i}]`;
    const objectsMap = (ps.objects && typeof ps.objects === 'object' ? ps.objects : {}) as AnyRec;

    // [#19 / permission zoo audit] FLS keys MUST be `<object>.<field>`
    // qualified. The runtime evaluator matches keys by object prefix
    // (`getFieldPermissions`: `key.startsWith(objectName + '.')`), so a bare
    // `budget` key matches NOTHING — the declared masking silently never
    // enforces (the worst declared-≠-enforced class, ADR-0049). The showcase
    // itself shipped this bug for months.
    const flsMap = (ps.fields && typeof ps.fields === 'object' ? ps.fields : {}) as AnyRec;
    for (const flsKey of Object.keys(flsMap)) {
      if (flsKey.includes('.')) continue;
      findings.push({
        severity: 'error',
        rule: SECURITY_FLS_UNQUALIFIED_KEY,
        where: `permission set "${psName}"`,
        path: `${psPath}.fields["${flsKey}"]`,
        message:
          `field-permission key '${flsKey}' is not object-qualified — the runtime matches FLS keys ` +
          `by '<object>.<field>' prefix, so a bare key is silently IGNORED and the declared masking never enforces.`,
        hint: `Qualify the key with its object, e.g. 'crm_opportunity.${flsKey}': { readable: true, editable: false }.`,
      });
    }

    // [#16108] …and the OTHER half of the same failure: a key that IS
    // object-qualified but names a field the object does not have.
    //
    // Deliberately a SECOND rule beside `security-fls-unqualified-key` rather
    // than a widening of it. That rule's own id says *unqualified*, and it is
    // correct inside that scope; the two defects have different prescriptions
    // (add the object prefix / fix the field name) and an author who suppresses
    // one must not thereby suppress the other. Two ids, two messages, two
    // loops over the same map, with disjoint guards.
    //
    // The runtime consequence is IDENTICAL, and it is the fail-OPEN direction.
    // `PermissionEvaluator.getFieldPermissions` keeps a key only when
    // `key.startsWith(`${objectName}.`)` and then reads the remainder as a
    // column name (`key.substring(objectName.length + 1)`), so a remainder no
    // column answers to contributes nothing to the merged map: the entry the
    // author wrote to MASK a field masks nothing, and the field stays exactly
    // as readable and as editable as the object-level grant leaves it. Silent
    // at author time, silent at runtime, and — unlike the bare key — it LOOKS
    // right in review. It is what a field rename leaves behind, which is why
    // it accumulates rather than being caught once.
    //
    // Splitting on the FIRST dot mirrors that evaluator exactly, because an
    // object name cannot contain one: `ObjectSchema.name` is
    // `/^[a-z_][a-z0-9_]*$/`. So for any key the evaluator would attribute to
    // object O, the head here IS O — and a key with more dots still
    // (`crm_account.owner.name`) is judged on the whole remainder, which is
    // also what the evaluator looks up: FLS keys address columns, never joins.
    //
    // `error`, on the inverse of the usual ADR-0049 argument and the same one
    // `security-cbp-ambiguous-relation` above makes: there is no runtime
    // refusal to mirror BECAUSE the runtime does not refuse — it silently
    // ignores the key — so author time is the only place this can ever
    // surface. It meets the same admissibility bar: decidable from the
    // documents in front of the linter, no per-permission-set nuance to
    // adjudicate, and no legitimate reading (a key that can never match is not
    // an author saying which field they meant).
    //
    // The three skips are the graph's, not this rule's, and each is the
    // difference between a finding and a false one (ADR-0072 D1): an object
    // this stack does not define may be another installed package's; an object
    // with no readable field map (ADR-0015 `external`, an introspected
    // datasource) resolves its columns at runtime; and a registry-injected
    // system column (`created_at`, `owner_id` where ownership provides one) is
    // real and addressable while appearing in no authored `fields`.
    for (const flsKey of Object.keys(flsMap)) {
      const dot = flsKey.indexOf('.');
      if (dot < 0) continue; // the bare-key shape — judged by the rule above
      const flsObject = flsKey.slice(0, dot);
      const flsField = flsKey.slice(dot + 1);
      if (!flsGraph.has(flsObject)) continue; // skip 1: not this stack's object
      const surface = flsGraph.get(flsObject);
      if (!surface) continue; // skip 2: no readable field map
      if (surface.names.has(flsField) || surface.injected.has(flsField)) continue; // resolves (skip 3 included)

      // [#16108] The EMPTY remainder (`'crm_account.'`) is the same defect and
      // is reported by this rule, not deferred to the schema.
      //
      // ⚠️ An earlier revision skipped it with the comment "a shape the schema
      // owns". That was FALSE, and measured to be: `PermissionSetSchema.fields`
      // is `z.record(z.string(), FieldPermissionSchema)`
      // (`packages/spec/src/security/permission.zod.ts`) — a bare `z.string()`
      // key with no `.regex`, and that file carries no `refine`/`superRefine`
      // at all — and this loop is the only reader of permission-set `fields`
      // keys in this package. So nothing anywhere reported it, while at runtime
      // it passes `startsWith('crm_account.')` and resolves to the empty column
      // name, matching no column: the same fail-open this rule exists to close.
      // ⛔ A comment crediting coverage to a component that has none is how a
      // real gap gets recorded as handled — the accounting trap this card's own
      // downstream note is about, one level in.
      //
      // It is judged HERE, after the two object skips, and deliberately not
      // before them. An empty field name is in fact unmatchable independently
      // of the object — `FieldSchema.name` is `/^[a-z_][a-z0-9_]*$/`, so no
      // object of any package can declare one — but hoisting the check above
      // skip 1 would start this rule judging keys whose OBJECT half it cannot
      // resolve, which is exactly the disposition `'.description'` (empty
      // object name) and a mis-cased object name are deliberately left to. One
      // story, one guard order: the object must be visible before the key is
      // judged. `'no_such_object.'` therefore falls to skip 1, like every other
      // key naming an object this stack does not define.
      const emptyField = flsField.length === 0;

      const declared = [...surface.names].sort();
      const roster = declared.length <= 12 ? declared.join(', ') : `${declared.slice(0, 12).join(', ')}, …`;
      const wrote = emptyField
        ? `field-permission key '${flsKey}' names NO field — everything after the '${flsObject}.' prefix is empty`
        : `field-permission key '${flsKey}' is object-qualified but "${flsObject}" declares no field '${flsField}'`;
      const looksRight = emptyField
        ? `A truncated key is what a half-finished edit leaves behind.`
        : `Unlike an unqualified key this one looks correct in review, and it is exactly what a field rename leaves behind.`;
      findings.push({
        severity: 'error',
        rule: SECURITY_FLS_UNKNOWN_FIELD,
        where: `permission set "${psName}"`,
        path: `${psPath}.fields["${flsKey}"]`,
        message:
          `${wrote}. The runtime resolves an FLS key by stripping the '${flsObject}.' prefix and ` +
          `looking the remainder up as a column, so this key matches NOTHING: the masking it declares ` +
          `NEVER ENFORCES, and the field it was meant to cover stays as readable and as editable as the ` +
          `object-level grant leaves it — for every holder of this set. Nothing reports that at runtime. ` +
          `${looksRight}`,
        hint:
          `Point the key at a field "${flsObject}" really declares (${roster}), or delete the entry if the ` +
          `field is gone — an entry that cannot match is not protection. If the masking is still wanted, ` +
          `renaming the key is the fix; if the field was renamed, the mask has been off since that rename.`,
      });
    }

    const wildcard = objectsMap['*'] as AnyRec | undefined;
    if (wildcard && (wildcard.viewAllRecords === true || wildcard.modifyAllRecords === true)) {
      findings.push({
        severity: 'error',
        rule: SECURITY_WILDCARD_VAMA,
        where: `permission set "${psName}"`,
        path: `${psPath}.objects.*`,
        message:
          `'*' wildcard carrying View All / Modify All Data — a package-authored superuser. ` +
          `Only the platform's own admin set may combine the wildcard with VAMA (ADR-0066).`,
        hint:
          `Enumerate the objects this set really needs, or drop viewAllRecords/modifyAllRecords ` +
          `from the wildcard entry. App-level admins belong in an ordinary set the customer binds ` +
          `to a position of their choosing (ADR-0090 D9).`,
      });
    }

    // D5: an isDefault set is a SUGGESTED binding to the `everyone` anchor —
    // hold it to the anchor tier at author time (the runtime gate enforces the
    // same predicate at bind time; this moves the failure to the author).
    // Scope: `isDefault: true` is the only declarable suggestion today — a set
    // an operator binds to `guest` at install carries no author-time flag for
    // this rule to key off, so that binding is outside what a package-time
    // linter can see and is judged by the bind-time gate alone (#16110).
    if (ps.isDefault === true) {
      const offending = describeAnchorForbiddenBits(ps, 'everyone');
      if (offending) {
        findings.push({
          severity: 'error',
          rule: SECURITY_ANCHOR_HIGH_PRIVILEGE,
          where: `permission set "${psName}"`,
          path: `${psPath}.isDefault`,
          message:
            `isDefault:true suggests binding this set to the 'everyone' audience anchor, but it ` +
            `carries ${offending} — the runtime will refuse the binding (ADR-0090 D5/D9).`,
          hint:
            `Split the powerful bits into a separate set granted through ordinary positions, and ` +
            `keep the everyone-suggested set low-privilege.`,
        });
      }
    }
  }

  // ── D3 (`security-role-word`) lives in `validateSecurityRoleWord` below ──
  // [#8310] Extracted into its own registry entry when the rest of this block
  // crossed onto the runtime publish surface. The rule judges six collections
  // (objects — names, fields, actions —, permission sets, positions, apps,
  // books), and the per-write snapshot neither carries nor maps `positions` /
  // `apps` — so it crosses that wall WHOLE or stays behind (#7220), and it
  // stays behind. Keeping it inside this function would have wired it for a
  // strict subset of its collections the moment this block's `runtimeTypes`
  // widened: a door that refuses a permission set named `role_manager` while
  // a position named `sales_role` walks through — the exact split the
  // registry's #7220 pin refuses to build.

  // ── Book audience → permission-set reference must resolve ────────────
  // A `{ permissionSet }` book audience names a set the reader must hold
  // (ADR-0046 §6.7). The runtime fails CLOSED on an unknown name (nobody
  // holds it → nobody reads the book), so a typo is not a leak — but it IS
  // the "why can nobody see the Admin Guide" support class, and packages
  // should gate their books on their own sets (ADR-0090 D9 / ADR-0086
  // provenance). Advisory: an environment-authored book may legitimately
  // reference an installed package's set that is not in THIS stack.
  const stackSetNames = new Set(
    permissionSets
      .map((ps) => (typeof ps.name === 'string' ? ps.name : undefined))
      .filter((n): n is string => !!n),
  );
  for (const [i, book] of recordsOf(stack.books).entries()) {
    const audience = (book as AnyRec).audience;
    if (!audience || typeof audience !== 'object') continue;
    const setName = (audience as AnyRec).permissionSet;
    if (typeof setName !== 'string' || setName.length === 0) continue;
    if (!stackSetNames.has(setName)) {
      findings.push({
        severity: 'warning',
        rule: SECURITY_BOOK_AUDIENCE_UNKNOWN_SET,
        where: `book "${String(book.name ?? i)}"`,
        path: `books[${i}].audience.permissionSet`,
        message:
          `book audience references permission set "${setName}", which this stack does not declare. ` +
          `The runtime fails closed — no holder means NO reader can open the book.`,
        hint:
          `Gate the book on one of this package's own permission sets (ADR-0090 D9, e.g. its admin set), ` +
          `or fix the typo. Ignore if the set is intentionally provided by another installed package.`,
      });
    }
  }

  // ── Admin-intent mismatch: private object, plain read, no depth ──────
  // An object whose baseline is private (explicit or D1-defaulted) where a set
  // grants allowRead with neither readScope nor viewAllRecords: every reader
  // sees ONLY their own records. Legitimate (personal to-dos) often enough
  // that this stays `info` — but it is the #1 "why can't 李四 see the data"
  // support class, so say it out loud at author time.
  const privateObjects = new Set(
    objects
      .filter((o) => o && typeof o === 'object' && !isSystemObject(o))
      .filter((o) => {
        const owd = owdOf(o);
        return owd == null || owd === 'private';
      })
      .map((o) => String(o.name ?? '')),
  );
  if (privateObjects.size > 0) {
    for (let i = 0; i < permissionSets.length; i++) {
      const ps = permissionSets[i];
      if (!ps || typeof ps !== 'object') continue;
      const psName = typeof ps.name === 'string' ? ps.name : `(permission set ${i})`;
      const objectsMap = (ps.objects && typeof ps.objects === 'object' ? ps.objects : {}) as AnyRec;
      for (const [objName, rawPerm] of Object.entries(objectsMap)) {
        if (!privateObjects.has(objName)) continue;
        const p = (rawPerm ?? {}) as AnyRec;
        if (p.allowRead === true && p.readScope == null && p.viewAllRecords !== true) {
          findings.push({
            severity: 'info',
            rule: SECURITY_PRIVATE_NO_READSCOPE,
            where: `permission set "${psName}"`,
            path: `permissions[${i}].objects.${objName}.readScope`,
            message:
              `"${objName}" is private (OWD) and this set grants allowRead without a readScope — ` +
              `holders see ONLY records they own (plus explicit shares).`,
            hint:
              `If that is intended (personal data), ignore this. Otherwise add readScope: ` +
              `'own_and_reports' | 'unit' | 'unit_and_below' | 'org', or widen the object's sharingModel.`,
          });
        }
      }
    }
  }

  // ── ADR-0055: master-detail DETAIL object with no object-level CRUD ───
  // A master-detail CHILD derives its RECORD-level scope from the master
  // (`controlled_by_parent`) — but that is gate ②. Object-level CRUD is a
  // SEPARATE gate ① (`checkObjectPermission`) that is NEVER derived: a set that
  // lists the parent but forgets the child denies role-bound non-admin users a
  // 403 *before* the parent-derived access is ever consulted, surfacing as the
  // silent "can't fill in / can't submit the subtable" trap (framework#2700,
  // downstream os-tianshun-mtc#43). Statically detectable: a detail (has a
  // master_detail field) that NO authored permission set grants.
  //
  // Advisory `warning` — it does not gate the build. Two deliberate silences
  // keep the false-positive rate near zero: (a) if the package authors no
  // permission sets there is nothing to compare against, and (b) a package-
  // declared `'*'` wildcard grant is treated as covering every object (a broad
  // grant is an explicit choice — suppress rather than cry wolf). The residual
  // per-set gap (one role grants it, another forgets it) is intentionally out
  // of scope (issue #2700); the platform's own default admin set lives outside
  // the linted stack, so it never masks a package that forgot the child here.
  if (permissionSets.length > 0) {
    const wildcardGrantsAll = permissionSets.some((ps) =>
      grantsObjectAccess(((ps.objects as AnyRec | undefined)?.['*'] ?? {}) as AnyRec),
    );
    if (!wildcardGrantsAll) {
      const grantedObjects = new Set<string>();
      for (const ps of permissionSets) {
        const objectsMap = (ps.objects && typeof ps.objects === 'object' ? ps.objects : {}) as AnyRec;
        for (const [objName, rawPerm] of Object.entries(objectsMap)) {
          if (objName === '*') continue;
          if (grantsObjectAccess((rawPerm ?? {}) as AnyRec)) grantedObjects.add(objName);
        }
      }
      for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        if (!obj || typeof obj !== 'object' || isSystemObject(obj)) continue;
        const objName = typeof obj.name === 'string' ? obj.name : '';
        if (!objName || grantedObjects.has(objName)) continue;
        const md = firstMasterDetailField(obj);
        if (!md) continue;
        const parentText = md.parent ? ` → "${md.parent}"` : '';
        findings.push({
          severity: 'warning',
          rule: SECURITY_MASTER_DETAIL_UNGRANTED,
          where: `object "${objName}"`,
          path: `objects[${i}].fields.${md.name}`,
          message:
            `detail object "${objName}" (master_detail "${md.name}"${parentText}) has no object-level ` +
            `CRUD grant in any permission set. A master-detail child derives its RECORD-level access ` +
            `from the master (ADR-0055 controlled_by_parent), but object-level CRUD is a SEPARATE gate ` +
            `that is never derived — role-bound non-admin users are denied (403) before the ` +
            `parent-derived access is ever consulted (the silent "can't submit the subtable" trap).`,
          hint:
            `Grant "${objName}" in at least one permission set that already grants its master` +
            `${md.parent ? ` "${md.parent}"` : ''} — e.g. permissions[i].objects.${objName} = ` +
            `{ allowRead: true, allowCreate: true, allowEdit: true }. If no role should ever touch ` +
            `it (a pure system/internal table), name it sys_* or set isSystem: true.`,
        });
      }
    }
  }

  // ── ADR-0091: authored grant rows (seed data) — lifecycle sanity ──────
  // Grant assignments authored as seed data on the two user-grant tables.
  // Both rules mirror runtime enforcement (D2 resolution-time filtering; the
  // D3 delegation gate), per the ADR-0049 "no advisory security" discipline:
  // the lint moves the failure from silent-dead-grant to author-time fix-it.
  // The two rules deliberately do NOT share one object scope: D2 covers both
  // grant tables (`valid_until` is declared and resolution-enforced on both),
  // while D3 is scoped to `sys_user_position` only — `delegated_from` was
  // RETIRED from `sys_user_permission_set` (#9730, maintainer ruling
  // 2026-08-18, ADR-0049 enforce-or-remove: the runtime delegation gate is
  // structurally scoped to the position table, so on the permission-set table
  // this rule was the column's ONLY enforcement — authoring-advisory security
  // on a column no runtime consumer read). A seed row that still carries the
  // key there is refused by the engine's schema preflight (400 INVALID_FIELD)
  // as an undeclared field, which is louder and located; linting the retired
  // key here again would imply the column still exists.
  const GRANT_SEED_OBJECTS = new Set(['sys_user_position', 'sys_user_permission_set']);
  const DELEGATION_SEED_OBJECTS = new Set(['sys_user_position']);
  const nowMs = opts?.nowMs ?? Date.now();
  for (const [i, seed] of recordsOf(stack.data).entries()) {
    const seedObject = typeof seed.object === 'string' ? seed.object : '';
    if (!GRANT_SEED_OBJECTS.has(seedObject)) continue;
    const records = Array.isArray(seed.records) ? (seed.records as AnyRec[]) : [];
    for (let j = 0; j < records.length; j++) {
      const rec = (records[j] ?? {}) as AnyRec;
      const where = `seed "${seedObject}" record #${j}`;

      // D2: a valid_until already in the past (or unparseable) at authoring
      // time is a grant that will NEVER resolve — dead on arrival, fail-closed.
      const until = rec.valid_until;
      if (until != null && until !== '') {
        const ms =
          typeof until === 'number'
            ? (until < 1e12 ? until * 1000 : until)
            : until instanceof Date
              ? until.getTime()
              : typeof until === 'string'
                ? Date.parse(until)
                : Number.NaN;
        if (Number.isNaN(ms) || ms <= nowMs) {
          findings.push({
            severity: 'error',
            rule: SECURITY_GRANT_EXPIRED_AT_AUTHORING,
            where,
            path: `data[${i}].records[${j}].valid_until`,
            message: Number.isNaN(ms)
              ? `valid_until ${JSON.stringify(until)} is not a parseable timestamp — the resolver fails ` +
                `closed (ADR-0091 D2), so this grant will NEVER be active.`
              : `valid_until ${JSON.stringify(until)} is already in the past — this grant is expired at ` +
                `authoring time and will never resolve (ADR-0091 D2 filters it fail-closed).`,
            hint:
              `Set valid_until to a future instant (ISO-8601 UTC), or drop the column for an unbounded ` +
              `grant. If the row is a historical record, it belongs in audit history, not seed data.`,
          });
        }
      }

      // D3: delegation rows (delegated_from set) MUST carry a reason — the
      // dual-audit half the runtime gate also rejects. Position table only:
      // `delegated_from` is not declared on `sys_user_permission_set` (#9730).
      const delegatedFrom = rec.delegated_from;
      if (DELEGATION_SEED_OBJECTS.has(seedObject) && delegatedFrom != null && delegatedFrom !== '') {
        const reason = rec.reason;
        if (typeof reason !== 'string' || reason.trim().length === 0) {
          findings.push({
            severity: 'error',
            rule: SECURITY_DELEGATION_MISSING_REASON,
            where,
            path: `data[${i}].records[${j}].reason`,
            message:
              `delegation row (delegated_from = ${JSON.stringify(delegatedFrom)}) has no reason. ` +
              `ADR-0091 D3 requires a mandatory reason on every delegation for the dual audit trail ` +
              `(granted_by = writer, delegated_from = authority source, reason = why).`,
            hint: `Add reason: 'vacation stand-in for 张三, 2026-08-01..15' (free text, required).`,
          });
        }
      }
    }
  }

  return findings;
}

/**
 * [ADR-0090 D3] The `security-role-word` vocabulary freeze, as its own rule.
 *
 * Scope: security-relevant identifiers/labels across SIX collections — objects
 * (names, field names, action names), permission sets, positions, apps, books.
 * Pages/views/components are NOT scanned — `role` there is HTML/ARIA
 * semantics, not permission vocabulary. The sole platform exception
 * (better-auth `sys_member.role`) is a system object, which app stacks never
 * author. Books entered the security-relevant set when `book.audience` became
 * a permission-model reference (ADR-0046 §6.7 / ADR-0090).
 *
 * ## Why this is a separate function from {@link validateSecurityPosture}
 *
 * [#8310] Not taste — a surface boundary. When the rest of the D7 block
 * crossed onto the runtime publish surface (`runtimeTypes: ['seed',
 * 'permission', 'book']` — `object` measured dirty and is escalated, see the
 * registry comment), this rule could not go with it: the per-write snapshot
 * (`runtime-gate.ts`) neither carries nor maps `positions` / `apps`, both of
 * which are `allowRuntimeCreate: true` — so wiring it through the shared
 * entry would have enforced ONE rule id for a strict subset of its six
 * collections. That is the #7220 failure shape (a door that refuses a
 * permission set named `role_manager` while a position named `sales_role`
 * walks through), and
 * the registry refuses to build it in either direction. The rule therefore
 * stays behind WHOLE, on its own CLI-only registry entry, until the snapshot
 * carries `positions`/`apps` and both types are gated — at which point it
 * crosses whole, in one edit, as its own entry.
 */
export function validateSecurityRoleWord(stack: AnyRec): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const objects = recordsOf(stack.objects);
  const permissionSets = recordsOf(stack.permissions);

  const flagRole = (kind: string, name: unknown, label: unknown, where: string, path: string) => {
    if (identifierHasRoleToken(name)) {
      findings.push({
        severity: 'error',
        rule: SECURITY_ROLE_WORD,
        where,
        path,
        message:
          `${kind} name "${String(name)}" uses the reserved word "role" — the platform vocabulary ` +
          `is permission_set (capability), position (distribution), business_unit (hierarchy) (ADR-0090 D3).`,
        hint: `Rename using 'position' for distribution groups or a domain word (e.g. 'function', 'duty').`,
      });
    } else if (labelHasRoleWord(label)) {
      findings.push({
        severity: 'error',
        rule: SECURITY_ROLE_WORD,
        where,
        path: `${path.replace(/\.name$/, '')}.label`,
        message: `${kind} label "${String(label)}" uses the reserved word "role" (ADR-0090 D3).`,
        hint: `Relabel with 'Position' (distribution) or a domain word — admins must meet ONE vocabulary.`,
      });
    }
  };

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj || typeof obj !== 'object' || isSystemObject(obj)) continue;
    const objName = typeof obj.name === 'string' ? obj.name : `(object ${i})`;
    flagRole('object', obj.name, obj.label, `object "${objName}"`, `objects[${i}].name`);
    for (const f of recordsOf(obj.fields)) {
      flagRole('field', f.name, f.label, `field "${objName}.${String(f.name ?? '?')}"`, `objects[${i}].fields.${String(f.name ?? '?')}.name`);
    }
    for (const [ai, action] of recordsOf(obj.actions).entries()) {
      flagRole('action', action.name, action.label, `action "${objName}.${String(action.name ?? '?')}"`, `objects[${i}].actions[${ai}].name`);
    }
  }
  for (let i = 0; i < permissionSets.length; i++) {
    const ps = permissionSets[i];
    if (!ps || typeof ps !== 'object') continue;
    flagRole('permission set', ps.name, ps.label, `permission set "${String(ps.name ?? i)}"`, `permissions[${i}].name`);
  }
  for (const [i, pos] of recordsOf(stack.positions).entries()) {
    flagRole('position', pos.name, pos.label, `position "${String(pos.name ?? i)}"`, `positions[${i}].name`);
  }
  for (const [i, app] of recordsOf(stack.apps).entries()) {
    flagRole('app', app.name, app.label, `app "${String(app.name ?? i)}"`, `apps[${i}].name`);
  }
  for (const [i, book] of recordsOf(stack.books).entries()) {
    flagRole('book', book.name, book.label, `book "${String(book.name ?? i)}"`, `books[${i}].name`);
  }

  return findings;
}
