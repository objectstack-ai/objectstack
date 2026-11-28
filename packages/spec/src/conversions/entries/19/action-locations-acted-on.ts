// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The `action-locations-acted-on` conversion (`toMajor: 19`; objectstack#36495,
// maintainer rulings 7213534162 and 7213827153). A LEAF: it imports neither
// `registry.ts` nor another conversion's module. `registry.ts` imports
// `actionLocationsActedOn` and lists it in `MAJOR_19_CONVERSIONS`.

import type { ConversionApplication, ConversionContext, MetadataConversion } from '../../types.js';
import { mapCollection, mapPageComponents } from '../../walk.js';
import { ACTION_CONTAINER_BLOCK_TYPES, ACTION_RUNNER_BLOCK_TYPES, type Dict, isDict } from '../shared.js';

/**
 * Action locations name what an action acts on (protocol 19).
 *
 * Until 19 an action's `locations` named page parts: `list_toolbar`,
 * `list_item`, `record_header`, `record_more`, `record_related`,
 * `record_section`. Once the object's `actionLayout` took over which actions
 * are buttons and in what order, a location only has to say what the action
 * acts on: `list` (no record) and `record` (one record, on the record page and
 * on each list row), with the narrow words `record_page`, `record_row`,
 * `record_related` and `record_section` for an action that is on one of those
 * surfaces only.
 *
 * ## The rewrite of one action's `locations` (the ruling, word for word)
 *
 * - `list_toolbar` → `list`;
 * - `record_header` or `record_more` → `record_page`;
 * - `list_item` → `record_row`;
 * - both sides (a `list_item` beside `record_header` or `record_more`) →
 *   `record`;
 * - `record_related`, `record_section` and every word already canonical stay;
 * - a `record_more`-only action (`record_more` without `record_header`) keeps
 *   its fold into the record page's ⋯ menu through `component: 'action:menu'`.
 *
 * Order is kept: each word is rewritten where it stands, and a word the
 * rewrite makes twice (`record_header` beside `record_more`) is kept once, at
 * its first position.
 *
 * ## Lossless — every action is drawn where it is drawn today
 *
 * The record page header drew an action placed at `record_header` as a
 * button (within its budget) and one placed at `record_more` only in its ⋯
 * menu, as it drew any action with `component: 'action:menu'`. After the
 * rewrite both are `record_page`, and the fold is the component. On every
 * other surface the component is not read for an object's action (the list
 * row menu, a related list, a record section block), so writing it changes
 * nothing there. That a `component` the author wrote is replaced for a
 * `record_more`-only action is lossless for the same reason: the header put
 * such an action in the ⋯ menu whatever its component said.
 *
 * The one surface that does read an object action's `component` is the list
 * page toolbar, which folds `action:menu` into its own overflow. An action
 * placed at `record_more` only and at `list_toolbar` has no lossless rewrite:
 * the fold would reach the toolbar too. It is left as stored and reported as a
 * structured TODO (ADR-0087 D3); the hand rewrite chooses between the fold on
 * both surfaces and none. When the action already carries `component:
 * 'action:menu'` the toolbar folded it before, and the rewrite is lossless.
 *
 * The other reader of the component is the record page itself. Until 19 an
 * action at `record_header` with `component: 'action:menu'` had two states:
 * the header folded it into its ⋯ menu, and a `record:quick_actions` bar at
 * `record_header` drew it as a button. At `record_page` the fold is one state
 * for the whole record page, so that bar leaves it out. No rewrite keeps
 * both: it is left as stored and reported as a TODO.
 *
 * Every action left as stored keeps an old word, which a protocol-19 reader
 * matches to no surface: it is drawn nowhere until it is rewritten by hand.
 *
 * ## Page components
 *
 * The same rewrite runs on the `locations` of a page's action rows
 * (`action:button` / `action:icon` properties, and each member of an
 * `action:group` / `action:menu` / `action:bar`), which tell the runner a
 * record-scoped action from an object-level one. A row has no `component`, so
 * a `record_more`-only row is `record_page` and nothing more.
 *
 * A component's single `location` (the location a `record:quick_actions` bar,
 * an `action:group` or an `action:bar` draws) is rewritten by surface:
 * `list_toolbar` → `list`, `list_item` → `record_row`, `record_header` →
 * `record_page`. A bar at `record_page` draws the record page's actions that
 * are not folded into its ⋯ menu, which is the set it drew at `record_header`.
 * Two are TODOs, left as stored:
 * - `record_more`: the ⋯ menu's actions are no location of their own now, so
 *   a bar that drew only them has no word.
 * - an `action:group` at `record_header` with a `record_more`-only member: a
 *   group member has no `component` to keep its fold, so at `record_page` the
 *   group would draw that member too.
 *
 * ## Where it replays
 *
 * Retired from the load path, as the other protocol-19 entries are: an author
 * writing an old word meets the location enum's own prescription at parse.
 * Data at rest (`applyConversionsToStoredItem`), built artifacts and
 * `os migrate meta --from 18` replay it. Idempotent by construction: every
 * word it writes is canonical, and a canonical word is never rewritten.
 */

