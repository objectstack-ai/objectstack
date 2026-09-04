// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Filesystem Metadata Loader
 * 
 * Loads metadata from the filesystem using glob patterns
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { glob } from 'glob';
import { createHash } from 'node:crypto';
import type {
  MetadataLoadOptions,
  MetadataLoadResult,
  MetadataStats,
  MetadataLoaderContract,
  MetadataFormat,
  MetadataSaveOptions,
  MetadataSaveResult,
} from '@objectstack/spec/system';
import type { Logger } from '@objectstack/core';
import type { MetadataLoader, MetadataKeyedItem } from './loader-interface.js';
import type { MetadataSerializer } from '../serializers/serializer-interface.js';

/**
 * The pre-#14205 key: a body's own top-level `name`, when it has one. Kept for
 * exactly the shapes {@link FilesystemLoader.loadManyKeyed} refuses to mint a
 * key for, so those items behave precisely as they did before that method
 * existed — no regression, and no invented name either.
 */
function ownNameOf(data: unknown): string | null {
  const own = (data as { name?: unknown } | null)?.name;
  return typeof own === 'string' && own !== '' ? own : null;
}

export class FilesystemLoader implements MetadataLoader {
  readonly contract: MetadataLoaderContract = {
    name: 'filesystem',
    protocol: 'file:',
    capabilities: {
      read: true,
      write: true,
      watch: true,
      list: true,
    },
    supportedFormats: ['json', 'yaml', 'typescript', 'javascript'],
    supportsWatch: true,
    supportsWrite: true,
    supportsCache: true,
  };

  private cache = new Map<string, { data: any; etag: string; timestamp: number }>();

  constructor(
    private rootDir: string,
    private serializers: Map<MetadataFormat, MetadataSerializer>,
    private logger?: Logger
  ) {}

