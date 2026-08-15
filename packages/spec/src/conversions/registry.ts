// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata conversion table (ADR-0087 D2).
 *
 * Seeded with the **retroactive protocol-11 renames** — the calibration set the
 * ADR names: had this layer existed, protocol 11 would have needed *zero*
 * consumer action for these. Each entry is lossless, declared, loud, tested, and
 * expiring (see {@link MetadataConversion}).
 *
 * Entries are grouped by the major that introduced the canonical shape
 * (`toMajor`): a runtime on major N applies every conversion with
 * `toMajor === N` (it accepts the N−1 shape at load), and the N+1 loader retires
 * them — graduating them into the P2 migration chain rather than deleting them.
 * Until P2 exists these remain the permanent, replayable transform history.
 */

import type { ConversionApplication, MetadataConversion } from './types.js';
import {
  mapCollection,
  mapDatasources,
  mapFlowNodes,
  mapPageComponents,
  mapPages,
  renameConfigKey,
  renameKey,
} from './walk.js';
import { resolveDriverId, type BuiltinDriverId } from '../data/driver/config-registry.zod.js';
import { deepEqualAuthored } from '../shared/deep-equal.js';

/**
 * Flow callout node type rename (protocol 11.0).
 *
 * The divergent `http_request` / `http_call` / `webhook` node types were
 * unified to the single canonical `http` node (see
 * `services/service-automation/src/builtin/http-nodes.ts`). A pure enum
 * re-spelling — losslessly convertible.
 */
const flowNodeHttpRename: MetadataConversion = {
  id: 'flow-node-http-callout-rename',
  toMajor: 11,
  surface: 'flow.node.type',
  summary: "flow callout node types 'http_request' / 'http_call' / 'webhook' → 'http'",
  apply(stack, emit, context) {
    const aliases = new Set(['http_request', 'http_call', 'webhook']);
    return mapFlowNodes(stack, (node, path) => {
      const type = node.type;
      if (typeof type !== 'string' || !aliases.has(type)) return node;
      // `flow.node.type` is an OPEN namespace (ADR-0018 removed the enum gate),
      // so a retired official name could be re-registered by a third party. If a
      // live executor owns this token in this environment, refuse the rewrite —
      // clobbering it would silently break that node — and report a loud,
      // actionable conflict instead (ADR-0078). On the pure build/validate seam
      // `context` is absent, so the historical alias converts as normal.
      if (context?.reservedNodeTypes?.has(type)) {
        context.reportConflict?.({
          token: type,
          path: `${path}.type`,
          reason:
            `'${type}' is a protocol-11 retired official flow-node type, but a live ` +
            `executor is registered under that exact name in this environment. The ` +
            `conversion to 'http' was skipped to avoid breaking it. Rename your ` +
            `custom node to a non-reserved type (the reserved names are ` +
            `'http_request' / 'http_call' / 'webhook', all superseded by 'http').`,
        });
        return node;
      }
      emit({ from: type, to: 'http', path: `${path}.type` });
      return { ...node, type: 'http' };
    });
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'notify_flow',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'http_request', config: { url: 'https://example.com' } },
            { id: 'n3', type: 'webhook', config: { url: 'https://hooks.example.com' } },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'notify_flow',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'http', config: { url: 'https://example.com' } },
            { id: 'n3', type: 'http', config: { url: 'https://hooks.example.com' } },
          ],
        },
      ],
    },
    expectedNotices: 2,
  },
};

/**
 * Page `kind: 'jsx'` → `kind: 'html'` (protocol 11.4).
 *
 * `'jsx'` is a documented deprecated alias of the canonical `'html'` page kind
 * (ADR-0080; see `spec/src/ui/page.zod.ts`). The `source` semantics are
 * identical, so the rename is lossless.
 */
const pageKindJsxToHtml: MetadataConversion = {
  id: 'page-kind-jsx-to-html',
  toMajor: 11,
  surface: 'page.kind',
  summary: "page kind 'jsx' → 'html' (ADR-0080 canonical spelling)",
  apply(stack, emit) {
    return mapPages(stack, (page, path) => {
      if (page.kind !== 'jsx') return page;
      emit({ from: 'jsx', to: 'html', path: `${path}.kind` });
      return { ...page, kind: 'html' };
    });
  },
  fixture: {
    before: {
      pages: [{ name: 'landing', kind: 'jsx', source: '<div>hi</div>' }],
    },
    after: {
      pages: [{ name: 'landing', kind: 'html', source: '<div>hi</div>' }],
    },
    expectedNotices: 1,
  },
};

/**
 * CRUD flow-node `config.filters` → `config.filter` (protocol 11.0).
 *
 * This entry demonstrates ADR-0087's **PD #12 retirement path** (issue #2645):
 * the `get_record` / `update_record` / `delete_record` executors historically
 * tolerated the `filters` alias via a consumer-side
 * `readAliasedConfig(cfg, …, 'filter', ['filters'], …)` fallback. That scattered
 * dialect tolerance is promoted here into one declared, expiring conversion and
 * the executor fallback is deleted: the load path now hands the executor the
 * canonical `filter` key, so the executor reads `cfg.filter` directly.
 */
const flowNodeFilterAlias: MetadataConversion = {
  id: 'flow-node-crud-filter-alias',
  toMajor: 11,
  surface: 'flow.node.config.filter',
  summary: "CRUD flow-node config key 'filters' → 'filter'",
  apply(stack, emit) {
    const crudTypes = new Set(['get_record', 'update_record', 'delete_record']);
    return mapFlowNodes(stack, (node, path) => {
      if (typeof node.type !== 'string' || !crudTypes.has(node.type)) return node;
      const renamed = renameConfigKey(node, 'filters', 'filter');
      if (!renamed) return node;
      emit({ from: 'filters', to: 'filter', path: `${path}.config.filter` });
      return renamed;
    });
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'purge_flow',
          nodes: [
            { id: 'n1', type: 'start' },
            {
              id: 'n2',
              type: 'delete_record',
              config: { objectName: 'lead', filters: { status: 'stale' } },
            },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'purge_flow',
          nodes: [
            { id: 'n1', type: 'start' },
            {
              id: 'n2',
              type: 'delete_record',
              config: { objectName: 'lead', filter: { status: 'stale' } },
            },
          ],
        },
      ],
    },
    expectedNotices: 1,
  },
};

/**
 * Object `compactLayout` → `highlightFields` (spec 11.7.0, ADR-0085; alias
 * retired at authoring in 11.9.1, #2536).
 *
 * A pure key rename — the value (ordered field-name list) is unchanged.
 * **Retired from the load path**: the schema tombstones `compactLayout` with a
 * fix-it error, so the loader must NOT quietly accept it; the entry exists so
 * `migrate meta --from 10|11` rewrites old *sources* (backfilled per the
 * ADR-0087 true-up — the rename shipped before the conversion layer existed).
 */
const objectCompactLayoutRename: MetadataConversion = {
  id: 'object-compactLayout-to-highlightFields',
  toMajor: 11,
  retiredFromLoadPath: true,
  surface: 'object.compactLayout',
  summary: "object key 'compactLayout' → 'highlightFields' (ADR-0085 semantic roles)",
  apply(stack, emit) {
    return mapCollection(stack, 'objects', (obj, path) => {
      const renamed = renameKey(obj, 'compactLayout', 'highlightFields');
      if (!renamed) return obj;
      emit({ from: 'compactLayout', to: 'highlightFields', path: `${path}.highlightFields` });
      return renamed;
    });
  },
  fixture: {
    before: {
      objects: [{ name: 'crm_lead', label: 'Lead', compactLayout: ['name', 'status'] }],
    },
    after: {
      objects: [{ name: 'crm_lead', label: 'Lead', highlightFields: ['name', 'status'] }],
    },
    expectedNotices: 1,
  },
};

/**
 * Stack collection `roles:` → `positions:` (protocol 13, ADR-0090 D3).
 *
 * The distribution concept was renamed Role → Position across the platform;
 * the stack-definition collection key renamed with it. A pure key move — the
 * item shapes migrate separately (`position.parent` removal is semantic, see
 * the step-13 TODOs). **Retired from the load path**: ADR-0090 shipped this as
 * a pre-launch one-step rename with no alias window; the entry preserves it as
 * replayable chain history.
 */
const stackRolesToPositions: MetadataConversion = {
  id: 'stack-roles-to-positions',
  toMajor: 13,
  retiredFromLoadPath: true,
  surface: 'stack.roles',
  summary: "stack collection key 'roles' → 'positions' (ADR-0090 D3)",
  apply(stack, emit) {
    const renamed = renameKey(stack, 'roles', 'positions');
    if (!renamed) return stack;
    emit({ from: 'roles', to: 'positions', path: 'positions' });
    return renamed;
  },
  fixture: {
    before: {
      roles: [{ name: 'sales_rep', label: 'Sales Rep' }],
    },
    after: {
      positions: [{ name: 'sales_rep', label: 'Sales Rep' }],
    },
    expectedNotices: 1,
  },
};

/**
 * OWD legacy aliases `read` / `read_write` → canonical (protocol 13,
 * ADR-0090 D4).
 *
 * The two aliases with an unambiguous canonical spelling convert mechanically;
 * the third legacy alias `'full'` has NO lossless target (full access includes
 * transfer/delete — wider than `public_read_write`) and is delegated to the
 * step-13 semantic TODO instead (D2 scope guard: lossless only). Handles both
 * `object.sharingModel` and the nested `object.security.sharingModel` spot.
 * **Retired from the load path** (one-step removal; authoring rejects with a
 * fix-it).
 */
const owdLegacyReadAliases: MetadataConversion = {
  id: 'owd-legacy-read-aliases',
  toMajor: 13,
  retiredFromLoadPath: true,
  surface: 'object.sharingModel',
  summary: "object sharingModel 'read' → 'public_read', 'read_write' → 'public_read_write' (ADR-0090 D4)",
  apply(stack, emit) {
    const CANONICAL: Record<string, string> = {
      read: 'public_read',
      read_write: 'public_read_write',
    };
    return mapCollection(stack, 'objects', (obj, path) => {
      let next = obj;
      const direct = next.sharingModel;
      if (typeof direct === 'string' && CANONICAL[direct]) {
        emit({ from: direct, to: CANONICAL[direct]!, path: `${path}.sharingModel` });
        next = { ...next, sharingModel: CANONICAL[direct] };
      }
      const security = next.security;
      if (security && typeof security === 'object' && !Array.isArray(security)) {
        const nested = (security as Record<string, unknown>).sharingModel;
        if (typeof nested === 'string' && CANONICAL[nested]) {
          emit({ from: nested, to: CANONICAL[nested]!, path: `${path}.security.sharingModel` });
          next = { ...next, security: { ...(security as Record<string, unknown>), sharingModel: CANONICAL[nested] } };
        }
      }
      return next;
    });
  },
  fixture: {
    before: {
      objects: [
        { name: 'crm_deal', label: 'Deal', sharingModel: 'read' },
        { name: 'crm_note', label: 'Note', security: { sharingModel: 'read_write' } },
      ],
    },
    after: {
      objects: [
        { name: 'crm_deal', label: 'Deal', sharingModel: 'public_read' },
        { name: 'crm_note', label: 'Note', security: { sharingModel: 'public_read_write' } },
      ],
    },
    expectedNotices: 2,
  },
};

/**
 * Sharing-rule recipient type `'role'` → `'position'` (protocol 13,
 * ADR-0090 D3).
 *
 * Applies to both `sharedWith.type` and the owner-rule `ownedBy.type`. The
 * removed `'role_and_subordinates'` recipient is NOT converted — its v2
 * replacement (`unit_and_subordinates`) expands a *different* tree (business
 * units, not the retired role hierarchy), so it is a step-13 semantic TODO.
 * **Retired from the load path** (one-step rename, no alias window).
 */
const sharingRecipientRoleToPosition: MetadataConversion = {
  id: 'sharing-recipient-role-to-position',
  toMajor: 13,
  retiredFromLoadPath: true,
  surface: 'sharingRule.sharedWith.type',
  summary: "sharing-rule recipient type 'role' → 'position' (ADR-0090 D3)",
  apply(stack, emit) {
    const renameRecipient = (rule: Record<string, unknown>, key: string, path: string) => {
      const recipient = rule[key];
      if (!recipient || typeof recipient !== 'object' || Array.isArray(recipient)) return rule;
      const dict = recipient as Record<string, unknown>;
      if (dict.type !== 'role') return rule;
      emit({ from: 'role', to: 'position', path: `${path}.${key}.type` });
      return { ...rule, [key]: { ...dict, type: 'position' } };
    };
    return mapCollection(stack, 'sharingRules', (rule, path) => {
      let next = renameRecipient(rule, 'sharedWith', path);
      next = renameRecipient(next, 'ownedBy', path);
      return next;
    });
  },
  fixture: {
    before: {
      sharingRules: [
        {
          name: 'share_sales',
          type: 'owner',
          object: 'crm_deal',
          sharedWith: { type: 'role', value: 'sales_mgr' },
          ownedBy: { type: 'role', value: 'sales_rep' },
        },
      ],
    },
    after: {
      sharingRules: [
        {
          name: 'share_sales',
          type: 'owner',
          object: 'crm_deal',
          sharedWith: { type: 'position', value: 'sales_mgr' },
          ownedBy: { type: 'position', value: 'sales_rep' },
        },
      ],
    },
    expectedNotices: 2,
  },
};

/**
 * Book audience gated arm `{ profile }` → `{ permissionSet }` (protocol 14,
 * ADR-0090 D2 fallout; shipped in 14.0.0 as a pre-launch one-step rename).
 *
 * Packages own permission sets but never positions (ADR-0090 D9), so the
 * gate is a capability reference. Value carried over 1:1. **Retired from the
 * load path** — the zod union rejects `{ profile }` at parse; this entry is
 * the replayable chain history the one-step ship skipped.
 */
const bookAudienceProfileToPermissionSet: MetadataConversion = {
  id: 'book-audience-profile-to-permission-set',
  toMajor: 14,
  retiredFromLoadPath: true,
  surface: 'book.audience',
  summary: "book audience gated arm '{ profile }' → '{ permissionSet }' (ADR-0090 D2/D9)",
  apply(stack, emit) {
    return mapCollection(stack, 'books', (book, path) => {
      const audience = book.audience;
      if (!audience || typeof audience !== 'object' || Array.isArray(audience)) return book;
      const dict = audience as Record<string, unknown>;
      if (typeof dict.profile !== 'string' || dict.permissionSet != null) return book;
      emit({ from: 'profile', to: 'permissionSet', path: `${path}.audience.permissionSet` });
      const { profile, ...rest } = dict;
      return { ...book, audience: { ...rest, permissionSet: profile } };
    });
  },
  fixture: {
    before: {
      books: [{ name: 'crm_admin_guide', audience: { profile: 'crm_admin' } }],
    },
    after: {
      books: [{ name: 'crm_admin_guide', audience: { permissionSet: 'crm_admin' } }],
    },
    expectedNotices: 1,
  },
};

/** Rename a visibility alias key on a dict, emitting with the given path. */
function renameVisibilityAlias(
  dict: Record<string, unknown>,
  alias: string,
  path: string,
  emit: (detail: { from: string; to: string; path: string }) => void,
): Record<string, unknown> {
  const renamed = renameKey(dict, alias, 'visibleWhen');
  if (!renamed) return dict;
  emit({ from: alias, to: 'visibleWhen', path: `${path}.visibleWhen` });
  return renamed;
}

/**
 * View form `visibleOn` → `visibleWhen` (protocol 15, ADR-0089 D2).
 *
 * The conditional-visibility predicate is unified under the canonical
 * `visibleWhen` across all layers. Applies to form sections and (recursively
 * nested) form fields in every `views[].form` / `views[].formViews.*`
 * container. **Live window**: the protocol-15 loader accepts the deprecated
 * key (the zod schemas also normalize it at parse — this entry makes the
 * acceptance *declared, loud, and expiring* per ADR-0087 D2, and will
 * graduate into the step-16 chain when the alias is removed).
 */
const viewVisibleOnToVisibleWhen: MetadataConversion = {
  id: 'view-visibleOn-to-visibleWhen',
  toMajor: 15,
  surface: 'view.form.visibleOn',
  summary: "view form section/field key 'visibleOn' → 'visibleWhen' (ADR-0089)",
  apply(stack, emit) {
    const mapFields = (fields: unknown, path: string): unknown => {
      if (!Array.isArray(fields)) return fields;
      let changed = false;
      const next = fields.map((field, i) => {
        if (!field || typeof field !== 'object' || Array.isArray(field)) return field;
        let dict = field as Record<string, unknown>;
        dict = renameVisibilityAlias(dict, 'visibleOn', `${path}[${i}]`, emit);
        const nested = mapFields(dict.fields, `${path}[${i}].fields`);
        if (nested !== dict.fields) dict = { ...dict, fields: nested };
        if (dict !== field) changed = true;
        return dict;
      });
      return changed ? next : fields;
    };

    const mapSections = (sections: unknown, path: string): unknown => {
      if (!Array.isArray(sections)) return sections;
      let changed = false;
      const next = sections.map((section, i) => {
        if (!section || typeof section !== 'object' || Array.isArray(section)) return section;
        let dict = section as Record<string, unknown>;
        dict = renameVisibilityAlias(dict, 'visibleOn', `${path}[${i}]`, emit);
        const fields = mapFields(dict.fields, `${path}[${i}].fields`);
        if (fields !== dict.fields) dict = { ...dict, fields };
        if (dict !== section) changed = true;
        return dict;
      });
      return changed ? next : sections;
    };

    const mapForm = (form: unknown, path: string): unknown => {
      if (!form || typeof form !== 'object' || Array.isArray(form)) return form;
      let dict = form as Record<string, unknown>;
      for (const key of ['sections', 'groups'] as const) {
        const mapped = mapSections(dict[key], `${path}.${key}`);
        if (mapped !== dict[key]) dict = { ...dict, [key]: mapped };
      }
      const fields = mapFields(dict.fields, `${path}.fields`);
      if (fields !== dict.fields) dict = { ...dict, fields };
      return dict;
    };

    return mapCollection(stack, 'views', (view, path) => {
      let next = view;
      const form = mapForm(next.form, `${path}.form`);
      if (form !== next.form) next = { ...next, form };
      const formViews = next.formViews;
      if (formViews && typeof formViews === 'object' && !Array.isArray(formViews)) {
        let fvChanged = false;
        const nextViews: Record<string, unknown> = {};
        for (const [name, fv] of Object.entries(formViews as Record<string, unknown>)) {
          const mapped = mapForm(fv, `${path}.formViews.${name}`);
          if (mapped !== fv) fvChanged = true;
          nextViews[name] = mapped;
        }
        if (fvChanged) next = { ...next, formViews: nextViews };
      }
      return next;
    });
  },
  fixture: {
    before: {
      views: [
        {
          object: 'crm_lead',
          form: {
            sections: [
              {
                label: 'Details',
                visibleOn: "record.status == 'open'",
                fields: ['name', { field: 'priority', visibleOn: "record.priority != ''" }],
              },
            ],
          },
        },
      ],
    },
    after: {
      views: [
        {
          object: 'crm_lead',
          form: {
            sections: [
              {
                label: 'Details',
                visibleWhen: "record.status == 'open'",
                fields: ['name', { field: 'priority', visibleWhen: "record.priority != ''" }],
              },
            ],
          },
        },
      ],
    },
    expectedNotices: 2,
  },
};

/**
 * Page component `visibility` → `visibleWhen` (protocol 15, ADR-0089 D2).
 *
 * The page-component spelling of the same predicate. Applies to every page
 * component {@link mapPageComponents} reaches — `regions[].components[]`,
 * `slots.<slot>`, and the containers a component nests under its `properties`
 * (#6776, #6775). **Live window**, same terms as
 * {@link viewVisibleOnToVisibleWhen}. (An AI agent's `visibility` property is
 * a different, unrelated surface and is not touched.)
 */
const pageComponentVisibilityToVisibleWhen: MetadataConversion = {
  id: 'page-component-visibility-to-visibleWhen',
  toMajor: 15,
  surface: 'page.component.visibility',
  summary: "page component key 'visibility' → 'visibleWhen' (ADR-0089)",
  apply(stack, emit) {
    // The region→component descent this used to open-code is the shared
    // `mapPageComponents` walker (#5509, adopted per #5511): identical
    // copy-on-write contract, identical `pages[i].regions[j].components[k]`
    // paths, and one fewer hand-rolled traversal to keep in step with
    // `PageComponentSchema`'s reach.
    return mapPageComponents(stack, (component, path) =>
      renameVisibilityAlias(component, 'visibility', path, emit));
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'crm_home',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'record:list', visibility: "page.selectedId != ''" },
                { type: 'element:divider' },
                // Nested one container down (#6775): the predicate means the
                // same thing inside a card as it does at region level, so the
                // walk reaches it there too.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Selected',
                    children: [{ type: 'record:detail', visibility: "page.selectedId != ''" }],
                  },
                },
              ],
            },
          ],
        },
        // …and in a named slot on a slotted record page (#6776).
        {
          name: 'crm_lead_record',
          kind: 'slotted',
          regions: [],
          slots: {
            highlights: { type: 'record:detail', visibility: "record.stage == 'won'" },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'crm_home',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'record:list', visibleWhen: "page.selectedId != ''" },
                { type: 'element:divider' },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Selected',
                    children: [{ type: 'record:detail', visibleWhen: "page.selectedId != ''" }],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'crm_lead_record',
          kind: 'slotted',
          regions: [],
          slots: {
            highlights: { type: 'record:detail', visibleWhen: "record.stage == 'won'" },
          },
        },
      ],
    },
    expectedNotices: 3,
  },
};

/* ── Protocol 17: the three fold-and-drop aliases retire (#3855) ───────────────
 *
 * `execute`, `conditionalRequired` and `topics` were each folded into their
 * canonical key by a schema transform and dropped from the parsed output. They
 * are now removed from the spec outright, and each schema TOMBSTONES its key
 * with a fix-it error (`retiredKey`, `shared/retired-key.ts`) so the loader
 * cannot quietly accept it — the same shape as
 * `object-compactLayout-to-highlightFields` above.
 *
 * All three are therefore `retiredFromLoadPath: true` from the day they land:
 * there is no alias window, deliberately. What the entries buy is the two
 * things a consumer actually needs, neither of which is an error message:
 *
 *   - they appear in `CONVERSIONS_BY_MAJOR[17]`, so `spec-changes.json` (D4)
 *     carries them — and the generated upgrade guide and the `spec_changes` MCP
 *     tool are projections of that record, composed across however many majors
 *     the consumer is jumping;
 *   - the step-17 chain entry references them by id, so
 *     `os migrate meta --from 16` REWRITES the consumer's source mechanically
 *     instead of asking them to hand-edit.
 *
 * The tombstone error is the backstop for someone who did neither, and it says
 * so by pointing at `migrate meta`.
 */

// `Dict` / `isDict` are module-private in `walk.ts`. Re-declared locally rather
// than widening that module's exports, which would grow the package API surface
// for an internal one-line type guard.
type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);
type Emit = (detail: ConversionApplication) => void;

/** Rename a key on every field of every object (and object extension). Fields
 *  are a RECORD keyed by field name, so `mapCollection` does not reach them. */
function mapObjectFieldsKey(stack: Dict, collection: string, from: string, to: string, emit: Emit): Dict {
  return mapCollection(stack, collection, (owner, path) => {
    const fields = owner.fields;
    if (!isDict(fields)) return owner;
    let changed = false;
    const next: Dict = {};
    for (const [name, def] of Object.entries(fields)) {
      if (!isDict(def)) {
        next[name] = def;
        continue;
      }
      const renamed = renameKey(def, from, to);
      if (renamed) {
        emit({ from, to, path: `${path}.fields.${name}.${to}` });
        next[name] = renamed;
        changed = true;
      } else {
        next[name] = def;
      }
    }
    return changed ? { ...owner, fields: next } : owner;
  });
}

/**
 * Action `execute` → `target` (protocol 17, #3713 / #3742 / #3855).
 *
 * A pure key rename — the value (a handler/flow/URL ref) is unchanged. Actions
 * appear both top-level and nested under their object, so both are walked.
 */
const actionExecuteToTarget: MetadataConversion = {
  id: 'action-execute-to-target',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'action.execute',
  summary: "action key 'execute' → 'target' (the deprecated handler alias, #3713)",
  apply(stack, emit) {
    const renameOn = (action: Dict, path: string): Dict => {
      const renamed = renameKey(action, 'execute', 'target');
      if (!renamed) return action;
      emit({ from: 'execute', to: 'target', path: `${path}.target` });
      return renamed;
    };
    const withTopLevel = mapCollection(stack, 'actions', renameOn);
    return mapCollection(withTopLevel, 'objects', (obj, path) => {
      const nested = mapCollection(obj, 'actions', (action, actionPath) =>
        renameOn(action, `${path}.${actionPath}`),
      );
      return nested;
    });
  },
  fixture: {
    before: {
      actions: [{ name: 'convert', label: 'Convert', type: 'script', execute: 'convertHandler' }],
    },
    after: {
      actions: [{ name: 'convert', label: 'Convert', type: 'script', target: 'convertHandler' }],
    },
    expectedNotices: 1,
  },
};

/**
 * Field `conditionalRequired` → `requiredWhen` (protocol 17, #3754 / #3855).
 *
 * A pure key rename — the value (a CEL predicate, bare or enveloped) is
 * unchanged. Covers object fields and object-extension fields: the same
 * `FieldSchema`, so the same alias.
 */
const fieldConditionalRequiredToRequiredWhen: MetadataConversion = {
  id: 'field-conditionalRequired-to-requiredWhen',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'field.conditionalRequired',
  summary: "field key 'conditionalRequired' → 'requiredWhen' (the deprecated predicate alias, #3754)",
  apply(stack, emit) {
    const withObjects = mapObjectFieldsKey(stack, 'objects', 'conditionalRequired', 'requiredWhen', emit);
    return mapObjectFieldsKey(withObjects, 'objectExtensions', 'conditionalRequired', 'requiredWhen', emit);
  },
  fixture: {
    before: {
      objects: [{
        name: 'crm_task',
        label: 'Task',
        fields: { due_date: { type: 'date', conditionalRequired: 'record.stage == "closed"' } },
      }],
    },
    after: {
      objects: [{
        name: 'crm_task',
        label: 'Task',
        fields: { due_date: { type: 'date', requiredWhen: 'record.stage == "closed"' } },
      }],
    },
    expectedNotices: 1,
  },
};

/*
 * ABSORBED — `agent-knowledge-topics-to-sources` (protocol 17, #3855). The
 * rename lived inside the same unreleased major that now REMOVES the whole
 * `agent.knowledge` block (`agent-knowledge-removed` below): composed, its
 * effect is unobservable — any pre-17 `knowledge` ends deleted regardless of
 * its inner spelling — and two notices for one dead block would only confuse
 * the author. Folded pre-release per the ADR-0090 discipline; the removal's
 * prescription covers the historical `topics` spelling.
 */

/**
 * Agent `tools` → dropped (protocol 17, #3894 / #3820).
 *
 * NOT a rename — there is no key to move the value to. ADR-0064 says an
 * agent's tool set is exactly the union of its surface-compatible skills'
 * tools, and `agent.tools[]` was the seam that broke it (it resolved names
 * against the FULL registry with no surface check). Each entry has to become
 * a reference inside a SKILL, which needs a human decision about which skill
 * — so this conversion drops the dead key and emits one notice per agent
 * naming what was lost, rather than guessing a destination.
 *
 * Dropping is safe: the cloud runtime stopped reading the field entirely
 * (cloud#910), so by protocol 17 it contributes nothing at load time. What
 * the notice preserves is the AUTHOR's knowledge of which tools they meant.
 */
const agentToolsToSkills: MetadataConversion = {
  id: 'agent-tools-to-skills',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'agent.tools',
  summary: "agent key 'tools' removed — declare capability in a skill (ADR-0064, #3894)",
  apply(stack, emit) {
    return mapCollection(stack, 'agents', (agent, path) => {
      if (!('tools' in agent) || agent.tools == null) return agent;
      const next: Dict = { ...agent };
      delete next.tools;
      // The notice carries `tools → skills` at the agent's path: the author
      // sees WHICH agent lost inline references and where the capability has
      // to be re-declared. The tool names themselves stay in their git
      // history, which is where a judgement call should be read from.
      emit({ from: 'tools', to: 'skills', path: `${path}.skills` });
      return next;
    });
  },
  fixture: {
    before: {
      agents: [
        {
          name: 'support_bot',
          skills: ['case_management'],
          tools: [{ type: 'action', name: 'create_ticket' }],
        },
      ],
    },
    after: {
      agents: [{ name: 'support_bot', skills: ['case_management'] }],
    },
    expectedNotices: 1,
  },
};

/**
 * Sharing-rule `accessLevel: 'full'` → `'edit'` (protocol 17, #3865).
 *
 * `full` was documented as "Full Access (Transfer, Share, Delete)" but no code
 * path ever granted transfer, re-share, or delete because of it: both
 * enforcement sites matched `access_level in ('edit','full')`, so it behaved as
 * `edit` while telling admins it granted more (ADR-0078 declared-but-unenforced;
 * ADR-0049). It was removed from `SharingLevel`, which makes this rewrite
 * strictly **lossless** — unlike the OWD `sharingModel: 'full'` alias, which had
 * no equivalent target and was delegated to a step-13 semantic TODO. Here the
 * old and new shapes are already behaviourally identical, so the loader can
 * convert with zero consumer action.
 *
 * **Live window** — deliberately unlike its three step-17 siblings, which are
 * `retiredFromLoadPath` because each was an already-deprecated key whose schema
 * now tombstones it with a fix-it error. `full` carried no prior deprecation and
 * a removed enum VALUE yields only a generic zod message, so it gets the
 * ADR-0087 D2 default instead: the protocol-17 loader accepts it for one major
 * (this entry runs at `normalizeStackInput`, *before* the enum rejects it) and
 * retires at 18. Accepting it is zero-risk precisely because the rewrite is
 * behaviour-preserving. The runtime counterpart for already-persisted rows lives
 * in `plugin-sharing` (grant-time normalisation + a boot backfill over
 * `sys_sharing_rule` / `sys_record_share`).
 */
const sharingRuleAccessLevelFullToEdit: MetadataConversion = {
  id: 'sharing-rule-access-level-full-to-edit',
  toMajor: 17,
  surface: 'sharingRule.accessLevel',
  summary: "sharing-rule accessLevel 'full' → 'edit' (#3865 — `full` never granted more than `edit`)",
  apply(stack, emit) {
    return mapCollection(stack, 'sharingRules', (rule, path) => {
      if (rule.accessLevel !== 'full') return rule;
      emit({ from: 'full', to: 'edit', path: `${path}.accessLevel` });
      return { ...rule, accessLevel: 'edit' };
    });
  },
  fixture: {
    before: {
      sharingRules: [
        {
          name: 'share_open_deals',
          type: 'criteria',
          object: 'crm_deal',
          accessLevel: 'full',
          condition: 'record.status == "open"',
          sharedWith: { type: 'business_unit', value: 'bu_sales' },
        },
      ],
    },
    after: {
      sharingRules: [
        {
          name: 'share_open_deals',
          type: 'criteria',
          object: 'crm_deal',
          accessLevel: 'edit',
          condition: 'record.status == "open"',
          sharedWith: { type: 'business_unit', value: 'bu_sales' },
        },
      ],
    },
    expectedNotices: 1,
  },
};

/** Rename each `[from, to]` config pair on flow nodes of the given types. */
function renameFlowConfigAliases(
  stack: Dict,
  nodeTypes: ReadonlySet<string>,
  pairs: ReadonlyArray<readonly [string, string]>,
  emit: Emit,
): Dict {
  return mapFlowNodes(stack, (node, path) => {
    if (typeof node.type !== 'string' || !nodeTypes.has(node.type)) return node;
    let next = node;
    for (const [from, to] of pairs) {
      const renamed = renameConfigKey(next, from, to);
      if (!renamed) continue;
      emit({ from, to, path: `${path}.config.${to}` });
      next = renamed;
    }
    return next;
  });
}

/**
 * CRUD flow-node `config.object` → `config.objectName` (protocol 17, #3796).
 *
 * The last tenant of the `readAliasedConfig` executor shim
 * (`service-automation/src/builtin/config-aliases.ts`) graduates into the
 * conversion layer, completing the PD #12 retirement path that
 * {@link flowNodeFilterAlias} pioneered: the alias is rewritten to the
 * canonical key at load — including the `AutomationEngine.registerFlow`
 * rehydration seam — so the CRUD executors read `cfg.objectName` directly and
 * the shim is deleted. **Live window**: stored flows authored with `object`
 * keep loading through this major; retires at 18.
 */
