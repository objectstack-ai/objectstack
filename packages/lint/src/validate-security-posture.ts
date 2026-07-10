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
 * | security-role-word            (error)   | ADR-0090 D3 vocabulary freeze   |
 * | security-private-no-readscope (info)    | admin-intent mismatch class     |
 * | security-master-detail-ungranted(warn)  | framework#2700 os-tianshun-mtc#43|
 *
 * Per ADR-0049 discipline these are NOT advisory security: every `error` rule
 * mirrors a runtime enforcement point (D1 fail-closed OWD default, D4 zod
 * enum + fail-closed evaluator, D5/D9 anchor binding gate, D3 rename wave) —
 * the lint moves the failure from runtime-deny to author-time fix-it. The lone
 * `warning` (master-detail-ungranted) likewise mirrors a runtime gate — the
 * object-level CRUD check (ADR-0055) — but stays advisory: it flags a *likely*
 * misconfiguration whose per-permission-set nuance it cannot fully adjudicate.
 *
 * Pure `(stack) => Finding[]`; accepts the NORMALIZED stack input (works both
 * pre- and post-zod-parse, so `os lint` catches what the zod gate would
 * reject in `os compile` — with a better message).
 */

import { describeAnchorForbiddenBits } from '@objectstack/spec/security';

export const SECURITY_OWD_UNSET = 'security-owd-unset';
export const SECURITY_OWD_ALIAS = 'security-owd-alias';
export const SECURITY_EXTERNAL_WIDER = 'security-external-wider-than-internal';
export const SECURITY_WILDCARD_VAMA = 'security-wildcard-vama';
export const SECURITY_ANCHOR_HIGH_PRIVILEGE = 'security-anchor-high-privilege';
export const SECURITY_ROLE_WORD = 'security-role-word';
export const SECURITY_PRIVATE_NO_READSCOPE = 'security-private-no-readscope';
export const SECURITY_MASTER_DETAIL_UNGRANTED = 'security-master-detail-ungranted';

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

function owdOf(obj: AnyRec): unknown {
  return obj.sharingModel ?? (obj.security as AnyRec | undefined)?.sharingModel;
}

function isSystemObject(obj: AnyRec): boolean {
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

/** The `reference`/`reference_to` target a relationship field points at. */
function refOf(def: AnyRec): string | undefined {
  const r = (def.reference ?? def.reference_to) as unknown;
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
 */
export function validateSecurityPosture(stack: AnyRec): SecurityFinding[] {
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

  // ── D3: the word "role" is reserved-forbidden ────────────────────────
  // Scope: security-relevant identifiers/labels (objects, fields, actions,
  // permission sets, positions, apps). Pages/views/components are NOT
  // scanned — `role` there is HTML/ARIA semantics, not permission vocabulary.
  // The sole platform exception (better-auth `sys_member.role`) is a system
  // object, which app stacks never author.
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

  return findings;
}
