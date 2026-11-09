// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `form-view-presentation-types-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `formViewPresentationTypesRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, mapPageComponents, mapViewPayloads } from '../../walk.js';
import { ASSEMBLED_VIEW_ITEMS_KEY } from '../../../ui/assembled-views.zod.js';
import { type Dict, isDict, stripKeys } from '../shared.js';

/**
 * The form view `type` members `split`, `drawer` and `modal` leave the enum,
 * and the split-only keys `sections[].pane` (and the legacy `groups[].pane`),
 * `splitSize` and `splitResizable` leave the shape (protocol 18, #27155 —
 * ADR-0050 Accepted by ruling 6464210455 on #27032, letter A′: `type` is the
 * form's layout only; where a form opens is the caller's open mode).
 *
 * Authoring refuses each member by name (`enumWithRetiredValues` on
 * `FormViewSchema.type`, `ui/view.zod.ts`) and each key by its `retiredKey()`
 * tombstone. Deleting is the whole edit: a form whose `type` was retired lands
 * on the `simple` default, the conversion invents no layout. The keys go on
 * every form, whatever its `type`: each is refused on every form now, and a
 * `pane` on a non-split form was already a parse error. `modalSize` stays,
 * because the console's record dialog reads it on every layout. `drawerSide`
 * and `drawerWidth` stayed here and left the form view later in the same
 * release ([#29012] {@link formViewDrawerKeysRemoved}).
 *
 * **[#27159] The renderer half, absorbed here** (the skill's same-major rule:
 * 18.3.0 is unreleased — `@objectstack/spec` is 18.2.0 on `main` — and one
 * entry keeps the fixtures disjoint). Once `SplitForm` retired, `splitDirection`
 * lost its last reader and goes from every form payload too, and the
 * `object-form` PAGE BLOCK sheds its own copies: a `formType: 'split'` member
 * (deleted — the block lands on `simple`), `splitDirection`, `splitSize`,
 * `splitResizable` and every `sections[].pane`. The block's `drawer` / `modal`
 * members are NOT touched: the block renderer still supplies those containers
 * (`ObjectFormContainer` in objectui), so they stay authorable there.
 *
 * **Reach: every FORM payload**, exactly as
 * {@link formViewSubformColumnsCanonicalized} below: {@link mapViewPayloads}
 * (`form`, `formViews.*`, a form view item's `config`, a flattened form
 * overlay — the stored-row seam wraps a `view` row as `{ views: [row] }`) and
 * the assembled-manifest `viewItems` channel ({@link ASSEMBLED_VIEW_ITEMS_KEY}).
 * A list payload is never judged.
 *
 * The enum accepted all six members through 18.2.0 and `PUT /meta/view`
 * persists form views, so a stored `view` row CAN carry a retired member;
 * `applyConversionsToStoredItem` replays this entry over it. **Retired from
 * the load path from day one**, as {@link navigationModeOverlayValuesRemoved}
 * is: a live author meets the parse's prescription, and this entry serves
 * stored-row rehydration, assembled artifacts and `os migrate meta`.
 * Idempotent by construction: a converted form carries no retired member and
 * none of the three keys.
 *
 * The D3 entry `ui-form-view-type-layout-only` carries what the edit cannot
 * decide: whether a former `split` form reads better `tabbed`, and how the
 * caller of a former `drawer` / `modal` form opens it.
 *
 * **Page-block reach** ([#27159]): {@link mapPageComponents} — regions, slots
 * and container nesting — scoped to `type === 'object-form'`, as
 * {@link formLayoutInlineGridToVertical} is. The block accepted `split` and
 * the three keys through 18.2.0, so a stored page or an assembled artifact
 * can carry them. The `object-master-detail-form` block's parent `sections`
 * are the same section shape (`objectFormSection()`), so its `pane` parsed
 * through 18.2.0 and is refused now: the walk strips `sections[].pane` there
 * too, and touches nothing else on that block.
 */
