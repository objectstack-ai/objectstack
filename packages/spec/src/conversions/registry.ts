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
import { mapCollection, mapDatasources, mapFlowNodes, mapPages, renameConfigKey, renameKey } from './walk.js';
import { resolveDriverId, type BuiltinDriverId } from '../data/driver/config-registry.zod.js';

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
            // canonical already present → the shadowed alias is left alone (no notice)
            { id: 'n3', type: 'create_record', config: { objectName: 'task', object: 'ignored' } },
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
            { id: 'n3', type: 'create_record', config: { objectName: 'task', object: 'ignored' } },
          ],
        },
      ],
    },
    expectedNotices: 1,
  },
};

/**
 * Lift `notify`'s nested `config.source: { object, id }` onto the canonical flat
 * `sourceObject` / `sourceId` keys (#4045).
 *
 * The fifth notify alias, and the only one that is not a 1:1 rename — it is a
 * 1→2 destructuring, so {@link renameFlowConfigAliases}' pair mechanism cannot
 * express it. Semantics mirror the `??` precedence the executor used to carry:
 * a canonical key already present WINS and its nested counterpart is left
 * shadowed, exactly as {@link renameConfigKey} treats a shadowed alias.
 *
 * `source` is dropped once at least one part was lifted — every part is by then
 * either lifted or shadowed by a canonical key, so nothing observable is lost
 * (the executor only ever read `.object` / `.id`). A `source` that is not a dict,
 * or carries neither key, is left untouched rather than silently deleted.
 */
