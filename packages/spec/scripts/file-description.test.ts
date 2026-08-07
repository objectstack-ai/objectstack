// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin for WHICH doc block the reference-docs generator publishes as a page's
 * opening paragraph — #5059.
 *
 * `getFileDescription()` took the first doc block anywhere in the file,
 * verbatim. That is a rule about ordering, not about descriptions, so whichever
 * declaration happened to sit at the top of a `.zod.ts` donated its comment to a
 * public page. It landed on `main` twice with `check:docs` green both times —
 * that gate compares the generated page against the source, and the page
 * faithfully reproduced the wrong block, so there was no drift to report.
 *
 * The measurement on the issue (main `4615a18`) found the victim surface is six
 * pages, not the two the issue body named, and that four of the six have no
 * `#4001` history constant anywhere near them — they are ordinary internal enum
 * and shared-type comments that merely sit first. That is why this is fixed as a
 * SELECTION rule rather than as the first-sentence pattern gate the issue body
 * floated (`#\d{3,}` / `Shared history` / `Until #`): the pattern only
 * recognises the history-constant subclass, and only after publication. A rule
 * that cannot pick a symbol's comment makes the whole class impossible, so the
 * rule IS the gate and this file is its enforcement.
 *
 * MEASURED (reverse verification), the ordinary direction: restoring the old
 * one-line selection (`content.match(/\/\*\*([\s\S]*?)\*\//)?.[1] ?? ''`) in
 * place of `findModuleDocBlock` turns the six victim cases and every
 * `documents a symbol` case red — each reporting the internal comment it used
 * to publish — while the `keeps a real module header` cases stay green, because
 * for those two selections agree. That asymmetry is the point: the defect was
 * invisible precisely on the inputs everyone had thought to check.
 *
 * The corpus gate at the end is the part that cannot rot: it re-derives the
 * verdict from the real `packages/spec/src` tree, so a future file that puts a
 * helper above its schemas cannot quietly re-acquire a wrong page description.
 */

import fs from 'fs';
import path from 'path';
import url from 'url';

import { describe, expect, it } from 'vitest';

import { findModuleDocBlock, renderFileDescription } from './lib/file-description';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(HERE, '../src');

/** First prose line of a selected block, the way a page renders it. */
const opening = (block: string | null) =>
  block === null
    ? null
    : block.split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean)[0] ?? '';

