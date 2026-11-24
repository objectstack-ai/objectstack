// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  persistRuntimeMetadata,
  publishRuntimeMetadata,
  createRuntimeMetadata,
  readRuntimeDraft,
  discardRuntimeDraft,
  unwrapDraftBody,
  recordPageName,
  recordPageEnvelope,
  viewEnvelope,
  deriveViewKey,
  saveAndPublishRuntimeMetadata,
  resolveDashboardEditTarget,
  ensureDashboardSaveTarget,
  dashboardSaveBody,
  saveDashboardInPlace,
  type DashboardSaveTargetDoors,
} from './runtime-metadata-persistence';

/**
 * ADR-0034 seam tests.
 *
 * The seam is metadata-only: every call routes to the `MetadataClient`
 * draft/publish API (`sys_*` tables retired). Saves stage a per-item draft;
 * publish promotes it.
 */

function makeMetadataClient() {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    reset: vi.fn().mockResolvedValue(undefined),
  };
}

describe('runtime-metadata-persistence seam (ADR-0034)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persistRuntimeMetadata → save(type, name, body, { mode: "draft" })', async () => {
    const metadataClient = makeMetadataClient();
    const body = { title: 'Pipeline' };

    await persistRuntimeMetadata('report', 'my_report', body, { metadataClient });

    expect(metadataClient.save).toHaveBeenCalledTimes(1);
    expect(metadataClient.save).toHaveBeenCalledWith('report', 'my_report', body, {
      mode: 'draft',
    });
  });

  it('persistRuntimeMetadata works for view / dashboard / page too', async () => {
    const metadataClient = makeMetadataClient();

    await persistRuntimeMetadata('view', 'my_view', { columns: ['name'] }, { metadataClient });
    await persistRuntimeMetadata('dashboard', 'my_dash', { widgets: [] }, { metadataClient });
    await persistRuntimeMetadata('page', 'invoice_record', { regions: [] }, { metadataClient });

    expect(metadataClient.save).toHaveBeenCalledWith('view', 'my_view', { columns: ['name'] }, {
      mode: 'draft',
    });
    expect(metadataClient.save).toHaveBeenCalledWith('dashboard', 'my_dash', { widgets: [] }, {
      mode: 'draft',
    });
    expect(metadataClient.save).toHaveBeenCalledWith('page', 'invoice_record', { regions: [] }, {
      mode: 'draft',
    });
  });

  describe('record page helpers (#1541)', () => {
    it('recordPageName prefers an existing name, else mints <object>_record', () => {
      expect(recordPageName('invoice')).toBe('invoice_record');
      expect(recordPageName('invoice', 'custom_invoice_page')).toBe('custom_invoice_page');
      expect(recordPageName('invoice', null)).toBe('invoice_record');
    });

    it('recordPageEnvelope sets the record-page identity fields the resolver matches on', () => {
      const env = recordPageEnvelope('invoice', { type: 'page', title: 'Invoice', regions: [{ name: 'main' }] });
      expect(env).toMatchObject({
        type: 'record',
        name: 'invoice_record',
        object: 'invoice',
        kind: 'full',
        title: 'Invoice',
        regions: [{ name: 'main' }],
      });
      // `type` is the one discriminator the resolver reads; `pageType` is a key
      // `PageSchema` refuses as an alias of `type`, so the envelope never writes
      // it (objectui#9674).
      expect(env).not.toHaveProperty('pageType');
    });

    it('recordPageEnvelope keeps an explicit/existing page name', () => {
      expect(recordPageEnvelope('invoice', { name: 'inv_v2' }).name).toBe('inv_v2');
      expect(recordPageEnvelope('invoice', {}, 'inv_v3').name).toBe('inv_v3');
    });

    it('a page draft round-trips through the seam', async () => {
      const metadataClient = makeMetadataClient();
      metadataClient.get.mockResolvedValue({ type: 'page', name: 'invoice_record', item: { regions: [{ name: 'x' }] } });
      const draft = await readRuntimeDraft('page', 'invoice_record', { metadataClient });
      expect(metadataClient.get).toHaveBeenCalledWith('page', 'invoice_record', { state: 'draft' });
      expect(draft).toEqual({ regions: [{ name: 'x' }] });
      await publishRuntimeMetadata('page', 'invoice_record', { metadataClient });
      expect(metadataClient.publish).toHaveBeenCalledWith('page', 'invoice_record');
    });
  });

  it('createRuntimeMetadata → save draft and returns the name', async () => {
    const metadataClient = makeMetadataClient();
    const body = { id: 'view_123', columns: ['name'] };

    const id = await createRuntimeMetadata('view', 'view_123', body, { metadataClient });

    expect(metadataClient.save).toHaveBeenCalledWith('view', 'view_123', body, {
      mode: 'draft',
      ifNoneMatch: '*',
    });
    expect(id).toBe('view_123');
  });

  it('createRuntimeMetadata throws on an empty name (no malformed PUT) — #2767', async () => {
    const metadataClient = makeMetadataClient();
    await expect(
      createRuntimeMetadata('view', '', { columns: [] }, { metadataClient }),
    ).rejects.toThrow(/name must be non-empty/);
    await expect(
      createRuntimeMetadata('view', '   ', { columns: [] }, { metadataClient }),
    ).rejects.toThrow(/name must be non-empty/);
    // The guard fires BEFORE any server call.
    expect(metadataClient.save).not.toHaveBeenCalled();
  });

  it('publishRuntimeMetadata → publish(type, name)', async () => {
    const metadataClient = makeMetadataClient();

    await publishRuntimeMetadata('report', 'my_report', { metadataClient });

    expect(metadataClient.publish).toHaveBeenCalledWith('report', 'my_report');
  });

  it('readRuntimeDraft → unwraps get(type, name, { state: "draft" })', async () => {
    const metadataClient = makeMetadataClient();
    metadataClient.get.mockResolvedValue({
      type: 'view',
      name: 'my_view',
      item: { columns: ['name', 'stage'] },
    });

    const draft = await readRuntimeDraft('view', 'my_view', { metadataClient });

    expect(metadataClient.get).toHaveBeenCalledWith('view', 'my_view', { state: 'draft' });
    expect(draft).toEqual({ columns: ['name', 'stage'] });
  });

  it('readRuntimeDraft → null when no draft is pending', async () => {
    const metadataClient = makeMetadataClient();
    metadataClient.get.mockResolvedValue(null);

    const draft = await readRuntimeDraft('view', 'my_view', { metadataClient });

    expect(draft).toBeNull();
  });

  it('discardRuntimeDraft → reset(type, name, { state: "draft" })', async () => {
    const metadataClient = makeMetadataClient();

    await discardRuntimeDraft('report', 'my_report', { metadataClient });

    expect(metadataClient.reset).toHaveBeenCalledWith('report', 'my_report', {
      state: 'draft',
    });
  });

  describe('viewEnvelope / deriveViewKey (#2767 canonical identity)', () => {
    it('deriveViewKey prefers an explicit machine name', () => {
      expect(deriveViewKey({ name: 'my_grid', label: 'Anything' })).toBe('my_grid');
    });

    it('deriveViewKey reduces an over-qualified name to its <key> half', () => {
      expect(deriveViewKey({ name: 'crm_task.my_grid' })).toBe('my_grid');
    });

    it('deriveViewKey slugifies the label when no name is given', () => {
      expect(deriveViewKey({ label: 'High Priority' })).toBe('high_priority');
    });

    it('deriveViewKey falls back to a unique `<type>_…` key for CJK labels', () => {
      // slugify('看板') === '' → last-resort key, prefixed by the view type.
      const key = deriveViewKey({ label: '看板', type: 'kanban' });
      expect(key).toMatch(/^kanban_[a-z0-9]+$/);
    });

    it('viewEnvelope emits a canonical ViewItem with a qualified name', () => {
      const env = viewEnvelope(
        'crm_task',
        { type: 'grid', label: 'My Grid', columns: ['name', 'stage'] },
        { name: 'my_grid', label: 'My Grid' },
      );
      expect(env).toEqual({
        name: 'crm_task.my_grid',
        object: 'crm_task',
        viewKind: 'list',
        label: 'My Grid',
        config: {
          type: 'grid',
          columns: ['name', 'stage'],
          data: { provider: 'object', object: 'crm_task' },
        },
      });
    });

    it('viewEnvelope keeps `name`/`label` at the top level only (not in config)', () => {
      const env = viewEnvelope('acct', { type: 'grid', name: 'x', label: 'X', columns: [] }, { name: 'x', label: 'X' });
      expect(env.config).not.toHaveProperty('name');
      expect(env.config).not.toHaveProperty('label');
    });

    // `pageSize` is deliberately NOT a spec key — the `object` arm of
    // `ViewDataSchema` declares only `provider` + `object`, and is strict since
    // objectstack#4001. It is used here precisely because it is undeclared: this
    // asserts `viewEnvelope`'s pass-through MECHANICS, i.e. that it spreads
    // whatever it is handed rather than whitelisting keys. Do not copy it as an
    // example of a valid binding — the spec-validity contract is pinned in
    // `runtime-metadata-persistence.viewItemSpec.test.ts`, where a fixture
    // carrying this key is (correctly) refused by name.
    it('viewEnvelope preserves an existing config.data while stamping the object', () => {
      const env = viewEnvelope(
        'acct',
        { type: 'grid', columns: [], data: { pageSize: 25 } },
        { name: 'big', label: 'Big' },
      );
      expect(env.config.data).toEqual({ provider: 'object', pageSize: 25, object: 'acct' });
    });

    it('viewEnvelope falls back to slugify(label) when no name is supplied', () => {
      const env = viewEnvelope('acct', { type: 'grid', columns: [] }, { label: 'Overdue Tasks' });
      expect(env.name).toBe('acct.overdue_tasks');
    });

    it('a view envelope round-trips through createRuntimeMetadata with matching identity', async () => {
      const metadataClient = makeMetadataClient();
      const env = viewEnvelope('acct', { type: 'grid', columns: ['name'] }, { name: 'mine', label: 'Mine' });
      const id = await createRuntimeMetadata('view', env.name, env, { metadataClient });
      // Row key (URL segment), returned id, and body.name are the SAME value.
      expect(id).toBe('acct.mine');
      expect(metadataClient.save).toHaveBeenCalledWith('view', 'acct.mine', env, { mode: 'draft', ifNoneMatch: '*' });
      expect(env.name).toBe('acct.mine');
    });
  });

  describe('unwrapDraftBody', () => {
    it('unwraps the { type, name, item } envelope', () => {
      expect(unwrapDraftBody({ type: 'view', name: 'v', item: { a: 1 } })).toEqual({
        a: 1,
      });
    });

    it('returns a bare body as-is', () => {
      expect(unwrapDraftBody({ a: 1 })).toEqual({ a: 1 });
    });

    it('returns null for an empty envelope item', () => {
      expect(unwrapDraftBody({ type: 'view', name: 'v', item: {} })).toBeNull();
    });

    it('returns null for null / non-object / empty', () => {
      expect(unwrapDraftBody(null)).toBeNull();
      expect(unwrapDraftBody(undefined)).toBeNull();
      expect(unwrapDraftBody('x')).toBeNull();
      expect(unwrapDraftBody({})).toBeNull();
    });

    /**
     * objectui#8181 — the read decorations come off HERE, at the one place the
     * served body becomes a body this seam hands to callers.
     *
     * `readRuntimeDraft`'s answer is what `RuntimeDraftBar` passes to
     * `onResume`, which seeds the host editor whose next save writes it back.
     * Leaving `_diagnostics` / `_draft` on it completes exactly the read→edit→
     * write round trip the spec's `stripReadDecorations` exists to break.
     */
    describe('read decorations (objectui#8181)', () => {
      const DECOR = { _diagnostics: { valid: true, errors: [] }, _draft: true };

      it('strips them off the envelope limb', () => {
        expect(
          unwrapDraftBody({ type: 'view', name: 'v', item: { a: 1, ...DECOR } }),
        ).toEqual({ a: 1 });
      });

      it('strips them off the bare-body limb — the one get() actually feeds', () => {
        expect(unwrapDraftBody({ a: 1, ...DECOR })).toEqual({ a: 1 });
      });

      it('keeps the ADR-0010 protection envelope, which the schemas declare', () => {
        expect(
          unwrapDraftBody({ a: 1, _lock: { locked: true }, _provenance: 'package', ...DECOR }),
        ).toEqual({ a: 1, _lock: { locked: true }, _provenance: 'package' });
      });

      it('a draft carrying ONLY decorations still reads as pending, not as null', () => {
        // The verdict runs before the strip: `!!readRuntimeDraft(...)` is the
        // "has pending changes" test, and a served draft must never become
        // "nothing pending" because we removed our own annotations from it.
        expect(unwrapDraftBody({ type: 'view', name: 'v', item: { ...DECOR } })).toEqual({});
        expect(unwrapDraftBody({ ...DECOR })).toEqual({});
      });
    });
  });

  /**
   * objectui#4271 — `readRuntimeDraft` reaches the server through
   * `MetadataClient.get()`, which now unwraps the `{type,name,item}` envelope
   * at the client boundary. So the value this seam actually receives has
   * changed shape even though its own code did not. These pin it at the NEW
   * read; the envelope cases above stay because `unwrapDraftBody` is still the
   * shared helper for `getDraft()`, which does hand back the envelope.
   */
  describe('readRuntimeDraft against the unwrapped get() contract (#4271)', () => {
    it('resolves the draft body when get() has already unwrapped it', async () => {
      const metadataClient = makeMetadataClient();
      metadataClient.get.mockResolvedValue({ regions: [{ name: 'x' }] });
      const draft = await readRuntimeDraft('page', 'invoice_record', { metadataClient });
      expect(metadataClient.get).toHaveBeenCalledWith('page', 'invoice_record', { state: 'draft' });
      expect(draft).toEqual({ regions: [{ name: 'x' }] });
    });

    it('still reads "nothing pending" as null across both shapes', async () => {
      const metadataClient = makeMetadataClient();
      // 404 → get() answers null.
      metadataClient.get.mockResolvedValue(null);
      expect(await readRuntimeDraft('page', 'p', { metadataClient })).toBeNull();
      // An empty draft body must not read as a pending draft — this is what
      // gates the "unpublished changes" indicator.
      metadataClient.get.mockResolvedValue({});
      expect(await readRuntimeDraft('page', 'p', { metadataClient })).toBeNull();
    });
  });
});

