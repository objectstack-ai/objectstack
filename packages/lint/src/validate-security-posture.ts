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
 * | security-wildcard-vama        (error)   | ADR-0066 superuser wildcard     |
 * | security-anchor-high-privilege(error)   | ADR-0090 D5/D9 anchors — declared `everyone` suggestions (`isDefault: true`) only; no door binds a set to `guest` until ADR-0138 D3 item 5's bind door is built (#16110) |
 * | security-role-word            (error)   | ADR-0090 D3 vocabulary freeze — own function/registry entry since #8310; CLI + runtime publish gate since commit a227afa41 |
 * | security-book-audience-unknown-set(warn)| ADR-0046 §6.7 { permissionSet } |
 * | security-private-no-readscope (info)    | admin-intent mismatch class     |
 * | security-master-detail-ungranted(warn)  | framework#2700 os-tianshun-mtc#43|
 * | security-grant-expired-at-authoring(err)| ADR-0091 D2 resolution filtering|
 * | security-delegation-missing-reason(err) | ADR-0091 D3 dual audit          |
 * | security-cbp-no-relation      (error)   | #7503 (runtime refusal #7474)   |
 * | security-cbp-ambiguous-relation(error)  | #14747 order-dependent master; runtime refusal since #23100 |
 * | security-modify-all-delete-withheld(error) | #25575 Modify All includes delete — UNPARSED intakes only, see the arm |
 *
 * Per ADR-0049 discipline these are NOT advisory security: every `error` rule
 * mirrors a runtime enforcement point (D1 fail-closed OWD default, D4
 * zod enum + fail-closed evaluator, D5/D9 anchor binding gate, D3 rename wave,
 * ADR-0055 §1's one required master_detail)
 * — the lint moves the failure from runtime-deny to author-time fix-it.
 * `security-anchor-high-privilege` mirrors that gate for the one suggestion a
 * package can actually declare (`isDefault: true` → the `everyone` anchor,
 * `suggested-audience-bindings.ts`'s "the only declarable suggestion"). A
 * package never suggests a `guest` binding, and no door binds a set to
 * `guest` until ADR-0138 D3 item 5's bind door is built (it amends ADR-0090
 * D9's "a package may suggest bindings to `everyone` or `guest`"), so this
 * rule is not — and cannot be — coverage for a set bound to `guest` (#16110).
 * That door, when built, is an act of the environment's administrator, never
 * of a package, and runs `describeAnchorForbiddenBits(set, 'guest')` itself.
 *
 * `security-cbp-ambiguous-relation` used to be the one exception: the runtime
 * did not refuse two candidate masters, it silently PICKED one by field
 * declaration order (#14747). Since #23100 (maintainer ruling B, ADR-0055 §1)
 * the runtime derives a master from exactly one required `master_detail` and
 * from nothing else, so two of them now meet the same runtime refusal as none
 * — every read denied, every write refused — and both rules mirror it.
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
 *   `publicSharing`) and is strict, so a stack nesting
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
 * `sharingModel` is a CLOSED enum on `ObjectSchema` (ADR-0090 D4; its
 * external twin `externalSharingModel` is a retired tombstone since #23268,
 * refused at parse with its own prescription): every value `OWD_ALIAS_FIX` names — both the D4
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
 * |   `owd-legacy-read-aliases` is retired (#25767), so           |                         |
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

import { isControlledByParentMasterField, referenceCarrierOf } from '@objectstack/spec/data';
import { describeAnchorForbiddenBits, type AnchorBindingContext } from '@objectstack/spec/security';
import { indexObjectGraph, nearestName, packagesOf, recordsOf, type ObjectGraph } from './object-graph.js';

export const SECURITY_OWD_UNSET = 'security-owd-unset';
export const SECURITY_OWD_ALIAS = 'security-owd-alias';
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
export const SECURITY_MODIFY_ALL_DELETE_WITHHELD = 'security-modify-all-delete-withheld';

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
 * spellings (a ≤16.x kit, retired on #25767), and the `13.owd-full-alias-removed`
 * semantic entry for `full`.
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

/**
 * The object's org-wide default.
 *
 * `sharingModel` is the whole of it. There is no `objects[].security` envelope
 * to fall back to and there never was: `ObjectSchema.shape` carries
 * `sharingModel` / `publicSharing` flat, declares no
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
  // [#22161] One clause. Which values ADR-0090 D4 retired, and where a
  // non-OWD value such as 'public' IS legal, is this rule id's `os explain`
  // entry (`rule-explanations.ts`).
  return OWD_RETIRED_ALIAS_FIX[value]
    ? `is a retired alias (ADR-0090 D4)`
    : `is not an OWD value — '${value}' belongs to 'access' and 'publicSharing', not this key`;
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
 *
 * A NON-STRING carrier now THROWS rather than reading as "no target" (#13053).
 * This function was the reader in that incident: a fixture spelled
 * `reference: { object: … }`, `ObjectSchema.safeParse` refused it where it was
 * written, and this returned `undefined` where it was consumed — so the suite
 * was blind in both directions at once and green. The refusal is the spec's
 * single carrier accessor, so this rule and the runtime give one answer.
 */
function refOf(def: AnyRec): string | undefined {
  // The read stays HERE, on `def.reference`, so the #5017 receiver meta-test
  // below keeps its subject: this rule reads `reference` and never the alias.
  // Only the SHAPE judgment moves out, to the spec's one carrier accessor.
  return referenceCarrierOf({ reference: def.reference }, 'validate-security-posture refOf');
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
  /** Always `master_detail` — kept so the ungranted-detail rule's message names the type it reports. */
  type: string;
  /** The object it references. */
  master: string;
}

/**
 * [ADR-0055 §1 · #23100, maintainer ruling B] The master candidates of a
 * `controlled_by_parent` object: every `master_detail` field declared
 * `required: true` that names a `reference`, in declaration order. The object
 * derives its master from EXACTLY ONE of them — zero is
 * `security-controlled-by-parent-no-relation`, two or more is
 * `security-controlled-by-parent-ambiguous-relation`.
 *
 * This used to be a three-tier table (`CBP_TIERS`, #7503 / #14747) mirroring a
 * three-tier fallback in the runtime: a required `master_detail`, else ANY
 * `master_detail`, else a required `lookup`. ADR-0055 §1 never recorded the
 * second and third tiers, and ruling B retired both, so the table collapsed
 * to its first row. What counts as a master is not spelled here: it is the
 * spec's exported field predicate, `isControlledByParentMasterField`
 * (`@objectstack/spec/data`, #23272), the one `ObjectSchema`'s refusal
 * (`controlledByParentMasterRefusal`) counts, so the parse and this linter
 * read one sentence. The runtime's `resolveCbpRelation`
 * (`packages/plugins/plugin-security/src/security-plugin.ts`) reads the
 * unparsed registry and keeps its own reading, and the tests of this rule
 * hold its verdict equal to the parse's on the shapes the ruling names. ⛔ Do not re-introduce a fallback tier here: a
 * linter that accepts what the parse and the runtime refuse reads, to the next
 * author, as a gate that is watching.
 *
 * `required` is read as `=== true`, the spec's own type for it; the runtime
 * reads the same. The one deliberate divergence from the runtime is the
 * reference spelling: the runtime accepts `reference ?? reference_to ??
 * referenceTo` (it reads the unparsed registry, ruling of 2026-08-30), while
 * `refOf` here accepts only `reference`, the sole spelling `FieldSchema`
 * declares. The aliases do not parse (strict schema, #5017), so for any stack
 * an author can ship the two agree; on the pre-parse path the schema already
 * names the real defect (the alias key) rather than this rule guessing past it.
 */
function cbpMasterCandidates(obj: AnyRec): CbpRelation[] {
  return recordsOf(obj.fields)
    .filter((f) => isControlledByParentMasterField(f) && refOf(f))
    .map((f) => ({ field: String(f.name ?? '?'), type: 'master_detail', master: refOf(f) as string }));
}

/**
 * [#7503 · ADR-0055 §1] The relation a `controlled_by_parent` object derives
 * its access from — its one required `master_detail` — or `undefined` when it
 * declares none, or more than one (the runtime derives no master from either).
 */
function resolveCbpRelation(obj: AnyRec): CbpRelation | undefined {
  const candidates = cbpMasterCandidates(obj);
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * [#22212] The relation that makes an object a CHILD whose record-level access
 * is derived from a master — the subject of `security-master-detail-ungranted`.
 *
 * A `controlled_by_parent` object is answered by {@link resolveCbpRelation}:
 * its one required `master_detail` is the field the platform derives the
 * child's record access through (ADR-0055 §1). Until #23100 that resolution
 * also accepted a required LOOKUP, and #22212 widened this rule to it; ruling
 * B retired that tier, so a lookup-bound `controlled_by_parent` object is now
 * no child at all — the parse and `security-controlled-by-parent-no-relation`
 * refuse it, and this rule has nothing to add.
 *
 * Every other object keeps the reading this rule always had: a master_detail
 * field makes it a detail whatever its sharingModel says.
 */
function derivedAccessParent(obj: AnyRec): { name: string; type: string; parent?: string } | undefined {
  if (owdOf(obj) === 'controlled_by_parent') {
    const rel = resolveCbpRelation(obj);
    if (rel) return { name: rel.field, type: rel.type, parent: rel.master };
  }
  const md = firstMasterDetailField(obj);
  return md ? { ...md, type: 'master_detail' } : undefined;
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
 * `security-controlled-by-parent-no-relation` for one object, at `path`. One
 * site for the declared object and the merged one
 * ({@link pushExtensionMergedCbpFindings}), so the two read in one wording.
 */
function pushCbpNoRelation(findings: SecurityFinding[], objName: string, path: string): void {
  findings.push({
    severity: 'error',
    rule: SECURITY_CBP_NO_RELATION,
    where: `object "${objName}"`,
    path,
    // [#22161] One verdict sentence; the ADR-0055 rule it tested and why
    // the object is unusable rather than locked down are this id's
    // `os explain` entry.
    message:
      `declares sharingModel 'controlled_by_parent' but no required master_detail field to derive access ` +
      `from, so every read is denied and every write refused (422 INVALID_METADATA)`,
    // [#22161] One remedy line; that an object with no master decides its
    // own baseline, and what each value means, is this id's `os explain`
    // entry.
    hint:
      `Add the master relation, e.g. fields.parent: { type: 'master_detail', reference: '<master_object>', ` +
      `required: true }, or set its own sharingModel: 'private', 'public_read' or 'public_read_write'`,
  });
}

/**
 * `security-controlled-by-parent-ambiguous-relation` for one object, at
 * `path`, naming its candidates. Shared like {@link pushCbpNoRelation}.
 */
function pushCbpAmbiguousRelation(
  findings: SecurityFinding[],
  objName: string,
  path: string,
  candidates: CbpRelation[],
): void {
  const roster = candidates.map((cand) => `"${cand.field}" → ${cand.master}`).join(', ');
  findings.push({
    severity: 'error',
    rule: SECURITY_CBP_AMBIGUOUS_RELATION,
    where: `object "${objName}"`,
    path,
    // [#22161] One verdict sentence; why exactly one master is the rule is
    // this id's `os explain` entry.
    message:
      `declares ${candidates.length} required master_detail fields (${roster}), so no ` +
      `controlled_by_parent master is derived: every read denied, every write refused`,
    // [#22161] One remedy line.
    hint:
      `Keep master_detail on the ONE master this object's rows belong to, and declare every other parent ` +
      `as a lookup field`,
  });
}

/** One `objectExtensions` entry as the registry registers it — see {@link pushExtensionMergedCbpFindings}. */
interface VisibleExtension {
  /** The position of the package that ships it: registration order across packages. */
  carrier: number;
  /** The entry's path, e.g. `objectExtensions[0]`. */
  path: string;
  /** `ext.priority ?? 200`, the registry's default. */
  priority: number;
  /** Its field records, name folded in (`recordsOf`). */
  fields: AnyRec[];
}

/**
 * [#23210 · ADR-0055 §1] `security-controlled-by-parent-no-relation` and
 * `security-controlled-by-parent-ambiguous-relation`, judged on the MERGED
 * field set of a `controlled_by_parent` object that an `objectExtensions`
 * entry of this stack extends.
 *
 * The registry folds every extension onto its target at boot, so an object
 * that passes the per-object rules above as declared can run with two required
 * master_detail fields, or none, and the runtime then derives no master and
 * fails closed. The stack schema refuses the same merged shape
 * (`applyControlledByParentExtensionGate`, `@objectstack/spec`'s
 * `stack.zod.ts`); this is the door an UNPARSED intake meets — `os lint` on a
 * raw config, a direct call — and the tests hold the two verdicts equal.
 *
 * The merge is read as the registry computes it (`mergeObjectDefinitions`,
 * `SchemaRegistry.resolveObject`), and as the schema door reads it, since
 * `@objectstack/lint` imports no runtime: the target's own declaration is the
 * base and keeps its `sharingModel`; fields merge by name, a later writer
 * replacing the whole field; extensions apply in ascending `priority`, equal
 * priorities in registration order, one per package per target (the later
 * entry wins). `extend` names its target verbatim.
 *
 * Visible targets, as the schema door has them: with no `packages[]`, the
 * stack's `objects` extended by its `objectExtensions`; with `packages[]`, the
 * objects every body declares (plus a top-level object no body declares)
 * extended by every body's `objectExtensions` — the artifact is the
 * co-ownership boundary, the reach `validate-translation-references.ts`
 * already takes for extension FIELDS. Unjudged, as by the schema: a target
 * the stack does not declare (the blind spot `validate-object-references.ts`
 * states), a target two bodies declare, a target whose own declaration
 * already breaks the rule (reported above, at its own path), and a target on
 * which two packages write one field key at the priority that decides it.
 *
 * Each finding sits at the `fields` of an extension that wrote a key which is
 * a `master_detail` in the declaration or in the merged set — the line that
 * added the second master, or demoted the one.
 */
function pushExtensionMergedCbpFindings(findings: SecurityFinding[], stack: AnyRec): void {
  const multi = Array.isArray(stack.packages);
  const bodies: AnyRec[] = packagesOf(stack).map((entry) =>
    entry.manifest && typeof entry.manifest === 'object' && !Array.isArray(entry.manifest)
      ? (entry.manifest as AnyRec)
      : {},
  );

  // Target name → its declaration, or `null` when two packages claim it.
  const targets = new Map<string, AnyRec | null>();
  const owners = new Map<string, number>();
  const declare = (objects: AnyRec[], carrier: number) => {
    for (const obj of objects) {
      const name = typeof obj.name === 'string' && obj.name.length > 0 ? obj.name : undefined;
      if (!name || targets.get(name) === null) continue;
      const owner = owners.get(name);
      if (owner !== undefined && owner !== carrier) {
        targets.set(name, null);
        continue;
      }
      owners.set(name, carrier);
      targets.set(name, obj);
    }
  };
  if (!multi) {
    declare(recordsOf(stack.objects), 0);
  } else {
    bodies.forEach((body, j) => declare(recordsOf(body.objects), j));
    declare(recordsOf(stack.objects).filter((obj) => typeof obj.name === 'string' && !owners.has(obj.name)), bodies.length);
  }

  // Target name → its extensions, one per package.
  const extensions = new Map<string, Map<number, VisibleExtension>>();
  const collect = (entries: unknown, carrier: number, at: string) => {
    if (!Array.isArray(entries)) return;
    entries.forEach((entry: unknown, i: number) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
      const ext = entry as AnyRec;
      if (typeof ext.extend !== 'string' || !targets.get(ext.extend)) return;
      const byCarrier = extensions.get(ext.extend) ?? new Map<number, VisibleExtension>();
      byCarrier.set(carrier, {
        carrier,
        path: `${at}objectExtensions[${i}]`,
        priority: typeof ext.priority === 'number' ? ext.priority : 200,
        fields: recordsOf(ext.fields),
      });
      extensions.set(ext.extend, byCarrier);
    });
  };
  if (!multi) collect(stack.objectExtensions, 0, '');
  else bodies.forEach((body, j) => collect(body.objectExtensions, j, `packages[${j}].manifest.`));

  for (const [target, byCarrier] of extensions) {
    const obj = targets.get(target);
    if (!obj || owdOf(obj) !== 'controlled_by_parent') continue;
    if (cbpMasterCandidates(obj).length !== 1) continue;

    const baseFields = new Map(recordsOf(obj.fields).map((f) => [String(f.name ?? '?'), f] as const));
    const merged = new Map(baseFields);
    const ordered = [...byCarrier.values()].sort(
      (left, right) => left.priority - right.priority || left.carrier - right.carrier,
    );
    const writers = new Map<string, VisibleExtension>();
    // Per key, how many packages wrote it at the priority of its last writer.
    const tiedWriters = new Map<string, number>();
    for (const visible of ordered) {
      for (const f of visible.fields) {
        const key = String(f.name ?? '?');
        const tied = writers.get(key)?.priority === visible.priority;
        tiedWriters.set(key, tied ? (tiedWriters.get(key) ?? 1) + 1 : 1);
        writers.set(key, visible);
        merged.set(key, f);
      }
    }
    if ([...tiedWriters.values()].some((count) => count > 1)) continue;

    const candidates = cbpMasterCandidates({ ...obj, fields: [...merged.values()] });
    if (candidates.length === 1) continue;
    const blamed = new Set<VisibleExtension>();
    for (const [key, visible] of writers) {
      if (merged.get(key)?.type === 'master_detail' || baseFields.get(key)?.type === 'master_detail') blamed.add(visible);
    }
    for (const visible of ordered) {
      if (!blamed.has(visible)) continue;
      if (candidates.length === 0) pushCbpNoRelation(findings, target, `${visible.path}.fields`);
      else pushCbpAmbiguousRelation(findings, target, `${visible.path}.fields`, candidates);
    }
  }
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
  // [#18535, ADR-0090 D5 / ADR-0066 D1] The stack's own capability
  // declarations, handed to the anchor predicate as
  // `AnchorBindingContext.declaredCapabilities` — the authoring-time half of
  // the source the runtime reads at boot. A `systemPermissions` token this
  // stack DECLARES is the app's own gate and does not make an `isDefault` set
  // unbindable (the runtime agrees, so the lint and the gate stay one rule);
  // an UNDECLARED token still offends, and the platform floor is applied by
  // the predicate itself, so declaring `manage_users` excuses nothing.
  // No declarations ⇒ `undefined` ⇒ the pre-#17811 verdict verbatim.
  const declaredCapabilities = recordsOf(stack.capabilities).filter(
    (cap) => typeof cap.name === 'string' && cap.name.length > 0,
  );
  const anchorContext: AnchorBindingContext | undefined =
    declaredCapabilities.length > 0 ? { declaredCapabilities } : undefined;

  // ── D1/D4: per-object OWD posture ───────────────────────────────────
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj || typeof obj !== 'object') continue;
    const objName = typeof obj.name === 'string' ? obj.name : `(object ${i})`;
    const objPath = `objects[${i}]`;
    const owd = owdOf(obj);

    if (!isSystemObject(obj)) {
      if (owd == null) {
        findings.push({
          severity: 'error',
          rule: SECURITY_OWD_UNSET,
          where: `object "${objName}"`,
          path: `${objPath}.sharingModel`,
          // [#22161] One verdict sentence and one fix. Why an unset OWD is
          // refused although the runtime fails closed — and the incident shape
          // it guards — is the rule's long-form explanation
          // (`rule-explanations.ts`, `os explain security-owd-unset`).
          message:
            `custom object declares no sharingModel (OWD); the runtime falls back to 'private', ` +
            `but the baseline must be an authored decision`,
          hint:
            `declare sharingModel: 'private' (owner + shares; recommended), 'public_read', ` +
            `'public_read_write', or 'controlled_by_parent' (master-detail children)`,
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
            `sharingModel '${owd}' ${owdAliasProvenance(owd)}; the runtime fails CLOSED to 'private', ` +
            `so this object is NOT ${owd === 'read' ? 'readable' : 'writable'} org-wide`,
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
    // The object says "my access comes from my master" and names no master:
    // no `master_detail` field declared `required: true` (ADR-0055 §1 — since
    // #23100 a non-required `master_detail` and a required `lookup` no longer
    // count). Both runtime halves of ADR-0055 refuse this shape, and neither
    // is a judgement call the linter has to second-guess:
    //   - writes → 422 INVALID_METADATA (`MasterDetailRelationMissingError`,
    //     the #7474 split — a metadata defect, explicitly NOT an access verdict)
    //   - reads  → `computeControlledByParentFilter` returns RLS_DENY_FILTER,
    //     so every read is denied too.
    // So it is `error`, not advisory: it mirrors a hard runtime enforcement
    // point exactly (the ADR-0090 D7 / ADR-0049 criterion at the head of this
    // file), and the defect is a self-contained property of the object document
    // — no per-permission-set nuance to adjudicate, no legitimate reading. The
    // parse refuses the same shape (`ObjectSchema`); this rule is what an
    // UNPARSED intake meets.
    //
    // NOT exempted for system objects, unlike the D1 unset-OWD rule above: the
    // runtime refusal does not exempt them either, and an object declaring a
    // derivation it cannot perform is broken on its own terms, independent of
    // who may author it.
    const cbpCandidates = owd === 'controlled_by_parent' ? cbpMasterCandidates(obj) : undefined;
    if (cbpCandidates && cbpCandidates.length === 0) {
      pushCbpNoRelation(findings, objName, `${objPath}.sharingModel`);
    }

    // ── [#14747 · #23100] controlled_by_parent with TWO OR MORE masters ───
    // The opposite defect to the one above: not zero candidates, but two or
    // more required `master_detail` fields. Until #23100 the runtime did not
    // refuse this — it PICKED the first by field declaration order, so moving
    // a field up or down a schema file silently repointed the record-level
    // security of every row (#14747), and this rule was the only place the
    // tie could surface. Ruling B (ADR-0055 §1: exactly one) made the runtime
    // derive NO master from two, so the shape now meets the same refusal as
    // the rule above — every read denied, every write refused — and this rule
    // mirrors it. Kept a separate id because the remedy differs: not "add a
    // master" but "keep one".
    //
    // NOT exempted for system objects, for the same reason the rule above is
    // not: the ambiguity is a property of the document, independent of who may
    // author it.
    if (cbpCandidates && cbpCandidates.length > 1) {
      pushCbpAmbiguousRelation(findings, objName, `${objPath}.fields`, cbpCandidates);
    }
  }

  // ── [#23210] the same two rules, on an object's MERGED field set ─────
  // An `objectExtensions` entry of this stack merges into its target at boot,
  // so an object that passes above as declared can run with two required
  // master_detail fields, or none. See {@link pushExtensionMergedCbpFindings}.
  pushExtensionMergedCbpFindings(findings, stack);

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
    //
    // [#23549] "Qualified" means a NON-EMPTY object part before the first '.',
    // not merely "contains a '.'". A key whose object part is empty
    // (`'.full_name'`, `'.'`, `'..x'`, `'.x.y'`) names no object, and no object
    // can be named by the empty string — `ObjectSchema.name` is
    // `/^[a-z_][a-z0-9_]*$/` — so it fails the evaluator's prefix match exactly
    // as a bare key does. The guard used to skip it for containing a '.', and
    // the unknown-field rule below read its empty head as another package's
    // object (its skip 1), so it passed both and the mask never enforced. It is
    // judged HERE, under this id, because this is the same defect: the id, the
    // runtime consequence and the remedy (qualify the key with its object) all
    // fit, so a consumer acting on the id has no second branch to take (the
    // charter's test for a new id). The rule below skips it, so each key earns
    // one finding.
    const flsMap = (ps.fields && typeof ps.fields === 'object' ? ps.fields : {}) as AnyRec;
    for (const flsKey of Object.keys(flsMap)) {
      const dot = flsKey.indexOf('.');
      if (dot > 0) continue; // a non-empty object part — judged by the rule below
      // dot < 0 is the bare key, dot === 0 the empty object part. For the
      // latter the hint's example keeps the remainder as the field only when it
      // is one plain segment: for `'.'`, `'..x'` or `'.x.y'` that example would
      // itself be refused by the rule below, and a remedy followed literally
      // must not lead to the next refusal.
      const remainder = flsKey.slice(dot + 1);
      const emptyObjectExample =
        remainder.length > 0 && !remainder.includes('.') ? `, e.g. 'crm_opportunity.${remainder}'` : '';
      findings.push({
        severity: 'error',
        rule: SECURITY_FLS_UNQUALIFIED_KEY,
        where: `permission set "${psName}"`,
        path: `${psPath}.fields["${flsKey}"]`,
        message:
          dot < 0
            ? `field-permission key '${flsKey}' is not object-qualified — the runtime matches FLS keys ` +
              `by '<object>.<field>' prefix, so a bare key is silently IGNORED and the declared masking never enforces.`
            : `field-permission key '${flsKey}' is not object-qualified — its object part (before the first '.') is ` +
              `empty, so the key matches no object, is silently IGNORED, and the declared masking never enforces.`,
        hint:
          dot < 0
            ? `Qualify the key with its object, e.g. 'crm_opportunity.${flsKey}': { readable: true, editable: false }.`
            : `Name the object before the '.': FLS keys take the '<object>.<field>' form${emptyObjectExample}.`,
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
      // dot < 0 is the bare key and dot === 0 the empty object part (#23549):
      // both are unqualified, judged by the rule above. Without the second
      // half the empty head would reach skip 1 below and be read as another
      // package's object — the silence that let `'.full_name'` through.
      if (dot <= 0) continue;
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
      // resolve, which is exactly the disposition a mis-cased object name is
      // deliberately left to. One story, one guard order: the object must be
      // visible before the key is judged. `'no_such_object.'` therefore falls
      // to skip 1, like every other key naming an object this stack does not
      // define. (An EMPTY object half — `'.description'` — never reaches this
      // loop: no package can declare it, so it is the unqualified-key rule's,
      // #23549.)
      const emptyField = flsField.length === 0;

      // [#22161] The `fix:` line names the nearest column the key could have
      // meant (a declared field or a registry-injected one, the two sets the
      // resolution above accepts), not the object's field list: a list of up
      // to twelve names does not fit one line, and the nearest name is what a
      // renamed or mistyped key needs.
      const nearest = emptyField ? undefined : nearestName(flsField, [...surface.names, ...surface.injected.keys()]);
      const wrote = emptyField
        ? `field-permission key '${flsKey}' names NO field — everything after the '${flsObject}.' prefix is empty`
        : `field-permission key '${flsKey}' is object-qualified but "${flsObject}" declares no field '${flsField}'`;
      findings.push({
        severity: 'error',
        rule: SECURITY_FLS_UNKNOWN_FIELD,
        where: `permission set "${psName}"`,
        path: `${psPath}.fields["${flsKey}"]`,
        // [#22161] One verdict sentence; how the runtime resolves an FLS key,
        // and why this shape survives review, are this id's `os explain` entry.
        message: `${wrote}, so the key matches nothing and the masking it declares never enforces`,
        // [#22161] One remedy line; that an entry which cannot match is no
        // protection, and what a field rename did to the mask, are this id's
        // `os explain` entry.
        hint:
          `Point the key at a field "${flsObject}" declares` +
          (nearest ? ` ('${flsObject}.${nearest}' is the nearest)` : '') +
          `, or delete the entry if the field is gone`,
      });
    }

    // [#25575] `allowDelete: false` beside `modifyAllRecords: true`. Modify All
    // is the write bypass for edit, delete and transfer, so the evaluator
    // grants delete and never reads the false. The schema refuses the pair, so
    // on a parsed door this arm never sees it (`ObjectPermissionSchema` refuses
    // an authored false and writes `true` into an omitted key). It reaches the
    // unparsed doors, as `security-owd-alias` does: `os lint` on a raw
    // object-literal config, and a direct call of this exported function.
    for (const [objName, entry] of Object.entries(objectsMap)) {
      if (!entry || typeof entry !== 'object') continue;
      const grant = entry as AnyRec;
      if (grant.modifyAllRecords !== true || grant.allowDelete !== false) continue;
      findings.push({
        severity: 'error',
        rule: SECURITY_MODIFY_ALL_DELETE_WITHHELD,
        where: `permission set "${psName}"`,
        path: `${psPath}.objects.${objName}.allowDelete`,
        message:
          `objects.${objName} sets allowDelete: false beside modifyAllRecords: true, and Modify All ` +
          `includes delete, so the holder can still delete every record`,
        hint:
          `Delete allowDelete if Modify All is meant; to edit every record but delete none, remove ` +
          `modifyAllRecords and grant the edit with a criteria sharing rule (accessLevel: 'edit')`,
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
        // [#22161] One remedy line; where an app-level admin set belongs
        // (ADR-0090 D9) is this id's `os explain` entry.
        hint: `Enumerate the objects this set really needs, or drop viewAllRecords/modifyAllRecords from the '*' entry`,
      });
    }

    // D5: an isDefault set is a SUGGESTED binding to the `everyone` anchor —
    // hold it to the anchor tier at author time (the runtime gate enforces the
    // same predicate at bind time; this moves the failure to the author).
    // Scope: `isDefault: true` is the only declarable suggestion, and it names
    // `everyone` alone. No door binds a set to `guest` until ADR-0138 D3 item
    // 5's bind door is built (an administrator's act, never a package's), so
    // no `guest` binding exists for a package-time linter to see (#16110).
    if (ps.isDefault === true) {
      const offending = describeAnchorForbiddenBits(ps, 'everyone', anchorContext);
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
  // books), and at that moment the per-write snapshot neither carried nor
  // mapped `positions` / `apps` — so it crossed that wall WHOLE or stayed
  // behind (#7220), and it stayed behind. Keeping it inside this function
  // would have wired it for a strict subset of its collections the moment this
  // block's `runtimeTypes` widened: a door that refuses a permission set named
  // `role_manager` while a position named `sales_role` walks through — the
  // exact split the registry's #7220 pin refuses to build.
  // [commit a227afa41] It has since crossed, whole, on its own entry — the two write
  // types are mapped and all five are declared there. The two entries remain
  // separate: that is what let each cross on its own evidence.

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
  // master_detail field, or — #22212 — is `controlled_by_parent` and resolves
  // its master the way the runtime does: its one required master_detail,
  // ADR-0055 §1) that NO authored permission set grants.
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
        // [#22212] The runtime's parent, not only a master_detail field.
        const md = derivedAccessParent(obj);
        if (!md) continue;
        const parentText = md.parent ? ` → "${md.parent}"` : '';
        findings.push({
          severity: 'warning',
          rule: SECURITY_MASTER_DETAIL_UNGRANTED,
          where: `object "${objName}"`,
          path: `objects[${i}].fields.${md.name}`,
          // [#22161] One verdict sentence; why object-level CRUD is never
          // derived from the master is this id's `os explain` entry.
          message:
            `detail object "${objName}" (${md.type} "${md.name}"${parentText}) has no object-level ` +
            `CRUD grant in any permission set, so non-admin users are denied it (403)`,
          // [#22161] One remedy line; the sys_* / isSystem alternative for a
          // table no role touches is this id's `os explain` entry.
          hint:
            `Grant it where its master${md.parent ? ` "${md.parent}"` : ''} is granted: ` +
            `permissions[i].objects.${objName} = { allowRead: true, allowCreate: true, allowEdit: true }`,
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
              `delegation row (delegated_from = ${JSON.stringify(delegatedFrom)}) has no reason, which ` +
              `ADR-0091 D3 requires on every delegation`,
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
 * (names, field names, action names, field-group keys and labels), permission
 * sets, positions, apps, books.
 * Pages/views/components are NOT scanned — `role` there is HTML/ARIA
 * semantics, not permission vocabulary. The sole platform exception
 * (better-auth `sys_member.role`) is a system object, which app stacks never
 * author. Books entered the security-relevant set when `book.audience` became
 * a permission-model reference (ADR-0046 §6.7 / ADR-0090).
 *
 * ## Why `objects[].fieldGroups[]` IS scanned, and a page section is not
 *
 * [#18306] Measured, not assumed — the question is which fact separates the
 * scanned surfaces from the excluded ones, and it is NOT "does this key carry
 * permission semantics". `object.label`, `field.label` and `action.label`
 * carry none either, and all three are scanned: the ban ADR-0090 D3 writes is
 * on the WORD, in "identifiers, UI copy, and documentation". A field group
 * declares both halves — `key` is an identifier (`Field.group` assigns
 * membership by it, and a layout section's `group` inherits the whole group by
 * it, ADR-0085 §5), and `label` is the section header an admin reads on the
 * record page. So it is inside the ban by the ban's own terms.
 *
 * What excludes pages/views/components is a different fact: `role` there is
 * the HTML/ARIA attribute — a machine word with a fixed foreign meaning, not a
 * word the author picked. No such collision exists on a group header.
 *
 * Leaving the surface out built the #7220 shape one grain FINER than the one
 * this function's own split exists to avoid: on a single record page a field
 * labelled `Role Of Record` was refused while the group header directly above
 * it, `Account & Role`, walked through — the author renames the field and the
 * heading keeps the word. `key` is visited beside `label` for the same reason
 * the other six surfaces visit name beside label: refusing `fields: { role }`
 * while admitting `fieldGroups: [{ key: 'role' }]` is that shape again.
 *
 * Deliberately NOT widened with it: `listViews`, `recordTypes` and the other
 * label-bearing surfaces. They are unmeasured here, not judged — each needs
 * the same reading this one got before it is in or out.
 *
 * ## Why this is a separate function from {@link validateSecurityPosture}
 *
 * [#8310] Not taste — a surface boundary. When the rest of the D7 block
 * crossed onto the runtime publish surface (`runtimeTypes: ['seed',
 * 'permission', 'book']` — `object` measured dirty and is escalated, see the
 * registry comment), this rule could not go with it: the per-write snapshot
 * (`runtime-gate.ts`) neither carried nor mapped `positions` / `apps`, both of
 * which are `allowRuntimeCreate: true` — so wiring it through the shared
 * entry would have enforced ONE rule id for a strict subset of its six
 * collections. That is the #7220 failure shape (a door that refuses a
 * permission set named `role_manager` while a position named `sales_role`
 * walks through), and
 * the registry refuses to build it in either direction. The rule therefore
 * stayed behind WHOLE, on its own CLI-only registry entry.
 *
 * [commit a227afa41] It is now ACROSS, still whole and still its own entry: mapping
 * `position` / `app` in `TYPE_TO_STACK_KEY` gives the gate a snapshot to build
 * for those two write types, and the entry declares all five write types the
 * six collections belong to. The split earned its keep exactly here — each
 * half crossed on its own evidence, in its own edit, and neither had to wait
 * for the other.
 */
export function validateSecurityRoleWord(stack: AnyRec): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const objects = recordsOf(stack.objects);
  const permissionSets = recordsOf(stack.permissions);

  /**
   * `idKey` is the spelling of the IDENTIFIER slot on the surface being
   * flagged. Six of the seven spell it `name`; `ObjectFieldGroupSchema` spells
   * it `key` and REJECTS `name` as an alias, so a fix-it naming `name` there
   * would point the author at a key the schema refuses — and the derived
   * sibling-label path would address a child of the identifier rather than the
   * identifier's neighbour.
   */
  const flagRole = (
    kind: string,
    name: unknown,
    label: unknown,
    where: string,
    path: string,
    idKey: 'name' | 'key' = 'name',
  ) => {
    if (identifierHasRoleToken(name)) {
      findings.push({
        severity: 'error',
        rule: SECURITY_ROLE_WORD,
        where,
        path,
        message:
          `${kind} ${idKey} "${String(name)}" uses the reserved word "role" — the platform vocabulary ` +
          `is permission_set (capability), position (distribution), business_unit (hierarchy) (ADR-0090 D3).`,
        hint: `Rename using 'position' for distribution groups or a domain word (e.g. 'function', 'duty').`,
      });
    } else if (labelHasRoleWord(label)) {
      findings.push({
        severity: 'error',
        rule: SECURITY_ROLE_WORD,
        where,
        path: `${path.replace(/\.(?:name|key)$/, '')}.label`,
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
    // [#18306] Field groups sit INSIDE this loop deliberately: the system-object
    // exemption above (better-auth `sys_member`) has to cover a group header on
    // a platform object exactly as it covers the fields under it.
    for (const [gi, group] of recordsOf(obj.fieldGroups).entries()) {
      flagRole(
        'field group',
        group.key,
        group.label,
        `field group "${objName}.${String(group.key ?? '?')}"`,
        `objects[${i}].fieldGroups[${gi}].key`,
        'key',
      );
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