const flowNodeCrudObjectAlias: MetadataConversion = {
  id: 'flow-node-crud-object-alias',
  toMajor: 17,
  surface: 'flow.node.config.objectName',
  summary: "CRUD flow-node config key 'object' → 'objectName' (#3796 — `readAliasedConfig` shim graduation)",
  apply(stack, emit) {
    const crudTypes = new Set(['get_record', 'create_record', 'update_record', 'delete_record']);
    return renameFlowConfigAliases(stack, crudTypes, [['object', 'objectName']], emit);
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'lead_lookup',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'get_record', config: { object: 'lead', recordId: '{leadId}' } },
            // Both spellings, DIFFERENT objects (#4923): real author ambiguity,
            // so both keys survive and the strict gate refuses naming both.
            { id: 'n3', type: 'create_record', config: { objectName: 'task', object: 'ticket' } },
            // Both spellings, SAME object: the alias carries nothing the
            // canonical key does not, so it is deleted (with a notice).
            { id: 'n4', type: 'update_record', config: { objectName: 'lead', object: 'lead' } },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'lead_lookup',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'get_record', config: { objectName: 'lead', recordId: '{leadId}' } },
            { id: 'n3', type: 'create_record', config: { objectName: 'task', object: 'ticket' } },
            { id: 'n4', type: 'update_record', config: { objectName: 'lead' } },
          ],
        },
      ],
    },
    // n2's rename + n4's redundant-twin deletion. n3 is the ambiguous pair: no
    // rewrite, no notice — the refusal is the strict gate's to make.
    expectedNotices: 2,
  },
};

/**
 * Lift `notify`'s nested `config.source: { object, id }` onto the canonical flat
 * `sourceObject` / `sourceId` keys (#4045).
 *
 * The fifth notify alias, and the only one that is not a 1:1 rename — it is a
 * 1→2 destructuring, so {@link renameFlowConfigAliases}' pair mechanism cannot
 * express it. It nevertheless follows {@link renameConfigKey}'s rule for a
 * shadowed alias, which #4923 settled **by value**:
 *
 *  - a nested part whose flat counterpart is ABSENT is lifted (a notice each);
 *  - a nested part that merely REPEATS the value already on its flat key is
 *    redundant — nothing to lift, but the part is accounted for, and the notice
 *    still fires so the removal is loud;
 *  - a nested part that DISAGREES with its flat key is genuine author
 *    ambiguity. The node is then left **entirely** untouched — no partial lift,
 *    no notice — so `source` survives to the strict `notify` contract, which
 *    refuses naming both the nested key and the flat pair. Choosing here would
 *    mean rewriting a click-through target the author never agreed to.
 *
 * `source` is dropped only when every part it carries was lifted or found
 * redundant, so nothing observable is lost. Leaving the ambiguous node whole
 * rather than half-converted also keeps the pass idempotent: a replay of the
 * unresolved shape re-derives the same verdict and emits nothing.
 *
 * A `source` that is not a dict, or carries neither key, is left untouched
 * rather than silently deleted.
 */
function liftNotifySourceShape(stack: Dict, emit: Emit): Dict {
  return mapFlowNodes(stack, (node, path) => {
    if (node.type !== 'notify') return node;
    const config = node.config;
    if (!isDict(config)) return node;
    const source = config.source;
    if (!isDict(source)) return node;

    const nextConfig: Dict = { ...config };
    const pending: ConversionApplication[] = [];
    let ambiguous = false;
    for (const [from, to] of [['object', 'sourceObject'], ['id', 'sourceId']] as const) {
      if (source[from] == null) continue;
      if (nextConfig[to] == null) {
        nextConfig[to] = source[from];
      } else if (!deepEqualAuthored(source[from], nextConfig[to])) {
        ambiguous = true;
        break;
      }
      pending.push({ from: `source.${from}`, to, path: `${path}.config.${to}` });
    }
    // The author named one slot twice, differently — hand the whole shape to
    // the strict gate rather than resolving part of it (#4923).
    if (ambiguous || pending.length === 0) return node;
    for (const application of pending) emit(application);
    delete nextConfig.source;
    return { ...node, config: nextConfig };
  });
}

/**
 * Notify flow-node config key aliases → canonical (protocol 17, #3796 / #4045).
 *
 * The `notify` executor carried five open-coded `??` fallbacks that never went
 * through the deprecation shim — an author who wrote the email-idiom keys got
 * a flow that worked forever and was never steered to the canonical spelling.
 * Four are pure key renames with unchanged values; the fifth
 * (`source: { object, id }`, #4045) is a destructuring handled by
 * {@link liftNotifySourceShape}.
 *
 * `actionUrl` is the deliberate canonical of its pair (the executor's own
 * `configSchema` used to claim the opposite): the entire downstream chain
 * already uses it — `sys_notification.action_url`, the channel-dispatch
 * contract, the REST notification read model — and `url` elsewhere in the
 * platform means "HTTP endpoint to call" (`http` node, webhooks), a different
 * concept from this in-app click-through target. The executor precedence
 * already put `actionUrl` first, so the choice is behaviour-preserving.
 * **Live window**; retires at 18.
 */
const flowNodeNotifyConfigAliases: MetadataConversion = {
  id: 'flow-node-notify-config-aliases',
  toMajor: 17,
  surface: 'flow.node.notify.config',
  summary:
    "notify flow-node config keys 'to' → 'recipients', 'subject' → 'title', 'body' → 'message', 'url' → 'actionUrl' (#3796), " +
    "and nested 'source: {object, id}' → 'sourceObject' / 'sourceId' (#4045)",
  apply(stack, emit) {
    const renamed = renameFlowConfigAliases(
      stack,
      new Set(['notify']),
      [
        ['to', 'recipients'],
        ['subject', 'title'],
        ['body', 'message'],
        ['url', 'actionUrl'],
      ],
      emit,
    );
    return liftNotifySourceShape(renamed, emit);
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'task_assigned',
          nodes: [
            { id: 'n1', type: 'start' },
            {
              id: 'n2',
              type: 'notify',
              config: {
                to: ['{record.assignee}'],
                subject: 'New task: {record.title}',
                body: 'You have been assigned "{record.title}".',
                url: '/task/{record.id}',
                channels: ['inbox'],
                // #4045 — the nested click-through target, lifted to the flat pair.
                source: { object: 'showcase_task', id: '{record.id}' },
              },
            },
            // `source.object` DISAGREES with the flat `sourceObject` (#4923).
            // The node is left whole — not even the unambiguous `id` is
            // lifted — so `source` reaches the strict `notify` contract and is
            // refused there, naming both the nested key and the flat pair.
            {
              id: 'n3',
              type: 'notify',
              config: {
                recipients: ['{record.owner}'],
                sourceObject: 'showcase_project',
                source: { object: 'crm_account', id: '{record.project}' },
              },
            },
            // `source.object` merely REPEATS the flat `sourceObject`: redundant,
            // so it counts as accounted for, `id` lifts, and `source` is
            // dropped — two notices, nothing observable lost.
            {
              id: 'n4',
              type: 'notify',
              config: {
                recipients: ['{record.reviewer}'],
                sourceObject: 'showcase_task',
                source: { object: 'showcase_task', id: '{record.task}' },
              },
            },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'task_assigned',
          nodes: [
            { id: 'n1', type: 'start' },
            {
              id: 'n2',
              type: 'notify',
              config: {
                recipients: ['{record.assignee}'],
                title: 'New task: {record.title}',
                message: 'You have been assigned "{record.title}".',
                actionUrl: '/task/{record.id}',
                channels: ['inbox'],
                sourceObject: 'showcase_task',
                sourceId: '{record.id}',
              },
            },
            {
              id: 'n3',
              type: 'notify',
              config: {
                recipients: ['{record.owner}'],
                sourceObject: 'showcase_project',
                source: { object: 'crm_account', id: '{record.project}' },
              },
            },
            {
              id: 'n4',
              type: 'notify',
              config: {
                recipients: ['{record.reviewer}'],
                sourceObject: 'showcase_task',
                sourceId: '{record.task}',
              },
            },
          ],
        },
      ],
    },
    // 4 renames on n2 + `source.object`/`source.id` lifted on n2 = 6; n3 is the
    // ambiguous pair and converts nothing; n4 adds 2 (the redundant `object`
    // and the lifted `id`).
    expectedNotices: 8,
  },
};

/**
 * The loose `config` keys the `wait` executor used to also accept, in the exact
 * precedence order of the `??` chains it carried, keyed by the declared
 * `waitEventConfig` property each one feeds.
 *
 * `duration` and `signal` are not declared names anywhere in the spec — they
 * only ever existed as the tail of an executor fallback, which is why the
 * declared spelling is listed first in each group.
 */
const WAIT_EVENT_CONFIG_LIFTS: ReadonlyArray<readonly [target: string, candidates: readonly string[]]> = [
  ['eventType', ['eventType']],
  ['timerDuration', ['timerDuration', 'duration']],
  ['signalName', ['signalName', 'signal']],
  ['timeoutMs', ['timeoutMs']],
];

/**
 * Lift `wait`'s loose `config.*` event keys onto the declared `waitEventConfig`
 * sibling (#4045).
 *
 * The only conversion here whose destination is **not** another `config` key.
 * `wait`'s contract does not live in `config` at all — it is
 * `FlowNodeSchema.waitEventConfig` (`flow.zod.ts`), a fully `.describe()`-annotated
 * block that is in the authorable-field list, reaches the generated reference,
 * and is what the showcase actually authors. Its descriptor therefore publishes
 * no `configSchema`, which is by design and not the gap it first looks like.
 *
 * The executor nevertheless carried `wec.X ?? loose.X` for six `config` keys —
 * a second, undeclared de-facto contract of exactly the `notify.source` shape
 * (PD #12), announced only by the comment "for hand-authored flows that put the
 * same keys under config".
 *
 * The showcase's `wait_revision` node authored exactly that shape
 * (`config: { eventType: 'signal', signalName: 'budget_revision' }`) until this
 * change moved it to the declared block — so the back door was not hypothetical,
 * and the example that demonstrates `wait` was itself on the retiring spelling.
 *
 * Precedence mirrors those `??` chains, so the rewrite is behaviour-preserving:
 * a value already on `waitEventConfig` WINS and its loose counterpart is left
 * shadowed in place, and among loose candidates the first one present decides.
 *
 * This is a LIFT between two locations, not an alias pair in one dict, so
 * #4923's by-value split (delete a redundant twin, keep a disagreeing one)
 * deliberately does NOT apply — {@link renameConfigKey} judges two spellings of
 * one slot, while here the loose `config` location is itself the retired thing
 * and `WAIT_EVENT_CONFIG_LIFTS` may map several candidate names onto one
 * target. Extending the rule here would be a separate ruling on a different
 * question; the shadowed loose key is left for the strict contract to reject.
 *
 * `eventType` is defaulted to `'timer'` whenever lifting would otherwise leave
 * the block without one. That is load-bearing, not tidiness: the loader parses
 * the CONVERTED flow (`applyConversionsToFlow` → `FlowSchema.parse`), and
 * `waitEventConfig.eventType` is **required** once the block exists — so a
 * stored flow carrying only `config: { duration: 'PT1M' }` would go from working
 * to failing to load. `'timer'` is the exact default the executor applied to
 * that shape.
 */
function liftWaitEventConfig(stack: Dict, emit: Emit): Dict {
  return mapFlowNodes(stack, (node, path) => {
    if (node.type !== 'wait') return node;
    const config = node.config;
    if (!isDict(config)) return node;

    const wec: Dict = isDict(node.waitEventConfig) ? { ...node.waitEventConfig } : {};
    const nextConfig: Dict = { ...config };
    let lifted = false;

    for (const [target, candidates] of WAIT_EVENT_CONFIG_LIFTS) {
      for (const from of candidates) {
        if (nextConfig[from] == null) continue;
        if (wec[target] == null) {
          wec[target] = nextConfig[from];
          delete nextConfig[from];
          emit({ from: `config.${from}`, to: `waitEventConfig.${target}`, path: `${path}.waitEventConfig.${target}` });
          lifted = true;
        }
        // The first candidate PRESENT decides, lifted or shadowed — the `??`
        // chain never looked past it either.
        break;
      }
    }

    if (!lifted) return node;
    if (wec.eventType == null) wec.eventType = 'timer';
    return { ...node, config: nextConfig, waitEventConfig: wec };
  });
}

/**
 * Wait flow-node loose `config` keys → the declared `waitEventConfig` sibling
 * (protocol 17, #4045). See {@link liftWaitEventConfig} for the precedence rules
 * and why `eventType` is defaulted. **Live window**; retires at 18.
 */
const flowNodeWaitEventConfigLift: MetadataConversion = {
  id: 'flow-node-wait-event-config-lift',
  toMajor: 17,
  surface: 'flow.node.wait.waitEventConfig',
  summary:
    "wait flow-node loose config keys → the declared `waitEventConfig` block: 'eventType', " +
    "'timerDuration'/'duration' → 'timerDuration', 'signalName'/'signal' → 'signalName', 'timeoutMs' (#4045)",
  apply(stack, emit) {
    return liftWaitEventConfig(stack, emit);
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'order_settlement',
          nodes: [
            { id: 'n1', type: 'start' },
            // Loose-only, and via the UNDECLARED `duration` spelling with no
            // eventType anywhere — the shape that would stop loading without
            // the `'timer'` default.
            { id: 'n2', type: 'wait', config: { duration: 'PT1M' } },
            // Loose `signal` alongside an explicit eventType: both lift.
            { id: 'n3', type: 'wait', config: { eventType: 'signal', signal: 'order_paid' } },
            // Partially shadowed: `timerDuration` is already declared, so the
            // loose `duration` stays put untouched; only `eventType` lifts.
            // (Deliberately not `timeoutMs` — protocol 17 retires that key
            // (#4158), and the fixture harness replays the WHOLE table, so an
            // `after` naming it would describe an end state that no longer
            // exists.)
            {
              id: 'n4',
              type: 'wait',
              waitEventConfig: { timerDuration: 'PT5M' },
              config: { duration: 'PT9M', eventType: 'signal' },
            },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'order_settlement',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'wait', config: {}, waitEventConfig: { timerDuration: 'PT1M', eventType: 'timer' } },
            { id: 'n3', type: 'wait', config: {}, waitEventConfig: { eventType: 'signal', signalName: 'order_paid' } },
            {
              id: 'n4',
              type: 'wait',
              waitEventConfig: { timerDuration: 'PT5M', eventType: 'signal' },
              config: { duration: 'PT9M' },
            },
          ],
        },
      ],
    },
    // n2: `duration` → `timerDuration`. n3: `eventType` + `signal` → `signalName`.
    // n4: only `eventType` (its `duration` is shadowed by a declared
    // `timerDuration` → no notice, and the key is left in place).
    expectedNotices: 4,
  },
};

/**
 * Map flow-node config key alias → canonical (protocol 17, #4045).
 *
 * `flowName` is the canonical key — it is what the descriptor's `configSchema`
 * declares, what the designer offers, and what the showcase authors. The
 * executor nonetheless accepted a bare `cfg.flowName ?? cfg.flow` fallback for
 * an undeclared `flow` spelling that no schema ever described: the
 * `notify.source` shape (PD #12), found by writing `MapConfigSchema` from the
 * executor for the #4045 reconciliation.
 *
 * A pure key rename with unchanged values, so the pair mechanism expresses it
 * directly. **Live window**; retires at 18.
 */
const flowNodeMapFlowAlias: MetadataConversion = {
  id: 'flow-node-map-flow-alias',
  toMajor: 17,
  surface: 'flow.node.map.config.flowName',
  summary: "map flow-node config key 'flow' → 'flowName' (#4045 — undeclared executor fallback graduation)",
  apply(stack, emit) {
    return renameFlowConfigAliases(stack, new Set(['map']), [['flow', 'flowName']], emit);
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'batch_signoff',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'map', config: { collection: '{tasks}', flow: 'one_task_signoff' } },
            // Both spellings naming DIFFERENT flows (#4923): which subflow runs
            // per item is the author's call, so both keys survive to the gate.
            { id: 'n3', type: 'map', config: { collection: '{rows}', flowName: 'per_row', flow: 'per_row_v2' } },
            // Both spellings naming the SAME flow: redundant, so deleted.
            { id: 'n4', type: 'map', config: { collection: '{items}', flowName: 'per_item', flow: 'per_item' } },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'batch_signoff',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'map', config: { collection: '{tasks}', flowName: 'one_task_signoff' } },
            { id: 'n3', type: 'map', config: { collection: '{rows}', flowName: 'per_row', flow: 'per_row_v2' } },
            { id: 'n4', type: 'map', config: { collection: '{items}', flowName: 'per_item' } },
          ],
        },
      ],
    },
    // n2's rename + n4's redundant-twin deletion; n3 converts nothing.
    expectedNotices: 2,
  },
};

/**
 * Subflow flow-node config key alias → canonical (protocol 17, #4278).
 *
 * The same undeclared `flow` spelling {@link flowNodeMapFlowAlias} retired for
 * `map`, found on `subflow` by writing `SubflowConfigSchema` from its executor
 * for the #4278 schemaless-node reconciliation: the executor carried a bare
 * `cfg.flowName ?? cfg.flow` fallback no schema or form ever described (PD
 * #12). The fallback is deleted in the same change; this conversion is what
 * keeps a stored `flow` spelling loading — rewritten to the canonical key,
 * including the `AutomationEngine.registerFlow` rehydration seam, so the
 * executor reads `cfg.flowName` only.
 *
 * A pure key rename with unchanged values. **Live window**; retires at 18.
 */
const flowNodeSubflowFlowAlias: MetadataConversion = {
  id: 'flow-node-subflow-flow-alias',
  toMajor: 17,
  surface: 'flow.node.subflow.config.flowName',
  summary: "subflow flow-node config key 'flow' → 'flowName' (#4278 — undeclared executor fallback graduation)",
  apply(stack, emit) {
    return renameFlowConfigAliases(stack, new Set(['subflow']), [['flow', 'flowName']], emit);
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'escalate_case',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'subflow', config: { flow: 'escalation_flow', input: { caseId: '{record.id}' } } },
            // Both spellings naming DIFFERENT flows (#4923): both survive, and
            // the strict `subflow` contract refuses naming both.
            { id: 'n3', type: 'subflow', config: { flowName: 'audit_flow', flow: 'audit_flow_v2' } },
            // Both spellings naming the SAME flow: redundant, so deleted.
            { id: 'n4', type: 'subflow', config: { flowName: 'notify_flow', flow: 'notify_flow' } },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'escalate_case',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'subflow', config: { flowName: 'escalation_flow', input: { caseId: '{record.id}' } } },
            { id: 'n3', type: 'subflow', config: { flowName: 'audit_flow', flow: 'audit_flow_v2' } },
            { id: 'n4', type: 'subflow', config: { flowName: 'notify_flow' } },
          ],
        },
      ],
    },
    // n2's rename + n4's redundant-twin deletion; n3 converts nothing.
    expectedNotices: 2,
  },
};

/** The `config` keys a mis-taught `connector_action` node carries, in declared-block order. */
const CONNECTOR_CONFIG_LIFTS = ['connectorId', 'actionId', 'input'] as const;

/**
 * Lift `connector_action`'s loose `config.*` keys onto the declared
 * `connectorConfig` sibling (#4045).
 *
 * Like `wait`, `connector_action`'s contract does not live in `config` at all —
 * it is `FlowNodeSchema.connectorConfig` (`flow.zod.ts`), and the executor reads
 * nothing else. Unlike `wait`, the executor never carried a loose-config
 * fallback; the wrong spelling was taught by the node's own **descriptor**,
 * whose `configSchema` declared `connectorId`/`actionId`/`input` as `config`
 * keys — and the Studio inspector derives its property form from a published
 * `configSchema` (rooting every field at `config.<key>`), so an author who
 * configured a connector node against a live backend produced exactly this
 * shape, and a node that then refused to dispatch. The descriptor stops
 * publishing that schema in the same change (see connector-nodes.ts); this
 * conversion is what makes the flows it mis-taught start working.
 *
 * Precedence matches every other lift here: a key already on the declared
 * block WINS and its loose counterpart is left shadowed in place.
 *
 * One completeness guard is load-bearing, mirroring `wait`'s `eventType`
 * default: the loader parses the CONVERTED flow, and `connectorConfig` requires
 * `connectorId` + `actionId` once the block exists. Unlike `eventType` there is
 * no defensible default for either, so when lifting cannot complete that pair
 * the node is left **untouched** — it keeps failing at run time with the same
 * clear refusal it produces today, rather than going from "registers, fails
 * the step" to "fails to load".
 */
function liftConnectorConfigShape(stack: Dict, emit: Emit): Dict {
  return mapFlowNodes(stack, (node, path) => {
    if (node.type !== 'connector_action') return node;
    const config = node.config;
    if (!isDict(config)) return node;

    const cc: Dict = isDict(node.connectorConfig) ? { ...node.connectorConfig } : {};
    const nextConfig: Dict = { ...config };
    const lifts: Array<(typeof CONNECTOR_CONFIG_LIFTS)[number]> = [];
    for (const key of CONNECTOR_CONFIG_LIFTS) {
      if (nextConfig[key] == null) continue;
      if (cc[key] != null) continue; // declared block wins; the loose key stays shadowed
      cc[key] = nextConfig[key];
      delete nextConfig[key];
      lifts.push(key);
    }
    if (lifts.length === 0) return node;
    // Completeness guard — never materialize a block the loader would reject.
    if (cc.connectorId == null || cc.actionId == null) return node;

    for (const key of lifts) {
      emit({ from: `config.${key}`, to: `connectorConfig.${key}`, path: `${path}.connectorConfig.${key}` });
    }
    return { ...node, config: nextConfig, connectorConfig: cc };
  });
}

/**
 * Connector flow-node loose `config` keys → the declared `connectorConfig`
 * sibling (protocol 17, #4045). See {@link liftConnectorConfigShape} for the
 * precedence rules and the completeness guard. **Live window**; retires at 18.
 */
const flowNodeConnectorConfigLift: MetadataConversion = {
  id: 'flow-node-connector-config-lift',
  toMajor: 17,
  surface: 'flow.node.connector_action.connectorConfig',
  summary:
    "connector_action flow-node loose config keys 'connectorId' / 'actionId' / 'input' → " +
    'the declared `connectorConfig` block (#4045)',
  apply(stack, emit) {
    return liftConnectorConfigShape(stack, emit);
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'task_completed_slack',
          nodes: [
            { id: 'n1', type: 'start' },
            // The shape the descriptor's configSchema (via the schema-driven
            // Studio form) mis-taught: the whole trio under `config`.
            {
              id: 'n2',
              type: 'connector_action',
              config: {
                connectorId: 'slack',
                actionId: 'chat.postMessage',
                input: { channel: 'C0WINS000', text: 'Task done: {record.title}' },
              },
            },
            // A declared block WINS: `config.connectorId` stays shadowed in
            // place, and since nothing else lifts, the node is untouched.
            {
              id: 'n3',
              type: 'connector_action',
              connectorConfig: { connectorId: 'rest', actionId: 'get', input: {} },
              config: { connectorId: 'ignored' },
            },
            // Completeness guard: no actionId anywhere, so lifting would
            // create a block the loader rejects — left untouched instead
            // (same run-time refusal as today).
            {
              id: 'n4',
              type: 'connector_action',
              config: { connectorId: 'slack' },
            },
            // A partial lift may complete an existing block: only `input`
            // lifts into the already-complete pair.
            {
              id: 'n5',
              type: 'connector_action',
              connectorConfig: { connectorId: 'rest', actionId: 'get' },
              config: { input: { path: '/api/v1/health' } },
            },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'task_completed_slack',
          nodes: [
            { id: 'n1', type: 'start' },
            {
              id: 'n2',
              type: 'connector_action',
              config: {},
              connectorConfig: {
                connectorId: 'slack',
                actionId: 'chat.postMessage',
                input: { channel: 'C0WINS000', text: 'Task done: {record.title}' },
              },
            },
            {
              id: 'n3',
              type: 'connector_action',
              connectorConfig: { connectorId: 'rest', actionId: 'get', input: {} },
              config: { connectorId: 'ignored' },
            },
            {
              id: 'n4',
              type: 'connector_action',
              config: { connectorId: 'slack' },
            },
            {
              id: 'n5',
              type: 'connector_action',
              connectorConfig: { connectorId: 'rest', actionId: 'get', input: { path: '/api/v1/health' } },
              config: {},
            },
          ],
        },
      ],
    },
    // n2: the full trio lifts. n3: shadowed → no lift, no notice. n4: guard —
    // nothing materializes. n5: the single unshadowed `input`.
    expectedNotices: 4,
  },
};

/**
 * Script flow-node config key aliases → canonical (protocol 17, #3796).
 *
 * `function` is the canonical callable reference (#1870); `functionName` was
 * the AI/template-emitted alias. `inputs` is the canonical input map; the
 * `input` alias almost certainly leaked from `connector_action`, whose
 * `connectorConfig.input` (singular) is a *different, canonical* surface and is
 * deliberately not touched here. Both are pure key renames with unchanged
 * values. **Live window**; retires at 18.
 *
 * The fixture below carried `actionType: 'invoke_function'` through both sides
 * until #4343 retired that key — an end state protocol 17 no longer reaches, so
 * it is gone from both. The rename itself is untouched.
 */
const flowNodeScriptConfigAliases: MetadataConversion = {
  id: 'flow-node-script-config-aliases',
  toMajor: 17,
  surface: 'flow.node.script.config',
  summary: "script flow-node config keys 'functionName' → 'function', 'input' → 'inputs' (#3796)",
  apply(stack, emit) {
    return renameFlowConfigAliases(
      stack,
      new Set(['script']),
      [
        ['functionName', 'function'],
        ['input', 'inputs'],
      ],
      emit,
    );
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'score_lead',
          nodes: [
            { id: 'n1', type: 'start' },
            {
              id: 'n2',
              type: 'script',
              config: {
                functionName: 'score_lead',
                input: { leadId: '{record.id}' },
                outputVariable: 'score',
              },
            },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'score_lead',
          nodes: [
            { id: 'n1', type: 'start' },
            {
              id: 'n2',
              type: 'script',
              config: {
                function: 'score_lead',
                inputs: { leadId: '{record.id}' },
                outputVariable: 'score',
              },
            },
          ],
        },
      ],
    },
    expectedNotices: 2,
  },
};

/**
 * App dead authoring keys removed (protocol 17, #4001 app step; 2026-06
 * AppSchema liveness audit).
 *
 * Seven keys were authorable and never read by any consumer in framework or
 * objectui: `version` (an app is versioned by its package's
 * `manifest.version`), `aria` (no renderer read app-level ARIA), `objects` /
 * `apis` (the spec's own "config file convenience" — objects register via
 * `defineStack`, and the chatbot derives an app's object list from its nav
 * items), `sharing` / `embed` (declared-but-unenforced security surface — the
 * only live path is `FormView.sharing`; ADR-0049 class), and
 * `mobileNavigation` (fully unimplemented — even `packages/mobile` ignored
 * it). Pure lossless deletes: none ever had a runtime effect.
 *
 * `retiredFromLoadPath`: the schema tombstones each key (`retiredKey`, tsc
 * `never` + a parse-time prescription), same posture as its step-17 siblings.
 *
 * ## Extended by #4509 — the two context-selector keys
 *
 * `contextSelectors[].includeAll` and `contextSelectors[].placement` join the
 * same conversion rather than opening a second `app` entry: both target major
 * 17, both are pure deletes on the same collection, and a separate entry would
 * have to keep its fixture disjoint from this one's for no gain.
 *
 * They differ from the seven above in why they went out. Both carried schema
 * defaults, which the liveness advisory lint cannot warn on — a default
 * materialises at parse time, so an authored value is indistinguishable from a
 * supplied one. Removal was the only channel that could reach an author.
 *
 * `includeAll` was the sharper of the two: not unread but deliberately
 * DISOBEYED. Context selectors are mandatory-scope, so the shell never rendered
 * an "All" row — on Studio's package selector an All row would undo the
 * selector's own `filter` and list the platform's system/cloud kernel packages.
 * `STUDIO_APP` authored `includeAll: true` against a renderer that ignored it,
 * which is what a flag reading alive while doing nothing looks like from the
 * inside.
 */
const appDeadAuthoringKeysRemoved: MetadataConversion = {
  id: 'app-dead-authoring-keys-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface:
    'app.version / app.aria / app.objects / app.apis / app.sharing / app.embed / '
    + 'app.mobileNavigation / app.contextSelectors.includeAll / app.contextSelectors.placement / '
    + 'app.homePageId / app.areas.order',
  summary: "app keys 'version'/'aria'/'objects'/'apis'/'sharing'/'embed'/'mobileNavigation'/'homePageId' plus contextSelectors 'includeAll'/'placement' and areas 'order' removed (liveness audits #4001, #4509, #4667 — unread or wrongly encoded; sharing/embed declared a public surface no route enforced, mobileNavigation was fully unimplemented, includeAll was deliberately disobeyed because an 'All' row would clear a mandatory scope, homePageId WAS read by objectui's console before v17 but encoded the landing page as an ID cross-reference that silently fell back when it dangled — the landing page is the first nav item (premise corrected in #4709; the retirement stands), and no renderer ever sorted areas)",
  apply(stack, emit) {
    const RETIRED = [
      'version', 'aria', 'objects', 'apis', 'sharing', 'embed', 'mobileNavigation',
      'homePageId',
    ];
    const RETIRED_SELECTOR = ['includeAll', 'placement'];
    return mapCollection(stack, 'apps', (app, path) => {
      const next = stripKeys(app, RETIRED, emit, path);
      // `contextSelectors` and `areas` are ARRAYS one level down, so stripKeys
      // (top-level only) cannot reach them. Drill in and copy-on-write at both
      // levels, so an app with nothing to strip keeps its identity for change
      // detection.
      const stripInArray = (key: string, retired: string[], src: Record<string, unknown>) => {
        const arr = src[key];
        if (!Array.isArray(arr)) return src;
        let touched = false;
        const mapped = arr.map((el, i) => {
          if (!el || typeof el !== 'object' || Array.isArray(el)) return el;
          const stripped = stripKeys(
            el as Record<string, unknown>,
            retired,
            emit,
            `${path}.${key}[${i}]`,
          );
          if (stripped !== el) touched = true;
          return stripped;
        });
        return touched ? { ...src, [key]: mapped } : src;
      };
      return stripInArray('areas', ['order'], stripInArray('contextSelectors', RETIRED_SELECTOR, next));
    });
  },
  fixture: {
    before: {
      apps: [{
        name: 'portal',
        label: 'Portal',
        version: '1.0.0',
        sharing: { enabled: true },
        embed: { enabled: true },
        mobileNavigation: { mode: 'bottom_nav' },
        homePageId: 'nav_home',
        contextSelectors: [{
          id: 'active_package',
          label: 'Package',
          optionsSource: { endpoint: '/api/v1/packages', valueKey: 'id', labelKey: 'name' },
          includeAll: true,
          placement: 'sidebar_header',
        }],
        areas: [{ id: 'area_sales', label: 'Sales', order: 1, navigation: [] }],
        navigation: [{ id: 'nav_home', label: 'Home', type: 'object', objectName: 'account' }],
      }],
    },
    after: {
      apps: [{
        name: 'portal',
        label: 'Portal',
        contextSelectors: [{
          id: 'active_package',
          label: 'Package',
          optionsSource: { endpoint: '/api/v1/packages', valueKey: 'id', labelKey: 'name' },
        }],
        areas: [{ id: 'area_sales', label: 'Sales', navigation: [] }],
        navigation: [{ id: 'nav_home', label: 'Home', type: 'object', objectName: 'account' }],
      }],
    },
    // Eight notices: five top-level keys (`version`, `sharing`, `embed`,
    // `mobileNavigation`, `homePageId`), the two on the single context
    // selector, and `order` on the single area.
    expectedNotices: 8,
  },
};

/**
 * `app.areas[].visible` / `app.areas[].requiredPermissions` removed
 * (protocol 17, #4651, ADR-0049).
 *
 * Deliberately its own conversion rather than two more keys on
 * `app-dead-authoring-keys-removed` above. That entry's summary is a list of
 * inert authoring keys; these two are a **security** finding, and the summary
 * string is what `spec-changes.json`, the generated upgrade guide and the
 * `spec_changes` MCP tool serve to an upgrading consumer. Folded into the
 * catch-all, "a gate that never gated has been removed" would arrive buried in
 * a sentence about `version` and `mobileNavigation` — and it is the one line of
 * this release an author with a gated area has to read.
 *
 * The defect: `filterAppForUser` (`packages/rest/src/rest-server.ts`) checks the
 * APP's `requiredPermissions`, then walks ONLY `item.navigation` — it never
 * reads `item.areas` — while the client renders every area in the switcher. An
 * area declaring `requiredPermissions: ['sales.admin']` parsed, stored, served
 * and rendered for every user. Fail open, on the surface whose per-ITEM and
 * per-APP siblings of the same name ARE enforced (ADR-0078 false compliance).
 *
 * Stripping is lossless in the only sense that matters: the keys changed no
 * outcome, so metadata behaves identically with or without them. What the
 * author loses is the BELIEF that the area was gated — which is the point of
 * the removal, and why the strict schema's `guidance` prescription (see
 * `ui/app.zod.ts`) names the two layers that do enforce instead of just saying
 * "removed".
 *
 * `retiredFromLoadPath`: the strict schema refuses the keys outright, so there
 * is no alias window; the entry exists so `spec-changes.json` carries the
 * removal and `os migrate meta --from 16` can rewrite authored sources.
 */
