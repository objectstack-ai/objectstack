// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — ADR-0070 package-first authoring, exercised end-to-end
// through the real booted stack (not a mocked unit). Two contracts are gated:
//
//   1. D1/D2 backstop — the kernel REJECTS a runtime-only create that targets a
//      read-only code/installed package with `writable_package_required` instead
//      of silently coercing it to a package-less orphan (the pre-ADR #2252 bug).
//      This is the contract the Studio + AI surfaces rely on.
//
//   2. The package is the lifecycle unit (D3/D4/D5) — a base is the unit you
//      author into, discover by, edit, duplicate, delete (cascade), and adopt
//      loose items into. The full chain runs against the live protocol service:
//        create -> bind -> publish -> editable -> discoverable -> delete-cascade,
//      plus the D4 "duplicate base" and D5 "adopt orphans" migration gestures.
//
// Reverting D1 (the writable_package_required throw in saveMetaItem) turns the
// first block red; regressing the package-lifecycle methods (deletePackage,
// duplicatePackage, reassignOrphanedMetadata) turns the rest red. That is the
// point of the gate — the manual dogfood in the ADR is now an automated proof.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';

// sys_metadata is the durable store every lifecycle method (deletePackage,
// duplicatePackage, reassignOrphanedMetadata) reads from — assertions against it
// are deterministic, unlike registry merges. `name` is what each row keys on.
async function ownedNames(ql: any, packageId: string): Promise<string[]> {
  const rows = (await ql.find('sys_metadata', { where: { package_id: packageId }, context: { isSystem: true } })) as any[];
  return rows.map((r) => r.name);
}

describe('dogfood: package-first authoring rejects runtime creates into read-only packages (ADR-0070 D1/D2)', () => {
  let stack: VerifyStack;

  beforeAll(async () => {
    stack = await bootStack(crmStack);
  });
  afterAll(async () => {
    await stack?.stop?.();
  });

  it('saveMetaItem(runtime-only) into a loaded code package throws writable_package_required', async () => {
    // The objectql engine records every booted code package in its manifest map;
    // any one of them is a read-only authoring target (isWritablePackage=false).
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const manifests = (ql?.manifests ?? ql?.engine?.manifests) as Map<string, unknown> | undefined;
    const codePkgId = manifests && typeof manifests.keys === 'function' ? [...manifests.keys()][0] : undefined;
    expect(codePkgId, 'expected at least one loaded code package in the booted stack').toBeTruthy();

    const protocol = await stack.kernel.getServiceAsync<any>('protocol');
    await expect(
      protocol.saveMetaItem({
        type: 'object',
        name: 'dogfood_pkgfirst_probe',
        item: { name: 'dogfood_pkgfirst_probe', label: 'Probe', fields: { name: { type: 'text', label: 'Name' } } },
        packageId: codePkgId,
        mode: 'draft',
      }),
    ).rejects.toMatchObject({ code: 'writable_package_required' });
  });

  it('the same create into a fresh writable base id is NOT rejected (control)', async () => {
    const protocol = await stack.kernel.getServiceAsync<any>('protocol');
    // A bare, unregistered project-base id is writable — the write must succeed.
    const res = await protocol.saveMetaItem({
      type: 'object',
      name: 'dogfood_pkgfirst_ok',
      item: { name: 'dogfood_pkgfirst_ok', label: 'OK', fields: { name: { type: 'text', label: 'Name' } } },
      packageId: 'app.dogfood_probe_base',
      mode: 'draft',
    });
    expect(res?.success ?? true).toBeTruthy();
  });
});

