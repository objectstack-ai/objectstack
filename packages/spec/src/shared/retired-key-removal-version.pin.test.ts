// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Class pin: a retirement prescription names the release that removed it, and
 * the pin DERIVES that release from the ADR-0087 conversion entry instead of
 * trusting the sentence.
 *
 * Governing text, `retiredKey()`'s `@param guidance` (`./retired-key.ts`):
 * "State what replaced the key, the version that removed it, and the one-line
 * fix — this string IS the migration doc for anyone who hits it." A wrong
 * version there is wrong release text: it ships in every refusal, in every
 * JSON Schema `describe`, and in what `os validate` prints.
 *
 * ## The derivation
 *
 * `MetadataConversion.retiredAfter` is the last published `@objectstack/spec`
 * release whose authoring surface still accepted the old shape
 * (`../conversions/types.ts`). So the release that removed it is the first
 * stable release after `retiredAfter`, and the prescription names that
 * release's major:
 *
 *   - `retiredAfter` is the newest published stable release ⇒ nothing published
 *     refuses the shape yet, and the release `main` cuts next does. Its major is
 *     `PROTOCOL_MAJOR`, which `../kernel/protocol-version.ts` keeps in lockstep
 *     with the package major and, in Changesets pre mode with a pending major,
 *     lets name the major that release is about to publish. On the v18 train
 *     that is 18. On the 17.x line, where a retirement shipped as a minor,
 *     the same rule gave 17.
 *   - `retiredAfter` is older ⇒ a published release refuses it: the next one on
 *     the same line when the tree records one, else the first release of the
 *     next line.
 *
 * "The newest published stable release" is read off the tree, with no version
 * written here. It is the highest stable version the tree records: every
 * census release, every `retiredAfter` stamp, and the package label when the
 * label is stable. Under a stable label that is the label: `main` carries the
 * last release's label until the next one is cut, and
 * `retired-after.census.test.ts` holds every stamp and every census release at
 * or below it. Under a prerelease label (`18.0.0-next.N`) it is the highest
 * stamp: every retirement that lands then stamps the newest published stable
 * release (`../conversions/types.ts`). The committed census alone cannot
 * answer it, because the census trails the published line until it is
 * refreshed after a stable publish.
 *
 * ## The join
 *
 * `JOIN` maps a retired conversion id to the prescriptions an author meets for
 * its surface. A tombstone row reads the key's parse refusal and its
 * `[REMOVED]` description, which are the two channels. A refusal row reads the
 * refusal the surface answers, for a value or union-arm retirement that has no
 * key to tombstone. Two guards keep the join honest:
 *
 *   - every retired entry whose `retiredAfter` is the newest published stable
 *     release must have a row, so a future retirement cannot ship its
 *     prescription unjudged;
 *   - the rows must discriminate: at least one derives `PROTOCOL_MAJOR` and at
 *     least one derives an older major, so the derivation is exercised in both
 *     directions on real entries, never vacuously.
 *
 * The four older rows are entries a 17.x minor shipped. Each is `toMajor: 18`
 * like the rest, so `toMajor` cannot be what tells them apart. One of them,
 * the sub-day time interval, guards the opposite direction: a prescription for
 * a shape a 17.x minor already refused must not name the next major.
 *
 * Out of reach by construction: a retirement with no D2 conversion carries no
 * `retiredAfter`, so nothing here can derive its release (a retired-key-only
 * tombstone, or a value retired with only a D3 entry).
 *
 * Each prescription's `os migrate meta --from N` sentence is derived the same
 * way: `composeMigrationChain` keeps the majors above N, so the step that
 * replays a `toMajor: T` entry is reached by `--from T-1`.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ALL_CONVERSIONS } from '../conversions/registry';