describe('saveAndPublishRuntimeMetadata — a confirmed save everyone sees at once (objectstack#35955)', () => {
  const conflict = () => Object.assign(new Error('pending'), { status: 409, code: 'METADATA_CONFLICT' });

  it('stages the draft under the first-write pin, then publishes it', async () => {
    const metadataClient = makeMetadataClient();
    const body = { name: 'task.all', config: { sort: [{ field: 'name', order: 'asc' }] } };
    await expect(saveAndPublishRuntimeMetadata('view', 'task.all', body, { metadataClient })).resolves.toBe('published');
    expect(metadataClient.save).toHaveBeenCalledWith('view', 'task.all', body, { mode: 'draft', ifNoneMatch: '*' });
    expect(metadataClient.publish).toHaveBeenCalledWith('view', 'task.all');
    expect(metadataClient.save.mock.invocationCallOrder[0]).toBeLessThan(metadataClient.publish.mock.invocationCallOrder[0]);
    expect(metadataClient.reset).not.toHaveBeenCalled();
  });

  it('over a pending draft (the pin\'s 409 METADATA_CONFLICT) nothing is published or discarded', async () => {
    const metadataClient = makeMetadataClient();
    metadataClient.save.mockRejectedValue(conflict());
    await expect(saveAndPublishRuntimeMetadata('view', 'task.all', {}, { metadataClient })).resolves.toBe('pending-draft');
    expect(metadataClient.publish).not.toHaveBeenCalled();
    expect(metadataClient.reset).not.toHaveBeenCalled();
  });

  it('CONTROL: the door\'s other 409 (DESTRUCTIVE_CHANGE) is a refusal, not a pending draft', async () => {
    const metadataClient = makeMetadataClient();
    const destructive = Object.assign(new Error('destructive'), { status: 409, code: 'DESTRUCTIVE_CHANGE' });
    metadataClient.save.mockRejectedValue(destructive);
    await expect(saveAndPublishRuntimeMetadata('view', 'task.all', {}, { metadataClient })).rejects.toBe(destructive);
    expect(metadataClient.publish).not.toHaveBeenCalled();
  });

  it('a refused publish discards the draft this call wrote, and the refusal is rethrown', async () => {
    const metadataClient = makeMetadataClient();
    const refused = Object.assign(new Error('refused'), { status: 400, code: 'VALIDATION_ERROR' });
    metadataClient.publish.mockRejectedValue(refused);
    await expect(saveAndPublishRuntimeMetadata('view', 'task.all', {}, { metadataClient })).rejects.toBe(refused);
    expect(metadataClient.reset).toHaveBeenCalledWith('view', 'task.all', { state: 'draft' });
  });
});