const RECORD_PAGE_WORDS = new Set(['record_header', 'record_more']);

/** A stored action's (or page row's) `locations`, rewritten; `undefined` when nothing changes. */
function rewriteLocations(locations: readonly unknown[]): unknown[] | undefined {
  const onPage = locations.some((l) => typeof l === 'string' && RECORD_PAGE_WORDS.has(l));
  const onRow = locations.includes('list_item');
  let changed = false;
  const out: unknown[] = [];
  for (const word of locations) {
    let next: unknown = word;
    if (word === 'list_toolbar') next = 'list';
    else if (typeof word === 'string' && RECORD_PAGE_WORDS.has(word)) next = onRow ? 'record' : 'record_page';
    else if (word === 'list_item') next = onPage ? 'record' : 'record_row';
    if (next !== word) changed = true;
    if (typeof next === 'string' && out.includes(next)) {
      changed = true;
      continue;
    }
    out.push(next);
  }
  return changed ? out : undefined;
}

/** `record_more` declared without `record_header`: the action was drawn only in the record page's ⋯ menu. */
function isMoreOnly(locations: readonly unknown[]): boolean {
  return locations.includes('record_more') && !locations.includes('record_header');
}

/**
 * One object action (top-level `actions[]` or `objects[].actions[]`). A
 * `record_more`-only action keeps its fold through `component`, unless it is
 * on the list toolbar too without that component already (a TODO, left as
 * stored). A `record_header` action with an authored `component:
 * 'action:menu'` is a TODO too, left as stored.
 */
function convertAction(
  action: Dict,
  path: string,
  emit: (detail: ConversionApplication) => void,
  context: ConversionContext | undefined,
): Dict {
  const locations = action.locations;
  if (!Array.isArray(locations)) return action;
  const next = rewriteLocations(locations);
  if (!next) return action;
  const moreOnly = isMoreOnly(locations);
  if (locations.includes('record_header') && action.component === 'action:menu') {
    context?.reportTodo?.({
      path: `${path}.locations`,
      from: JSON.stringify(locations),
      reason:
        'This action is placed at `record_header` with `component: \'action:menu\'`. Until 19 the record page '
        + 'header folded it into its ⋯ menu while a `record:quick_actions` bar at `record_header` drew it as a '
        + 'button. Protocol 19 has one state for both: at `record_page` an `action:menu` action is folded '
        + 'everywhere on the record page, so that bar would leave it out. Left as stored; rewrite it by hand to '
        + '`record_page` (`record` if it is on `list_item` too), with `component: \'action:menu\'` to keep the '
        + 'fold and lose the bar button, or without it to draw a button in the header and the bar.',
    });
    return action;
  }
  if (moreOnly && locations.includes('list_toolbar') && action.component !== 'action:menu') {
    context?.reportTodo?.({
      path: `${path}.locations`,
      from: JSON.stringify(locations),
      reason:
        'This action is in the record page\'s ⋯ menu only (`record_more` without `record_header`) and on the list '
        + 'page toolbar (`list_toolbar`). Protocol 19 keeps the ⋯ fold with `component: \'action:menu\'`, which '
        + 'the list toolbar reads too: it would fold the action into the toolbar\'s overflow as well. Left as '
        + 'stored; rewrite it by hand to `[\'list\', \'record_page\']`, with `component: \'action:menu\'` to keep '
        + 'the fold on both surfaces or without it to draw a button on both.',
    });
    return action;
  }
  emit({ from: JSON.stringify(locations), to: JSON.stringify(next), path: `${path}.locations` });
  let rewritten: Dict = { ...action, locations: next };
  if (moreOnly && action.component !== 'action:menu') {
    emit({
      from: action.component === undefined ? '(omitted)' : JSON.stringify(action.component),
      to: 'action:menu',
      path: `${path}.component`,
    });
    rewritten = { ...rewritten, component: 'action:menu' };
  }
  return rewritten;
}