import { TimeUpdateInterval } from '../data/analytics.zod';
import { IndexSchema, ObjectSchema } from '../data/object.zod';
import { ManifestPermissionsSchema } from '../kernel/manifest.zod';
import {
  DeleteRecordConfigSchema,
  GetRecordConfigSchema,
  MapConfigSchema,
} from '../automation/builtin-node-config.zod';
import { NotifyConfigSchema } from '../automation/io-node-config.zod';
import { ScriptConfigSchema, SubflowConfigSchema } from '../automation/schemaless-node-config.zod';
import { AdminScopeSchema, PermissionSetSchema } from '../security/permission.zod';
import { SharingLevel } from '../security/sharing.zod';
import { DatasourceSchema } from '../data/datasource.zod';
import { PageComponentSchema, PageSchema } from '../ui/page.zod';
import { AddRecordConfigSchema, FormFieldSchema, FormSectionSchema, ListViewSchema, ObjectListViewSchema } from '../ui/view.zod';
import { FlowSchema } from '../automation/flow.zod';
import { JobSchema } from '../system/job.zod';
import { PROTOCOL_MAJOR } from '../kernel/protocol-version';
import { EmailTemplateDefinitionSchema } from '../system/email-template.zod';
import {
  ActionButtonPropsSchema,
  ActionGroupPropsSchema,
  ComponentPropsMap,
  ActionIconPropsSchema,
  ActionMenuPropsSchema,
  ElementNumberPropsSchema,
  ElementRecordPickerPropsSchema,
  ElementButtonPropsSchema,
  ElementRepeaterPropsSchema,
  ObjectGridPropsSchema,
  ObjectKanbanPropsSchema,
  PageHeaderProps,
} from '../ui/component.zod';

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

type Triple = [number, number, number];

const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;