describe('findModuleDocBlock — a block documents a symbol, or it documents the module', () => {
  it('rejects a block attached to a private helper const (#4001 history constants)', () => {
    // `data/mapping.zod.ts` and `system/translation.zod.ts`, reduced. The page
    // opened with "Shared history for this file (#4001)." for two releases.
    const source = [
      "// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.",
      '',
      "import { z } from 'zod';",
      '',
      '/**',
      ' * Shared history for this file (#4001).',
      ' */',
      "const MAPPING_HISTORY = 'Until #4001 closed this shape these were dropped silently';",
      '',
      '/** Import mapping. */',
      'export const MappingSchema = z.object({});',
      '',
    ].join('\n');
    expect(findModuleDocBlock(source)).toBeNull();
  });

  it('rejects a block attached to an exported schema (`Transport Protocol Enum`)', () => {
    const source = [
      "import { z } from 'zod';",
      '',
      '/**',
      ' * Transport Protocol Enum',
      ' * Defines the communication protocol for realtime data synchronization',
      ' */',
      "export const TransportProtocol = z.enum(['websocket', 'sse', 'polling']);",
      '',
    ].join('\n');
    expect(findModuleDocBlock(source)).toBeNull();
  });

  it('rejects a block nested inside a declaration body (a property doc)', () => {
    // `api/contract.zod.ts`: the page opened with `ApiErrorSchema.code`'s doc.
    const source = [
      "import { z } from 'zod';",
      '',
      'export const ApiErrorSchema = z.object({',
      '  /**',
      '   * Machine-readable semantic code (ADR-0112).',
      '   */',
      '  code: z.string(),',
      '});',
      '',
    ].join('\n');
    expect(findModuleDocBlock(source)).toBeNull();
  });

  it('rejects a block that arrives after the first declaration, however good it is', () => {
    // `api/protocol.zod.ts` carries a real module header — 12 lines BELOW the
    // first schema. 宁可缺,不要错: a header is a header by position, and a
    // generator that hunts for prose anywhere in the file is the defect.
    const source = [
      "import { z } from 'zod';",
      '',
      'export const FirstSchema = z.object({});',
      '',
      '/**',
      ' * ObjectStack Protocol - Zod Schema Definitions',
      ' */',
      '',
      '// banner',
      '',
    ].join('\n');
    expect(findModuleDocBlock(source)).toBeNull();
  });

  it('keeps a module header written above the imports', () => {
    const source = [
      "// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.",
      '',
      '/**',
      ' * @module ui/sharing',
      ' *',
      ' * Sharing & Embedding Protocol',
      ' */',
      '',
      "import { z } from 'zod';",
      '',
      '/** Sharing config. */',
      'export const SharingConfigSchema = z.object({});',
      '',
    ].join('\n');
    expect(opening(findModuleDocBlock(source))).toBe('@module ui/sharing');
  });

  it('keeps a module header written below the imports and a re-export', () => {
    // `api/websocket.zod.ts`. Re-exports declare no symbol of their own, so
    // they do not close the header zone — the banner after the block does the
    // separating, and the schema below has its own JSDoc.
    const source = [
      "import { z } from 'zod';",
      "import { PresenceStatus } from './realtime-shared.zod';",
      '',
      "export { PresenceStatus } from './realtime-shared.zod';",
      '',
      '/**',
      ' * WebSocket Event Protocol',
      ' */',
      '',
      '// ==========================================',
      '// Message Types',
      '// ==========================================',
      '',
      '/** WebSocket Message Type Enum */',
      "export const WebSocketMessageType = z.enum(['ping']);",
      '',
    ].join('\n');
    expect(opening(findModuleDocBlock(source))).toBe('WebSocket Event Protocol');
  });

  it('keeps a module header separated from the first schema by a section banner', () => {
    // `system/settings-manifest.zod.ts`, `api/analytics.zod.ts`. A banner between
    // the block and the declaration is where the preamble ends — nobody writes
    // one between a JSDoc and the symbol it documents.
    const source = [
      "import { z } from 'zod';",
      '',
      '/**',
      ' * Settings Manifest Protocol',
      ' */',
      '',
      '// ---------------------------------------------------------------------',
      '// Specifier types',
      '// ---------------------------------------------------------------------',
      '',
      'export const SettingsManifestSchema = z.object({});',
      '',
    ].join('\n');
    expect(opening(findModuleDocBlock(source))).toBe('Settings Manifest Protocol');
  });

  it('keeps a header the lazify codemod separated from the imports', () => {
    // `scripts/lazify-schemas.ts` inserts its import after the leading run of
    // comments and imports — and that run swallows a doc block, so a header can
    // end up with imports on both sides. It is still a header.
    const source = [
      "import { z } from 'zod';",
      '',
      '/**',
      ' * Analytics API Protocol',
      ' */',
      '',
      "import { lazySchema } from '../shared/lazy-schema';",
      'export const AnalyticsEndpoint = z.enum([]);',
      '',
    ].join('\n');
    expect(opening(findModuleDocBlock(source))).toBe('Analytics API Protocol');
  });

  it('returns null rather than guessing when a file has no doc block at all', () => {
    expect(findModuleDocBlock("import { z } from 'zod';\nexport const A = z.string();\n")).toBeNull();
  });
});