/** A page action row's `locations` (a row has no `component`). */
function convertRow(row: Dict, path: string, emit: (detail: ConversionApplication) => void): Dict {
  const locations = row.locations;
  if (!Array.isArray(locations)) return row;
  const next = rewriteLocations(locations);
  if (!next) return row;
  emit({ from: JSON.stringify(locations), to: JSON.stringify(next), path: `${path}.locations` });
  return { ...row, locations: next };
}

const SINGLE_LOCATION: Readonly<Record<string, string>> = {
  list_toolbar: 'list',
  list_item: 'record_row',
  record_header: 'record_page',
};

/** The component types whose own `location` names the surface they draw. */
const LOCATION_COMPONENT_TYPES = new Set(['record:quick_actions', 'action:group', 'action:bar']);

/** The member lists of an action container whose rows carry `locations`. */
function memberListsOf(type: string): readonly string[] {
  if (ACTION_CONTAINER_BLOCK_TYPES.has(type)) return ['actions'];
  if (type === 'action:bar') return ['actions', 'systemActions'];
  return [];
}

function convertComponent(
  component: Dict,
  path: string,
  emit: (detail: ConversionApplication) => void,
  context: ConversionContext | undefined,
): Dict {
  const type = component.type;
  if (typeof type !== 'string') return component;
  const properties = component.properties;
  if (!isDict(properties)) return component;
  const memberLists = memberListsOf(type);
  const runner = ACTION_RUNNER_BLOCK_TYPES.has(type);
  const located = LOCATION_COMPONENT_TYPES.has(type);
  if (!runner && !located && memberLists.length === 0) return component;

  const location = properties.location;
  if (located && typeof location === 'string') {
    const todo = (reason: string) => {
      context?.reportTodo?.({ path: `${path}.properties.location`, from: JSON.stringify(location), reason });
      return component;
    };
    if (location === 'record_more') {
      return todo(
        `The \`${type}\` block draws the actions in the record page's ⋯ menu (\`location: 'record_more'\`). Protocol 19 `
        + 'keeps that fold with each action\'s `component: \'action:menu\'` and gives the ⋯ menu no location of its '
        + 'own, so no word draws only those actions. Left as stored; choose `record_page` (every record page '
        + 'action that is not folded into the ⋯ menu) or name the actions this block should draw.',
      );
    }
    if (location === 'record_header' && type === 'action:group') {
      const members = properties.actions;
      const foldedMember = Array.isArray(members)
        && members.some((m) => isDict(m) && Array.isArray(m.locations) && isMoreOnly(m.locations));
      if (foldedMember) {
        return todo(
          'This `action:group` draws its members placed at `record_header`, and one of its members is placed at '
          + '`record_more` only. Protocol 19 writes both `record_page`, and a group member has no `component` to keep '
          + 'the ⋯ fold, so at `record_page` the group would draw that member too. Left as stored; remove the '
          + 'member or accept it at `record_page`.',
        );
      }
    }
  }

  let next = properties;
  if (runner) next = convertRow(next, `${path}.properties`, emit);
  if (located && typeof location === 'string' && Object.prototype.hasOwnProperty.call(SINGLE_LOCATION, location)) {
    const to = SINGLE_LOCATION[location]!;
    emit({ from: location, to, path: `${path}.properties.location` });
    next = { ...next, location: to };
  }
  for (const key of memberLists) {
    const members = next[key];
    if (!Array.isArray(members)) continue;
    let changed = false;
    const nextMembers = members.map((member, i) => {
      if (!isDict(member)) return member;
      const mapped = convertRow(member, `${path}.properties.${key}[${i}]`, emit);
      if (mapped !== member) changed = true;
      return mapped;
    });
    if (changed) next = { ...next, [key]: nextMembers };
  }
  return next === properties ? component : { ...component, properties: next };
}

