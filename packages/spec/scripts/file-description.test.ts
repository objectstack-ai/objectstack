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
    // #6136 has since fixed the untitled `{@link <path>}` form this case used
    // to steer around; it is pinned on its own below rather than folded in
    // here, so this case keeps testing exactly what it was written to test.
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
 * #5553 — the block is rendered as the markdown it was written as.
 *
 * The renderer used to drop blank lines and join what was left with `\n\n`,
 * making every SOURCE LINE its own paragraph. Anything that legitimately wraps
 * across lines was cut in half by a paragraph boundary, and an inline code span
 * cannot cross one, so both backticks fell out as literal text on five
 * published pages.
 */
describe('renderFileDescription — #5553: line layout is content, not decoration', () => {
  const ctx = { sourcePathToDocsRoute: () => null };

  it('keeps an inline code span that wraps across two source lines', () => {
    // `automation/flow-function.zod.ts:13-15`, reduced — the example the issue
    // opened with. Published as two paragraphs, one starting with a stray
    // backtick and the next ending with one.
    const source = [
      '/**',
      ' * A later node persists it (`update_record fields: {',
      " *   ai_category: '{aiResult.ai_category}' }`). Done.",
      ' */',
      '',
      "import { z } from 'zod';",
      '',
    ].join('\n');
    expect(renderFileDescription(source, ctx)).toBe(
      "A later node persists it (`update_record fields: {\n  ai_category: '{aiResult.ai_category}' }`). Done.",
    );
  });

  it('does not escape braces inside an inline code span, and still does outside one', () => {
    // A code span renders its content literally, so a backslash there is not an
    // escape character — it is a backslash the reader sees. `shared/expression`
    // published `` `\{ dialect, source \}` `` for exactly this reason.
    const source = [
      '/**',
      ' * The persisted form is `{ dialect, source }`, written {inline} in prose.',
      ' */',
      '',
      "import { z } from 'zod';",
      '',
    ].join('\n');
    expect(renderFileDescription(source, ctx)).toBe(
      'The persisted form is `{ dialect, source }`, written \\{inline\\} in prose.',
    );
  });

  it('leaves a fenced code block alone — no paragraph splitting, no escaping', () => {
    const source = [
      '/**',
      ' * Example:',
      ' *',
      ' * ```ts',
      ' * const a = { b: 1 };',
      ' *',
      ' * const c = 2;',
      ' * ```',
      ' */',
      '',
      "import { z } from 'zod';",
      '',
    ].join('\n');
    expect(renderFileDescription(source, ctx)).toBe(
      ['Example:', '', '```ts', 'const a = { b: 1 };', '', 'const c = 2;', '```'].join('\n'),
    );
  });

  it('re-emits an indented (4-space) code block as a fenced one', () => {
    // `data/date-macros.zod.ts` and `data/context-tokens.zod.ts` write their
    // placeholder examples this way, and they are almost entirely braces.
    //
    // The fence is not cosmetic. MDX dropped CommonMark's indented code blocks
    // so indentation could lay out JSX, so an indented block reaches MDX as
    // ordinary prose — and unescaped braces in prose are an expression. Left
    // indented, both pages fail to compile with "Could not parse expression
    // with acorn"; escaped instead, the reader gets `\{` in what is meant to be
    // code, which is the very defect #5553 is about.
    const source = [
      '/**',
      ' * They use a placeholder grammar:',
      ' *',
      " *     { published_at: { $gte: '{last_quarter_start}' } }",
      ' *',
      ' * Expanded on both sides.',
      ' */',
      '',
      "import { z } from 'zod';",
      '',
    ].join('\n');
    expect(renderFileDescription(source, ctx)).toBe(
      [
        'They use a placeholder grammar:',
        '',
        '```',
        "{ published_at: { $gte: '{last_quarter_start}' } }",
        '```',
        '',
        'Expanded on both sides.',
      ].join('\n'),
    );
  });

  it('keeps a list a list, and its nesting nested', () => {
    // 85 of the 185 described sources write a list. Splitting per line made
    // every item its own paragraph and `.trim()` flattened the nesting, so a
    // literal space-join — the other reading of "merge the lines" — would have
    // been just as wrong in the other direction.
    const source = [
      '/**',
      ' * ## Layers',
      ' *',
      ' * 1. **Warehouse**',
      ' *    - Extract from systems',
      ' *    - Load into the warehouse',
      ' * 2. **Integration**',
      ' */',
      '',
      "import { z } from 'zod';",
      '',
    ].join('\n');
    expect(renderFileDescription(source, ctx)).toBe(
      [
        '## Layers',
        '',
        '1. **Warehouse**',
        '   - Extract from systems',
        '   - Load into the warehouse',
        '2. **Integration**',
      ].join('\n'),
    );
  });

  it('keeps consecutive `@see` tags as separate blocks', () => {
    // JSDoc block tags are block-level, and the sources write runs of them with
    // no blank line between (`automation/etl` ends on three). Preserving the
    // source layout alone would have merged them into one run-on paragraph —
    // the one place the renderer must ADD a blank line rather than keep one.
    const source = [
      '/**',
      ' * ETL pipelines.',
      ' * @see https://airbyte.com/',
      ' * @see https://nifi.apache.org/',
      ' */',
      '',
      "import { z } from 'zod';",
      '',
    ].join('\n');
    expect(renderFileDescription(source, ctx)).toBe(
      ['ETL pipelines.', '', 'See also: https://airbyte.com/', '', 'See also: https://nifi.apache.org/'].join('\n'),
    );
  });
});

