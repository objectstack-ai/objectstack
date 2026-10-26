// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isSeedFileReference, type SeedFileContent, type SeedFileReference } from '@objectstack/spec/data';

/**
 * [#25779] `os build` / `os compile`'s half of a seed file: read each file a
 * seed record names with `seedFile(path)` and write its bytes into the
 * dataset's `files` map, so the compiled artifact carries them to every boot
 * that loads it — `os dev`, `os serve`, a published package, an artifact URL.
 *
 * The path is relative to the package root, the directory holding
 * `objectstack.config.ts` (the root a declarative connector's file ref resolves
 * against too), and confined to it. A path that names no file there, or a file
 * whose type cannot be told from its extension and that no reference names a
 * `contentType` for, fails the build: the seed would otherwise load without the
 * file its field requires.
 */

/** A refusal, located in the artifact like a schema issue is. */
export interface SeedFileBundleIssue {
  /** Where the reference sits, e.g. `data[2].records[0].file`. */
  location: string;
  message: string;
}

export interface SeedFileBundleResult {
  /** Files bundled, counted once per dataset that carries them. */
  files: number;
  /** Their bytes, before base64. */
  bytes: number;
  issues: SeedFileBundleIssue[];
}

/**
 * Media types by extension: the seed file's `contentType` when no reference
 * names one. Deliberately the common document, image and media types only; any
 * other file states its type with `seedFile(path, { contentType })`.
 */
const SEED_FILE_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.rtf': 'application/rtf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

/** One dataset of the artifact, as far as this pass reads it. */
interface DatasetLike {
  records?: unknown;
  files?: Record<string, SeedFileContent>;
}

/** Every seed dataset in the artifact — the top level's and each package body's — with where it sits. */
function datasetsOf(bundle: Record<string, unknown>): Array<{ dataset: DatasetLike; location: string }> {
  const found: Array<{ dataset: DatasetLike; location: string }> = [];
  const seen = new Set<unknown>();
  const take = (list: unknown, location: string): void => {
    if (!Array.isArray(list)) return;
    list.forEach((dataset, i) => {
      if (!dataset || typeof dataset !== 'object' || seen.has(dataset)) return;
      seen.add(dataset);
      found.push({ dataset: dataset as DatasetLike, location: `${location}[${i}]` });
    });
  };
  take(bundle.data, 'data');
  const manifest = bundle.manifest as { data?: unknown } | undefined;
  if (manifest && typeof manifest === 'object') take(manifest.data, 'manifest.data');
  if (Array.isArray(bundle.packages)) {
    bundle.packages.forEach((pkg, i) => {
      const body = (pkg as { manifest?: { data?: unknown } } | null)?.manifest;
      if (body && typeof body === 'object') take(body.data, `packages[${i}].manifest.data`);
    });
  }
  return found;
}

/** The seed file references of one dataset, by path, with where each one sits. */
function referencesOf(
  dataset: DatasetLike,
  location: string,
): Map<string, Array<{ reference: SeedFileReference; location: string }>> {
  const byPath = new Map<string, Array<{ reference: SeedFileReference; location: string }>>();
  if (!Array.isArray(dataset.records)) return byPath;
  dataset.records.forEach((record, r) => {
    if (!record || typeof record !== 'object') return;
    for (const [field, value] of Object.entries(record as Record<string, unknown>)) {
      const elements = Array.isArray(value) ? value : [value];
      elements.forEach((element, e) => {
        if (!isSeedFileReference(element) || typeof element.$file !== 'string') return;
        const at = `${location}.records[${r}].${field}${Array.isArray(value) ? `[${e}]` : ''}`;
        const list = byPath.get(element.$file) ?? [];
        list.push({ reference: element, location: at });
        byPath.set(element.$file, list);
      });
    }
  });
  return byPath;
}

/**
 * Write the bytes of every seed file the artifact's datasets name into their
 * `files` maps, reading each path under `packageRoot`. Changes `bundle` in
 * place; answers what it bundled and what it refused.
 */
export function bundleSeedFiles(bundle: Record<string, unknown>, packageRoot: string): SeedFileBundleResult {
  const result: SeedFileBundleResult = { files: 0, bytes: 0, issues: [] };
  const root = path.resolve(packageRoot);
  const read = new Map<string, Buffer | null>();
  for (const { dataset, location } of datasetsOf(bundle)) {
    const byPath = referencesOf(dataset, location);
    if (byPath.size === 0) continue;
    const files: Record<string, SeedFileContent> = { ...(dataset.files ?? {}) };
    for (const [seedPath, references] of byPath) {
      const first = references[0].location;
      const absolute = path.resolve(root, seedPath);
      const relative = path.relative(root, absolute);
      if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
        result.issues.push({
          location: first,
          message: `seedFile('${seedPath}') climbs out of the package root ${root}; a seed file path stays inside it.`,
        });
        continue;
      }
      if (!read.has(absolute)) {
        let bytes: Buffer | null = null;
        try {
          if (fs.statSync(absolute).isFile()) bytes = fs.readFileSync(absolute);
        } catch {
          bytes = null;
        }
        read.set(absolute, bytes);
      }
      const bytes = read.get(absolute) ?? null;
      if (bytes === null) {
        result.issues.push({
          location: first,
          message:
            `seedFile('${seedPath}') names no file: ${absolute} does not exist or is not a file. A seed file path is ` +
            'relative to the directory holding objectstack.config.ts.',
        });
        continue;
      }
      const declared = references.map((r) => r.reference.contentType).find((t) => typeof t === 'string');
      const contentType = SEED_FILE_TYPES[path.extname(seedPath).toLowerCase()] ?? declared;
      if (!contentType) {
        result.issues.push({
          location: first,
          message:
            `seedFile('${seedPath}'): the file's type cannot be told from its extension. Name it on the reference: ` +
            `seedFile('${seedPath}', { contentType: 'application/octet-stream' }) — or the type it really is.`,
        });
        continue;
      }
      files[seedPath] = {
        contentType,
        size: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        data: bytes.toString('base64'),
      };
      result.files += 1;
      result.bytes += bytes.byteLength;
    }
    dataset.files = files;
  }
  return result;
}
