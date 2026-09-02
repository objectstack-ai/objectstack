// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 — the cross-package ACCEPT/REFUSE matrix, extended from the four
 * rules #14122 §4 measured to the nine object-naming item classes a real
 * product split needs, plus the analytics binding (#14454 items 1 and 4).
 *
 * ## What one row of this matrix asks
 *
 * Two packages, ONE artifact, ONE namespace — the ADR-0130 D1 co-ownership
 * shape now in `main` (#14354). Package A owns `crm_account`. Package B names
 * `crm_account` from an item of class X. Does the platform accept that, and if
 * it refuses, WHERE and with what?
 *
 * ## Why every row measures TWO gates, and why one gate is not enough
 *
 * #14122 §4 reported four verdicts without saying which door produced them, and
 * the four are not from the same door. Measured here:
 *
 *   • The **authoring gate** — `defineStack` (`@objectstack/spec`), which runs
 *     `validateCrossReferences` against the ONE stack in front of it. A package
 *     cannot see its co-owner's objects at authoring time, so for the classes
 *     this gate covers, "B names A's object" is indistinguishable from a typo
 *     and is refused. This is where §4's two REFUSE rows came from — their
 *     message text is `stack.zod.ts`'s, verbatim.
 *   • The **install gate** — `registerApp` → `SchemaRegistry.installPackage`,
 *     driven here through the REAL load path (`manifest.register()` on a booted
 *     kernel) exactly as `registry-artifact-co-ownership.test.ts` does.
 *
 * Reading only the install gate would report a uniform "ACCEPTED" for all nine
 * classes and be useless: it is TRUE (the loader validates no object reference
 * on any of these classes) but it answers a question nobody split a product
 * over. Reading only the authoring gate would miss that the runtime enforces
 * nothing, which is the other half a module author needs. So each row records
 * both, and the matrix's verdict is the EFFECTIVE one — refused at authoring
 * means the module cannot be written, whatever the registry would have done.
 *
 * ## ⚠️ The authoring gate throws a BARE `Error` — there is no ADR-0112 envelope
 *
 * `defineStack` aggregates its cross-reference errors into `new Error(...)`.
 * There is no `code` and no `status` to assert, so these rows assert the
 * message — which IS the contract here, since the message is the only thing
 * that distinguishes one refusal from another — and then assert the ABSENCE of
 * the envelope explicitly, in one place, so the gap is pinned rather than
 * merely unmentioned. Same shape of gap as #14367 (`registerObject`'s bare
 * `Error`), one door over.
 *
 * ⛔ If `ENVELOPE ABSENCE` below goes red, an envelope has ARRIVED. That is an
 * improvement: update this pin and the #14122 §4 matrix row. Do not delete the
 * assertion to make it green.
 *
 * ## This file measures. It does not prescribe.
 *
 * #14454 is a measurement card: no runtime behaviour changes here. Rows that
 * read "ACCEPTED (unenforced)" record what the platform does today — a dangling
 * cross-package reference on those classes reaches no check at either door and
 * fails, if at all, at first use. Whether any of them SHOULD be enforced is a
 * spec decision the readings exist to inform (the PR body carries the flagged
 * ones).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { defineStack } from '@objectstack/spec';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

type ManifestService = { register(m: unknown): void | Promise<void> };

/** The error shape every rejection assertion below reads. */
type Envelope = Error & { code?: string; status?: number };

const engineOf = (kernel: ObjectKernel): ObjectQL => kernel.getService<ObjectQL>('objectql');

/**
 * The object package B reaches across the boundary for, and the ONLY object
 * either gate could resolve `crm_account` to.
 */
const CROSS = 'crm_account';

/** Package A — owns `crm_account` and the dataset item 4's widgets bind. */
const packageA = () => ({
  id: 'com.acme.crm',
  name: 'acme_crm',
  version: '1.0.0',
  type: 'app',
  namespace: 'crm',
  objects: [
    { name: CROSS, label: 'Account', fields: { name: { name: 'name', label: 'Name', type: 'text' } } },
  ],
  // Item 4's target: an ADR-0021 semantic-layer dataset owned by A. B's
  // dashboard widget and report bind THIS by name.
  datasets: [
    {
      name: 'crm_account_ds',
      label: 'Accounts',
      object: CROSS,
      dimensions: [{ name: 'by_name', field: 'name' }],
      measures: [{ name: 'cnt', aggregate: 'count' }],
    },
  ],
});

/**
 * Package B — a co-owning `module` under the SAME namespace, owning its own
 * object, plus whichever item class this row is measuring.
 */
const packageB = (item: Record<string, unknown>) => ({
  id: 'com.acme.crm.billing',
  name: 'acme_crm_billing',
  version: '1.0.0',
  type: 'module',
  namespace: 'crm',
  objects: [
    { name: 'crm_invoice', label: 'Invoice', fields: { total: { name: 'total', label: 'Total', type: 'number' } } },
  ],
  ...item,
});

/** The artifact wrapper the ADR-0130 D5 load path reads (`packages[]`). */
const artifactOf = (...manifests: unknown[]) => ({ packages: manifests.map((manifest) => ({ manifest })) });

/**
 * Run package B's item class past the AUTHORING gate, as its own stack.
 *
 * This is what a module author actually writes: `defineStack` sees B's manifest
 * and B's objects, and nothing of A's — the same view it has in a split repo,
 * where each module compiles alone.
 */
const authoringVerdict = (item: Record<string, unknown>, ownObjects = false): Envelope | undefined => {
  const b = packageB(item);
  try {
    defineStack({
      manifest: { id: b.id, name: b.name, version: b.version, type: b.type, namespace: b.namespace },
      // The `ownObjects` control declares `crm_account` locally, which is the
      // ONLY difference between a refused row and its control. It is what makes
      // each refusal a reading about the PACKAGE BOUNDARY rather than about the
      // fixture being malformed in some unrelated way.
      objects: ownObjects ? [...b.objects, packageA().objects[0]] : b.objects,
      ...item,
    } as never);
    return undefined;
  } catch (e) {
    return e as Envelope;
  }
};

const kernels: ObjectKernel[] = [];

const freshKernel = async (): Promise<ObjectKernel> => {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  await kernel.use(new ObjectQLPlugin());
  await kernel.bootstrap();
  kernels.push(kernel);
  return kernel;
};

/**
 * Install A and B as co-owners of one artifact through the real load path, and
 * hand back whatever the gate did plus the registry to read.
 *
 * `manifest.register()` may reject OR throw synchronously — a refusal raised
 * inside `installPackage` propagates out of the non-async `register` before the
 * promise exists. Catching both is the honest spelling; `rejects` alone MISSES
 * the synchronous throw and reports it as a test error rather than a refusal
 * (the reason `registry-artifact-co-ownership.test.ts` spells it the same way).
 */
const installVerdict = async (
  item: Record<string, unknown>,
): Promise<{ refusal?: Envelope; kernel: ObjectKernel }> => {
  const kernel = await freshKernel();
  try {
    await (kernel.getService('manifest') as ManifestService).register(artifactOf(packageA(), packageB(item)));
    return { kernel };
  } catch (e) {
    return { refusal: e as Envelope, kernel };
  }
};

/**
 * The reading every ACCEPTED row makes at the registry: B's item is really
 * there, really stamped to B, and still carries A's object name — and the name
 * it carries really does resolve, to A's definition, through the namespace the
 * two packages co-own.
 *
 * "Registers AND resolves" is one proposition with two halves and both are
 * asserted, because either alone is satisfiable by an accident: an item can
 * register with a name that resolves to nothing, and an object can resolve
 * while the item that named it was dropped on the floor.
 */
const expectRegisteredAndResolves = (
  kernel: ObjectKernel,
  type: string,
  itemName: string,
  readRef: (item: Record<string, unknown>) => unknown,
): void => {
  const registry = engineOf(kernel).registry;
  const item = registry.getItem(type, itemName) as Record<string, unknown> | undefined;
  expect(item, `${type} '${itemName}' did not register`).toBeDefined();
  // ADR-0010 provenance: the item belongs to B, not to the package that owns
  // the object it names.
  expect(item?._packageId).toBe('com.acme.crm.billing');
  // The foreign reference survived registration verbatim — not rewritten, not
  // namespaced away, not dropped.
  expect(readRef(item!)).toBe(CROSS);
  // …and it points at something real: A's object, through the co-owned namespace.
  const resolved = registry.resolveObject(CROSS) as { label?: string } | undefined;
  expect(resolved?.label).toBe('Account');
  expect(registry.getObjectOwner(CROSS)?.packageId).toBe('com.acme.crm');
  // The co-ownership the whole reading rests on.
  expect(registry.getNamespaceOwners('crm').sort()).toEqual(['com.acme.crm', 'com.acme.crm.billing']);
};

afterEach(async () => {
  while (kernels.length) {
    const k = kernels.pop()!;
    if (k.getState() === 'running') await k.shutdown();
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Continuity control — reproduce a §4 row with THIS method before trusting the
// nine new ones.
// ────────────────────────────────────────────────────────────────────────────

describe('#14122 §4 continuity — the method reproduces an already-measured rule', () => {
  const hookItem = {
    hooks: [{
      name: 'acct_hook',
      object: CROSS,
      events: ['afterInsert'],
      body: { language: 'expression', source: 'true' },
    }],
  };

  it('R4 `hooks[].object` still REFUSES at the authoring gate, with §4\'s message verbatim', () => {
    // If this row ever disagrees with #14122 §4, the nine rows below are
    // measuring something other than what §4 measured and the matrix must not
    // be folded into §4 until that is explained. It is the control that makes
    // the rest of this file comparable to the four rules it extends.
    const refused = authoringVerdict(hookItem);
    expect(refused).toBeDefined();
    expect(refused?.message).toContain(
      `Hook 'acct_hook' references object '${CROSS}' which is not defined in objects.`,
    );

    // The boundary is the whole reason: same hook, object declared locally, accepted.
    expect(authoringVerdict(hookItem, true)).toBeUndefined();
  });

  it('ENVELOPE ABSENCE — the authoring gate carries no ADR-0112 `code` / `status`', () => {
    // Pinned once, here, rather than repeated on every refusing row. See the
    // file header: red here means an envelope ARRIVED (good) — update the pin
    // and the §4 matrix, do not delete the assertion.
    const refused = authoringVerdict(hookItem);
    expect(refused).toBeInstanceOf(Error);
    expect(refused?.code).toBeUndefined();
    expect(refused?.status).toBeUndefined();
    expect(refused?.message).toContain('defineStack cross-reference validation failed');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Item 1 — the four classes the AUTHORING gate refuses across the boundary.
// ────────────────────────────────────────────────────────────────────────────

describe('#14454 item 1 — classes REFUSED at the authoring gate (module cannot name a co-owner\'s object)', () => {
  /**
   * Each row: refused for B, accepted for the same B that declares the object
   * itself, and — separately — ACCEPTED by the install gate, which is the fact
   * that says the refusal is an authoring-door policy and not a runtime one.
   */
  const rows: Array<{
    label: string;
    item: Record<string, unknown>;
    message: string;
    type: string;
    itemName: string;
    readRef: (i: Record<string, unknown>) => unknown;
  }> = [
    {
      label: 'action `objectName`',
      item: { actions: [{ name: 'bill_account', label: 'Bill', type: 'url', target: '/billing', objectName: CROSS }] },
      message: `Action 'bill_account' references object '${CROSS}' which is not defined in objects.`,
      type: 'action',
      itemName: 'bill_account',
      readRef: (i) => i.objectName,
    },
    {
      label: 'permission set `objects`',
      item: { permissions: [{ name: 'billing_ops', objects: { [CROSS]: { allowRead: true } } }] },
      message: `Permission 'billing_ops' grants on object '${CROSS}' which is not defined in objects.`,
      type: 'permission',
      itemName: 'billing_ops',
      readRef: (i) => Object.keys(i.objects as Record<string, unknown>)[0],
    },
    {
      label: 'seed dataset `object`',
      item: { data: [{ object: CROSS, records: [{ name: 'Seeded' }] }] },
      message: `Seed data references object '${CROSS}' which is not defined in objects.`,
      type: 'data',
      itemName: CROSS,
      readRef: (i) => i.object,
    },
    {
      label: 'import mapping `targetObject`',
      item: { mappings: [{ name: 'acct_import', targetObject: CROSS, fieldMapping: [{ source: 'Name', target: 'name' }] }] },
      message: `Mapping 'acct_import' targets object '${CROSS}' which is not defined in objects.`,
      type: 'mapping',
      itemName: 'acct_import',
      readRef: (i) => i.targetObject,
    },
  ];

  for (const row of rows) {
    it(`${row.label} — REFUSED at authoring, ACCEPTED (unenforced) at install`, async () => {
      const refused = authoringVerdict(row.item);
      expect(refused, `${row.label} was expected to be refused at the authoring gate`).toBeDefined();
      expect(refused?.message).toContain(row.message);

      // Control: the SAME item, with the object declared locally, is accepted.
      // Without this the row cannot distinguish "the boundary refuses it" from
      // "the fixture is malformed".
      expect(authoringVerdict(row.item, true)).toBeUndefined();

      // The other door. Nothing on the load path re-asks the authoring gate's
      // question, so a manifest that reaches `registerApp` — a machine-assembled
      // artifact, a `strict: false` stack — installs clean.
      const { refusal, kernel } = await installVerdict(row.item);
      expect(refusal).toBeUndefined();
      expectRegisteredAndResolves(kernel, row.type, row.itemName, row.readRef);
    });
  }

  it('view `data.object` — REFUSED at authoring, ACCEPTED (unenforced) at install', async () => {
    // Split out because a `views:` entry is a CONTAINER keyed by its target
    // object, not by a `name` — so its registry key and its reference are the
    // same string, and the generic row helper's `readRef` would be asserting a
    // tautology. Read the container's `list.data.object` instead.
    const item = {
      views: [{ list: { data: { provider: 'object', object: CROSS }, columns: [{ field: 'name' }] } }],
    };
    const refused = authoringVerdict(item);
    expect(refused?.message).toContain(
      `View[0].list references object '${CROSS}' which is not defined in objects.`,
    );
    expect(authoringVerdict(item, true)).toBeUndefined();

    const { refusal, kernel } = await installVerdict(item);
    expect(refusal).toBeUndefined();
    const registry = engineOf(kernel).registry;
    const container = registry.getItem('view', CROSS) as Record<string, any> | undefined;
    expect(container).toBeDefined();
    expect(container?._packageId).toBe('com.acme.crm.billing');
    expect(container?.list?.data?.object).toBe(CROSS);
    // The container registered under A's object name while being owned by B —
    // the cross-package shape, live in the registry.
    expect(registry.getObjectOwner(CROSS)?.packageId).toBe('com.acme.crm');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Item 1 — the five classes NEITHER gate checks.
// ────────────────────────────────────────────────────────────────────────────

describe('#14454 item 1 — classes ACCEPTED (unenforced): no object cross-reference check at either gate', () => {
  /**
   * ⚠️ "ACCEPTED (unenforced)" is not "ACCEPTED". These classes register and
   * resolve across the boundary — which is what a module split needs — but they
   * would equally register a reference to an object that exists NOWHERE. Both
   * halves are asserted per row: the cross-package reference works, AND the
   * same class swallows a dangling name in silence. The second half is the one
   * that makes the row a finding rather than a green light.
   */
  const rows: Array<{
    label: string;
    item: Record<string, unknown>;
    dangling: Record<string, unknown>;
    type: string;
    itemName: string;
    readRef: (i: Record<string, unknown>) => unknown;
  }> = [
    {
      label: 'page record `object`',
      item: { pages: [{ name: 'acct_billing', label: 'Account Billing', type: 'record', object: CROSS }] },
      dangling: { pages: [{ name: 'acct_billing', label: 'Account Billing', type: 'record', object: 'crm_nowhere' }] },
      type: 'page',
      itemName: 'acct_billing',
      readRef: (i) => i.object,
    },
    {
      label: 'dataset `object`',
      item: {
        datasets: [{
          name: 'billing_by_account', label: 'Billing by Account', object: CROSS,
          dimensions: [{ name: 'by_name', field: 'name' }], measures: [{ name: 'cnt', aggregate: 'count' }],
        }],
      },
      dangling: {
        datasets: [{
          name: 'billing_by_account', label: 'Billing by Account', object: 'crm_nowhere',
          dimensions: [{ name: 'by_name', field: 'name' }], measures: [{ name: 'cnt', aggregate: 'count' }],
        }],
      },
      type: 'dataset',
      itemName: 'billing_by_account',
      readRef: (i) => i.object,
    },
    {
      label: 'sharing rule `object`',
      item: {
        sharingRules: [{
          name: 'acct_share', object: CROSS, type: 'criteria', condition: 'record.name != ""',
          sharedWith: { type: 'team', value: 'sales' }, accessLevel: 'read',
        }],
      },
      dangling: {
        sharingRules: [{
          name: 'acct_share', object: 'crm_nowhere', type: 'criteria', condition: 'record.name != ""',
          sharedWith: { type: 'team', value: 'sales' }, accessLevel: 'read',
        }],
      },
      // `sharingRules` registers under the SNAKE_CASE singular `sharing_rule`
      // (`pluralToSingular`), not `sharingRule` — a reader looking the item back
      // up under the camelCase spelling finds nothing and would mis-read this
      // row as "dropped".
      type: 'sharing_rule',
      itemName: 'acct_share',
      readRef: (i) => i.object,
    },
  ];

  for (const row of rows) {
    it(`${row.label} — ACCEPTED (unenforced) at both gates`, async () => {
      expect(authoringVerdict(row.item)).toBeUndefined();
      // The finding: the same gate accepts a name that exists nowhere at all.
      expect(
        authoringVerdict(row.dangling),
        `${row.label}: a DANGLING name was refused — this class is enforced after all, re-read the row`,
      ).toBeUndefined();

      const { refusal, kernel } = await installVerdict(row.item);
      expect(refusal).toBeUndefined();
      expectRegisteredAndResolves(kernel, row.type, row.itemName, row.readRef);
    });
  }

  it('page related-list `dataSource.object` — ACCEPTED (unenforced) at both gates', async () => {
    // Split out: the reference is not a top-level key but a per-element data
    // binding inside the page's component tree (`ElementDataSourceSchema`), so
    // reading it back means walking the page rather than reading a field. This
    // is the shape a module's own record page uses to show a related list of a
    // co-owner's records — the split's most common page-level crossing.
    const relatedList = (objectName: string) => ({
      pages: [{
        name: 'invoice_record', label: 'Invoice', type: 'record', object: 'crm_invoice',
        regions: [{
          name: 'main',
          components: [{ type: 'record:related_list', dataSource: { object: objectName } }],
        }],
      }],
    });

    expect(authoringVerdict(relatedList(CROSS))).toBeUndefined();
    expect(authoringVerdict(relatedList('crm_nowhere'))).toBeUndefined();

    const { refusal, kernel } = await installVerdict(relatedList(CROSS));
    expect(refusal).toBeUndefined();
    const registry = engineOf(kernel).registry;
    const page = registry.getItem('page', 'invoice_record') as Record<string, any> | undefined;
    expect(page?._packageId).toBe('com.acme.crm.billing');
    expect(page?.regions?.[0]?.components?.[0]?.dataSource?.object).toBe(CROSS);
    expect((registry.resolveObject(CROSS) as { label?: string } | undefined)?.label).toBe('Account');
    expect(registry.getObjectOwner(CROSS)?.packageId).toBe('com.acme.crm');
  });

  it('flow node `config.objectName` — ACCEPTED (unenforced) at both gates', async () => {
    // Split out for the same reason as the related list: a record-change flow
    // binds its object on the START node's `config`, which `FlowNodeSchema`
    // types as an open `z.record(z.string(), z.unknown())`. Nothing walks into
    // it — so this class is unenforced twice over: no cross-reference check,
    // and no schema on the value either.
    const flow = (objectName: string) => ({
      flows: [{
        name: 'acct_flow', label: 'Account Flow', type: 'record_change', edges: [],
        nodes: [{ id: 'start', type: 'start', label: 'Start', config: { objectName, triggerType: 'after_insert' } }],
      }],
    });

    expect(authoringVerdict(flow(CROSS))).toBeUndefined();
    expect(authoringVerdict(flow('crm_nowhere'))).toBeUndefined();

    const { refusal, kernel } = await installVerdict(flow(CROSS));
    expect(refusal).toBeUndefined();
    const registry = engineOf(kernel).registry;
    const registered = registry.getItem('flow', 'acct_flow') as Record<string, any> | undefined;
    expect(registered?._packageId).toBe('com.acme.crm.billing');
    expect(registered?.nodes?.[0]?.config?.objectName).toBe(CROSS);
    expect((registry.resolveObject(CROSS) as { label?: string } | undefined)?.label).toBe('Account');
    expect(registry.getObjectOwner(CROSS)?.packageId).toBe('com.acme.crm');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Item 4 — analytics binding across the boundary.
// ────────────────────────────────────────────────────────────────────────────

describe('#14454 item 4 — dashboard widget and report binding a co-owner\'s dataset', () => {
  /**
   * The question this decides, in the card's own words: *can a module carry its
   * own dashboard?* The dataset lives in package A; B's widget and report name
   * it. This is item 1's shape one layer up — a dataset name rather than an
   * object name — and the answer is the same at both doors, for the same
   * reason: nothing checks.
   */
  const FOREIGN_DATASET = 'crm_account_ds';

  const dashboard = (dataset: string) => ({
    dashboards: [{
      name: 'billing_overview', label: 'Billing Overview',
      widgets: [{ id: 'accounts_by_name', type: 'bar', dataset, values: ['cnt'], dimensions: ['by_name'] }],
    }],
  });

  const report = (dataset: string) => ({
    reports: [{ name: 'billing_accounts', label: 'Billing Accounts', dataset, values: ['cnt'] }],
  });

  it('dashboard widget `dataset` — ACCEPTED: the widget registers under B and A\'s dataset resolves', async () => {
    expect(authoringVerdict(dashboard(FOREIGN_DATASET))).toBeUndefined();
    // …and a dataset that exists nowhere is accepted identically. The binding is
    // unenforced, not merely permitted across packages.
    expect(authoringVerdict(dashboard('ds_nowhere'))).toBeUndefined();

    const { refusal, kernel } = await installVerdict(dashboard(FOREIGN_DATASET));
    expect(refusal).toBeUndefined();
    const registry = engineOf(kernel).registry;

    const widget = registry.getItem('dashboard', 'billing_overview') as Record<string, any> | undefined;
    expect(widget?._packageId).toBe('com.acme.crm.billing');
    expect(widget?.widgets?.[0]?.dataset).toBe(FOREIGN_DATASET);

    // The other half of "resolves": A's dataset really is in the shared
    // registry, owned by A, and its base object is A's object.
    const ds = registry.getItem('dataset', FOREIGN_DATASET) as Record<string, any> | undefined;
    expect(ds).toBeDefined();
    expect(ds?._packageId).toBe('com.acme.crm');
    expect(ds?.object).toBe(CROSS);
  });

  it('report `dataset` — ACCEPTED: the report registers under B and A\'s dataset resolves', async () => {
    expect(authoringVerdict(report(FOREIGN_DATASET))).toBeUndefined();
    expect(authoringVerdict(report('ds_nowhere'))).toBeUndefined();

    const { refusal, kernel } = await installVerdict(report(FOREIGN_DATASET));
    expect(refusal).toBeUndefined();
    const registry = engineOf(kernel).registry;

    const registered = registry.getItem('report', 'billing_accounts') as Record<string, any> | undefined;
    expect(registered?._packageId).toBe('com.acme.crm.billing');
    expect(registered?.dataset).toBe(FOREIGN_DATASET);

    const ds = registry.getItem('dataset', FOREIGN_DATASET) as Record<string, any> | undefined;
    expect(ds?._packageId).toBe('com.acme.crm');
    expect(ds?.object).toBe(CROSS);
  });
});
