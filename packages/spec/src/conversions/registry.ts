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
import { mapCollection, mapFlowNodes, mapPages, renameConfigKey, renameKey } from './walk.js';

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
 * The page-component spelling of the same predicate. Applies to
 * `pages[].regions[].components[]`. **Live window**, same terms as
 * {@link viewVisibleOnToVisibleWhen}. (An AI agent's `visibility` property is
 * a different, unrelated surface and is not touched.)
 */
const pageComponentVisibilityToVisibleWhen: MetadataConversion = {
  id: 'page-component-visibility-to-visibleWhen',
  toMajor: 15,
  surface: 'page.component.visibility',
  summary: "page component key 'visibility' → 'visibleWhen' (ADR-0089)",
  apply(stack, emit) {
    return mapPages(stack, (page, path) => {
      const regions = page.regions;
      if (!Array.isArray(regions)) return page;
      let regionsChanged = false;
      const nextRegions = regions.map((region, ri) => {
        if (!region || typeof region !== 'object' || Array.isArray(region)) return region;
        const dict = region as Record<string, unknown>;
        const components = dict.components;
        if (!Array.isArray(components)) return region;
        let componentsChanged = false;
        const nextComponents = components.map((component, ci) => {
          if (!component || typeof component !== 'object' || Array.isArray(component)) return component;
          const mapped = renameVisibilityAlias(
            component as Record<string, unknown>,
            'visibility',
            `${path}.regions[${ri}].components[${ci}]`,
            emit,
          );
          if (mapped !== component) componentsChanged = true;
          return mapped;
        });
        if (!componentsChanged) return region;
        regionsChanged = true;
        return { ...dict, components: nextComponents };
      });
      if (!regionsChanged) return page;
      return { ...page, regions: nextRegions };
    });
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
              ],
            },
          ],
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
              ],
            },
          ],
        },
      ],
    },
    expectedNotices: 1,
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

/**
 * Agent `knowledge.topics` → `knowledge.sources` (protocol 17, #1891 / #3855).
 *
 * A pure key rename — the value (a list of RAG source tags) is unchanged.
 */
const agentKnowledgeTopicsToSources: MetadataConversion = {
  id: 'agent-knowledge-topics-to-sources',
  toMajor: 17,
  retiredFromLoadPath: true,
  surface: 'agent.knowledge.topics',
  summary: "agent knowledge key 'topics' → 'sources' (the deprecated RAG-source alias, #1891)",
  apply(stack, emit) {
    return mapCollection(stack, 'agents', (agent, path) => {
      const knowledge = agent.knowledge;
      if (!isDict(knowledge)) return agent;
      const renamed = renameKey(knowledge, 'topics', 'sources');
      if (!renamed) return agent;
      emit({ from: 'topics', to: 'sources', path: `${path}.knowledge.sources` });
      return { ...agent, knowledge: renamed };
    });
  },
  fixture: {
    before: {
      agents: [{ name: 'support_bot', knowledge: { topics: ['faq', 'policies'], indexes: ['docs'] } }],
    },
    after: {
      agents: [{ name: 'support_bot', knowledge: { sources: ['faq', 'policies'], indexes: ['docs'] } }],
    },
    expectedNotices: 1,
  },
};

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

/**
 * All conversions, keyed by the protocol major that introduced the canonical
 * shape. Newest majors last; ordering within a major is application order.
 */
export const CONVERSIONS_BY_MAJOR: Readonly<Record<number, readonly MetadataConversion[]>> = {
  11: [flowNodeHttpRename, pageKindJsxToHtml, flowNodeFilterAlias, objectCompactLayoutRename],
  13: [stackRolesToPositions, owdLegacyReadAliases, sharingRecipientRoleToPosition],
  14: [bookAudienceProfileToPermissionSet],
  15: [viewVisibleOnToVisibleWhen, pageComponentVisibilityToVisibleWhen],
  17: [
    actionExecuteToTarget,
    fieldConditionalRequiredToRequiredWhen,
    agentKnowledgeTopicsToSources,
    agentToolsToSkills,
    sharingRuleAccessLevelFullToEdit,
  ],
};

/** Flattened, deterministic list of every conversion the loader knows about. */
export const ALL_CONVERSIONS: readonly MetadataConversion[] = Object.keys(CONVERSIONS_BY_MAJOR)
  .map(Number)
  .sort((a, b) => a - b)
  .flatMap((major) => CONVERSIONS_BY_MAJOR[major]!);