const appAreaFailOpenGatesRemoved: MetadataConversion = {
  id: 'app-area-fail-open-gates-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'app.areas.visible / app.areas.requiredPermissions',
  summary: "navigation-area keys 'visible'/'requiredPermissions' removed (#4651, ADR-0049 — FAIL-OPEN access gates: no layer ever read them, so a 'hidden' or permission-gated area was served and rendered to every user, while the identically named keys on a navigation ITEM and on the APP are enforced; gate the items inside the area, or gate the app)",
  apply(stack, emit) {
    const RETIRED_AREA_GATES = ['visible', 'requiredPermissions'];
    return mapCollection(stack, 'apps', (app, path) => {
      // `areas` is an ARRAY one level down, so `stripKeys` (top-level only)
      // cannot reach it. Copy-on-write at both levels, so an app with nothing
      // to strip keeps its identity for change detection.
      const areas = app.areas;
      if (!Array.isArray(areas)) return app;
      let touched = false;
      const mapped = areas.map((el, i) => {
        if (!isDict(el)) return el;
        const stripped = stripKeys(el, RETIRED_AREA_GATES, emit, `${path}.areas[${i}]`);
        if (stripped !== el) touched = true;
        return stripped;
      });
      return touched ? { ...app, areas: mapped } : app;
    });
  },
  fixture: {
    // DISJOINT from `app-dead-authoring-keys-removed`'s fixture above and from
    // every other entry: this app carries none of the keys another conversion
    // strips, and that fixture's area carries neither gate — so each replays
    // through the whole table hitting only its own entry.
    before: {
      apps: [{
        name: 'sales_portal',
        label: 'Sales Portal',
        areas: [
          {
            id: 'area_admin',
            label: 'Admin',
            visible: "'sales_admin' in current_user.positions",
            requiredPermissions: ['sales.admin'],
            navigation: [{ id: 'nav_forecast', label: 'Forecast', type: 'object', objectName: 'forecast' }],
          },
          // Untouched on purpose: the per-ITEM gate inside this area is the
          // ENFORCED layer the prescription points at, and it spells the two
          // key names identically. A sweep by key name alone would delete the
          // working gate along with the fake one.
          {
            id: 'area_sales',
            label: 'Sales',
            navigation: [{
              id: 'nav_leads', label: 'Leads', type: 'object', objectName: 'lead',
              visible: "'sales' in current_user.positions",
              requiredPermissions: ['sales.access'],
            }],
          },
        ],
      }],
    },
    after: {
      apps: [{
        name: 'sales_portal',
        label: 'Sales Portal',
        areas: [
          {
            id: 'area_admin',
            label: 'Admin',
            navigation: [{ id: 'nav_forecast', label: 'Forecast', type: 'object', objectName: 'forecast' }],
          },
          {
            id: 'area_sales',
            label: 'Sales',
            navigation: [{
              id: 'nav_leads', label: 'Leads', type: 'object', objectName: 'lead',
              visible: "'sales' in current_user.positions",
              requiredPermissions: ['sales.access'],
            }],
          },
        ],
      }],
    },
    // Two notices: both gates on the ONE area that declared them. The second
    // area and the nav item inside it must produce none.
    expectedNotices: 2,
  },
};

/**
 * RLS-policy `priority` removed (protocol 17, #3896 security audit).
 *
 * A pure DELETE with no rename target, because the promised semantics never
 * existed: applicable policies OR-combine (any match allows access — most
 * permissive wins), so there is no conflict for a priority to resolve and
 * evaluation order cannot change an outcome. The 2026-07-30 security-subset
 * liveness re-verification closed the call graph — collection site, projection
 * round-trip, compiler — and found NO reader, ever. Dropping the key is
 * therefore strictly lossless: outcomes are identical with or without it.
 *
 * `retiredFromLoadPath`: the schema tombstones the key (`retiredKey`, tsc
 * `never` + a parse-time prescription), same posture as its step-17 siblings.
 */
const permissionRlsPriorityRemoved: MetadataConversion = {
  id: 'permission-rls-priority-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'permission.rowLevelSecurity.priority',
  summary: "RLS-policy key 'priority' removed (#3896 audit — policies OR-combine, so the promised conflict-resolution semantics cannot exist; dropping it changes no outcome)",
  apply(stack, emit) {
    return mapCollection(stack, 'permissions', (ps, path) => {
      const rls = (ps as { rowLevelSecurity?: unknown }).rowLevelSecurity;
      if (!Array.isArray(rls)) return ps;
      let touched = false;
      const next = rls.map((policy, i) => {
        if (!isDict(policy) || !('priority' in policy)) return policy;
        const { priority: _dropped, ...rest } = policy;
        emit({ from: 'priority', to: '(removed)', path: `${path}.rowLevelSecurity[${i}].priority` });
        touched = true;
        return rest;
      });
      return touched ? { ...ps, rowLevelSecurity: next } : ps;
    });
  },
  fixture: {
    before: {
      permissions: [{
        name: 'contributor',
        label: 'Contributor',
        rowLevelSecurity: [{
          name: 'own_tasks',
          object: 'crm_task',
          operation: 'select',
          using: 'assignee == current_user.email',
          enabled: true,
          priority: 10,
        }],
      }],
    },
    after: {
      permissions: [{
        name: 'contributor',
        label: 'Contributor',
        rowLevelSecurity: [{
          name: 'own_tasks',
          object: 'crm_task',
          operation: 'select',
          using: 'assignee == current_user.email',
          enabled: true,
        }],
      }],
    },
    expectedNotices: 1,
  },
};

/**
 * Tool inert authoring keys removed (protocol 17, #3896 audit close-out).
 *
 * `category`, `permissions`, `active` and `builtIn` were authorable and inert —
 * none is part of `AIToolDefinition` and no execution path read them. Two were
 * misleading in the dangerous direction: `permissions` promised a capability
 * gate on invocation that nothing enforced (a tool "requiring" capabilities ran
 * for everyone), and `active: false` read as "withdrawn" while the tool kept
 * reaching the LLM tool set and `POST /ai/tools/:name/execute` kept running it.
 * A pure lossless delete: dropping the keys changes no runtime behaviour,
 * because they never had any.
 *
 * `retiredFromLoadPath`: ToolSchema is `.strict()` and rejects each key with
 * its prescription (`TOOL_RETIRED_KEY_GUIDANCE`), the #3715 pattern.
 */
const toolInertAuthoringKeysRemoved: MetadataConversion = {
  id: 'tool-inert-authoring-keys-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'tool.category / tool.permissions / tool.active / tool.builtIn',
  summary: "tool keys 'category'/'permissions'/'active'/'builtIn' removed (#3896 close-out — authorable and inert; permissions gated nothing, active:false withdrew nothing)",
  apply(stack, emit) {
    const RETIRED = ['category', 'permissions', 'active', 'builtIn'] as const;
    return mapCollection(stack, 'tools', (tool, path) => {
      let touched = false;
      const next: Record<string, unknown> = { ...tool };
      for (const key of RETIRED) {
        if (!(key in next)) continue;
        delete next[key];
        emit({ from: key, to: '(removed)', path: `${path}.${key}` });
        touched = true;
      }
      return touched ? next : tool;
    });
  },
  fixture: {
    before: {
      tools: [{
        name: 'create_case',
        label: 'Create Case',
        description: 'Creates a support case',
        parameters: { type: 'object' },
        category: 'action',
        permissions: ['case.create'],
        active: true,
        builtIn: false,
      }],
    },
    after: {
      tools: [{
        name: 'create_case',
        label: 'Create Case',
        description: 'Creates a support case',
        parameters: { type: 'object' },
      }],
    },
    expectedNotices: 4,
  },
};

/**
 * `required: true` gains its explicit `storage.notNull` (protocol 17,
 * ADR-0113).
 *
 * Before protocol 17, `field.required` bound THREE meanings to one knob: the
 * write-time contract, the physical NOT NULL DDL, and the drift expectation.
 * ADR-0113 splits them: `required` keeps the write contract, and the column
 * constraint becomes the explicit `storage: { notNull: true }`. Under the OLD
 * semantics every required field's column was created NOT NULL, so this
 * conversion preserves each old source's full meaning by WRITING IT DOWN —
 * a pure semantic explicitization, lossless by construction.
 *
 * `retiredFromLoadPath` is load-bearing here in a way it is not for renames:
 * a rename is idempotent on canonical input, but this is a DEFAULT FLIP — a
 * protocol-17-authored `required: true` deliberately means "nullable column,
 * write-gated", and a loader that auto-applied this transform would stamp
 * NOT NULL onto it, silently restoring the tri-binding the ADR removed. Only
 * `os migrate meta --from <16 or lower>` may apply it, where "this source
 * predates the split" is a fact, not a guess.
 */
const fieldRequiredNotNullExplicit: MetadataConversion = {
  id: 'field-required-notnull-explicit',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'object.fields.*.required / object.fields.*.storage.notNull',
  summary: "required fields gain explicit 'storage.notNull: true' (ADR-0113 — pre-17 'required' implied the column constraint; post-17 it is only the write contract)",
  apply(stack, emit) {
    return mapCollection(stack, 'objects', (obj, path) => {
      const fields = (obj as { fields?: Record<string, Record<string, unknown>> }).fields;
      if (!fields || typeof fields !== 'object') return obj;
      let touched = false;
      const nextFields: Record<string, unknown> = { ...fields };
      for (const [fieldName, def] of Object.entries(fields)) {
        if (!def || typeof def !== 'object') continue;
        if (def.required !== true) continue;
        if (def.storage !== undefined) continue; // an explicit storage block wins
        nextFields[fieldName] = { ...def, storage: { notNull: true } };
        emit({ from: 'required: true (implied NOT NULL)', to: 'storage.notNull: true', path: `${path}.fields.${fieldName}.storage.notNull` });
        touched = true;
      }
      return touched ? { ...obj, fields: nextFields } : obj;
    });
  },
  fixture: {
    before: {
      objects: [{
        name: 'crm_lead',
        label: 'Lead',
        fields: {
          name: { type: 'text', required: true },
          status: { type: 'select', required: true },
          notes: { type: 'textarea' },
        },
      }],
    },
    after: {
      objects: [{
        name: 'crm_lead',
        label: 'Lead',
        fields: {
          name: { type: 'text', required: true, storage: { notNull: true } },
          status: { type: 'select', required: true, storage: { notNull: true } },
          notes: { type: 'textarea' },
        },
      }],
    },
    expectedNotices: 2,
  },
};


/**
 * The #3896 close-out sweep, part 2 (protocol 17): the remaining inert
 * authoring keys leave the surface, one conversion per metadata type. All are
 * pure lossless deletes — none of these keys ever had a runtime effect to
 * lose — and all are retired from the load path: each schema tombstones its
 * keys with the prescription (`retiredKey`), so the loader rejects loudly and
 * only `os migrate meta` rewrites sources.
 */
const stripKeys = (
  item: Record<string, unknown>,
  keys: readonly string[],
  emit: (n: { from: string; to: string; path: string }) => void,
  path: string,
): Record<string, unknown> => {
  let touched = false;
  const next: Record<string, unknown> = { ...item };
  for (const key of keys) {
    if (!(key in next)) continue;
    delete next[key];
    emit({ from: key, to: '(removed)', path: `${path}.${key}` });
    touched = true;
  }
  return touched ? next : item;
};

/** action.shortcut / action.bulkEnabled — capability claims nothing enforced. */
const actionInertKeysRemoved: MetadataConversion = {
  id: 'action-inert-keys-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'action.shortcut / action.bulkEnabled',
  summary: "action keys 'shortcut'/'bulkEnabled' removed (#3896 close-out — no keydown path dispatches shortcuts; the multi-select toolbar reads the view's bulkActions)",
  apply(stack, emit) {
    return mapCollection(stack, 'actions', (a, path) => stripKeys(a, ['shortcut', 'bulkEnabled'], emit, path));
  },
  fixture: {
    before: { actions: [{ name: 'close_case', label: 'Close', type: 'script', shortcut: 'Ctrl+K', bulkEnabled: true }] },
    after: { actions: [{ name: 'close_case', label: 'Close', type: 'script' }] },
    expectedNotices: 2,
  },
};

/**
 * flow.active / flow.template / nodes[].outputSchema /
 * errorHandling.fallbackNodeId — `active` is the rls.enabled shape (writing
 * `active: false` never stopped a flow; `status` is the enforced lifecycle),
 * the rest were never read. Deleting `active` preserves behavior exactly —
 * the flow was governed by `status` all along; the notice tells the author
 * where the real switch is.
 */
const flowInertKeysRemoved: MetadataConversion = {
  id: 'flow-inert-keys-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'flow.active / flow.template / flow.nodes[].outputSchema / flow.errorHandling.fallbackNodeId',
  summary: "flow keys 'active'/'template', node 'outputSchema' and errorHandling 'fallbackNodeId' removed (#3896 close-out — active:false never stopped a flow; status is the enforced lifecycle)",
  apply(stack, emit) {
    let out = mapCollection(stack, 'flows', (f, path) => {
      let next = stripKeys(f, ['active', 'template'], emit, path);
      const eh = next.errorHandling;
      if (eh && typeof eh === 'object' && !Array.isArray(eh) && 'fallbackNodeId' in (eh as Record<string, unknown>)) {
        const nextEh = { ...(eh as Record<string, unknown>) };
        delete nextEh.fallbackNodeId;
        emit({ from: 'fallbackNodeId', to: '(removed)', path: `${path}.errorHandling.fallbackNodeId` });
        next = next === f ? { ...f } : next;
        next.errorHandling = nextEh;
      }
      return next;
    });
    out = mapFlowNodes(out, (node, path) => {
      if (!('outputSchema' in node)) return node;
      const next = { ...node };
      delete next.outputSchema;
      emit({ from: 'outputSchema', to: '(removed)', path: `${path}.outputSchema` });
      return next;
    });
    return out;
  },
  fixture: {
    before: {
      flows: [{
        name: 'escalate',
        type: 'autolaunched',
        active: false,
        template: true,
        errorHandling: { strategy: 'retry', fallbackNodeId: 'n9' },
        nodes: [{ id: 'n1', type: 'start', outputSchema: { ok: { type: 'boolean' } } }],
        edges: [],
      }],
    },
    after: {
      flows: [{
        name: 'escalate',
        type: 'autolaunched',
        errorHandling: { strategy: 'retry' },
        nodes: [{ id: 'n1', type: 'start' }],
        edges: [],
      }],
    },
    expectedNotices: 4,
  },
};

/**
 * View container: list-shaped entries lose `responsive`/`performance`,
 * form-shaped entries lose `data`/`defaultSort`/`aria`. Deliberately
 * SHAPE-SCOPED — the LIST view's `aria` and `data` are live and untouched.
 */
const viewInertKeysRemoved: MetadataConversion = {
  id: 'view-inert-keys-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'view.list.responsive / view.list.performance / view.form.defaultSort / view.form.aria',
  summary: "view keys removed (#3896 close-out): list 'responsive'/'performance', form 'defaultSort'/'aria' — no renderer read them (list aria/data and form data stay live)",
  apply(stack, emit) {
    const LIST_KEYS = ['responsive', 'performance'] as const;
    // NOT 'data': the sweep's removal attempt was refuted by the build —
    // defineForm writes data.provider='schema' on every metadata form.
    const FORM_KEYS = ['defaultSort', 'aria'] as const;
    return mapCollection(stack, 'views', (view, path) => {
      let touched = false;
      const next: Record<string, unknown> = { ...view };
      const fix = (keys: readonly string[], sub: Record<string, unknown>, subPath: string) => {
        const cleaned = stripKeys(sub, keys, emit, subPath);
        if (cleaned !== sub) { touched = true; return cleaned; }
        return sub;
      };
      for (const [slot, keys] of [['list', LIST_KEYS], ['form', FORM_KEYS]] as const) {
        const v = next[slot];
        if (v && typeof v === 'object' && !Array.isArray(v)) next[slot] = fix(keys, v as Record<string, unknown>, `${path}.${slot}`);
      }
      for (const [slot, keys] of [['listViews', LIST_KEYS], ['formViews', FORM_KEYS]] as const) {
        const named = next[slot];
        if (named && typeof named === 'object' && !Array.isArray(named)) {
          const rebuilt: Record<string, unknown> = { ...(named as Record<string, unknown>) };
          let subTouched = false;
          for (const [name, v] of Object.entries(rebuilt)) {
            if (v && typeof v === 'object' && !Array.isArray(v)) {
              const cleaned = stripKeys(v as Record<string, unknown>, keys, emit, `${path}.${slot}.${name}`);
              if (cleaned !== v) { rebuilt[name] = cleaned; subTouched = true; }
            }
          }
          if (subTouched) { next[slot] = rebuilt; touched = true; }
        }
      }
      return touched ? next : view;
    });
  },
  fixture: {
    before: {
      views: [{
        object: 'crm_lead',
        list: { type: 'grid', columns: ['name'], responsive: { sm: {} }, performance: { lazyLoad: true }, aria: { label: 'Leads' } },
        form: { type: 'simple', data: { provider: 'object', object: 'crm_lead' }, defaultSort: [{ field: 'created_at', order: 'desc' }], aria: { label: 'Lead form' } },  // data survives
      }],
    },
    after: {
      views: [{
        object: 'crm_lead',
        list: { type: 'grid', columns: ['name'], aria: { label: 'Leads' } },
        form: { type: 'simple', data: { provider: 'object', object: 'crm_lead' } },
      }],
    },
    expectedNotices: 4,
  },
};

/**
 * View container: list-shaped entries lose `striped`/`bordered`/`virtualScroll`
 * (#7176, ADR-0049 enforce-or-remove, maintainer ruling 2026-08-10). Every
 * measured reader was a forwarding copy — react spec-bridge → plugin-list →
 * plugin-view/app-shell — and the chains end at ObjectGrid, which never spells
 * any of the three: copy-without-apply is dead in effect. List-shaped slots
 * only (`list` + named `listViews`); form-shaped entries never declared them.
 */
const viewListPassthroughKeysRemoved: MetadataConversion = {
  id: 'view-list-passthrough-keys-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'view.list.striped / view.list.bordered / view.list.virtualScroll',
  summary: "view list keys removed (#7176): 'striped'/'bordered'/'virtualScroll' — every measured reader copied the key forward and none applied it (pass-through-only; ADR-0049 enforce-or-remove)",
  apply(stack, emit) {
    const LIST_KEYS = ['striped', 'bordered', 'virtualScroll'] as const;
    return mapCollection(stack, 'views', (view, path) => {
      let touched = false;
      const next: Record<string, unknown> = { ...view };
      const list = next.list;
      if (list && typeof list === 'object' && !Array.isArray(list)) {
        const cleaned = stripKeys(list as Record<string, unknown>, LIST_KEYS, emit, `${path}.list`);
        if (cleaned !== list) { next.list = cleaned; touched = true; }
      }
      const named = next.listViews;
      if (named && typeof named === 'object' && !Array.isArray(named)) {
        const rebuilt: Record<string, unknown> = { ...(named as Record<string, unknown>) };
        let subTouched = false;
        for (const [name, lv] of Object.entries(rebuilt)) {
          if (lv && typeof lv === 'object' && !Array.isArray(lv)) {
            const cleaned = stripKeys(lv as Record<string, unknown>, LIST_KEYS, emit, `${path}.listViews.${name}`);
            if (cleaned !== lv) { rebuilt[name] = cleaned; subTouched = true; }
          }
        }
        if (subTouched) { next.listViews = rebuilt; touched = true; }
      }
      return touched ? next : view;
    });
  },
  fixture: {
    before: {
      views: [{
        object: 'crm_lead',
        list: { type: 'grid', columns: ['name'], resizable: true, striped: true, bordered: true, virtualScroll: true },  // resizable survives
        listViews: {
          all: { type: 'grid', columns: ['name'], striped: false },
        },
      }],
    },
    after: {
      views: [{
        object: 'crm_lead',
        list: { type: 'grid', columns: ['name'], resizable: true },
        listViews: {
          all: { type: 'grid', columns: ['name'] },
        },
      }],
    },
    expectedNotices: 4,
  },
};

/**
 * The `'pdf'` export format leaves `view.exportOptions` (protocol 17, #8010 —
 * maintainer ruling 2026-08-12).
 *
 * PDF export was declined platform-side (#1301 NOT_PLANNED), so the enum
 * member was declared-but-unrenderable: ObjectGrid dropped the format from the
 * export menu with only a runtime `console.warn`, so `exportOptions:
 * ['xlsx', 'pdf']` type-checked, validated, and silently rendered a menu
 * without PDF. The same ruling adopted the OBJECT form for `exportOptions`
 * (`{ formats?, maxRecords?, includeHeaders?, fileNamePrefix?, streaming? }` —
 * the key set the renderer actually reads); the legacy bare array stays
 * accepted and lifts to `{ formats: [...] }` at parse, so this conversion does
 * NOT rewrite the array form to the object form — the array is back-compat,
 * not retired.
 *
 * This is an enum-VALUE retirement, so there is no `retiredKey()` tombstone to
 * hang the prescription on — the format enum's own error map carries it
 * (`LIST_VIEW_EXPORT_PDF_RETIRED`, ui/view.zod.ts), keyed on `issue.input` so
 * only the value which used to be legal gets the "was removed" message, plus a
 * union-level dispatch so the refusal is the TOP-level message in either
 * authored spelling (the `hook-body-crypto-hash-removed` precedent, one level
 * deeper again: the value sits inside either a bare array or an object's
 * `formats`, so `stripKeys` cannot reach it).
 *
 * `retiredFromLoadPath`: the enum rejects the value outright, so a live author
 * is taught at parse rather than silently rewritten. The entry exists so
 * stored 16.x/17-rc rows replay clean (`applyConversionsToStoredItem`) and so
 * `os migrate meta --from 16` rewrites author sources. As with `crypto.hash`,
 * the strip keeps the surrounding declaration — an emptied `formats` array
 * stays (an export menu configured to offer nothing is a declaration, not an
 * accident this conversion may invent an answer for).
 */
const viewExportOptionsPdfRemoved: MetadataConversion = {
  id: 'view-export-options-pdf-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'view.list.exportOptions / view.listViews.*.exportOptions',
  summary:
    "list-view export format 'pdf' removed (#8010 — PDF export was declined as #1301 NOT_PLANNED; "
    + 'ObjectGrid dropped the declared format from the menu with only a runtime console.warn)',
  apply(stack, emit) {
    const stripPdf = (slot: unknown, path: string): unknown => {
      if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return slot;
      const eo = (slot as Dict).exportOptions;
      if (Array.isArray(eo) && eo.includes('pdf')) {
        emit({ from: 'pdf', to: '(removed)', path: `${path}.exportOptions` });
        return { ...(slot as Dict), exportOptions: eo.filter((f) => f !== 'pdf') };
      }
      if (eo && typeof eo === 'object' && !Array.isArray(eo)) {
        const formats = (eo as Dict).formats;
        if (Array.isArray(formats) && formats.includes('pdf')) {
          emit({ from: 'pdf', to: '(removed)', path: `${path}.exportOptions.formats` });
          return {
            ...(slot as Dict),
            exportOptions: { ...(eo as Dict), formats: formats.filter((f) => f !== 'pdf') },
          };
        }
      }
      return slot;
    };
    return mapCollection(stack, 'views', (view, path) => {
      let touched = false;
      const next: Record<string, unknown> = { ...view };
      const list = stripPdf(next.list, `${path}.list`);
      if (list !== next.list) { next.list = list; touched = true; }
      const named = next.listViews;
      if (named && typeof named === 'object' && !Array.isArray(named)) {
        const rebuilt: Record<string, unknown> = { ...(named as Record<string, unknown>) };
        let subTouched = false;
        for (const [name, lv] of Object.entries(rebuilt)) {
          const cleaned = stripPdf(lv, `${path}.listViews.${name}`);
          if (cleaned !== lv) { rebuilt[name] = cleaned; subTouched = true; }
        }
        if (subTouched) { next.listViews = rebuilt; touched = true; }
      }
      return touched ? next : view;
    });
  },
  fixture: {
    before: {
      views: [{
        object: 'crm_contract',
        // Legacy array spelling: 'pdf' is stripped, the survivors stay an array
        // (the array form is back-compat, not retired — no lift here).
        list: { type: 'grid', columns: ['name'], exportOptions: ['xlsx', 'pdf'] },
        listViews: {
          // Object spelling: 'pdf' leaves `formats`; the sibling keys survive.
          archive: {
            type: 'grid',
            columns: ['name'],
            exportOptions: { formats: ['csv', 'pdf'], maxRecords: 100 },
          },
          // No 'pdf' declared → untouched.
          all: { type: 'grid', columns: ['name'], exportOptions: ['csv', 'json'] },
        },
      }],
    },
    after: {
      views: [{
        object: 'crm_contract',
        list: { type: 'grid', columns: ['name'], exportOptions: ['xlsx'] },
        listViews: {
          archive: {
            type: 'grid',
            columns: ['name'],
            exportOptions: { formats: ['csv'], maxRecords: 100 },
          },
          all: { type: 'grid', columns: ['name'], exportOptions: ['csv', 'json'] },
        },
      }],
    },
    expectedNotices: 2,
  },
};

/** dashboard.aria / dashboard.performance / widgets[].performance. */
const dashboardInertKeysRemoved: MetadataConversion = {
  id: 'dashboard-inert-keys-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'dashboard.aria / dashboard.performance / dashboard.widgets[].performance',
  summary: "dashboard keys 'aria'/'performance' and widget 'performance' removed (#3896 close-out — no renderer applied any of them)",
  apply(stack, emit) {
    return mapCollection(stack, 'dashboards', (d, path) => {
      let next = stripKeys(d, ['aria', 'performance'], emit, path);
      const widgets = next.widgets;
      if (Array.isArray(widgets)) {
        let subTouched = false;
        const rebuilt = widgets.map((w, i) => {
          if (w && typeof w === 'object' && !Array.isArray(w) && 'performance' in w) {
            const cleaned = { ...(w as Record<string, unknown>) };
            delete cleaned.performance;
            emit({ from: 'performance', to: '(removed)', path: `${path}.widgets[${i}].performance` });
            subTouched = true;
            return cleaned;
          }
          return w;
        });
        if (subTouched) {
          next = next === d ? { ...d } : next;
          next.widgets = rebuilt;
        }
      }
      return next;
    });
  },
  fixture: {
    before: {
      dashboards: [{
        name: 'sales_kpis',
        aria: { label: 'Sales' },
        performance: { lazyLoad: true },
        widgets: [{ id: 'w1', type: 'kpi', dataset: 'orders', values: ['total'], performance: { prefetch: true } }],
      }],
    },
    after: {
      dashboards: [{
        name: 'sales_kpis',
        widgets: [{ id: 'w1', type: 'kpi', dataset: 'orders', values: ['total'] }],
      }],
    },
    expectedNotices: 3,
  },
};

/**
 * dashboard.widgets[].responsive (#4876) — the same-named `view.responsive`
 * went in the #3896 close-out above; this one escaped that sweep through a
 * liveness drill gap rather than on evidence (`dashboard.json` declares no
 * `children` on `widgets`, so no widget-level key was ever classified — filed
 * as #4956). Re-measured 2026-08-03: no objectui code reads
 * `widget.responsive`, and zero authored instances exist repo-wide.
 *
 * Deliberately a SEPARATE entry rather than another key on
 * `dashboard-inert-keys-removed`: that entry's identity is the #3896 sweep, and
 * folding a differently-evidenced removal into it would misattribute this one
 * in `spec-changes.json` and the upgrade guide — the two places an upgrading
 * author actually reads. Both are `toMajor: 17`, so a stored dashboard carrying
 * both keys is cleaned by both in one replay.
 *
 * Strips ONLY the widget embed. The shared `ResponsiveConfig` shape is
 * untouched and still live on `page.components[].responsive`.
 */
const dashboardWidgetResponsiveRemoved: MetadataConversion = {
  id: 'dashboard-widget-responsive-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'dashboard.widgets[].responsive',
  summary: "dashboard widget key 'responsive' removed (#4876 — no renderer ever applied per-widget breakpoint overrides; page.components[].responsive is unaffected)",
  apply(stack, emit) {
    return mapCollection(stack, 'dashboards', (d, path) => {
      const widgets = d.widgets;
      if (!Array.isArray(widgets)) return d;
      let touched = false;
      const rebuilt = widgets.map((w, i) => {
        if (!w || typeof w !== 'object' || Array.isArray(w)) return w;
        const cleaned = stripKeys(w as Record<string, unknown>, ['responsive'], emit, `${path}.widgets[${i}]`);
        if (cleaned !== w) touched = true;
        return cleaned;
      });
      if (!touched) return d;
      return { ...d, widgets: rebuilt };
    });
  },
  fixture: {
    before: {
      dashboards: [{
        name: 'ops_overview',
        widgets: [{
          id: 'w1', type: 'kpi', dataset: 'orders', values: ['total'],
          responsive: { columns: { xs: 12, lg: 4 }, order: { xs: 2, lg: 1 }, hiddenOn: ['xs'] },
        }],
      }],
    },
    after: {
      dashboards: [{
        name: 'ops_overview',
        widgets: [{ id: 'w1', type: 'kpi', dataset: 'orders', values: ['total'] }],
      }],
    },
    expectedNotices: 1,
  },
};

/**
 * dashboard.widgets[].actionUrl / actionType / actionIcon / aria (#5010) — the
 * four widget-level keys the #4956 drill judged dead on a closed call graph.
 *
 * Two affordances, one removal, because both fail the same way and an upgrading
 * source carries them together:
 *
 *   - the action TRIO described a per-widget button. No renderer in either repo
 *     draws one; every action a dashboard dispatches comes from
 *     `header.actions[]`. Its only reader was `packages/lint`'s reference-
 *     integrity rule, which failed builds when a button that cannot render
 *     pointed at an action that did not exist — that widget branch is deleted in
 *     the same change.
 *   - `aria` promised ARIA attributes that never reached the DOM: the same false
 *     compliance the DASHBOARD-level `aria` was retired for above, one level
 *     down. `dashboard-inert-keys-removed` took the parent key in the #3896
 *     sweep and left this one, because `widgets` had no ledger drill then.
 *
 * A SEPARATE entry rather than more keys on `dashboard-inert-keys-removed`, for
 * the reason `dashboard-widget-responsive-removed` gives just above: that entry's
 * identity is the #3896 sweep, and folding a differently-evidenced removal into
 * it would misattribute this one in `spec-changes.json` and the upgrade guide —
 * the two places an upgrading author actually reads. All are `toMajor: 17`, so a
 * stored dashboard carrying keys from several of them is cleaned in one replay.
 *
 * `colorVariant`, the fifth key #5010 lists, is deliberately NOT here — and the
 * reason has since been SETTLED, in the other direction. When this entry was
 * written its disposition was open: the rewrite target its triage assumed,
 * `options.colorVariant`, measured dead on the ADR-0021 dataset path too, and
 * 16 authored sites depended on the answer. #5010 ruling B answered ENFORCE —
 * the declaration stays and objectui implements it — which objectui#3359 /
 * PR objectui#3799 did, absorbed here by the `.objectui-sha` pin `09987b68`.
 * The key is `live` in `liveness/dashboard.json` as of #6774, so nothing is
 * owed: no retirement, no later entry. Read this paragraph as "not being
 * removed", not as "not removed yet".
 */
