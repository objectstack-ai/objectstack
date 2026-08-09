// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * export-origins-layout.ts — the WRITER side of `packages/spec/export-origins/`.
 *
 * Split out of `build-export-origins.ts` for one reason: the shard bytes are
 * produced here and compared here, so `--check` cannot drift from `--write` by
 * rendering the document a second way. The READER side lives in
 * `src/shared/export-origins.testkit.ts` and deliberately shares no module with
 * this one — it runs inside vitest over `src/`, where `tsconfig.json`'s
 * `rootDir: ./src` makes a `scripts/` import a type error. It therefore keys
 * shards by the `entry` field each shard declares rather than by filename, so
 * the two sides agree on the shard NAMING without sharing the function that
 * computes it; `export-origins.test.ts` asserts that agreement over the real
 * artifact so it cannot rot into a guess.
 *
 * Sharding, and why: see `build-export-origins.ts`'s header and #5837.
 */

import {
  serializeShard,
  shardNameForEntry,
  listShardNames,
} from './sharded-artifacts';
import fs from 'node:fs';
import path from 'node:path';

/** `packages/spec/export-origins/<entry>.json` — the #4796 declaration-origin baseline. */
export const EXPORT_ORIGINS_DIR_NAME = 'export-origins';

/** One entry point's slice of the declaration-origin baseline. */
export interface ExportOriginsShard {
  description: string;
  entry: string;
  /** export name → `<src path>#<declared name> (<kind>)`, sorted by name. */
  exports: Record<string, string>;
}

/**
 * The description carried by EVERY shard.
 *
 * Repeated per file for the same reason the other sharded ratchets repeat
 * theirs: the reader this text exists for is the one who has just opened a
 * single shard because a pin went red, and a pointer to a central index is one
 * hop more than that reader takes. It is compared byte-for-byte, so editing it
 * restates the procedure in every shard — deliberately.
 */
export const EXPORT_ORIGINS_DESCRIPTION =
  'Which SOURCE DECLARATION each name exported by one public entry point of @objectstack/spec ' +
  'resolves to, after its alias chain is unwound: `<src path>#<declared name> (<kind>)`. Two ' +
  'exports share an origin string iff they are the same declaration — so equal origins across two ' +
  'entries are a harmless re-export, and different origins under one name are the #4411 ' +
  'dual-source trap. Generated from src/ (no build needed) and read by the export-surface pin ' +
  'tests, which compare against it instead of each building their own ts.createProgram — that was ' +
  '~55s of compilation per CI lap and a non-deterministic timeout that ejected unrelated PRs from ' +
  'the merge queue (#4796). Sharded by entry point (#5837) so two retirement PRs never share a ' +
  'file. Carries NO line numbers: the pins asserted the line as `\\d+`, and recording it would ' +
  'rewrite this artifact on every edit that shifts a line in any .zod.ts. Regenerate with ' +
  '`pnpm --filter @objectstack/spec gen:export-origins` and read the diff.';

/** Split the resolved map into `<entry shard> -> canonical shard bytes`. */
export function exportOriginsShardTexts(
  byEntry: Record<string, Record<string, string>>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of Object.keys(byEntry).sort()) {
    out.set(
      shardNameForEntry(entry),
      serializeShard({
        description: EXPORT_ORIGINS_DESCRIPTION,
        entry,
        exports: byEntry[entry],
      } satisfies ExportOriginsShard),
    );
  }
  return out;
}

/** Raw bytes of every shard on disk, keyed by basename — the `--check` input. */
export function readExportOriginShards(dir: string): Map<string, { file: string; raw: string }> {
  const out = new Map<string, { file: string; raw: string }>();
  for (const name of listShardNames(dir)) {
    const file = path.join(dir, `${name}.json`);
    out.set(name, { file, raw: fs.readFileSync(file, 'utf-8') });
  }
  return out;
}
