// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The loader of the governed `knowledge_source` type (ADR-0161 K4, clause 3:
 * the type lands with its reader).
 *
 * ## What it does
 *
 * One pass ({@link KnowledgeSourceLoader.reconcile}) reads the published
 * `knowledge_source` items and makes the knowledge service's metadata-door
 * sources agree with them:
 *
 * - **an added item** is registered. At boot the service's first-build pass
 *   then reads its index and builds it when due; while the process runs, the
 *   loader asks for that itself (`buildReloadedSource`);
 * - **a changed item** is registered again in its own slot — a reload of its
 *   earlier version, never a second arrival — and its fingerprint and recipe
 *   hash are read again, so a changed `content`, `where`, `metadataFields` or
 *   `split` starts the one rebuild ADR-0161 K7 gives it. An item that did not
 *   change is left alone: nothing is registered, read or built;
 * - **a removed item** is unregistered and its index dropped
 *   (`IKnowledgeAdapter.dropSource`, K8 item 4).
 *
 * Boot and a source reload are the only two moments a rebuild starts (K7).
 *
 * ## Which rows are sources
 *
 * - A row bound to a package is that package's source: one slot per
 *   `(package, name)`, so two packages may each ship a source of one name
 *   (ADR-0150, addendum of 2026-11-25).
 * - A row bound to no package, under a name no package holds, is the
 *   environment's own source.
 * - A row bound to no package under a name a package holds is NOT served
 *   (ADR-0150 D4: "A package-less row that bears a package-held name is a
 *   customization, never a second item", and the type takes no overlay). If
 *   it was a source before the package arrived, it stops being one: it is
 *   unregistered, its index is dropped, and one `warn` names the row, the
 *   package that now holds the name and the remedy. An index of no source is
 *   a copy nobody governs, so it does not stay. Remove the package and the
 *   row is served again, and built as a source its adapter holds nothing for.
 * - A row that does not parse with `KnowledgeSourceSchema` is no source,
 *   reported once at `warn` with the schema's own prescription.
 * - A package-less row under a name the code door registered is refused by
 *   the registry (one name, one source), reported once at `warn` naming both
 *   doors.
 *
 * ## Fail direction
 *
 * A listing that cannot be read changes nothing: no source is unregistered
 * and no index dropped on a failed read. Passes run one after another, and a
 * pass asked for while one is queued is answered by that one.
 */

import type { KnowledgeSource } from '@objectstack/spec/ai';
import type { KnowledgeLogger, KnowledgeService } from './knowledge-service.js';
import { indexKeyOf, packageIdOfItem, parseKnowledgeSource } from './knowledge-source-registry.js';

/** What the loader reads and calls. */
export interface KnowledgeSourceLoaderDeps {
  service: Pick<
    KnowledgeService,
    'registerMetadataSource' | 'dropMetadataSource' | 'metadataSources' | 'buildReloadedSource'
  >;
  /**
   * The published `knowledge_source` items, each as its stored body with the
   * row's protection envelope (`_packageId`) and without read decorations.
   * `null` when the listing could not be read: the pass then changes nothing.
   */
  readItems(): Promise<unknown[] | null>;
  /** The manifest namespace of a package, or `undefined` when the host cannot place it. */
  namespaceOf(packageId: string): string | undefined;
  logger?: KnowledgeLogger;
  /**
   * Whether a source added or changed while the process runs is built when a
   * build is due (`KnowledgeServicePluginOptions.buildAtBoot`). `false` leaves
   * it to the operator's rebuild.
   */
  buildOnReload: boolean;
}

/** When a pass runs: the boot's load, or a change while the process runs. */
export type KnowledgeSourceLoadReason = 'boot' | 'reload';

/** What one pass did, for its caller's log line and for tests. */
export interface KnowledgeSourceLoadResult {
  /** `false` when the listing could not be read and nothing was changed. */
  read: boolean;
  /** Faces of the sources registered for the first time. */
  added: string[];
  /** Faces of the sources registered again because their item changed. */
  changed: string[];
  /** Faces of the sources unregistered, their index dropped. */
  removed: string[];
}

export class KnowledgeSourceLoader {
  /** Per index key, the item as last registered: what "changed" is judged against. */
  private readonly registered = new Map<string, string>();
  /** Refusals and unserved rows already reported, so each is said once until it changes. */
  private readonly reported = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private pending: Promise<KnowledgeSourceLoadResult> | undefined;

  constructor(private readonly deps: KnowledgeSourceLoaderDeps) {}

  /**
   * Run one pass, after any pass already running. A pass asked for while one
   * is waiting to start is answered by that one: it has not read yet, so it
   * sees whatever the second caller's change was.
   */
  reconcile(reason: KnowledgeSourceLoadReason): Promise<KnowledgeSourceLoadResult> {
    if (reason === 'reload' && this.pending) return this.pending;
    const run = this.queue.then(() => {
      if (this.pending === run) this.pending = undefined;
      return this.pass(reason);
    });
    if (reason === 'reload') this.pending = run;
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async pass(reason: KnowledgeSourceLoadReason): Promise<KnowledgeSourceLoadResult> {
    const { service, logger } = this.deps;
    const result: KnowledgeSourceLoadResult = { read: false, added: [], changed: [], removed: [] };
    const rows = await this.deps.readItems();
    if (rows === null) return result;
    result.read = true;

    const stillReported = new Set<string>();
    const reportOnce = (signature: string, line: string): void => {
      stillReported.add(signature);
      if (this.reported.has(signature)) return;
      this.reported.add(signature);
      logger?.warn?.(line);
    };

    // Parse every row; note which names a package holds.
    const parsed: Array<{ source: KnowledgeSource; packageId?: string }> = [];
    const packageHolders = new Map<string, string[]>();
    for (const row of rows) {
      const outcome = parseKnowledgeSource(row);
      if (!outcome.ok) {
        const name = rowName(row);
        reportOnce(
          `unparsed\u0000${name}\u0000${outcome.message}`,
          `[knowledge] the knowledge_source item ${name} is not a valid source and is not served: ${outcome.message}`,
        );
        continue;
      }
      const packageId = packageIdOfItem(outcome.source);
      parsed.push(packageId === undefined ? { source: outcome.source } : { source: outcome.source, packageId });
      if (packageId !== undefined) {
        const holders = packageHolders.get(outcome.source.name) ?? [];
        holders.push(packageId);
        packageHolders.set(outcome.source.name, holders);
      }
    }

    // The slots the listing fills. A package-less row under a package-held
    // name fills none (ADR-0150 D4).
    const desired = new Map<string, { source: KnowledgeSource; packageId?: string }>();
    const unserved = new Map<string, string[]>();
    for (const item of parsed) {
      const holders = packageHolders.get(item.source.name);
      if (item.packageId === undefined && holders !== undefined) {
        unserved.set(item.source.name, holders);
        continue;
      }
      const key = indexKeyOf(item.packageId, item.source.name);
      if (desired.has(key)) {
        reportOnce(
          `twice\u0000${key}`,
          `[knowledge] the listing holds knowledge source '${item.source.name}' twice for ` +
            `${item.packageId === undefined ? 'the environment' : `package "${item.packageId}"`}; the first is served.`,
        );
        continue;
      }
      desired.set(key, item);
    }

    // Removed items, and rows that stopped being served: unregister and drop.
    for (const entry of service.metadataSources()) {
      if (desired.has(entry.key)) continue;
      await service.dropMetadataSource(entry.key);
      this.registered.delete(entry.key);
      result.removed.push(entry.face);
    }
    for (const [name, holders] of unserved) {
      const by = holders.map((id) => `"${id}"`).join(', ');
      reportOnce(
        `unserved\u0000${name}\u0000${holders.join('\u0000')}`,
        `[knowledge] the knowledge source '${name}' authored in this environment is not served: package ${by} ` +
          `${holders.length === 1 ? 'holds' : 'hold'} the name, and a package-less item under a package-held name is ` +
          'not a second source (ADR-0150 D4). It is not searched, and any index it had was dropped. Rename the ' +
          "environment's source, or remove the package's.",
      );
    }

    // Added and changed items.
    const reloaded: string[] = [];
    for (const [key, item] of desired) {
      const namespace = item.packageId === undefined ? undefined : this.namespaceOf(item.packageId);
      const signature = stableJson({ source: item.source, namespace: namespace ?? null });
      const before = this.registered.get(key);
      if (before === signature) continue;
      try {
        const entry = service.registerMetadataSource(item.source, {
          ...(item.packageId === undefined ? {} : { packageId: item.packageId }),
          ...(namespace === undefined ? {} : { namespace }),
        });
        this.registered.set(key, signature);
        (before === undefined ? result.added : result.changed).push(entry.face);
        reloaded.push(key);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reportOnce(`refused\u0000${key}\u0000${message}`, `${message} The item is not served.`);
      }
    }

    // What was reported and no longer holds may be said again if it returns.
    for (const signature of [...this.reported]) if (!stillReported.has(signature)) this.reported.delete(signature);

    if (reason === 'reload' && this.deps.buildOnReload) {
      // Started, not awaited: a build can outlast any caller. One at a time,
      // as the boot pass builds; `buildReloadedSource` never rejects.
      void (async () => {
        for (const key of reloaded) await service.buildReloadedSource(key);
      })().catch(() => undefined);
    }
    return result;
  }

  private namespaceOf(packageId: string): string | undefined {
    try {
      const namespace = this.deps.namespaceOf(packageId);
      return typeof namespace === 'string' && namespace !== '' ? namespace : undefined;
    } catch {
      return undefined;
    }
  }
}

/** A row's name as a log line shows it, or a placeholder for a row that states none. */
function rowName(row: unknown): string {
  const name = (row as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && name !== '' ? JSON.stringify(name.length > 64 ? `${name.slice(0, 64)}…` : name) : '(unnamed)';
}

/** `JSON.stringify` with every plain object's keys sorted. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  });
}