const dashboardWidgetActionAriaRemoved: MetadataConversion = {
  id: 'dashboard-widget-action-aria-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface:
    'dashboard.widgets[].actionUrl / dashboard.widgets[].actionType / '
    + 'dashboard.widgets[].actionIcon / dashboard.widgets[].aria',
  summary:
    "dashboard widget keys 'actionUrl'/'actionType'/'actionIcon' and 'aria' removed "
    + '(#5010 — no renderer ever drew a per-widget action button, and widget ARIA attributes never '
    + 'reached the DOM; use header.actions[] and the widget title/description)',
  apply(stack, emit) {
    return mapCollection(stack, 'dashboards', (d, path) => {
      const widgets = d.widgets;
      if (!Array.isArray(widgets)) return d;
      let touched = false;
      const rebuilt = widgets.map((w, i) => {
        if (!w || typeof w !== 'object' || Array.isArray(w)) return w;
        const cleaned = stripKeys(
          w as Record<string, unknown>,
          ['actionUrl', 'actionType', 'actionIcon', 'aria'],
          emit,
          `${path}.widgets[${i}]`,
        );
        if (cleaned !== w) touched = true;
        return cleaned;
      });
      if (!touched) return d;
      return { ...d, widgets: rebuilt };
    });
  },
  fixture: {
    before: {
      dashboards: [{
        name: 'ops_overview',
        widgets: [{
          id: 'w1', type: 'kpi', dataset: 'orders', values: ['total'],
          actionUrl: 'export_dashboard_pdf',
          actionType: 'script',
          actionIcon: 'download',
          aria: { ariaLabel: 'Total orders' },
        }],
      }],
    },
    after: {
      dashboards: [{
        name: 'ops_overview',
        widgets: [{ id: 'w1', type: 'kpi', dataset: 'orders', values: ['total'] }],
      }],
    },
    // One notice per KEY, not per widget — four keys on one widget.
    expectedNotices: 4,
  },
};

/**
 * dashboard.widgets[].compareTo (#5011) — a VOCABULARY convergence, not a
 * removal: the widget's three declared arms are replaced by the one shape the
 * analytics executor implements, `{ kind, dimension? }`
 * (`DatasetSelection.compareTo`).
 *
 * Why a conversion rather than a plain tombstone: two of the three arms have an
 * exact target, so leaving them for the author to retype would be make-work on
 * a rewrite a machine can prove.
 *
 *   'previousPeriod'   → { kind: 'previousPeriod' }   value verbatim, container changed
 *   'previousYear'     → { kind: 'previousYear' }     value verbatim, container changed
 *   { offset: '1y' }   → { kind: 'previousYear' }     '1y' IS previousYear, by definition
 *
 * `dimension` is deliberately NOT synthesised. The conversion sees a stack, not
 * a dataset — it cannot know which time dimension carries the window — and it
 * does not need to: `dimension` is optional precisely so the executor can
 * resolve it (one dated candidate) or refuse loudly (zero, or several). Writing
 * a guess here would convert a loud runtime error into a wrong comparison.
 *
 * Every OTHER `{ offset }` (`'7d'`, `'1M'`, `'2w'`, …) is left UNTOUCHED, on
 * purpose. There is no faithful target: `previousPeriod` shifts by the resolved
 * window's own length, which equals `7d` only when the window happens to be
 * seven days. Rewriting it would silently change which rows the comparison
 * column counts — the failure class this issue exists to end. So the source
 * keeps the key, the strict schema rejects it with `COMPARE_TO_OFFSET_RETIRED`
 * (which prescribes kind + filter-window), and the residue is declared as the
 * `dashboard-widget-compareto-offset` semantic migration.
 *
 * Measured before writing (#5011's adjudication asked for stored/authored
 * instances first): repo-wide, four authored instances, all of them the string
 * form, all in `examples/app-crm`; ZERO `{ offset }` instances in either repo.
 * Expected — a canonical-path author who tried `{ offset }` got a thrown widget,
 * so it could never accumulate there.
 *
 * `retiredFromLoadPath: true`: the old spellings get NO acceptance window. An
 * auto-converting loader would let `compareTo: 'previousPeriod'` keep parsing
 * clean, which is the lenient-consumer shape PD #12 forbids and the exact
 * dynamic that let the widget and executor vocabularies drift apart unnoticed
 * for a whole major. Stored `sys_metadata` rows are still covered — every
 * rehydration seam replays retired entries via `applyConversionsToStoredItem`
 * (#3903).
 */
const dashboardWidgetCompareToConverged: MetadataConversion = {
  id: 'dashboard-widget-compareto-converged',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'dashboard.widgets[].compareTo',
  summary:
    "dashboard widget 'compareTo' converged on the executor's { kind, dimension? } contract "
    + "(#5011 — the bare strings and { offset: '1y' } rewrite mechanically; other { offset } "
    + 'durations have no faithful target and are reported, not guessed)',
  apply(stack, emit) {
    return mapCollection(stack, 'dashboards', (d, path) => {
      const widgets = d.widgets;
      if (!Array.isArray(widgets)) return d;
      let touched = false;
      const rebuilt = widgets.map((w, i) => {
        if (!w || typeof w !== 'object' || Array.isArray(w)) return w;
        const widget = w as Record<string, unknown>;
        if (!('compareTo' in widget)) return w;
        const cmp = widget.compareTo;
        const at = `${path}.widgets[${i}].compareTo`;

        // Arm 1/2 — the bare string form. The value survives verbatim.
        if (cmp === 'previousPeriod' || cmp === 'previousYear') {
          emit({ from: `'${cmp}'`, to: `{ kind: '${cmp}' }`, path: at });
          touched = true;
          return { ...widget, compareTo: { kind: cmp } };
        }

        // Arm 3 — `{ offset }`, and only the one duration with an exact target.
        if (cmp && typeof cmp === 'object' && !Array.isArray(cmp)) {
          const offset = (cmp as Record<string, unknown>).offset;
          if (offset === '1y') {
            emit({ from: "{ offset: '1y' }", to: "{ kind: 'previousYear' }", path: at });
            touched = true;
            return { ...widget, compareTo: { kind: 'previousYear' } };
          }
        }
        return w;
      });
      if (!touched) return d;
      return { ...d, widgets: rebuilt };
    });
  },
  fixture: {
    before: {
      dashboards: [{
        name: 'revenue_review',
        widgets: [
          { id: 'w1', type: 'kpi', dataset: 'orders', values: ['total'], compareTo: 'previousPeriod' },
          { id: 'w2', type: 'kpi', dataset: 'orders', values: ['total'], compareTo: 'previousYear' },
          { id: 'w3', type: 'kpi', dataset: 'orders', values: ['total'], compareTo: { offset: '1y' } },
        ],
      }],
    },
    after: {
      dashboards: [{
        name: 'revenue_review',
        widgets: [
          { id: 'w1', type: 'kpi', dataset: 'orders', values: ['total'], compareTo: { kind: 'previousPeriod' } },
          { id: 'w2', type: 'kpi', dataset: 'orders', values: ['total'], compareTo: { kind: 'previousYear' } },
          { id: 'w3', type: 'kpi', dataset: 'orders', values: ['total'], compareTo: { kind: 'previousYear' } },
        ],
      }],
    },
    expectedNotices: 3,
  },
};

/**
 * agent.knowledge — a grounding claim nothing enforced (the RAG path reads
 * `sourceIds` from the LLM's tool-call arguments, never the agent record).
 * Absorbs the former `agent-knowledge-topics-to-sources` rename (#3855):
 * both spellings of the block end deleted, in one notice.
 */
const agentKnowledgeRemoved: MetadataConversion = {
  id: 'agent-knowledge-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'agent.knowledge',
  summary: "agent key 'knowledge' removed (#3896 close-out — declaring sources/indexes never scoped retrieval; restrict at the knowledge-service level)",
  apply(stack, emit) {
    return mapCollection(stack, 'agents', (a, path) => stripKeys(a, ['knowledge'], emit, path));
  },
  fixture: {
    before: { agents: [{ name: 'support_agent', label: 'Support', knowledge: { sources: ['faq'], indexes: ['docs'] } }] },
    after: { agents: [{ name: 'support_agent', label: 'Support' }] },
    expectedNotices: 1,
  },
};

/** skill.triggerPhrases — phrases were never matched against the user's message. */
const skillTriggerPhrasesRemoved: MetadataConversion = {
  id: 'skill-trigger-phrases-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'skill.triggerPhrases',
  summary: "skill key 'triggerPhrases' removed (#3896 close-out — activation is triggerConditions + the agent's skills[] allowlist; phrases were a dead-end projection)",
  apply(stack, emit) {
    return mapCollection(stack, 'skills', (sk, path) => stripKeys(sk, ['triggerPhrases'], emit, path));
  },
  fixture: {
    before: { skills: [{ name: 'case_mgmt', label: 'Cases', triggerPhrases: ['open a ticket'] }] },
    after: { skills: [{ name: 'case_mgmt', label: 'Cases' }] },
    expectedNotices: 1,
  },
};

/**
 * All conversions, keyed by the protocol major that introduced the canonical
 * shape. Newest majors last; ordering within a major is application order.
 */
/**
 * Stack `api.requireAuth` → dropped (protocol 17, #3963).
 *
 * NOT a rename — there is no key to move the value to. The deployment-wide
 * anonymous-access opt-out is retired: auth is a kernel concern, and anonymous
 * access to object data is now always denied. A surface that legitimately
 * serves a session-less caller derives its own narrow authorization from a
 * declaration (a public form view, a share link, or `book.audience: 'public'`),
 * so there is nothing for the old boolean to control.
 *
 * Dropping is safe at load time: the runtime no longer reads the key (its
 * plumbing was removed in the same change), so a surviving `api.requireAuth`
 * would otherwise be silently stripped by the non-strict schema — the exact
 * quiet-failure this conversion + the `retiredKey` tombstone exist to prevent.
 * The notice tells the author their intent was dropped and where to re-declare
 * public access.
 */
const stackApiRequireAuthRemoved: MetadataConversion = {
  id: 'stack-api-require-auth-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'stack.api.requireAuth',
  summary: "stack key 'api.requireAuth' removed — anonymous access is always denied; publish public surfaces by declaration (#3963)",
  apply(stack, emit) {
    const api = stack.api;
    if (!isDict(api) || !('requireAuth' in api)) return stack;
    const nextApi: Dict = { ...api };
    delete nextApi.requireAuth;
    emit({ from: 'requireAuth', to: '(removed)', path: 'api' });
    return { ...stack, api: nextApi };
  },
  fixture: {
    before: {
      api: { requireAuth: false, enableProjectScoping: false },
    },
    after: {
      api: { enableProjectScoping: false },
    },
    expectedNotices: 1,
  },
};

/**
 * `waitEventConfig.timeoutMs` / `.onTimeout` removed — `wait` never had a timeout
 * (protocol 17, #4158).
 *
 * Both keys described a timeout and neither delivered one. `onTimeout` had **zero**
 * readers: no path ever inspected it, so neither `'fail'` nor `'continue'` ever
 * happened, and its `.default('fail')` stamped a decision nothing made onto every
 * wait node. `timeoutMs` said "maximum wait time" while its only reader used it as
 * the timer *duration* when `timerDuration` was absent — it did something, just not
 * what it claimed.
 *
 * **Retired from the load path**, like every other key retired for lying rather than
 * for being renamed (`api.requireAuth`, the tool/app/flow inert keys, RLS `priority`).
 * The distinction the registry draws: a key that was merely *renamed* keeps a load
 * window, because punishing an author for a spelling nobody warned them about is
 * pointless. A key that **misdescribed itself** does not — silently absorbing it
 * would let the author keep believing they configured a timeout. The chain converts
 * it mechanically; the schema tombstone tells them what actually happened.
 *
 * `timeoutMs` moves to `timerDuration` rather than being dropped, because that IS
 * what it did. It is stringified on the way: `timerDuration` is `z.string()` while
 * `timeoutMs` was `z.number()`, and `parseIsoDuration` reads a bare numeric string as
 * milliseconds — so `timeoutMs: 60000` and `timerDuration: '60000'` are the same
 * wait. Moving the number unstringified would produce a block that no longer parses.
 * With `timerDuration` already set it is dropped instead: the executor's `??` never
 * looked past the duration, so it was already dead metadata.
 */
function removeWaitTimeoutKeys(stack: Dict, emit: Emit): Dict {
  // Deliberately not filtered to `node.type === 'wait'`: the tombstones live on the
  // block, so a non-wait node carrying one would fail to parse and never be cleaned.
  return mapFlowNodes(stack, (node, path) => {
    const wec = node.waitEventConfig;
    if (!isDict(wec)) return node;
    const next: Dict = { ...wec };
    let changed = false;

    if (next.timeoutMs != null) {
      if (next.timerDuration == null) {
        next.timerDuration = String(next.timeoutMs);
        emit({ from: 'waitEventConfig.timeoutMs', to: 'waitEventConfig.timerDuration', path: `${path}.waitEventConfig.timerDuration` });
      } else {
        emit({ from: 'waitEventConfig.timeoutMs', to: '(removed — `timerDuration` already set, so it was never read)', path: `${path}.waitEventConfig` });
      }
      delete next.timeoutMs;
      changed = true;
    }
    if (next.onTimeout != null) {
      emit({ from: 'waitEventConfig.onTimeout', to: '(removed — no reader ever existed)', path: `${path}.waitEventConfig` });
      delete next.onTimeout;
      changed = true;
    }
    return changed ? { ...node, waitEventConfig: next } : node;
  });
}

const flowNodeWaitTimeoutKeysRemoved: MetadataConversion = {
  id: 'flow-node-wait-timeout-keys-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'flow.node.waitEventConfig',
  summary:
    "waitEventConfig keys 'timeoutMs' (→ 'timerDuration', stringified — its only reader used it as the duration) " +
    "and 'onTimeout' (removed — zero readers, so no timeout ever fired) (#4158)",
  apply(stack, emit) {
    return removeWaitTimeoutKeys(stack, emit);
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'settlement',
          nodes: [
            { id: 'n1', type: 'start' },
            // The shape that actually did something: `timeoutMs` standing in for a
            // duration. It must survive as a working wait, hence the move.
            { id: 'n2', type: 'wait', waitEventConfig: { eventType: 'timer', timeoutMs: 60000, onTimeout: 'continue' } },
            // `timerDuration` already set → `timeoutMs` was dead; dropped, not moved.
            {
              id: 'n3',
              type: 'wait',
              waitEventConfig: { eventType: 'timer', timerDuration: 'PT5M', timeoutMs: 999 },
            },
            // Nothing retired here — left byte-identical.
            { id: 'n4', type: 'wait', waitEventConfig: { eventType: 'signal', signalName: 'paid' } },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'settlement',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'wait', waitEventConfig: { eventType: 'timer', timerDuration: '60000' } },
            { id: 'n3', type: 'wait', waitEventConfig: { eventType: 'timer', timerDuration: 'PT5M' } },
            { id: 'n4', type: 'wait', waitEventConfig: { eventType: 'signal', signalName: 'paid' } },
          ],
        },
      ],
    },
    // n2: `timeoutMs` moved + `onTimeout` dropped. n3: `timeoutMs` dropped (shadowed).
    expectedNotices: 3,
  },
};

/**
 * The remaining inert datasource blocks removed (protocol 17, #4583 B/C/D).
 *
 * Three clusters, one finding each — declared, `.strict()`-guarded, read by no
 * runtime path:
 *
 *  - `retryPolicy` (4 keys): no connect or query path ever retried on it.
 *    Connection failure is the boot policy in the datasource connection service
 *    (degraded boot / `bootCritical` fail-fast), which does not retry on a
 *    schedule.
 *  - `healthCheck` (3 keys): nothing scheduled a probe, so `enabled` enabled
 *    nothing and the timeouts bounded nothing. Liveness is probed ON DEMAND via
 *    the driver handle's `ping()` / `checkHealth()`.
 *  - `external.label` / `external.requirePermission`: the federation block's own
 *    label was never read (the top-level `label` is what Setup renders), and no
 *    authorization check ever consulted the permission — naming one gated
 *    nothing, which is the false-compliance shape ADR-0049 removes.
 *
 * `retryPolicy` is the one with a booby trap, and it is a NAME collision rather
 * than a behaviour question: `hook.retryPolicy` and `job.retryPolicy` ARE
 * enforced. They are different keys on different types and spell the delay
 * `backoffMs`, not `baseDelayMs` — which is itself the evidence nothing read
 * the datasource one, since no code reads both spellings. The conversion
 * therefore touches ONLY `datasources`, and the schema's rejection message
 * spells the distinction out rather than offering a rename.
 *
 * `retiredFromLoadPath`: every affected shape is `.strict()` and rejects with
 * its prescription (`RETIRED_DATASOURCE_BLOCKS`).
 */
const datasourceInertBlocksRemoved: MetadataConversion = {
  id: 'datasource-inert-blocks-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'datasource.retryPolicy / datasource.healthCheck / datasource.external.label / datasource.external.requirePermission',
  summary: "datasource keys 'retryPolicy'/'healthCheck' and external 'label'/'requirePermission' removed (#4583 — nothing retried, nothing probed on a schedule, and the federation label/permission were read by nobody)",
  apply(stack, emit) {
    return mapCollection(stack, 'datasources', (ds, path) => {
      const next = stripKeys(ds, ['retryPolicy', 'healthCheck'], emit, path);
      // `external.*` sits one level down, so stripKeys (top-level only) cannot
      // reach it — drill in, and copy-on-write so an untouched datasource keeps
      // its identity for the caller's change detection.
      const external = next.external;
      if (!external || typeof external !== 'object' || Array.isArray(external)) return next;
      const strippedExternal = stripKeys(
        external as Record<string, unknown>,
        ['label', 'requirePermission'],
        emit,
        `${path}.external`,
      );
      if (strippedExternal === external) return next;
      return { ...next, external: strippedExternal };
    });
  },
  fixture: {
    before: {
      datasources: [{
        name: 'warehouse',
        driver: 'postgres',
        config: { host: 'db.internal', database: 'analytics' },
        healthCheck: { enabled: true, intervalMs: 30000, timeoutMs: 5000 },
        retryPolicy: { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000, backoffMultiplier: 2 },
        schemaMode: 'external',
        external: {
          label: 'Warehouse — ANALYTICS / PROD',
          allowWrites: false,
          requirePermission: 'analytics_admin',
        },
      }],
    },
    // Four notices: one per removed key, counting the two nested ones.
    after: {
      datasources: [{
        name: 'warehouse',
        driver: 'postgres',
        config: { host: 'db.internal', database: 'analytics' },
        schemaMode: 'external',
        external: { allowWrites: false },
      }],
    },
    expectedNotices: 4,
  },
};

/**
 * `mapping.extractQuery` / `errorPolicy` / `batchSize` removed (protocol 17,
 * #4509, ADR-0049).
 *
 * Three keys on the import/export mapping artifact that parsed, stored, and
 * controlled nothing:
 *
 * - `extractQuery` — "Query to run for export only" against an export path that
 *   does not exist: no exporter reads a mapping artifact at all. A whole
 *   `QuerySchema` subtree hung off it, which is what made it read as a designed
 *   feature rather than an aspiration.
 * - `errorPolicy` — `skip` / `abort` / `retry` selecting between three
 *   behaviours that were one behaviour. Error handling on the import path is
 *   the import REQUEST's own options; nothing consults the mapping.
 * - `batchSize` — the write path sizes its own batches and never asked.
 *
 * Two of the three were **unwarnable**, which is why they went out now rather
 * than after a deprecation window: `errorPolicy` and `batchSize` carried schema
 * defaults, and a default materialises at parse time, so the liveness advisory
 * lint could not distinguish an authored value from a supplied one
 * (`_authorWarnSkipped` in `liveness/mapping.json`). For a key in that state,
 * removal is not the escalation after a warning — it is the only channel that
 * ever reaches the author.
 *
 * `batchSize` is also the name most likely to be "fixed" by relocation, so the
 * schema prescription says outright that `bulkActionDef` / `connector` / `sync`
 * / `offline` / seed-loader / NoSQL-cursor `batchSize` are live and are all
 * different keys sizing different paths. Same shape as the `retryPolicy` /
 * `backoffMs` trap #4583 had to defuse on `datasource`.
 *
 * `retiredFromLoadPath`: the schema is `.strict()`, so the keys are gone from
 * the shape and rejected with a `guidance` prescription rather than tombstoned.
 */
const mappingInertKeysRemoved: MetadataConversion = {
  id: 'mapping-inert-keys-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'mapping.extractQuery / mapping.errorPolicy / mapping.batchSize',
  summary: "mapping keys 'extractQuery'/'errorPolicy'/'batchSize' removed (#4509 — no exporter reads a mapping, error handling belongs to the import request, and the write path sizes its own batches)",
  apply(stack, emit) {
    const RETIRED = ['extractQuery', 'errorPolicy', 'batchSize'];
    // Scoped to the `mappings` collection deliberately: `batchSize` is live on
    // connector, sync, bulk-action and offline shapes, and a stack-wide strip
    // would delete an enforced key from all of them.
    return mapCollection(stack, 'mappings', (m, path) => stripKeys(m, RETIRED, emit, path));
  },
  fixture: {
    before: {
      mappings: [{
        name: 'csv_import_contacts',
        targetObject: 'contact',
        fieldMapping: [{ source: 'Email', target: 'email' }],
        extractQuery: { object: 'contact', fields: ['email'] },
        errorPolicy: 'abort',
        batchSize: 500,
      }],
    },
    after: {
      mappings: [{
        name: 'csv_import_contacts',
        targetObject: 'contact',
        fieldMapping: [{ source: 'Email', target: 'email' }],
      }],
    },
    expectedNotices: 3,
  },
};

/**
 * Inline book translation maps removed (protocol 17, #4667, ADR-0049).
 *
 * `book.translations` and `book.groups[].translations` were parsed, stored and
 * round-tripped, and read by nothing: the tree endpoint and the docs portal
 * render `label` / `description` verbatim, and the generic bundle translator
 * covers view / action / object / app / dashboard / page only. A localized book
 * therefore shipped its authoring-locale strings to every reader.
 *
 * The trap was PROXIMITY: `doc.translations` — same name, same shape, two files
 * over — is live on every doc render path, so the book-level map read as the
 * same feature one level up.
 *
 * Split routes, because the two schemas differ: `BookSchema` is `strictObject`
 * (key deleted, `guidance` carries the prescription, ledger row deleted), while
 * `BookGroupSchema` is a plain `z.object` with no `.strict()` — a bare delete
 * there would have zod silently strip the key, so it is tombstoned with
 * `retiredKey` and its ledger row STAYS.
 */
const bookTranslationsRemoved: MetadataConversion = {
  id: 'book-translations-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'book.translations / book.groups.translations',
  summary: "book keys 'translations' (book-level and group-level) removed (#4667 — no resolver read them; the tree endpoint and portal render labels verbatim, so a localized book served its authoring locale to everyone). Localize the docs instead: `doc.translations` is live",
  apply(stack, emit) {
    return mapCollection(stack, 'books', (book, path) => {
      const next = stripKeys(book, ['translations'], emit, path);
      const groups = next.groups;
      if (!Array.isArray(groups)) return next;
      let touched = false;
      const mapped = groups.map((g, i) => {
        if (!g || typeof g !== 'object' || Array.isArray(g)) return g;
        const stripped = stripKeys(
          g as Record<string, unknown>,
          ['translations'],
          emit,
          `${path}.groups[${i}]`,
        );
        if (stripped !== g) touched = true;
        return stripped;
      });
      return touched ? { ...next, groups: mapped } : next;
    });
  },
  fixture: {
    before: {
      books: [{
        name: 'crm_guide',
        label: 'CRM Guide',
        translations: { 'zh-CN': { label: 'CRM 指南' } },
        groups: [{
          key: 'basics',
          label: 'Basics',
          translations: { 'zh-CN': { label: '基础' } },
        }],
      }],
    },
    after: {
      books: [{
        name: 'crm_guide',
        label: 'CRM Guide',
        groups: [{ key: 'basics', label: 'Basics' }],
      }],
    },
    // Two notices: the book-level map and the one on its single group.
    expectedNotices: 2,
  },
};

/**
 * `job.id` removed (protocol 17, #4667, ADR-0049).
 *
 * Nothing read it, and its own `describe()` — "defaults to `name` when omitted"
 * — advertised an identity override that never existed. `name` is the identity
 * at every layer that has one: the scheduling key, the `sys_job` row key (the
 * DB adapter upserts by `name` and mints its own row id), and the
 * `JobExecution.jobId` stamp. Two jobs differing only in `id` were never two
 * jobs — they were one job declared twice.
 */
const jobIdRemoved: MetadataConversion = {
  id: 'job-id-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'job.id',
  summary: "job key 'id' removed (#4667 — nothing read it; `name` is the job's identity everywhere, so two jobs differing only in `id` were the same job, and the key's own description advertised an override that did not exist)",
  apply(stack, emit) {
    return mapCollection(stack, 'jobs', (job, path) => stripKeys(job, ['id'], emit, path));
  },
  fixture: {
    before: {
      jobs: [{
        name: 'nightly_sync',
        id: 'job_nightly',
        schedule: { type: 'cron', expression: '0 0 * * *' },
        handler: 'syncAll',
      }],
    },
    after: {
      jobs: [{
        name: 'nightly_sync',
        schedule: { type: 'cron', expression: '0 0 * * *' },
        handler: 'syncAll',
      }],
    },
    expectedNotices: 1,
  },
};

/**
 * `translation.validationMessages` removed (protocol 17, #4667, ADR-0049).
 *
 * A translation group with no reader — objectui's spec-translations transform
 * passed it through to the client tree and nothing downstream consumed it. The
 * platform's own signature was on it twice: the schema example showed a
 * concrete override, and #3778's legacy-key migration table steered retired
 * `errors:` authors straight into it. Retiring one dead key by pointing authors
 * at another is the failure this conversion also fixes — that guidance entry is
 * rewritten in the same change to say rule messages are authored on the rule
 * (`object.validations[].message`), not translated through a group.
 *
 * Removed from the shared `translationDataShape()`, so it retires at BOTH doors
 * at once — the bundle entry and the registered item. #3778's original guard
 * ran on the item door only, which is exactly how the key survived this long in
 * file-authored bundles.
 */
const translationValidationMessagesRemoved: MetadataConversion = {
  id: 'translation-validation-messages-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'translation.validationMessages',
  summary: "translation key 'validationMessages' removed (#4667 — no resolver read it, so a translated rule message was stored and never shown; #3778's migration table had been steering retired `errors:` authors into it). Author the message on the rule itself (`object.validations[].message`)",
  apply(stack, emit) {
    return mapCollection(stack, 'translations', (t, path) =>
      stripKeys(t, ['validationMessages'], emit, path));
  },
  fixture: {
    before: {
      translations: [{
        name: 'zh_cn',
        locale: 'zh-CN',
        validationMessages: { discount_limit: '折扣不能超过40%' },
        messages: { 'common.save': '保存' },
      }],
    },
    after: {
      translations: [{
        name: 'zh_cn',
        locale: 'zh-CN',
        messages: { 'common.save': '保存' },
      }],
    },
    expectedNotices: 1,
  },
};

/**
 * `datasource.capabilities` removed (protocol 17, #4583).
 *
 * Eleven boolean flags, declared and strict-guarded, read by nothing. Pushdown
 * is decided by the runtime driver's own `supports.*` object — a different
 * mechanism entirely — so a datasource declaring `queryAggregations: false`
 * never once changed which engine path ran.
 *
 * `readOnly` is why this one is not merely tidy-up. It reads as a safety
 * property and was authored as one: the shipped CRM example labelled a
 * datasource "Read Replica" on the strength of it, while the datasource
 * accepted writes exactly like the primary. The key had already been MOVED
 * twice toward somewhere it might be enforced — out of `config` in #4410, into
 * `capabilities` in #4465 — and was inert at every address. This removes it
 * instead of moving it a third time.
 *
 * Deliberately NOT converted to `external.allowWrites: false`, which is the
 * enforced gate and the obvious-looking target: it applies only to FEDERATED
 * datasources (`schemaMode` other than `managed`), so rewriting a managed
 * datasource that way would produce a key that is equally inert for that author
 * — the exact defect being retired, laundered through a migration. A managed
 * datasource has no read-only gate at all (#4584); the honest conversion is a
 * delete plus a rejection message that says so.
 *
 * `retiredFromLoadPath`: both shapes are `.strict()` and reject the key with
 * its prescription (`RETIRED_CAPABILITIES`).
 */
const datasourceCapabilitiesRemoved: MetadataConversion = {
  id: 'datasource-capabilities-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'datasource.capabilities',
  summary: "datasource key 'capabilities' removed (#4583 — eleven flags no code read; pushdown comes from the driver's own supports.*, and `readOnly` never made anything read-only)",
  apply(stack, emit) {
    return mapCollection(stack, 'datasources', (ds, path) => stripKeys(ds, ['capabilities'], emit, path));
  },
  fixture: {
    before: {
      datasources: [{
        name: 'analytics',
        driver: 'sqlite',
        config: { filename: ':memory:' },
        capabilities: { readOnly: true, queryAggregations: true },
      }],
    },
    // One notice per datasource, not per flag: the block is what was removed.
    after: {
      datasources: [{
        name: 'analytics',
        driver: 'sqlite',
        config: { filename: ':memory:' },
      }],
    },
    expectedNotices: 1,
  },
};

/**
 * `datasource.readReplicas` — replica connections nothing ever opened (#4468).
 *
 * A lossless delete, and an unusually clear one: read/write splitting does not
 * exist anywhere in the platform. `ConnectableDatasource` and
 * `DatasourceConnectionSpec` carry no replicas field, the driver factory never
 * reads the key, and no query path distinguishes a read from a write — so every
 * statement always went to the primary regardless of what was declared here.
 *
 * Retired from the load path like every other key retired for *lying* rather
 * than for being renamed. The distinction the registry draws (see
 * `flow-node-wait-timeout-keys-removed`): a merely renamed key keeps a load
 * window, because punishing an author for a spelling nobody warned them about
 * is pointless. A key that misdescribed itself does not — silently absorbing it
 * would let the author keep believing they had configured replica reads.
 *
 * Worth recording *why* this needed a conversion at all rather than passing
 * unnoticed: #4410 had just taught the schema to validate each entry against the
 * declared driver's config contract. Sources written between #4410 and here
 * carry replica blocks that were *checked* — precise host names, correct port
 * types, no typos — which is exactly the shape an author trusts most. The
 * notice is what tells them the well-formed thing they wrote was never wired to
 * anything.
 */
const datasourceReadReplicasRemoved: MetadataConversion = {
  id: 'datasource-read-replicas-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'datasource.readReplicas',
  summary: "datasource key 'readReplicas' removed (#4468 — no driver opened a replica connection and no query path splits reads from writes; front replicas behind one endpoint and point `config` at it)",
  apply(stack, emit) {
    return mapCollection(stack, 'datasources', (ds, path) => stripKeys(ds, ['readReplicas'], emit, path));
  },
  fixture: {
    before: {
      datasources: [{
        name: 'warehouse',
        driver: 'postgres',
        config: { host: 'primary.internal', port: 5432, database: 'analytics' },
        readReplicas: [
          { host: 'replica-a.internal', port: 5432, database: 'analytics' },
          { host: 'replica-b.internal', port: 5432, database: 'analytics' },
        ],
      }],
    },
    // One notice per datasource, not per replica: the key is what was removed.
    after: {
      datasources: [{
        name: 'warehouse',
        driver: 'postgres',
        config: { host: 'primary.internal', port: 5432, database: 'analytics' },
      }],
    },
    expectedNotices: 1,
  },
};

/**
 * The legacy `datasource.config` spellings the driver factory used to read via
 * undeclared `??` fallbacks, per canonical driver id — exactly the set that
 * HAPPENED TO WORK before #4456, nothing more.
 *
 * Deliberately narrower than the schemas' rename-hint alias tables: an alias
 * that only ever produced a rejection hint (`path:`, `dsn:`, `hostname:`, …)
 * never worked at run time, so "converting" it would CHANGE behaviour — e.g. a
 * stored sqlite `path:` fell back to `:memory:`, and rewriting it to
 * `filename` would silently move the database. D2 scope guard: lossless and
 * behaviour-preserving only.
 *
 * Driver-awareness is load-bearing: `database` means "rename to `filename`"
 * ONLY under sqlite — for postgres/mysql/mongo it is a canonical key and must
 * not be touched.
 */
const DATASOURCE_CONFIG_KEY_ALIASES: Readonly<
  Partial<Record<BuiltinDriverId, ReadonlyArray<readonly [from: string, to: string]>>>
> = {
  // `filename ?? file ?? database` was the factory's precedence; pair order
  // mirrors it, so with both aliases present `file` wins and `database` is
  // left shadowed — exactly what the `??` chain resolved to.
  sqlite: [['file', 'filename'], ['database', 'filename']],
  'sqlite-wasm': [['file', 'filename'], ['database', 'filename']],
  postgres: [['connectionString', 'url'], ['user', 'username']],
  mysql: [['connectionString', 'url'], ['user', 'username']],
  // `mongodb` since #6345 — the canonical id was renamed from `mongo` so the
  // contract canon matches what both boot hosts, the driver package and every
  // URL scheme already said. Keyed by the CANONICAL id `resolveDriverId`
  // returns, so a stored `driver: 'mongo'` still lands here through the alias.
  mongodb: [['uri', 'url'], ['user', 'username']],
};