function triple(v: string): Triple {
  const m = STABLE.exec(v);
  if (!m) throw new Error(`not a stable x.y.z version: '${v}'`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a: string, b: string): number {
  const x = triple(a);
  const y = triple(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}

const major = (v: string): number => triple(v)[0];

/** What the tree records about the published line, and the major `main` publishes next. */
interface ReleaseFacts {
  /** Every stable version the tree records: census releases, stamps, a stable label. */
  recorded: readonly string[];
  protocolMajor: number;
}

function newestStable(facts: ReleaseFacts): string {
  return facts.recorded.reduce((a, b) => (cmp(a, b) >= 0 ? a : b));
}

/** The major of the first stable release that refuses a shape last accepted by `retiredAfter`. */
function removalMajor(retiredAfter: string, facts: ReleaseFacts): number {
  if (cmp(retiredAfter, newestStable(facts)) >= 0) return facts.protocolMajor;
  const line = major(retiredAfter);
  const laterOnLine = facts.recorded.some((v) => major(v) === line && cmp(v, retiredAfter) > 0);
  return laterOnLine ? line : line + 1;
}

const LABEL = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

const CENSUS = JSON.parse(
  readFileSync(new URL('../conversions/retired-after.census.json', import.meta.url), 'utf8'),
) as { precedingRelease: string; releases: { version: string }[] };

const RETIRED = ALL_CONVERSIONS.filter((c) => c.retiredFromLoadPath === true);

const FACTS: ReleaseFacts = {
  recorded: [
    CENSUS.precedingRelease,
    ...CENSUS.releases.map((r) => r.version),
    ...RETIRED.map((c) => c.retiredAfter!),
    ...(STABLE.test(LABEL) ? [LABEL] : []),
  ],
  protocolMajor: PROTOCOL_MAJOR,
};

const NEWEST_STABLE = newestStable(FACTS);

// ---------------------------------------------------------------------------
// Prescriptions
// ---------------------------------------------------------------------------

interface Prescription {
  where: string;
  text: string;
}

type Renderer = () => Prescription[];

type Parse = { success: boolean; error?: { issues: { message: string; path?: readonly PropertyKey[] }[] } };
type Shaped = { shape: Record<string, { safeParse: (v: unknown) => Parse; description?: string }> };

/** A `retiredKey()` tombstone: its parse refusal and its `[REMOVED]` description. */
const tombstone = (schema: unknown, surface: string, key: string): Renderer => () => {
  const field = (schema as Shaped).shape[key];
  if (!field) throw new Error(`${surface}: no key \`${key}\` on the schema`);
  const refused = field.safeParse(1);
  expect(refused.success, `${surface}.${key} must refuse every value`).toBe(false);
  const description = field.description ?? '';
  expect(description.startsWith('[REMOVED] '), `${surface}.${key}: the description is a tombstone's`).toBe(true);
  return [
    { where: `${surface}.${key} (parse)`, text: refused.error!.issues[0]!.message },
    { where: `${surface}.${key} (describe)`, text: description.slice('[REMOVED] '.length) },
  ];
};

/**
 * The refusal a surface answers for a retired value or union arm. `at` keeps
 * only the issues at that first path segment, for a surface whose parse can
 * report other, unrelated issues.
 */
const refusal = (where: string, parse: () => Parse, at?: PropertyKey): Renderer => () => {
  const refused = parse();
  expect(refused.success, `${where} must be refused`).toBe(false);
  const issues = refused.error!.issues.filter((issue) => at === undefined || issue.path?.[0] === at);
  expect(issues.length, `${where}: no issue at ${String(at)}`).toBeGreaterThan(0);
  return issues.map((issue) => ({ where, text: issue.message }));
};

const ELEMENTS: readonly (readonly [unknown, string, readonly string[]])[] = [
  [ElementNumberPropsSchema, 'element:number', ['object', 'filter']],
  [ElementRecordPickerPropsSchema, 'element:record_picker', ['object', 'filter', 'sort', 'limit']],
  [ElementRepeaterPropsSchema, 'element:repeater', ['object', 'filter', 'sort', 'limit']],
];

/** A parseable flow holding one `node` after its start node. */
const flowWithNode = (node: Record<string, unknown>) => ({
  name: 'settle',
  label: 'Settle',
  type: 'autolaunched',
  edges: [],
  nodes: [{ id: 'n1', type: 'start', label: 'Start' }, { id: 'n2', label: 'Step', ...node }],
});

/** A notify config that is valid on its own, so a retired key is its only issue. */
const NOTIFY_BASE = { recipients: ['u1'], title: 'Hi' };

/** Retired conversion id → the prescriptions an author meets for its surface. */
const JOIN: Readonly<Record<string, readonly Renderer[]>> = {
  'element-flat-data-binding-to-data-source': ELEMENTS.flatMap(([schema, surface, keys]) =>
    keys.map((key) => tombstone(schema, surface, key)),
  ),
  'object-external-sharing-model-removed': [tombstone(ObjectSchema, 'object', 'externalSharingModel')],
  'object-grid-default-filters-removed': [tombstone(ObjectGridPropsSchema, 'object-grid', 'defaultFilters')],
  'email-template-category-is-system-removed': [
    tombstone(EmailTemplateDefinitionSchema, 'email_template', 'category'),
    tombstone(EmailTemplateDefinitionSchema, 'email_template', 'isSystem'),
  ],
  'permission-admin-scope-binding-authoring-removed': [
    tombstone(AdminScopeSchema, 'permission.adminScope', 'manageBindings'),
    tombstone(AdminScopeSchema, 'permission.adminScope', 'authorEnvironmentSets'),
  ],
  'permission-set-managed-by-removed': [tombstone(PermissionSetSchema, 'permission', 'managedBy')],
  'manifest-permissions-string-list-removed': [
    refusal('manifest.permissions as a list of strings', () => ManifestPermissionsSchema.safeParse(['system.user.read'])),
  ],
  'declared-index-unique-scope': [
    refusal('indexes[].unique: true', () => IndexSchema.safeParse({ fields: ['code'], unique: true })),
  ],
  'page-action-row-navigation-executor-to-url': [
    refusal("action:button actionType 'navigation'", () => ActionButtonPropsSchema.safeParse({ label: 'Clone', actionType: 'navigation', target: '/apps/crm/tasks' })),
    refusal("action:icon actionType 'navigation'", () => ActionIconPropsSchema.safeParse({ icon: 'copy', label: 'Clone', actionType: 'navigation', target: '/apps/crm/tasks' })),
    refusal("action:group member type 'navigation'", () => ActionGroupPropsSchema.safeParse({ actions: [{ label: 'Clone', type: 'navigation', target: '/apps/crm/tasks' }] })),
    refusal("action:menu member type 'navigation'", () => ActionMenuPropsSchema.safeParse({ actions: [{ label: 'Clone', type: 'navigation', target: '/apps/crm/tasks' }] })),
  ],
  // #24394: retired after 17.7.0, so the v18 train's major. The two nodes carry
  // the tombstone at `patch`; the containers' shared member carries the same one.
  'page-action-row-patch-removed': [
    tombstone(ActionButtonPropsSchema, 'action:button', 'patch'),
    tombstone(ActionIconPropsSchema, 'action:icon', 'patch'),
    refusal("action:group member's patch", () => ActionGroupPropsSchema.safeParse({ actions: [{ label: 'Close', patch: { status: 'done' } }] }), 'actions'),
    refusal("action:menu member's patch", () => ActionMenuPropsSchema.safeParse({ actions: [{ label: 'Close', patch: { status: 'done' } }] }), 'actions'),
  ],
  'cbp-master-detail-required-defaulted': [
    refusal(
      'a controlled_by_parent master_detail without `required`',
      () => ObjectSchema.safeParse({
        name: 'cbp_line',
        label: 'Line',
        sharingModel: 'controlled_by_parent',
        fields: { order: { type: 'master_detail', label: 'Order', reference: 'cbp_order' } },
      }),
      'sharingModel',
    ),
  ],
  // Two protocol-17 live-window conversions retired from the load path at 18
  // (`toMajor: 17`, unlike every other row): the prescription is the refusal
  // the surface answers once the loader stops rewriting the old spelling.
  'page-header-subtitle-alias': [
    refusal("page:header property 'description'", () => PageHeaderProps.safeParse({ title: 'Leads', description: 'All open leads' })),
  ],
  'inline-action-api-params-to-body-extra': [
    refusal(
      "an inline type:'api' action's object-form params",
      () => ElementButtonPropsSchema.safeParse({ label: 'Go', action: { type: 'api', target: '/x', params: { a: 1 } } }),
      'action',
    ),
  ],
  // The family's closing members (#23487): six more entries whose windows had
  // run (five `toMajor: 17`, one `toMajor: 11`), each refused by its surface's
  // own contract once the loader stopped rewriting it. A node-config row
  // carries the contract's required canonical keys beside the retired one, so
  // the unrecognized-key refusal is the only issue the parse reports.
  'flow-node-crud-object-alias': [
    refusal("a CRUD node's config.object", () => GetRecordConfigSchema.safeParse({ objectName: 'lead', object: 'lead' })),
  ],
  'flow-node-crud-filter-alias': [
    refusal("a CRUD node's config.filters", () => DeleteRecordConfigSchema.safeParse({ objectName: 'lead', filters: { status: 'stale' } })),
  ],
  'flow-node-notify-config-aliases': [
    ...(['to', 'subject', 'body', 'url'] as const).map((key) =>
      refusal(`a notify node's config.${key}`, () => NotifyConfigSchema.safeParse({ ...NOTIFY_BASE, [key]: 'x' })),
    ),
    refusal("a notify node's nested config.source", () => NotifyConfigSchema.safeParse({ ...NOTIFY_BASE, source: { object: 'lead', id: '1' } })),
  ],
  'flow-node-map-flow-alias': [
    refusal("a map node's config.flow", () => MapConfigSchema.safeParse({ collection: [], flowName: 'f', flow: 'f' })),
  ],
  'flow-node-subflow-flow-alias': [
    refusal("a subflow node's config.flow", () => SubflowConfigSchema.safeParse({ flowName: 'f', flow: 'f' })),
  ],
  'flow-node-script-config-aliases': [
    refusal("a script node's config.functionName", () => ScriptConfigSchema.safeParse({ function: 'f', functionName: 'f' })),
    refusal("a script node's config.input", () => ScriptConfigSchema.safeParse({ function: 'f', input: {} })),
  ],
  'sharing-rule-access-level-full-to-edit': [
    refusal("sharing-rule accessLevel 'full'", () => SharingLevel.safeParse('full')),
  ],
  // #23543 F1: an open-namespace value retired by name (`DriverType`); the
  // config is a valid mongodb config, so `driver` is the only issue.
  'datasource-driver-mongo-to-mongodb': [
    refusal(
      "datasource driver 'mongo'",
      () => DatasourceSchema.safeParse({ name: 'events', driver: 'mongo', config: { url: 'mongodb://db/x' } }),
      'driver',
    ),
  ],
  // #23543 F5-jsx: an enum member retired through `enumWithRetiredValues`; the
  // page is otherwise a complete html page, so `kind` is the only issue.
  'page-kind-jsx-to-html': [
    refusal(
      "page kind 'jsx'",
      () => PageSchema.safeParse({ name: 'landing', label: 'Landing', kind: 'jsx', source: '<div>hi</div>' }),
      'kind',
    ),
  ],
  // #23650: retired after 17.7.0, so the v18 train's major.
  'page-header-show-star-removed': [tombstone(PageHeaderProps, 'page:header', 'showStar')],
  // #24640: retired after 17.7.0, so the v18 train's major. One tombstone on
  // the list-view shape, walked as both list-view defs.
  // #24692: retired after 18.0.0, the first post-GA 18.x retirement — so the
  // newest published stable release, and the v18 train's major.
  'add-record-mode-form-view-removed': [
    tombstone(AddRecordConfigSchema, 'addRecord', 'mode'),
    tombstone(AddRecordConfigSchema, 'addRecord', 'formView'),
  ],
  'add-record-enabled-defaulted': [
    refusal('an addRecord block without `enabled`', () => AddRecordConfigSchema.safeParse({}), 'enabled'),
  ],
  'view-list-filterable-fields-removed': [
    tombstone(ListViewSchema, 'view.list', 'filterableFields'),
    tombstone(ObjectListViewSchema, 'object.listViews.*', 'filterableFields'),
  ],
  // #23904: the two data-at-rest halves of the #23610 page refusals, retired
  // after 17.7.0; each prescription is the parse's own refusal at its key — the
  // one sentence the registry door prints too — and names the release.
  'page-is-default-off-record-page-removed': [
    refusal(
      "isDefault: true on a type 'home' page",
      () => PageSchema.safeParse({ name: 'sales_home_page', label: 'Sales Home', type: 'home', isDefault: true, regions: [] }),
      'isDefault',
    ),
    refusal(
      'isDefault: true on a record page bound to no object',
      () => PageSchema.safeParse({ name: 'draft_record', label: 'Draft', type: 'record', isDefault: true, regions: [] }),
      'isDefault',
    ),
  ],
  // #22444: the page carrier's two aliases, undeclared on the `list-view` row
  // and answered by name with the row's guidance.
  'page-list-view-object-name-view-type-to-data-type': (['objectName', 'viewType'] as const).map((alias) =>
    refusal(
      `a page list-view node's properties.${alias}`,
      () => ComponentPropsMap['list-view'].safeParse({ [alias]: alias === 'objectName' ? 'deal' : 'kanban' }),
    ),
  ),
  // The data-at-rest half of the `main` region width refusal, retired after
  // 17.7.0; the prescription is the parse's own refusal at the region's width.
  'page-main-region-width-removed': (['small', 'medium', 'large'] as const).map((width) =>
    refusal(
      `width '${width}' on a page region named main`,
      () => PageSchema.safeParse({ name: 'sales_home_page', label: 'Sales Home', type: 'home', template: 'three-column', regions: [{ name: 'main', width, components: [] }] }),
      'regions',
    ),
  ),
  'page-template-full-width-to-default': [
    refusal(
      "page template 'full-width'",
      () => PageSchema.safeParse({ name: 'lead_detail_page', label: 'Lead', type: 'record', object: 'crm_lead', template: 'full-width', regions: [{ name: 'main', components: [] }] }),
      'template',
    ),
  ],
  // #23543 F3: a loose `config` key under a sibling-block node type, refused by
  // the flow parse; the node's block is complete, so the key is the only issue.
  'flow-node-wait-event-config-lift': [
    refusal(
      "a wait node's loose config.duration",
      () => FlowSchema.safeParse(flowWithNode({
        type: 'wait',
        waitEventConfig: { eventType: 'timer', timerDuration: 'PT5M' },
        config: { duration: 'PT9M' },
      })),
      'nodes',
    ),
  ],
  'flow-node-connector-config-lift': [
    refusal(
      "a connector_action node's loose config.input",
      () => FlowSchema.safeParse(flowWithNode({
        type: 'connector_action',
        connectorConfig: { connectorId: 'slack', actionId: 'chat.postMessage' },
        config: { input: { text: 'Hi' } },
      })),
      'nodes',
    ),
  ],
  // #23543 F2: a default flip made loud — a job's retry block with no
  // attempts, refused by the job parse at the key; the job is otherwise
  // complete, so the block is the only issue.
  'retry-policy-converged': [
    refusal(
      'a job retryPolicy with maxRetries omitted',
      () => JobSchema.safeParse({
        name: 'nightly_sync',
        schedule: { type: 'cron', expression: '0 0 * * *' },
        handler: 'syncOrders',
        retryPolicy: { backoffMs: 5000 },
      }),
      'retryPolicy',
    ),
  ],
  // #23543 F4: two protocol-15 renames retired with their keys — the three
  // tombstones naming `visibleWhen`, at each declared position.
  'view-visibleOn-to-visibleWhen': [
    tombstone(FormFieldSchema, 'view.form.sections[].fields[]', 'visibleOn'),
    tombstone(FormSectionSchema, 'view.form.sections[]', 'visibleOn'),
  ],
  'page-component-visibility-to-visibleWhen': [tombstone(PageComponentSchema, 'page.components[]', 'visibility')],
  // #23543 F5-http: the three retired callout names, reserved inside the open
  // node namespace and refused by the flow parse at the node's `type`; the
  // flow is otherwise complete, so `nodes` is the only issue path.
  'flow-node-http-callout-rename': (['http_request', 'http_call', 'webhook'] as const).map((type) =>
    refusal(
      `a flow node typed '${type}'`,
      () => FlowSchema.safeParse(flowWithNode({ type, config: { url: 'https://example.com' } })),
      'nodes',
    ),
  ),
  // Shipped by a 17.x minor; `toMajor: 18` like the rows above.
  'page-header-breadcrumb-removed': [tombstone(PageHeaderProps, 'page:header', 'breadcrumb')],
  'object-grid-default-sort-removed': [tombstone(ObjectGridPropsSchema, 'object-grid', 'defaultSort')],
  'object-kanban-quick-add-removed': [tombstone(ObjectKanbanPropsSchema, 'object-kanban', 'quickAdd')],
  'cube-sub-day-granularities-removed': [
    refusal('a sub-day TimeUpdateInterval member', () => TimeUpdateInterval.safeParse('minute')),
  ],
};

/** Every major a prescription names as a release: `@objectstack/spec N[.x.y]` or `protocol N`. */
function majorsNamed(text: string): number[] {
  return [...text.matchAll(/@objectstack\/spec (\d+)(?:\.\d+\.\d+)?\b|\bprotocol (\d+)\b/g)].map((m) =>
    Number(m[1] ?? m[2]),
  );
}

const byId = new Map(RETIRED.map((c) => [c.id, c]));

// ---------------------------------------------------------------------------

describe('a retirement prescription names the release the registry entry derives', () => {
  it('every joined entry is a retired conversion', () => {
    const stale = Object.keys(JOIN).filter((id) => !byId.has(id));
    expect(stale, 'JOIN names an id that is not a retired conversion').toEqual([]);
  });

  it('every entry retired after the newest published stable release is joined to its prescriptions', () => {
    const unjoined = RETIRED.filter((c) => cmp(c.retiredAfter!, NEWEST_STABLE) >= 0 && !(c.id in JOIN)).map(
      (c) => `${c.id} (retiredAfter ${c.retiredAfter})`,
    );
    expect(
      unjoined,
      `retired after ${NEWEST_STABLE}, the newest published stable release: add each to JOIN in this file, `
        + 'with the tombstones or refusals an author meets for its surface',
    ).toEqual([]);
  });

  it('the joined rows exercise the derivation in both directions', () => {
    const derived = Object.keys(JOIN).map((id) => removalMajor(byId.get(id)!.retiredAfter!, FACTS));
    expect(derived).toContain(PROTOCOL_MAJOR);
    expect(derived.some((m) => m < PROTOCOL_MAJOR)).toBe(true);
  });

  it.each(Object.keys(JOIN))('%s', (id) => {
    const entry = byId.get(id)!;
    const want = removalMajor(entry.retiredAfter!, FACTS);
    const prescriptions = JOIN[id]!.flatMap((render) => render());
    expect(prescriptions.length).toBeGreaterThan(0);
    for (const { where, text } of prescriptions) {
      const named = majorsNamed(text);
      expect(named.length, `${where}: names no release — ${text}`).toBeGreaterThan(0);
      expect(
        named.every((m) => m === want),
        `${where}: retiredAfter ${entry.retiredAfter} (newest published stable ${NEWEST_STABLE}) derives `
          + `@objectstack/spec ${want}, but the prescription names ${named.join(', ')} — ${text}`,
      ).toBe(true);
      for (const [, from] of text.matchAll(/os migrate meta --from (\d+)/g)) {
        expect(Number(from), `${where}: toMajor ${entry.toMajor} is replayed by --from ${entry.toMajor - 1}`).toBe(
          entry.toMajor - 1,
        );
      }
    }
  });
});

describe('the derivation under simulated release facts', () => {
  const at = (recorded: string[], protocolMajor: number): ReleaseFacts => ({ recorded, protocolMajor });

  it('a stable 17.x label on the v18 train: the newest stable is the next major\'s, older stamps keep 17', () => {
    const facts = at(['17.4.0', '17.5.0', '17.7.0', '17.7.0'], 18);
    expect(removalMajor('17.7.0', facts)).toBe(18);
    expect(removalMajor('17.5.0', facts)).toBe(17);
    expect(removalMajor('17.2.0', facts)).toBe(17);
  });

  it('a prerelease label records no label, and the highest stamp answers the same way', () => {
    const facts = at(['17.4.0', '17.5.0', '17.7.0'], 18);
    expect(newestStable(facts)).toBe('17.7.0');
    expect(removalMajor('17.7.0', facts)).toBe(18);
    expect(removalMajor('17.5.0', facts)).toBe(17);
  });

  it('once 18.0.0 is the label, a 17.7.0 stamp still derives 18, and an 18.x stamp stays on 18', () => {
    const facts = at(['17.4.0', '17.5.0', '17.7.0', '18.0.0', '18.1.0'], 18);
    expect(removalMajor('17.7.0', facts)).toBe(18);
    expect(removalMajor('17.5.0', facts)).toBe(17);
    expect(removalMajor('18.0.0', facts)).toBe(18);
    expect(removalMajor('18.1.0', facts)).toBe(18);
  });

  it('on the 17.x line, where a retirement shipped as a minor, the newest stamp derives 17', () => {
    const facts = at(['17.4.0', '17.5.0'], 17);
    expect(removalMajor('17.5.0', facts)).toBe(17);
  });

  it('the tree\'s own reading: the newest published stable is at least every census release', () => {
    for (const r of CENSUS.releases) expect(cmp(NEWEST_STABLE, r.version)).toBeGreaterThanOrEqual(0);
  });
});