/**
 * objectstack#36372 — a dashboard edited on its own page saves where Studio's
 * Customize would: the owning package when writable, else the app's
 * customization package (ADR-0146), declaring the override of its base. The
 * pair is only read while editing; the ensure door, which creates it, is
 * asked at save. The save is the confirmed-save door above, naming that
 * package on all three writes.
 */
describe('dashboard in-page save (objectstack#36372)', () => {
  const listed = (entries: Record<string, { writable: boolean; version?: string }>) =>
    new Map(
      Object.entries(entries).map(([id, e]) => [id, { writable: e.writable, manifest: { id, version: e.version } } as any]),
    );
  const doors = (
    entries: Record<string, { writable: boolean; version?: string }>,
    ensure: DashboardSaveTargetDoors['ensureCustomization'] = vi.fn(async (base: string) => ({ packageId: `${base}.custom`, writable: true })),
  ): DashboardSaveTargetDoors => ({ listPackages: vi.fn(async () => listed(entries)), ensureCustomization: ensure });

  it('a dashboard of a writable package saves into that package, asking no pair', async () => {
    const d = doors({ crm: { writable: true } });
    const target = await resolveDashboardEditTarget('crm', d);
    expect(target).toEqual({ kind: 'package', packageId: 'crm' });
    await expect(ensureDashboardSaveTarget(target as any, d)).resolves.toEqual({ kind: 'package', packageId: 'crm' });
    expect(d.ensureCustomization).not.toHaveBeenCalled();
  });

  it('a read-only (installed) package is read for its pair without creating one; the ensure door is asked at save', async () => {
    const d = doors({ crm: { writable: false, version: '2.1.0' } });
    const target = await resolveDashboardEditTarget('crm', d);
    // No pair listed yet: none is named, and none is made by reading.
    expect(target).toEqual({ kind: 'customization', base: 'crm', basedOn: '2.1.0', pair: null });
    expect(d.ensureCustomization).not.toHaveBeenCalled();
    await expect(ensureDashboardSaveTarget(target as any, d)).resolves.toEqual({
      kind: 'customization',
      packageId: 'crm.custom',
      base: 'crm',
      basedOn: '2.1.0',
    });
    expect(d.ensureCustomization).toHaveBeenCalledWith('crm');
  });

  it('a pair the package list already lists is named for reading', async () => {
    const d = doors({ crm: { writable: false, version: '2.1.0' }, 'crm.custom': { writable: true, version: '0.0.0' } });
    await expect(resolveDashboardEditTarget('crm', d)).resolves.toMatchObject({ kind: 'customization', pair: 'crm.custom' });
    expect(d.ensureCustomization).not.toHaveBeenCalled();
  });

  it('is refused when the owner is not listed; at save, when the ensure door refuses or the pair is not writable', async () => {
    await expect(resolveDashboardEditTarget('crm', doors({}))).resolves.toMatchObject({ kind: 'refused' });
    const target = { kind: 'customization' as const, base: 'crm', basedOn: '2.1.0', pair: null };
    const refusing = vi.fn(async () => {
      throw new Error('forbidden');
    });
    await expect(ensureDashboardSaveTarget(target, { ensureCustomization: refusing })).rejects.toThrow('forbidden');
    const readOnlyPair = vi.fn(async () => ({ packageId: 'crm.custom', writable: false }));
    await expect(ensureDashboardSaveTarget(target, { ensureCustomization: readOnlyPair })).rejects.toThrow('not writable');
  });

  it('a dashboard naming no package is saved where it lives', async () => {
    await expect(resolveDashboardEditTarget(null, doors({}))).resolves.toEqual({ kind: 'unbound' });
  });

  it('the body drops the read\'s `_` keys, and into a pair declares the override of its base', () => {
    const doc = { name: 'exec', label: 'Exec', widgets: [], _packageId: 'crm', _diagnostics: [] };
    expect(dashboardSaveBody(doc, { kind: 'package', packageId: 'crm' })).toEqual({ name: 'exec', label: 'Exec', widgets: [] });
    expect(dashboardSaveBody(doc, { kind: 'customization', packageId: 'crm.custom', base: 'crm', basedOn: '2.1.0' })).toEqual({
      name: 'exec',
      label: 'Exec',
      widgets: [],
      overrides: { package: 'crm', basedOn: '2.1.0' },
    });
    // No version to declare the override at, and none declared: nothing is guessed.
    expect(dashboardSaveBody(doc, { kind: 'customization', packageId: 'crm.custom', base: 'crm', basedOn: null })).toBeNull();
  });

  it('stages and publishes the one item in the target package', async () => {
    const metadataClient = makeMetadataClient();
    const body = { name: 'exec', widgets: [] };
    await expect(
      saveDashboardInPlace('exec', body, { kind: 'customization', packageId: 'crm.custom', base: 'crm', basedOn: '2.1.0' }, { metadataClient }),
    ).resolves.toBe('published');
    expect(metadataClient.save).toHaveBeenCalledWith('dashboard', 'exec', body, { mode: 'draft', ifNoneMatch: '*', packageId: 'crm.custom' });
    expect(metadataClient.publish).toHaveBeenCalledWith('dashboard', 'exec', { packageId: 'crm.custom' });
  });

  it('over a pending Studio draft nothing is published', async () => {
    const metadataClient = makeMetadataClient();
    metadataClient.save.mockRejectedValue(Object.assign(new Error('pending'), { status: 409, code: 'METADATA_CONFLICT' }));
    await expect(
      saveDashboardInPlace('exec', {}, { kind: 'package', packageId: 'crm' }, { metadataClient }),
    ).resolves.toBe('pending-draft');
    expect(metadataClient.publish).not.toHaveBeenCalled();
  });

  it('a refused publish discards its own draft in the same package', async () => {
    const metadataClient = makeMetadataClient();
    const refused = Object.assign(new Error('refused'), { status: 400 });
    metadataClient.publish.mockRejectedValue(refused);
    await expect(saveDashboardInPlace('exec', {}, { kind: 'package', packageId: 'crm' }, { metadataClient })).rejects.toBe(refused);
    expect(metadataClient.reset).toHaveBeenCalledWith('dashboard', 'exec', { state: 'draft', packageId: 'crm' });
  });
});