/**
 * #6136 — a rewriter that runs over its own output nests a link in a link.
 *
 * The untitled `{@link <path>}` branch emits `[<path>](<route>)`, whose link
 * TEXT is the path itself. The bare-source-path rewriter that runs next only
 * excluded "preceded by `(`" and "followed by `)`", so it matched that text and
 * wrapped it a second time. Lookaround cannot express "not nested inside a
 * link"; the fix is to stop showing it the links at all.
 */
describe('renderFileDescription — #6136: the bare-path rewriter skips formed links', () => {
  const ctx = {
    sourcePathToDocsRoute: (t: string) =>
      /integration\/connector\.zod\.ts$/.test(t) ? '/docs/references/integration/connector' : null,
  };

  it('renders an untitled `{@link <path>}` as ONE link', () => {
    const source = [
      '/**',
      ' * See {@link ../integration/connector.zod.ts} for the connector layer.',
      ' */',
      '',
      "import { z } from 'zod';",
      '',
    ].join('\n');
    expect(renderFileDescription(source, ctx)).toBe(
      'See [../integration/connector.zod.ts](/docs/references/integration/connector) for the connector layer.',
    );
  });

  it('renders the published `@see {@link file://…}` shape as ONE link', () => {
    // `automation/etl.zod.ts:42` verbatim — the exact input behind
    // `content/docs/references/automation/etl.mdx:54`.
    const source = [
      '/**',
      ' * @see {@link file://../integration/connector.zod.ts} for the Enterprise Connector layer',
      ' */',
      '',
      "import { z } from 'zod';",
      '',
    ].join('\n');
    expect(renderFileDescription(source, ctx)).toBe(
      'See also: [../integration/connector.zod.ts](/docs/references/integration/connector) for the Enterprise Connector layer',
    );
  });

  it('still linkifies a path left bare in prose', () => {
    // The half that must NOT regress: skipping formed links is not the same as
    // skipping paths, and a rewriter that stopped doing its job would pass the
    // two cases above for the wrong reason.
    //
    // Spelled WITHOUT a `../` prefix on purpose. A bare path that carries one
    // is mis-linked by a defect this PR does not touch — the rewriter's leading
    // `\b` cannot match at the `.` of `../`, so the prefix is left outside the
    // link (`../../[system/cache.zod.ts](route)`, live on `api/http-cache` and
    // `system/cache`). That is a different input shape from #6136 (no `{@link}`
    // is involved) and it is filed separately; asserting the broken spelling
    // here would ratify it, so this case steers around it the way #5059's did.
    const source = [
      '/**',
      ' * The connector lives in integration/connector.zod.ts today.',
      ' */',
      '',
      "import { z } from 'zod';",
      '',
    ].join('\n');
    expect(renderFileDescription(source, ctx)).toBe(
      'The connector lives in [integration/connector.zod.ts](/docs/references/integration/connector) today.',
    );
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

/**
 * The corpus half of #5553 / #6136: re-derive both verdicts from the real
 * sources, so a future header cannot quietly re-acquire either defect.
 *
 * These assert on the RENDERED fragment rather than on the emitted `.mdx`, for
 * the same reason the selection half does — running the whole generator and
 * grepping its artifact is how both defects survived on `main` in the first
 * place.
 */
describe('corpus — every rendered description is well-formed markdown', () => {
  // `build-docs.ts` derives its category map from exactly this directory
  // listing (`CATEGORIES`, build-docs.ts:129), so this is the real mapping and
  // not a stand-in that could disagree with the generator.
  const categories = new Set(
    fs.readdirSync(SRC_DIR, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name),
  );
  const ctx = {
    sourcePathToDocsRoute: (target: string) => {
      const m = target.match(/(?:^|\/)([\w-]+)\/([\w.-]+)\.zod\.ts$/);
      return m && categories.has(m[1]) ? `/docs/references/${m[1]}/${m[2]}` : null;
    },
  };

  const zodFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.zod.ts')) zodFiles.push(p);
    }
  };
  walk(SRC_DIR);

  const described = zodFiles
    .map(file => ({ rel: path.relative(SRC_DIR, file), out: renderFileDescription(fs.readFileSync(file, 'utf-8'), ctx) }))
    .filter(d => d.out !== '');

  /** The description with fenced code blocks removed. */
  const withoutFences = (out: string) => {
    let fenced = false;
    return out
      .split('\n')
      .map(line => {
        if (/^\s*(?:`{3,}|~{3,})/.test(line)) { fenced = !fenced; return ''; }
        return fenced ? '' : line;
      })
      .join('\n');
  };

  it('finds descriptions to check', () => {
    expect(described.length).toBeGreaterThan(150);
  });

  it('never cuts an inline code span in half (#5553)', () => {
    // A code span cannot cross a blank line, so within one PARAGRAPH the
    // backticks have to pair. Counting per LINE — the scan the issue proposed —
    // stopped being the right question once spans were allowed to wrap again:
    // it now flags the four spans that correctly span lines.
    const offenders: string[] = [];
    for (const { rel, out } of described) {
      for (const para of withoutFences(out).split(/\n\s*\n/)) {
        if ((para.match(/`/g) ?? []).length % 2 === 1) offenders.push(`${rel}: ${para.trim().slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never prints a backslash escape inside code, where it is content (#5553)', () => {
    const offenders: string[] = [];
    for (const { rel, out } of described) {
      let fenced = false;
      for (const line of out.split('\n')) {
        if (/^\s*(?:`{3,}|~{3,})/.test(line)) { fenced = !fenced; continue; }
        const code = fenced || /^ {4,}\S/.test(line)
          ? [line]
          : line.match(/`[^`]*`/g) ?? [];
        if (code.some(c => /\\[{}]/.test(c))) offenders.push(`${rel}: ${line.trim().slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never leaves a brace where MDX would parse it as an expression', () => {
    // The other half of "escape only in prose": every `{` that is NOT inside a
    // code span or a fenced block has to arrive escaped, or the docs build dies
    // with "Could not parse expression with acorn". This is the assertion that
    // catches an indented code block left indented — MDX has no such construct,
    // so its braces reach the compiler as prose.
    const offenders: string[] = [];
    for (const { rel, out } of described) {
      const bare = withoutFences(out)
        .replace(/`[^`]*`/g, '') // inline code spans are literal in MDX
        .replace(/\\[{}]/g, ''); // already escaped
      if (/[{}]/.test(bare)) offenders.push(`${rel}: ${bare.match(/.{0,40}[{}].{0,20}/)?.[0].trim()}`);
    }
    expect(offenders).toEqual([]);
  });

  it('never emits an indented code block — MDX has no such construct', () => {
    const offenders: string[] = [];
    for (const { rel, out } of described) {
      let fenced = false;
      let prevBlank = true;
      for (const line of out.split('\n')) {
        if (/^\s*(?:`{3,}|~{3,})/.test(line)) { fenced = !fenced; prevBlank = false; continue; }
        if (!fenced && prevBlank && /^ {4,}\S/.test(line)) offenders.push(`${rel}: ${line.slice(0, 60)}`);
        prevBlank = line.trim() === '';
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never nests a markdown link inside a markdown link (#6136)', () => {
    const offenders: string[] = [];
    for (const { rel, out } of described) {
      // A link whose TEXT still contains link syntax — the published shape was
      // `[../[path](route)](route)`.
      if (/\[[^\]]*\]\([^)]*\)\]\(/.test(out) || /\[[^\][]*\[[^\]]*\]\(/.test(out)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps a description for every source that had one — #6134 selection is untouched', () => {
    // The rendering fix must not remove a page's opening paragraph; that is
    // #5059's acceptance criterion and it still binds. 185 sources carry a
    // module header, and all 185 still render one.
    expect(described.length).toBe(
      zodFiles.filter(f => findModuleDocBlock(fs.readFileSync(f, 'utf-8')) !== null).length,
    );
  });
});
