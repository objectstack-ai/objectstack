// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';

/**
 * ADR-0033 / ADR-0067 D2 — `publishPackageDrafts` promotes every pending
 * draft bound to a package in one shot ("publish whole app"). Since ADR-0067
 * D2 the orchestration is TWO-PHASE: every promotion + the commit record run
 * inside ONE engine transaction (all-or-nothing — a commit cannot half-land),
 * and side effects (registry/DDL/materializers/projections) run after the
 * metadata committed. These tests cover the orchestration contract; the
 * per-item guards live in `publishMetaItem`'s own suites.
 */
/** An artifact that is already ACTIVE before the publish under test runs. */
interface ActiveRow {
  type: string;
  name: string;
  organizationId?: string | null;
  version: number;
}

/**
 * [#8896] A real double for the two engine calls `publishPackageDrafts` makes
 * on its own — the ADR-0067 pre-publish CAPTURE read, and the commit write.
 *
 * ## Why this fixture had to grow a `findOne`
 *
 * It never had one, and until #8896 that was invisible: the capture sat behind
 * a bare `catch` which swallowed the resulting `TypeError` and pushed a
 * fabricated `{ existedBefore: false, prevVersion: null }` entry. So every test
 * in this file was green on a path that never ran — including the ones whose
 * names claim to cover the batch end to end. `existedBefore` was `false` for
 * every item of every case here, not because the fixture said so but because
 * the read crashed and the crash was hidden. Nothing in the repo exercised the
 * real capture.
 *
 * Once the capture discriminates by error type (only an unprovisioned table is
 * benign; a `TypeError` from an engine missing the method is not), the missing
 * method surfaces as it should. The repair belongs HERE: the production
 * behaviour is right and the fixture was lying.
 *
 * ## Two things it is careful about
 *
 * `null` is returned EXPLICITLY for "no active row exists" rather than falling
 * out of an absent method, because those two are now distinguishable and only
 * one of them is a truthful answer. And `insert` records the commit row, so the
 * revert plan this fixture produces is observable instead of being swallowed a
 * second time by `recordCommit`'s own catch.
 */
function makeCaptureEngine(activeRows: ActiveRow[] = []) {
  const captureReads: Array<Record<string, unknown>> = [];
  const commitRows: Array<Record<string, unknown>> = [];
  const engine = {
    findOne: async (table: string, opts?: { where?: Record<string, unknown> }) => {
      if (table !== 'sys_metadata') return null;
      const where = opts?.where ?? {};
      if (where.state !== 'active') return null;
      captureReads.push(where);
      const hit = activeRows.find(
        (r) => r.type === where.type
          && r.name === where.name
          && (r.organizationId ?? null) === (where.organization_id ?? null),
      );
      // Explicitly `null`, never `undefined`-by-omission — see the docblock.
      return hit ? { version: hit.version } : null;
    },
    insert: async (table: string, data: Record<string, unknown>) => {
      if (table === 'sys_metadata_commit') commitRows.push(data);
      return { id: `${table}_${commitRows.length}` };
    },
  };
  /** The revert plan as it was actually STORED, parsed from the commit row. */
  const storedCommitItems = (): Array<Array<{
    type: string; name: string; existedBefore: boolean; prevVersion: number | null;
  }>> => commitRows.map((c) => JSON.parse(String(c.items)));
  return { engine, captureReads, commitRows, storedCommitItems };
}

function makeProtocol(
  drafts: Array<{ type: string; name: string }>,
  activeRows: ActiveRow[] = [],
) {
  const protocol = new ObjectStackProtocolImplementation({} as never);
  // Stub the bits that need a real engine/overlay so we can exercise the loop.
  (protocol as any).ensureOverlayIndex = async () => {};
  (protocol as any).getOverlayRepo = () => ({ listDrafts: async () => drafts });
  // [#8896] The capture/commit double. Tests that need MORE engine surface
  // spread this rather than replacing it — replacing it takes `findOne` away
  // again and re-arms exactly the vacuity described above.
  const capture = makeCaptureEngine(activeRows);
  (protocol as any).engine = capture.engine;
  // Phase-1 / Phase-2 seams (ADR-0067 D2).
  const promote = vi.spyOn(protocol as any, 'promoteDraftForPublish');
  const sideEffects = vi
    .spyOn(protocol as any, 'runPublishSideEffects')
    .mockResolvedValue({});
  const promoteOk = (req: any) => ({
    singularType: req.type,
    orgId: null,
    result: { version: 'h', seq: 1, item: { body: { name: req.name } }, packageId: null },
  });
  return {
    protocol,
    promote,
    sideEffects,
    promoteOk,
    baseEngine: capture.engine,
    captureReads: capture.captureReads,
    storedCommitItems: capture.storedCommitItems,
  };
}

