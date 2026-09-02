// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0072 — reference resolvability] Object-name reference integrity for the
 * surfaces no other rule owns (issue #3583).
 *
 * A HotCRM audit (~18k lines of shipped metadata) found ~20 instances of ONE
 * bug class: metadata naming an object that does not exist. Every instance
 * passed `objectstack validate` and `objectstack lint` cleanly and failed
 * SILENTLY at runtime — `object: 'user'` where the platform object is
 * `sys_user`, navigation targeting `sys_approval_process` (which
 * `@objectstack/plugin-approvals` never registers; ADR-0019 removed it).
 *
 * `defineStack`'s `validateCrossReferences` already hard-fails on the object
 * references it knows about (hooks, view data, seeds, mappings, permission
 * grants, nav `objectName`, action targets). This rule covers the REST — the
 * reference sites that are plain `z.string()` in the schema and therefore ship
 * whatever the author typed:
 *
 *   - action params — `reference` (inline lookup/master_detail target) and
 *     `objectOverride` (the object owning a field-backed param). Both are the
 *     record picker's search target; a dead one degrades the dialog to a raw
 *     id text input.
 *   - dashboard `globalFilters[].optionsFrom.object` — the object a filter
 *     dropdown fetches its options from. Dead → an always-empty dropdown.
 *   - ADR-0021 `datasets[].object` (#14105) — the FROM of the semantic layer.
 *     Dead → every report and dashboard widget bound to that dataset queries an
 *     object that does not exist, and `validate`/`build` both exited 0 before
 *     this site existed. Its field-level siblings (`include`,
 *     `dimensions[].field`, `measures[].field`, filter keys) live in
 *     `validate-dataset-references.ts`, which skips a dataset whose base object
 *     lands here so one typo yields one finding.
 *   - navigation `requiresObject` / `requiresService` capability gates. This is
 *     the escape hatch `stack.zod.ts` honours to SKIP nav validation, so a typo
 *     here is doubly silent: the entry is hidden forever (the runtime never
 *     finds the object in its SchemaRegistry) AND the skip suppresses the
 *     cross-reference error that would have caught the nav target.
 *   - the nav `objectName` of an item that carries `requiresObject` — exempted
 *     from the `defineStack` throw for good reason (it may come from another
 *     package), but still worth an advisory when NO known package provides it.
 *
 * ── Severity ladder (the point of the rule) ──────────────────────────────
 *
 * Prior rules answered "might this object come from another package?" with a
 * PREFIX GUESS (`name.startsWith('sys_')` → skip). That guess cannot tell
 * `sys_user` (real) from `sys_approval_process` (fictional), so every fictional
 * platform-prefixed reference shipped. This rule resolves against the curated
 * `PLATFORM_PROVIDED_OBJECT_NAMES` registry instead:
 *
 *   1. resolves in the stack's own objects            → OK
 *   2. unresolved, NOT platform-prefixed              → ERROR
 *        (`user`, `total_revenue` — no cross-package story exists for an
 *         unprefixed name, since a stack's objects are namespace-prefixed;
 *         this is the pure typo class and the bulk of the HotCRM findings)
 *   3. unresolved, prefixed, IN the registry          → OK
 *   4. unresolved, prefixed, NOT in the registry      → WARNING
 *        (`sys_approval_process` — no package we know of registers it, but a
 *         third-party package still might, so advisory is the honest ceiling)
 *
 * Interpolated targets (`${…}`, `{…}`) are skipped — they resolve at render
 * time, the same conservative exemption `validate-dashboard-action-refs` uses
 * to keep false positives near zero (ADR-0072 D1: one dead finding and authors
 * stop trusting the linter).
 */

import {
  hasPlatformObjectPrefix,
  isPlatformProvidedObjectName,
  PLATFORM_PROVIDED_OBJECT_NAMES,
} from '@objectstack/spec/system';

/** Materialized once for the repeated edit-distance scans in `suggest`. */
const PLATFORM_NAMES: readonly string[] = [...PLATFORM_PROVIDED_OBJECT_NAMES];

export const OBJECT_REFERENCE_UNKNOWN = 'object-reference-unknown';
export const OBJECT_REFERENCE_UNREGISTERED_PLATFORM = 'object-reference-unregistered-platform';

export type ObjectRefSeverity = 'error' | 'warning';

export interface ObjectRefFinding {
  /** `error` for an unresolvable own-stack name; `warning` for an unknown platform name. */
  severity: ObjectRefSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `action "mass_update" · param "owner"`. */
  where: string;
  /** Config path, e.g. `actions[2].params[0].reference`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/** Coerce a collection (array or name-keyed map) to an array of records,
 *  injecting `name` from the map key — mirrors the sibling authoring lints so
 *  the rule works on both the parsed (array) and normalized (map) stack shapes. */
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

/**
 * A target the author cannot have meant literally — `${…}` or `{…}` resolved at
 * render time.
 *
 * Scanned rather than matched with `/\{[^}]+\}/`: that pattern backtracks
 * quadratically on a long run of `{` with no closing brace (CodeQL
 * polynomial-ReDoS), and the question here is simply "is there a `{` with a
 * later `}` and something in between", which one pass answers.
 */
function isInterpolated(target: string): boolean {
  if (target.includes('${')) return true;
  const open = target.indexOf('{');
  // `+ 2` keeps the original "at least one character between the braces"
  // semantics, so a literal `{}` is not treated as a placeholder.
  return open !== -1 && target.indexOf('}', open + 2) !== -1;
}

/** Levenshtein-bounded "did you mean?" over the known names. */
function suggest(target: string, known: Iterable<string>): string {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of known) {
    const d = distance(target, candidate);
    if (d < bestScore) {
      bestScore = d;
      best = candidate;
    }
  }
  // Only offer a suggestion that is plausibly the same identifier mistyped.
  const limit = Math.max(2, Math.floor(target.length / 3));
  return best && bestScore <= limit ? ` Did you mean "${best}"?` : '';
}

function distance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i, ...new Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * Validate every object-name reference on the surfaces listed in the module
 * header. Returns findings (empty = clean).
 */
export function validateObjectReferences(stack: AnyRec): ObjectRefFinding[] {
  const findings: ObjectRefFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const objects = asArray(stack.objects);
  const ownObjects = new Set<string>();
  for (const obj of objects) {
    const n = strName(obj.name);
    if (n) ownObjects.add(n);
  }

  /**
   * Resolve one reference through the ladder and record a finding if it fails.
   * `subject` describes the reference for the message ("record-picker target").
   */
  const check = (
    target: string | undefined,
    where: string,
    path: string,
    subject: string,
    fix: string,
  ) => {
    const name = strName(target);
    if (!name) return;
    if (isInterpolated(name)) return; // resolved at render time
    if (ownObjects.has(name)) return; // ① own object
    if (isPlatformProvidedObjectName(name)) return; // ③ known platform object

    if (hasPlatformObjectPrefix(name)) {
      // ④ Platform-shaped, but no package we know of registers it.
      findings.push({
        severity: 'warning',
        rule: OBJECT_REFERENCE_UNREGISTERED_PLATFORM,
        where,
        path,
        message:
          `${subject} "${name}" carries a platform namespace prefix, but no platform ` +
          `package, official plugin, or cloud runtime object registers that name — ` +
          `and this stack does not define it either. If nothing provides it at runtime ` +
          `the reference resolves to nothing and fails silently.` +
          suggest(name, PLATFORM_NAMES),
        hint:
          `Check the spelling against the object the providing package actually registers ` +
          `(e.g. "sys_approval_request", not "sys_approval_process" — the process object ` +
          `was removed when approval became a flow node, ADR-0019). If a third-party ` +
          `package genuinely provides it, this warning is expected. ${fix}`,
      });
      return;
    }

    // ② Unprefixed and unresolved — a stack's own objects are namespace-
    // prefixed and present here, so there is no legitimate elsewhere.
    findings.push({
      severity: 'error',
      rule: OBJECT_REFERENCE_UNKNOWN,
      where,
      path,
      message:
        `${subject} "${name}" resolves to no object defined in this stack. ` +
        `The reference is inert at runtime — nothing reports the miss.` +
        suggest(name, ownObjects),
      hint:
        `Point it at one of this stack's objects, or at a platform object by its full ` +
        `name (the platform user object is "sys_user", not "user"). ${fix}` +
        (ownObjects.size > 0 ? ` Defined objects: ${[...ownObjects].sort().join(', ')}.` : ''),
    });
  };

  // ── Actions (global + object-embedded) → param object targets ──
  const checkActionParams = (action: AnyRec, actionPath: string, actionLabel: string) => {
    const params = asArray(action.params);
    for (let pi = 0; pi < params.length; pi++) {
      const param = params[pi];
      if (!param || typeof param !== 'object') continue;
      const paramLabel = strName(param.name) ?? strName(param.field) ?? `#${pi}`;
      const where = `${actionLabel} · param "${paramLabel}"`;
      check(
        strName(param.reference),
        where,
        `${actionPath}.params[${pi}].reference`,
        'record-picker target',
        'Without a resolvable target the picker degrades to a raw record-id text input.',
      );
      check(
        strName(param.objectOverride),
        where,
        `${actionPath}.params[${pi}].objectOverride`,
        'field-backed param object',
        'The param inherits type/options from a field on this object, so an unknown object leaves it untyped.',
      );
    }
  };

  const globalActions = asArray(stack.actions);
  for (let ai = 0; ai < globalActions.length; ai++) {
    const action = globalActions[ai];
    if (!action || typeof action !== 'object') continue;
    checkActionParams(action, `actions[${ai}]`, `action "${strName(action.name) ?? `#${ai}`}"`);
  }

  for (let oi = 0; oi < objects.length; oi++) {
    const obj = objects[oi];
    if (!obj || typeof obj !== 'object') continue;
    const objName = strName(obj.name) ?? `#${oi}`;
    const objActions = asArray(obj.actions);
    for (let ai = 0; ai < objActions.length; ai++) {
      const action = objActions[ai];
      if (!action || typeof action !== 'object') continue;
      checkActionParams(
        action,
        `objects[${oi}].actions[${ai}]`,
        `object "${objName}" · action "${strName(action.name) ?? `#${ai}`}"`,
      );
    }
  }

  // ── Dashboard global filters → optionsFrom.object ──
  const dashboards = asArray(stack.dashboards);
  for (let di = 0; di < dashboards.length; di++) {
    const dash = dashboards[di];
    if (!dash || typeof dash !== 'object') continue;
    const dashName = strName(dash.name) ?? `#${di}`;
    const filters = asArray(dash.globalFilters);
    for (let fi = 0; fi < filters.length; fi++) {
      const filter = filters[fi];
      if (!filter || typeof filter !== 'object') continue;
      const optionsFrom = filter.optionsFrom as AnyRec | undefined;
      if (!optionsFrom || typeof optionsFrom !== 'object') continue;
      check(
        strName(optionsFrom.object),
        `dashboard "${dashName}" · filter "${strName(filter.name) ?? `#${fi}`}"`,
        `dashboards[${di}].globalFilters[${fi}].optionsFrom.object`,
        'filter options source',
        'The dropdown fetches its options from this object; an unknown one renders an always-empty filter.',
      );
    }
  }

  // ── ADR-0021 datasets → the base object (#14105) ──
  // `DatasetSchema.object` is `z.string()`, so nothing resolved it: a dataset
  // over an object that does not exist passed `objectstack validate` at exit 0
  // and `build` wrote it into `dist/objectstack.json` (measured on 17.2.0). It
  // belongs on THIS rule rather than beside the dataset field checks
  // (`validate-dataset-references.ts`) because the reference is an object NAME,
  // and the severity ladder above is the whole reason: the platform's own
  // `system.datasets.ts` declares five datasets over `sys_*` objects, three of
  // which live in packages a stack compiling plugin-auth alone cannot see. All
  // five resolve through `PLATFORM_PROVIDED_OBJECT_NAMES` (rung ③); a local
  // "not in this stack ⇒ error" check would have reported every one of them.
  const datasets = asArray(stack.datasets);
  for (let dsi = 0; dsi < datasets.length; dsi++) {
    const ds = datasets[dsi];
    if (!ds || typeof ds !== 'object') continue;
    check(
      strName(ds.object),
      `dataset "${strName(ds.name) ?? `#${dsi}`}"`,
      `datasets[${dsi}].object`,
      'dataset base object',
      'A dataset is the FROM of every report and dashboard widget bound to it (ADR-0021), so ' +
        'an unknown base object leaves every one of those surfaces querying nothing.',
    );
  }

  // ── App navigation → requiresObject gates (and gated objectName) ──
  const apps = asArray(stack.apps);
  for (let ai = 0; ai < apps.length; ai++) {
    const app = apps[ai];
    if (!app || typeof app !== 'object') continue;
    const appName = strName(app.name) ?? `#${ai}`;

    const walkNav = (items: unknown, basePath: string) => {
      const navItems = asArray(items);
      for (let ni = 0; ni < navItems.length; ni++) {
        const nav = navItems[ni];
        if (!nav || typeof nav !== 'object') continue;
        const navId = strName(nav.id) ?? `#${ni}`;
        const where = `app "${appName}" · nav "${navId}"`;
        const navPath = `${basePath}[${ni}]`;

        check(
          strName(nav.requiresObject),
          where,
          `${navPath}.requiresObject`,
          'capability gate object',
          'The entry is hidden unless this object is registered, so a typo hides it permanently — ' +
            'and it suppresses the nav cross-reference check that would have caught the target.',
        );

        // A nav target exempted from the `defineStack` throw by `requiresObject`
        // still deserves an advisory when nothing known provides it.
        if (nav.requiresObject && strName(nav.objectName)) {
          check(
            strName(nav.objectName),
            where,
            `${navPath}.objectName`,
            'navigation target',
            'Declaring `requiresObject` exempts this target from the build-time check, so it is only verified here.',
          );
        }

        if (Array.isArray(nav.children)) walkNav(nav.children, `${navPath}.children`);
      }
    };

    walkNav(app.navigation, `apps[${ai}].navigation`);
    const areas = asArray(app.areas);
    for (let ri = 0; ri < areas.length; ri++) {
      walkNav(areas[ri]?.navigation, `apps[${ai}].areas[${ri}].navigation`);
    }
  }

  return findings;
}
