// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D6] Navigation reachability vs. granted access (issue #3583,
 * assessment R5).
 *
 * An app can put an object in its navigation without any permission set
 * granting read on it. Nothing rejects that: navigation and permissions are
 * separate metadata, each valid on its own. At runtime the entry renders, the
 * user clicks it, and the list view comes back permission-denied — for EVERY
 * user, including the admin, because a permission nobody was granted is a
 * permission nobody has. The HotCRM audit shipped two such objects
 * (`crm_forecast`, `crm_knowledge_article`).
 *
 * This is the first lint consumer of `buildAccessMatrix` (ADR-0090 D6), which
 * already derives one row per (permission set × object) with `read` folded
 * across `allowRead` / `viewAllRecords` / `modifyAllRecords`. The rule is that
 * matrix joined against what navigation exposes.
 *
 * ── Advisory, deliberately ──────────────────────────────────────────────
 *
 * A grant can legitimately live outside this stack: a permission set shipped by
 * another installed package, a platform default, or an org-level assignment
 * made after install. A stack is therefore not *wrong* to ship an ungranted nav
 * entry — it is only *suspicious*, and the ceiling for a static check is a
 * warning (the same posture `validate-capability-references` takes).
 *
 * Two exemptions keep it quiet:
 *   - **Platform-provided objects** (`sys_user`, `sys_approval_request`, …) are
 *     skipped: the packages that register them ship their own permission sets,
 *     which this stack never sees.
 *   - **A stack that declares no permission sets at all** is skipped entirely.
 *     Flagging every nav entry there says nothing useful — it means permissions
 *     are managed elsewhere, not that each entry is broken (the same
 *     "empty collection ⇒ don't judge" gate `defineStack` applies to nav
 *     dashboard/page/report references).
 */

import { isPlatformProvidedObjectName } from '@objectstack/spec/system';
import { buildAccessMatrix } from './build-access-matrix.js';

export const NAV_OBJECT_UNGRANTED = 'nav-object-ungranted';

export type NavAccessSeverity = 'error' | 'warning';

export interface NavAccessFinding {
  /** Always `warning` — a grant may come from a package this stack cannot see. */
  severity: NavAccessSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `app "crm" · nav "nav_forecast"`. */
  where: string;
  /** Config path, e.g. `apps[0].navigation[3].objectName`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** One navigation entry that exposes an object. */
interface NavExposure {
  objectName: string;
  where: string;
  path: string;
}

/** Collect every object a stack's navigation exposes, across areas and children. */
function collectNavExposures(stack: AnyRec): NavExposure[] {
  const out: NavExposure[] = [];
  const apps = asArray(stack.apps);

  for (let ai = 0; ai < apps.length; ai++) {
    const app = apps[ai];
    if (!app || typeof app !== 'object') continue;
    const appName = strName(app.name) ?? `#${ai}`;

    const walk = (items: unknown, basePath: string) => {
      const navItems = asArray(items);
      for (let ni = 0; ni < navItems.length; ni++) {
        const nav = navItems[ni];
        if (!nav || typeof nav !== 'object') continue;
        const navPath = `${basePath}[${ni}]`;
        const objectName = strName(nav.objectName);
        if (nav.type === 'object' && objectName) {
          out.push({
            objectName,
            where: `app "${appName}" · nav "${strName(nav.id) ?? `#${ni}`}"`,
            path: `${navPath}.objectName`,
          });
        }
        if (Array.isArray(nav.children)) walk(nav.children, `${navPath}.children`);
      }
    };

    walk(app.navigation, `apps[${ai}].navigation`);
    const areas = asArray(app.areas);
    for (let ri = 0; ri < areas.length; ri++) {
      walk(areas[ri]?.navigation, `apps[${ai}].areas[${ri}].navigation`);
    }
  }

  return out;
}

/**
 * Validate that every object a stack's navigation exposes is readable by at
 * least one permission set the stack declares. Returns findings (empty = clean).
 */
export function validateNavAccess(stack: AnyRec): NavAccessFinding[] {
  const findings: NavAccessFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  // No permission sets in this stack ⇒ permissions are managed elsewhere.
  const permissionSets = asArray(stack.permissions);
  if (permissionSets.length === 0) return findings;

  const exposures = collectNavExposures(stack);
  if (exposures.length === 0) return findings;

  // Objects this stack actually defines — the only ones whose grants must be
  // present here. A nav target that resolves nowhere is a different bug, owned
  // by `validate-object-references` / `defineStack`.
  const ownObjects = new Set<string>();
  for (const obj of asArray(stack.objects)) {
    const n = strName(obj.name);
    if (n) ownObjects.add(n);
  }

  // `read` is already folded across allowRead / viewAllRecords / modifyAllRecords.
  const readable = new Set<string>();
  for (const entry of buildAccessMatrix(stack).entries) {
    if (entry.read) readable.add(entry.object);
  }
  // A wildcard grant (`objects: { '*': { allowRead: true } }`) covers every
  // object — the shape the platform's own `admin_full_access` uses. Without
  // this the matrix records the literal key `*` and every object looks
  // ungranted, which would make the rule fire on exactly the stacks that
  // granted the most.
  if (readable.has('*')) return findings;

  // De-duplicate: one finding per object, not per nav entry that exposes it.
  const reported = new Set<string>();

  for (const exposure of exposures) {
    const { objectName } = exposure;
    if (reported.has(objectName)) continue;
    if (isPlatformProvidedObjectName(objectName)) continue; // granted by its own package
    if (!ownObjects.has(objectName)) continue; // not ours to grant
    if (readable.has(objectName)) continue;

    reported.add(objectName);
    findings.push({
      severity: 'warning',
      rule: NAV_OBJECT_UNGRANTED,
      where: exposure.where,
      path: exposure.path,
      message:
        `navigation exposes object "${objectName}", but no permission set this stack ` +
        `declares grants read on it — the entry renders, and opening it fails ` +
        `permission-denied for every principal except one holding the platform's ` +
        `built-in wildcard admin set. It works when you browse as an administrator ` +
        `and breaks for the users the app ships permission sets for.`,
      hint:
        `Add "${objectName}" to a permission set's \`objects\` with \`allowRead: true\` ` +
        `(or \`viewAllRecords\`), gate the entry with \`requiredPermissions\`/\`visible\` ` +
        `if it is meant for admins only, or drop it. Ignore this if a permission set ` +
        `from another installed package grants it.`,
    });
  }

  return findings;
}