describe('dogfood: the package is the authoring & delete unit (ADR-0070 D3/D4)', () => {
  let stack: VerifyStack;
  let protocol: any;
  let ql: any;
  // A fresh, writable, project-scoped base (never a code/installed package).
  const BASE = 'app.dogfood_lifecycle';
  const OBJ = 'dfl_widget';

  beforeAll(async () => {
    stack = await bootStack(crmStack);
    protocol = await stack.kernel.getServiceAsync<any>('protocol');
    ql = await stack.kernel.getServiceAsync<any>('objectql');
  });
  afterAll(async () => {
    await stack?.stop?.();
  });

  it('create -> bind -> publish -> editable -> discoverable -> delete-cascade', async () => {
    // 1. CREATE (draft) bound to the writable base — accepted (not coerced/rejected).
    const draft = await protocol.saveMetaItem({
      type: 'object',
      name: OBJ,
      item: { name: OBJ, label: 'Widget', fields: { name: { type: 'text', label: 'Name' } } },
      packageId: BASE,
      mode: 'draft',
    });
    expect(draft?.success ?? true).toBeTruthy();

    // 2. BIND — the row is owned by the base, never orphaned (package_id is real).
    expect(await ownedNames(ql, BASE)).toContain(OBJ);

    // 3. PUBLISH — promotes the draft to active (creates the physical table).
    const published = await protocol.saveMetaItem({
      type: 'object',
      name: OBJ,
      item: { name: OBJ, label: 'Widget', fields: { name: { type: 'text', label: 'Name' } } },
      packageId: BASE,
      mode: 'publish',
    });
    expect(published?.success ?? true).toBeTruthy();

    // 4. EDITABLE — a writable base accrues registered objects once it publishes,
    //    yet stays writable (the #2252 read-only-after-publish trap is designed
    //    out): a re-publish edit must NOT throw writable_package_required.
    const edit = await protocol.saveMetaItem({
      type: 'object',
      name: OBJ,
      item: {
        name: OBJ,
        label: 'Widget (edited)',
        fields: { name: { type: 'text', label: 'Name' }, qty: { type: 'number', label: 'Qty' } },
      },
      packageId: BASE,
      mode: 'publish',
    });
    expect(edit?.success ?? true).toBeTruthy();

    // 5. DISCOVERABLE — the package-scoped Studio list (getMetaItems by package)
    //    surfaces the authored object; it is not lost in a null bucket.
    const listed = await protocol.getMetaItems({ type: 'object', packageId: BASE });
    const names = (Array.isArray(listed) ? listed : (listed?.items ?? [])).map(
      (i: any) => i?.name ?? i?.metadata?.name,
    );
    expect(names, `getMetaItems(package=${BASE}) should surface ${OBJ}`).toContain(OBJ);

    // 6. DELETE-CASCADE — deleting the base removes every item it owns; the base
    //    becomes empty. This is the answer to "a pile of loose metadata, how do I
    //    delete it?" — operate on the whole base.
    const del = await protocol.deletePackage({ packageId: BASE });
    expect(del.deletedCount).toBeGreaterThan(0);
    expect(del.failedCount).toBe(0);
    expect(await ownedNames(ql, BASE)).not.toContain(OBJ);
  });
});

