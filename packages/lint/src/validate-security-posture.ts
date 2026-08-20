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
 * | security-owd-alias            (error)   | ADR-0090 D4 canonical enum      |
 * | security-external-wider       (error)   | ADR-0090 D11 external ≤ internal|
 * | security-wildcard-vama        (error)   | ADR-0066 superuser wildcard     |
 * | security-anchor-high-privilege(error)   | ADR-0090 D5/D9 anchors          |
 * | security-role-word            (error)   | ADR-0090 D3 vocabulary freeze — own function/registry entry since #8310 |
 * | security-book-audience-unknown-set(warn)| ADR-0046 §6.7 { permissionSet } |
 * | security-private-no-readscope (info)    | admin-intent mismatch class     |
 * | security-master-detail-ungranted(warn)  | framework#2700 os-tianshun-mtc#43|
 * | security-grant-expired-at-authoring(err)| ADR-0091 D2 resolution filtering|
 * | security-delegation-missing-reason(err) | ADR-0091 D3 dual audit          |
 * | security-cbp-no-relation      (error)   | #7503 (runtime refusal #7474)   |
 *
 * Per ADR-0049 discipline these are NOT advisory security: every `error` rule
 * mirrors a runtime enforcement point (D1 fail-closed OWD default, D4 zod
 * enum + fail-closed evaluator, D5/D9 anchor binding gate, D3 rename wave) —
 * the lint moves the failure from runtime-deny to author-time fix-it. The
 * non-`error` rules are the ones with NO hard runtime refusal behind them:
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
 */

import { describeAnchorForbiddenBits } from '@objectstack/spec/security';

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
export const SECURITY_GRANT_EXPIRED_AT_AUTHORING = 'security-grant-expired-at-authoring';
export const SECURITY_DELEGATION_MISSING_REASON = 'security-delegation-missing-reason';
export const SECURITY_CBP_NO_RELATION = 'security-controlled-by-parent-no-relation';

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
/** [ADR-0090 D4] Legacy alias → canonical fix-it mapping. */
const OWD_ALIAS_FIX: Record<string, string> = {
  read: 'public_read',
  read_write: 'public_read_write',
  full: 'public_read_write',
  public: 'public_read_write',
};
/** D11 ordering for external ≤ internal (controlled_by_parent excluded). */
const OWD_WIDTH: Record<string, number> = {
  private: 0,
  public_read: 1,
  public_read_write: 2,
};

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

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
 * Works for both the array and name-keyed-map field forms (`asArray` folds the
 * map key into `name`).
 */
function firstMasterDetailField(obj: AnyRec): { name: string; parent?: string } | undefined {
  for (const f of asArray(obj.fields)) {
    if (f.type === 'master_detail') {
      return { name: String(f.name ?? '?'), parent: refOf(f) };
    }
  }
  return undefined;
}

/**
 * [#7503] The relation a `controlled_by_parent` object derives its access from,
 * or `undefined` when the platform has nothing to derive from.
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
 * The one DELIBERATE divergence is the reference spelling. The runtime accepts
 * `reference ?? reference_to ?? referenceTo`; `refOf` here accepts only
 * `reference`, the sole spelling `FieldSchema` declares. The aliases do not
 * parse (strict schema, #5017), so for any stack an author can ship the two
 * agree; re-introducing the alias fallback here would restore precisely the
 * inert branch #5017 removed, and on the pre-parse path the schema already
 * names the real defect (the alias key) rather than this rule guessing past it.
 */
function resolveCbpRelation(obj: AnyRec): { field: string; type: string; master: string } | undefined {
  const entries = asArray(obj.fields);
  const pick = (pred: (f: AnyRec) => boolean) => entries.find((f) => pred(f) && refOf(f));
  const found =
    pick((f) => f.type === 'master_detail' && !!f.required) ??
    pick((f) => f.type === 'master_detail') ??
    pick((f) => f.type === 'lookup' && !!f.required);
  if (!found) return undefined;
  return { field: String(found.name ?? '?'), type: String(found.type), master: refOf(found) as string };
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

  const objects = asArray(stack.objects);
  const permissionSets = asArray(stack.permissions);

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
        findings.push({
          severity: 'error',
          rule: SECURITY_OWD_ALIAS,
          where: `object "${objName}"`,
          path: `${objPath}.sharingModel`,
          message:
            `sharingModel '${owd}' is a retired alias (ADR-0090 D4). The runtime fails CLOSED ` +
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

    // D11: external dial present on any object (system included) must obey
    // external ≤ internal. controlled_by_parent inherits the master's pair.
    if (typeof external === 'string') {
      if (OWD_ALIAS_FIX[external]) {
        findings.push({
          severity: 'error',
          rule: SECURITY_OWD_ALIAS,
          where: `object "${objName}"`,
          path: `${objPath}.externalSharingModel`,
          message: `externalSharingModel '${external}' is a retired alias (ADR-0090 D4).`,
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
  for (const [i, book] of asArray(stack.books).entries()) {
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
  for (const [i, seed] of asArray(stack.data).entries()) {
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

  const objects = asArray(stack.objects);
  const permissionSets = asArray(stack.permissions);

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
    for (const f of asArray(obj.fields)) {
      flagRole('field', f.name, f.label, `field "${objName}.${String(f.name ?? '?')}"`, `objects[${i}].fields.${String(f.name ?? '?')}.name`);
    }
    for (const [ai, action] of asArray(obj.actions).entries()) {
      flagRole('action', action.name, action.label, `action "${objName}.${String(action.name ?? '?')}"`, `objects[${i}].actions[${ai}].name`);
    }
  }
  for (let i = 0; i < permissionSets.length; i++) {
    const ps = permissionSets[i];
    if (!ps || typeof ps !== 'object') continue;
    flagRole('permission set', ps.name, ps.label, `permission set "${String(ps.name ?? i)}"`, `permissions[${i}].name`);
  }
  for (const [i, pos] of asArray(stack.positions).entries()) {
    flagRole('position', pos.name, pos.label, `position "${String(pos.name ?? i)}"`, `positions[${i}].name`);
  }
  for (const [i, app] of asArray(stack.apps).entries()) {
    flagRole('app', app.name, app.label, `app "${String(app.name ?? i)}"`, `apps[${i}].name`);
  }
  for (const [i, book] of asArray(stack.books).entries()) {
    flagRole('book', book.name, book.label, `book "${String(book.name ?? i)}"`, `books[${i}].name`);
  }

  return findings;
}