/** A fake engine whose transaction() tracks commit/rollback (ADR-0067 D2). */
function makeTxnEngine() {
  const txn = { began: 0, committed: 0, rolledBack: 0 };
  const engine = {
    transaction: async <T>(cb: (ctx: unknown) => Promise<T>): Promise<T> => {
      txn.began += 1;
      try {
        const r = await cb({});
        txn.committed += 1;
        return r;
      } catch (e) {
        txn.rolledBack += 1;
        throw e;
      }
    },
  };
  return { engine, txn };
}

describe('protocol.publishPackageDrafts (ADR-0033 / ADR-0067 D2)', () => {
  it('publishes every draft of the package and reports success', async () => {
    const drafts = [
      { type: 'object', name: 'course' },
      { type: 'object', name: 'student' },
      { type: 'view', name: 'course_list' },
    ];
    const { protocol, promote, sideEffects, promoteOk, captureReads } = makeProtocol(drafts);
    promote.mockImplementation(async (req: any) => promoteOk(req));

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    // [#8896] The ADR-0067 capture really RAN, once per draft. Until the
    // capture was discriminated by error type this fixture had no `findOne` at
    // all and the resulting TypeError was swallowed, so every assertion below
    // held over a batch whose revert plan was fabricated rather than read.
    // The capture pass runs BEFORE Phase 1, so its reads are the FIRST three —
    // one per draft, in draft order, each in the draft's own scope. (Reads
    // after these belong to the ADR-0038 L3 probes, which run post-commit.)
    expect(captureReads.slice(0, 3)).toEqual([
      { organization_id: null, type: 'object', name: 'course', state: 'active' },
      { organization_id: null, type: 'object', name: 'student', state: 'active' },
      { organization_id: null, type: 'view', name: 'course_list', state: 'active' },
    ]);
    expect(promote).toHaveBeenCalledTimes(3);
    expect((promote.mock.calls[0][0] as any)).toMatchObject({ type: 'object', name: 'course' });
    // Side effects ran once per promoted item, AFTER promotion, in order.
    //
    // [#8820] Was `requestType`, the UNFOLDED spelling Phase 2 also used to
    // take. `ensureObjectStorage` was its only consumer, so it was removed in
    // favour of the folded `singularType` every other consumer already read —
    // the tolerant-lookup shape `canonicalMetaType`'s header rejects. The
    // draft here is spelled singular either way, so this assertion pins the
    // same fact under the surviving field name.
    expect(sideEffects).toHaveBeenCalledTimes(3);
    expect((sideEffects.mock.calls[0][0] as any)).toMatchObject({ singularType: 'object', name: 'course' });
    expect(res).toMatchObject({ success: true, publishedCount: 3, failedCount: 0 });
    expect(res.published.map((p) => p.name)).toEqual(['course', 'student', 'course_list']);
  });

  /**
   * [#8896] The ADR-0067 revert plan, actually exercised.
   *
   * `existedBefore: false` means "revert = soft-remove"; `true` means "revert =
   * restoreVersion(prevVersion)". Those are opposite operations, and until this
   * card every test in this file recorded `false` for every item — not because
   * the fixture had no active rows but because the capture read crashed on a
   * missing `findOne` and a bare `catch` fabricated `false` over the crash. So
   * the `true` branch had never once been reached from here, and a regression
   * that made every revert a deletion would have kept this suite green.
   *
   * Both answers are asserted in ONE batch so neither can pass by the fixture
   * simply having no active rows at all.
   */
  it('records the real pre-publish state per item: existedBefore true with prevVersion, false for a new artifact', async () => {
    const { protocol, promote, promoteOk, captureReads, storedCommitItems } = makeProtocol(
      [
        { type: 'object', name: 'course' },   // already active at version 4
        { type: 'object', name: 'student' },  // brand new
      ],
      [{ type: 'object', name: 'course', version: 4 }],
    );
    promote.mockImplementation(async (req: any) => promoteOk(req));

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    expect(res).toMatchObject({ success: true, publishedCount: 2 });
    // The capture ran for both items, in their own scope — this is what makes
    // the values below evidence rather than defaults.
    expect(captureReads.slice(0, 2)).toEqual([
      { organization_id: null, type: 'object', name: 'course', state: 'active' },
      { organization_id: null, type: 'object', name: 'student', state: 'active' },
    ]);
    // One commit, carrying one entry per promoted item, each with the state
    // that was actually READ.
    expect(storedCommitItems()).toEqual([
      [
        { type: 'object', name: 'course', existedBefore: true, prevVersion: 4 },
        { type: 'object', name: 'student', existedBefore: false, prevVersion: null },
      ],
    ]);
    // And the commit was really recorded — `recordCommit` swallows its own
    // write failure, so an unasserted `commitId` proves nothing (see #9066).
    expect(res.commitId).toBeDefined();
  });

  it('rejects an object draft missing the package namespace prefix — atomic, before promoting', async () => {
    const { protocol, promote, baseEngine } = makeProtocol([
      { type: 'object', name: 'edu_course' },
      { type: 'object', name: 'ticket' }, // missing the 'edu_' prefix
    ]);
    // Package declares namespace 'edu' (derived+persisted at install time).
    // [#8896] Spread, never replace — see `makeCaptureEngine`.
    (protocol as any).engine = {
      ...baseEngine,
      registry: { getPackage: () => ({ manifest: { namespace: 'edu' } }) },
    };

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    expect(promote).not.toHaveBeenCalled(); // aborted BEFORE any promote
    expect(res.success).toBe(false);
    expect(res.publishedCount).toBe(0);
    expect(res.failedCount).toBe(1);
    expect(res.failed[0]).toMatchObject({ type: 'object', name: 'ticket', code: 'NAMESPACE_PREFIX' });
    expect(res.failed[0].error).toMatch(/Rename it to 'edu_ticket'/);
  });

  it('publishes compliant prefixed object drafts under a declared namespace', async () => {
    const { protocol, promote, promoteOk, baseEngine } = makeProtocol([
      { type: 'object', name: 'edu_course' },
      { type: 'object', name: 'edu_student' },
    ]);
    // [#8896] Spread, never replace — see `makeCaptureEngine`.
    (protocol as any).engine = {
      ...baseEngine,
      registry: { getPackage: () => ({ manifest: { namespace: 'edu' } }) },
    };
    promote.mockImplementation(async (req: any) => promoteOk(req));

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    expect(res).toMatchObject({ success: true, publishedCount: 2, failedCount: 0 });
  });

  it('skips the namespace check when the package declares no namespace (legacy grandfathered)', async () => {
    // No registry / no declared namespace → bare names still publish, exactly
    // as before this rule existed (mirrors defineStack's absent-namespace skip).
    const { protocol, promote, promoteOk } = makeProtocol([
      { type: 'object', name: 'course' }, // bare name, no prefix
    ]);
    promote.mockImplementation(async (req: any) => promoteOk(req));

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    expect(res).toMatchObject({ success: true, publishedCount: 1 });
  });

  it('all-or-nothing (ADR-0067 D2): a mid-batch failure publishes NOTHING and stops the loop', async () => {
    const { protocol, promote, sideEffects, promoteOk } = makeProtocol([
      { type: 'object', name: 'course' },
      { type: 'object', name: 'student' },
      { type: 'view', name: 'course_list' },
    ]);
    promote.mockImplementation(async (req: any) => {
      // [#8333] `status: 403` added, and the fixture is more faithful for it.
      // `failed[].error` now quotes a caught sentence only when the error
      // DECLARED itself a client-facing refusal (a 4xx `status`, ADR-0112);
      // anything undeclared is withheld because it is indistinguishable from
      // raw driver text. This double used to throw a `code` with no `status`,
      // which the REAL producer never does — `SysMetadataRepository`'s
      // `[item_locked]` carries `status: 403` — so the missing half was the
      // fixture's, not the rule's. The assertion below is unchanged.
      if (req.name === 'student') {
        throw Object.assign(new Error('ITEM_LOCKED'), { code: 'ITEM_LOCKED', status: 403 });
      }
      return promoteOk(req);
    });

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    // The loop stopped AT the failure — the third draft was never attempted…
    expect(promote).toHaveBeenCalledTimes(2);
    // …no side effect ran (side effects are post-commit only)…
    expect(sideEffects).not.toHaveBeenCalled();
    // …and NOTHING reports as published: the causal item carries its real
    // error, every other draft is BATCH_ABORTED.
    expect(res.success).toBe(false);
    expect(res.publishedCount).toBe(0);
    expect(res.published).toEqual([]);
    expect(res.failedCount).toBe(3);
    expect(res.failed.find((f) => f.name === 'student')).toMatchObject({ code: 'ITEM_LOCKED', error: 'ITEM_LOCKED' });
    expect(res.failed.find((f) => f.name === 'course')).toMatchObject({ code: 'BATCH_ABORTED' });
    expect(res.failed.find((f) => f.name === 'course_list')).toMatchObject({ code: 'BATCH_ABORTED' });
  });

  it('wraps the batch in ONE engine transaction and rolls it back on failure', async () => {
    const { protocol, promote, promoteOk, baseEngine } = makeProtocol([
      { type: 'object', name: 'course' },
      { type: 'object', name: 'student' },
    ]);
    const { engine, txn } = makeTxnEngine();
    // [#8896] Spread, never replace — see `makeCaptureEngine`.
    (protocol as any).engine = { ...baseEngine, ...engine };
    promote.mockImplementation(async (req: any) => {
      if (req.name === 'student') throw new Error('boom');
      return promoteOk(req);
    });

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    expect(txn.began).toBe(1);
    expect(txn.rolledBack).toBe(1);
    expect(txn.committed).toBe(0);
    expect(res).toMatchObject({ success: false, publishedCount: 0 });
  });

  it('commits the transaction once on a clean batch', async () => {
    const { protocol, promote, promoteOk, baseEngine } = makeProtocol([
      { type: 'object', name: 'course' },
    ]);
    const { engine, txn } = makeTxnEngine();
    // [#8896] Spread, never replace — see `makeCaptureEngine`.
    (protocol as any).engine = { ...baseEngine, ...engine };
    promote.mockImplementation(async (req: any) => promoteOk(req));

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    expect(txn.began).toBe(1);
    expect(txn.committed).toBe(1);
    expect(txn.rolledBack).toBe(0);
    expect(res).toMatchObject({ success: true, publishedCount: 1 });
  });

  it('a side-effect failure does NOT unpublish — metadata is live, the failure is surfaced', async () => {
    const { protocol, promote, sideEffects, promoteOk } = makeProtocol([
      { type: 'object', name: 'course' },
      { type: 'view', name: 'course_list' },
    ]);
    promote.mockImplementation(async (req: any) => promoteOk(req));
    sideEffects.mockImplementation(async (args: any) => {
      if (args.name === 'course_list') throw new Error('DDL hiccup');
      return {};
    });

    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });

    // Both items published (the metadata transaction already committed)…
    expect(res.publishedCount).toBe(2);
    expect(res.success).toBe(true);
    // …and the side-effect failure is SURFACED, not swallowed into a fake unpublish.
    expect(res.materializeApplied?.success).toBe(false);
    expect(res.materializeApplied?.failures?.[0]).toMatchObject({ name: 'course_list' });
  });

  it('returns publishedCount 0 / success false for an empty package', async () => {
    const { protocol, promote } = makeProtocol([]);

    const res = await protocol.publishPackageDrafts({ packageId: 'app.empty' });

    expect(promote).not.toHaveBeenCalled();
    expect(res).toMatchObject({ success: false, publishedCount: 0, failedCount: 0 });
  });

  it('publishes seeds LAST and batch-applies their rows in ONE pass (seedApplied)', async () => {
    // listDrafts order puts the seed FIRST — the partition must still publish
    // the object before it (its table must exist before rows land).
    const drafts = [
      { type: 'seed', name: 'project_sample' },
      { type: 'object', name: 'project' },
      { type: 'seed', name: 'task_sample' },
    ];
    const protocol = new ObjectStackProtocolImplementation({} as never);
    (protocol as any).ensureOverlayIndex = async () => {};
    // [#8896] This case builds its own protocol rather than going through
    // `makeProtocol`, so it needs the capture double explicitly — nothing here
    // is published yet, so every artifact is new and `findOne` truthfully
    // answers `null`.
    const capture = makeCaptureEngine();
    (protocol as any).engine = capture.engine;
    const seedBodyByName: Record<string, unknown> = {
      project_sample: { object: 'project', records: [{ name: 'Apollo' }] },
      task_sample: { object: 'task', records: [{ name: 'Design' }] },
    };
    (protocol as any).getOverlayRepo = () => ({
      listDrafts: async () => drafts,
      get: async (ref: any, opts: any) =>
        opts?.state === 'draft' && seedBodyByName[ref.name]
          ? { body: seedBodyByName[ref.name], hash: 'h' }
          : null,
    });
    const promote = vi.spyOn(protocol as any, 'promoteDraftForPublish')
      .mockImplementation(async (req: any) => ({
        singularType: req.type,
        orgId: null,
        result: { version: 'h', seq: 1, item: { body: { name: req.name } }, packageId: null },
      }));
    const sideEffects = vi.spyOn(protocol as any, 'runPublishSideEffects').mockResolvedValue({});
    const applySeedBodies = vi
      .spyOn(protocol as any, 'applySeedBodies')
      .mockResolvedValue({ success: true, inserted: 2, updated: 0 });

    const res = await protocol.publishPackageDrafts({ packageId: 'app.pm' });

    // Object published BEFORE the seeds, and every item's side effects
    // suppressed the per-item seed apply (batch pass below owns it).
    expect((promote.mock.calls[0][0] as any)).toMatchObject({ type: 'object', name: 'project' });
    for (const call of sideEffects.mock.calls) {
      expect((call[0] as any).skipSeedApply).toBe(true);
    }
    // ONE batch apply with BOTH seed bodies (cross-seed refs need a single pass).
    expect(applySeedBodies).toHaveBeenCalledTimes(1);
    expect(applySeedBodies.mock.calls[0][0]).toEqual([
      seedBodyByName.project_sample,
      seedBodyByName.task_sample,
    ]);
    expect(res.seedApplied).toEqual({ success: true, inserted: 2, updated: 0 });
  });

  it('omits seedApplied when the package has no seed drafts', async () => {
    const { protocol, promote, promoteOk } = makeProtocol([{ type: 'object', name: 'course' }]);
    promote.mockImplementation(async (req: any) => promoteOk(req));
    const res = await protocol.publishPackageDrafts({ packageId: 'app.edu' });
    expect(res.seedApplied).toBeUndefined();
  });
});

