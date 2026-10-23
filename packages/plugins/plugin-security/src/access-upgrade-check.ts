// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The access-class upgrade check at the marketplace door (ADR-0126 §6 wall 3:
 * no upgrade un-makes a customer's choice) — the pre-write half of
 * `access-upgrade-report.ts`.
 *
 * ## What it answers
 *
 * "If package P were replaced by this incoming manifest, which access-class
 * findings would the upgrade CREATE?" It runs the boot report's comparison
 * ({@link collectAccessUpgradeFindings}) unchanged, twice, and restates none
 * of its rules:
 *
 * 1. over the registry as it stands;
 * 2. over a PROJECTION of that registry in which P's items are the incoming
 *    manifest's: the security catalog (permission sets, positions,
 *    capabilities), the declared sharing rules, and P's objects and fields.
 *
 * The customer's state — the activation ledger and the `sys_sharing_rule`
 * rows — is read through the engine as it stands in both runs: it is what an
 * upgrade must not un-make, so it is never projected.
 *
 * The answer is the DELTA: what run 2 finds that run 1 does not. A finding
 * that predates this upgrade, or that another package caused, is the boot
 * report's to raise; refusing on it would block every re-install of every
 * package until it was cleared.
 *
 * ## The projection
 *
 * - **Catalog**: an entry whose `packageId` is P is dropped; the incoming
 *   `permissions`, `positions` and `capabilities` are entries with
 *   `packageId: P`.
 * - **Declared sharing rules**: the same, from the incoming `sharingRules`.
 * - **Objects**: an object the incoming manifest declares answers the
 *   registry's field set (which carries the fields the registry injects) less
 *   the fields P's previous version declared, plus the incoming declaration's.
 *   An object P's previous version declared and the incoming one does not
 *   answers "absent". "P's previous version" is the manifest the caller hands
 *   in (the door's ledger entry) or, without one, the registry's own record of
 *   the package.
 *
 * ## What it does not do
 *
 * It writes nothing and refuses nothing: the door decides. A read that did not
 * happen is `stopped`, never "no finding".
 */

import { createSecurityCatalogReader, type SecurityCatalogEntry, type SecurityCatalogReader } from '@objectstack/core';
import {
  accessUpgradeDedupKey,
  collectAccessUpgradeFindings,
  hasAccessUpgradeFindings,
  type AccessUpgradeReport,
  type AccessUpgradeReportEngine,
  type AccessUpgradeReportStop,
  type DeclaredRuleLike,
  type DeclaredSharingRuleReader,
} from './access-upgrade-report.js';

/** The service name the check is registered under. */
export const ACCESS_UPGRADE_CHECK_SERVICE = 'security.accessUpgradeCheck';

/** What the door hands the check. */
export interface AccessUpgradeCheckRequest {
  /** The package being replaced — the manifest id, the registry's `_packageId`. */
  packageId: string;
  /** The incoming package body, flat and converted forward (what the door registers). */
  manifest: unknown;
  /** P's previous body, when the door holds it (its ledger entry). */
  previousManifest?: unknown;
}

export type AccessUpgradeCheckResult =
  | { outcome: 'clean' }
  /** `findings` holds only what this upgrade would create; `findingSet` is its digest. */
  | { outcome: 'findings'; findings: AccessUpgradeReport; findingSet: string }
  | { outcome: 'stopped'; stop: AccessUpgradeReportStop | 'unbound'; reading: string; error?: string };

/** The service the door reaches. */
export interface AccessUpgradeCheck {
  check(request: AccessUpgradeCheckRequest): Promise<AccessUpgradeCheckResult>;
}

/** The engine surface the check reads: the report's, plus the registry the catalog is read from. */
export interface AccessUpgradeCheckEngine extends AccessUpgradeReportEngine {
  registry?: unknown;
}

/** Where the check finds what it reads, resolved at every call: the boot fills them after registration. */
export interface AccessUpgradeCheckSources {
  engine(): AccessUpgradeCheckEngine | undefined;
  metadata(): unknown;
  sharingRules(): DeclaredSharingRuleReader | undefined;
}

type Definition = Record<string, unknown>;

function isRecord(value: unknown): value is Definition {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function named(items: unknown): Definition[] {
  if (!Array.isArray(items)) return [];
  return items.filter((i): i is Definition => isRecord(i) && typeof i.name === 'string' && i.name !== '');
}

/** The objects a body declares: name → declared field names. */
function declaredObjects(body: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!isRecord(body)) return out;
  for (const object of named(body.objects)) {
    out.set(object.name as string, new Set(isRecord(object.fields) ? Object.keys(object.fields) : []));
  }
  return out;
}

const CATALOG_KEYS = { permission: 'permissions', position: 'positions', capability: 'capabilities' } as const;

function incomingEntries(body: unknown, type: keyof typeof CATALOG_KEYS, packageId: string): SecurityCatalogEntry[] {
  if (!isRecord(body)) return [];
  return named(body[CATALOG_KEYS[type]]).map((definition) => ({
    type,
    name: definition.name as string,
    definition: { ...definition, _packageId: packageId },
    source: 'registry' as const,
    packageId,
  }));
}

/** The catalog with P's entries replaced by the incoming manifest's. */
function projectCatalog(base: SecurityCatalogReader, body: unknown, packageId: string): SecurityCatalogReader {
  return {
    async list(type) {
      const incoming = incomingEntries(body, type, packageId);
      const names = new Set(incoming.map((e) => e.name));
      const kept = (await base.list(type)).filter((e) => e.packageId !== packageId && !names.has(e.name));
      return [...kept, ...incoming];
    },
    async resolve(type, name) {
      const incoming = incomingEntries(body, type, packageId).find((e) => e.name === name);
      if (incoming) return incoming;
      const held = await base.resolve(type, name);
      return held && held.packageId === packageId ? undefined : held;
    },
  };
}

/** The declared sharing rules with P's replaced; `null` (no declarations read) stays `null`. */
function projectSharingRules(base: DeclaredSharingRuleReader, body: unknown, packageId: string): DeclaredSharingRuleReader {
  return {
    async listDeclaredRules() {
      const held = await base.listDeclaredRules();
      if (held === null) return null;
      const incoming: DeclaredRuleLike[] = isRecord(body)
        ? named(body.sharingRules).map((r) => ({
          name: r.name as string,
          ...(typeof r.object === 'string' ? { object: r.object } : {}),
          packageId,
        }))
        : [];
      const names = new Set(incoming.map((r) => r.name));
      return [...held.filter((r) => r.packageId !== packageId && !names.has(r.name)), ...incoming];
    },
  };
}

/** The engine with P's objects and fields replaced; `find` (the customer's state) passes through. */
function projectEngine(base: AccessUpgradeReportEngine, body: unknown, previous: unknown): AccessUpgradeReportEngine {
  const incoming = declaredObjects(body);
  const before = declaredObjects(previous);
  return {
    find: (object, options) => base.find(object, options),
    getObject(name) {
      const declared = incoming.get(name);
      if (!declared) return before.has(name) ? undefined : base.getObject(name);
      const held = base.getObject(name) as { fields?: unknown } | undefined | null;
      const fields: Definition = {};
      if (held && isRecord(held.fields)) {
        const dropped = before.get(name) ?? new Set<string>();
        for (const field of Object.keys(held.fields)) if (!dropped.has(field)) fields[field] = held.fields[field];
      }
      for (const field of declared) fields[field] = true;
      return { ...(isRecord(held) ? held : {}), name, fields };
    },
  };
}

const key = (value: unknown): string => JSON.stringify(value);

/**
 * What `after` finds that `before` does not. A finding that only GREW — a new
 * re-enablement candidate, a new missing name in an item that already had
 * one, a new uncovered field — is kept with its new parts only.
 */
export function accessUpgradeDelta(before: AccessUpgradeReport, after: AccessUpgradeReport): AccessUpgradeReport {
  const orphans = new Set(before.orphans.map(key));
  const collisions = new Set(before.collisions.map(key));
  const candidates = new Map(before.reEnablements.map((r) => [key([r.type, r.name]), new Set(r.candidates.map(key))]));
  const missing = new Map(before.brokenReferences.map((b) => [key([b.type, b.name, b.rowId ?? null]), new Set(b.missing.map(key))]));
  const denies = new Map(before.uncoveredDenies.map((u) => [key([u.managedSet, u.customerSet, u.object]), new Set(u.fields.map(key))]));
  const report: AccessUpgradeReport = {
    orphans: after.orphans.filter((o) => !orphans.has(key(o))),
    reEnablements: [],
    collisions: after.collisions.filter((c) => !collisions.has(key(c))),
    brokenReferences: [],
    uncoveredDenies: [],
    absent: after.absent,
  };
  for (const r of after.reEnablements) {
    const had = candidates.get(key([r.type, r.name])) ?? new Set<string>();
    const fresh = r.candidates.filter((c) => !had.has(key(c)));
    if (fresh.length > 0) report.reEnablements.push({ ...r, candidates: fresh });
  }
  for (const b of after.brokenReferences) {
    const had = missing.get(key([b.type, b.name, b.rowId ?? null])) ?? new Set<string>();
    const fresh = b.missing.filter((m) => !had.has(key(m)));
    if (fresh.length > 0) report.brokenReferences.push({ ...b, missing: fresh });
  }
  for (const u of after.uncoveredDenies) {
    const had = denies.get(key([u.managedSet, u.customerSet, u.object])) ?? new Set<string>();
    const fresh = u.fields.filter((f) => !had.has(key(f)));
    if (fresh.length > 0) report.uncoveredDenies.push({ ...u, fields: fresh });
  }
  return report;
}

/** The registry's own record of a package's manifest, when it keeps one. */
function registeredManifest(engine: AccessUpgradeCheckEngine, packageId: string): unknown {
  const registry = engine.registry as { getPackage?: (id: string) => { manifest?: unknown } | undefined } | undefined;
  return typeof registry?.getPackage === 'function' ? registry.getPackage(packageId)?.manifest : undefined;
}

const stoppedBy = (report: AccessUpgradeReport): AccessUpgradeCheckResult => ({
  outcome: 'stopped',
  stop: report.stopped as AccessUpgradeReportStop,
  reading: report.stoppedReading ?? 'a store the comparison reads',
  ...(report.stoppedError !== undefined ? { error: report.stoppedError } : {}),
});

/** Build the check over sources resolved at every call. */
export function createAccessUpgradeCheck(sources: AccessUpgradeCheckSources): AccessUpgradeCheck {
  return {
    async check(request) {
      const engine = sources.engine();
      const metadata = sources.metadata();
      if (!engine?.registry || !metadata) {
        return {
          outcome: 'stopped',
          stop: 'unbound',
          reading: "the security plugin's data engine and metadata service, which are not bound yet",
        };
      }
      let catalog: SecurityCatalogReader;
      try {
        catalog = createSecurityCatalogReader({ registry: engine.registry as never, metadata: metadata as never });
      } catch (e) {
        return { outcome: 'stopped', stop: 'catalog-unreadable', reading: 'the security catalog', error: (e as Error)?.message };
      }
      const sharingRules = sources.sharingRules();
      const before = await collectAccessUpgradeFindings(engine, { catalog, sharingRules });
      if (before.stopped) return stoppedBy(before);
      const previous = request.previousManifest ?? registeredManifest(engine, request.packageId);
      const after = await collectAccessUpgradeFindings(projectEngine(engine, request.manifest, previous), {
        catalog: projectCatalog(catalog, request.manifest, request.packageId),
        sharingRules: sharingRules ? projectSharingRules(sharingRules, request.manifest, request.packageId) : undefined,
      });
      if (after.stopped) return stoppedBy(after);
      const delta = accessUpgradeDelta(before, after);
      if (!hasAccessUpgradeFindings(delta)) return { outcome: 'clean' };
      return { outcome: 'findings', findings: delta, findingSet: accessUpgradeDedupKey(delta) };
    },
  };
}