describe('dogfood: adopt orphaned metadata into a base (ADR-0070 D5 migration)', () => {
  let stack: VerifyStack;
  let protocol: any;
  let ql: any;
  const BASE = 'app.dogfood_adopt';
  const ORPHAN = 'dfa_legacy_orphan';

  beforeAll(async () => {
    stack = await bootStack(crmStack);
    protocol = await stack.kernel.getServiceAsync<any>('protocol');
    ql = await stack.kernel.getServiceAsync<any>('objectql');
  });
  afterAll(async () => {
    await stack?.stop?.();
  });

  it('reassignOrphanedMetadata rebinds a legacy package-less row onto a base', async () => {
    // Simulate a pre-package-first stopgap leftover: a runtime-authored item with
    // package_id = null (the #2252 coerce-to-null / #1946 "Local / Custom" bucket).
    await ql.insert('sys_metadata', {
      type: 'object',
      name: ORPHAN,
      state: 'draft',
      package_id: null,
      metadata: JSON.stringify({ name: ORPHAN, label: 'Legacy', fields: { name: { type: 'text' } } }),
    });
    // Precondition: it is NOT owned by the base yet.
    expect(await ownedNames(ql, BASE)).not.toContain(ORPHAN);

    // MIGRATE — adopt every loose item in the env into the base.
    const res = await protocol.reassignOrphanedMetadata({ targetPackageId: BASE });
    expect(res.success).toBe(true);
    expect(res.reassignedCount).toBeGreaterThan(0);
    expect(res.reassigned.map((r: any) => r.name)).toContain(ORPHAN);

    // Postcondition: the row is now owned by the base — no longer an orphan.
    expect(await ownedNames(ql, BASE)).toContain(ORPHAN);
    const stillOrphan = ((await ql.find('sys_metadata', { where: {}, context: { isSystem: true } })) as any[]).filter(
      (r) => r.name === ORPHAN && (r.package_id == null || r.package_id === '' || r.package_id === 'sys_metadata'),
    );
    expect(stillOrphan).toHaveLength(0);
  });
});

describe('dogfood: duplicate a writable base (ADR-0070 D4)', () => {
  let stack: VerifyStack;
  let protocol: any;
  let ql: any;
  // namespace == base-id suffix, so duplicate's default re-namespacing applies.
  const SRC = 'app.dfdup';
  const DST = 'app.dfdup2';

  beforeAll(async () => {
    stack = await bootStack(crmStack);
    protocol = await stack.kernel.getServiceAsync<any>('protocol');
    ql = await stack.kernel.getServiceAsync<any>('objectql');
  });
  afterAll(async () => {
    await stack?.stop?.();
  });

  it('clones ACTIVE items into a new base, re-namespacing names AND rewriting references', async () => {
    // Two objects in the source base; the ticket carries a lookup to the customer
    // (an intra-package reference that must be rewritten to the clone's new name).
    // duplicate() only clones state:'active' rows, so both must be published.
    await protocol.saveMetaItem({
      type: 'object',
      name: 'dfdup_customer',
      item: { name: 'dfdup_customer', label: 'Customer', fields: { full_name: { type: 'text', label: 'Name' } } },
      packageId: SRC,
      mode: 'publish',
    });
    await protocol.saveMetaItem({
      type: 'object',
      name: 'dfdup_ticket',
      item: {
        name: 'dfdup_ticket',
        label: 'Ticket',
        fields: {
          title: { type: 'text', label: 'Title' },
          customer: { type: 'lookup', label: 'Customer', reference: 'dfdup_customer' },
        },
      },
      packageId: SRC,
      mode: 'publish',
    });

    // DUPLICATE — clone the whole base into a new writable package + namespace.
    const res = await protocol.duplicatePackage({
      sourcePackageId: SRC,
      targetPackageId: DST,
      targetNamespace: 'dfdup2',
    });
    expect(res.success).toBe(true);
    expect(res.copiedCount).toBeGreaterThanOrEqual(2);
    expect(res.failedCount).toBe(0);

    // Clones land in the target base, re-namespaced (never colliding with source).
    const dstNames = await ownedNames(ql, DST);
    expect(dstNames).toContain('dfdup2_customer');
    expect(dstNames).toContain('dfdup2_ticket');
    expect(dstNames.some((n) => /^dfdup_/.test(n))).toBe(false); // no un-renamed leftovers

    // The lookup reference was rewritten to the cloned object's new name.
    const ticketRow = ((await ql.find('sys_metadata', { where: { package_id: DST }, context: { isSystem: true } })) as any[]).find(
      (r) => r.name === 'dfdup2_ticket',
    );
    const ticketMeta =
      typeof ticketRow?.metadata === 'string' ? JSON.parse(ticketRow.metadata) : ticketRow?.metadata;
    expect(ticketMeta?.fields?.customer?.reference).toBe('dfdup2_customer');
  });
});