/**
 * Publishing a single `seed` draft (the per-ref path: POST /meta/seed/:name/publish,
 * used by the home banner) must materialize its rows too — not only the package
 * route. The publish itself NEVER fails on a seed problem; it reports under
 * `seedApplied`.
 */
describe('protocol.publishMetaItem — seed self-apply', () => {
  function makePublishable(body: unknown) {
    const protocol = new ObjectStackProtocolImplementation({} as never);
    (protocol as any).ensureOverlayIndex = async () => {};
    (protocol as any).assertLockAllowsWrite = async () => null;
    (protocol as any).isArtifactBacked = () => false;
    (protocol as any).applyObjectRegistryMutation = () => {};
    (protocol as any).ensureObjectStorage = async () => {};
    // The double must be as WIDE as `SysMetadataRepository`, not as narrow as
    // the one call the test happens to care about. `promoteDraftForPublish`
    // reads the pending draft before promoting it (#4463 — the author-time
    // rules gate the draft→active transition, or `?mode=draft` + `POST
    // /publish` would be a free way around the gate `saveMetaItem` applies).
    // A double missing `get` failed with `repo.get is not a function`, which
    // is the #4550 shape: a stand-in narrower than the contract it stands in
    // for turns an unrelated feature into a phantom regression in another
    // package. Answering `null` (no draft pending) is also legitimate — the
    // point is that the method EXISTS; here it returns the body under test so
    // the gate sees what the promotion will actually publish.
    (protocol as any).getOverlayRepo = () => ({
      get: async (_ref: unknown, opts?: { state?: string }) =>
        opts?.state === 'draft' ? { body } : null,
      promoteDraft: async () => ({ version: 'sha256:x', seq: 7, item: { body } }),
    });
    const applySeedBodies = vi
      .spyOn(protocol as any, 'applySeedBodies')
      .mockResolvedValue({ success: true, inserted: 3, updated: 0 });
    return { protocol, applySeedBodies };
  }

  it('applies the seed body on publish and reports seedApplied', async () => {
    const body = { object: 'project', records: [{ name: 'Apollo' }] };
    const { protocol, applySeedBodies } = makePublishable(body);
    const res = await protocol.publishMetaItem({ type: 'seed', name: 'project_sample' });
    expect(applySeedBodies).toHaveBeenCalledWith([body], null);
    expect(res.seedApplied).toEqual({ success: true, inserted: 3, updated: 0 });
    expect(res.success).toBe(true);
  });

  it('suppresses the self-apply when _skipSeedApply is set (package batch path)', async () => {
    const { protocol, applySeedBodies } = makePublishable({ object: 'p', records: [] });
    const res = await protocol.publishMetaItem({ type: 'seed', name: 'p_sample', _skipSeedApply: true });
    expect(applySeedBodies).not.toHaveBeenCalled();
    expect(res.seedApplied).toBeUndefined();
  });

  it('does not touch the loader for non-seed publishes', async () => {
    const { protocol, applySeedBodies } = makePublishable({ name: 'overview' });
    const res = await protocol.publishMetaItem({ type: 'dashboard', name: 'overview' });
    expect(applySeedBodies).not.toHaveBeenCalled();
    expect(res.seedApplied).toBeUndefined();
  });
});

