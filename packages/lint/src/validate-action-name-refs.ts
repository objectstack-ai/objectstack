// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0049 — references] Action-NAME reference integrity for the surfaces that
 * bind an action by name (issue #3583).
 *
 * `locations` is an action's primary binding, but several surfaces reference
 * actions **by name** instead (see `content/docs/ui/actions.mdx` — "Surfaces can
 * also reference actions by name"). Every one of those fields is a plain
 * `z.array(z.string())` / `z.string()`, so a name that matches no defined action
 * parses and ships:
 *
 *   - list views — `rowActions[]` / `bulkActions[]`, plus each
 *     `bulkActionDefs[]` entry that is a reference rather than a button id
 *     (`execution: 'aggregate'` — see the walk). Across all three tiers: the
 *     default `list` container, each `listViews.<key>` entry, and an OBJECT's
 *     own `listViews.<key>` (added in #4457; an object has no top-level `list`,
 *     so that tier had simply never been walked)
 *   - page components — `record:quick_actions` → `properties.actionNames[]`
 *   - page components — `record:alert` → `properties.action.actionName` (the
 *     banner's call-to-action) and `page:header` → `properties.actions[]` (the
 *     header's action ids). Both renderers resolve the id against the object's
 *     declared actions and draw NOTHING for one that resolves nowhere — the
 *     alert keeps its banner and loses its button without a word, the header
 *     renders one button fewer and says so only in a browser console no
 *     author reads — so authoring time is where the refusal belongs (#20105).
 *     Each walk is scoped to its component type, because the same key means
 *     something else elsewhere: `element:button`'s `action` is an inline
 *     definition, not a reference.
 *   - page components — `record:related_list` → `properties.actions[]` (the
 *     list's action ids, #20936). objectui resolves each id against the
 *     RELATED (child) object's own actions — not the page's object — and
 *     places it by that action's own `locations`; an id that misses either
 *     test draws no button, only a refusal notice above the list. This walk is
 *     therefore the one that resolves against an OBJECT rather than the whole
 *     stack, and the one that checks placement — see the scope note.
 *   - app navigation — `{ type: 'action', actionDef: { actionName } }`
 *   - app navigation deep-link auto-run — `{ type: 'object', runAction }`
 *     (#4848 — the declared form of the `?runAction=<name>` URL contract)
 *
 * The HotCRM audit shipped `bulkActions: ['mass_update', 'mass_delete',
 * 'assign_owner']` with none of the three defined anywhere: the toolbar renders
 * the buttons, selecting rows enables them, and clicking does nothing.
 *
 * This is the same failure `validate-dashboard-action-refs` catches for
 * dashboard header/widget buttons (`DASHBOARD_ACTION_TARGET_UNDEFINED`), so it
 * carries the same severity: **error**. It is a genuine dead reference, and —
 * unlike an object name — there is no cross-package escape hatch to soften it
 * with. The runtime ships NO built-in action names (there is no
 * `BUILTIN_ACTIONS` registry; `list_toolbar`/`list_item` are *locations*, not
 * actions), so a name resolving nowhere is dead, full stop.
 *
 * Scope note: this rule asks only "is this action defined ANYWHERE in the
 * stack?". It deliberately does NOT check that a view's action belongs to the
 * view's own object, nor that the action declares the matching `location` —
 * both are real but distinct classes, and folding them in here would trade the
 * zero-false-positive posture (ADR-0072 D1) for coverage this issue did not ask
 * for. An action defined by another installed package is the one legitimate
 * miss; it is called out in the hint rather than guessed at.
 *
 * The `record:related_list` walk is the exception, and it keeps the posture
 * rather than trading it. Its renderer asks both questions itself — is the id
 * an action of the CHILD object, and does that action declare a location the
 * list draws — and refuses the id when either answer is no. A finding that
 * repeats that refusal is not a false positive; it is the runtime's own verdict
 * moved to authoring time, which is what ADR-0072 D1 asks for ("resolve at
 * runtime for the surface being authored"). So the walk answers from the child
 * object's actions, and only for a child object this stack DEFINES: one it
 * does not define has its actions in another package, and the walk says
 * nothing about it rather than guess. Every other walk is unchanged.
 */

import { ACTION_LOCATIONS, type ActionLocation } from '@objectstack/spec/ui';
import { recordsOf, suggestName } from './object-graph.js';
import { walkPageComponents } from './page-walk.js';

export const ACTION_NAME_UNDEFINED = 'action-name-undefined';

export type ActionNameRefSeverity = 'error' | 'warning';

export interface ActionNameRefFinding {
  /** Always `error` — a name-bound action that resolves nowhere is a dead button. */
  severity: ActionNameRefSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `view "crm_lead" · list "all" · bulkActions`. */
  where: string;
  /** Config path, e.g. `views[0].list.bulkActions[1]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

/** Every action name defined in the stack (global + object-embedded). */
function collectActionNames(stack: AnyRec): Set<string> {
  const names = new Set<string>();
  for (const action of recordsOf(stack.actions)) {
    const n = strName(action?.name);
    if (n) names.add(n);
  }
  for (const obj of recordsOf(stack.objects)) {
    if (!obj || typeof obj !== 'object') continue;
    for (const action of recordsOf(obj.actions)) {
      const n = strName(action?.name);
      if (n) names.add(n);
    }
  }
  return names;
}

/**
 * What a `record:related_list` draws for an authored action placed at each
 * location of the spec's vocabulary (`ACTION_LOCATIONS`), or `null` where it
 * draws nothing. Read at objectui's `relatedListActions.ts`
 * (`placeAuthoredRelatedListActions`): `list_toolbar` is a header button;
 * `list_item` and `record_related` are a row-menu item. The list renders only
 * inside a parent record, which is the one scope `record_related` names.
 *
 * Keyed by `ActionLocation`, so the vocabulary is read from the spec and never
 * copied: a location the spec adds fails this package's typecheck until it is
 * classified here, instead of leaving a stale pair that silently refuses it.
 */
const RELATED_LIST_DRAWS: Readonly<Record<ActionLocation, string | null>> = {
  list_toolbar: 'a header button',
  list_item: 'a row-menu item',
  record_header: null,
  record_more: null,
  record_related: 'a row-menu item',
  record_section: null,
};

/** The locations a related list draws, in the spec's own order. */
const RELATED_LIST_LOCATIONS: readonly ActionLocation[] = ACTION_LOCATIONS.filter(
  (location) => RELATED_LIST_DRAWS[location] !== null,
);

/** `` `list_toolbar` (a header button), … `` — for a hint. */
const RELATED_LIST_PLACEMENTS = RELATED_LIST_LOCATIONS.map(
  (location) => `\`${location}\` (${RELATED_LIST_DRAWS[location]})`,
).join(', ');

/**
 * The actions a related list resolves an id against, for each object this
 * stack DEFINES: the actions written on the object (keyed by the object they
 * are written on), then every `stack.actions` entry bound to it by
 * `objectName` — the set `defineStack` merges into the object's `actions`, so
 * the set the object's metadata serves to the renderer. An object this stack
 * does not define is absent from the map: its actions live in another package.
 */
function indexObjectActions(stack: AnyRec): Map<string, Map<string, AnyRec>> {
  const index = new Map<string, Map<string, AnyRec>>();
  for (const obj of recordsOf(stack.objects)) {
    const objectName = strName(obj.name);
    if (!objectName) continue;
    const byName = index.get(objectName) ?? new Map<string, AnyRec>();
    for (const action of recordsOf(obj.actions)) {
      const n = strName(action.name);
      if (n && !byName.has(n)) byName.set(n, action);
    }
    index.set(objectName, byName);
  }
  for (const action of recordsOf(stack.actions)) {
    const owner = strName(action.objectName);
    const byName = owner ? index.get(owner) : undefined;
    const n = strName(action.name);
    if (byName && n && !byName.has(n)) byName.set(n, action);
  }
  return index;
}

/** Where an action name IS defined in the stack: `on object "x"` per owner, or `as a global action`. */
function actionOwners(stack: AnyRec, name: string): string[] {
  const owners = new Set<string>();
  for (const obj of recordsOf(stack.objects)) {
    if (recordsOf(obj.actions).some((a) => a.name === name)) {
      owners.add(`on object "${strName(obj.name) ?? '?'}"`);
    }
  }
  for (const action of recordsOf(stack.actions)) {
    if (action.name !== name) continue;
    const owner = strName(action.objectName);
    owners.add(owner ? `on object "${owner}"` : 'as a global action');
  }
  return [...owners].sort();
}

/**
 * Validate every name-bound action reference in a stack. Returns findings
 * (empty = clean).
 */
export function validateActionNameRefs(stack: AnyRec): ActionNameRefFinding[] {
  const findings: ActionNameRefFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const known = collectActionNames(stack);
  let objectActions: Map<string, Map<string, AnyRec>> | undefined;

  const check = (
    name: string,
    where: string,
    path: string,
    surface: string,
    /**
     * What the newly-defined action still needs to be reachable from THIS
     * surface. A row/quick-action menu filters on `locations`; the selection
     * bar does not — naming the action in the view is its whole declaration
     * (the `action.bulkEnabled` tombstone says so, and `content/docs/ui/
     * actions.mdx` names it as the one exception to location filtering). One
     * hint for both would have to be wrong for one of them.
     */
    placement = 'with the location this surface needs',
    /**
     * What the author will SEE. Most surfaces draw the button and dispatch
     * nothing; a surface that resolves the id before drawing (the alert's
     * call-to-action, the page header) draws no button at all — one sentence
     * for both would describe a failure the author cannot find.
     */
    consequence = 'The button renders and does nothing when clicked — a dead affordance the runtime cannot dispatch.',
  ) => {
    if (known.has(name)) return;
    findings.push({
      severity: 'error',
      rule: ACTION_NAME_UNDEFINED,
      where,
      path,
      message:
        `${surface} names action "${name}", which is defined by no action in this stack ` +
        `(neither \`stack.actions\` nor any object's \`actions\`). ${consequence}` +
        suggestName(name, known),
      hint:
        `Define an action named "${name}" (in \`stack.actions\` or the object's \`actions\`) ` +
        `${placement}, remove the reference, or ignore this if the ` +
        `action is contributed by another installed package.` +
        (known.size > 0 ? ` Defined actions: ${[...known].sort().join(', ')}.` : ''),
    });
  };

  /** Naming an action in the selection bar IS its placement — see `check`. */
  const SELECTION_BAR_PLACEMENT =
    '(no `locations` entry needed — the selection bar places it by name)';

  /**
   * One list container: the default `list`, a `listViews.<key>` entry, or an
   * object-embedded one. Shared so the three tiers cannot drift into checking
   * different keys — an object has no top-level `list`, and its `listViews`
   * went unchecked until #4457 while the view-level ones were covered.
   */
  const checkListContainer = (
    container: unknown,
    owner: string,
    label: string,
    path: string,
  ) => {
    if (!container || typeof container !== 'object') return;
    const list = container as AnyRec;
    for (const key of ['rowActions', 'bulkActions'] as const) {
      const names = strList(list[key]);
      for (let ai = 0; ai < names.length; ai++) {
        check(
          names[ai],
          `${owner} · ${label} · ${key}`,
          `${path}.${key}[${ai}]`,
          key === 'bulkActions' ? 'Bulk-action menu' : 'Row-action menu',
          key === 'bulkActions' ? SELECTION_BAR_PLACEMENT : undefined,
        );
      }
    }

    // `bulkActionDefs` — only SOME entries are name references (#4457).
    //
    // An `update`/`delete` def is a data-plane mass mutation: its `name` is a
    // button id and resolving it against `stack.actions` would be nonsense.
    // The one entry that IS a reference is `execution: 'aggregate'`, which is
    // exactly what objectui's `resolveBulkActions` looks up by name to attach
    // the action it dispatches — a name that hits nothing leaves the def with
    // no dispatcher, so the button opens its dialog and the run resolves to
    // "no dispatcher wired". Same dead affordance, same severity.
    //
    // (Spec's `BulkActionDefSchema` rejects a hand-written `actionDef`, but a
    // stack can reach lint through paths that never parsed — a raw JSON fixture,
    // an older package — so an inlined definition is skipped rather than
    // assumed impossible: it carries its own dispatcher and resolves nothing.)
    const defs = Array.isArray(list.bulkActionDefs) ? (list.bulkActionDefs as AnyRec[]) : [];
    for (let di = 0; di < defs.length; di++) {
      const def = defs[di];
      if (!def || typeof def !== 'object') continue;
      if (def.execution !== 'aggregate') continue;
      if (def.actionDef !== undefined) continue;
      const name = strName(def.name);
      if (!name) continue;
      check(
        name,
        `${owner} · ${label} · bulkActionDefs[${di}]`,
        `${path}.bulkActionDefs[${di}].name`,
        'Aggregate bulk action',
        SELECTION_BAR_PLACEMENT,
      );
    }
  };

  // ── List views: `list` + each `listViews.<key>`, on views AND on objects ──
  const views = recordsOf(stack.views);
  for (let vi = 0; vi < views.length; vi++) {
    const view = views[vi];
    if (!view || typeof view !== 'object') continue;
    const viewName = strName(view.name) ?? strName(view.object) ?? `#${vi}`;
    const owner = `view "${viewName}"`;

    checkListContainer(view.list, owner, 'list', `views[${vi}].list`);
    const listViews = view.listViews;
    if (listViews && typeof listViews === 'object' && !Array.isArray(listViews)) {
      for (const [key, lv] of Object.entries(listViews as AnyRec)) {
        checkListContainer(lv, owner, `listViews.${key}`, `views[${vi}].listViews.${key}`);
      }
    }
  }

  // An object carries its own `listViews` (it has no top-level `list`), and a
  // reference there is as dead as one in a standalone view — it was simply
  // never walked. Object-EMBEDDED actions were already collected as
  // definitions above; this is the consuming half.
  const objects = recordsOf(stack.objects);
  for (let oi = 0; oi < objects.length; oi++) {
    const obj = objects[oi];
    if (!obj || typeof obj !== 'object') continue;
    const objListViews = obj.listViews;
    if (!objListViews || typeof objListViews !== 'object' || Array.isArray(objListViews)) continue;
    const owner = `object "${strName(obj.name) ?? `#${oi}`}"`;
    for (const [key, lv] of Object.entries(objListViews as AnyRec)) {
      checkListContainer(lv, owner, `listViews.${key}`, `objects[${oi}].listViews.${key}`);
    }
  }

  /**
   * `record:related_list` → `properties.actions[]`. The renderer resolves each
   * id against the RELATED object's own actions and places it by that
   * action's own `locations` — naming it here is not a placement — and an id
   * that misses either test draws no button, only a refusal notice above the
   * list. Only the string elements are ids, each reported at its AUTHORED
   * index, as for `page:header`. Silent when `child` is not an object this
   * stack defines: its actions live in another package.
   */
  const checkRelatedListActions = (
    child: string | undefined,
    ids: readonly unknown[],
    where: string,
    path: string,
  ) => {
    if (!child) return;
    objectActions ??= indexObjectActions(stack);
    const childActions = objectActions.get(child);
    if (!childActions) return;
    const childNames = [...childActions.keys()].sort();
    for (let ri = 0; ri < ids.length; ri++) {
      const id = strName(ids[ri]);
      if (!id) continue;
      const idPath = `${path}.properties.actions[${ri}]`;
      const action = childActions.get(id);
      if (!action) {
        const owners = known.has(id) ? actionOwners(stack, id) : [];
        findings.push({
          severity: 'error',
          rule: ACTION_NAME_UNDEFINED,
          where,
          path: idPath,
          message:
            `Related-list actions names action "${id}", which is not an action of the related object ` +
            `"${child}"` +
            (owners.length > 0
              ? ` (it is defined in this stack ${owners.join(' and ')}, which this list never reads)`
              : ' (no action in this stack defines it)') +
            ". The list resolves each id against its related object's own actions only — not the " +
            "page's object, not a global action — so it draws no button for this one, only a refusal " +
            'notice naming it above the list.' +
            suggestName(id, childNames),
          hint:
            `Define "${id}" on "${child}" — in that object's \`actions\`, or in \`stack.actions\` with ` +
            `\`objectName: '${child}'\` — with one of ${RELATED_LIST_PLACEMENTS} in its \`locations\`; ` +
            `or name one of "${child}"'s own actions; or remove the reference. Ignore this only if ` +
            `another installed package binds the action to "${child}".` +
            ` Actions of "${child}": ${childNames.length > 0 ? childNames.join(', ') : '(none)'}.`,
        });
        continue;
      }
      const declared = Array.isArray(action.locations)
        ? action.locations.filter((l): l is string => typeof l === 'string')
        : undefined;
      if (declared?.some((l) => (RELATED_LIST_LOCATIONS as readonly string[]).includes(l))) continue;
      findings.push({
        severity: 'error',
        rule: ACTION_NAME_UNDEFINED,
        where,
        path: idPath,
        message:
          `Related-list actions names action "${id}", an action of the related object "${child}" ` +
          (declared === undefined
            ? 'that declares no `locations`, so it is placed at none'
            : `whose \`locations\` (${declared.length > 0 ? declared.join(', ') : 'empty'}) include none`) +
          ` of the locations a related list draws (${RELATED_LIST_LOCATIONS.join(', ')}). The list ` +
          'places an authored action by its own `locations` — naming it here is not a placement — so ' +
          'it draws no button for it, only a refusal notice naming it above the list.',
        hint:
          `Add one of ${RELATED_LIST_PLACEMENTS} to the \`locations\` of "${id}" on "${child}", ` +
          'or remove the reference.',
      });
    }
  };

  // ── Page components: record:quick_actions → properties.actionNames,
  //    record:alert → properties.action.actionName,
  //    page:header → properties.actions[],
  //    record:related_list → properties.actions[] (against the child object) ──
  const pages = recordsOf(stack.pages);
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    if (!page || typeof page !== 'object') continue;
    const pageName = strName(page.name) ?? `#${pi}`;

    // Traversal is shared (`page-walk.ts`): the component tree is NOT where a
    // first reading suggests. Components hang off `regions[].components[]` and
    // `slots`, never a top-level `page.components`, and sub-trees nest inside
    // the untyped `properties` bag rather than under a `children` key.
    for (const { component, path } of walkPageComponents(page, `pages[${pi}]`)) {
      const props = component.properties as AnyRec | undefined;
      if (!props || typeof props !== 'object') continue;
      const type = strName(component.type);
      const where = `page "${pageName}" · component "${type ?? '?'}"`;
      const names = strList(props.actionNames);
      for (let ai = 0; ai < names.length; ai++) {
        check(
          names[ai],
          where,
          `${path}.properties.actionNames[${ai}]`,
          'Quick-actions bar',
        );
      }

      // `record:alert`'s call-to-action. The renderer resolves `actionName`
      // against the object's declared actions and, on a miss, renders the
      // banner WITHOUT its button — nothing is logged. It runs the resolved
      // action by name, with no `locations` filter, so the name is the whole
      // placement.
      if (type === 'record:alert') {
        const cta = props.action;
        const ctaName =
          cta && typeof cta === 'object' && !Array.isArray(cta)
            ? strName((cta as AnyRec).actionName)
            : undefined;
        if (ctaName) {
          check(
            ctaName,
            where,
            `${path}.properties.action.actionName`,
            'Alert call-to-action',
            '(no `locations` entry needed — the alert renders its call-to-action by name)',
            'The banner renders with no call-to-action button: the id resolves to nothing and the renderer drops it without a word.',
          );
        }
      }

      // `page:header`'s action ids. The spec's contract is ids
      // (`z.array(z.string())`); an inline object element is a definition,
      // refused by the spec on its own, not a reference for this rule to
      // resolve — so only the string elements are checked, each at its
      // AUTHORED index. The header draws an authored action only when it is
      // placed at `record_header` or `record_more`.
      if (type === 'page:header' && Array.isArray(props.actions)) {
        const ids = props.actions as unknown[];
        for (let hi = 0; hi < ids.length; hi++) {
          const id = strName(ids[hi]);
          if (!id) continue;
          check(
            id,
            where,
            `${path}.properties.actions[${hi}]`,
            'Page-header actions',
            'with `record_header` or `record_more` in its `locations` (the header draws only actions placed at one of the two)',
            'The header draws no button for it: the id resolves to nothing and is dropped, with only a browser-console warning no author reads.',
          );
        }
      }

      // `record:related_list`'s action ids, resolved against the RELATED
      // object (see `checkRelatedListActions`). The related object is the
      // per-element `dataSource.object` when one is bound (objectui's
      // data-source gate writes it over `objectName`), else `objectName`.
      if (type === 'record:related_list' && Array.isArray(props.actions)) {
        const binding = component.dataSource;
        const child =
          (binding && typeof binding === 'object' && !Array.isArray(binding)
            ? strName((binding as AnyRec).object)
            : undefined) ?? strName(props.objectName);
        checkRelatedListActions(child, props.actions as unknown[], where, path);
      }
    }
  }

  // ── App navigation: { type: 'action', actionDef: { actionName } } ──
  const apps = recordsOf(stack.apps);
  for (let ai = 0; ai < apps.length; ai++) {
    const app = apps[ai];
    if (!app || typeof app !== 'object') continue;
    const appName = strName(app.name) ?? `#${ai}`;

    const walkNav = (items: unknown, basePath: string) => {
      const navItems = recordsOf(items);
      for (let ni = 0; ni < navItems.length; ni++) {
        const nav = navItems[ni];
        if (!nav || typeof nav !== 'object') continue;
        const navPath = `${basePath}[${ni}]`;
        const actionDef = nav.actionDef as AnyRec | undefined;
        const actionName = strName(actionDef?.actionName);
        if (nav.type === 'action' && actionName) {
          check(
            actionName,
            `app "${appName}" · nav "${strName(nav.id) ?? `#${ni}`}"`,
            `${navPath}.actionDef.actionName`,
            'Navigation action item',
          );
        }
        // `object` nav deep-link auto-run (#4848): `runAction` is the declared
        // form of the `?runAction=<name>` URL contract — an action name bound
        // by reference, dead in the same way as every other surface here when
        // it resolves to nothing (the entry navigates, the auto-run silently
        // never fires).
        const runAction = strName(nav.runAction);
        if (nav.type === 'object' && runAction) {
          check(
            runAction,
            `app "${appName}" · nav "${strName(nav.id) ?? `#${ni}`}"`,
            `${navPath}.runAction`,
            'Navigation deep-link auto-run',
          );
        }
        if (Array.isArray(nav.children)) walkNav(nav.children, `${navPath}.children`);
      }
    };

    walkNav(app.navigation, `apps[${ai}].navigation`);
    const areas = recordsOf(app.areas);
    for (let ri = 0; ri < areas.length; ri++) {
      walkNav(areas[ri]?.navigation, `apps[${ai}].areas[${ri}].navigation`);
    }
  }

  return findings;
}