const actionLocationsActedOn: MetadataConversion = {
  id: 'action-locations-acted-on',
  toMajor: 19,
  retiredFromLoadPath: true,
  retiredAfter: '18.6.0',
  surface: 'action.locations / action.component / object.actions[].locations / object.actions[].component / '
    + 'page.component.action:button.locations / page.component.action:icon.locations / '
    + 'page.component.action:group.actions[].locations / page.component.action:menu.actions[].locations / '
    + 'page.component.action:bar.actions[].locations / page.component.action:bar.systemActions[].locations / '
    + 'page.component.record:quick_actions.location / page.component.action:group.location / '
    + 'page.component.action:bar.location',
  summary:
    "action locations say what an action acts on: 'list_toolbar' → 'list', 'record_header' / 'record_more' → "
    + "'record_page', 'list_item' → 'record_row', a 'list_item' beside either record word → 'record'; a "
    + "'record_more'-only action keeps its ⋯ fold with component 'action:menu', so every action is drawn where "
    + 'it was drawn before',
  apply(stack, emit, context) {
    const onAction = (action: Dict, path: string): Dict => convertAction(action, path, emit, context);
    let next = mapCollection(stack, 'actions', onAction);
    next = mapCollection(next, 'objects', (obj, path) =>
      mapCollection(obj, 'actions', (action, actionPath) => onAction(action, `${path}.${actionPath}`)),
    );
    return mapPageComponents(next, (component, path) => convertComponent(component, path, emit, context));
  },
  fixture: {
    before: {
      actions: [
        // A toolbar action, a row action, a header action, a ⋯-only action.
        { name: 'import_leads', label: 'Import', objectName: 'crm_lead', type: 'script', locations: ['list_toolbar'] },
        { name: 'quick_view', label: 'Quick view', objectName: 'crm_lead', type: 'script', locations: ['list_item'] },
        { name: 'convert_lead', label: 'Convert', objectName: 'crm_lead', type: 'script', locations: ['record_header'] },
        { name: 'clone_lead', label: 'Clone', objectName: 'crm_lead', type: 'script', locations: ['record_more'] },
        // Both sides, the header word twice over: one `record`.
        {
          name: 'assign_lead',
          label: 'Assign',
          objectName: 'crm_lead',
          type: 'script',
          locations: ['list_item', 'record_header', 'record_more'],
        },
        // ⋯-only on both sides, beside an exception word: `record` and the fold;
        // an authored component is replaced (the header folded it whatever it said).
        {
          name: 'archive_lead',
          label: 'Archive',
          objectName: 'crm_lead',
          type: 'script',
          component: 'action:icon',
          locations: ['record_more', 'record_section', 'list_item'],
        },
        // Already canonical, headless, and exception-only: untouched.
        { name: 'score_lead', label: 'Score', objectName: 'crm_lead', type: 'script', locations: ['record'] },
        { name: 'sync_leads', label: 'Sync', type: 'script', locations: [] },
        { name: 'log_call', label: 'Log call', objectName: 'crm_lead', type: 'script', locations: ['record_related'] },
        // ⋯-only and on the toolbar: no lossless rewrite, left as stored (a TODO).
        {
          name: 'export_one',
          label: 'Export',
          objectName: 'crm_lead',
          type: 'script',
          locations: ['list_toolbar', 'record_more'],
        },
        // ⋯-only and on the toolbar, already folded: the toolbar folded it too, so lossless.
        {
          name: 'export_all',
          label: 'Export all',
          objectName: 'crm_lead',
          type: 'script',
          component: 'action:menu',
          locations: ['list_toolbar', 'record_more'],
        },
        // A header word with an authored fold: a header ⋯ item and a quick-actions button
        // until 19, one state after it. No lossless rewrite, left as stored (a TODO).
        {
          name: 'print_lead',
          label: 'Print',
          objectName: 'crm_lead',
          type: 'script',
          component: 'action:menu',
          locations: ['record_header'],
        },
      ],
      objects: [{
        name: 'crm_account',
        label: 'Account',
        actions: [{ name: 'merge_account', label: 'Merge', type: 'script', locations: ['record_more', 'record_header'] }],
      }],
      pages: [{
        name: 'lead_detail',
        regions: [{
          name: 'main',
          components: [
            { type: 'record:quick_actions', properties: { location: 'record_header', actionNames: ['convert_lead'] } },
            { type: 'record:quick_actions', properties: { location: 'record_section', actionNames: ['assign_lead'] } },
            // The ⋯ menu's own bar has no word now: a TODO, left as stored.
            { type: 'record:quick_actions', properties: { location: 'record_more' } },
            { type: 'action:button', properties: { label: 'Run', actionType: 'script', locations: ['list_item', 'record_header'] } },
            {
              type: 'action:group',
              properties: {
                location: 'list_toolbar',
                actions: [{ name: 'refresh', label: 'Refresh', type: 'script', locations: ['list_toolbar'] }],
              },
            },
          ],
        }],
      }],
    },
    after: {
      actions: [
        { name: 'import_leads', label: 'Import', objectName: 'crm_lead', type: 'script', locations: ['list'] },
        { name: 'quick_view', label: 'Quick view', objectName: 'crm_lead', type: 'script', locations: ['record_row'] },
        { name: 'convert_lead', label: 'Convert', objectName: 'crm_lead', type: 'script', locations: ['record_page'] },
        {
          name: 'clone_lead',
          label: 'Clone',
          objectName: 'crm_lead',
          type: 'script',
          locations: ['record_page'],
          component: 'action:menu',
        },
        { name: 'assign_lead', label: 'Assign', objectName: 'crm_lead', type: 'script', locations: ['record'] },
        {
          name: 'archive_lead',
          label: 'Archive',
          objectName: 'crm_lead',
          type: 'script',
          component: 'action:menu',
          locations: ['record', 'record_section'],
        },
        { name: 'score_lead', label: 'Score', objectName: 'crm_lead', type: 'script', locations: ['record'] },
        { name: 'sync_leads', label: 'Sync', type: 'script', locations: [] },
        { name: 'log_call', label: 'Log call', objectName: 'crm_lead', type: 'script', locations: ['record_related'] },
        {
          name: 'export_one',
          label: 'Export',
          objectName: 'crm_lead',
          type: 'script',
          locations: ['list_toolbar', 'record_more'],
        },
        {
          name: 'export_all',
          label: 'Export all',
          objectName: 'crm_lead',
          type: 'script',
          component: 'action:menu',
          locations: ['list', 'record_page'],
        },
        {
          name: 'print_lead',
          label: 'Print',
          objectName: 'crm_lead',
          type: 'script',
          component: 'action:menu',
          locations: ['record_header'],
        },
      ],
      objects: [{
        name: 'crm_account',
        label: 'Account',
        actions: [{ name: 'merge_account', label: 'Merge', type: 'script', locations: ['record_page'] }],
      }],
      pages: [{
        name: 'lead_detail',
        regions: [{
          name: 'main',
          components: [
            { type: 'record:quick_actions', properties: { location: 'record_page', actionNames: ['convert_lead'] } },
            { type: 'record:quick_actions', properties: { location: 'record_section', actionNames: ['assign_lead'] } },
            { type: 'record:quick_actions', properties: { location: 'record_more' } },
            { type: 'action:button', properties: { label: 'Run', actionType: 'script', locations: ['record'] } },
            {
              type: 'action:group',
              properties: {
                location: 'list',
                actions: [{ name: 'refresh', label: 'Refresh', type: 'script', locations: ['list'] }],
              },
            },
          ],
        }],
      }],
    },
    // Actions: import, quick view, convert, clone (+ its component), assign,
    // archive (+ its component), export all (already folded), merge = 10.
    // Page: the header bar's location, the button's locations, the group's
    // location and its member = 4.
    expectedNotices: 14,
  },
};

export { actionLocationsActedOn };