/**
 * applySeedBodies wires the real SeedLoaderService: externalId('name')-keyed
 * upsert against the engine, object metadata read through the protocol's own
 * getMetaItem. A smoke test with a fake engine proves rows actually land and
 * the result mapping is faithful.
 */
describe('protocol.applySeedBodies — real loader smoke test', () => {
  it('inserts seed records via the engine and reports counts', async () => {
    const protocol = new ObjectStackProtocolImplementation({} as never);
    const inserted: Array<{ object: string; record: any }> = [];
    (protocol as any).engine = {
      find: async () => [],
      insert: async (object: string, data: any) => {
        // Mirror the real engine's array-form insert (bulk path): an array in
        // → an array of created records out, same order — see framework#2678.
        if (Array.isArray(data)) {
          return data.map((record) => {
            inserted.push({ object, record });
            return { id: `${object}_${inserted.length}` };
          });
        }
        inserted.push({ object, record: data });
        return { id: `${object}_${inserted.length}` };
      },
      update: async (_o: string, data: any, opts?: any) => {
        // [#5480] Pinned to ObjectQL.update's OWN dispatch predicate — the twin of
        // the delete pin, on the same argument: a double looser than the engine it
        // stands in for is how #4434 shipped a REST route that 500'd for every
        // caller with its suite green, and a predicate update is no less
        // destructive than a predicate delete.
        assertEngineUpdateDispatch(data, opts);
        return {};
      },
    };
    (protocol as any).getMetaItem = async ({ name }: any) => ({
      item: { name, fields: { name: { type: 'text' } } },
    });

    const res = await (protocol as any).applySeedBodies(
      [{ object: 'project', records: [{ name: 'Apollo' }, { name: 'Gemini' }] }],
      null,
    );

    expect(inserted.map((i) => i.record.name)).toEqual(['Apollo', 'Gemini']);
    expect(res.success).toBe(true);
    expect(res.inserted).toBe(2);
  });

  it('returns a loud failure (never throws) for an unreadable body', async () => {
    const protocol = new ObjectStackProtocolImplementation({} as never);
    const res = await (protocol as any).applySeedBodies([{ nope: true }], null);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no readable seed bodies/);
  });
});