/**
 * Datasource `config` legacy key aliases → canonical, per driver (protocol 17,
 * #4456 — the #4410 close-out).
 *
 * #4410 gave `datasource.config` its per-driver zod gate, so the AUTHORING
 * surface has exactly one spelling per key and rejects the legacy ones with a
 * rename hint. What the gate could not fix is data at rest: a runtime
 * datasource stored in `sys_metadata` before the gate may carry `file:`
 * (sqlite), `connectionString:`/`user:` (postgres/mysql), or `uri:`/`user:`
 * (mongo), and until now those kept working only because
 * `createDefaultDatasourceDriverFactory` carried undeclared read-side `??`
 * fallbacks — the exact PD #12 debt {@link flowNodeFilterAlias} pioneered the
 * retirement path for. Deleting the fallbacks without this entry would
 * silently change where a stored datasource's data lives (a sqlite `file:`
 * row would fall back to `:memory:`).
 *
 * So the tolerance graduates here: every stored-row rehydration seam replays
 * the full chain (`applyConversionsToStoredItem`, #3903), hands the factory
 * the canonical key, and the factory reads ONE spelling. Precedence follows
 * {@link renameKey}: a canonical key already present wins, which is also what
 * the factory's `??` chains resolved to — and since #4923 the alias beside it
 * is deleted when it merely repeats that value, or kept (for the authoring
 * gate to refuse naming both) when the two disagree.
 *
 * **Retired from the load path** — not because the keys misdescribed
 * themselves (they were honest spellings, merely undeclared), but because the
 * authoring gate ALREADY rejects each of them with a rename hint
 * (`strictUnknownKeyError` alias tables), and a live-window entry at
 * `normalizeStackInput` would run before that gate and silently absorb the
 * spelling #4410 deliberately made loud. Stored rows and `migrate meta` are
 * exactly the `includeRetired` seams.
 */
const datasourceConfigDriverKeyAliases: MetadataConversion = {
  id: 'datasource-config-driver-key-aliases',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'datasource.config',
  summary:
    "datasource config keys → canonical per driver: sqlite 'file'/'database' → 'filename', "
    + "postgres/mysql 'connectionString' → 'url' and 'user' → 'username', mongo 'uri' → 'url' "
    + "and 'user' → 'username' (#4456 — driver-factory `??` fallback graduation)",
  apply(stack, emit) {
    return mapDatasources(stack, (ds, path) => {
      const kind = resolveDriverId(ds.driver);
      const pairs = kind ? DATASOURCE_CONFIG_KEY_ALIASES[kind] : undefined;
      if (!pairs) return ds;
      const config = ds.config;
      if (!isDict(config)) return ds;
      let nextConfig = config;
      for (const [from, to] of pairs) {
        const renamed = renameKey(nextConfig, from, to);
        if (!renamed) continue; // absent, or an ambiguous pair `renameKey` refuses (#4923)
        emit({ from, to, path: `${path}.config.${to}` });
        nextConfig = renamed;
      }
      return nextConfig === config ? ds : { ...ds, config: nextConfig };
    });
  },
  fixture: {
    before: {
      datasources: [
        { name: 'app_db', driver: 'sqlite', config: { file: './data/app.db' } },
        // driver-id aliases resolve too — `sqlite3` selects the sqlite contract
        { name: 'archive_db', driver: 'sqlite3', config: { database: './data/archive.db' } },
        {
          name: 'warehouse',
          driver: 'pg',
          config: { connectionString: 'postgresql://db.internal:5432/analytics', user: 'analyst' },
        },
        // `database` is CANONICAL for mysql — only `user` converts
        { name: 'orders', driver: 'mysql', config: { host: 'db.internal', database: 'orders', user: 'svc_orders' } },
        { name: 'events', driver: 'mongodb', config: { uri: 'mongodb://mongo.internal:27017/events' } },
        // Both spellings, DIFFERENT files (#4923): kept, so the authoring gate
        // can refuse naming both rather than the loader picking a database.
        { name: 'scratch', driver: 'sqlite', config: { filename: ':memory:', file: './scratch.db' } },
      ],
    },
    after: {
      datasources: [
        { name: 'app_db', driver: 'sqlite', config: { filename: './data/app.db' } },
        { name: 'archive_db', driver: 'sqlite3', config: { filename: './data/archive.db' } },
        {
          name: 'warehouse',
          driver: 'pg',
          config: { url: 'postgresql://db.internal:5432/analytics', username: 'analyst' },
        },
        { name: 'orders', driver: 'mysql', config: { host: 'db.internal', database: 'orders', username: 'svc_orders' } },
        { name: 'events', driver: 'mongodb', config: { url: 'mongodb://mongo.internal:27017/events' } },
        { name: 'scratch', driver: 'sqlite', config: { filename: ':memory:', file: './scratch.db' } },
      ],
    },
    // app_db 1 + archive_db 1 + warehouse 2 + orders 1 + events 1 + scratch 0.
    expectedNotices: 6,
  },
};

/**
 * `datasource.driver: 'mongo'` → `'mongodb'` (protocol 17, #6345).
 *
 * ## Why a stored value has to move at all
 *
 * `mongo` and `mongodb` have both been accepted spellings since #4410, and both
 * still are — this conversion does NOT rescue a broken boot, and a deployment
 * that never runs it keeps connecting exactly as before. What moved is the
 * CANONICAL id: #6345's ruling renamed it to `mongodb`, the spelling both boot
 * hosts, the driver package (`@objectstack/driver-mongodb`) and every URL scheme
 * already used, so that the id which selects a driver and the id which selects
 * its config contract are one string with no mapping layer between them.
 *
 * That rename is visible in data because the canonical id is PUBLISHED as
 * `DRIVER_CATALOG.id` (`@objectstack/service-datasource`), documented as "used
 * as `datasource.driver`" — it is literally what Studio's connection form writes
 * into a datasource row. After the rename the form emits `mongodb`, while every
 * row written before it carries `mongo`. Left alone, one deployment's datasource
 * list holds two spellings of one driver, and any surface that matches a stored
 * `driver` against the published catalog id (a form pre-selecting the current
 * driver, a grouped list, an equality filter) silently fails to match the older
 * rows. So the stored value converges here rather than each reader learning to
 * accept both.
 *
 * ## Why D2 and not D3
 *
 * There is a concrete stored value with a lossless, behaviour-preserving
 * rewrite, which is the D2 test exactly. `mongo` and `mongodb` resolve to the
 * same contract and build the same driver, before and after, so replaying this
 * cannot change where any data lives — contrast
 * {@link datasourceConfigDriverKeyAliases}, whose scope guard exists because
 * rewriting a sqlite `path:` WOULD have moved a database.
 *
 * ## Why it stays on the LIVE load path
 *
 * Unlike the key-alias conversion above, `mongo` is not a spelling the authoring
 * gate rejects — it is still a legal alias, deliberately, so that nothing breaks
 * for a deployment that skipped the migration. There is therefore no loud
 * rejection for a live-window entry to pre-empt, and every rehydration seam
 * converging on one spelling is the whole point.
 */
const datasourceDriverMongoToMongodb: MetadataConversion = {
  id: 'datasource-driver-mongo-to-mongodb',
  toMajor: 17,
  surface: 'datasource.driver',
  summary:
    "datasource driver id 'mongo' → 'mongodb' — the canonical id both boot hosts, the driver "
    + 'package and the published DRIVER_CATALOG already used (#6345)',
  apply(stack, emit) {
    return mapDatasources(stack, (ds, path) => {
      // Only the exact legacy canon, trimmed and lower-cased the same way
      // `resolveDriverId` reads it. `mongodb` is already canonical, and any other
      // spelling (a plugin driver, a typo) is not this conversion's business.
      if (typeof ds.driver !== 'string' || ds.driver.trim().toLowerCase() !== 'mongo') return ds;
      emit({ from: 'mongo', to: 'mongodb', path: `${path}.driver` });
      return { ...ds, driver: 'mongodb' };
    });
  },
  fixture: {
    before: {
      datasources: [
        { name: 'events', driver: 'mongo', config: { url: 'mongodb://mongo.internal:27017/events' } },
        // Already canonical — untouched, and emits nothing.
        { name: 'audit', driver: 'mongodb', config: { url: 'mongodb://mongo.internal:27017/audit' } },
        // A different driver whose id merely CONTAINS the string: never rewritten.
        { name: 'cache', driver: 'com.vendor.mongolike', config: { url: 'x://y' } },
      ],
    },
    after: {
      datasources: [
        { name: 'events', driver: 'mongodb', config: { url: 'mongodb://mongo.internal:27017/events' } },
        { name: 'audit', driver: 'mongodb', config: { url: 'mongodb://mongo.internal:27017/audit' } },
        { name: 'cache', driver: 'com.vendor.mongolike', config: { url: 'x://y' } },
      ],
    },
    expectedNotices: 1,
  },
};

/**
 * `script` node config — the four retired dispatch branches (protocol 17, #4343).
 *
 * A `script` node had four ways to name what it ran and only one of them ran
 * anything. `actionType: 'email' | 'slack'` were logger-backed stubs: they wrote
 * a line and reported success, and `template` / `recipients` / `variables` fed a
 * message no channel ever sent — under any configuration, with or without the
 * messaging service installed. Inline `config.script` was recognized and never
 * executed (the built-in runtime has no server-side JS sandbox), so the node
 * warned and no-op'd. Every remaining `actionType` value was shorthand for a
 * registered-function name — a second spelling of `config.function` — and the
 * `invoke_function` marker named nothing on its own.
 *
 * So the node converges on its one real path (call the function named by
 * `config.function`), and the five keys leave the surface. This is what let the
 * contract be parsed at execute time at all: while the legal key set depended on
 * `actionType`, a flat parse would either reject valid shapes or wave everything
 * through — see the module header of `automation/schemaless-node-config.zod.ts`.
 *
 * **Retired from the load path**, like every other key retired for lying rather
 * than for being renamed (see `flow-node-wait-timeout-keys-removed` for the
 * distinction the registry draws): silently absorbing `actionType: 'email'`
 * would let an author keep believing the flow sends mail.
 *
 * A **shorthand `actionType` moves into `function`** rather than being dropped,
 * because that is what it meant (#1870) — the same reasoning that moves
 * `timeoutMs` into `timerDuration`. It moves only when `function` is not already
 * set: with both present the executor always took `function`, so the shorthand
 * was already dead metadata. The built-in ids and the `invoke_function` marker
 * are never function names, so they are dropped, not moved.
 *
 * The other four keys are dropped outright: no reader ever consumed them, so
 * there is no value to preserve. Rebuilding the intent is an authoring decision
 * the tombstones prescribe per branch (`notify` for mail, a `connector_action`
 * with the Slack connector — or `http` to a webhook — for Slack, a registered
 * function for an inline body), not something a mechanical rewrite can guess.
 *
 * Ordering note: this runs AFTER `flow-node-script-config-aliases`, so the
 * `functionName` → `function` rename has already happened when the shorthand
 * rule asks whether `function` is set.
 */
const SCRIPT_RETIRED_BUILTIN_ACTION_TYPES = new Set(['email', 'slack']);
const SCRIPT_RETIRED_INVOKE_FUNCTION_MARKER = 'invoke_function';

function removeScriptBranchKeys(stack: Dict, emit: Emit): Dict {
  return mapFlowNodes(stack, (node, path) => {
    // Filtered to `script`, unlike the wait retirement: these tombstones live on
    // the script config contract, which no other node type is parsed against.
    if (node.type !== 'script') return node;
    const cfg = node.config;
    if (!isDict(cfg)) return node;

    const next: Dict = { ...cfg };
    let changed = false;

    if (next.actionType != null) {
      const actionType = typeof next.actionType === 'string' ? next.actionType.trim() : '';
      const hasFunction = typeof next.function === 'string' && next.function.trim() !== '';
      const isShorthand =
        actionType !== ''
        && actionType !== SCRIPT_RETIRED_INVOKE_FUNCTION_MARKER
        && !SCRIPT_RETIRED_BUILTIN_ACTION_TYPES.has(actionType);

      if (isShorthand && !hasFunction) {
        next.function = actionType;
        emit({ from: 'config.actionType', to: 'config.function', path: `${path}.config.function` });
      } else if (isShorthand) {
        emit({ from: 'config.actionType', to: '(removed — `config.function` already named the callable)', path: `${path}.config` });
      } else {
        emit({ from: 'config.actionType', to: '(removed — logger-backed stub or bare marker; nothing was delivered)', path: `${path}.config` });
      }
      delete next.actionType;
      changed = true;
    }

    for (const key of ['template', 'recipients', 'variables'] as const) {
      if (next[key] == null) continue;
      emit({ from: `config.${key}`, to: '(removed — fed a side effect that never delivered)', path: `${path}.config` });
      delete next[key];
      changed = true;
    }

    if (next.script != null) {
      emit({ from: 'config.script', to: '(removed — inline JS was never executed)', path: `${path}.config` });
      delete next.script;
      changed = true;
    }

    return changed ? { ...node, config: next } : node;
  });
}

const flowNodeScriptBranchKeysRemoved: MetadataConversion = {
  id: 'flow-node-script-branch-keys-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface:
    'flow.node.script.config.actionType / flow.node.script.config.template / '
    + 'flow.node.script.config.recipients / flow.node.script.config.variables / '
    + 'flow.node.script.config.script',
  summary:
    "script flow-node config keys 'actionType' (→ 'function' when it was shorthand for one; otherwise removed — "
    + "'email'/'slack' were logger-backed stubs that delivered nothing), plus 'template' / 'recipients' / "
    + "'variables' (fed those stubs) and 'script' (inline JS the runtime never executed) (#4343)",
  apply(stack, emit) {
    return removeScriptBranchKeys(stack, emit);
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'task_lifecycle',
          nodes: [
            { id: 'n1', type: 'start' },
            // The logger-backed stub in full: nothing here was ever delivered.
            {
              id: 'n2',
              type: 'script',
              config: {
                actionType: 'email',
                template: 'task_done',
                recipients: ['{record.owner}'],
                variables: { taskName: '{record.name}' },
              },
            },
            // Shorthand for a registered function — the one value that MOVES.
            { id: 'n3', type: 'script', config: { actionType: 'score_lead', outputVariable: 'score' } },
            // Inline body: recognized, never executed. Dropped; the node is left
            // naming no callable, which the execute-time parse now says out loud.
            { id: 'n4', type: 'script', config: { script: 'return { ok: true };' } },
            // The marker alongside the canonical key: marker dropped, key kept.
            { id: 'n5', type: 'script', config: { actionType: 'invoke_function', function: 'score_lead' } },
            // Already converged — left byte-identical.
            { id: 'n6', type: 'script', config: { function: 'notify_owner', inputs: { id: '{record.id}' } } },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'task_lifecycle',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'script', config: {} },
            { id: 'n3', type: 'script', config: { outputVariable: 'score', function: 'score_lead' } },
            { id: 'n4', type: 'script', config: {} },
            { id: 'n5', type: 'script', config: { function: 'score_lead' } },
            { id: 'n6', type: 'script', config: { function: 'notify_owner', inputs: { id: '{record.id}' } } },
          ],
        },
      ],
    },
    // n2: actionType + template + recipients + variables. n3: the move.
    // n4: script. n5: the marker. n6: nothing.
    expectedNotices: 7,
  },
};

/**
 * `object.managedBy: 'system'` → `'system-data'` (protocol 17, #3355 — the v17
 * close-out of ADR-0103's v16 enum split).
 *
 * v16 split the overloaded `system` bucket ADDITIVELY: the 20 engine-owned
 * objects moved to the new explicit `engine-owned`, and the 8 admin/user-writable
 * ones stayed on `system`. The value that remained therefore labelled the exact
 * opposite of what its name said — writable platform DATA under the word
 * "system" — and left an author choosing between `system` and `engine-owned` with
 * nothing in the vocabulary to choose on. v17 renames the residue to
 * `system-data` and retires the bare value.
 *
 * Because v16 already drained the engine side, this is a ONE-TO-ONE mechanical
 * replacement with no judgement call: every remaining `system` declaration is,
 * by construction, writable platform data.
 *
 * **Retired from the load path** — the enum rejects `'system'` with the
 * {@link MANAGED_BY_SYSTEM_RETIRED} prescription, and that rejection is the
 * whole point: a live-window entry at `normalizeStackInput` would run BEFORE the
 * enum and silently absorb the value, so an author (or a model) would keep
 * writing the name the rename exists to unteach. Stored `sys_metadata` rows and
 * `os migrate meta --from 16` are exactly the `includeRetired` seams, so data at
 * rest is CONVERTED rather than reinterpreted.
 *
 * Note the affordance side-effect, which is deliberate and is why this is a
 * major-window change rather than a docs fix: `system` defaulted LOCKED and each
 * object opened its writes via `userActions`, while `system-data` defaults
 * WRITABLE. A converted row that carried no `userActions` therefore gains the
 * generic affordances — which is the honest reading of the bucket it is being
 * moved into, and changes no enforcement: the write guard, the delegated-admin
 * gate, RLS and permission sets all adjudicate independently of the bucket name.
 */
const objectManagedBySystemToSystemData: MetadataConversion = {
  id: 'object-managed-by-system-to-system-data',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'object.managedBy',
  summary:
    "object managedBy 'system' → 'system-data' (#3355 — ADR-0103's residual bucket named the "
    + 'engine-owned half v16 had already moved out to `engine-owned`; the rename leaves the '
    + 'name describing what the bucket actually holds: admin/user-writable platform data)',
  apply(stack, emit) {
    return mapCollection(stack, 'objects', (obj, path) => {
      if (obj.managedBy !== 'system') return obj;
      emit({ from: 'system', to: 'system-data', path: `${path}.managedBy` });
      return { ...obj, managedBy: 'system-data' };
    });
  },
  fixture: {
    before: {
      objects: [
        {
          name: 'sys_user_position',
          label: 'User Position',
          managedBy: 'system',
          userActions: { create: true, edit: true, delete: true },
        },
        // every other bucket passes through untouched — including `engine-owned`,
        // the value v16 already moved the engine side to
        { name: 'sys_automation_run', label: 'Automation Run', managedBy: 'engine-owned' },
        { name: 'crm_deal', label: 'Deal' },
      ],
    },
    after: {
      objects: [
        {
          name: 'sys_user_position',
          label: 'User Position',
          managedBy: 'system-data',
          userActions: { create: true, edit: true, delete: true },
        },
        { name: 'sys_automation_run', label: 'Automation Run', managedBy: 'engine-owned' },
        { name: 'crm_deal', label: 'Deal' },
      ],
    },
    expectedNotices: 1,
  },
};

/**
 * The dead object capability flags leave the surface (protocol 17, #3207 —
 * the #2377 ADR-0049 close-out slice PR #3414 removed from the schema).
 *
 * `enable.trash` promised a recycle bin and `enable.mru` promised
 * Most-Recently-Used tracking; neither ever had a behavior-changing reader —
 * every delete has always been a hard delete, and no MRU state was ever
 * written. Both defaulted `true`, the ADR-0078 silent-failure shape: authors
 * wrote `trash: false // never soft-delete audit logs` believing they were
 * opting out of a soft-delete that never ran. Soft delete stays parked at
 * #3146; if built it returns as a live enforced flag (ADR-0049).
 *
 * `retiredFromLoadPath`: the capabilities block is `.strict()` and rejects
 * both keys with the prescription (`CAPABILITIES_RETIRED_KEY_GUIDANCE`), so a
 * live author is taught at parse; this entry exists so stored 16.x rows
 * replay clean (`applyConversionsToStoredItem` — without it a pre-removal row
 * flags `metadata_spec_invalid` forever, mislabelling chain-owned history as
 * a current-contract violation) and so `os migrate meta --from 16` rewrites
 * sources.
 */
const objectEnableTrashMruRemoved: MetadataConversion = {
  id: 'object-enable-trash-mru-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'object.enable.trash / object.enable.mru',
  summary:
    "object capability flags 'enable.trash'/'enable.mru' removed (#3207, #2377 close-out — no "
    + 'recycle bin and no MRU tracking ever ran; both default-true flags gated nothing)',
  apply(stack, emit) {
    return mapCollection(stack, 'objects', (obj, path) => {
      // `enable.*` sits one level down, so stripKeys (top-level only) cannot
      // reach it — drill in, and copy-on-write so an untouched object keeps
      // its identity (pattern of `datasource-inert-blocks-removed`).
      const enable = obj.enable;
      if (!enable || typeof enable !== 'object' || Array.isArray(enable)) return obj;
      const stripped = stripKeys(
        enable as Record<string, unknown>,
        ['trash', 'mru'],
        emit,
        `${path}.enable`,
      );
      if (stripped === enable) return obj;
      return { ...obj, enable: stripped };
    });
  },
  fixture: {
    before: {
      objects: [
        {
          name: 'task',
          label: 'Task',
          enable: { trash: false, mru: true, searchable: true },
        },
        // an object without the retired keys passes through untouched
        { name: 'crm_account', label: 'Account', enable: { searchable: true } },
      ],
    },
    // Two notices: one per removed key; the surviving `searchable` proves the
    // strip is surgical, not a block-level delete.
    after: {
      objects: [
        {
          name: 'task',
          label: 'Task',
          enable: { searchable: true },
        },
        { name: 'crm_account', label: 'Account', enable: { searchable: true } },
      ],
    },
    expectedNotices: 2,
  },
};

/**
 * `indexes[].type` / `indexes[].partial` leave the surface (protocol 17,
 * #5248 + #4943, ADR-0049 enforce-or-remove).
 *
 * Neither key had a single DDL consumer. `SqlDriver.syncDeclaredIndexes` builds
 * every declared index through knex's `table.index(fields, name)` /
 * `table.unique(fields, { indexName })`, and the differ's `DeclaredIndexInput`
 * declares `name` / `fields` / `unique` / `nullSafeColumns` — so an authored
 * `type` selected no access method and an authored `partial` produced a FULL
 * index with the predicate silently discarded. `type` additionally carried
 * `.default('btree')`, so it was materialized into *every* parse output: the
 * ADR-0078 shape where an inert knob reads as live configuration.
 *
 * The maintainer chose remove over enforce (#5248, 2026-08-06): enforcing means
 * per-dialect algorithm mapping, raw-SQL `CREATE INDEX … WHERE` (MySQL has no
 * partial index), and reworking how `isSyncReproducibleIndex` excludes partial
 * indexes from incremental sync — design cost for a capability with no demand.
 *
 * ⚠️ NOT the same `partial` as the driver's: `schema-drift.ts` carries a
 * `partial: boolean` parsed back out of the DATABASE's own `CREATE INDEX` DDL
 * (`parseIndexDdl`), consumed by drift detection. That is untouched here, and
 * the exemption it grants DB-authored partial indexes still stands.
 *
 * `retiredFromLoadPath`: both keys are tombstoned at `IndexSchema`, so a live
 * author is taught by the parse error. This entry exists so stored ≤16 rows
 * replay clean through `applyConversionsToStoredItem` (without it a
 * pre-removal row would flag `metadata_spec_invalid` forever) and so
 * `os migrate meta --from 16` rewrites sources mechanically.
 */
const objectIndexTypePartialRemoved: MetadataConversion = {
  id: 'object-index-type-partial-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'object.indexes[].type / object.indexes[].partial',
  summary:
    "object index keys 'indexes[].type'/'indexes[].partial' removed (#5248, #4943 — no driver "
    + 'ever read either: the index method is the dialect\'s choice and a partial index is built '
    + 'by a database-layer migration, not declared)',
  apply(stack, emit) {
    // `indexes` is an ARRAY one level down, so `stripKeys` (top-level only)
    // cannot reach it — drill in and copy-on-write, so an object whose indexes
    // carry neither key keeps its identity. Both `objects[]` and
    // `objectExtensions[]` embed `IndexSchema`, so both are walked.
    const stripIndexes = (owner: Dict, path: string): Dict => {
      const indexes = owner.indexes;
      if (!Array.isArray(indexes)) return owner;
      let changed = false;
      const next = indexes.map((idx, i) => {
        if (!isDict(idx)) return idx;
        const stripped = stripKeys(idx, ['type', 'partial'], emit, `${path}.indexes[${i}]`);
        if (stripped !== idx) changed = true;
        return stripped;
      });
      return changed ? { ...owner, indexes: next } : owner;
    };
    let out = mapCollection(stack, 'objects', stripIndexes);
    out = mapCollection(out, 'objectExtensions', stripIndexes);
    return out;
  },
  fixture: {
    before: {
      objects: [
        {
          name: 'crm_invoice',
          label: 'Invoice',
          indexes: [
            // both retired keys on one index, alongside surviving ones
            {
              name: 'idx_invoice_active_no',
              fields: ['invoice_no'],
              unique: 'global',
              type: 'btree',
              partial: "state = 'active'",
            },
            // an index carrying neither key passes through untouched
            { name: 'idx_invoice_customer', fields: ['customer'] },
          ],
        },
      ],
      objectExtensions: [
        {
          extend: 'crm_invoice',
          indexes: [{ fields: ['tags'], type: 'gin' }],
        },
      ],
    },
    // Three notices: two keys on the object's first index, one on the
    // extension's. The surviving `name`/`fields`/`unique` prove the strip is
    // surgical rather than an index-level delete.
    after: {
      objects: [
        {
          name: 'crm_invoice',
          label: 'Invoice',
          indexes: [
            { name: 'idx_invoice_active_no', fields: ['invoice_no'], unique: 'global' },
            { name: 'idx_invoice_customer', fields: ['customer'] },
          ],
        },
      ],
      objectExtensions: [
        {
          extend: 'crm_invoice',
          indexes: [{ fields: ['tags'] }],
        },
      ],
    },
    expectedNotices: 3,
  },
};

/**
 * The retry policy converges to one declaration (protocol 17, #4661 — the
 * #4535 C8 dual-source cluster).
 *
 * `@objectstack/spec/automation` and `@objectstack/spec/system` both exported a
 * `RetryPolicy` / `RetryPolicySchema`, resolving to DIFFERENT declarations — so
 * which shape a consumer got depended only on the import path (#4411). They
 * were never two concepts: `try_catch`'s `retry` region and `job.retryPolicy`
 * both compute `delay = base * multiplier^(retry-1)`, and the two executors
 * implemented that identical formula. What differed was cosmetic and
 * accidental, and this conversion pays for both halves of the merge:
 *
 *  1. **The base delay had two spellings.** automation said `retryDelayMs`,
 *     system said `backoffMs`. `backoffMs` wins — it is what the *enforced*
 *     retry policies already spell it (`job.retryPolicy` and `hook.retryPolicy`;
 *     see the `datasource-inert-blocks-removed` note above, which leans on
 *     exactly that distinction), so the platform drops from three spellings to
 *     two rather than four. `retryDelayMs` is tombstoned (`retiredKey`) — NOT
 *     deleted — because two of the three owning shapes are not `.strict()`: a
 *     plain deletion would have Zod silently swallow the authored number and
 *     fall back to the 1000ms default, which is the quiet-failure class
 *     ADR-0049 removes.
 *
 *  2. **The defaults were opposite, and no gate can see a default.** Pre-17,
 *     `job.retryPolicy` defaulted `maxRetries: 3` / `backoffMultiplier: 2`
 *     while the automation shape defaulted 0 / 1. The merged declaration takes
 *     0 / 1 (retry is opt-in: a retry replays whatever the attempt already did,
 *     and an implicit replay of side effects is the failure mode hardest to
 *     catch in tests — the same reading already recorded for flow-level retry
 *     in `flow-retry-max-retries-required`, #4247). Taken alone that would
 *     SILENTLY stop existing jobs from retrying, and the authorable-surface
 *     gate would never notice: it compares key sets, and a default is not a key.
 *     So this conversion writes the pre-17 numbers into every existing
 *     `job.retryPolicy` that omitted them. Deployed stacks keep their exact
 *     behaviour; only a newly authored omission means "no retry".
 *
 * Jobs with no `retryPolicy` block at all are left alone — absence already
 * meant a single attempt on both sides of the change.
 *
 * ## The ONE further surface this entry grew to cover (#4964 / #4962)
 *
 * The convergence above was driven by the dual-source instrument, whose
 * question is "how many declarations share one exported NAME?". Two further
 * encodings of the identical policy were invisible to it because they were
 * anonymous inline `z.object`s with no exported name at all — and after a
 * convergence lands, a surviving dialect reads as reviewed-and-kept rather
 * than missed. One of the two is still a surface; the other went with its
 * layer:
 *
 *  - **`flow.errorHandling`** (#4964) spelled the base delay `retryDelayMs`;
 *    every other key, bound and default already matched. Step 0 below renames
 *    it, so the ONE authorable casualty of the whole convergence is still just
 *    that word — now retired everywhere it was ever legal rather than only on
 *    the two shapes #4661's instrument could see.
 *  - **`ETLPipeline.retry`** (#4962) spelled the count `maxAttempts` and
 *    defaulted it to 3. It got **no step here, deliberately** — and never will.
 *    An ETL pipeline was not a `defineStack` collection and `etl.zod.ts` had no
 *    parse site in objectstack / objectui / cloud (批 12's measurement), so
 *    there was no stored or authored document a walker could reach: a branch
 *    for it would have been dead code claiming migration coverage that does not
 *    exist, which is the ADR-0049 failure this registry is supposed to prevent,
 *    not commit. #6414 then retired the whole L2 layer, and #4962's own entry
 *    (`etl-retry-converged-onto-retry-policy`) was ABSORBED into
 *    `etl-pipeline-layer-retired` inside the same unreleased major. There is no
 *    `maxAttempts` tombstone left to carry the rename or the default change: it
 *    went with the shape that carried it, which is strictly stronger, because
 *    no `retry` block survives to author the key into. `tsc` (TS2724/TS2305 on
 *    the removed ETL names) is the whole channel. That is also why the ETL
 *    default flip 3 → 0 never needed a materialization step while the job one
 *    did: nothing was ever deployed under the old reading.
 *
 * `retiredFromLoadPath` is NOT set: `FlowNodeSchema.config` is an unconstrained
 * record, so no schema rejection can reach `config.retry.retryDelayMs` and the
 * conversion layer is the only seam that can declare and retire that spelling.
 * The `RetryPolicySchema` tombstone still fires for anyone who reaches the
 * policy through a parsed job.
 */