describe('renderFileDescription', () => {
  const ctx = { sourcePathToDocsRoute: (t: string) => (t.includes('sync') ? '/docs/references/automation/sync' : null) };

  it('renders nothing when the module has no description', () => {
    const source = "import { z } from 'zod';\n\n/** Sort direction. */\nexport const S = z.string();\n";
    expect(renderFileDescription(source, ctx)).toBe('');
  });

  it('still resolves `@link` targets and escapes braces in a real header', () => {
    // Rendering is unchanged by #5059 — only the block SELECTION moved. These
    // two assertions exist so the extraction is provably behaviour-preserving.
    //
    // The `{@link <path>}` (untitled) form is deliberately NOT asserted here:
    // the untitled branch emits `[path](route)` and the bare-source-path
    // rewriter two lines below then matches the path INSIDE the link text and
    // wraps it again, so the published output is a link nested in a link. That
    // is a pre-existing defect of the rendering chain, live on `main` in
    // `automation/etl.mdx:54` and `integration/connector.mdx:102`; filed
    // separately rather than pinned here, because pinning it would ratify it.
    const source = [
      '/**',
      ' * Header referencing {@link ../automation/sync.zod.ts | the sync protocol}',
      ' * and a literal \\{ brace \\}.',
      ' */',
      '',
      "import { z } from 'zod';",
      '',
    ].join('\n');
    const out = renderFileDescription(source, ctx);
    expect(out).toContain('[the sync protocol](/docs/references/automation/sync)');
    expect(out).toContain('\\{');
  });
});

/**
 * The corpus half: re-derive the verdict from the real sources, so the six
 * pages the issue measured cannot silently re-acquire a wrong opening, and so a
 * NEW file that puts a helper above its schemas is caught here rather than on
 * the published site.
 */
describe('corpus — no reference source donates a symbol comment to its page', () => {
  const zodFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.zod.ts')) zodFiles.push(p);
    }
  };
  walk(SRC_DIR);

  it('finds sources to check', () => {
    expect(zodFiles.length).toBeGreaterThan(150);
  });

  it('never selects a block that is immediately followed by a declaration', () => {
    const offenders: string[] = [];
    for (const file of zodFiles) {
      const source = fs.readFileSync(file, 'utf-8');
      const block = findModuleDocBlock(source);
      if (block === null) continue;
      const marker = `/**${block}*/`;
      const at = source.indexOf(marker);
      if (at < 0) { offenders.push(`${path.relative(SRC_DIR, file)}: selected block not found verbatim`); continue; }
      const after = source.slice(at + marker.length).replace(/^\n/, '');
      const next = after.split('\n').find(l => l.trim() !== '') ?? '';
      if (/^[A-Za-z_$@]/.test(next) && !/^(?:import\b|export\s*(?:\*|\{|type\s*\{))/.test(next)) {
        offenders.push(`${path.relative(SRC_DIR, file)} → ${next.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('drops the six openings the issue measured, and keeps the module headers beside them', () => {
    const openingOf = (rel: string) =>
      opening(findModuleDocBlock(fs.readFileSync(path.join(SRC_DIR, rel), 'utf-8')));

    // The six victims — five caught by the issue's strict criterion plus
    // `data/mapping`, whose history constant precedes the first export and so
    // slipped past it. All six now render no description at all.
    for (const rel of [
      'data/mapping.zod.ts',
      'system/translation.zod.ts',
      'api/contract.zod.ts',
      'api/protocol.zod.ts',
      'api/realtime.zod.ts',
      'kernel/plugin.zod.ts',
    ]) {
      expect(openingOf(rel), rel).toBeNull();
    }

    // …while files that carry a genuine module header keep it. Without this
    // half the rule could "fix" the six by describing nothing at all.
    expect(openingOf('system/migration.zod.ts')).toBe('Migration protocol — the two kinds of migration, kept apart on purpose.');
    expect(openingOf('api/websocket.zod.ts')).toBe('WebSocket Event Protocol');
    expect(openingOf('ui/sharing.zod.ts')).toBe('@module ui/sharing');
  });
});
