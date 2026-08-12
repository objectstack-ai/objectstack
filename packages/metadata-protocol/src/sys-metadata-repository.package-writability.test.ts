// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7682 — the metadata write refusal reports the PACKAGE door, not only the
 * type's registry flags.
 *
 * ## What the QA run measured (objectstack-ai/objectstack#7637)
 *
 * `PUT /api/v1/meta/object/showcase_task` answered `403 NOT_OVERRIDABLE`
 * ("'object' is not allowOrgOverride in the registry") — the SAME code, the
 * same status and the same sentence whether `?package=` pointed at a
 * **read-only** package or a **writable** one. `ITEM_LOCKED` and
 * `WRITABLE_PACKAGE_REQUIRED` are both registered to
 * `@objectstack/metadata-protocol` in the error-code ledger and neither was
 * ever emitted on this path. Declared ≠ enforced: the refusal discriminated on
 * the metadata TYPE and was blind to the base the caller named.
 *
 * The emitter is this repository, not the protocol's own gate, on exactly the
 * topology the run used: `saveMetaItem`'s artifact-backed refusal sits behind
 * `environmentId !== undefined`, and the flagship showcase is assembled by the
 * CLI's lightweight host-config path (`new ObjectQLPlugin()`, no
 * environmentId) — the same reading `meta-object-owd-gate.test.ts` states
 * ("`SysMetadataRepository.assertAllowed()` refuses an `object` overlay of a
 * PACKAGED item outright"). The end-to-end block at the bottom pins that
 * routing as well as the codes, so a future change that moves the refusal back
 * to the protocol shows up here rather than as a silent revert of this card.
 *
 * ## What each block is for
 *
 *  - **the difference** — one PUT, two bases, two outcomes. That difference IS
 *    the defect; a suite that only pinned the new codes would stay green if
 *    the writable case started answering them too.
 *  - **no allow decision moves** — this is a code SELECTION inside the refusal
 *    branch. An ADR-0005 overlay names the read-only package it customizes by
 *    construction, so a package door that refused would close the overlay
 *    model; and `OS_METADATA_WRITABLE` must keep unlocking exactly what it
 *    unlocked before, because the hatch-vs-Studio-badge question is a separate
 *    maintainer decision (#8146) that this card must not pre-empt.
 *  - **delete is untouched** — #6960 moved the delete side deliberately and
 *    warns against symmetrising; `DeleteOptions` carries no `packageId`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { SysMetadataRepository, resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';

interface Row { [k: string]: unknown }

/** A booted code package — `registerApp` puts its manifest in `engine.manifests`. */
const READ_ONLY_PKG = 'com.example.showcase';
/** An installed/platform package — read-only by manifest SCOPE, not by boot. */
const PLATFORM_PKG = 'platform.core';
/** A bare ADR-0048 authoring workspace — no manifest anywhere, so writable. */
const WRITABLE_PKG = 'com.acme.workspace';

/**
 * Minimal engine fake, plus the two surfaces `isWritablePackage` reads.
 *
 * Both are structural and both are OPTIONAL on the real engine, which is why
 * every pre-existing repository test keeps its verdict unchanged: an engine
 * that declares neither answers "writable" for every id, so the type-door
 * codes stand exactly as before.
 */
function makeFakeEngine() {
  const rows = new Map<string, Row>();
  const historyRows: Row[] = [];

  const keyOf = (w: Record<string, unknown>) =>
    `${String(w.type)}|${String(w.name)}|${String(w.organization_id ?? 'null')}|${String(w.state ?? 'active')}`;

  const findRow = (where: Record<string, unknown>) => {
    if (where.id !== undefined) {
      for (const [k, r] of rows) if (r.id === where.id) return { key: k, row: r };
      return null;
    }
    const k = keyOf(where);
    const r = rows.get(k);
    return r ? { key: k, row: r } : null;
  };

  const matchesHistory = (h: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => v === undefined || h[k] === v);

  return {
    rows,
    historyRows,
    // Booted code packages (the `registerApp` map).
    manifests: new Map<string, unknown>([[READ_ONLY_PKG, { id: READ_ONLY_PKG }]]),
    registry: {
      // Installed / platform packages, read-only by manifest scope.
      getPackage: (id: string) =>
        id === PLATFORM_PKG ? { manifest: { id, scope: 'system' } } : undefined,
    },
    async find(table: string, opts: { where: Record<string, unknown> }) {
      if (table === 'sys_metadata_history') return historyRows.filter((h) => matchesHistory(h, opts.where));
      return Array.from(rows.values());
    },
    async findOne(table: string, opts: { where: Record<string, unknown> }) {
      if (table === 'sys_metadata_history') return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
      return findRow(opts.where)?.row ?? null;
    },
    async insert(table: string, data: Record<string, unknown>) {
      if (table === 'sys_metadata_history') {
        const h: Row = { ...data };
        if (!h.id) h.id = `h_${historyRows.length + 1}`;
        historyRows.push(h);
        return { id: h.id as string };
      }
      const k = keyOf(data);
      const row: Row = { id: `r_${rows.size + 1}`, ...data };
      rows.set(k, row);
      return { id: row.id as string };
    },
    async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
      assertEngineUpdateDispatch(data, opts);
      const found = findRow(opts.where);
      if (!found) throw new Error('not found');
      rows.set(found.key, { ...found.row, ...data });
      return { id: found.row.id as string };
    },
    async delete(_t: string, opts: { where: Record<string, unknown> }) {
      assertEngineDeleteDispatch(opts);
      const found = findRow(opts.where);
      if (!found) return { deleted: 0 };
      rows.delete(found.key);
      return { deleted: 1 };
    },
    async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
      return cb(undefined, { owned: true });
    },
  };
}

const objectBody = { name: 'showcase_task', label: 'Task', fields: { name: { type: 'text', label: 'Name' } } };

/** `put` with everything but the base fixed, so each case differs in ONE way. */
async function putWith(
  repo: SysMetadataRepository,
  opts: { type: string; name: string; intent: 'override-artifact' | 'runtime-only'; packageId?: string },
): Promise<unknown> {
  return repo
    .put(
      { org: 'env', type: opts.type, name: opts.name },
      { ...objectBody, name: opts.name },
      {
        parentVersion: null,
        actor: null,
        intent: opts.intent,
        ...(opts.packageId !== undefined ? { packageId: opts.packageId } : {}),
      },
    )
    .then(() => null, (e: unknown) => e);
}

describe('#7682 — the refusal discriminates on package writability', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let repo: SysMetadataRepository;

  beforeEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    resetEnvWritableMetadataTypes();
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    engine = makeFakeEngine();
    repo = new SysMetadataRepository({ engine: engine as never, organizationId: null, orgLabel: 'env' });
  });

  afterEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    resetEnvWritableMetadataTypes();
    ObjectStackProtocolImplementation.resetEnvWritableCache();
  });

  // ── the difference, which is the whole defect ─────────────────────────

  describe('one PUT, two bases, two outcomes', () => {
    it('a read-only base answers ITEM_LOCKED / 403 where a writable base answers NOT_OVERRIDABLE / 403', async () => {
      const readOnly = await putWith(repo, {
        type: 'object', name: 'showcase_task', intent: 'override-artifact', packageId: READ_ONLY_PKG,
      });
      const writable = await putWith(repo, {
        type: 'object', name: 'showcase_task', intent: 'override-artifact', packageId: WRITABLE_PKG,
      });

      // Both halves of the ADR-0112 envelope, on both sides — a message-only
      // assertion cannot tell these two refusals apart, and before #7682 there
      // was nothing to tell apart.
      expect(readOnly).toMatchObject({ code: 'ITEM_LOCKED', status: 403 });
      expect(writable).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
      expect((readOnly as { code: string }).code).not.toBe((writable as { code: string }).code);

      // Nothing persisted on either side: this is a refusal, not a report.
      expect(Array.from(engine.rows.values())).toEqual([]);
    });

    it('read-only-by-SCOPE (installed/platform) is the same door as read-only-by-boot', async () => {
      // `isWritablePackage` has two read-only signals and the door must read
      // both, or "read-only" quietly means "booted from code" only.
      const err = await putWith(repo, {
        type: 'object', name: 'showcase_task', intent: 'override-artifact', packageId: PLATFORM_PKG,
      });
      expect(err).toMatchObject({ code: 'ITEM_LOCKED', status: 403 });
    });

    it('carries the package id and the ADR-0010 package lock source, so a consumer can say WHY', async () => {
      const err = await putWith(repo, {
        type: 'object', name: 'showcase_task', intent: 'override-artifact', packageId: READ_ONLY_PKG,
      }) as { packageId?: string; lockSource?: string; lock?: unknown; message?: string };

      expect(err.packageId).toBe(READ_ONLY_PKG);
      // ADR-0010's reserved value for a lock the PACKAGE layer asserts. It is
      // what separates this from the item-level `_lock` refusal…
      expect(err.lockSource).toBe('package');
      // …which is also why no `lock` value is claimed: the item declares none.
      expect(err.lock).toBeUndefined();
      expect(String(err.message)).toContain(READ_ONLY_PKG);
    });

    it('a runtime-only create names the base: WRITABLE_PACKAGE_REQUIRED / 422 vs NOT_CREATABLE / 403', async () => {
      // `job` is code-only (no allowRuntimeCreate, no allowOrgOverride), so
      // both bases are refused — and the codes still differ, because "you
      // named a read-only base" and "this type has no create channel" are
      // different facts. 422 + the wording mirror `saveMetaItem`'s ADR-0070 D1
      // emitter exactly: one condition, one vocabulary, two enforcement points.
      const readOnly = await putWith(repo, {
        type: 'job', name: 'nightly', intent: 'runtime-only', packageId: READ_ONLY_PKG,
      });
      const writable = await putWith(repo, {
        type: 'job', name: 'nightly', intent: 'runtime-only', packageId: WRITABLE_PKG,
      });

      expect(readOnly).toMatchObject({ code: 'WRITABLE_PACKAGE_REQUIRED', status: 422, packageId: READ_ONLY_PKG });
      expect(writable).toMatchObject({ code: 'NOT_CREATABLE', status: 403 });
    });
  });

  // ── nothing that was allowed becomes refused ──────────────────────────

  describe('no allow decision moves', () => {
    it('an ADR-0005 overlay of a code-shipped item still lands (the naive gate would break this)', async () => {
      // `view` is allowOrgOverride, and an overlay of a packaged view names
      // the read-only package it customizes BY CONSTRUCTION. If the package
      // door refused instead of choosing a code, the whole overlay model would
      // close — this is the case that decides the shape of the fix.
      const err = await putWith(repo, {
        type: 'view', name: 'case_grid', intent: 'override-artifact', packageId: READ_ONLY_PKG,
      });
      expect(err).toBeNull();
      expect(Array.from(engine.rows.values())).toHaveLength(1);
      expect(Array.from(engine.rows.values())[0]).toMatchObject({ package_id: READ_ONLY_PKG });
    });

    it('[ruling] OS_METADATA_WRITABLE still unlocks a write into a READ-ONLY package', async () => {
      // The card's measured hatch case, at the layer that answers it:
      // `OS_METADATA_WRITABLE=permission` + a `permission` set belonging to the
      // read-only showcase package → the write SUCCEEDS. #7682's second half
      // (does the hatch or Studio's "Read-only" badge win?) is filed as #8146
      // and is the maintainer's to rule; this pin is what keeps that ruling
      // free to move the behaviour DELIBERATELY later, instead of it drifting
      // as a side effect of the code-selection fix.
      process.env.OS_METADATA_WRITABLE = 'permission';
      resetEnvWritableMetadataTypes();

      const err = await putWith(repo, {
        type: 'permission', name: 'showcase_contributor', intent: 'override-artifact', packageId: READ_ONLY_PKG,
      });

      expect(err).toBeNull();
      expect(Array.from(engine.rows.values())).toHaveLength(1);
      expect(Array.from(engine.rows.values())[0]).toMatchObject({
        type: 'permission', name: 'showcase_contributor', package_id: READ_ONLY_PKG,
      });
    });

    it('without the hatch, that same permission write is refused by the package door', async () => {
      // The other side of the pin above: the hatch is doing the work, not an
      // accident of `permission` being overlay-capable.
      const err = await putWith(repo, {
        type: 'permission', name: 'showcase_contributor', intent: 'override-artifact', packageId: READ_ONLY_PKG,
      });
      expect(err).toMatchObject({ code: 'ITEM_LOCKED', status: 403 });
    });

    it('a write that names NO base keeps the type-door codes verbatim', async () => {
      // `isWritablePackage(null)` is false by design ("no base resolved" is a
      // refusal for the authoring path), so reading it here without the
      // caller-named guard would re-code every ordinary env-local overlay
      // refusal in the product. It does not.
      const override = await putWith(repo, {
        type: 'object', name: 'showcase_task', intent: 'override-artifact',
      });
      const create = await putWith(repo, { type: 'job', name: 'nightly', intent: 'runtime-only' });

      expect(override).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
      expect(create).toMatchObject({ code: 'NOT_CREATABLE', status: 403 });
    });
  });

  // ── the delete verb is deliberately not symmetrised (#6960) ───────────

  it('delete keeps its own codes — DeleteOptions names no base', async () => {
    await expect(
      repo.delete(
        { org: 'env', type: 'object', name: 'showcase_task' },
        { parentVersion: 'sha256:whatever', actor: null, intent: 'override-artifact' },
      ),
    ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
  });
});