const retryPolicyConverged: MetadataConversion = {
  id: 'retry-policy-converged',
  toMajor: 17,
  surface: 'flow.errorHandling.retryDelayMs / flow.node.config.retry.retryDelayMs / job.retryPolicy.maxRetries / job.retryPolicy.backoffMultiplier',
  summary:
    "retry policy unified across job.retryPolicy, try_catch retry and flow.errorHandling: base delay 'retryDelayMs' → 'backoffMs', " +
    "and the pre-17 job defaults (maxRetries 3, backoffMultiplier 2) written out explicitly now that the merged default is 0 / 1 (#4661, #4964)",
  apply(stack, emit) {
    // ── 0. flows: errorHandling.retryDelayMs → errorHandling.backoffMs ─
    //
    // The FLOW-LEVEL retry policy (#4964). Same rename as the try_catch node
    // below and for the same reason, reached one level up: `errorHandling`
    // hangs off the flow document, not off a node, so `mapFlowNodes` walks
    // straight past it — which is a small echo of why this divergence survived
    // #4661 at all. `renameKey` leaves an already-canonical `backoffMs` alone;
    // when BOTH spellings are present it now (#4923) deletes `retryDelayMs`
    // only if it repeats the same number, and otherwise keeps both rather than
    // guessing which delay the author meant — the strict block then rejects
    // naming both. This entry relied on the shared helper's semantics rather
    // than open-coding its own precisely so it would move with that ruling,
    // and it did: no change was needed here.
    const withErrorHandling = mapCollection(stack, 'flows', (flow, path) => {
      const eh = flow.errorHandling;
      if (!eh || typeof eh !== 'object' || Array.isArray(eh)) return flow;
      const renamed = renameKey(eh as Record<string, unknown>, 'retryDelayMs', 'backoffMs');
      if (renamed === null) return flow;
      emit({ from: 'retryDelayMs', to: 'backoffMs', path: `${path}.errorHandling.backoffMs` });
      return { ...flow, errorHandling: renamed };
    });

    // ── 1. try_catch nodes: retry.retryDelayMs → retry.backoffMs ──────
    const withFlows = mapFlowNodes(withErrorHandling, (node, path) => {
      if (node.type !== 'try_catch') return node;
      const config = node.config;
      if (!config || typeof config !== 'object' || Array.isArray(config)) return node;
      const configDict = config as Record<string, unknown>;
      const retry = configDict.retry;
      if (!retry || typeof retry !== 'object' || Array.isArray(retry)) return node;
      const renamed = renameKey(retry as Record<string, unknown>, 'retryDelayMs', 'backoffMs');
      if (renamed === null) return node;
      emit({ from: 'retryDelayMs', to: 'backoffMs', path: `${path}.config.retry.backoffMs` });
      return { ...node, config: { ...configDict, retry: renamed } };
    });

    // ── 2. jobs: materialize the pre-17 implicit defaults ─────────────
    return mapCollection(withFlows, 'jobs', (job, path) => {
      const policy = job.retryPolicy;
      if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return job;
      const policyDict = policy as Record<string, unknown>;
      let next = policyDict;
      if (next.maxRetries === undefined) {
        next = { ...next, maxRetries: 3 };
        emit({
          from: 'maxRetries unset (implied 3)',
          to: 'maxRetries: 3',
          path: `${path}.retryPolicy.maxRetries`,
        });
      }
      if (next.backoffMultiplier === undefined) {
        next = { ...next, backoffMultiplier: 2 };
        emit({
          from: 'backoffMultiplier unset (implied 2)',
          to: 'backoffMultiplier: 2',
          path: `${path}.retryPolicy.backoffMultiplier`,
        });
      }
      return next === policyDict ? job : { ...job, retryPolicy: next };
    });
  },
  fixture: {
    before: {
      flows: [{
        name: 'sync_orders',
        // Flow-LEVEL policy (#4964) — one level up from the nodes, so the node
        // walk below never sees it.
        errorHandling: { strategy: 'retry', maxRetries: 3, retryDelayMs: 2000 },
        nodes: [
          { id: 'n1', type: 'start' },
          {
            id: 'n2',
            type: 'try_catch',
            config: {
              try: { nodes: [], edges: [] },
              retry: { maxRetries: 3, retryDelayMs: 500, jitter: true },
            },
          },
          // Already canonical — left alone, contributes no notice.
          {
            id: 'n3',
            type: 'try_catch',
            config: { try: { nodes: [], edges: [] }, retry: { maxRetries: 2, backoffMs: 250 } },
          },
        ],
      }, {
        // Flow-level block already canonical — left alone, no notice.
        name: 'roll_up',
        errorHandling: { strategy: 'retry', maxRetries: 1, backoffMs: 100 },
        nodes: [{ id: 'n1', type: 'start' }],
      }],
      jobs: [
        // Omits both defaults — both get written out.
        { name: 'nightly_sync', schedule: { type: 'cron', expression: '0 0 * * *' }, handler: 'jobs.ts:sync', retryPolicy: { backoffMs: 5000 } },
        // States both — untouched.
        { name: 'hourly_roll', schedule: { type: 'cron', expression: '0 * * * *' }, handler: 'jobs.ts:roll', retryPolicy: { maxRetries: 1, backoffMultiplier: 3 } },
        // No policy block at all — absence already meant one attempt.
        { name: 'weekly_purge', schedule: { type: 'cron', expression: '0 0 * * 0' }, handler: 'jobs.ts:purge' },
      ],
    },
    after: {
      flows: [{
        name: 'sync_orders',
        errorHandling: { strategy: 'retry', maxRetries: 3, backoffMs: 2000 },
        nodes: [
          { id: 'n1', type: 'start' },
          {
            id: 'n2',
            type: 'try_catch',
            config: {
              try: { nodes: [], edges: [] },
              retry: { maxRetries: 3, jitter: true, backoffMs: 500 },
            },
          },
          {
            id: 'n3',
            type: 'try_catch',
            config: { try: { nodes: [], edges: [] }, retry: { maxRetries: 2, backoffMs: 250 } },
          },
        ],
      }, {
        name: 'roll_up',
        errorHandling: { strategy: 'retry', maxRetries: 1, backoffMs: 100 },
        nodes: [{ id: 'n1', type: 'start' }],
      }],
      jobs: [
        { name: 'nightly_sync', schedule: { type: 'cron', expression: '0 0 * * *' }, handler: 'jobs.ts:sync', retryPolicy: { backoffMs: 5000, maxRetries: 3, backoffMultiplier: 2 } },
        { name: 'hourly_roll', schedule: { type: 'cron', expression: '0 * * * *' }, handler: 'jobs.ts:roll', retryPolicy: { maxRetries: 1, backoffMultiplier: 3 } },
        { name: 'weekly_purge', schedule: { type: 'cron', expression: '0 0 * * 0' }, handler: 'jobs.ts:purge' },
      ],
    },
    // sync_orders' flow-level rename, n2's node-level rename, plus
    // nightly_sync's two materialized defaults.
    expectedNotices: 4,
  },
};

/**
 * The `crypto.hash` capability token leaves `HookBodyCapability` (protocol 17,
 * #4391 — ADR-0049 enforce-or-remove).
 *
 * Four layers advertised the token and none implemented it: the spec enum, the
 * doc table beside it, the CLI's build-time extractor (which INFERRED the token
 * from a `ctx.crypto.hash` call, so `os build` blessed the very body that was
 * about to fail) and `ScriptContext.crypto.hash`. `installCtx` wired only
 * `randomUUID`, so the single call the token authorised threw inside the VM.
 * Removed rather than implemented: crypto in the sandbox widens its capability
 * and security-review surface, and zero complaints against a capability that
 * throws on every use is the strongest liveness evidence there is.
 *
 * This is an enum-VALUE retirement, so there is no `retiredKey()` tombstone to
 * hang the prescription on — the enum's own error map carries it
 * (`CRYPTO_HASH_RETIRED`, data/hook-body.zod.ts), keyed on `issue.input` so that
 * only the value which used to be legal gets the "was removed" message.
 *
 * `retiredFromLoadPath`: the enum rejects the token outright, so a live author
 * is taught at parse rather than silently rewritten. The entry exists so stored
 * 16.x/17-rc rows replay clean (`applyConversionsToStoredItem` — without it a
 * pre-removal row flags `metadata_spec_invalid` forever, mislabelling
 * chain-owned history as a current-contract violation) and so
 * `os migrate meta --from 16` rewrites author sources. The
 * `object-enable-trash-mru-removed` precedent, one level deeper: the token is a
 * VALUE inside `body.capabilities`, not a key, so `stripKeys` cannot reach it.
 *
 * Note what the strip deliberately does NOT do: it removes the dead grant, not
 * the `ctx.crypto.hash(...)` call the body made under it. That call has never
 * returned a value, so nothing regresses — but the author is still left a dead
 * line to delete, which is exactly what the prescription tells them to do.
 */
const hookBodyCryptoHashRemoved: MetadataConversion = {
  id: 'hook-body-crypto-hash-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'hook.body.capabilities / action.body.capabilities',
  summary:
    "script-body capability token 'crypto.hash' removed (#4391 — the sandbox never installed "
    + 'ctx.crypto.hash, so the token granted a call that always threw; the CLI inferred it too)',
  apply(stack, emit) {
    const stripToken = (item: Dict, path: string): Dict => {
      const body = item.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return item;
      const caps = (body as Dict).capabilities;
      if (!Array.isArray(caps) || !caps.includes('crypto.hash')) return item;
      emit({ from: 'crypto.hash', to: '(removed)', path: `${path}.body.capabilities` });
      return {
        ...item,
        body: { ...(body as Dict), capabilities: caps.filter((c) => c !== 'crypto.hash') },
      };
    };
    const withHooks = mapCollection(stack, 'hooks', stripToken);
    return mapCollection(withHooks, 'actions', stripToken);
  },
  fixture: {
    before: {
      hooks: [
        {
          name: 'fingerprint_lead',
          object: 'crm_lead',
          events: ['beforeInsert'],
          body: {
            language: 'js',
            source: "ctx.input.fp = await ctx.crypto.hash('sha256', ctx.input.email);",
            capabilities: ['crypto.hash', 'crypto.uuid'],
          },
        },
        // a body without the retired token passes through untouched
        {
          name: 'stamp_lead',
          object: 'crm_lead',
          events: ['beforeInsert'],
          body: {
            language: 'js',
            source: 'ctx.input.trace = ctx.crypto.randomUUID();',
            capabilities: ['crypto.uuid'],
          },
        },
      ],
      actions: [
        {
          name: 'digest_deal',
          type: 'script',
          body: {
            language: 'js',
            source: "return ctx.crypto.hash('sha256', ctx.record.id);",
            capabilities: ['crypto.hash'],
          },
        },
      ],
    },
    // Surgical: `crypto.uuid` survives beside the stripped token, and the
    // `capabilities` key itself stays (an empty grant set is legal).
    after: {
      hooks: [
        {
          name: 'fingerprint_lead',
          object: 'crm_lead',
          events: ['beforeInsert'],
          body: {
            language: 'js',
            source: "ctx.input.fp = await ctx.crypto.hash('sha256', ctx.input.email);",
            capabilities: ['crypto.uuid'],
          },
        },
        {
          name: 'stamp_lead',
          object: 'crm_lead',
          events: ['beforeInsert'],
          body: {
            language: 'js',
            source: 'ctx.input.trace = ctx.crypto.randomUUID();',
            capabilities: ['crypto.uuid'],
          },
        },
      ],
      actions: [
        {
          name: 'digest_deal',
          type: 'script',
          body: {
            language: 'js',
            source: "return ctx.crypto.hash('sha256', ctx.record.id);",
            capabilities: [],
          },
        },
      ],
    },
    // One per rewritten body — the hook and the action; `stamp_lead` is untouched.
    expectedNotices: 2,
  },
};

/**
 * `array_agg` / `string_agg` leave `AggregationFunction` (protocol 17, #6188 —
 * ADR-0049 enforce-or-remove).
 *
 * The enum declared eight functions; the SQL family compiles five.
 * `SqlDriver.mapAggregateFunc` and the Turso `RemoteTransport.aggregate` each
 * lower `count`/`sum`/`avg`/`min`/`max` and route everything else to the same
 * refusal, and `service-analytics` carried a hand-written `UNSUPPORTED_AGGREGATES`
 * list naming exactly these two — a subtraction that existed to stop them
 * reaching the Cube strategy's `default`, which returned `COUNT(*)`: a row count
 * in place of the number the author asked for. So the declaration was not merely
 * unenforced, it was the reason another package had to carry a denylist.
 *
 * The maintainer's 2026-08-07 ruling SPLIT the three unlowered functions rather
 * than retiring them as a block, and the split is the substance of this entry.
 * `count_distinct` stays: one portable lowering (`COUNT(DISTINCT x)`), a
 * dashboard staple, and `service-analytics` already lowers it — so it takes
 * ADR-0049's ENFORCE leg and the SQL implementation follows on its own card.
 * These two take the REMOVE leg: display conveniences with no measured pull,
 * and `string_agg` has no single shape to lower to at all (the delimiter is a
 * second argument in PostgreSQL, a `SEPARATOR` clause in MySQL, a differently
 * named function in SQL Server).
 *
 * Like `hook-body-crypto-hash-removed` above, this is an enum-VALUE retirement:
 * there is no `retiredKey()` tombstone to hang the prescription on, so the enum's
 * own error map carries it (`ARRAY_AGG_RETIRED` / `STRING_AGG_RETIRED`,
 * `data/query.zod.ts`), keyed on `issue.input` so only the two spellings that
 * used to be legal are told they "were removed". For the same reason nothing
 * lands in `RETIRED_KEYS_BY_MAJOR` and the four surface ratchets are expected to
 * be byte-identical — no def and no authorable KEY changed.
 *
 * ## What this rewrites, and what it deliberately does not
 *
 * The retired values are authorable in two places and only one of them is stored
 * metadata:
 *
 * - **`dataset.measures[].aggregate`** (`ui/dataset.zod.ts`, reusing this enum)
 *   is carried in the stack, so it is what this conversion walks.
 * - **`QueryAST.aggregations[].function`** is a REQUEST surface — the client
 *   SDK's builder output and the `POST /data/:object/query` body, never stored
 *   (`liveness/query.json` records the same fact for `joins`/`cursor`/`distinct`).
 *   There is no source for the chain to rewrite, so it is a semantic TODO on the
 *   D3 step instead.
 *
 * The measure is DROPPED rather than stripped down to a bare `{ name, field }`.
 * A measure with no `aggregate` and no `derived` fails the dataset's own
 * `superRefine`, so stripping the key alone would hand back an item that cannot
 * parse — a conversion whose output is invalid is worse than no conversion. And
 * nothing is lost by dropping it: `compileDataset` has always refused these two
 * by name with `datasetInvalidError`, so a stored dataset carrying one never
 * produced a number on any backend. Every drop emits its own notice, so
 * `os migrate meta` names the measure it removed rather than quietly shrinking
 * the dataset.
 *
 * The cascade is part of that correctness, not extra: a `derived` measure whose
 * `of` names a dropped measure would leave the dataset failing the "derived
 * measures may only reference OTHER measures declared in this dataset" refinement.
 * It is applied to a fixpoint because a derived measure may combine other derived
 * measures.
 *
 * `retiredFromLoadPath`: the enum rejects both values outright, so a live author
 * is taught at parse rather than silently rewritten. The entry exists so stored
 * 16.x/17-rc rows replay clean (`applyConversionsToStoredItem` — without it a
 * pre-removal row flags `metadata_spec_invalid` forever, mislabelling
 * chain-owned history as a current-contract violation) and so
 * `os migrate meta --from 16` rewrites author sources.
 */
const datasetMeasureAggRemoved: MetadataConversion = {
  id: 'dataset-measure-array-string-agg-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'dataset.measures[].aggregate',
  summary:
    "dataset measure aggregates 'array_agg' / 'string_agg' removed (#6188 — no SQL backend "
    + 'compiled them and the v1 dataset runtime refused them by name, so a measure declaring '
    + 'one never produced a value; the measure is dropped, and with it any derived measure '
    + 'left referencing it)',
  apply(stack, emit) {
    const RETIRED = new Set(['array_agg', 'string_agg']);
    return mapCollection(stack, 'datasets', (dataset, path) => {
      const measures = dataset.measures;
      if (!Array.isArray(measures)) return dataset;

      const dropped = new Set<string>();
      const kept = measures.filter((m, i) => {
        if (!isDict(m)) return true;
        const aggregate = m.aggregate;
        if (typeof aggregate !== 'string' || !RETIRED.has(aggregate)) return true;
        emit({ from: aggregate, to: '(removed)', path: `${path}.measures[${i}].aggregate` });
        if (typeof m.name === 'string') dropped.add(m.name);
        return false;
      });
      if (kept.length === measures.length) return dataset;

      // Fixpoint: a derived measure may be built from another derived measure,
      // so one pass can strand a reference the next pass has to answer for.
      let survivors = kept;
      for (;;) {
        const next = survivors.filter((m) => {
          if (!isDict(m)) return true;
          const derived = m.derived;
          if (!isDict(derived) || !Array.isArray(derived.of)) return true;
          if (!derived.of.some((name) => typeof name === 'string' && dropped.has(name))) return true;
          emit({
            from: `derived measure "${String(m.name)}"`,
            to: '(removed)',
            path: `${path}.measures`,
          });
          if (typeof m.name === 'string') dropped.add(m.name);
          return false;
        });
        if (next.length === survivors.length) break;
        survivors = next;
      }

      return { ...dataset, measures: survivors };
    });
  },
  fixture: {
    before: {
      datasets: [{
        name: 'order_lines',
        object: 'order_line',
        dimensions: [{ name: 'status', field: 'status', type: 'string' }],
        measures: [
          { name: 'total_amount', aggregate: 'sum', field: 'amount' },
          { name: 'product_ids', aggregate: 'array_agg', field: 'product_id' },
          { name: 'product_names', aggregate: 'string_agg', field: 'product_name' },
          // Derived measures: the first is stranded by the drop above, the
          // second is stranded by the first — the reason the sweep runs to a
          // fixpoint rather than once.
          { name: 'name_list', derived: { op: 'sum', of: ['product_names'] } },
          { name: 'name_list_ratio', derived: { op: 'ratio', of: ['name_list', 'total_amount'] } },
          // Survives: derived from measures that are all still here.
          { name: 'amount_share', derived: { op: 'ratio', of: ['total_amount', 'total_amount'] } },
        ],
      }],
    },
    after: {
      datasets: [{
        name: 'order_lines',
        object: 'order_line',
        dimensions: [{ name: 'status', field: 'status', type: 'string' }],
        measures: [
          { name: 'total_amount', aggregate: 'sum', field: 'amount' },
          { name: 'amount_share', derived: { op: 'ratio', of: ['total_amount', 'total_amount'] } },
        ],
      }],
    },
    // Two retired aggregates, plus the two derived measures the drops stranded.
    expectedNotices: 4,
  },
};

/**
 * `connector.rateLimitConfig` — OUTBOUND throttling for an engine that does not
 * exist (#4911, ADR-0049).
 *
 * Not "declared but unread" — *declared but unimplemented*, which is a step
 * worse. The platform's only token bucket is `packages/runtime/src/security/
 * rate-limit.ts`, and it is INBOUND: the dispatcher calls `consume(key)` on a
 * request fingerprint and short-circuits with 429. There is no counterpart on
 * the way out; no connector provider (`connector-rest`, `connector-openapi`,
 * `connector-mcp`, `connector-slack`) reads the key, and no seam exists that
 * could. So `strategy` / `maxRequests` / `windowSeconds` / `burstCapacity` /
 * `respectUpstreamLimits` / `rateLimitHeaders` were six precise knobs an author
 * could set — and would then believe capped their outbound call rate against a
 * third-party API's quota. That belief is the defect: this is the false-
 * compliance class ADR-0049 exists for, not cosmetic debt.
 *
 * The whole SHAPE goes, not just the key: `ConnectorRateLimitConfigSchema` and
 * the `RateLimitStrategySchema` enum it embedded had no other consumer, and an
 * exported schema with no consumer reads as a capability to whoever finds it
 * (#3950). The vocabulary returns *with* an implementation, in one change —
 * implementation-first, the ruling #4834 / PR #4878 set for the plugin-runtime
 * family.
 *
 * Deliberately NOT converted to `shared/RateLimitConfig` (inbound API limiting,
 * `windowMs`), the obvious-looking target: it limits the calls *others* make to
 * us. Rewriting an outbound cap into an inbound one would throttle the wrong
 * direction — a migration that silently changes behaviour, well outside D2's
 * lossless scope. #4684 split their NAMES for this exact confusion; the honest
 * conversion is a delete plus a prescription that says where throttling really
 * lives (the connector provider / upstream gateway).
 *
 * `retiredFromLoadPath`: the key lies rather than being misspelled — the
 * `flow-node-wait-timeout-keys-removed` distinction. Silently absorbing it at
 * load would let the author keep believing they had configured a cap. The entry
 * exists so stored 16.x/17-rc rows replay clean
 * (`applyConversionsToStoredItem`) and `os migrate meta --from 16` rewrites
 * author sources; live parses hit the `retiredKey()` tombstone instead.
 */
const connectorRateLimitConfigRemoved: MetadataConversion = {
  id: 'connector-rate-limit-config-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'connector.rateLimitConfig',
  summary:
    "connector key 'rateLimitConfig' removed (#4911 — no outbound rate-limiting engine exists; "
    + "the runtime's only token bucket limits INBOUND requests, so every knob here was inert "
    + 'while reading like a configured cap. The whole ConnectorRateLimitConfig shape went with it)',
  apply(stack, emit) {
    return mapCollection(stack, 'connectors', (c, path) =>
      stripKeys(c, ['rateLimitConfig'], emit, path));
  },
  fixture: {
    before: {
      connectors: [
        {
          name: 'billing_api',
          label: 'Billing API',
          type: 'api',
          rateLimitConfig: {
            strategy: 'token_bucket',
            maxRequests: 100,
            windowSeconds: 60,
            burstCapacity: 150,
            respectUpstreamLimits: true,
          },
        },
        // A connector that never authored the key keeps its identity — the
        // copy-on-write contract `stripKeys` / `mapCollection` are built on.
        { name: 'crm_sync', label: 'CRM Sync', type: 'saas' },
      ],
    },
    // One notice per connector, not per knob: the block is what was removed.
    // `retryConfig` and the timeouts beside it are untouched — they are live.
    after: {
      connectors: [
        { name: 'billing_api', label: 'Billing API', type: 'api' },
        { name: 'crm_sync', label: 'CRM Sync', type: 'saas' },
      ],
    },
    expectedNotices: 1,
  },
};

/**
 * `fieldMappings[].transform` — five declared transforms, zero engines (#5552,
 * ADR-0049).
 *
 * `shared/FieldMappingSchema.transform` was typed by a five-member
 * discriminated union (`FieldMappingTransformSchema`: `constant` / `cast` /
 * `lookup` / `javascript` / `map`), inherited by both schemas that extend it —
 * `integration/ConnectorFieldMapping` and `data/ExternalFieldMapping`. The
 * whole union goes; the key is tombstoned on the base, which retires all three
 * authorable spellings in one edit.
 *
 * What was measured, and against what (2026-08-06, `origin/main` @ efedd28):
 *
 * - **Declarative**: `transform: { type: … }` in a field-mapping position is
 *   authored NOWHERE outside `packages/spec`'s own tests — not in `examples/`,
 *   not in `skills/`, not in objectui. The showcase's one mapping
 *   (`examples/app-showcase/src/data/mappings/index.ts`) writes `transform:
 *   'map'` — a bare STRING, which is the *other* schema (see below).
 * - **Parse**: reachable. `AutomationEngine.registerConnector` /
 *   `registerDegradedConnector` run `ConnectorSchema.parse`, which walks
 *   `fieldMappings[]`. So the tombstone's prescription has a live receiver,
 *   which is why this is a `retiredKey()` and not a bare deletion.
 * - **Execution**: none. `fieldMappings` is spelled only inside
 *   `packages/spec` — the four connector packages, the automation engine, REST
 *   and objectui never read it, and nothing anywhere switches on
 *   `transform.type`. Falsification control for the scan: the member-specific
 *   words are findable in the tree (`targetType` 70 hits, `keyField` 66,
 *   `valueField` 260) — the scanner works, the consumers are absent.
 * - **cloud**: NOT verified. This session has no read access to
 *   `objectstack-ai/cloud`, and GitHub code search does not index it (a control
 *   query scoped to that repo returns zero with `incomplete_results`). Recorded
 *   as unverified rather than claimed clean — the #5540 disposition.
 *
 * The `javascript` member is the one that got the defect filed (#5552): its
 * `.describe()` recommended `dialect="js"` while `ExpressionDialect` retired
 * `js` in #3278 (ADR-0058 addendum), so the envelope the doc taught was
 * rejected by the enum, the only spelling that parsed was the bare string —
 * which `ExpressionInputSchema` wraps as `dialect: 'cel'` — and the example it
 * offered (`value.toUpperCase()`) is not valid CEL. The maintainer ruling
 * (2026-08-06) rejected fixing the sentence alone as "gilding a member that
 * cannot run" and ordered enforce-or-remove on the measurement; the
 * measurement came back dead for all five.
 *
 * NOT touched, and the reason the word `transform` survives elsewhere:
 * `data/mapping.zod.ts`'s `ImportFieldMappingSchema.transform` is a different
 * declaration under the same name — a flat string enum steering `params`,
 * applied row by row by `packages/rest/src/import-mapping.ts:115-167` and
 * recorded live in `packages/spec/liveness/mapping.json`. It is also the
 * counter-example that makes this retirement's shape clear: its own
 * `javascript` value is rejected with a 400 because no server sandbox exists —
 * implement-or-reject-loudly, rather than a member that parses and evaporates.
 *
 * Scope of the rewrite: `connectors[].fieldMappings[]` is the only stored
 * source that can carry the key. `ExternalLookupSchema` is not referenced by
 * any stack collection or metadata type, so there is no external-lookup
 * document for the walker to visit; its authorable key is retired by the same
 * tombstone and needs no transform. (That zero-consumer finding then became
 * the whole family's verdict: #8075 retired `data/external-lookup.zod.ts`
 * outright — route 3, D3 `external-lookup-message-queue-families-retired` —
 * and the `data/ExternalFieldMapping:transform` retired-keys entry was
 * subsumed by the def retirement, the WidgetManifest.performance way. The
 * `externalLookup.…` clause in this entry's `surface` stays: it correctly
 * documents what the v16→17 change list removed, and it composes with the def
 * retirement into "delete the whole value".)
 *
 * `retiredFromLoadPath`: the key claims a transformation that never ran, the
 * `connector-rate-limit-config-removed` shape exactly. Absorbing it silently at
 * load would let an author keep believing their values were being cast, mapped
 * or looked up. The entry exists so stored rows replay clean
 * (`applyConversionsToStoredItem`) and `os migrate meta --from 16` rewrites
 * author sources; live parses hit the tombstone.
 */
const fieldMappingTransformRemoved: MetadataConversion = {
  id: 'field-mapping-transform-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'connector.fieldMappings[].transform / externalLookup.fieldMappings[].transform',
  summary:
    "field-mapping key 'transform' removed (#5552 — the whole five-member "
    + 'FieldMappingTransform union went with it: no runtime ever executed constant/cast/'
    + 'lookup/javascript/map, and the javascript member advertised dialect="js", retired '
    + "in #3278. The enforced transform pipeline is the import mapping's string-enum "
    + '`mapping.fieldMapping[].transform`, which is unaffected)',
  apply(stack, emit) {
    return mapCollection(stack, 'connectors', (c, path) => {
      const mappings = c.fieldMappings;
      if (!Array.isArray(mappings)) return c;
      let changed = false;
      const next = mappings.map((m, i) => {
        if (!m || typeof m !== 'object' || Array.isArray(m)) return m;
        const stripped = stripKeys(
          m as Record<string, unknown>,
          ['transform'],
          emit,
          `${path}.fieldMappings[${i}]`,
        );
        if (stripped !== m) changed = true;
        return stripped;
      });
      return changed ? { ...c, fieldMappings: next } : c;
    });
  },
  fixture: {
    before: {
      connectors: [
        {
          name: 'sap_erp',
          label: 'SAP ERP',
          type: 'saas',
          fieldMappings: [
            // The member #5552 was filed about: `dialect: 'js'` was never
            // parseable, so the only authored form is the bare string — which
            // silently meant CEL.
            { source: 'order_value', target: 'order_total', transform: { type: 'javascript', expression: 'value / 100' } },
            // A second member, to show the notice is per mapping entry and not
            // per union member.
            { source: 'Status', target: 'status', transform: { type: 'map', mappings: { Active: 'active' } } },
            // A mapping that never authored the key keeps its identity — the
            // copy-on-write contract `stripKeys` / `mapCollection` are built on.
            { source: 'E-mail', target: 'email', defaultValue: '' },
          ],
        },
        // A connector with no field mappings at all is untouched.
        { name: 'crm_sync', label: 'CRM Sync', type: 'saas' },
      ],
    },
    after: {
      connectors: [
        {
          name: 'sap_erp',
          label: 'SAP ERP',
          type: 'saas',
          fieldMappings: [
            { source: 'order_value', target: 'order_total' },
            { source: 'Status', target: 'status' },
            { source: 'E-mail', target: 'email', defaultValue: '' },
          ],
        },
        { name: 'crm_sync', label: 'CRM Sync', type: 'saas' },
      ],
    },
    expectedNotices: 2,
  },
};

/**
 * The nine theme token groups that were EMITTED and read by nobody (#5021,
 * ADR-0049).
 *
 * The distinguishing fact, and the reason #3494 could not reach these: that
 * round's criterion was "the theme engine never emits a variable for this key",
 * which retired `spacing` / `breakpoints` / `density` / `wcagContrast` and five
 * more. These eight keys pass that test — objectui's `generateThemeVars` walks
 * every one of them and puts `--font-size-*`, `--font-weight-*`,
 * `--line-height-*`, `--letter-spacing-*`, `--duration-*`, `--timing-*`,
 * `--z-*`, `--font-heading` and `--font-mono` on the document, exactly as
 * declared. What does not exist is a READER: measured against objectui `main`
 * on 2026-08-04, all nine groups have zero consumers across `packages/**`,
 * while `--font-sans`, `--radius*`, `--shadow*` and the colour variables come
 * back live in the same run. So the author's type scale was real CSS that
 * styled nothing.
 *
 * A CSS custom property is genuinely weaker evidence than a spec key here — a
 * tenant's own stylesheet CAN read a variable the platform ignores — and that
 * is precisely why the prescription is `customVars` rather than a bare "sorry".
 * `customVars` emits `--<key>: <value>` verbatim, so every one of these
 * variables is reproducible byte for byte. The retirement removes a semantic
 * vocabulary the platform never honoured; it removes no capability.
 *
 * ⚠️ This STRIPS rather than rewriting into `customVars`, and that is the
 * deliberate half of the design. A mechanical rewrite is possible (stringify
 * the numbers, reconstruct `--z-<key>` / `--timing-<key>` names) and was
 * rejected: it would hand back ~25 `customVars` entries that still nothing
 * reads, converting a dead semantic slot into a dead literal one and making the
 * retirement invisible — the #4583 shape. The notice tells the author exactly
 * which keys went and the tombstone tells them where to put back the ones they
 * actually consume, which is a decision only they can make. Measured input to
 * that choice: `examples/**` and `apps/**` author ZERO of these keys today (the
 * showcase's two themes declare `colors` only), so there is no in-repo body of
 * authored config a rewrite would have saved.
 *
 * `retiredFromLoadPath`: the schema tombstones each key with its prescription,
 * so a live parse rejects loudly and only `os migrate meta --from 16` rewrites
 * sources. Absorbing these at load would let an author keep believing they had
 * configured a type scale.
 */
const themeInertTokenScalesRemoved: MetadataConversion = {
  id: 'theme-inert-token-scales-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface:
    'theme.typography.fontSize / theme.typography.fontWeight / theme.typography.lineHeight'
    + ' / theme.typography.letterSpacing / theme.typography.fontFamily.heading'
    + ' / theme.typography.fontFamily.mono / theme.animation / theme.zIndex',
  summary:
    "theme keys 'typography.fontSize'/'fontWeight'/'lineHeight'/'letterSpacing', "
    + "'typography.fontFamily.heading'/'mono', 'animation' and 'zIndex' removed "
    + '(#5021, ADR-0049 — the engine emitted --font-size-*, --font-weight-*, --line-height-*, '
    + '--letter-spacing-*, --duration-*, --timing-*, --z-*, --font-heading and --font-mono '
    + 'faithfully, and no first-party component or stylesheet has ever read one. '
    + 'Re-declare any variable you actually consume under customVars, which emits it verbatim)',
  apply(stack, emit) {
    return mapCollection(stack, 'themes', (theme, path) => {
      let next = stripKeys(theme, ['animation', 'zIndex'], emit, path);

      // `typography` is one level down, and `fontFamily` two — `stripKeys` is
      // top-level only, so each nesting level is walked explicitly and
      // copy-on-write is preserved at every level (an untouched theme keeps its
      // identity, which is what `mapCollection` tests for).
      const typography = next.typography;
      if (typography && typeof typography === 'object' && !Array.isArray(typography)) {
        const typo = typography as Record<string, unknown>;
        let nextTypo = stripKeys(
          typo,
          ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'],
          emit,
          `${path}.typography`,
        );

        const fontFamily = nextTypo.fontFamily;
        if (fontFamily && typeof fontFamily === 'object' && !Array.isArray(fontFamily)) {
          const nextFamily = stripKeys(
            fontFamily as Record<string, unknown>,
            ['heading', 'mono'],
            emit,
            `${path}.typography.fontFamily`,
          );
          if (nextFamily !== fontFamily) nextTypo = { ...nextTypo, fontFamily: nextFamily };
        }

        if (nextTypo !== typo) next = { ...next, typography: nextTypo };
      }

      return next;
    });
  },
  fixture: {
    before: {
      themes: [
        {
          name: 'corporate',
          label: 'Corporate',
          colors: { primary: '#7C3AED' },
          typography: {
            fontFamily: { base: 'Inter, sans-serif', heading: 'Georgia, serif', mono: 'ui-monospace' },
            fontSize: { base: '1rem', lg: '1.125rem' },
            fontWeight: { normal: 400, bold: 700 },
            lineHeight: { normal: '1.5' },
            letterSpacing: { wide: '0.025em' },
          },
          animation: { duration: { fast: '150ms' }, timing: { ease: 'cubic-bezier(0.4, 0, 0.2, 1)' } },
          zIndex: { modal: 1050 },
        },
        // A theme that authored none of them keeps its identity — the
        // copy-on-write contract `stripKeys` / `mapCollection` are built on.
        { name: 'minimal', label: 'Minimal', colors: { primary: '#000000' } },
      ],
    },
    after: {
      themes: [
        {
          name: 'corporate',
          label: 'Corporate',
          colors: { primary: '#7C3AED' },
          // `fontFamily` SURVIVES with `base` alone: it is the one font-family
          // key with a live consumer (`--font-sans`). The block is not removed,
          // only narrowed — which is why the fixture keeps it rather than
          // dropping `typography` wholesale.
          typography: { fontFamily: { base: 'Inter, sans-serif' } },
        },
        { name: 'minimal', label: 'Minimal', colors: { primary: '#000000' } },
      ],
    },
    // One notice per KEY, not per stop and not per theme: eight keys authored
    // on the first theme, zero on the second.
    expectedNotices: 8,
  },
};