const formViewPresentationTypesRemoved: MetadataConversion = {
  id: 'form-view-presentation-types-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.2.0',
  surface:
    "view.form.type / view.formViews.<key>.type ('split' | 'drawer' | 'modal') / "
    + 'view.form.sections[].pane / view.form.splitSize / view.form.splitResizable / '
    + "view.form.splitDirection / page.component.object-form.formType ('split') / "
    + 'page.component.object-form.sections[].pane / page.component.object-form.splitDirection / '
    + 'page.component.object-form.splitSize / page.component.object-form.splitResizable / '
    + 'page.component.object-master-detail-form.sections[].pane',
  summary:
    "form view `type` members 'split' / 'drawer' / 'modal' removed (`type` is the form's layout — "
    + "simple, tabbed or wizard; where a form opens is the caller's open mode, and a record beside its "
    + 'list is a reader\'s preference), with the split-only keys `sections[].pane`, `splitDirection`, '
    + '`splitSize` and `splitResizable`; the `object-form` page block sheds its `split` member and the same '
    + 'four keys (its `drawer` / `modal` containers stay), and the `object-master-detail-form` block its '
    + 'sections\' `pane`. The retired member is deleted, which lands the '
    + 'form on the `simple` default',
  apply(stack, emit) {
    const RETIRED_TYPES: ReadonlySet<unknown> = new Set(['split', 'drawer', 'modal']);
    const stripSectionPanes = (form: Dict, key: 'sections' | 'groups', path: string): Dict => {
      const sections = form[key];
      if (!Array.isArray(sections)) return form;
      let changed = false;
      const next = sections.map((section, i) => {
        if (!isDict(section)) return section;
        const stripped = stripKeys(section, ['pane'], emit, `${path}.${key}[${i}]`);
        if (stripped !== section) changed = true;
        return stripped;
      });
      return changed ? { ...form, [key]: next } : form;
    };
    const convertForm = (form: Dict, path: string): Dict => {
      let next = form;
      if (RETIRED_TYPES.has(next.type)) {
        emit({ from: String(next.type), to: '(removed)', path: `${path}.type` });
        next = { ...next };
        delete next.type;
      }
      next = stripKeys(next, ['splitDirection', 'splitSize', 'splitResizable'], emit, path);
      next = stripSectionPanes(next, 'sections', path);
      return stripSectionPanes(next, 'groups', path);
    };
    // [#27159] The `object-form` page block: only `split` left its `formType`.
    const convertBlock = (properties: Dict, path: string): Dict => {
      let next = properties;
      if (next.formType === 'split') {
        emit({ from: 'split', to: '(removed)', path: `${path}.formType` });
        next = { ...next };
        delete next.formType;
      }
      next = stripKeys(next, ['splitDirection', 'splitSize', 'splitResizable'], emit, path);
      return stripSectionPanes(next, 'sections', path);
    };
    const withPages = mapPageComponents(stack, (component, path) => {
      if (component.type !== 'object-form' && component.type !== 'object-master-detail-form') return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      // The master-detail block's parent `sections` share the `object-form`
      // section shape, `pane` included; it had no `split` member or split keys.
      const next = component.type === 'object-form'
        ? convertBlock(properties, `${path}.properties`)
        : stripSectionPanes(properties, 'sections', `${path}.properties`);
      return next === properties ? component : { ...component, properties: next };
    });
    const withViews = mapViewPayloads(withPages, (payload, kind, path) =>
      kind === 'form' ? convertForm(payload, path) : payload);
    return mapCollection(withViews, ASSEMBLED_VIEW_ITEMS_KEY, (item, path) => {
      if (item.viewKind !== 'form') return item;
      if (isDict(item.config)) {
        const config = convertForm(item.config, `${path}.config`);
        return config === item.config ? item : { ...item, config };
      }
      // A flattened form overlay — the body IS the payload. A present but
      // malformed `config` is neither shape and is left for the parse.
      return item.config === undefined ? convertForm(item, path) : item;
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'fv_task_desk',
          regions: [
            {
              name: 'main',
              components: [
                // [#27159] A split block: the member, the three keys and both panes go.
                {
                  type: 'object-form',
                  properties: {
                    objectName: 'fv_task',
                    formType: 'split',
                    splitDirection: 'horizontal',
                    splitSize: 40,
                    splitResizable: true,
                    sections: [
                      { label: 'Task', pane: 'primary', fields: ['title'] },
                      { label: 'Schedule', pane: 'secondary', fields: ['due_date'] },
                    ],
                  },
                },
                // A drawer block is a live container on the block: untouched.
                { type: 'object-form', properties: { objectName: 'fv_task', formType: 'drawer', drawerSide: 'right' } },
                // A master-detail block's parent sections share the shape: the pane goes.
                {
                  type: 'object-master-detail-form',
                  properties: { objectName: 'fv_task', sections: [{ label: 'Task', pane: 'primary', fields: ['title'] }] },
                },
                // The same keys on a component that is NOT an `object-form` survive.
                { type: 'element:custom', properties: { formType: 'split', splitSize: 40 } },
              ],
            },
          ],
        },
      ],
      views: [
        {
          object: 'fv_task',
          // A live layout rides through by reference.
          form: { type: 'tabbed', sections: [{ label: 'Main', fields: ['title'] }] },
          formViews: {
            // A split form: the member, both panes and the three split keys go.
            beside: {
              type: 'split',
              splitSize: 40,
              splitResizable: true,
              splitDirection: 'vertical',
              sections: [
                { label: 'Task', pane: 'primary', fields: ['title'] },
                { label: 'Schedule', pane: 'secondary', fields: ['due_date'] },
              ],
            },
            // A drawer form: the member goes, its other keys stay. ([#29012] Not
            // `drawerSide`, which `form-view-drawer-keys-removed` now strips.)
            quick: { type: 'drawer', title: 'Quick', sections: [{ label: 'Quick', fields: ['status'] }] },
            // A modal form whose sections ride the legacy `groups` alias.
            dialog: { type: 'modal', modalSize: 'lg', groups: [{ label: 'Edit', fields: ['title'] }] },
          },
        },
        // A form view item record: the payload is `config`.
        { name: 'fv_task.peek', object: 'fv_task', viewKind: 'form', config: { type: 'modal' } },
        // A list payload is never judged.
        { name: 'fv_task.all', object: 'fv_task', viewKind: 'list', config: { type: 'grid', columns: ['title'] } },
      ],
      viewItems: [
        // An assembled flattened form overlay — the body IS the payload.
        { name: 'fv_task.side', object: 'fv_task', viewKind: 'form', type: 'drawer' },
      ],
    },
    after: {
      pages: [
        {
          name: 'fv_task_desk',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'object-form',
                  properties: {
                    objectName: 'fv_task',
                    sections: [
                      { label: 'Task', fields: ['title'] },
                      { label: 'Schedule', fields: ['due_date'] },
                    ],
                  },
                },
                { type: 'object-form', properties: { objectName: 'fv_task', formType: 'drawer', drawerSide: 'right' } },
                {
                  type: 'object-master-detail-form',
                  properties: { objectName: 'fv_task', sections: [{ label: 'Task', fields: ['title'] }] },
                },
                { type: 'element:custom', properties: { formType: 'split', splitSize: 40 } },
              ],
            },
          ],
        },
      ],
      views: [
        {
          object: 'fv_task',
          form: { type: 'tabbed', sections: [{ label: 'Main', fields: ['title'] }] },
          formViews: {
            beside: {
              sections: [
                { label: 'Task', fields: ['title'] },
                { label: 'Schedule', fields: ['due_date'] },
              ],
            },
            quick: { title: 'Quick', sections: [{ label: 'Quick', fields: ['status'] }] },
            dialog: { modalSize: 'lg', groups: [{ label: 'Edit', fields: ['title'] }] },
          },
        },
        { name: 'fv_task.peek', object: 'fv_task', viewKind: 'form', config: {} },
        { name: 'fv_task.all', object: 'fv_task', viewKind: 'list', config: { type: 'grid', columns: ['title'] } },
      ],
      viewItems: [
        { name: 'fv_task.side', object: 'fv_task', viewKind: 'form' },
      ],
    },
    // The split block: the member, three keys and two panes (6). The
    // master-detail block: its one pane (1). `beside`: the member,
    // `splitDirection`, `splitSize`, `splitResizable` and two panes (6);
    // `quick`, `dialog`, the item record and the assembled overlay: one member
    // each (4). The drawer block, the non-form component, the tabbed form and
    // the list emit none.
    expectedNotices: 17,
  },
};

export { formViewPresentationTypesRemoved };
