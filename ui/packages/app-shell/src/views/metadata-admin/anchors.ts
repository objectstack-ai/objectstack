// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Built-in anchor relationships for the Related tab.
 *
 * Each entry tells the metadata-admin engine "items of type X belong to
 * (are anchored at) items of type Y when this predicate matches". The
 * Related panel on the parent's edit page uses this registry to decide
 * which `client.list(type)` calls to make and how to group the results.
 *
 * Adding a new relationship is intentionally a one-liner — declare it
 * here (or in your own plugin's bootstrap) and the UI picks it up with
 * no further wiring. Predicates are kept tiny because they run client-
 * side over every item returned from `list()`.
 *
 * Why not parse the schema and infer this? Some types nest the anchor
 * deep in `data.object` or `list.data.object`; some types live on the
 * parent (e.g. `fields` is embedded inside the object item itself).
 * Hand-rolled declarations are clearer than schema-walking heuristics.
 */

import { registerMetadataResource, anchorByField } from './registry.js';


export function registerBuiltinAnchors(): void {
  // ── EMBEDDED: items stored inside the object body itself ──────────
  //
  // Fields, indexes, and embedded validations don't have a top-level
  // metadata type; they live under `object.fields`, `object.indexes[]`,
  // `object.validations[]`. We surface them with `source: 'embedded'`
  // so the Related panel can list them without a separate API call.
  //
  // `fields` is stored as a NAME-KEYED MAP (`{ email: {...}, name: {...} }`)
  // — not an array — so we adapt it into an array carrying the key as
  // `name` for the panel to render.
  registerMetadataResource({
    type: '__object_field' as any,
    label: 'Field',
    anchors: [{
      anchorType: 'object',
      source: 'embedded',
      editAs: 'field',
      embeddedPath: 'fields',
      extract: (parent) => mapOrArrayToList((parent as { fields?: unknown }).fields),
      groupLabel: 'Fields',
      order: 5,
    }],
  });

  registerMetadataResource({
    type: '__object_index' as any,
    label: 'Index',
    anchors: [{
      anchorType: 'object',
      source: 'embedded',
      editAs: 'index',
      embeddedPath: 'indexes',
      extract: (parent) => {
        const raw = (parent as { indexes?: unknown }).indexes;
        if (!Array.isArray(raw)) return [];
        // Indexes have no `name`; synthesise one from their column list.
        return (raw as Array<Record<string, unknown>>).map((idx, i) => {
          const fields = Array.isArray(idx.fields) ? idx.fields.join(',') : '';
          const synthesised = fields ? `idx_${fields}` : `index_${i}`;
          return { name: synthesised, ...idx };
        });
      },
      groupLabel: 'Indexes',
      order: 10,
    }],
  });

  registerMetadataResource({
    type: '__object_validation' as any,
    label: 'Embedded validation',
    anchors: [{
      anchorType: 'object',
      source: 'embedded',
      editAs: 'validation',
      embeddedPath: 'validations',
      extract: (parent) => mapOrArrayToList((parent as { validations?: unknown }).validations),
      groupLabel: 'Embedded Validations',
      order: 15,
    }],
  });

  // ── LIST: standalone child metadata types ─────────────────────────

  // hook.object → object (beforeInsert / afterUpdate / …)
  registerMetadataResource({
    type: 'hook',
    anchors: [{
      anchorType: 'object',
      match: anchorByField('object'),
      groupLabel: 'Hooks',
      order: 20,
    }],
    createFields: ['label', 'name', 'object', 'description'],
    createDerive: [
      { from: 'label', to: 'name', transform: 'slugify', untilUserEdits: true },
    ],
    // Without a createSchema the flat create form has no property types, so
    // every field (incl. `object`) falls back to a plain text input. Declare
    // one — mirroring `page`/`view` — so `object` gets the `ref:object` picker.
    // `object` is spec-required on HookSchema (alongside `name`, `events`);
    // `events` is supplied by createDefaults below, so the form asks only for
    // identity + the bound object.
    createSchema: {
      type: 'object',
      required: ['label', 'name', 'object'],
      properties: {
        label: { type: 'string', title: 'Label', description: 'Human-readable hook name.' },
        name: {
          type: 'string',
          title: 'Name',
          description: 'Hook key (snake_case).',
          pattern: '^[a-z_][a-z0-9_]*$',
        },
        object: {
          type: 'string',
          title: 'Object',
          widget: 'ref:object',
          description: 'The object whose row lifecycle (beforeInsert / afterUpdate / …) this hook runs on.',
        },
        description: {
          type: 'string',
          title: 'Description',
          description: 'What this hook does.',
        },
      },
    },
    createDefaults: { events: [] },
  });

  // Approval is no longer a standalone metadata type (ADR-0019) — it is a flow
  // node (`type: 'approval'`). Approvals therefore surface on an object through
  // the Flows it belongs to, not a separate "Approval Processes" group.

  // page.object → object (auto-generated record pages, etc.)
  registerMetadataResource({
    type: 'page',
    anchors: [{
      anchorType: 'object',
      match: anchorByField('object'),
      groupLabel: 'Pages',
      order: 40,
    }],
    // Mirror `view`'s create form: a page (esp. a *record* page) must be able to
    // bind an `object` and pick its page `type` / `kind` at creation — the
    // identity-only form (label/name/icon/description) couldn't make a record
    // page. The block layout is then composed in the editor's PagePreview canvas.
    createFields: ['label', 'name', 'object', 'type', 'kind'],
    createDerive: [
      { from: 'label', to: 'name', transform: 'slugify', untilUserEdits: true },
    ],
    createSchema: {
      type: 'object',
      required: ['label', 'name', 'type'],
      properties: {
        label: { type: 'string', title: 'Label', description: 'Human-readable page title.' },
        name: {
          type: 'string',
          title: 'Name',
          description: 'Page key (snake_case).',
          pattern: '^[a-z_][a-z0-9_]*$',
        },
        type: {
          type: 'string',
          title: 'Page type',
          // 'list' (interface page) is the primary, most-built page type — offer
          // it first and as the default. 'dashboard' is roadmap (no distinct
          // renderer yet), so it's omitted here, matching the edit form.
          enum: ['list', 'record', 'home', 'app', 'utility'],
          default: 'list',
          description: 'List / Interface page = a data view (Airtable-style: columns, filters, visualizations). Record page renders one object record.',
        },
        object: {
          type: 'string',
          title: 'Object',
          widget: 'ref:object',
          description: 'The object this page reads from — the data source for a list page, or the record object for a record page.',
        },
        kind: {
          type: 'string',
          title: 'Kind',
          enum: ['full', 'slotted'],
          default: 'full',
          description: 'full = the whole page; slotted = override only named slots of the default.',
        },
      },
    },
    createDefaults: { type: 'list', kind: 'full', regions: [] },
    // Seed a record page's regions from the bound object's synthesized default
    // detail page, so authoring starts from the auto-generated layout (the same
    // one the runtime renders by default) instead of a blank canvas.
    createSeed: async (draft, { client }) => {
      // List/interface page: pre-bind the chosen object as the data source so
      // the new page renders immediately (the author then curates columns,
      // filters, visualizations in the editor).
      if (draft?.type === 'list') {
        return draft?.object ? { interfaceConfig: { source: String(draft.object) } } : {};
      }
      if (draft?.type !== 'record' || !draft?.object) return {};
      try {
        const objectDef = await client.get('object', String(draft.object));
        if (!objectDef || typeof objectDef !== 'object') return {};
        const { buildDefaultPageSchema } = await import('@object-ui/plugin-detail');
        // The running app's detail sections, from the one derivation it uses
        // (objectui#12442) — without them an object with no `fieldGroups`
        // seeded a bare `record:details`. Written in the persisted shape (field
        // NAMES); the heading is the English default, since a seed has no
        // translator and the section's `name` keeps the per-object i18n anchor.
        const { deriveStudioDetailSections, toAuthoredDetailSections, MORE_DETAILS_DEFAULT_LABEL } =
          await import('../recordDetailSections.js');
        const sections = toAuthoredDetailSections(
          deriveStudioDetailSections(objectDef as any, { moreDetails: MORE_DETAILS_DEFAULT_LABEL }),
        );
        const synth = buildDefaultPageSchema(objectDef as any, sections ? { sections: sections as any } : undefined) as Record<string, any>;
        const seed: Record<string, unknown> = {};
        if (Array.isArray(synth?.regions) && synth.regions.length) seed.regions = synth.regions;
        if (synth?.template) seed.template = synth.template;
        return seed;
      } catch {
        return {};
      }
    },
  });

  // A view is the canonical first-class ViewItem ({ viewKind, config }),
  // bound to its object by the top-level `object` foreign key.
  registerMetadataResource({
    type: 'view',
    anchors: [{
      anchorType: 'object',
      match: anchorByField([
        'object',
        'config.data.object',
      ]),
      groupLabel: 'Views',
      order: 30,
    }],
    createFields: ['label', 'name', 'object', 'viewKind', 'kind', 'formType'],
    createDerive: [
      { from: 'label', to: 'name', transform: 'slugify', untilUserEdits: true },
    ],
    createSchema: {
      type: 'object',
      required: ['label', 'name', 'object', 'viewKind'],
      properties: {
        label: { type: 'string', title: 'Label', description: 'Human-readable view name.' },
        name: {
          type: 'string',
          title: 'Name',
          description: 'View key (snake_case). Qualified to <object>.<key> on save.',
          pattern: '^[a-z_][a-z0-9_]*$',
        },
        object: {
          type: 'string',
          title: 'Object',
          widget: 'ref:object',
          description: 'The object this view displays.',
        },
        // The family discriminator (ViewItemSchema is a discriminated union on
        // `viewKind`). Picks which config shape — and therefore which layout
        // picker below — applies.
        viewKind: {
          type: 'string',
          title: 'View family',
          enum: ['list', 'form'],
          default: 'list',
          description:
            'List views show many records as a collection (grid, kanban, …). Form views show one record as a field layout (simple, tabbed, …).',
        },
        // List-family layout. Shown only when `viewKind` is 'list'; its value
        // becomes the list `config.type`.
        kind: {
          type: 'string',
          title: 'List layout',
          enum: ['grid', 'kanban', 'gallery', 'calendar', 'timeline', 'gantt', 'chart'],
          default: 'grid',
          description: 'Pick a starter layout. Switch later in the designer.',
          visibleWhen: "data.viewKind == 'list'",
        },
        // Form-family layout (FormViewSchema.type). Shown only when `viewKind`
        // is 'form'; its value becomes the form `config.type`.
        formType: {
          type: 'string',
          title: 'Form layout',
          enum: ['simple', 'tabbed', 'wizard', 'split', 'drawer', 'modal'],
          default: 'simple',
          description: 'Pick a starter form layout. Switch later in the designer.',
          visibleWhen: "data.viewKind == 'form'",
        },
      },
    },
    // Emit a canonical ViewItem. `name` is the globally-unique qualified id
    // `<object>.<key>`; `viewKind` discriminates the config shape. A list view
    // carries the chosen list layout (grid/kanban/…) at `config.type`; a form
    // view carries the chosen form layout (simple/tabbed/…) at `config.type`
    // with a `sections` body instead of `columns`.
    createBuildBody: (draft) => {
      const object = String(draft.object ?? '');
      const key = String(draft.name ?? '');
      const qualifiedName =
        key.includes('.') || !object ? key : `${object}.${key}`;
      const isForm = draft.viewKind === 'form';
      const formType = (draft.formType as string) || 'simple';
      const config = isForm
        ? {
            type: formType,
            data: { provider: 'object', object },
            // A `type: 'wizard'` form view must declare its steps: the spec
            // refuses absent/EMPTY `sections` on the wizard variant at parse
            // (objectstack#13622 D7, ruled 2026-08-31 — before that refusal
            // the shape silently rendered as a plain simple form). Seed one
            // starter step so a create→save that never opens the designer
            // can't 422 once the platform runs a spec carrying the refusal —
            // the same seed-the-required-shape move the flow anchor makes for
            // its `type` enum (objectui#2326). Other form types keep the bare
            // `[]`: only the wizard variant refuses emptiness, and seeding
            // where nothing demands it would put fabricated structure into
            // every authored view.
            sections:
              formType === 'wizard' ? [{ label: 'Step 1', fields: [] }] : [],
          }
        : {
            type: (draft.kind as string) || 'grid',
            columns: [],
            data: { provider: 'object', object },
          };
      return {
        name: qualifiedName,
        object,
        viewKind: isForm ? 'form' : 'list',
        label: draft.label,
        config,
      };
    },
  });

  // flow may reference an object at the root or under `on`
  registerMetadataResource({
    type: 'flow',
    anchors: [{
      anchorType: 'object',
      match: anchorByField(['object', 'on.object', 'trigger.object']),
      groupLabel: 'Flows',
      order: 50,
    }],
    createFields: ['label', 'name', 'type', 'description'],
    createDerive: [
      { from: 'label', to: 'name', transform: 'slugify', untilUserEdits: true },
    ],
    // `type` is a required FlowSchema enum (autolaunched | record_change |
    // schedule | screen | api). Seed the canonical default so a create→save
    // that never touches the type picker can't 422 — mirrors the server's
    // BUILTIN_METADATA_CREATE_SEEDS and the Studio inline skeleton
    // (buildFlowSkeleton). See objectui#2326.
    createDefaults: { type: 'autolaunched', nodes: [], edges: [] },
  });
  // ADR-0020: `workflow` retired as a metadata type — record state machines
  // are a `state_machine` validation rule on the object (no separate anchor).

  // ADR-0088: `trigger` retired as a metadata type — sync data-layer logic is
  // a `hook` (lifecycle events); async automation is a `record_change` flow.
  // Neither anchors here, so there is no standalone "Triggers" group.

  // ADR-0088 / objectstack#4509: `validation` retired as a metadata type. A
  // validation rule is embedded in its object (`object.validations`) and only
  // there — that anchor is `__object_validation` at the top of this file, and it
  // stays. There is no standalone "Validations" group and no create affordance,
  // because a standalone rule was never evaluated: the schema has no
  // object-binding key, every variant is `.strict()` so an author could not add
  // one, and no merge code ever read such an item. It saved cleanly and gated
  // nothing (framework ledger, `packages/spec/liveness/validation.json`).
  // Re-measured at `@objectstack/spec` 17.0.0-rc.6: `validation` is in neither
  // the registered-kind registry nor the unregistered-kind schema list.
  // Console history: this file registered that door (with `createFields` /
  // `createSchema`) until objectui#4132 removed it.

  // permission has a sparse object-keyed map under `objects`. Match by
  // membership of the parent name in that map.
  registerMetadataResource({
    type: 'permission',
    anchors: [{
      anchorType: 'object',
      match: (item, name) => {
        const objs = (item as { objects?: Record<string, unknown> })?.objects;
        return !!objs && typeof objs === 'object' && name in objs;
      },
      groupLabel: 'Permissions',
      order: 60,
    }],
    createFields: ['label', 'name'],
    createDerive: [
      { from: 'label', to: 'name', transform: 'slugify', untilUserEdits: true },
    ],
    createDefaults: { objects: {} },
    // The set's EditPage, `PermissionMatrixEditPage`, edits the live set
    // outside a package and reads no draft (objectui#7611).
    createLive: true,
  });

  // action — both record-scoped and object-scoped actions live here.
  // Schemas vary, so accept any of the three common shapes.
  registerMetadataResource({
    type: 'action',
    anchors: [{
      anchorType: 'object',
      match: anchorByField([
        'object',
        'target.object',
        'on.object',
      ]),
      groupLabel: 'Actions',
      order: 55,
    }],
    createFields: ['label', 'name', 'objectName', 'icon'],
    createDerive: [
      { from: 'label', to: 'name', transform: 'slugify', untilUserEdits: true },
    ],
    // Without a `createSchema` the create form falls back to the server's edit
    // schema (or its FormView layout), where `objectName` carries no widget hint
    // and renders as a plain text input (objectui#2325). Declaring it here — the
    // same pattern `view`/`page` use — makes the object-binding field a proper
    // `ref:object` dropdown and the icon field a searchable picker. `objectName`
    // is the spec's action→object binding key (ActionSchema has no `object`); it
    // stays optional because record-scoped / global actions bind no object.
    createSchema: {
      type: 'object',
      required: ['label', 'name'],
      properties: {
        label: { type: 'string', title: 'Label', description: 'Human-readable action name.' },
        name: {
          type: 'string',
          title: 'Name',
          description: 'Action key (snake_case). Used in URLs.',
          pattern: '^[a-z_][a-z0-9_]*$',
        },
        objectName: {
          type: 'string',
          title: 'Object',
          widget: 'ref:object',
          description: 'The object this action is bound to. Leave empty for a global / record-scoped action.',
        },
        icon: {
          type: 'string',
          title: 'Icon',
          widget: 'icon',
          description: 'Optional icon shown on the action button.',
        },
      },
    },
    // A new action defaults to `type: 'script'` (ActionType.default), which the
    // spec requires to carry an executable `body` or `target` — otherwise the
    // draft fails validation on save (422) and AppPlugin registers no engine
    // handler (the objectstack-ai/objectstack#2169 "Mark Done" runtime miss). Seed a no-op L2 body so
    // "New action -> name -> Save" round-trips; the author edits the source after.
    createDefaults: {
      type: 'script',
      body: { language: 'js', source: 'return { success: true };' },
    },
  });

  // dashboard / report — surface ones bound to a specific object.
  // Many will not have an explicit anchor; those simply don't appear.
  registerMetadataResource({
    type: 'dashboard',
    anchors: [{
      anchorType: 'object',
      match: anchorByField(['object', 'data.object']),
      groupLabel: 'Dashboards',
      order: 80,
    }],
    createFields: ['label', 'name', 'description'],
    createDerive: [
      { from: 'label', to: 'name', transform: 'slugify', untilUserEdits: true },
    ],
    createDefaults: { widgets: [] },
  });
  registerMetadataResource({
    type: 'report',
    anchors: [{
      anchorType: 'object',
      match: anchorByField(['object', 'data.object']),
      groupLabel: 'Reports',
      order: 81,
    }],
    // ADR-0021 single-form: a report is dataset-bound — `objectName` and the
    // legacy `columns` array were removed from ReportSchema, so seeding them
    // here produced a stub that failed server validation ("a report needs
    // `dataset` + `values`"). Report-create now lights up the canvas +
    // ReportDefaultInspector (see CREATE_MODE_CANVAS_TYPES), where the author
    // picks the dataset/measures/dimensions directly; we just seed a sensible
    // starting type.
    createFields: ['label', 'name', 'description'],
    createDerive: [
      { from: 'label', to: 'name', transform: 'slugify', untilUserEdits: true },
    ],
    // Seed `drilldown:true` so the inspector toggle reflects the schema default
    // (otherwise it shows OFF on a fresh report while the spec default is true).
    createDefaults: { type: 'summary', drilldown: true },
  });

  // Cosmetic defaults for the `object` type list page — gives Object the
  // same look as every other metadata type while still surfacing the
  // fields/columns developers care about most.
  registerMetadataResource({
    type: 'object',
    iconName: 'database',
    domain: 'data',
    // Protocol-driven create form: ask for identity only. The rest of
    // the object (fields, validations, indexes, hooks, …) is added
    // through the bespoke designer that takes over on the edit page,
    // so requiring it up-front would just front-load 30 inputs with
    // no payoff.
    createFields: ['label', 'pluralLabel', 'name', 'description'],
    createDerive: [
      { from: 'label', to: 'name', transform: 'slugify', untilUserEdits: true },
      { from: 'label', to: 'pluralLabel', transform: 'plural-en', untilUserEdits: true },
    ],
    // `fields` is the only other required key on the ObjectSchema —
    // seed it as an empty record so the saved body validates.
    createDefaults: { fields: {} },
    searchableFields: ['name', 'label', 'pluralLabel', 'description'],
    listColumns: [
      { key: 'name', label: 'Name', width: '24%' },
      { key: 'label', label: 'Label', width: '22%' },
      { key: 'pluralLabel', label: 'Plural', width: '22%' },
      {
        key: 'fields',
        label: 'Fields',
        width: '90px',
        render: (value) => {
          if (value == null) return '—';
          const count = Array.isArray(value)
            ? value.length
            : typeof value === 'object'
              ? Object.keys(value as Record<string, unknown>).length
              : 0;
          return count;
        },
      },
      { key: 'description', label: 'Description' },
    ],
  });

  // objectui#12982 — the declared sharing rules Setup lists read-only
  // (`sharing-rule-catalog.ts`): what each grants, and the package that
  // declares it.
  registerMetadataResource({
    type: 'sharing_rule',
    iconName: 'share-2',
    searchableFields: ['name', 'label', 'description', 'object'],
    listColumns: [
      { key: 'name', label: 'Name' },
      { key: 'label', label: 'Label' },
      { key: 'object', label: 'Object' },
      {
        key: 'sharedWith',
        label: 'Shared with',
        render: (value) => {
          const v = value as { type?: unknown; value?: unknown } | null | undefined;
          return v && typeof v === 'object' ? `${String(v.type ?? '')}: ${String(v.value ?? '')}` : '—';
        },
      },
      { key: 'accessLevel', label: 'Access' },
      {
        key: '_packageId',
        label: 'Package',
        render: (value) => (typeof value === 'string' && value && value !== 'sys_metadata' ? value : '—'),
      },
    ],
  });
}

/**
 * Coerce an embedded "collection" into a list of `{ name, …rest }`.
 *
 * ObjectStack stores some embedded collections as name-keyed maps
 * (`object.fields`) and others as arrays (`object.indexes`). Both want
 * to render the same way in Related; this helper papers over the gap
 * by injecting the map key as `name` when needed.
 */
function mapOrArrayToList(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) => {
      const body = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
      return { name: k, ...body };
    });
  }
  return [];
}