/**
 * The two spellings of the page-header node, both converted by
 * {@link pageHeaderSubtitleAlias}.
 *
 * `page:header` is the protocol type (`PageComponentType`, `ComponentPropsMap`);
 * `page-header` is objectui's kebab legacy alias (`@object-ui/layout`), which is
 * authorable here because `PageComponentSchema.type` is deliberately
 * `z.union([PageComponentType, z.string()])` — an open namespace for custom
 * components.
 */
const PAGE_HEADER_COMPONENT_TYPES = new Set(['page:header', 'page-header']);

/**
 * Page-header component prop `description` → `subtitle` (protocol 17,
 * objectui#3226 / #4827).
 *
 * One concept — the page's second line — carried two authorable spellings, one
 * per renderer. `@objectstack/spec`'s `PageHeaderProps` (`ui/component.zod.ts`)
 * declares `subtitle` and nothing else; objectui's kebab legacy alias
 * `page-header` advertised `description` in its registration `inputs` and its
 * renderer read a bare `subtitle ?? description`. That is the Prime Directive
 * #12 shape exactly: a producer dialect held up by a consumer fallback, with
 * the registry teaching the off-spec key on the way in.
 *
 * **Why a conversion and not a deletion** — the load-bearing half of this
 * entry. The alias's entire reason to exist is out-of-repo consumer schemas,
 * so "no in-repo author writes `description`" is not evidence that nobody
 * does; on this key in particular, in-repo evidence has zero coverage.
 * Deleting the consumer read would drop those pages' second line *silently* —
 * the title still renders, one line vanishes, nothing errors — which is the
 * least reportable failure shape there is. So the alias retires the ADR-0087
 * D2 way instead: rewritten to the canonical key at load, and at every stored
 * row's rehydration (`applyConversionsToStoredItem` walks `pages` for free),
 * declared, loud, tested and expiring. objectui#3226 deletes its `??` once
 * this ships.
 *
 * **Both spellings of the node are converted**, deliberately. `page-header` is
 * the alias the fallback served; `page:header` is the canonical type, where an
 * authored `description` is *already* dropped on the floor today because that
 * renderer only ever read `subtitle` — the same defect, one spelling over. The
 * alias here is the KEY, not the type: this entry does **not** rewrite
 * `page-header` → `page:header`. That registration is objectui's to retire, on
 * its own schedule, and rewriting a type over an open namespace is the class of
 * move {@link flowNodeHttpRename}'s conflict guard exists for.
 *
 * Precedence is the house rule {@link renameKey} encodes and nothing new: an
 * already-canonical `subtitle` WINS, and the shadowed `description` is left
 * exactly where it sits — unconverted, unreported, unremoved — as in
 * {@link flowNodeCrudObjectAlias}. Only header nodes are touched: `description`
 * is a live declared prop elsewhere on the same surface (`element:text_input`
 * helper text), and those components are not this entry's business.
 *
 * **This entry is why the walker's reach had to grow (#6775).** Every other
 * page-component entry leans on a tombstone to cover the sites a conversion
 * cannot reach; this one has none to lean on, because `description` stays a
 * live declared prop on other components, so `properties.description` parses
 * green at ANY position. Until the walker descended into `slots.*` (#6776) and
 * into container `properties` (#6775), a header on a `kind: 'slotted'` record
 * page or inside a card/tab panel was rewritten by nobody and reported by
 * nobody — and objectui's `subtitle ?? description` fallback could not retire
 * without those pages silently losing their second line, the exact failure
 * shape this entry exists to prevent. The fixture pins all three positions.
 *
 * **Live window**; retires at 18.
 */