function liftNotifySourceShape(stack: Dict, emit: Emit): Dict {
  return mapFlowNodes(stack, (node, path) => {
    if (node.type !== 'notify') return node;
    const config = node.config;
    if (!isDict(config)) return node;
    const source = config.source;
    if (!isDict(source)) return node;

    const nextConfig: Dict = { ...config };
    let lifted = false;
    for (const [from, to] of [['object', 'sourceObject'], ['id', 'sourceId']] as const) {
      if (source[from] == null) continue;
      if (nextConfig[to] != null) continue; // canonical already wins
      nextConfig[to] = source[from];
      emit({ from: `source.${from}`, to, path: `${path}.config.${to}` });
      lifted = true;
    }
    if (!lifted) return node;
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
            // A canonical `sourceObject` WINS: only the unshadowed `id` is
            // lifted, and `source` is dropped since every part is accounted for.
            {
              id: 'n3',
              type: 'notify',
              config: {
                recipients: ['{record.owner}'],
                sourceObject: 'showcase_project',
                source: { object: 'ignored', id: '{record.project}' },
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
                sourceId: '{record.project}',
              },
            },
          ],
        },
      ],
    },
    // 4 renames on n2 + `source.object`/`source.id` lifted on n2 + the single
    // unshadowed `source.id` on n3 (its `source.object` is shadowed → no notice).
    expectedNotices: 7,
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
 * shadowed (as {@link renameConfigKey} treats a shadowed alias), and among loose
 * candidates the first one present decides.
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
            // canonical already present → the shadowed alias is left alone (no notice)
            { id: 'n3', type: 'map', config: { collection: '{rows}', flowName: 'per_row', flow: 'ignored' } },
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
            { id: 'n3', type: 'map', config: { collection: '{rows}', flowName: 'per_row', flow: 'ignored' } },
          ],
        },
      ],
    },
    expectedNotices: 1,
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
            // canonical already present → the shadowed alias is left alone (no notice)
            { id: 'n3', type: 'subflow', config: { flowName: 'audit_flow', flow: 'ignored' } },
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
            { id: 'n3', type: 'subflow', config: { flowName: 'audit_flow', flow: 'ignored' } },
          ],
        },
      ],
    },
    expectedNotices: 1,
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
    + 'app.mobileNavigation / app.contextSelectors.includeAll / app.contextSelectors.placement',
  summary: "app keys 'version'/'aria'/'objects'/'apis'/'sharing'/'embed'/'mobileNavigation' plus contextSelectors 'includeAll'/'placement' removed (liveness audits #4001, #4509 — never read; sharing/embed declared a public surface no route enforced, mobileNavigation was fully unimplemented, and includeAll was deliberately disobeyed because an 'All' row would clear a mandatory scope)",
  apply(stack, emit) {
    const RETIRED = ['version', 'aria', 'objects', 'apis', 'sharing', 'embed', 'mobileNavigation'];
    const RETIRED_SELECTOR = ['includeAll', 'placement'];
    return mapCollection(stack, 'apps', (app, path) => {
      const next = stripKeys(app, RETIRED, emit, path);
      // `contextSelectors` is an ARRAY one level down, so stripKeys (top-level
      // only) cannot reach it. Drill in and copy-on-write at both levels, so an
      // app with nothing to strip keeps its identity for change detection.
      const selectors = next.contextSelectors;
      if (!Array.isArray(selectors)) return next;
      let touched = false;
      const nextSelectors = selectors.map((sel, i) => {
        if (!sel || typeof sel !== 'object' || Array.isArray(sel)) return sel;
        const stripped = stripKeys(
          sel as Record<string, unknown>,
          RETIRED_SELECTOR,
          emit,
          `${path}.contextSelectors[${i}]`,
        );
        if (stripped !== sel) touched = true;
        return stripped;
      });
      return touched ? { ...next, contextSelectors: nextSelectors } : next;
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
        contextSelectors: [{
          id: 'active_package',
          label: 'Package',
          optionsSource: { endpoint: '/api/v1/packages', valueKey: 'id', labelKey: 'name' },
          includeAll: true,
          placement: 'sidebar_header',
        }],
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
        navigation: [{ id: 'nav_home', label: 'Home', type: 'object', objectName: 'account' }],
      }],
    },
    // Six notices: four top-level keys (`version`, `sharing`, `embed`,
    // `mobileNavigation`) plus the two on the single context selector.
    expectedNotices: 6,
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
  mongo: [['uri', 'url'], ['user', 'username']],
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
 * {@link renameKey}: a canonical key already present wins and the alias is
 * left shadowed in place, which is also what the factory's `??` chains
 * resolved to.
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
        if (!renamed) continue; // absent, or canonical already wins (alias stays shadowed)
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
        // canonical already present → the shadowed alias is left alone (no notice)
        { name: 'scratch', driver: 'sqlite', config: { filename: ':memory:', file: 'ignored.db' } },
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
        { name: 'scratch', driver: 'sqlite', config: { filename: ':memory:', file: 'ignored.db' } },
      ],
    },
    // app_db 1 + archive_db 1 + warehouse 2 + orders 1 + events 1 + scratch 0.
    expectedNotices: 6,
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
    fieldRequiredNotNullExplicit,
    actionInertKeysRemoved,
    flowInertKeysRemoved,
    viewInertKeysRemoved,
    dashboardInertKeysRemoved,
    agentKnowledgeRemoved,
    skillTriggerPhrasesRemoved,
    stackApiRequireAuthRemoved,
    flowNodeWaitTimeoutKeysRemoved,
    datasourceReadReplicasRemoved,
    datasourceCapabilitiesRemoved,
    datasourceInertBlocksRemoved,
    mappingInertKeysRemoved,
    datasourceConfigDriverKeyAliases,
    // AFTER `flowNodeScriptConfigAliases`: the shorthand-`actionType` rule asks
    // whether `config.function` is set, and that rename is what sets it.
    flowNodeScriptBranchKeysRemoved,
    objectManagedBySystemToSystemData,
  ],
};

/** Flattened, deterministic list of every conversion the loader knows about. */
export const ALL_CONVERSIONS: readonly MetadataConversion[] = Object.keys(CONVERSIONS_BY_MAJOR)
  .map(Number)
  .sort((a, b) => a - b)
  .flatMap((major) => CONVERSIONS_BY_MAJOR[major]!);
