// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Node Metadata Manager
 * 
 * Extends MetadataManager with Filesystem capabilities (Watching, default loader)
 */

import * as path from 'node:path';
import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import type {
  MetadataWatchEvent,
} from '@objectstack/spec/system';
import { FilesystemLoader } from './loaders/filesystem-loader.js';
import { MetadataManager, type MetadataManagerOptions } from './metadata-manager.js';

/**
 * Node metadata manager class
 */
export class NodeMetadataManager extends MetadataManager {
  private watcher?: FSWatcher;

  constructor(config: MetadataManagerOptions) {
    super(config);

    // Initialize Default Filesystem Loader if no loaders provided
    // This logic replaces the removed logic from base class
    if (!config.loaders || config.loaders.length === 0) {
      const rootDir = config.rootDir || process.cwd();
      this.registerLoader(new FilesystemLoader(rootDir, this.serializers, this.logger));
    }

    // Start watching if enabled
    if (config.watch) {
      this.startWatching();
    }
  }

  /**
   * Stop all watching
   */
  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
    }
    // Call base cleanup if any
  }

  /**
   * Start watching for file changes
   */
  private startWatching(): void {
    const rootDir = this.config.rootDir || process.cwd();
    const { ignored = ['**/node_modules/**', '**/*.test.*'], persistent = true } =
      this.config.watchOptions || {};

    this.watcher = chokidarWatch(rootDir, {
      ignored,
      persistent,
      ignoreInitial: true,
      // Use polling to avoid `fs.watch` EMFILE on macOS / busy dev hosts.
      // Recursive watch over a project root would otherwise wire native
      // watches across the entire tree, easily exhausting the FD pool.
      usePolling: true,
      interval: 1000,
      binaryInterval: 2000,
    });

    this.watcher.on('add', async (filePath) => {
      await this.handleFileEvent('added', filePath);
    });

    this.watcher.on('change', async (filePath) => {
      await this.handleFileEvent('changed', filePath);
    });

    this.watcher.on('unlink', async (filePath) => {
      await this.handleFileEvent('deleted', filePath);
    });

    this.logger.info('File watcher started', { rootDir });
  }

  /**
   * Handle file change events
   */
  private async handleFileEvent(
    eventType: 'added' | 'changed' | 'deleted',
    filePath: string
  ): Promise<void> {
    const rootDir = this.config.rootDir || process.cwd();
    const relativePath = path.relative(rootDir, filePath);
    const parts = relativePath.split(path.sep);

    if (parts.length < 2) {
      return; // Not a metadata file
    }

    const type = parts[0];
    const fileName = parts[parts.length - 1];
    const name = path.basename(fileName, path.extname(fileName));

    let data: any = undefined;
    if (eventType !== 'deleted') {
      try {
        data = await this.load(type, name, { useCache: false });
      } catch (error) {
        this.logger.error('Failed to load changed file', undefined, {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    const event: MetadataWatchEvent = {
      type: eventType,
      metadataType: type,
      name,
      path: filePath,
      data,
      timestamp: new Date().toISOString(),
    };

    // [#5218] Invalidate BEFORE announcing. A file event is a *foreign write*
    // in the precise sense {@link MetadataManager.invalidateForForeignWrite}
    // means: it did not come through this manager's write API, so — unlike
    // `register()` / `unregister()` — nothing has refreshed the caches on its
    // behalf. `load()` above is a pure read (it delegates to `loadDiagnosed`,
    // which only walks the loaders), so before this call the handler left both
    // `listCache` and `registry` holding the pre-change state.
    //
    // Without it, editing `rootDir/view/x.json` left the two read surfaces
    // contradicting each other for up to LIST_CACHE_TTL_MS (30s): `get()` saw
    // the new file because it falls through to the FilesystemLoader, while
    // `list()` — REST `/api/v1/metadata/:type`, the Studio left rail,
    // `listViews()` — kept serving the pre-change set. Worse, the HMR/SSE
    // consumers woken by the event answer it by re-reading through `list()`,
    // so the wake-up handed back exactly the stale data it was announcing.
    // Same defect shape as #5109 (cluster peer) with a different trigger; this
    // reuses that fix's helper rather than re-deriving it.
    //
    // Ordering is the same discipline every other write path in the base class
    // keeps (`register` / `unregister` / `applyRepoEvent` / the cluster
    // subscriber all invalidate, then announce): a watcher must never be able
    // to observe the event and the pre-event cache at the same time.
    //
    // The registry entry goes too, not just the list cache. FS-loaded items
    // never enter the registry, so there is usually nothing to delete — but
    // when a same-named entry was previously written by `register()` /
    // `registerInMemory()` it SHADOWS the loader in both `get()` and `list()`,
    // and dropping the list cache alone would leave that stale copy answering
    // forever. Deleted, never pre-filled from `data`, per the helper's contract.
    this.invalidateForForeignWrite(type, name);

    this.notifyWatchers(type, event);
  }
}