  async load(
    type: string,
    name: string,
    options?: MetadataLoadOptions
  ): Promise<MetadataLoadResult> {
    const startTime = Date.now();
    const { validate: _validate = true, useCache = true, ifNoneMatch } = options || {};

    try {
      // Find the file
      const filePath = await this.findFile(type, name);

      if (!filePath) {
        return {
          data: null,
          fromCache: false,
          notModified: false,
          loadTime: Date.now() - startTime,
        };
      }

      // Get stats
      const stats = await this.stat(type, name);

      if (!stats) {
        return {
          data: null,
          fromCache: false,
          notModified: false,
          loadTime: Date.now() - startTime,
        };
      }

      // Check cache
      if (useCache && ifNoneMatch && stats.etag === ifNoneMatch) {
        return {
          data: null,
          fromCache: true,
          notModified: true,
          etag: stats.etag,
          stats,
          loadTime: Date.now() - startTime,
        };
      }

      // Check memory cache
      const cacheKey = `${type}:${name}`;
      if (useCache && this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey)!;
        if (cached.etag === stats.etag) {
          return {
            data: cached.data,
            fromCache: true,
            notModified: false,
            etag: stats.etag,
            stats,
            loadTime: Date.now() - startTime,
          };
        }
      }

      // Load and deserialize
      const content = await fs.readFile(filePath, 'utf-8');
      const serializer = this.getSerializer(stats.format!);

      if (!serializer) {
        throw new Error(`No serializer found for format: ${stats.format}`);
      }

      const data = serializer.deserialize(content);

      // Update cache
      if (useCache) {
        this.cache.set(cacheKey, {
          data,
          etag: stats.etag || '',
          timestamp: Date.now(),
        });
      }

      return {
        data,
        fromCache: false,
        notModified: false,
        etag: stats.etag,
        stats,
        loadTime: Date.now() - startTime,
      };
    } catch (error) {
      this.logger?.error('Failed to load metadata', undefined, {
        type,
        name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async loadMany<T = any>(
    type: string,
    options?: MetadataLoadOptions
  ): Promise<T[]> {
    return (await this.loadManyEntries<T>(type, options)).map(entry => entry.data);
  }

  /**
   * [#14341] The keyed half of {@link loadMany} — see {@link MetadataKeyedItem}
   * for why the store's key travels BESIDE the body instead of being folded
   * into it.
   *
   * THE RULE, in one sentence: an item is keyed by this loader's own
   * name-to-path derivation — {@link nameFromFilename}, the very basename
   * derivation `list()` reports — ONLY where that derivation is a bijection for
   * the file (it sits directly under `ROOT/TYPE/` and carries one of the
   * extensions {@link findFile} tries, so `findFile(type, key)` resolves back to
   * this same file); every other shape keeps the pre-#14205 behaviour verbatim,
   * keyed by `body.name` when it has one and dropped when it has none.
   *
   * Why the rule stops there (PM ruling on #14341, 2026-09-02, knowingly over
   * triage's "a nested path keeps whatever `list()` reports for it today"):
   * `list()` and `findFile()` DISAGREE outside that shape. For
   * `ROOT/TYPE/crm/account.json`, `list()` reports the bare `account`, but
   * `findFile()` resolves that name against `ROOT/TYPE/account.json` and finds
   * nothing — the only name reaching the file is `crm/account`, which nothing
   * reports. An extension-less file is read by `loadMany()` and reported by
   * `list()`, and `findFile()` resolves neither. Keying by either side would
   * mint a name some other door cannot open, and two directories holding the
   * same basename would collide in silence
   * (`MetadataManager.admitLoaderItems()` keeps the first and says nothing).
   * The card's own fence: "keying items under names nothing else uses … is
   * worse than today's honest drop". So the drop stays exactly where the key is
   * unsettled, and is pinned as a RECORD in
   * `filesystem-loader-keyed-items.test.ts`.
   *
   * [#14486, partial] `list()` and {@link findFile} have since converged on
   * {@link resolvableNameForPath} — the derivation this method already used —
   * so a nested or extension-less file is now neither listed nor resolvable.
   * What did NOT change is the WALK behind this method: `loadManyEntries()`
   * still READS those files, so `loadMany()` still returns their bodies and
   * this method still falls back to `body.name` for them. That half of the
   * #14486 ruling ("nothing unlisted is returned by `loadMany()` either") is
   * deliberately NOT taken here: it would invert the three landed #14341 pins
   * in `filesystem-loader-keyed-items.test.ts:113,167,187` and the
   * `loadMany()` CONTROL at `:196`, and that file was under a concurrent
   * claim (PR #14627) when this landed. The remaining divergence — listed ⊂
   * loaded — is pinned as a RECORD in
   * `filesystem-loader-list-reachability.test.ts` rather than left implicit.
   *
   * One consequence, deliberate: a flat file whose `body.name` DISAGREES with
   * its basename is now keyed by the BASENAME. That is #14205's rule (identity
   * is the key the store holds an item under, not `body.name`) applied to this
   * loader, and it aligns `MetadataManager.list()` with `listNames()` for that
   * shape.
   *
   * The body is handed back by reference, unchanged: nothing is written into a
   * body that deliberately has no `name`. `limit` bounds the items LOADED,
   * exactly as `loadMany()` does — an entry the key rule drops has still been
   * read and still counts against it.
   */
  async loadManyKeyed<T = any>(
    type: string,
    options?: MetadataLoadOptions
  ): Promise<MetadataKeyedItem<T>[]> {
    const typeDir = path.join(this.rootDir, type);
    const keyed: MetadataKeyedItem<T>[] = [];

    for (const entry of await this.loadManyEntries<T>(type, options)) {
      const name =
        this.resolvableNameForPath(typeDir, entry.file) ?? ownNameOf(entry.data);

      if (name) {
        keyed.push({ name, data: entry.data });
      }
    }

    return keyed;
  }

  /**
   * The single walk behind {@link loadMany} and {@link loadManyKeyed}: one glob,
   * one serializer pass, one `limit`. Shared so the two can never answer with
   * different bodies for the same file — {@link MetadataLoader.loadManyKeyed}
   * requires `data` to be "the same body `loadMany()` would return for the
   * item", and a second copy of this walk is how that would quietly stop being
   * true.
   */
  private async loadManyEntries<T = any>(
    type: string,
    options?: MetadataLoadOptions
  ): Promise<{ file: string; data: T }[]> {
    const { patterns = ['**/*'], recursive: _recursive = true, limit } = options || {};

    const typeDir = path.join(this.rootDir, type);
    const items: { file: string; data: T }[] = [];

    try {
      // Build glob patterns
      const globPatterns = patterns.map(pattern =>
        path.join(typeDir, pattern)
      );

      for (const pattern of globPatterns) {
        const files = await glob(pattern, {
          ignore: ['**/node_modules/**', '**/*.test.*', '**/*.spec.*', '**/*[*]*'],
          nodir: true,
        });

        for (const file of files) {
          if (limit && items.length >= limit) {
            break;
          }

          try {
            const content = await fs.readFile(file, 'utf-8');
            const format = this.detectFormat(file);
            const serializer = this.getSerializer(format);

            if (serializer) {
              const data = serializer.deserialize<T>(content);
              items.push({ file, data });
            }
          } catch (error) {
            this.logger?.warn('Failed to load file', {
              file,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if (limit && items.length >= limit) {
          break;
        }
      }

      return items;
    } catch (error) {
      this.logger?.error('Failed to load many', undefined, {
        type,
        patterns,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async exists(type: string, name: string): Promise<boolean> {
    const filePath = await this.findFile(type, name);
    return filePath !== null;
  }

  async stat(type: string, name: string): Promise<MetadataStats | null> {
    const filePath = await this.findFile(type, name);

    if (!filePath) {
      return null;
    }

    try {
      const stats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      const etag = this.generateETag(content);
      const format = this.detectFormat(filePath);

      return {
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        etag,
        format,
        path: filePath,
      };
    } catch (error) {
      this.logger?.error('Failed to stat file', undefined, {
        type,
        name,
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * [#14486] The names this loader can be asked for, and ONLY those: a file
   * directly under `ROOT/TYPE/` carrying an extension one of this instance's
   * REGISTERED serializers claims. Every name it reports resolves back through
   * {@link findFile}, so `listNames()` and `get()` give the same answer.
   *
   * It used to report `path.basename(file, ext)` for every file the glob found,
   * nested or not, extension or not — and {@link findFile} resolves neither
   * shape. `ROOT/TYPE/crm/account.json` was listed as `account`, which resolves
   * against `ROOT/TYPE/account.json` and finds nothing; an extension-less
   * `ROOT/TYPE/noext` was listed as `noext`, which resolves under no appended
   * extension at all. A name in the list that `get()` answers `null` for is the
   * silent failure an author (human or AI) reads as their own typo, so they
   * retry the same word: the list and the door now agree instead.
   *
   * Ruling (maintainer, via the director seat on #14486, 2026-09-02): narrow
   * the list — direction A, over B (reverse-unify: report `crm/account` and
   * teach `findFile()` path-shaped names), which would have made a slash inside
   * a metadata name every consumer's permanent obligation with no measured
   * demand for it. The two-segment layout follows ADR-0008 §10, which
   * `metadata-fs`'s `parseItemPath()` already enforces for its own store; the
   * EXTENSION set deliberately does NOT follow §10's `.json`-only rule — see
   * {@link resolvableExtensions} for why.
   */
  async list(type: string): Promise<string[]> {
    const typeDir = path.join(this.rootDir, type);

    try {
      const files = await glob('**/*', {
        cwd: typeDir,
        ignore: ['**/node_modules/**', '**/*.test.*', '**/*.spec.*'],
        nodir: true,
      });

      // `cwd` makes these relative; `resolvableNameForPath()` measures against
      // the type directory, so hand it the absolute path it expects.
      return files
        .map(file => this.resolvableNameForPath(typeDir, path.join(typeDir, file)))
        .filter((name): name is string => name !== null);
    } catch (error) {
      this.logger?.error('Failed to list', undefined, {
        type,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async save(
    type: string,
    name: string,
    data: any,
    options?: MetadataSaveOptions
  ): Promise<MetadataSaveResult> {
    const startTime = Date.now();
    const {
      format = 'typescript',
      prettify = true,
      indent = 2,
      sortKeys = false,
      backup = false,
      overwrite = true,
      atomic = true,
      path: customPath,
    } = options || {};

    try {
      // Get serializer
      const serializer = this.getSerializer(format);
      if (!serializer) {
        throw new Error(`No serializer found for format: ${format}`);
      }

      // Determine file path
      const typeDir = path.join(this.rootDir, type);
      const fileName = `${name}${serializer.getExtension()}`;
      const filePath = customPath || path.join(typeDir, fileName);

      // Check if file exists
      if (!overwrite) {
        try {
          await fs.access(filePath);
          throw new Error(`File already exists: ${filePath}`);
        } catch (error) {
          // File doesn't exist, continue
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }
      }

      // Create directory if it doesn't exist
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Create backup if requested
      let backupPath: string | undefined;
      if (backup) {
        try {
          await fs.access(filePath);
          backupPath = `${filePath}.bak`;
          await fs.copyFile(filePath, backupPath);
        } catch {
          // File doesn't exist, no backup needed
        }
      }

      // Serialize data
      const content = serializer.serialize(data, {
        prettify,
        indent,
        sortKeys,
      });

      // Write to disk (atomic or direct)
      if (atomic) {
        const tempPath = `${filePath}.tmp`;
        await fs.writeFile(tempPath, content, 'utf-8');
        await fs.rename(tempPath, filePath);
      } else {
        await fs.writeFile(filePath, content, 'utf-8');
      }

      // Update cache logic if needed (e.g., invalidate or update)
      // For now, we rely on the watcher to pick up changes

      return {
        success: true,
        path: filePath,
        // format, // Not in schema
        size: Buffer.byteLength(content, 'utf-8'),
        backupPath,
        saveTime: Date.now() - startTime,
      };
    } catch (error) {
      this.logger?.error('Failed to save metadata', undefined, {
        type,
        name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * The inverse of {@link detectFormat}: which file extensions carry which
   * format. Fixed ORDER, because it is also {@link findFile}'s precedence when
   * two files under one type directory share a stem — registration order must
   * not be able to change which file `ROOT/TYPE/NAME` opens.
   */
  private static readonly EXTENSIONS_BY_FORMAT: ReadonlyArray<
    readonly [MetadataFormat, readonly string[]]
  > = [
    ['json', ['.json']],
    ['yaml', ['.yaml', '.yml']],
    ['typescript', ['.ts']],
    ['javascript', ['.js']],
  ];

  /**
   * [#14486] The extensions a name can be resolved under, for THIS instance:
   * the ones belonging to the serializer set it was constructed with. Shared by
   * {@link findFile}, {@link resolvableNameForPath} and therefore {@link list},
   * so the set a name can be RESOLVED under cannot drift from the set that is
   * LISTED or the set {@link loadManyKeyed} is willing to KEY by.
   *
   * Registered, not hard-coded, and deliberately not ADR-0008 §10's `.json`
   * only. §10 governs the `metadata-fs` store; applying it verbatim here would
   * drop `.yaml` and `.ts` metadata out of `listNames()` — a breakage this card
   * never asked for. Under the manager's DEFAULT format set
   * (`typescript` / `json` / `yaml`, `metadata-manager.ts`) that leaves `.js`
   * out, which is the card's row-4 membership mismatch closing for free: a `.js`
   * file was listed and resolvable while `loadMany()` could never return it and
   * `load()` threw `No serializer found for format: javascript`. Register
   * `javascript` and it is listed, resolvable and loadable together.
   */
  private resolvableExtensions(): string[] {
    const extensions: string[] = [];

    for (const [format, formatExtensions] of FilesystemLoader.EXTENSIONS_BY_FORMAT) {
      if (this.serializers.has(format)) {
        extensions.push(...formatExtensions);
      }
    }

    return extensions;
  }

  /**
   * The metadata name this loader reports for a file: the basename with its
   * extension stripped. One derivation, shared by {@link list} and
   * {@link loadManyKeyed}, so the two cannot drift for the shape where they
   * agree — `dotted.config.json` is `dotted.config` for both.
   */
  private static nameFromFilename(file: string): string {
    return path.basename(file, path.extname(file));
  }

  /**
   * The key for a file IF this loader's name-to-path mapping is a bijection for
   * it: a file directly under `ROOT/TYPE/` carrying an extension
   * {@link findFile} tries, so `findFile(type, key)` resolves back to this very
   * file. `null` for every other shape — a nested path, an extension-less file,
   * an extension spelled in a case `findFile()` does not compose — which is why
   * {@link loadManyKeyed} falls back to `body.name` there rather than minting a
   * key no other door can open.
   */
  private resolvableNameForPath(typeDir: string, file: string): string | null {
    const rel = path.relative(typeDir, file);

    // Nested, or outside the type directory altogether.
    if (rel === '' || rel.split(path.sep).length !== 1) {
      return null;
    }

    // Case-SENSITIVE on purpose: `findFile()` composes `name + ext` with these
    // exact spellings, so `Foo.JSON` is not resolvable under `Foo`.
    if (!this.resolvableExtensions().includes(path.extname(rel))) {
      return null;
    }

    return FilesystemLoader.nameFromFilename(rel);
  }

  /**
   * Find file for a given type and name
   */
  private async findFile(type: string, name: string): Promise<string | null> {
    const typeDir = path.join(this.rootDir, type);
    const extensions = this.resolvableExtensions();

    for (const ext of extensions) {
      const filePath = path.join(typeDir, `${name}${ext}`);

      try {
        await fs.access(filePath);
        return filePath;
      } catch {
        // File doesn't exist, try next extension
      }
    }

    return null;
  }

  /**
   * Detect format from file extension
   */
  private detectFormat(filePath: string): MetadataFormat {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case '.json':
        return 'json';
      case '.yaml':
      case '.yml':
        return 'yaml';
      case '.ts':
        return 'typescript';
      case '.js':
        return 'javascript';
      default:
        return 'json'; // Default to JSON
    }
  }

  /**
   * Get serializer for format
   */
  private getSerializer(format: MetadataFormat): MetadataSerializer | undefined {
    return this.serializers.get(format);
  }

  /**
   * Generate ETag for content
   * Uses SHA-256 hash truncated to 32 characters for reasonable collision resistance
   * while keeping ETag headers compact (full 64-char hash is overkill for this use case)
   */
  private generateETag(content: string): string {
    const hash = createHash('sha256').update(content).digest('hex').substring(0, 32);
    return `"${hash}"`;
  }
}
