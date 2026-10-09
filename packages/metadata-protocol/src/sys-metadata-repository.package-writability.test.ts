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
 *  - **[ADR-0131 D6] managed content is sealed** — and since that decision the
 *    hatch unlocks no `override-artifact` write at all, named base or not: the
 *    BROAD reading #8146 reserved for a maintainer decision is the one D6
 *    records. The preservation cases NARROW kept are pinned refused below.
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
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
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
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return v === undefined || h[k] === v;
    });

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
      assertEngineFindOnePredicate(table, opts);
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

// [#8308] `sharingModel` authored: the publish gate refuses an OWD-less custom
// object (`security-owd-unset`) once #8310 declares `object` in `runtimeTypes`,
// and this file pins the package-writability refusals, not that one.
const objectBody = { name: 'showcase_task', label: 'Task', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name' } } };

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
 * [#8184] A spec-valid `view` CONTAINER — the ADR-0005 overlay preservation
 * case, which needs a body the Zod gate accepts for the same reason
 * {@link permissionBody} does: an invalid body answers 422 before the
 * authorization door and the pin goes green without ever reaching it.
 *
 * `ViewSchema` is the container (`list` / `form` / `listViews` / `formViews`),
 * NOT a flat list view — a flat one parses to an empty container.
 */
const viewBody = {
  name: 'case_grid',
  label: 'Case Grid',
  object: 'showcase_task',
  list: { columns: ['name'] },
};

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
      // The card's own hatch case, minus the hatch: this is #7682's half, so it
      // holds with the hatch CLOSED and must keep holding independently of
      // #8146. (The hatch half is no longer uncovered — it is pinned in the
      // `#8146` describe below; this comment used to say otherwise, which
      // #8185 wrote while that gap was still open.) With no hatch set, the
      // read-only base is what the refusal names, which is #7682's whole
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
   * [ADR-0131 D6] The BROADER reading (the hatch never unlocks a write against
   * an item a read-only package provides, named or not) is the decision D6
   * records — managed content is sealed — and is implemented: the
   * preservation cases below are pinned REFUSED, and the docs entry
   * (`environment-variables.mdx`) says what the hatch no longer opens. This
   * docblock used to say the broader reading needed exactly that decision.
   *
   * One measurement worth carrying, because it narrows what this card proves:
   * `{ package_id: <read-only>, organization_id: null }` is ALSO what a genuine
   * `allowOrgOverride` overlay writes whenever the caller names the package it
   * customizes (the `view` case in "no allow decision moves" above). So the
   * defect was never "the hatch writes a row shape nothing else produces" — it
   * is precisely the ruling's own sentence: a type-level unlock reached the
   * package dimension.
   */
  describe('#8146 → ADR-0131 D6 — OS_METADATA_WRITABLE unlocks no write onto an item a managed package ships', () => {
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
      // [ADR-0131 D6] #8146's hatch-open remedy ("retry without ?package= to
      // land the overlay the hatch grants") is false too now: no package-less
      // write lands one. A Regime C type is told its row's sanctioned path.
      openHatch();
      const err = await putWith(repo, {
        type: 'permission', name: 'showcase_contributor',
        intent: 'override-artifact', packageId: READ_ONLY_PKG,
      }) as { message?: string };
      const message = String(err.message);

      expect(message).not.toMatch(/OS_METADATA_WRITABLE/);
      expect(message).not.toContain("Retry without '?package='");
      expect(message).toContain('Clone it under a new name to customize it');
    });

    // ── [ADR-0131 D6] SEALED: what NARROW used to keep working ──────────
    //
    // These three were NARROW's preservation pins ("if this ever goes red, the
    // NARROW/BROAD fork goes back to the maintainer"). It went back, and the
    // maintainer's decision is ADR-0131 D6: managed content is sealed. Each is
    // now pinned on the far side — refused with the seal, nothing persisted —
    // with the hatch open, for every base spelling NARROW admitted.

    it('a package-less hatch write lands NO overlay: NOT_OVERRIDABLE / 403, nothing persisted', async () => {
      openHatch();
      const err = await putWith(repo, {
        type: 'permission', name: 'showcase_contributor', intent: 'override-artifact',
      }) as { message?: string };

      expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
      expect(String(err.message)).toContain(
        "Metadata item 'permission/showcase_contributor' is provided by a managed package and is sealed",
      );
      expect(Array.from(engine.rows.values()).filter((r) => r.__table === 'sys_metadata')).toEqual([]);
    });

    it('a package-less hatch write under an ORG kernel lands no per-org override either', async () => {
      openHatch();
      const orgRepo = new SysMetadataRepository({
        engine: engine as never, organizationId: 'org_acme', orgLabel: 'org_acme',
      });
      const err = await putWith(orgRepo, {
        type: 'permission', name: 'showcase_contributor', intent: 'override-artifact',
      });

      expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
      expect(Array.from(engine.rows.values()).filter((r) => r.__table === 'sys_metadata')).toEqual([]);
    });

    it('a hatch write naming a WRITABLE base lands nothing — the hatch reaches no managed item on any base', async () => {
      openHatch();
      const err = await putWith(repo, {
        type: 'permission', name: 'showcase_contributor',
        intent: 'override-artifact', packageId: WRITABLE_PKG,
      });

      expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
      expect(Array.from(engine.rows.values()).filter((r) => r.__table === 'sys_metadata')).toEqual([]);
    });

    it('the legacy spelling (OBJECTSTACK_METADATA_WRITABLE) opens nothing either', async () => {
      // This reader honours only `OS_METADATA_WRITABLE`, so the legacy spelling
      // was already shut here; pinned so the seal does not depend on that.
      process.env.OBJECTSTACK_METADATA_WRITABLE = 'permission';
      resetEnvWritableMetadataTypes();
      ObjectStackProtocolImplementation.resetEnvWritableCache();
      try {
        const err = await putWith(repo, {
          type: 'permission', name: 'showcase_contributor', intent: 'override-artifact',
        });
        expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
      } finally {
        delete process.env.OBJECTSTACK_METADATA_WRITABLE;
      }
    });

    it('control: the hatch keeps its TYPE-level unlock for an item no managed package ships (runtime-only)', async () => {
      // `job` has no create channel: the hatch is what admits this write, and
      // the seal does not reach it — a `runtime-only` intent names no managed
      // item. Package-less, so no package door is asked.
      openHatch('job');
      const err = await putWith(repo, { type: 'job', name: 'nightly', intent: 'runtime-only' });
      expect(err).toBeNull();
      expect(Array.from(engine.rows.values()).filter((r) => r.__table === 'sys_metadata')).toHaveLength(1);
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

    it('[ADR-0131 D6] with the hatch CLOSED the refusal no longer offers it — opening it lands nothing', async () => {
      // This was the other side of the false-prescription pin: under NARROW,
      // opening the hatch on a package-less write was a real answer, so the
      // sentence offered it. Managed content is sealed now, so that offer is
      // the false prescription: the sentence names the seal and says the hatch
      // does not open a managed item, hatch shut or open, and keeps the source
      // remedy. A type with no regime row (`page`); the envelope is unchanged.
      for (const hatch of [undefined, 'page']) {
        if (hatch) openHatch(hatch);
        const err = await putWith(repo, {
          type: 'page', name: 'crm_landing',
          intent: 'override-artifact', packageId: READ_ONLY_PKG,
        }) as { message?: string };
        expect(err, String(hatch)).toMatchObject({ code: 'ITEM_LOCKED', status: 403, lockSource: 'package', packageId: READ_ONLY_PKG });
        const message = String(err.message);
        expect(message, String(hatch)).not.toMatch(/set OS_METADATA_WRITABLE/);
        expect(message, String(hatch)).toContain('OS_METADATA_WRITABLE does not open a managed item');
        expect(message, String(hatch)).toContain('Edit the source artifact and redeploy.');
      }
    });

    it('[ADR-0126 §2] …while a Regime C type with the hatch CLOSED is told its sanctioned path, not the hatch', async () => {
      // The pin above, on a type that HAS a regime row: same limb, same
      // envelope, and the remedy is the row's — `permission`'s is its clone.
      const err = await putWith(repo, {
        type: 'permission', name: 'showcase_contributor',
        intent: 'override-artifact', packageId: READ_ONLY_PKG,
      }) as { message?: string };
      expect(err).toMatchObject({ code: 'ITEM_LOCKED', status: 403, lockSource: 'package', packageId: READ_ONLY_PKG });
      const message = String(err.message);
      expect(message.startsWith(
        `Cannot overlay 'permission' in package '${READ_ONLY_PKG}': that package is read-only, and its packaged base `
        + 'is locked against in-place edits. ',
      )).toBe(true);
      expect(message).toContain(
        'Clone it under a new name to customize it (the "Clone" action on the permission set, '
        + 'or POST /api/v1/data/sys_permission_set with a new name).',
      );
      expect(message).not.toContain('OS_METADATA_WRITABLE');
      expect(message).not.toContain('redeploy');
      expect(message.endsWith('See docs/adr/0126-packaged-metadata-customization-model.md.')).toBe(true);
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
 * ⚠️ [#8184] THAT BOUNDARY IS GONE — do not restore this docblock's earlier
 * warning. It read: on a SCOPED kernel the protocol refuses first with
 * `NOT_OVERRIDABLE`, this fix is not reachable there, and a green run of this
 * block is NOT evidence about that kernel. True when #7682 and #8146 wrote it
 * (neither was authorised to edit `protocol.ts`), and closed by #8184: the
 * scoped branch now consults the same predicate and throws this file's own
 * emitter. Both kernels are covered, and the block at the very bottom pins
 * them against EACH OTHER rather than against a literal — so the divergence
 * cannot come back as a green suite.
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

  it('[ADR-0131 D6] the same hatch write WITHOUT ?package= is refused too: NOT_OVERRIDABLE / 403, nothing persisted', async () => {
    // Was NARROW's preservation half, end to end ("still lands, bound to no
    // package"). Managed content is sealed: the protocol's package door
    // refuses it on this topology before the repository is reached.
    const { engine, protocol } = boot();
    process.env.OS_METADATA_WRITABLE = 'permission';
    resetEnvWritableMetadataTypes();
    ObjectStackProtocolImplementation.resetEnvWritableCache();

    const err = await protocol
      .saveMetaItem({ type: 'permission', name: 'showcase_contributor', item: permissionBody })
      .then(() => null, (e: unknown) => e);

    expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    const metaRows = Array.from((engine as unknown as { rows: Map<string, Row> }).rows.values())
      .filter((r) => r.__table === 'sys_metadata');
    expect(metaRows).toEqual([]);
  }, 30_000);
});

/**
 * [#8184] The SECOND refusal point — the same request on a SCOPED kernel.
 *
 * `saveMetaItem` carries its own artifact-backed refusal behind
 * `if (this.environmentId !== undefined)`, and it ran BEFORE the repository
 * ever saw the write. So the block above pinned one kernel and one kernel only:
 * a project/cloud per-env kernel answered the undiscriminated
 * `NOT_OVERRIDABLE` for the very request a host-config kernel answered
 * `ITEM_LOCKED` for. One condition, two machine-readable vocabularies, selected
 * by a ROW-SCOPING key — the #5086 / #6710 finding, now on the refusal
 * vocabulary itself.
 *
 * ⚠️ Not a regression from #8185 or #8320: this branch answered
 * `NOT_OVERRIDABLE` before both. Those cards made the divergence visible.
 *
 * ## What this block pins, and why it is a MIRROR rather than a second rule
 *
 * The protocol branch now consults the same {@link isWritablePackage}
 * predicate and throws the repository's OWN emitter
 * (`SysMetadataRepository.readOnlyBaseOverrideError`) — not a re-spelling of
 * it. Two independently-authored refusals for one condition is how the
 * `NOT_OVERRIDABLE`-everywhere problem started, so the pin below compares the
 * two kernels' answers to EACH OTHER (`the two kernels agree`) rather than
 * asserting a literal twice.
 *
 * **The limb ordering is the rule, here too.** The door is below every
 * registry limb (an ADR-0005 overlay never reaches it, pinned). [ADR-0131 D6]
 * The hatch is no longer a limb: the protocol's package door reads the
 * registry flag alone (`isSealedManagedItem`), so a hatch-open write of a
 * managed item meets this door and the repository's refuses it the same way.
 */
describe('#8184 — the scoped kernel answers the same code as the host-config kernel', () => {
  /**
   * @param environmentId `undefined` = the CLI host-config assembler;
   *   a string = a project/cloud per-environment kernel. The ONLY difference
   *   between the two boots, which is what makes the comparison a measurement
   *   of the topology key and nothing else.
   */
  function boot(environmentId?: string) {
    const engine = makeFakeEngine() as unknown as Record<string, unknown>;
    (engine as { registry: Record<string, unknown> }).registry = {
      ...(engine.registry as Record<string, unknown>),
      registerItem: () => {},
      registerObject: () => {},
      listItems: () => [],
      getItem: () => undefined,
      getArtifactItem: (type: string, name: string) =>
        (type === 'object' && name === 'showcase_task')
        || (type === 'permission' && name === 'showcase_contributor')
        // [#8184] `view` is `allowOrgOverride: true`, so it returns at the
        // REGISTRY limb — above the door. Artifact-backed on purpose: that is
        // the ADR-0005 overlay the door must never refuse.
        || (type === 'view' && name === 'case_grid')
          ? { name, _packageId: READ_ONLY_PKG }
          : undefined,
    };
    const protocol = new ObjectStackProtocolImplementation(
      engine as never,
      () => new Map(),
      environmentId,
    ) as unknown as {
      saveMetaItem(req: Record<string, unknown>): Promise<unknown>;
    };
    return { engine, protocol };
  }

  const metaRowsOf = (engine: Record<string, unknown>) =>
    Array.from((engine as unknown as { rows: Map<string, Row> }).rows.values())
      .filter((r) => r.__table === 'sys_metadata');

  const save = (
    protocol: { saveMetaItem(req: Record<string, unknown>): Promise<unknown> },
    req: Record<string, unknown>,
  ) => protocol.saveMetaItem(req).then(() => null, (e: unknown) => e);

  const openHatch = (types: string) => {
    process.env.OS_METADATA_WRITABLE = types;
    resetEnvWritableMetadataTypes();
    ObjectStackProtocolImplementation.resetEnvWritableCache();
  };

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

  // ── the defect: one request, two kernels, two vocabularies ─────────────

  it('the two kernels agree on the code, the status and the lock source', async () => {
    // THE CARD. Compared to each other, not to a literal: the property is
    // "one condition keeps one vocabulary", so a future change that moved
    // BOTH would still be one vocabulary — while a change that moves one is
    // exactly the defect coming back.
    const hostConfig = await save(boot().protocol, {
      type: 'object', name: 'showcase_task', item: objectBody, packageId: READ_ONLY_PKG,
    }) as Record<string, unknown>;
    const scoped = await save(boot('env_alpha').protocol, {
      type: 'object', name: 'showcase_task', item: objectBody, packageId: READ_ONLY_PKG,
    }) as Record<string, unknown>;

    expect(scoped).toMatchObject({
      code: hostConfig.code, status: hostConfig.status, lockSource: hostConfig.lockSource,
    });
    expect(scoped).toMatchObject({
      code: 'ITEM_LOCKED', status: 403, lockSource: 'package', packageId: READ_ONLY_PKG,
    });
    // The SENTENCE too, and it is byte-identical because the two doors call
    // ONE emitter. `saveMetaItem` folds plural→singular at its top
    // (`canonicalizeMetaRequestType`) and the repository folds again, so
    // neither door can spell the type differently either. A copy in
    // `protocol.ts` would pass every assertion above this one and fail here.
    expect((scoped as { message?: string }).message)
      .toBe((hostConfig as { message?: string }).message);
  }, 30_000);

  it('a WRITABLE base still answers the type door — the door discriminates, it does not blanket-refuse', async () => {
    // The other half of "one PUT, two bases, two outcomes", on this kernel.
    // A suite that only pinned the new code would stay green if the scoped
    // branch started answering ITEM_LOCKED for every base.
    const err = await save(boot('env_alpha').protocol, {
      type: 'object', name: 'showcase_task', item: objectBody, packageId: WRITABLE_PKG,
    });
    expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
  }, 30_000);

  it('a write that names NO base keeps the type-door code verbatim', async () => {
    const err = await save(boot('env_alpha').protocol, {
      type: 'object', name: 'showcase_task', item: objectBody,
    });
    expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
  }, 30_000);

  it('nothing persists on the refusal', async () => {
    const { engine, protocol } = boot('env_alpha');
    await save(protocol, {
      type: 'object', name: 'showcase_task', item: objectBody, packageId: READ_ONLY_PKG,
    });
    expect(metaRowsOf(engine)).toEqual([]);
  }, 30_000);

  // ── the hatchOpen remedy selection, BOTH directions, on this kernel ────

  it('[ADR-0131 D6] the refusal never offers the hatch — hatch shut or open, the same sentence', async () => {
    // Was two pins: hatch CLOSED, the refusal offered `set OS_METADATA_WRITABLE`;
    // hatch OPEN, it said the hatch "does not apply here" and to retry
    // package-less. Both remedies are false under the seal (no package-less
    // write lands an overlay of a managed item), so the sentence no longer
    // depends on the hatch at all.
    const shut = await save(boot('env_alpha').protocol, {
      type: 'object', name: 'showcase_task', item: objectBody, packageId: READ_ONLY_PKG,
    }) as { code?: string; status?: number; message?: string };
    openHatch('object');
    const open = await save(boot('env_alpha').protocol, {
      type: 'object', name: 'showcase_task', item: objectBody, packageId: READ_ONLY_PKG,
    }) as { code?: string; status?: number; message?: string };

    for (const err of [shut, open]) {
      expect(err).toMatchObject({ code: 'ITEM_LOCKED', status: 403 });
      expect(String(err.message)).not.toMatch(/set OS_METADATA_WRITABLE/);
      expect(String(err.message)).toContain('OS_METADATA_WRITABLE does not open a managed item');
    }
    expect(open.message).toBe(shut.message);
  }, 30_000);

  // ── PRESERVATION: the load-bearing pins ───────────────────────────────

  it('an ADR-0005 overlay of a code-shipped item still lands — the door is BELOW every registry limb', async () => {
    // If the door had been placed one limb higher this goes red and the whole
    // overlay model closes. `view` is allowOrgOverride, artifact-backed, and
    // names the read-only package it customizes — by construction.
    const { engine, protocol } = boot('env_alpha');
    const err = await save(protocol, {
      type: 'view', name: 'case_grid', item: viewBody, packageId: READ_ONLY_PKG,
    });

    expect(err).toBeNull();
    expect(metaRowsOf(engine)[0]).toMatchObject({ package_id: READ_ONLY_PKG });
  }, 30_000);

  // [ADR-0131 D6] NARROW's three preservation pins, on this kernel, now on the
  // far side: managed content is sealed, so none of them lands a row.
  for (const [label, extra] of [
    ['a package-less hatch write', {}],
    ['a package-less hatch write under an ORG kernel', { organizationId: 'org_acme' }],
    ['a hatch write naming a WRITABLE base', { packageId: WRITABLE_PKG }],
  ] as const) {
    it(`[ADR-0131 D6] ${label} lands no overlay of a managed item: NOT_OVERRIDABLE / 403`, async () => {
      openHatch('permission');
      const { engine, protocol } = boot('env_alpha');
      const err = await save(protocol, {
        type: 'permission', name: 'showcase_contributor', item: permissionBody, ...extra,
      });

      expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
      expect(metaRowsOf(engine)).toEqual([]);
    }, 30_000);
  }
});

/**
 * [#8361] The CREATE side of the same shadowing — and the block that makes
 * #8146's create-side hatch clause reachable from the surface it was written
 * for.
 *
 * ## The defect, measured on `ffb090e6f7` before the fix
 *
 * #8146 gave BOTH package-door emitters a `hatchOpen` remedy selection. The
 * override one is reachable (the block above, and #8184 made it reachable on
 * scoped kernels too). The create one — `readOnlyBaseCreateError`, `422
 * WRITABLE_PACKAGE_REQUIRED` — was not reachable from `saveMetaItem` on ANY
 * topology: the ADR-0070 D1 gate throws first, on a strictly WIDER predicate
 * (no `namedBase` limb, no registry limbs above it), and D1 spelled its own
 * sentence with no hatch clause in it. Probed on the merged ref, hatch OPEN,
 * `permission/probe_reviewer` into `com.example.showcase`:
 *
 *     [writable_package_required] Cannot save permission/probe_reviewer: the
 *     package 'com.example.showcase' is read-only (provided by code or an
 *     installed app). Switch to a writable package in the package selector, or
 *     create a new one, and retry.
 *
 * — identical with the hatch open and with it shut. An operator who has just
 * set `OS_METADATA_WRITABLE` is told the base is read-only and never told that
 * the variable they set does not reach the package dimension. Milder than the
 * override side's false prescription (D1 never told them to set it), which is
 * why this was a finding rather than a bug: the missing half is guidance.
 *
 * ## THE SECONDARY DELIVERABLE — where that clause WAS live
 *
 * Enumerated on the merged ref, not restated from the card. `assertAllowed`
 * reaches `readOnlyBaseCreateError` only from `put`, with `intent:
 * 'runtime-only'` and a non-empty `packageId` (`assertDeleteAllowed` passes no
 * base, so the delete side can never reach it). The production `put` callers
 * carrying those two facts are:
 *
 *   • `saveMetaItem`                (`protocol.ts` — SHADOWED by D1: every
 *                                    write that would reach the door was
 *                                    already thrown by the wider gate)
 *   • `SysMetadataRepository.promoteDraft`      ← `publishMetaDraft`
 *   • `SysMetadataRepository.restoreVersion`    ← `revertCommit`
 *   • `SysMetadataRepository.restoreVersion`    ← `restoreMetaVersion`
 *
 * The last three pass the ROW's own binding, never a caller-named base, and
 * none of them passes through D1 — so the clause was exercised only by
 * republish/repair traffic and never by the authoring surface it was written
 * for. `LayeredRepository` is not a fourth route: nothing in the repo composes
 * a `SysMetadataRepository` into one outside a TSDoc example. That route is
 * pinned below (`the direct put callers keep their sentence verbatim`).
 *
 * ## The shape, and why it is delegation rather than a second clause
 *
 * D1 now CALLS `SysMetadataRepository.readOnlyBaseCreateError` — the lane's
 * one-emitter direction, the create-side mirror of #8184. The two reasons the
 * card gave for why that default might not apply were measured and did not
 * hold: the emitter is `static` (no repository instance needed, and the
 * override site has been calling a static sibling from this same method since
 * #8184), and both sites already carried the IDENTICAL `docs` pointer
 * (`0070-package-first-authoring.md`) because both implement D1. The one real
 * difference — D1's sentence names the item, the emitter's named only the type
 * — was closed by widening the emitter with an optional trailing `name`, so
 * the direct `put` callers' sentence stays byte-identical.
 *
 * ## ⛔ What this block is NOT
 *
 * Not a change to the acceptance set. D1's predicate is untouched; the cases
 * below pin both directions of that (a create into a writable base and a
 * package-less create still LAND; the read-only create is still REFUSED with
 * the same code and status). A shape that starts admitting or refusing
 * anything new has left the card.
 *
 * Read `the sentence is the repository's, not a copy of it` as the anti-fork
 * pin: it compares `saveMetaItem`'s message to the emitter's own output rather
 * than to a literal, so re-spelling the sentence at D1 goes red even if the
 * re-spelling is word-perfect on the day it is written.
 */
describe('#8361 — the create-side hatch clause reaches saveMetaItem', () => {
  /** Not artifact-backed under {@link boot}, so `saveMetaItem` intends `runtime-only`. */
  const runtimePermissionBody = { name: 'runtime_reviewer', label: 'Reviewer', objects: {} };
  /**
   * `job` is `allowOrgOverride: false` AND `allowRuntimeCreate: false`, so the
   * hatch is the ONLY thing that can carry this write as far as D1 — which is
   * what makes it the honest test of "the clause is reachable", as opposed to
   * `permission`, which reaches D1 either way. Spec-valid on purpose: the Zod
   * gate runs BEFORE D1, and a body missing `schedule`/`handler` answers
   * `INVALID_METADATA` / 422 — measured, while writing this block.
   */
  const jobBody = {
    name: 'nightly_sweep',
    label: 'Nightly Sweep',
    schedule: { type: 'interval', intervalMs: 60_000 },
    handler: 'nightlySweep',
  };

  /** @param environmentId `undefined` = host-config kernel; a string = per-env kernel. */
  function boot(environmentId?: string) {
    const engine = makeFakeEngine() as unknown as Record<string, unknown>;
    (engine as { registry: Record<string, unknown> }).registry = {
      ...(engine.registry as Record<string, unknown>),
      registerItem: () => {},
      registerObject: () => {},
      listItems: () => [],
      getItem: () => undefined,
      // Nothing is artifact-backed here: every case in this block is a CREATE.
      getArtifactItem: () => undefined,
    };
    const protocol = new ObjectStackProtocolImplementation(
      engine as never,
      () => new Map(),
      environmentId,
    ) as unknown as { saveMetaItem(req: Record<string, unknown>): Promise<unknown> };
    return { engine, protocol };
  }

  const metaRowsOf = (engine: Record<string, unknown>) =>
    Array.from((engine as unknown as { rows: Map<string, Row> }).rows.values())
      .filter((r) => r.__table === 'sys_metadata');

  const save = (
    protocol: { saveMetaItem(req: Record<string, unknown>): Promise<unknown> },
    req: Record<string, unknown>,
  ) => protocol.saveMetaItem(req).then(() => null, (e: unknown) => e);

  const openHatch = (types: string) => {
    process.env.OS_METADATA_WRITABLE = types;
    resetEnvWritableMetadataTypes();
    ObjectStackProtocolImplementation.resetEnvWritableCache();
  };

  /** The runtime-only create the whole block is about, varying only the base. */
  const createPermission = (
    protocol: { saveMetaItem(req: Record<string, unknown>): Promise<unknown> },
    packageId?: string,
  ) => save(protocol, {
    type: 'permission', name: 'runtime_reviewer', item: runtimePermissionBody,
    ...(packageId !== undefined ? { packageId } : {}),
  });

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

  // ── the card: the clause is reachable, and only when it is TRUE ────────

  it('with the hatch OPEN the refusal says the hatch does not reach the package dimension', async () => {
    openHatch('permission');
    const { engine, protocol } = boot();
    const err = await createPermission(protocol, READ_ONLY_PKG) as {
      code?: string; status?: number; packageId?: string; docs?: string; message?: string;
    };

    // The ADR-0112 envelope first — a message-only assertion cannot tell this
    // refusal from the code-only one two limbs above it.
    expect(err).toMatchObject({
      code: 'WRITABLE_PACKAGE_REQUIRED',
      status: 422,
      packageId: READ_ONLY_PKG,
      docs: 'docs/adr/0070-package-first-authoring.md',
    });
    // …then the sentence this card exists for.
    const message = String(err.message);
    expect(message).toContain("OS_METADATA_WRITABLE is set for 'permission'");
    expect(message).toContain('it unlocks the metadata TYPE, not package writability');
    // Refused, not reported: the diagnostic change persists nothing.
    expect(metaRowsOf(engine)).toEqual([]);
  }, 30_000);

  it('with the hatch CLOSED the same request does NOT mention it — the clause is selected, not appended', async () => {
    // THE OVER-BROAD DIRECTION. A shape that emitted the repository sentence
    // unconditionally passes every case above and fails here: with the hatch
    // shut the clause is noise, and worse, it names a variable the operator
    // never set. `permission` is `allowRuntimeCreate: true`, so this request
    // reaches D1 with the hatch shut — the same door, one variable different.
    const { engine, protocol } = boot();
    const err = await createPermission(protocol, READ_ONLY_PKG) as {
      code?: string; status?: number; message?: string;
    };

    expect(err).toMatchObject({ code: 'WRITABLE_PACKAGE_REQUIRED', status: 422 });
    const message = String(err.message);
    expect(message).not.toContain('OS_METADATA_WRITABLE');
    // …and the remedy that IS true here survives the selection.
    expect(message).toContain('Switch to a writable package in the package selector');
    expect(metaRowsOf(engine)).toEqual([]);
  }, 30_000);

  it('the item is still named — delegation costs the authoring surface no information', async () => {
    // D1's own sentence said `Cannot save permission/runtime_reviewer`. The
    // emitter's said only the type, because its `put` callers have no name at
    // that seam. Delegating without this would have made the toast vaguer.
    const { protocol } = boot();
    const err = await createPermission(protocol, READ_ONLY_PKG) as { message?: string };
    expect(String(err.message)).toContain('permission/runtime_reviewer');
  }, 30_000);

  it('the sentence is the repository\'s, not a copy of it', async () => {
    // THE ANTI-FORK PIN. Compared against the emitter's OWN output rather than
    // a literal: a re-spelling at D1 that is word-perfect on the day it lands
    // still goes red here, which is the property "one condition, one emitter"
    // actually needs. Both remedy directions, because the selection is what a
    // copy would most easily get wrong.
    const { protocol } = boot();

    const shut = await createPermission(protocol, READ_ONLY_PKG) as { message?: string };
    expect(shut.message).toBe(
      SysMetadataRepository
        .readOnlyBaseCreateError('permission', READ_ONLY_PKG, false, 'runtime_reviewer')
        .message,
    );

    openHatch('permission');
    const open = await createPermission(protocol, READ_ONLY_PKG) as { message?: string };
    expect(open.message).toBe(
      SysMetadataRepository
        .readOnlyBaseCreateError('permission', READ_ONLY_PKG, true, 'runtime_reviewer')
        .message,
    );
    expect(open.message).not.toBe(shut.message);
  }, 30_000);

  // ── the hatch really is what carries the write to D1 ───────────────────

  it('a type with NO create channel reaches D1 only through the hatch', async () => {
    // Both halves in one case, because either alone is ambiguous. `job` has
    // neither `allowOrgOverride` nor `allowRuntimeCreate`: shut, the code-only
    // refusal answers first and D1 is never consulted (so a hatch clause there
    // would be unreachable for this type); open, `isOverlayAllowed` folds the
    // hatch in and the write lands on D1 — carrying the clause.
    const shutBoot = boot();
    const shut = await save(shutBoot.protocol, {
      type: 'job', name: 'nightly_sweep', item: jobBody, packageId: READ_ONLY_PKG,
    }) as { code?: string; status?: number };
    expect(shut).toMatchObject({ code: 'NOT_CREATABLE', status: 403 });

    openHatch('job');
    const openBoot = boot();
    const open = await save(openBoot.protocol, {
      type: 'job', name: 'nightly_sweep', item: jobBody, packageId: READ_ONLY_PKG,
    }) as { code?: string; status?: number; message?: string };
    expect(open).toMatchObject({ code: 'WRITABLE_PACKAGE_REQUIRED', status: 422 });
    expect(String(open.message)).toContain("OS_METADATA_WRITABLE is set for 'job'");
  }, 30_000);

  // ── ⛔ the acceptance set does not move ────────────────────────────────

  it('a runtime-only create into a WRITABLE base still lands, hatch open or shut', async () => {
    // THE SCOPE PIN. This card changes what the operator is TOLD; if it ever
    // starts changing what is refused, it has left its own scope. Membership,
    // never a row count: a guard upstream that stabilised the count would make
    // a length assertion green with this change absent.
    const shutBoot = boot();
    expect(await createPermission(shutBoot.protocol, WRITABLE_PKG)).toBeNull();
    expect(metaRowsOf(shutBoot.engine)).toContainEqual(
      expect.objectContaining({ name: 'runtime_reviewer', package_id: WRITABLE_PKG }),
    );

    openHatch('permission');
    const openBoot = boot();
    expect(await createPermission(openBoot.protocol, WRITABLE_PKG)).toBeNull();
    expect(metaRowsOf(openBoot.engine)).toContainEqual(
      expect.objectContaining({ name: 'runtime_reviewer', package_id: WRITABLE_PKG }),
    );
  }, 30_000);

  it('a package-less runtime-only create still lands, bound to NO package', async () => {
    // The other admitted direction: D1's `packageId != null` limb is untouched.
    openHatch('permission');
    const { engine, protocol } = boot();
    expect(await createPermission(protocol)).toBeNull();
    expect(metaRowsOf(engine)).toContainEqual(
      expect.objectContaining({ name: 'runtime_reviewer', package_id: null }),
    );
  }, 30_000);

  // ── topology, and the callers that never pass through D1 ───────────────

  it('both kernels answer the same thing — D1 sits below the environmentId branch', async () => {
    // Compared to each other, not to a literal, for the reason #8184's block
    // states: the property is "one condition keeps one vocabulary", and only a
    // comparison can tell a shared move from a divergence.
    openHatch('permission');
    const hostConfig = await createPermission(boot().protocol, READ_ONLY_PKG) as {
      code?: string; status?: number; message?: string;
    };
    const scoped = await createPermission(boot('env_alpha').protocol, READ_ONLY_PKG) as {
      code?: string; status?: number; message?: string;
    };

    expect(scoped.code).toBe(hostConfig.code);
    expect(scoped.status).toBe(hostConfig.status);
    expect(scoped.message).toBe(hostConfig.message);
    expect(String(scoped.message)).toContain("OS_METADATA_WRITABLE is set for 'permission'");
  }, 30_000);

  it('the direct put callers keep their sentence verbatim — the widening is opt-in', async () => {
    // `promoteDraft` / `restoreVersion` / `revertCommit` reach the emitter with
    // the row's own binding and no item name. Their sentence is what #8146
    // shipped and must not have moved: `name` is optional and last precisely so
    // this stays byte-identical.
    const engine = makeFakeEngine();
    const repo = new SysMetadataRepository({
      engine: engine as never, organizationId: null, orgLabel: 'env',
    });
    const err = await putWith(repo, {
      type: 'job', name: 'nightly_sweep', intent: 'runtime-only', packageId: READ_ONLY_PKG,
    }) as { message?: string };

    expect(err.message).toBe(
      SysMetadataRepository.readOnlyBaseCreateError('job', READ_ONLY_PKG, false).message,
    );
    // The name-less spelling, verbatim: no `job/nightly_sweep` at this seam.
    expect(String(err.message)).toContain(`Cannot create job in package '${READ_ONLY_PKG}'`);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// [#20910, ADR-0126 §2] The repository's two refusals onto a packaged base —
// the TYPE door and the named-base `ITEM_LOCKED` limb — speak for the type's
// regime row, with the hatch closed, exactly as the protocol's package door
// does. Every type with no regime row keeps its sentence byte for byte.
// ---------------------------------------------------------------------------

describe('[#20910] the repository doors name a Regime C type\'s sanctioned path, from the one regime table', () => {
  const ADR_0126 = 'See docs/adr/0126-packaged-metadata-customization-model.md.';
  const ACTION_SWITCH = 'Switch it off (POST /api/v1/actions/_activation/:object/:action, body {enabled: false}, '
    + ':object = global for an object-less action; operator-only where one install serves several organizations).';
  const PERMISSION_CLONE = 'Clone it under a new name to customize it (the "Clone" action on the permission set, '
    + 'or POST /api/v1/data/sys_permission_set with a new name).';
  const FLOW_PATHS = 'Clone it under a new name to customize it (POST /api/v1/automation/:name/clone, body {name, label}), '
    + 'or switch it off (POST /api/v1/automation/:name/toggle, body {enabled: false}; '
    + 'operator-only where one install serves several organizations).';
  /** Each Regime C row's prescription, spelled out — never read back from the table under test. */
  const PATHS: ReadonlyArray<readonly [MetaRef['type'], string]> = [
    ['flow', FLOW_PATHS], ['action', ACTION_SWITCH], ['permission', PERMISSION_CLONE],
  ];

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

  // ── the type door (a package-less write, hatch closed) ────────────────

  for (const [type, paths] of PATHS) {
    it(`type door, save: a packaged ${type} is refused NOT_OVERRIDABLE with its row's path, no hatch`, async () => {
      const err = await putWith(repo, { type, name: `pkg_${type}`, intent: 'override-artifact' }) as any;
      expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
      expect(String(err.message)).toBe(
        `Metadata item '${type}/pkg_${type}' is provided by a managed package and is sealed `
        + `against in-place edits. ${paths} ${ADR_0126}`,
      );
      expect(Array.from(engine.rows.values())).toEqual([]);
    });
  }

  for (const [type, paths] of PATHS.filter(([t]) => t !== 'permission')) {
    // `permission` merges its overlay at read (`supportsOverlay`), so its
    // removal is the #6960 carve-out and never reaches this door.
    it(`type door, delete: a packaged ${type}'s removal is refused with its row's path too`, async () => {
      const err = await repo
        .delete({ org: 'env', type, name: `pkg_${type}` }, { parentVersion: 'sha256:whatever', actor: null, intent: 'override-artifact' })
        .then(() => null, (e: unknown) => e) as any;
      expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
      expect(String(err.message)).toBe(
        `Metadata item '${type}/pkg_${type}' is provided by a managed package and is sealed `
        + `against removal. ${paths} ${ADR_0126}`,
      );
    });
  }

  it('[ADR-0131 D6] type door, control: a type with no regime row reads the managed seal — the protocol\'s own sentence', async () => {
    // Was the overlay-allowed list and "Set OS_METADATA_WRITABLE to enable
    // additional types at runtime", byte for byte. That prescription is false
    // for an `override-artifact` write now, so this door throws the ONE
    // sentence the protocol's package door throws for the same item.
    const err = await putWith(repo, { type: 'object', name: 'showcase_task', intent: 'override-artifact' }) as any;
    expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    expect(String(err.message)).toBe(
      "Metadata item 'object/showcase_task' is provided by a managed package and is sealed against in-place edits: "
      + 'its type takes no environment overlay (allowOrgOverride=false), and OS_METADATA_WRITABLE does not open '
      + 'a managed item. Edit the source artifact and redeploy. '
      + 'See docs/adr/0131-total-organization-ownership-no-null-organization-id.md.',
    );
  });

  it('[ADR-0131 D6] type door: the hatch no longer opens a Regime C type — the seal, with the row\'s path', async () => {
    // Was `the hatch still opens a Regime C type exactly as before (NARROW
    // untouched)`: the write landed a package-less row. Now refused with the
    // same sentence the shut hatch gets, nothing persisted.
    const shut = await putWith(repo, { type: 'action', name: 'pkg_action', intent: 'override-artifact' }) as any;
    process.env.OS_METADATA_WRITABLE = 'action';
    resetEnvWritableMetadataTypes();
    const open = await putWith(repo, { type: 'action', name: 'pkg_action', intent: 'override-artifact' }) as any;
    expect(open).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    expect(open.message).toBe(shut.message);
    expect(Array.from(engine.rows.values()).filter((r) => r.__table === 'sys_metadata')).toEqual([]);
  });

  it('[ADR-0131 D6] type door, delete: the hatch no longer opens the removal of a managed flow', async () => {
    process.env.OS_METADATA_WRITABLE = 'flow';
    resetEnvWritableMetadataTypes();
    const err = await repo
      .delete({ org: 'env', type: 'flow', name: 'pkg_flow' }, { parentVersion: 'sha256:whatever', actor: null, intent: 'override-artifact' })
      .then(() => null, (e: unknown) => e) as any;
    expect(err).toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    expect(String(err.message)).toBe(
      "Metadata item 'flow/pkg_flow' is provided by a managed package and is sealed "
      + `against removal. ${FLOW_PATHS} ${ADR_0126}`,
    );
  });

  // ── the named-base ITEM_LOCKED limb (a read-only base named, hatch closed) ──

  for (const [type, paths] of PATHS) {
    it(`named base, hatch CLOSED: a ${type} answers ITEM_LOCKED with its row's path, envelope unchanged`, async () => {
      const err = await putWith(repo, { type, name: `pkg_${type}`, intent: 'override-artifact', packageId: READ_ONLY_PKG }) as any;
      expect(err).toMatchObject({
        code: 'ITEM_LOCKED', status: 403, lockSource: 'package', packageId: READ_ONLY_PKG,
        docs: 'docs/adr/0010-metadata-protection-model.md',
      });
      expect(String(err.message)).toBe(
        `Cannot overlay '${type}' in package '${READ_ONLY_PKG}': that package is read-only, and its packaged base `
        + `is locked against in-place edits. ${paths} ${ADR_0126}`,
      );
    });
  }

  it('[ADR-0131 D6] named base, hatch OPEN: a Regime C type is told its row\'s path, as with the hatch closed', async () => {
    // Was `keeps the hatch-open remedy byte for byte` ("retry without
    // ?package= to land the overlay the hatch grants") — false under the seal.
    process.env.OS_METADATA_WRITABLE = 'flow';
    resetEnvWritableMetadataTypes();
    const err = await putWith(repo, { type: 'flow', name: 'pkg_flow', intent: 'override-artifact', packageId: READ_ONLY_PKG }) as any;
    expect(err).toMatchObject({ code: 'ITEM_LOCKED', status: 403, lockSource: 'package', packageId: READ_ONLY_PKG });
    expect(String(err.message)).toBe(
      `Cannot overlay 'flow' in package '${READ_ONLY_PKG}': that package is read-only, and its packaged base `
      + `is locked against in-place edits. ${FLOW_PATHS} ${ADR_0126}`,
    );
  });

  it('every Regime C row arrives whole through the REST door\'s 500-character bound with a long package id', () => {
    // `truncateClientMessage` (packages/rest/src/error-response.ts) keeps a
    // message only while it is SHORTER than 500 characters. 64 characters is
    // longer than any package id this repository ships (the longest,
    // `com.objectstack.platform-objects.activation-ledger`, is 50).
    const longPkg = `com.example.${'x'.repeat(52)}`;
    expect(longPkg).toHaveLength(64);
    for (const [type] of PATHS) {
      const message = String(SysMetadataRepository.readOnlyBaseOverrideError(type, longPkg).message);
      expect(message.length, type).toBeLessThan(500);
      expect(message.endsWith(ADR_0126), type).toBe(true);
    }
  });
});
