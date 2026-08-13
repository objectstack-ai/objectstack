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
 *    model, and that case is pinned below.
 *  - **delete is untouched** — #6960 moved the delete side deliberately and
 *    warns against symmetrising; `DeleteOptions` carries no `packageId`.
 *
 *  - **[#8146] the hatch is type-level** — `OS_METADATA_WRITABLE` no longer
 *    unlocks a write that NAMES a read-only base. See that block's own
 *    docblock; it carries the ruling and the measurement NARROW rests on.
 *
 * ## [#8146] `OS_METADATA_WRITABLE` — from "deliberately uncovered" to pinned
 *
 * An earlier revision of this docblock told the next reader NOT to add a hatch
 * case, because on `main` a hatch write into a read-only package SUCCEEDED and
 * any test of it would have been green *because the bug was present* (a shape
 * this repo does not merge — PM ruling, PR #8185 patch round). That is no
 * longer the state of the file: #8146 landed the refusal, so the pin it always
 * owed is written below against the FIXED behaviour. The prohibition is
 * discharged, not still standing — do not read the history as a live warning.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import type { MetaRef } from '@objectstack/metadata-core';
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

  // [#8146] Keyed by TABLE as well as identity. `recordMetadataAudit` inserts
  // an audit row carrying the same `type`/`name`/`organization_id`, so a
  // table-blind key let the audit row overwrite the `sys_metadata` row it
  // describes — measured while verifying #8146's premise, where it made a
  // correctly-bound row read back as `package_id: null`. Only a test that
  // reads the row BACK (the preservation cases below) can see this, which is
  // why it survived until a case needed the binding rather than the throw.
  const keyOf = (w: Record<string, unknown>, table = 'sys_metadata') =>
    `${table}|${String(w.type)}|${String(w.name)}|${String(w.organization_id ?? 'null')}|${String(w.state ?? 'active')}`;

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
      const k = keyOf(data, table);
      const row: Row = { id: `r_${rows.size + 1}`, __table: table, ...data };
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

/**
 * [#8146] A spec-VALID permission set — the QA run's `showcase_contributor`.
 *
 * It has to parse, because `saveMetaItem` runs the Zod gate BEFORE the
 * authorization door: an invalid body answers `INVALID_METADATA` / 422 and
 * never reaches `assertAllowed`, which would make a refusal pin green for
 * entirely the wrong reason. (Measured — the first draft of this fixture used
 * `permissions: {}` and every case came back 422 from the schema.)
 */
const permissionBody = { name: 'showcase_contributor', label: 'Contributor', objects: {} };

/**
 * `put` with everything but the base fixed, so each case differs in ONE way.
 *
 * `type` is `MetaRef['type']`, not `string`: that field is a literal union, and
 * a widened `string` here is a real `tsc --noEmit` error even though `vitest`
 * runs the file happily (this package's type surface is judged by the DEBT
 * ledger in CI, never by the test run).
 */
async function putWith(
  repo: SysMetadataRepository,
  opts: {
    type: MetaRef['type'];
    name: string;
    intent: 'override-artifact' | 'runtime-only';
    packageId?: string;
  },
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

    it('a permission set belonging to a read-only package is refused by the package door', async () => {
      // The card's own hatch case, minus the hatch — see the suite docblock for
      // why the hatch half is deliberately uncovered here. With no hatch set,
      // the read-only base is what the refusal names, which is #7682's whole
      // point, and `permission` is the type the QA run used.
      const err = await putWith(repo, {
        type: 'permission', name: 'showcase_contributor', intent: 'override-artifact', packageId: READ_ONLY_PKG,
      });
      expect(err).toMatchObject({ code: 'ITEM_LOCKED', status: 403 });
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

  // ── [#8146] the hatch unlocks the TYPE, never the PACKAGE ─────────────

  /**
   * #8146 — `OS_METADATA_WRITABLE` answered 200 on a read-only package while
   * Studio rendered the same matrix disabled with a "Read-only" badge.
   *
   * **Maintainer ruling, 2026-08-12 (option B):** the badge is telling the
   * truth and the server should refuse. The hatch is a TYPE-level unlock by
   * its own shipped documentation — `environment-variables.mdx:305` defines it
   * as treating named types "as `allowOrgOverride: true` … overridden per-org"
   * — so it says nothing about the PACKAGE dimension.
   *
   * **How far the refusal reaches: NARROW** (PM ruling, veto window unopposed).
   * Only a write that NAMES a read-only base is refused; a package-less hatch
   * write still lands the overlay the documentation promises. NARROW is only
   * honest if that overlay is real, so it was measured on this topology before
   * the fix was written, and both halves are pinned below as PRESERVATION
   * cases: package-less lands `{ package_id: null, organization_id: null }`
   * env-wide, and `{ package_id: null, organization_id: <org> }` under an org
   * kernel — the documented per-org override, intact.
   *
   * ⛔ The BROADER reading (the hatch never unlocks a write against an item a
   * read-only package provides, named or not) is NOT implemented and must not
   * be "completed" here: it retires the hatch's only documented use and needs a
   * maintainer decision plus a docs/ADR change.
   *
   * One measurement worth carrying, because it narrows what this card proves:
   * `{ package_id: <read-only>, organization_id: null }` is ALSO what a genuine
   * `allowOrgOverride` overlay writes whenever the caller names the package it
   * customizes (the `view` case in "no allow decision moves" above). So the
   * defect was never "the hatch writes a row shape nothing else produces" — it
   * is precisely the ruling's own sentence: a type-level unlock reached the
   * package dimension.
   */
  describe('#8146 — OS_METADATA_WRITABLE does not unlock a read-only package', () => {
    /** Open the hatch for `permission`, the type the QA run used. */
    function openHatch(types = 'permission') {
      process.env.OS_METADATA_WRITABLE = types;
      resetEnvWritableMetadataTypes();
      ObjectStackProtocolImplementation.resetEnvWritableCache();
    }

    // ── the refusal: both halves of the ADR-0112 envelope ───────────────

    it('the card\'s reproduction is refused: ITEM_LOCKED / 403, where it used to answer 200', async () => {
      openHatch();
      const err = await putWith(repo, {
        type: 'permission', name: 'showcase_contributor',
        intent: 'override-artifact', packageId: READ_ONLY_PKG,
      });

      // `code` AND `status` — the ruling names both, and a message-only
      // assertion cannot tell this refusal from the type door's.
      expect(err).toMatchObject({ code: 'ITEM_LOCKED', status: 403 });
      // A refusal, not a report: nothing may reach `sys_metadata`.
      expect(Array.from(engine.rows.values())).toEqual([]);
    });

    it('read-only-by-SCOPE is the same door — the hatch does not discriminate between the two signals', async () => {
      openHatch();
      const err = await putWith(repo, {
        type: 'permission', name: 'showcase_contributor',
        intent: 'override-artifact', packageId: PLATFORM_PKG,
      });
      expect(err).toMatchObject({ code: 'ITEM_LOCKED', status: 403, packageId: PLATFORM_PKG });
    });

    it('a runtime-only hatch write into a read-only base: WRITABLE_PACKAGE_REQUIRED / 422', async () => {
      // `job` has neither channel, so the hatch is the only thing that could
      // have allowed this. Naming a read-only base takes it back — with the
      // code whose prescription is TRUE for a create (a writable base helps).
      openHatch('job');
      const err = await putWith(repo, {
        type: 'job', name: 'nightly', intent: 'runtime-only', packageId: READ_ONLY_PKG,
      });
      expect(err).toMatchObject({ code: 'WRITABLE_PACKAGE_REQUIRED', status: 422, packageId: READ_ONLY_PKG });
    });

    it('does NOT prescribe the hatch that is already set — the false-prescription trap', async () => {
      // Before #8146 this message ended "…or set OS_METADATA_WRITABLE=permission
      // to grant a runtime escape hatch". Emitted while that variable IS set,
      // it prescribes the step the caller already took — the shape that makes
      // an automated client (or an AI agent) retry the same request forever.
      openHatch();
      const err = await putWith(repo, {
        type: 'permission', name: 'showcase_contributor',
        intent: 'override-artifact', packageId: READ_ONLY_PKG,
      }) as { message?: string };
      const message = String(err.message);

      expect(message).not.toMatch(/set OS_METADATA_WRITABLE/);
      // …and it states the true remedy the measurement below proves exists.
      expect(message).toContain('does not apply here');
      expect(message).toContain("Retry without '?package='");
    });

    // ── PRESERVATION: what NARROW deliberately keeps working ────────────

    it('a package-less hatch write still lands the env-wide overlay, bound to NO package', async () => {
      // THE PREMISE. If this ever goes red, NARROW is preserving nothing and
      // the fork (NARROW vs BROAD) goes back to the maintainer — it is not a
      // test to "repair" by relaxing it.
      openHatch();
      const err = await putWith(repo, {
        type: 'permission', name: 'showcase_contributor', intent: 'override-artifact',
      });

      expect(err).toBeNull();
      const metaRows = Array.from(engine.rows.values()).filter((r) => r.__table === 'sys_metadata');
      expect(metaRows).toHaveLength(1);
      expect(metaRows[0]).toMatchObject({ package_id: null, organization_id: null });
    });

    it('a package-less hatch write under an ORG kernel lands the per-org override the docs promise', async () => {
      // `environment-variables.mdx:305` — the hatch treats named types "as
      // `allowOrgOverride: true` … overridden per-org". This is that sentence,
      // executed: the row binds to the org and to no package.
      openHatch();
      const orgRepo = new SysMetadataRepository({
        engine: engine as never, organizationId: 'org_acme', orgLabel: 'org_acme',
      });
      const err = await putWith(orgRepo, {
        type: 'permission', name: 'showcase_contributor', intent: 'override-artifact',
      });

      expect(err).toBeNull();
      const metaRows = Array.from(engine.rows.values()).filter((r) => r.__table === 'sys_metadata');
      expect(metaRows).toHaveLength(1);
      expect(metaRows[0]).toMatchObject({ package_id: null, organization_id: 'org_acme' });
    });

    it('a hatch write naming a WRITABLE base still lands — the door reads writability, not the hatch', async () => {
      openHatch();
      const err = await putWith(repo, {
        type: 'permission', name: 'showcase_contributor',
        intent: 'override-artifact', packageId: WRITABLE_PKG,
      });

      expect(err).toBeNull();
      const metaRows = Array.from(engine.rows.values()).filter((r) => r.__table === 'sys_metadata');
      expect(metaRows[0]).toMatchObject({ package_id: WRITABLE_PKG });
    });

    it('the ADR-0005 overlay is untouched: a registry-allowed type still overlays a read-only package', async () => {
      // The limb ordering IS the fix, so it needs a pin on BOTH sides of the
      // door. `view` is allowOrgOverride and returns at the registry limb —
      // above the door — with the hatch open for an unrelated type. If the
      // door had been placed one limb higher, this goes red and the whole
      // overlay model closes.
      openHatch();
      const err = await putWith(repo, {
        type: 'view', name: 'case_grid', intent: 'override-artifact', packageId: READ_ONLY_PKG,
      });
      expect(err).toBeNull();
      const metaRows = Array.from(engine.rows.values()).filter((r) => r.__table === 'sys_metadata');
      expect(metaRows[0]).toMatchObject({ package_id: READ_ONLY_PKG });
    });

    it('with the hatch CLOSED the refusal still offers it — the prescription is chosen, not deleted', async () => {
      // The other side of the false-prescription pin: opening the hatch (on a
      // package-less write) remains a real answer, so the sentence must
      // survive when the hatch is not already set.
      const err = await putWith(repo, {
        type: 'permission', name: 'showcase_contributor',
        intent: 'override-artifact', packageId: READ_ONLY_PKG,
      }) as { message?: string };
      expect(String(err.message)).toContain('set OS_METADATA_WRITABLE=permission');
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
 * lives in `protocol.ts`, which neither #7682 nor #8146 is authorised to edit.
 * It is filed as **#8184**, and it is deliberately NOT covered here: this file
 * pins ONE kernel. ⛔ Do not read a green run of this suite as evidence that
 * the scoped kernel refuses too — it does not, and #8146's hatch refusal below
 * inherits exactly the same boundary.
 */
describe('#7682 / #8146 — through saveMetaItem on the host-config topology', () => {
  function boot() {
    const engine = makeFakeEngine() as unknown as Record<string, unknown>;
    (engine as { registry: Record<string, unknown> }).registry = {
      ...(engine.registry as Record<string, unknown>),
      registerItem: () => {},
      registerObject: () => {},
      listItems: () => [],
      getItem: () => undefined,
      // A hit here is what makes the name artifact-backed, i.e. an
      // `override-artifact` intent — #7682's `showcase_task`, and [#8146]
      // `showcase_contributor`, the permission set the QA run drove the hatch
      // against. Both ship from the read-only package.
      getArtifactItem: (type: string, name: string) =>
        (type === 'object' && name === 'showcase_task')
        || (type === 'permission' && name === 'showcase_contributor')
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

  /**
   * [#8146] The QA run's own request, verbatim, through the same door.
   *
   * `PUT /api/v1/meta/permission/showcase_contributor?package=com.example.showcase`
   * with `OS_METADATA_WRITABLE=permission` answered **200** on `main` — measured
   * again on this tree before the fix, landing
   * `{ package_id: 'com.example.showcase', organization_id: null }`. That is the
   * write the ruling calls a bug, and this is where it is now refused.
   */
  it('[#8146] the hatch write the QA run measured is refused: ITEM_LOCKED / 403, nothing persisted', async () => {
    const { engine, protocol } = boot();
    process.env.OS_METADATA_WRITABLE = 'permission';
    resetEnvWritableMetadataTypes();
    ObjectStackProtocolImplementation.resetEnvWritableCache();

    const err = await protocol
      .saveMetaItem({
        type: 'permission', name: 'showcase_contributor',
        item: permissionBody, packageId: READ_ONLY_PKG,
      })
      .then(() => null, (e: unknown) => e);

    expect(err).toMatchObject({ code: 'ITEM_LOCKED', status: 403, packageId: READ_ONLY_PKG });
    const metaRows = Array.from((engine as unknown as { rows: Map<string, Row> }).rows.values())
      .filter((r) => r.__table === 'sys_metadata');
    expect(metaRows).toEqual([]);
  }, 30_000);

  it('[#8146] the same hatch write WITHOUT ?package= still lands, bound to no package', async () => {
    // The preservation half, end to end. NARROW refuses the named base and
    // nothing else; this is the behaviour `environment-variables.mdx` promises
    // and the reason the broad reading was not taken.
    const { engine, protocol } = boot();
    process.env.OS_METADATA_WRITABLE = 'permission';
    resetEnvWritableMetadataTypes();
    ObjectStackProtocolImplementation.resetEnvWritableCache();

    const err = await protocol
      .saveMetaItem({ type: 'permission', name: 'showcase_contributor', item: permissionBody })
      .then(() => null, (e: unknown) => e);

    expect(err).toBeNull();
    const metaRows = Array.from((engine as unknown as { rows: Map<string, Row> }).rows.values())
      .filter((r) => r.__table === 'sys_metadata');
    expect(metaRows).toHaveLength(1);
    expect(metaRows[0]).toMatchObject({ package_id: null, organization_id: null });
  }, 30_000);
});