const pageHeaderSubtitleAlias: MetadataConversion = {
  id: 'page-header-subtitle-alias',
  toMajor: 17,
  surface: 'page.component.page-header.description',
  summary:
    "page-header component prop 'description' → 'subtitle' (objectui#3226 — the `subtitle ?? description` fallback retires)",
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      const type = component.type;
      if (typeof type !== 'string' || !PAGE_HEADER_COMPONENT_TYPES.has(type)) return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const renamed = renameKey(properties, 'description', 'subtitle');
      if (!renamed) return component;
      emit({ from: 'description', to: 'subtitle', path: `${path}.properties.subtitle` });
      return { ...component, properties: renamed };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'crm_lead_detail',
          regions: [
            {
              name: 'header',
              components: [
                // The kebab legacy alias — the spelling the `??` fallback served.
                { type: 'page-header', properties: { title: 'Leads', description: 'All open leads' } },
                // The canonical type authored with the legacy key: converted too,
                // because today this second line is dropped on the floor.
                { type: 'page:header', properties: { title: 'Lead', description: 'One lead' } },
                // Both spellings, DIFFERENT text (#4923): kept, so the author
                // reconciles the two second lines rather than the loader picking.
                { type: 'page:header', properties: { title: 'Both', subtitle: 'wins', description: 'other' } },
                // `description` is this component's OWN declared prop (helper text) — untouched.
                { type: 'element:text_input', properties: { label: 'Note', description: 'Helper text' } },
              ],
            },
          ],
        },
        // The slotted record page — `regions: []`, header in a named slot. This
        // is the shape objectui's own guide prescribes for a customized record
        // header, and a region-only walk visited none of it (#6776).
        {
          name: 'crm_account_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            header: { type: 'page:header', properties: { title: '{name}', description: 'Account overview' } },
          },
        },
        // Container nesting (#6775): a header inside a card's `children`, one in
        // its `footer`, one inside a tab panel, and one two levels down. All are
        // spec-valid (`properties` is an open bag) and all were invisible to the
        // region-only walk — with no tombstone to catch them at parse time.
        {
          name: 'crm_pipeline_dashboard',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'page:card',
                  properties: {
                    title: 'Pipeline',
                    children: [
                      { type: 'page-header', properties: { title: 'Open', description: 'This quarter' } },
                    ],
                    footer: [
                      { type: 'page:header', properties: { title: 'Closed', description: 'Last quarter' } },
                    ],
                  },
                },
                {
                  type: 'page:tabs',
                  properties: {
                    tabStyle: 'line',
                    items: [
                      {
                        label: 'Activity',
                        children: [
                          { type: 'page:header', properties: { title: 'Recent', description: 'Last 7 days' } },
                          // Two levels down — the recursion, not just one hop.
                          {
                            type: 'page:card',
                            properties: {
                              children: [
                                { type: 'page:header', properties: { title: 'Nested', description: 'Deep' } },
                              ],
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'crm_lead_detail',
          regions: [
            {
              name: 'header',
              components: [
                { type: 'page-header', properties: { title: 'Leads', subtitle: 'All open leads' } },
                { type: 'page:header', properties: { title: 'Lead', subtitle: 'One lead' } },
                { type: 'page:header', properties: { title: 'Both', subtitle: 'wins', description: 'other' } },
                { type: 'element:text_input', properties: { label: 'Note', description: 'Helper text' } },
              ],
            },
          ],
        },
        {
          name: 'crm_account_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            header: { type: 'page:header', properties: { title: '{name}', subtitle: 'Account overview' } },
          },
        },
        {
          name: 'crm_pipeline_dashboard',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'page:card',
                  properties: {
                    title: 'Pipeline',
                    children: [
                      { type: 'page-header', properties: { title: 'Open', subtitle: 'This quarter' } },
                    ],
                    footer: [
                      { type: 'page:header', properties: { title: 'Closed', subtitle: 'Last quarter' } },
                    ],
                  },
                },
                {
                  type: 'page:tabs',
                  properties: {
                    tabStyle: 'line',
                    items: [
                      {
                        label: 'Activity',
                        children: [
                          { type: 'page:header', properties: { title: 'Recent', subtitle: 'Last 7 days' } },
                          {
                            type: 'page:card',
                            properties: {
                              children: [
                                { type: 'page:header', properties: { title: 'Nested', subtitle: 'Deep' } },
                              ],
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    expectedNotices: 7,
  },
};

/**
 * The SDUI component-props reconciliation (protocol 17, #5775) — three entries
 * below, one shared reason.
 *
 * #5068 wired the first parse `ComponentPropsMap` ever had and measured what
 * the corpus actually authors against it. The measurement came back with
 * divergence in BOTH directions: keys objectui's renderers honour that the
 * schema never declared, and keys the schema declared (one of them REQUIRED)
 * that no renderer has ever read. The maintainer's 2026-08-06 ruling took
 * direction A — the #5611 rule, "the delivered and authorized shape is the
 * contract" — so the honoured keys were declared and the unread ones retire
 * here.
 *
 * **The reach is every position a picker can be authored in** (#6775).
 * {@link mapPageComponents} walks `regions[].components[]`, `slots.<slot>` and
 * the containers a component nests under its `properties` — the same set
 * `walkPageComponents` lints — so a picker inside a card's `children` or a tab
 * panel is rewritten where it sits. The tombstones still carry the refusal at
 * parse time for anything a conversion declines to touch (a disagreeing pair
 * under {@link renameKey}'s house rule, or a source no migration ran over);
 * what changed is that "run `os migrate meta`" is now a promise the rewrite can
 * keep at a nested site, not only at region level.
 *
 * All three are **retired from the load path**: each key is tombstoned in
 * `ui/component.zod.ts`, so the loader rejects it loudly with the prescription
 * and only `os migrate meta` rewrites sources.
 */
const RECORD_PICKER_COMPONENT_TYPE = 'element:record_picker';

/**
 * `element:record_picker.displayField` → `labelField` (protocol 17, #5775).
 *
 * Two spellings of one concept — "which field is the row's text" — of which the
 * schema required the one nobody reads. `record-picker.tsx` resolves
 * `props.labelField ?? 'name'` and renders `row[labelField]`; `displayField`
 * appears nowhere in that renderer, and objectui's own component registry
 * publishes `labelField` as the designer input. So an author who followed the
 * schema and wrote `displayField: 'title'` got a picker listing `name`, with a
 * success receipt and no diagnostic anywhere — the ADR-0078 shape.
 *
 * A rename rather than a deletion because the two keys are synonyms: the value
 * (a field name) is exactly what `labelField` wants. Precedence is
 * {@link renameKey}'s house rule (#4923) and nothing new — a redundant twin is
 * dropped, a DISAGREEING pair is left for the author to reconcile rather than
 * the loader picking a field.
 */
const recordPickerDisplayFieldToLabelField: MetadataConversion = {
  id: 'record-picker-display-field-to-label-field',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'page.component.element:record_picker.displayField',
  summary:
    "record-picker component prop 'displayField' → 'labelField' (#5775 — the required key no renderer read; `labelField ?? 'name'` is what renders the row)",
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== RECORD_PICKER_COMPONENT_TYPE) return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const renamed = renameKey(properties, 'displayField', 'labelField');
      if (!renamed) return component;
      emit({ from: 'displayField', to: 'labelField', path: `${path}.properties.labelField` });
      return { ...component, properties: renamed };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'showcase_page_variables',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'element:record_picker', properties: { object: 'showcase_project', displayField: 'title' } },
                // Both spellings, SAME value: the redundant twin goes (#4923).
                { type: 'element:record_picker', properties: { object: 'a', labelField: 'name', displayField: 'name' } },
                // Both spellings, DIFFERENT fields: kept, so the author reconciles
                // the two rather than the loader picking a column.
                { type: 'element:record_picker', properties: { object: 'b', labelField: 'name', displayField: 'title' } },
                // `displayField` is a live LOOKUP-FIELD key elsewhere on the
                // surface — a different component's business, untouched here.
                { type: 'element:form', properties: { object: 'c', displayField: 'title' } },
                // Nested one container down (#6775) — a picker inside a card is
                // where a form-shaped page actually puts one.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Link a project',
                    children: [
                      { type: 'element:record_picker', properties: { object: 'd', displayField: 'code' } },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // A slotted page's named slot — same component, other authoring shape.
        {
          name: 'showcase_project_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: [
              { type: 'element:record_picker', properties: { object: 'e', displayField: 'label' } },
            ],
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'showcase_page_variables',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'element:record_picker', properties: { object: 'showcase_project', labelField: 'title' } },
                { type: 'element:record_picker', properties: { object: 'a', labelField: 'name' } },
                { type: 'element:record_picker', properties: { object: 'b', labelField: 'name', displayField: 'title' } },
                { type: 'element:form', properties: { object: 'c', displayField: 'title' } },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Link a project',
                    children: [
                      { type: 'element:record_picker', properties: { object: 'd', labelField: 'code' } },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'showcase_project_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: [
              { type: 'element:record_picker', properties: { object: 'e', labelField: 'label' } },
            ],
          },
        },
      ],
    },
    expectedNotices: 4,
  },
};

/**
 * `element:record_picker.searchFields` / `.multiple` — declared capabilities the
 * control does not have (protocol 17, #5775, ADR-0049).
 *
 * The renderer is a shadcn `Select` over a `find()` result: no search input
 * exists, so `searchFields` narrowed nothing, and the control is single-choice
 * writing ONE id into the bound page variable, so `multiple: true` selected
 * nothing extra while reporting success. Neither key has a reader anywhere in
 * objectui. Enforce-or-remove: they are removed, not deprecated, and either
 * returns the day the capability is implemented (#5021 / #4988 precedent).
 *
 * Pure lossless deletes — neither key ever had an effect to lose.
 */
const recordPickerInertKeysRemoved: MetadataConversion = {
  id: 'record-picker-inert-keys-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'page.component.element:record_picker.searchFields / page.component.element:record_picker.multiple',
  summary:
    "record-picker component props 'searchFields'/'multiple' removed (#5775 — the control is a plain single-select with no search box; neither key had a reader)",
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== RECORD_PICKER_COMPONENT_TYPE) return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const stripped = stripKeys(properties, ['searchFields', 'multiple'], emit, `${path}.properties`);
      if (stripped === properties) return component;
      return { ...component, properties: stripped };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'picker_gallery',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'element:record_picker',
                  properties: { object: 'showcase_project', searchFields: ['name', 'code'], multiple: true },
                },
                // `multiple` is a live FIELD key (lookup fields) — a different
                // surface entirely, and not this entry's business.
                { type: 'element:form', properties: { object: 'a', multiple: true } },
                // Inside a tab panel (#6775): `page:tabs` hangs its sub-tree off
                // `properties.items[].children`, which the walk now descends.
                {
                  type: 'page:tabs',
                  properties: {
                    tabStyle: 'line',
                    items: [
                      {
                        label: 'Pick one',
                        children: [
                          { type: 'element:record_picker', properties: { object: 'b', multiple: true } },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // The named-slot shape, on a slotted record page.
        {
          name: 'picker_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: { type: 'element:record_picker', properties: { object: 'c', searchFields: ['name'] } },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'picker_gallery',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'element:record_picker', properties: { object: 'showcase_project' } },
                { type: 'element:form', properties: { object: 'a', multiple: true } },
                {
                  type: 'page:tabs',
                  properties: {
                    tabStyle: 'line',
                    items: [
                      {
                        label: 'Pick one',
                        children: [
                          { type: 'element:record_picker', properties: { object: 'b' } },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'picker_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: { type: 'element:record_picker', properties: { object: 'c' } },
          },
        },
      ],
    },
    expectedNotices: 4,
  },
};

/**
 * `page:card.body` → `children` (protocol 17, #5775).
 *
 * Every container on this surface composes through `children` — `grid`,
 * `flex`, `page:section`, `page:accordion` items, `page:tabs` items — and the
 * card renderer reads `schema.body ?? schema.children` with its own comment
 * saying authors expect `children` to work here too. The showcase's two cards
 * author `children`. Only the declaration said `body`, which made the #5068
 * gate report the showcase's own correct pages as authoring an unknown key.
 *
 * Converging on `children` rather than declaring both: one composition key, not
 * two de-facto contracts (Prime Directive #12). `footer` is a genuinely
 * distinct slot and is untouched. The renderer keeps its `body ??` fallback for
 * stored documents — that is objectui's to retire on its own schedule, exactly
 * as {@link pageHeaderSubtitleAlias} left the kebab `page-header` registration
 * alone.
 */
const pageCardBodyToChildren: MetadataConversion = {
  id: 'page-card-body-to-children',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'page.component.page:card.body',
  summary:
    "page:card component prop 'body' → 'children' (#5775 — one composition key across every container; the card renderer already reads both)",
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'page:card') return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const renamed = renameKey(properties, 'body', 'children');
      if (!renamed) return component;
      emit({ from: 'body', to: 'children', path: `${path}.properties.children` });
      return { ...component, properties: renamed };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'my_work',
          regions: [
            {
              name: 'sidebar',
              components: [
                {
                  type: 'page:card',
                  properties: { title: 'Shortcuts', body: [{ type: 'element:text' }], footer: [{ type: 'element:text' }] },
                },
                // Both spellings, DIFFERENT content: kept, so the author picks
                // which body the card should have.
                {
                  type: 'page:card',
                  properties: { children: [{ type: 'element:text' }], body: [{ type: 'element:image' }] },
                },
                // `body` on a component that is not a card — not this entry's key.
                { type: 'record:alert', properties: { body: 'Confirm the work before marking it done.' } },
                // A card nested in a card (#6775). The OUTER rename moves the
                // sub-tree from `body` to `children`, and the descent reads the
                // MAPPED component, so the inner card is visited exactly once —
                // under the canonical key, not once per spelling.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Outer',
                    body: [
                      { type: 'page:card', properties: { title: 'Inner', body: [{ type: 'element:text' }] } },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // The named-slot shape: a card authored into a slotted page's `details`.
        {
          name: 'my_work_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: { type: 'page:card', properties: { title: 'Detail', body: [{ type: 'element:text' }] } },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'my_work',
          regions: [
            {
              name: 'sidebar',
              components: [
                {
                  type: 'page:card',
                  properties: { title: 'Shortcuts', children: [{ type: 'element:text' }], footer: [{ type: 'element:text' }] },
                },
                {
                  type: 'page:card',
                  properties: { children: [{ type: 'element:text' }], body: [{ type: 'element:image' }] },
                },
                { type: 'record:alert', properties: { body: 'Confirm the work before marking it done.' } },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Outer',
                    children: [
                      { type: 'page:card', properties: { title: 'Inner', children: [{ type: 'element:text' }] } },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'my_work_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: { type: 'page:card', properties: { title: 'Detail', children: [{ type: 'element:text' }] } },
          },
        },
      ],
    },
    expectedNotices: 4,
  },
};

/**
 * Inline `type:'api'` action: object-form `params` → `bodyExtra` (protocol 17,
 * #5777).
 *
 * One key carried two fact-contracts. `InlineActionSchema.params` is picked
 * from `ActionSchema` and is an `ActionParam[]` **definition array** — the
 * fields a dialog collects before the action runs. What the showcase's
 * pure-SDUI contact form authored on its submit button is a **request payload
 * map** (`params: { name: '{{page.inquiryName}}', … }`), and objectui's
 * `ActionRunner` took both: its own comment says "Accept both — when `params`
 * is an array, treat it as the input-collection definition", discriminating on
 * `Array.isArray`. A tolerant consumer fossilizing a wrong convention is Prime
 * Directive #12's exact shape, and here the fossil was load-bearing: the
 * generated reference could only describe the array, so an author following the
 * docs could not write a working `api` submit button at all.
 *
 * The maintainer's 2026-08-06 ruling on #5777 took **direction A — a separate
 * payload key**, explicitly refusing the same-name union of option B. The
 * separate key is `bodyExtra`, which `ActionSchema` has declared all along for
 * exactly this ("static body fragment merged into the outgoing request body for
 * `type:'api'` actions"); #5777's spec half picks it onto the inline shape, so
 * the rewrite target is a key the contract already owns rather than a third
 * name. `payload` is already an alias pointing there (#5013) and `body` is
 * already the `script` hook body, so those two spellings were never available.
 *
 * **Why a conversion and not a deletion.** The two shapes are disjoint —
 * `Array.isArray` decides, with no value that could be read either way — so the
 * rewrite is mechanical and lossless, which is the ADR-0087 D2 precondition.
 * Deleting instead would strand every page authored the old way on a bare
 * `expected array, received object`.
 *
 * **Scoped to `type:'api'`, deliberately.** Object-form `params` on an inline
 * `type:'url'` action is a THIRD meaning again — `ActionRunner.interpolateTarget`
 * reads it as the `${param.X}` interpolation scope, and `executeUrl` reads
 * `params.newTab` — so rewriting those into an api request body would be lossy,
 * not lossless. Nothing in the reachable corpus authors that shape; it stays
 * refused by the array-only field, and this entry does not touch it.
 *
 * **Not extended to registered actions.** `ActionSchema` is parsed at
 * `defineAction`, so its array-only `params` has always refused the object form
 * at the authoring door — the defect existed only on the inline path, where
 * `PageComponent.properties` is an open bag and nothing parsed the props until
 * #5068. Registered actions already reach the payload through `bodyExtra`.
 *
 * Precedence is {@link renameKey}'s house rule and nothing new: an
 * already-present `bodyExtra` WINS and a differing object-form `params` is left
 * exactly where it sits, for the author to reconcile (#4923).
 *
 * The reach is every position a button can be authored in, as for
 * {@link pageHeaderSubtitleAlias} and {@link pageCardBodyToChildren} (#6775):
 * `regions[].components[]`, `slots.<slot>`, and the containers a component
 * nests under its `properties` — which is where a submit button most often
 * sits, inside the card that holds the form. The array-only field still covers
 * anything the rewrite declines to touch: it refuses the object form with a
 * message naming `bodyExtra`, at any position.
 *
 * **Live window**; retires at 18.
 */
const inlineActionApiParamsToBodyExtra: MetadataConversion = {
  id: 'inline-action-api-params-to-body-extra',
  toMajor: 17,
  surface: 'page.component.element:button.action.params',
  summary:
    "inline type:'api' action prop 'params' (object form) → 'bodyExtra' (#5777 — the payload gets its own key; `params` stays the ActionParam[] definition array)",
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'element:button') return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const action = properties.action;
      if (!isDict(action)) return component;
      // Only the payload meaning converts. `Array.isArray` is the whole
      // discriminator — a definition array stays put — and the `api` guard
      // keeps the url-action interpolation scope out of it.
      if (action.type !== 'api') return component;
      if (!isDict(action.params)) return component;
      const renamed = renameKey(action, 'params', 'bodyExtra');
      if (!renamed) return component;
      emit({ from: 'params', to: 'bodyExtra', path: `${path}.properties.action.bodyExtra` });
      return { ...component, properties: { ...properties, action: renamed } };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'showcase_contact_form',
          regions: [
            {
              name: 'main',
              components: [
                // The measured site: a pure-SDUI form submit posting page vars.
                {
                  type: 'element:button',
                  properties: {
                    label: 'Submit inquiry',
                    action: {
                      type: 'api',
                      target: '/api/v1/forms/contact-us/submit',
                      method: 'POST',
                      params: { name: '{{page.inquiryName}}', email: '{{page.inquiryEmail}}' },
                    },
                  },
                },
                // A real ActionParam[] definition array — the other meaning of
                // the same key, untouched.
                {
                  type: 'element:button',
                  properties: {
                    label: 'Close order',
                    action: {
                      type: 'api',
                      target: '/api/v1/sales_order/close',
                      params: [{ name: 'reason', label: 'Reason', type: 'text' }],
                    },
                  },
                },
                // Both spellings, DIFFERENT payloads: kept, so the author
                // reconciles the two bodies rather than the loader picking.
                {
                  type: 'element:button',
                  properties: {
                    label: 'Both',
                    action: {
                      type: 'api',
                      target: '/api/v1/x',
                      params: { a: 1 },
                      bodyExtra: { b: 2 },
                    },
                  },
                },
                // `type:'url'` — object-form `params` is the `${param.X}`
                // interpolation scope there, a third meaning. Not this entry's.
                {
                  type: 'element:button',
                  properties: {
                    label: 'Open',
                    action: { type: 'url', target: '/x?id=${param.id}', params: { id: 'abc' } },
                  },
                },
                // The shape a pure-SDUI form is actually built in (#6775): the
                // submit button sits in the card's `footer`, one container down.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Contact us',
                    footer: [
                      {
                        type: 'element:button',
                        properties: {
                          label: 'Send',
                          action: { type: 'api', target: '/api/v1/forms/send', params: { note: '{{page.note}}' } },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // The named-slot shape: an action button in a slotted page's `actions`.
        {
          name: 'showcase_contact_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            actions: [
              {
                type: 'element:button',
                properties: {
                  label: 'Resend',
                  action: { type: 'api', target: '/api/v1/forms/resend', params: { id: '{{record.id}}' } },
                },
              },
            ],
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'showcase_contact_form',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'element:button',
                  properties: {
                    label: 'Submit inquiry',
                    action: {
                      type: 'api',
                      target: '/api/v1/forms/contact-us/submit',
                      method: 'POST',
                      bodyExtra: { name: '{{page.inquiryName}}', email: '{{page.inquiryEmail}}' },
                    },
                  },
                },
                {
                  type: 'element:button',
                  properties: {
                    label: 'Close order',
                    action: {
                      type: 'api',
                      target: '/api/v1/sales_order/close',
                      params: [{ name: 'reason', label: 'Reason', type: 'text' }],
                    },
                  },
                },
                {
                  type: 'element:button',
                  properties: {
                    label: 'Both',
                    action: {
                      type: 'api',
                      target: '/api/v1/x',
                      params: { a: 1 },
                      bodyExtra: { b: 2 },
                    },
                  },
                },
                {
                  type: 'element:button',
                  properties: {
                    label: 'Open',
                    action: { type: 'url', target: '/x?id=${param.id}', params: { id: 'abc' } },
                  },
                },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Contact us',
                    footer: [
                      {
                        type: 'element:button',
                        properties: {
                          label: 'Send',
                          action: { type: 'api', target: '/api/v1/forms/send', bodyExtra: { note: '{{page.note}}' } },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'showcase_contact_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            actions: [
              {
                type: 'element:button',
                properties: {
                  label: 'Resend',
                  action: { type: 'api', target: '/api/v1/forms/resend', bodyExtra: { id: '{{record.id}}' } },
                },
              },
            ],
          },
        },
      ],
    },
    expectedNotices: 3,
  },
};

/**
 * `page:tabs.type` → `tabStyle` (protocol 17, #6776).
 *
 * The concept — the tab strip's visual style, `line` | `card` | `pill` — was
 * declared all along. What was wrong is the **spelling**: a props key named
 * `type` sits on the one name a page component cannot spare, because the node's
 * own dispatch key is `type` too. Three independently-measured consequences on
 * objectui `origin/main`, none of them cosmetic:
 *
 *   - `SchemaRenderer.tsx:253,264` hoists `properties` onto the node but skips
 *     `type` and `id` explicitly, or the inner value would shadow which
 *     renderer to dispatch to. Its comment names this very case ("tab visual
 *     style: 'line' | 'card' | 'pill'").
 *   - `sdui-parser`'s `BASE_PROPS` (`validate.ts:20-30`) contains `'type'`, and
 *     `validate.ts:68` `continue`s on any base prop — so a manifest input named
 *     `type` is skipped before the unknown/typed checks and is never validated.
 *   - In the flat and JSX carriers a node reads
 *     `{ type: 'page:tabs', items: […], tabStyle: 'card' }` — `type` is the tag
 *     name, and the spec's spelling has nowhere left to go.
 *
 * So `tabStyle` is not drift: it is the only spelling those carriers can
 * express, it is what objectui's registry publishes as the designer input, and
 * `containers.tsx:381` reads BOTH (`schema?.properties?.type || schema?.tabStyle`).
 * Converging on the spelling the renderer reads — rather than the one that
 * declares well — is exactly {@link recordPickerDisplayFieldToLabelField}'s
 * shape (#5775), and one spelling rather than two is Prime Directive #12. The
 * alternative considered and refused was declaring `tabStyle` as an alias of
 * `type`: that fossilizes a second dialect for one concept, and the dialect
 * that would survive is the one that silently fails to validate.
 *
 * A rename rather than a deletion because the two keys are synonyms down to the
 * value vocabulary — the same three-value enum, no re-mapping. Precedence is
 * {@link renameKey}'s house rule (#4923): a redundant twin is dropped, a
 * DISAGREEING pair is left for the author to reconcile rather than the loader
 * picking a look.
 *
 * The reach is every position, as for {@link pageCardBodyToChildren} (#6775):
 * a `page:tabs` nested inside another component's `properties` is rewritten
 * where it sits. The discriminator matters more here than anywhere else, since
 * the key being renamed shares a name with the node's dispatch key — so the
 * fixture pins that descending into a props bag does NOT turn some other
 * component's inner `type` (an action's `type: 'url'`, a tab item's fields)
 * into a rewrite target: only `properties.type` on a node whose own `type` is
 * `page:tabs` moves. The tombstone still carries the refusal at the authoring
 * site (`tsc`) and at load (the parse), whatever the walk reached.
 *
 * `retiredFromLoadPath: true`: no alias window, deliberately. The tombstone owns
 * the refusal; this entry exists so `spec-changes.json`, the upgrade guide and
 * `os migrate meta` still carry the rewrite.
 */
const pageTabsTypeToTabStyle: MetadataConversion = {
  id: 'page-tabs-type-to-tab-style',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'page.component.page:tabs.type',
  summary:
    "page:tabs component prop 'type' → 'tabStyle' (#6776 — a props key named `type` collides with the node's dispatch key and is unauthorable in flat/JSX carriers; `tabStyle` is the spelling the renderer reads in all of them)",
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'page:tabs') return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const renamed = renameKey(properties, 'type', 'tabStyle');
      if (!renamed) return component;
      emit({ from: 'type', to: 'tabStyle', path: `${path}.properties.tabStyle` });
      return { ...component, properties: renamed };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'sys_position_detail',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'page:tabs', properties: { type: 'card', items: [{ label: 'Holders' }] } },
                // Both spellings, SAME value: the redundant twin goes (#4923).
                { type: 'page:tabs', properties: { tabStyle: 'pill', type: 'pill', items: [] } },
                // Both spellings, DIFFERENT looks: kept, so the author picks one
                // rather than the loader picking for them.
                { type: 'page:tabs', properties: { tabStyle: 'pill', type: 'card', items: [] } },
                // A `type` one level down inside another component's properties
                // is a different key entirely: `action.type` is the action's
                // discriminator, and the walk descends into CONTAINER keys
                // (`children` / `items[].children` / `body` / `footer`), never
                // into an arbitrary props value.
                {
                  type: 'element:button',
                  properties: { label: 'Open', action: { type: 'url', target: '/x' } },
                },
                // Tabs nested in a card, and tabs inside a tab panel (#6775):
                // the rewrite reaches both, and the outer strip's own `items`
                // stay ordinary tab records, not components.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Related',
                    children: [
                      { type: 'page:tabs', properties: { type: 'pill', items: [{ label: 'Notes' }] } },
                    ],
                  },
                },
                {
                  type: 'page:tabs',
                  properties: {
                    tabStyle: 'line',
                    items: [
                      {
                        label: 'Nested',
                        children: [
                          { type: 'page:tabs', properties: { type: 'card', items: [] } },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // The shape this key is really authored in: `page:tabs` IS one of the
        // seven named slots, and all four in-repo sites are `slots.tabs` on a
        // `kind: 'slotted'` record page. Region-only reach would have missed
        // every one of them (#6776 — see `mapPageComponents`).
        {
          name: 'sys_user_detail',
          regions: [],
          slots: {
            tabs: { type: 'page:tabs', properties: { type: 'line', position: 'top', items: [] } },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'sys_position_detail',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'page:tabs', properties: { tabStyle: 'card', items: [{ label: 'Holders' }] } },
                { type: 'page:tabs', properties: { tabStyle: 'pill', items: [] } },
                { type: 'page:tabs', properties: { tabStyle: 'pill', type: 'card', items: [] } },
                {
                  type: 'element:button',
                  properties: { label: 'Open', action: { type: 'url', target: '/x' } },
                },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Related',
                    children: [
                      { type: 'page:tabs', properties: { tabStyle: 'pill', items: [{ label: 'Notes' }] } },
                    ],
                  },
                },
                {
                  type: 'page:tabs',
                  properties: {
                    tabStyle: 'line',
                    items: [
                      {
                        label: 'Nested',
                        children: [
                          { type: 'page:tabs', properties: { tabStyle: 'card', items: [] } },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'sys_user_detail',
          regions: [],
          slots: {
            tabs: { type: 'page:tabs', properties: { tabStyle: 'line', position: 'top', items: [] } },
          },
        },
      ],
    },
    expectedNotices: 5,
  },
};

/**
 * `page:header.icon` and `page:card.actions` — two declared page-component props
 * with NO renderer read point at all (protocol 17, #6946, ADR-0049).
 *
 * Maintainer ruling 2026-08-09 (decision-inbox round, 「全部接受」) on
 * objectui#3829, **route (c)**: retire both upstream. That card had put three
 * shapes on the table — wire the key, publish it with a KNOWN GAP marker (the
 * `record:activity.showSubscriptionToggle` precedent), or retire it here — and
 * the ruling took the third, so the platform contract loses two keys rather
 * than growing two features nobody asked for.
 *
 * What "no read point" means, per key, measured against objectui at the
 * `.objectui-sha` pin (`09987b68`) rather than inherited from the card:
 *
 *   - **`page:header.icon`** — `PageHeaderRenderer` resolves `icon` only inside
 *     the ACTION pipeline (`action.icon`, per button); the header's own props
 *     bag is never asked for one. `@object-ui/layout`'s `<PageHeader>` does
 *     draw an `icon`, but only from a REACT prop a host passes: unlike
 *     `actions`, which four lines away falls back to `schema?.actions ??
 *     schema?.properties?.actions`, `icon` has no schema fallback, so an
 *     authored node cannot reach it. The registration publishes no `icon`
 *     input either.
 *   - **`page:card.actions`** — `PageCardRenderer` builds its `<Card>` from
 *     `title`, `bordered`, `body ?? children` and `footer`, full stop. There is
 *     no actions area in the markup and no `actions` input in the
 *     registration. Its sibling `page:header` DOES read `actions` off the bag,
 *     which is exactly why the divergence survived: the two declarations look
 *     identical.
 *
 * Both keys are in objectui's own `UNPUBLISHED_EXEMPTIONS` map as B-class
 * ("spec declares it, NO renderer read point") entries pointing at objectui#3829
 * — an independent measurement of the same fact, taken in the other repo.
 *
 * **Pure lossless deletes.** Neither key ever had an effect to lose, and
 * neither has a lossless rewrite target: the header has no second icon slot
 * (its identity is the record chrome), and the card has no actions area to move
 * a list into — buttons belong in `children`/`footer` as components, which is a
 * page rewrite and not a mechanical one. So this strips, exactly as
 * {@link recordPickerInertKeysRemoved} does for the picker's two inert keys.
 *
 * ⚠️ `page:header.actions` is NOT touched — it is read (`containers.tsx`, and
 * `@object-ui/layout`'s header) and stays. One key name, two components, one
 * of them live: the strip is scoped by component `type`, never by key name.
 *
 * objectui#3829 (drop the two exemptions) is Blocked-by #6946 and proceeds on
 * the next pin bump.
 */
const pageStructureInertKeysRemoved: MetadataConversion = {
  id: 'page-structure-inert-keys-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'page.component.page:header.icon / page.component.page:card.actions',
  summary:
    "page:header prop 'icon' and page:card prop 'actions' removed (#6946 — neither has a renderer "
    + 'read point in objectui; the header resolves icons per action and the card renders '
    + 'title/children/footer only)',
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      const properties = component.properties;
      if (!isDict(properties)) return component;
      // Scoped by component type: `actions` is LIVE on `page:header` and `icon`
      // is live on half a dozen other components, so a key-name-only strip
      // would delete working metadata.
      const key =
        component.type === 'page:header' ? 'icon'
          : component.type === 'page:card' ? 'actions'
            : null;
      if (!key) return component;
      const stripped = stripKeys(properties, [key], emit, `${path}.properties`);
      if (stripped === properties) return component;
      return { ...component, properties: stripped };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'connect_agent',
          regions: [
            {
              name: 'header',
              components: [
                // The published platform-page shape: title + subtitle + a
                // decorative icon nothing drew.
                {
                  type: 'page:header',
                  properties: { title: 'Connect an Agent', subtitle: 'Governed MCP access.', icon: 'bot' },
                },
                // `page:header.actions` SURVIVES — the live half of the same key
                // name (see the ⚠️ above).
                { type: 'page:header', properties: { title: 'Lead', actions: ['convert_lead'], icon: 'user' } },
                // `icon` on a component that is not a page header — not this
                // entry's key, and live on that one.
                { type: 'element:button', properties: { label: 'Open', icon: 'external-link' } },
                {
                  type: 'page:card',
                  properties: { title: 'Shortcuts', actions: ['new_task'], footer: [{ type: 'element:text' }] },
                },
                // A card nested inside a card's `children` (#6775 reach): the
                // descent visits it, so the inner `actions` goes too.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Outer',
                    children: [
                      { type: 'page:card', properties: { title: 'Inner', actions: ['edit'] } },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // The named-slot shape (#6776): a header authored into a slotted
        // record page's `details` slot.
        {
          name: 'connect_agent_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: { type: 'page:header', properties: { title: 'Agent', icon: 'bot' } },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'connect_agent',
          regions: [
            {
              name: 'header',
              components: [
                {
                  type: 'page:header',
                  properties: { title: 'Connect an Agent', subtitle: 'Governed MCP access.' },
                },
                { type: 'page:header', properties: { title: 'Lead', actions: ['convert_lead'] } },
                { type: 'element:button', properties: { label: 'Open', icon: 'external-link' } },
                {
                  type: 'page:card',
                  properties: { title: 'Shortcuts', footer: [{ type: 'element:text' }] },
                },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Outer',
                    children: [
                      { type: 'page:card', properties: { title: 'Inner' } },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'connect_agent_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: { type: 'page:header', properties: { title: 'Agent' } },
          },
        },
      ],
    },
    expectedNotices: 5,
  },
};

/**
 * `record:details.layout` — a mode selector whose two declared modes were never
 * implemented (protocol 17, #6946, ADR-0049).
 *
 * Maintainer ruling 2026-08-09 (decision-inbox round, 「全部接受」) on
 * objectui#3818: the removal direction.
 *
 * This one is NOT a zero-read-point key, and the distinction is the whole
 * finding. `RecordDetailsRenderer` does read it — and reads it against values
 * this schema never permitted:
 *
 *     const layout = schema.layout === 'inline' || schema.layout === 'compact'
 *       ? 'horizontal' : 'vertical';
 *
 * The declared enum is `auto | custom`. Neither matches, so both legal values
 * take the same `vertical` branch: the key was accepted, read, and could not
 * change anything. Its `.describe()` meanwhile promised "auto uses object
 * highlightFields, custom uses explicit sections" — a behaviour the renderer
 * implements, but keyed off whether `sections` is authored at all, never off
 * this flag.
 *
 * **Why every gate stayed green over it.** `check:react-declaration-parity`
 * compares two DECLARATIONS, not a declaration against an implementation
 * (AGENTS.md) — and objectui's registry declared `layout` with the SAME
 * `auto | custom` enum, so the gate saw perfect agreement over a key nothing
 * honoured. A third spelling, `stacked | inline | compact`, sat in
 * `@object-ui/types`' `RecordDetailsComponentProps` mirror. Three declarations
 * of one key, none of them the branch the renderer takes.
 *
 * **A PURE STRIP, deliberately.** There is no value to carry: `auto` and
 * `custom` were behaviourally identical to each other and to omission, so a
 * rewrite would have nowhere lossless to go. What already decides the body is
 * what the author wrote — `sections` for explicit groups, its absence for the
 * object's `highlightFields`.
 *
 * ⚠️ `record:highlights.layout` is a DIFFERENT, live key (`horizontal |
 * vertical`, honoured) and is untouched: this entry is scoped by component
 * `type`.
 *
 * objectui#3818 (delete the `layout` input and the dead `inline|compact`
 * branch) is Blocked-by #6946 and proceeds on the next pin bump.
 */
const recordDetailsLayoutRemoved: MetadataConversion = {
  id: 'record-details-layout-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'page.component.record:details.layout',
  summary:
    "record:details component prop 'layout' removed (#6946 — the declared auto|custom modes were "
    + 'never implemented; the renderer branches only on inline|compact, values the schema never '
    + 'permitted, so both legal values selected nothing)',
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'record:details') return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const stripped = stripKeys(properties, ['layout'], emit, `${path}.properties`);
      if (stripped === properties) return component;
      return { ...component, properties: stripped };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'task_detail_layout',
          regions: [
            {
              name: 'main',
              components: [
                // The `custom` spelling, alongside the `sections` that actually
                // decides the body.
                {
                  type: 'record:details',
                  properties: {
                    layout: 'custom',
                    columns: '2',
                    sections: [{ name: 'basics', fields: ['subject'] }],
                  },
                },
                // The `auto` spelling — the declared default, written out.
                { type: 'record:details', properties: { layout: 'auto' } },
                // `layout` on a component that is not `record:details`:
                // `record:highlights.layout` is LIVE and must survive.
                { type: 'record:highlights', properties: { layout: 'horizontal', fields: ['status'] } },
              ],
            },
          ],
        },
        {
          name: 'task_detail_layout_slotted',
          kind: 'slotted',
          regions: [],
          slots: {
            details: [
              { type: 'record:details', properties: { layout: 'custom', fields: ['name'] } },
            ],
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'task_detail_layout',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'record:details',
                  properties: {
                    columns: '2',
                    sections: [{ name: 'basics', fields: ['subject'] }],
                  },
                },
                { type: 'record:details', properties: {} },
                { type: 'record:highlights', properties: { layout: 'horizontal', fields: ['status'] } },
              ],
            },
          ],
        },
        {
          name: 'task_detail_layout_slotted',
          kind: 'slotted',
          regions: [],
          slots: {
            details: [
              { type: 'record:details', properties: { fields: ['name'] } },
            ],
          },
        },
      ],
    },
    expectedNotices: 3,
  },
};

/**
 * `app.hidden: true` → `app._unpublished: true` on **stored** rows (protocol 17,
 * #4829, ADR-0045 amended 2026-08-09).
 *
 * ADR-0045 §3 originally hung its publish gate on `app.hidden`, citing an
 * "ADR-0019 launcher contract" that does not exist — ADR-0019 contains no
 * `hidden`. `hidden` already had a contract of its own, written in
 * `ui/app.zod.ts` the day the key was born: navigation presentation, *"hidden
 * apps stay fully routable and permission-checked"*, for personal-settings apps
 * reached from the avatar menu. One boolean, two contracts, contradicting each
 * other on the only question that matters — and the platform's own `account`
 * app, authored `hidden: true` on purpose, was therefore withheld from every
 * user without builder access. The gate now reads the machine-managed
 * `_unpublished`; this entry carries the existing population across.
 *
 * **Why the rewrite is unambiguous.** Under the old regime a `hidden: true` row
 * in `sys_metadata` could only have come from the materialization path, because
 * that value *was* the gate: an app stored that way was invisible to every
 * non-builder, so nobody stored it to mean "keep me out of the switcher". The
 * one app that really does mean that is code-declared (`platform-objects`'
 * ACCOUNT_APP), and code-declared artifacts never enter `sys_metadata`. The
 * Studio app form has no `hidden` control either (`ui/app.form.ts`), so no
 * authoring path could have produced a second meaning.
 *
 * **`retiredFromLoadPath: true` — load-bearing here, not bookkeeping.**
 * Retirement is what confines this rewrite to *stored* rows. `hidden` is NOT
 * retired as an authorable key — it keeps its birth contract, narrowed to
 * navigation — so a conversion running on the load path would rewrite
 * `defineApp({ hidden: true })`, and ACCOUNT_APP itself, into unpublished apps
 * and reproduce #4829 through the conversion layer. Excluded from the load path,
 * it replays only where the old meaning is the only meaning: the stored-row
 * rehydration seams (`applyConversionsToStoredItem`, which pins
 * `includeRetired`) and `os migrate meta`.
 *
 * That split is also the answer for anyone who later wants a *stored* app to be
 * nav-hidden: declare it on the app artifact, which this entry never touches. If
 * a stored-row spelling is ever wanted it needs its own decision — a Studio
 * control, and a rule for how the two populations coexist — not this entry
 * quietly ceasing to fire.
 *
 * A row that already carries `_unpublished` is left ALONE, both keys intact
 * ({@link renameKey}'s house rule, #4923): the machine has already spoken about
 * that row, and a disagreeing pair is for a human to reconcile rather than for
 * the loader to pick a winner. It is also what makes a second pass a no-op.
 */
const appHiddenToUnpublished: MetadataConversion = {
  id: 'app-hidden-to-unpublished',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'app.hidden',
  summary:
    "stored app publish gate 'hidden' → '_unpublished' (#4829, ADR-0045 amended — `hidden` carried BOTH the publish gate and 'keep out of the App Switcher', so the built-in Account app was withheld from every non-builder; the gate is now the machine-managed `_unpublished`, and `hidden` is navigation presentation only, never an access gate. Stored rows only — an authored `hidden: true` is left untouched)",
  apply(stack, emit) {
    return mapCollection(stack, 'apps', (app, path) => {
      if (app.hidden !== true) return app;
      if (app._unpublished != null) return app;
      const next = { ...app };
      delete next.hidden;
      next._unpublished = true;
      emit({ from: 'hidden', to: '_unpublished', path: `${path}._unpublished` });
      return next;
    });
  },
  fixture: {
    // DISJOINT from every other app fixture: none of these apps carries a key
    // another entry strips, so each replays through the whole table hitting
    // only its own.
    before: {
      apps: [
        // The materialized build mid-flight — the population this exists for.
        { name: 'production_management', label: '生产管理', hidden: true, navigation: [] },
        // Published and listed: `hidden: false` meant exactly that under both
        // regimes, so there is nothing to rewrite.
        { name: 'crm', label: 'CRM', hidden: false, navigation: [] },
        // Already carries the canonical gate. Left verbatim — the loader does
        // not reconcile a disagreeing pair on the author's behalf (#4923), and
        // this is what makes a second pass a no-op.
        { name: 'team_settings', hidden: true, _unpublished: false, navigation: [] },
      ],
    },
    after: {
      apps: [
        { name: 'production_management', label: '生产管理', _unpublished: true, navigation: [] },
        { name: 'crm', label: 'CRM', hidden: false, navigation: [] },
        { name: 'team_settings', hidden: true, _unpublished: false, navigation: [] },
      ],
    },
    expectedNotices: 1,
  },
};

/**
 * `global_nav` leaves `ACTION_LOCATIONS` (protocol 17, #6888 — ADR-0049
 * enforce-or-remove, maintainer ruling 2026-08-09).
 *
 * The location was declared from the day the vocabulary was written and no
 * product surface ever served it. The console's ⌘K palette
 * (`app-shell/src/chrome/CommandPalette.tsx`) composes its seven groups from
 * nav items, objects, dashboards, pages, reports, recent items, record search
 * and theme — its `actions` group is hard-coded chrome — and the file
 * references neither `global_nav` nor any action-metadata source at all. Of the
 * five references to the value in the whole UI repo at the vendored SHA, four
 * were the Studio designer and the fifth a doc comment.
 *
 * What makes it worse than an ordinary inert declaration is the direction of
 * the lie: `metadata-admin/previews/ActionPreview.tsx` drew the author a mock
 * `⌘K · Command palette` frame, so the authoring tool PROMISED a rendering the
 * product cannot do. An author declares the location, watches it "work" in the
 * designer, ships it, and it renders nowhere — the ADR-0078
 * declares/renders/does-nothing shape, arriving through the location
 * vocabulary rather than through a missing key. Retired rather than
 * implemented: no user has asked for command-palette actions and the only two
 * declarers were our own showcase corpus, so wiring the palette would have been
 * capability expansion with no pull. If real appetite appears it re-enters
 * through the front door, implementation first.
 *
 * Like `hook-body-crypto-hash-removed` and
 * `dataset-measure-array-string-agg-removed` above, this is an enum-VALUE
 * retirement: there is no `retiredKey()` tombstone to hang the prescription on,
 * so the enum's own error map carries it (`GLOBAL_NAV_RETIRED`,
 * `ui/action.zod.ts`), keyed on `issue.input` so only the spelling that used to
 * be legal is told it "was removed". For the same reason nothing lands in
 * `RETIRED_KEYS_BY_MAJOR` and the four surface ratchets are expected to be
 * byte-identical — no def and no authorable KEY changed.
 *
 * ## The empty-array edge, decided deliberately
 *
 * The value is stripped from `locations` and **the key is kept even when the
 * array empties** — `locations: []`, never `delete locations`. On this surface
 * the two are different declarations, not two spellings of one:
 * `content/docs/ui/actions.mdx` ("Headless actions: declare it, then hide it")
 * documents `[]` as a first-class shape — the action stays callable over
 * REST/MCP/AI and keeps its capability gate, param contract and audit trail —
 * while an ABSENT key means the author never placed the action at all, which is
 * exactly what `packages/lint`'s `action-no-placement` rule warns about. The
 * rule states the distinction in those words: "an author who said 'nowhere,
 * deliberately' (`[]`) and one who never said anything at all (key absent)".
 * Dropping the key would therefore convert a deliberate placement into a lint
 * finding and lose the author's own statement of intent. Stripping to `[]` is
 * also the truthful reading of the retirement: the action's UI home is gone,
 * and headless is what it now is.
 *
 * This differs from `dataset-measure-array-string-agg-removed`, which DROPS the
 * measure, for a reason that is about validity rather than taste: a measure
 * with neither `aggregate` nor `derived` fails the dataset's own `superRefine`,
 * so stripping alone would emit an item that cannot parse. An action with
 * `locations: []` parses, and is documented to. It follows
 * `hook-body-crypto-hash-removed`'s "the `capabilities` key itself stays (an
 * empty grant set is legal)" instead.
 *
 * `retiredFromLoadPath`: the enum rejects the value outright, so a live author
 * is taught at parse rather than silently rewritten. The entry exists so stored
 * 16.x/17-rc rows replay clean (`applyConversionsToStoredItem` — without it a
 * pre-removal row flags `metadata_spec_invalid` forever, mislabelling
 * chain-owned history as a current-contract violation) and so
 * `os migrate meta --from 16` rewrites author sources.
 */
const actionGlobalNavLocationRemoved: MetadataConversion = {
  id: 'action-global-nav-location-removed',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'action.locations[]',
  summary:
    "action location 'global_nav' removed (#6888 — no running-app surface rendered it; the ⌘K "
    + 'palette reads no action metadata, while the Studio designer previewed a command-palette '
    + 'frame for it. The value is stripped and the key kept, so an action left with no location '
    + 'becomes the documented headless shape `locations: []`)',
  apply(stack, emit) {
    return mapCollection(stack, 'actions', (action, path) => {
      const locations = action.locations;
      if (!Array.isArray(locations) || !locations.includes('global_nav')) return action;
      emit({ from: 'global_nav', to: '(removed)', path: `${path}.locations` });
      return { ...action, locations: locations.filter((l) => l !== 'global_nav') };
    });
  },
  fixture: {
    before: {
      actions: [
        // The empty-array edge: `global_nav` was this action's ONLY location,
        // so the strip empties the array. The key survives — see the docblock.
        {
          name: 'portfolio_snapshot',
          label: 'Portfolio Snapshot',
          type: 'script',
          locations: ['global_nav'],
        },
        // Surgical: the surviving locations stay, in order, beside the strip.
        {
          name: 'new_task',
          label: 'New Task',
          type: 'modal',
          target: 'gallery',
          locations: ['record_header', 'global_nav', 'list_toolbar'],
        },
        // An action without the retired value passes through untouched.
        {
          name: 'mark_done',
          label: 'Mark Done',
          type: 'script',
          locations: ['list_item'],
        },
      ],
    },
    after: {
      actions: [
        { name: 'portfolio_snapshot', label: 'Portfolio Snapshot', type: 'script', locations: [] },
        {
          name: 'new_task',
          label: 'New Task',
          type: 'modal',
          target: 'gallery',
          locations: ['record_header', 'list_toolbar'],
        },
        { name: 'mark_done', label: 'Mark Done', type: 'script', locations: ['list_item'] },
      ],
    },
    // One per rewritten action — `mark_done` is untouched.
    expectedNotices: 2,
  },
};

/**
 * Field `scale` / `precision`: malformed declarations removed (protocol 18,
 * #8321).
 *
 * NOT a rename — both keys are digit COUNTS, so a non-integer or negative
 * value (`scale: 2.5`, `precision: -1`) declares nothing the runtime could
 * enforce. #7501's write-time enforcement deliberately guards on
 * `Number.isInteger(v) && v >= 0` and leaves a malformed declaration
 * unenforced (inventing floor/round semantics in a consumer would be PD #12
 * guessing), so removing the key is a pure lossless delete: the declaration
 * never had a runtime effect to lose, and after removal the field behaves
 * byte-identically (unenforced). The authoring schema now refuses these
 * values (`z.number().int().min(0)`, ADR-0078 declared=enforced), so this is
 * **retired from the load path**: a live author gets the loud refusal and
 * fixes the source; only `migrate meta` and the stored-row rehydration seam
 * (`applyConversionsToStoredItem`, which replays retired entries by design)
 * apply the delete — which is what keeps an existing tenant with
 * `scale: 2.5` at rest in `sys_metadata` loadable rather than hard-broken.
 *
 * Guarded to `typeof v === 'number'`: a non-number value there was never
 * schema-legal in any protocol and is a validation problem, not a conversion
 * target — this seam never manufactures shape. `NaN`/`Infinity` fall in
 * (`Number.isInteger` is false for both). A WELL-FORMED count (`0`, `2`, any
 * non-negative integer) is untouched.
 *
 * ⚠️ `CurrencyConfigSchema.precision` (under `currencyConfig`) is a different
 * surface with its own bounds and alias table — deliberately not walked.
 */
const fieldMalformedScalePrecisionRemoved: MetadataConversion = {
  id: 'field-malformed-scale-precision-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  surface: 'object.fields.*.scale / object.fields.*.precision',
  summary:
    "malformed field 'scale'/'precision' declarations (non-integer or negative) are removed — "
    + 'they were silently unenforced; the schema now refuses them at authoring (#8321)',
  apply(stack, emit) {
    const MALFORMED_KEYS = ['scale', 'precision'] as const;
    const stripMalformed = (input: Dict, collection: string): Dict =>
      mapCollection(input, collection, (owner, path) => {
        const fields = owner.fields;
        if (!isDict(fields)) return owner;
        let changed = false;
        const next: Dict = {};
        for (const [name, def] of Object.entries(fields)) {
          if (!isDict(def)) {
            next[name] = def;
            continue;
          }
          let current = def;
          for (const key of MALFORMED_KEYS) {
            const value = current[key];
            if (typeof value !== 'number') continue;
            if (Number.isInteger(value) && value >= 0) continue;
            const { [key]: _removed, ...rest } = current;
            current = rest;
            emit({ from: `${key}: ${value}`, to: '(removed)', path: `${path}.fields.${name}.${key}` });
          }
          next[name] = current;
          if (current !== def) changed = true;
        }
        return changed ? { ...owner, fields: next } : owner;
      });
    return stripMalformed(stripMalformed(stack, 'objects'), 'objectExtensions');
  },
  fixture: {
    before: {
      objects: [{
        name: 'crm_deal',
        label: 'Deal',
        fields: {
          // Non-integer scale: the #8321 repro — declared, silently unenforced.
          amount: { type: 'number', precision: 18, scale: 2.5 },
          // Negative precision: the other malformed direction.
          weight: { type: 'number', precision: -1, scale: 2 },
          // Well-formed counts survive byte-identically.
          quantity: { type: 'number', precision: 10, scale: 0 },
        },
      }],
    },
    after: {
      objects: [{
        name: 'crm_deal',
        label: 'Deal',
        fields: {
          amount: { type: 'number', precision: 18 },
          weight: { type: 'number', scale: 2 },
          quantity: { type: 'number', precision: 10, scale: 0 },
        },
      }],
    },
    // One per removed malformed key — `quantity` (and `weight.scale`,
    // `amount.precision`) are untouched.
    expectedNotices: 2,
  },
};

/**
 * `record:chatter` / `record:discussion` `position` converges on the
 * renderer's vocabulary (protocol 18, #8762 — maintainer ruling 2026-08-15:
 * one vocabulary, no mapping layer).
 *
 * The spec row declared `sidebar | inline | drawer` (with a `sidebar`
 * default); the renderer chain read none of those values. Measured at the
 * `.objectui-sha` pin `665661ab0932`: `RecordChatterPanel` branches on
 * exactly `right`/`left` (docked side panel) vs `bottom` (in-flow), the
 * designer registration publishes `enum: ['bottom', 'right', 'left']`, and
 * the renderer merge falls back to `bottom` — three renderer-side sites in
 * agreement, so the spec row was the isolated wrong party and converges on
 * them. The rewrite preserves AUTHOR INTENT against the renderer's actual
 * branch semantics (`right`/`left` ⇒ docked, `bottom` ⇒ in-flow):
 *
 *   - `sidebar` → `right`: the author asked for a docked side panel; `right`
 *     is the conventional chatter side (and the panel's own docked default).
 *     Observed behaviour CHANGES — the value used to fall through to the
 *     in-flow render — but that fall-through was the defect, not the intent.
 *   - `inline` → `bottom`: intent and observed behaviour agree — `bottom` is
 *     the renderer's in-flow branch, which is where `inline` already landed.
 *   - `drawer` → `right`: no renderer branch ever implemented an overlay
 *     drawer (removal, not a pure rename — there is no counterpart). The
 *     docked side panel is the nearest surviving shape of a side drawer.
 *
 * `retiredFromLoadPath`: the enum refuses the old spellings outright, each
 * with a per-value prescription (`CHATTER_POSITION_RETIRED`,
 * ui/component.zod.ts), so a live author is taught at parse rather than
 * silently rewritten. The entry exists so stored rows replay clean
 * (`applyConversionsToStoredItem`) and so `os migrate meta` rewrites author
 * sources mechanically.
 *
 * The same #8762 ruling dropped all three schema defaults (`position`,
 * `collapsible`, `defaultCollapsed`) per the `maxVisible` principle; that
 * half needs no conversion — an authored value keeps its meaning, and "the
 * author said nothing" now stays nothing (the renderer's own fallbacks
 * apply). The semantic entry `record-chatter-position-vocabulary-converged`
 * carries the review prescription for both halves.
 */
const recordChatterPositionVocabulary: MetadataConversion = {
  id: 'record-chatter-position-vocabulary',
  toMajor: 18,
  retiredFromLoadPath: true,
  surface: 'page.component.record:chatter.position / page.component.record:discussion.position',
  summary:
    "record:chatter / record:discussion 'position' respelled to the renderer's vocabulary — "
    + "'sidebar' → 'right', 'inline' → 'bottom', 'drawer' → 'right' (#8762 — the renderer "
    + 'compares only bottom/right/left; the old set fell through every branch)',
  apply(stack, emit) {
    const POSITION_REWRITE: Readonly<Record<string, string>> = {
      sidebar: 'right',
      inline: 'bottom',
      drawer: 'right',
    };
    const CHATTER_TYPES = new Set(['record:chatter', 'record:discussion']);
    return mapPageComponents(stack, (component, path) => {
      if (typeof component.type !== 'string' || !CHATTER_TYPES.has(component.type)) return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const position = properties.position;
      if (typeof position !== 'string') return component;
      const to = POSITION_REWRITE[position];
      if (!to) return component;
      emit({ from: position, to, path: `${path}.properties.position` });
      return { ...component, properties: { ...properties, position: to } };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'deal_detail_chatter',
          regions: [
            {
              name: 'main',
              components: [
                // The old schema default, written out — the author asked for a
                // docked side panel and silently got the in-flow render.
                { type: 'record:chatter', properties: { position: 'sidebar', width: '350px' } },
                // `inline` meant the in-flow render, and got it.
                { type: 'record:discussion', properties: { position: 'inline' } },
                // A `position` on a component that is NOT the chatter pair is a
                // different surface and must survive byte-identically.
                { type: 'element:custom', properties: { position: 'sidebar' } },
                // Already-canonical values are untouched.
                { type: 'record:chatter', properties: { position: 'left' } },
              ],
            },
          ],
        },
        {
          name: 'deal_detail_chatter_slotted',
          kind: 'slotted',
          regions: [],
          slots: {
            discussion: [
              { type: 'record:discussion', properties: { position: 'drawer', collapsible: true } },
            ],
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'deal_detail_chatter',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'record:chatter', properties: { position: 'right', width: '350px' } },
                { type: 'record:discussion', properties: { position: 'bottom' } },
                { type: 'element:custom', properties: { position: 'sidebar' } },
                { type: 'record:chatter', properties: { position: 'left' } },
              ],
            },
          ],
        },
        {
          name: 'deal_detail_chatter_slotted',
          kind: 'slotted',
          regions: [],
          slots: {
            discussion: [
              { type: 'record:discussion', properties: { position: 'right', collapsible: true } },
            ],
          },
        },
      ],
    },
    // One per rewritten `position` — the non-chatter component and the
    // already-canonical `left` are untouched.
    expectedNotices: 3,
  },
};

export const CONVERSIONS_BY_MAJOR: Readonly<Record<number, readonly MetadataConversion[]>> = {
  11: [flowNodeHttpRename, pageKindJsxToHtml, flowNodeFilterAlias, objectCompactLayoutRename],
  13: [stackRolesToPositions, owdLegacyReadAliases, sharingRecipientRoleToPosition],
  14: [bookAudienceProfileToPermissionSet],
  15: [viewVisibleOnToVisibleWhen, pageComponentVisibilityToVisibleWhen],
  17: [
    actionExecuteToTarget,
    fieldConditionalRequiredToRequiredWhen,
    agentToolsToSkills,
    sharingRuleAccessLevelFullToEdit,
    flowNodeCrudObjectAlias,
    flowNodeNotifyConfigAliases,
    flowNodeWaitEventConfigLift,
    flowNodeConnectorConfigLift,
    flowNodeMapFlowAlias,
    flowNodeSubflowFlowAlias,
    flowNodeScriptConfigAliases,
    permissionRlsPriorityRemoved,
    toolInertAuthoringKeysRemoved,
    appDeadAuthoringKeysRemoved,
    appAreaFailOpenGatesRemoved,
    fieldRequiredNotNullExplicit,
    actionInertKeysRemoved,
    flowInertKeysRemoved,
    viewInertKeysRemoved,
    viewListPassthroughKeysRemoved,
    viewExportOptionsPdfRemoved,
    dashboardInertKeysRemoved,
    dashboardWidgetResponsiveRemoved,
    dashboardWidgetActionAriaRemoved,
    dashboardWidgetCompareToConverged,
    agentKnowledgeRemoved,
    skillTriggerPhrasesRemoved,
    stackApiRequireAuthRemoved,
    flowNodeWaitTimeoutKeysRemoved,
    datasourceReadReplicasRemoved,
    datasourceCapabilitiesRemoved,
    datasourceInertBlocksRemoved,
    mappingInertKeysRemoved,
    bookTranslationsRemoved,
    jobIdRemoved,
    translationValidationMessagesRemoved,
    datasourceConfigDriverKeyAliases,
    // AFTER `datasourceConfigDriverKeyAliases`: that one keys its rename pairs
    // by canonical driver id, and a stored `driver: 'mongo'` reaches them
    // through the alias either way — but running the id rename second keeps the
    // two notices in the order an operator reads them (config keys fixed under
    // the driver they were written for, then the driver id itself converged).
    datasourceDriverMongoToMongodb,
    // AFTER `flowNodeScriptConfigAliases`: the shorthand-`actionType` rule asks
    // whether `config.function` is set, and that rename is what sets it.
    flowNodeScriptBranchKeysRemoved,
    retryPolicyConverged,
    objectManagedBySystemToSystemData,
    objectEnableTrashMruRemoved,
    hookBodyCryptoHashRemoved,
    datasetMeasureAggRemoved,
    connectorRateLimitConfigRemoved,
    fieldMappingTransformRemoved,
    themeInertTokenScalesRemoved,
    pageHeaderSubtitleAlias,
    objectIndexTypePartialRemoved,
    recordPickerDisplayFieldToLabelField,
    recordPickerInertKeysRemoved,
    pageCardBodyToChildren,
    inlineActionApiParamsToBodyExtra,
    pageTabsTypeToTabStyle,
    pageStructureInertKeysRemoved,
    recordDetailsLayoutRemoved,
    appHiddenToUnpublished,
    actionGlobalNavLocationRemoved,
  ],
  18: [fieldMalformedScalePrecisionRemoved, recordChatterPositionVocabulary],
};

/** Flattened, deterministic list of every conversion the loader knows about. */
export const ALL_CONVERSIONS: readonly MetadataConversion[] = Object.keys(CONVERSIONS_BY_MAJOR)
  .map(Number)
  .sort((a, b) => a - b)
  .flatMap((major) => CONVERSIONS_BY_MAJOR[major]!);