/**
 * The card's reproduction, end to end, on the topology it was measured on.
 *
 * `environmentId` undefined = the CLI host-config assembler (the showcase and
 * every self-hosted server shaped like it). `saveMetaItem`'s own artifact-
 * backed refusal is behind `environmentId !== undefined`, so the write reaches
 * `SysMetadataRepository.put` and the package door is what answers.
 *
 * ⚠️ On a SCOPED kernel (`environmentId` set) the protocol refuses first, with
 * `NOT_OVERRIDABLE`, and this fix is not reachable — that second refusal point
 * lives in `protocol.ts`, which this card is not authorised to edit. Filed
 * separately; the asymmetry is stated here so the next reader measures it
 * instead of assuming this suite covers both kernels.
 */
describe('#7682 — through saveMetaItem on the host-config topology', () => {
  function boot() {
    const engine = makeFakeEngine() as unknown as Record<string, unknown>;
    (engine as { registry: Record<string, unknown> }).registry = {
      ...(engine.registry as Record<string, unknown>),
      registerItem: () => {},
      registerObject: () => {},
      listItems: () => [],
      getItem: () => undefined,
      // A hit here is what makes the name artifact-backed, i.e. an
      // `override-artifact` intent — the card's `showcase_task`.
      getArtifactItem: (type: string, name: string) =>
        type === 'object' && name === 'showcase_task'
          ? { name, _packageId: READ_ONLY_PKG }
          : undefined,
    };
    const protocol = new ObjectStackProtocolImplementation(
      engine as never,
      () => new Map(),
      undefined, // no environmentId — the host-config / showcase assembly
    ) as unknown as {
      saveMetaItem(req: Record<string, unknown>): Promise<unknown>;
    };
    return { engine, protocol };
  }

  beforeEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    resetEnvWritableMetadataTypes();
    ObjectStackProtocolImplementation.resetEnvWritableCache();
  });
  afterEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    resetEnvWritableMetadataTypes();
    ObjectStackProtocolImplementation.resetEnvWritableCache();
  });

  it('PUT object/showcase_task answers ITEM_LOCKED for a read-only base and NOT_OVERRIDABLE for a writable one', async () => {
    const { protocol } = boot();

    const readOnly = await protocol
      .saveMetaItem({ type: 'object', name: 'showcase_task', item: objectBody, packageId: READ_ONLY_PKG })
      .then(() => null, (e: unknown) => e);
    const writable = await protocol
      .saveMetaItem({ type: 'object', name: 'showcase_task', item: objectBody, packageId: WRITABLE_PKG })
      .then(() => null, (e: unknown) => e);

    expect(readOnly).toMatchObject({ code: 'ITEM_LOCKED', status: 403 });
    expect(writable).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
  }, 30_000);
});
