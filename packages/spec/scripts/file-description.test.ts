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

/**
 * What `build-docs.ts` passes as `sectionLevel` — a reference page's top-level
 * sections sit at 2, because its `<h1>` is the frontmatter `title` (#12249).
 *
 * Named once here so every case below renders the block the way the generator
 * really does. The cases that are ABOUT the level state their own number
 * inline instead, so that a change to the page layout cannot quietly rewrite
 * what they assert.
 */
const PAGE_SECTION_LEVEL = 2;

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
    // `api/analytics.zod.ts`, as it really is on `main`. `lazify-schemas.ts`
    // inserts its import after the leading run of comments and imports — and
    // that run swallows a doc block, so a header can end up with imports on
    // both sides. It is still a header, and the banner is why: the block was
    // not sitting against the declaration before the codemod ran either.
    //
    // ⚠️ This case used to be written WITHOUT the banner, and that reduction
    // dropped the one line carrying the verdict (#13263) — see the case below,
    // which is that bannerless shape and now asserts the opposite.
    const source = [
      "import { z } from 'zod';",
      '',
      '/**',
      ' * Analytics API Protocol',
      ' */',
      '',
      '// ==========================================',
      '// 1. API Endpoints',
      '// ==========================================',
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

/**
 * #13263 — an injected import is not a separator.
 *
 * `lazify-schemas.ts` injects its `lazySchema` import at the END of the file's
 * leading run of comments, blank lines and imports, and its regex for that run
 * counts a doc block among the comments. A module written as an import, a blank
 * line, `Service Status Enum` and then `export const ServiceStatus` therefore
 * came out of the codemod with the import BETWEEN the block and its symbol —
 * and condition 3, which skipped only blank lines, then read the block as
 * documenting nothing. 28 reference pages opened with one schema's comment, and
 * `gen:skill-refs` copied each first line into the published skill indexes.
 *
 * The tightening applies only INSIDE the import block and stops at a comment of
 * any kind, which is what the four `keeps` cases below pin: without the first
 * limb, three real headers written above their imports go blank; without the
 * second, `api/analytics` does (and `system/cache` did, until #13334 put its
 * selection on the `@module` marker instead — the describe after this one).
 *
 * MEASURED over `packages/spec/src` (193 sources, base `3322527f`): 28 pages
 * lose a misattributed opening, 0 change to a different block, 165 are
 * byte-identical. The corpus limb at the end of this file re-derives that
 * rather than restating it.
 */
describe('findModuleDocBlock — #13263: an import injected between a block and its symbol', () => {
  it('rejects a block the codemod separated from the declaration it documents', () => {
    // `api/discovery.zod.ts`, `data/field.zod.ts`, and 26 more. This is the
    // previous case's source with the banner removed — the whole difference.
    const source = [
      "import { z } from 'zod';",
      '',
      '/**',
      ' * Service Status Enum',
      ' * Describes the operational state of a service in the discovery response.',
      ' */',
      "import { lazySchema } from '../shared/lazy-schema';",
      "export const ServiceStatus = z.enum(['available', 'stub']);",
      '',
    ].join('\n');
    expect(findModuleDocBlock(source)).toBeNull();
  });

  it('rejects it across a blank line and several injected imports', () => {
    // `automation/flow.zod.ts` has five between the block and `FlowNodeAction`;
    // `data/object.zod.ts` six. Distance in plumbing lines is not a signal.
    const source = [
      "import { z } from 'zod';",
      "import { ProtectionSchema } from '../shared/protection.zod';",
      '',
      '/**',
      ' * Flow Node Types — built-in seed set (ADR-0018).',
      ' */',
      "import { lazySchema } from '../shared/lazy-schema';",
      "import { retiredKey } from '../shared/retired-key';",
      "import { strictObject } from '../shared/strict-object';",
      '',
      "export const FlowNodeAction = z.enum(['start', 'end']);",
      '',
    ].join('\n');
    expect(findModuleDocBlock(source)).toBeNull();
  });

  it('rejects it across a MULTI-LINE import — continuation lines are plumbing too', () => {
    // `data/document.zod.ts` and `kernel/execution-context.zod.ts` reach their
    // declaration only over a wrapped import's `Foo,` and `} from '…';` lines.
    const source = [
      "import { z } from 'zod';",
      '',
      '/**',
      ' * Document Version Schema',
      ' */',
      'import {',
      '  MetadataProtectionFields,',
      '  ProtectionSchema,',
      "} from '../kernel/metadata-protection.zod';",
      'export const DocumentVersionSchema = z.object({});',
      '',
    ].join('\n');
    expect(findModuleDocBlock(source)).toBeNull();
  });

  it('keeps a header written ABOVE the imports, even with a declaration right after them', () => {
    // `system/doc.zod.ts`, `cloud/template-manifest.zod.ts`,
    // `api/error-code-ledger.zod.ts`. The codemod injects AFTER the last
    // import, so a block preceding every import preceded them beforehand too —
    // the position is the proof, and dropping this limb blanks all three.
    const source = [
      '// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.',
      '',
      '/**',
      ' * Package Documentation Metadata Protocol (ADR-0046)',
      ' */',
      '',
      "import { z } from 'zod';",
      "import { lazySchema } from '../shared/lazy-schema';",
      '',
      'export const DocSchema = z.object({});',
      '',
    ].join('\n');
    expect(opening(findModuleDocBlock(source))).toBe('Package Documentation Metadata Protocol (ADR-0046)');
  });

  it('keeps a marked header inside the imports when the next schema carries its own JSDoc', () => {
    // `system/cache.zod.ts`, as #13334 left it: a block inside the import list
    // with a comment on the far side is the position no structural signal can
    // decide (see the #13334 describe below), so the real header now carries
    // `@module` — and that marker, not the far-side comment, is what selects it.
    const source = [
      "import { z } from 'zod';",
      "import { CronExpressionInputSchema } from '../shared/expression.zod';",
      '',
      '/**',
      ' * @module system/cache',
      ' *',
      ' * Application-Level Cache Protocol',
      ' */',
      "import { lazySchema } from '../shared/lazy-schema';",
      '',
      '/** Cache eviction strategy. */',
      "export const CacheStrategySchema = z.enum(['lru']);",
      '',
    ].join('\n');
    expect(opening(findModuleDocBlock(source))).toBe('@module system/cache');
  });

  it('keeps a block with no declaration on the far side at all', () => {
    // A module that is nothing but re-exports — the plumbing runs to the end of
    // the file, so there is no symbol for the block to have been torn from.
    // #13334's marker gate deliberately leaves this shape alone: with no symbol
    // anywhere beyond, the block cannot be a detached symbol doc, so it selects
    // bare.
    const source = [
      "import { z } from 'zod';",
      '',
      '/**',
      ' * Environment Artifact Envelope — re-export',
      ' */',
      "export { EnvironmentArtifactSchema } from './artifact.zod';",
      "export type { EnvironmentArtifact } from './artifact.zod';",
      '',
    ].join('\n');
    expect(opening(findModuleDocBlock(source))).toBe('Environment Artifact Envelope — re-export');
  });
});

/**
 * #13334 — inside the import list, only `@module` selects.
 *
 * The position #13263 could not decide: a block with imports before it, an
 * import the FIRST thing after it, and a comment beyond that plumbing. Two
 * genuine headers (`system/cache`, `shared/mapping`) and eight detached symbol
 * docs (`ai/agent`, `data/datasource`, `data/hook`, `security/permission`,
 * `ui/action`, `ui/app`, `ui/component`, `ui/page`) sat there structurally
 * identical — #13334 measured every positional signal (line number, imports
 * before, block length, whether the next declaration has its own JSDoc) and
 * none separates them; only the prose differs, and a prose pattern check is the
 * approach `file-description.ts`'s own header rejects with the measurement
 * behind the rejection. So the rule asks the author: the explicit `@module`
 * marker — already this repo's spelling for a module header, fourteen sources
 * above their imports open with it — decides, in both directions.
 */
describe('findModuleDocBlock — #13334: inside the import list, only `@module` selects', () => {
  // `ui/page.zod.ts` as #13263 left it, reduced: the block reads like (and is)
  // one schema's doc, the injected import sits against it, and the next thing
  // beyond the plumbing is another doc block. Under the far-side-comment rule
  // this was SELECTED — the eighth published page opening with `Page Region
  // Schema`.
  const unmarked = [
    "import { z } from 'zod';",
    '',
    '/**',
    ' * Page Region Schema',
    ' * A named region in the template where components are dropped.',
    ' */',
    "import { lazySchema } from '../shared/lazy-schema';",
    '',
    '/** Shared history for this file. */',
    "const PAGE_HISTORY = 'Until this shape was closed…';",
    '',
    'export const PageRegionSchema = lazySchema(() => strictObject({}));',
    '',
  ].join('\n');

  it('rejects an unmarked block inside the import list, comment on the far side or not', () => {
    expect(findModuleDocBlock(unmarked)).toBeNull();
  });

  it('selects the byte-identical block once it carries `@module` — the minimal pair', () => {
    const marked = unmarked.replace(' * Page Region Schema', ' * @module ui/page\n *\n * Page Region Schema');
    expect(opening(findModuleDocBlock(marked))).toBe('@module ui/page');
  });

  it('lets `@module` decide even with a declaration on the far side of the plumbing', () => {
    // The marker is the author's explicit declaration, and explicit beats
    // inferred: a marked header whose next schema happens to be undocumented
    // must not go blank the day that schema loses its JSDoc.
    const source = [
      "import { z } from 'zod';",
      '',
      '/**',
      ' * @module system/example',
      ' *',
      ' * Example Protocol',
      ' */',
      "import { lazySchema } from '../shared/lazy-schema';",
      '',
      'export const ExampleSchema = lazySchema(() => z.object({}));',
      '',
    ].join('\n');
    expect(opening(findModuleDocBlock(source))).toBe('@module system/example');
  });

  it('reads an `@module` inside a fenced example as content, never as the marker', () => {
    // The predicate runs through `classifyLines`, the same model of "which
    // lines are code" the renderer uses — an author ILLUSTRATING the convention
    // must not thereby publish the block they illustrated it in.
    const source = [
      "import { z } from 'zod';",
      '',
      '/**',
      ' * Widget Config Schema',
      ' *',
      ' * ```ts',
      ' * @module not/a/marker',
      ' * ```',
      ' */',
      "import { lazySchema } from '../shared/lazy-schema';",
      '',
      '/** The widget. */',
      'export const WidgetSchema = lazySchema(() => z.object({}));',
      '',
    ].join('\n');
    expect(findModuleDocBlock(source)).toBeNull();
  });

  it('reads a mid-sentence mention of the tag as prose about it, never as the marker', () => {
    const source = [
      "import { z } from 'zod';",
      '',
      '/**',
      ' * Widget Config Schema — needs no @module marker to look like one.',
      ' */',
      "import { lazySchema } from '../shared/lazy-schema';",
      '',
      '/** The widget. */',
      'export const WidgetSchema = lazySchema(() => z.object({}));',
      '',
    ].join('\n');
    expect(findModuleDocBlock(source)).toBeNull();
  });

  it('still needs no marker ABOVE the imports — the gate is scoped to the ambiguous position', () => {
    // ~180 real headers sit outside the import list and stay untouched; the
    // fixture beside `keeps a module header written above the imports` pins the
    // same thing, and this one pins it against the gate specifically.
    const source = [
      '/**',
      ' * Widget Protocol',
      ' */',
      '',
      "import { z } from 'zod';",
      "import { lazySchema } from '../shared/lazy-schema';",
      '',
      '/** The widget. */',
      'export const WidgetSchema = lazySchema(() => z.object({}));',
      '',
    ].join('\n');
    expect(opening(findModuleDocBlock(source))).toBe('Widget Protocol');
  });
});

describe('renderFileDescription', () => {
  // `fromCategory` is the directory the rendered module lives in (#6484); these
  // cases reference `automation/` and are written as if from there.
  const ctx = {
    fromCategory: 'automation',
    sourcePathToDocsRoute: (t: string) => (t.includes('sync') ? '/docs/references/automation/sync' : null),
    sectionLevel: PAGE_SECTION_LEVEL,
  };

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
 * #10924 — the `check:skill-examples` opt-in marker never reaches the page.
 *
 * That gate marks a compilable docblock example with an HTML comment on the
 * line above its fence. In a `.ts` source it must be the HTML form (the MDX
 * wrapper form would close the JSDoc early), and it is a prose line, so the
 * renderer emitted it verbatim into the generated MDX — measured on
 * `studio/object-designer` and `studio/plugin`, whose marked examples live in
 * the MODULE block rather than on a declaration. MDX has no HTML comments, so
 * that both published an internal annotation to a customer-facing reference
 * page and broke the docs build.
 */
describe('renderFileDescription — #10924: the os:check marker is machinery, not content', () => {
  const ctx = { fromCategory: 'studio', sourcePathToDocsRoute: () => null, sectionLevel: PAGE_SECTION_LEVEL };

  const moduleBlock = (...body: string[]): string =>
    ['/**', ...body.map(l => (l === '' ? ' *' : ` * ${l}`)), ' */', '', "import { z } from 'zod';", ''].join('\n');

  it('drops a marker line above a fence, keeping the example itself', () => {
    const out = renderFileDescription(
      moduleBlock('Studio plugin manifest.', '', '@example', '<!-- os:check -->', '```ts', 'const x = 1;', '```'),
      ctx,
    );
    expect(out).not.toContain('os:check');
    // The block it marked is the content — dropping the marker must not take
    // the example with it, nor detach the fence from its `@example` tag.
    expect(out).toContain('```ts');
    expect(out).toContain('const x = 1;');
    expect(out).toContain('@example');
  });

  it('keeps a marker shown INSIDE a fence — there it is an author illustrating the convention', () => {
    // The same text fenced is documentation ABOUT the gate, which several
    // sources legitimately write. Stripping by text alone would silently edit
    // an author's example; the strip is prose-only for exactly this reason.
    const out = renderFileDescription(
      moduleBlock('How to mark a block:', '', '```md', '<!-- os:check -->', '```ts', '```'),
      ctx,
    );
    expect(out).toContain('<!-- os:check -->');
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
  // Nothing resolves here — these cases are about line layout, not routes — so
  // every path they contain takes the code-span fallback whatever `fromCategory`
  // says.
  const ctx = { fromCategory: 'data', sourcePathToDocsRoute: () => null, sectionLevel: PAGE_SECTION_LEVEL };

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
    // The verbatim inputs below come from `automation/etl.zod.ts` (#6484).
    fromCategory: 'automation',
    sourcePathToDocsRoute: (t: string) =>
      /integration\/connector\.zod\.ts$/.test(t) ? '/docs/references/integration/connector' : null,
    sectionLevel: PAGE_SECTION_LEVEL,
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
    // Spelled WITHOUT a `../` prefix on purpose: when this was written the
    // prefixed spelling was mis-linked by a defect #6136 did not touch, and
    // asserting the broken output here would have ratified it, so the case
    // steered around it the way #5059's did. #6229 has since fixed it — the
    // prefixed spellings are pinned in their own block below, correctly.
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
 * #6229 — a `../` prefix belongs INSIDE the link, not beside it.
 *
 * The rewriter opened with `\b((?:\.\./)?…)`. A word boundary needs a word
 * character on one side and every character of `../` is a non-word one, so the
 * `\b` could never match at the `.`: the match began at the first path segment
 * and the prefix was stranded next to the link it belongs to, published as
 * `See also: ../../[system/cache.zod.ts](route)`.
 *
 * Measured rather than assumed: the prefix group was DEAD for every realistic
 * input, not capped at one level as first recorded. `../x/y.zod.ts` lost its
 * prefix exactly like `../../x/y.zod.ts` did, and the only spelling that ever
 * reached the group was `x../y/z.zod.ts` — a word character before the dots,
 * which nobody writes. So the two halves of the fix are not independent: `?`
 * to `*` alone is a no-op on a group that is never reached, and moving the
 * `\b` alone still strands the outer level of a `../../`. Both cases below
 * therefore pin a spelling that a one-sided fix leaves red.
 *
 * No `{@link}` appears anywhere here — this link is produced entirely by the
 * bare-path step, which is why the shape survived #6136.
 */
describe('renderFileDescription — #6229: a bare path keeps its `../` prefix inside the link', () => {
  const ctx = {
    // Mirrors `build-docs.ts`'s `sourcePathToDocsRoute`: `$`-anchored with a
    // `(?:^|/)` head, so a `../` prefix on the way IN already resolves to the
    // same page. The defect was never in route resolution — only in how much
    // of the path the rewriter handed it.
    //
    // Written as if from `api/` (#6484) — the first verbatim input below is
    // `api/http-cache.zod.ts`. Every path here carries its own category, so
    // none of them is completed and the value only has to be honest.
    fromCategory: 'api',
    sourcePathToDocsRoute: (t: string) => {
      const m = /(?:^|\/)(system|api)\/([\w-]+)\.zod\.ts$/.exec(t);
      return m ? `/docs/references/${m[1]}/${m[2]}` : null;
    },
    sectionLevel: PAGE_SECTION_LEVEL,
  };

  const describedBy = (line: string) =>
    renderFileDescription(['/**', ` * ${line}`, ' */', '', "import { z } from 'zod';", ''].join('\n'), ctx);

  it('keeps a two-level `../../` prefix inside the link', () => {
    // `packages/spec/src/api/http-cache.zod.ts:35` verbatim — the exact input
    // behind `content/docs/references/api/http-cache.mdx`, which published
    // `See also: ../../[system/cache.zod.ts](/docs/references/system/cache) …`.
    expect(describedBy('@see ../../system/cache.zod.ts for application-level caching')).toBe(
      'See also: [../../system/cache.zod.ts](/docs/references/system/cache) for application-level caching',
    );
  });

  it('keeps the `../../` prefix inside the link on the second published page', () => {
    // `packages/spec/src/system/cache.zod.ts:28` verbatim — the other half of
    // the pair, so neither page can regress on its own.
    expect(describedBy('@see ../../api/http-cache.zod.ts for HTTP-level caching')).toBe(
      'See also: [../../api/http-cache.zod.ts](/docs/references/api/http-cache) for HTTP-level caching',
    );
  });

  it('keeps a single-level `../` prefix inside the link', () => {
    // NOT a case that already worked before #6229 — see the block comment. It
    // is pinned because it is the spelling the rest of the corpus uses inside
    // `{@link}` tags, so a bare one is a matter of time.
    expect(describedBy('The application cache lives in ../system/cache.zod.ts today.')).toBe(
      'The application cache lives in [../system/cache.zod.ts](/docs/references/system/cache) today.',
    );
  });

  it('keeps an arbitrarily deep prefix inside the link', () => {
    // `*`, not a second `?`: the depth is whatever the author wrote.
    expect(describedBy('Declared in ../../../system/cache.zod.ts for the record.')).toBe(
      'Declared in [../../../system/cache.zod.ts](/docs/references/system/cache) for the record.',
    );
  });

  it('still links an unprefixed path — the fix must not narrow the common case', () => {
    expect(describedBy('The application cache lives in system/cache.zod.ts today.')).toBe(
      'The application cache lives in [system/cache.zod.ts](/docs/references/system/cache) today.',
    );
  });

  it('prints an unroutable prefixed path as code, prefix included', () => {
    // The null-route fallback has to carry the prefix too, or the page would
    // show `../../` beside a code span the way it used to show it beside a link.
    expect(describedBy('Declared in ../../nowhere/absent.zod.ts for now.')).toBe(
      'Declared in `../../nowhere/absent.zod.ts` for now.',
    );
  });

  it('still refuses to start mid-word', () => {
    // The `\b` moved, it did not go away: `xsystem/…` is one token, so the
    // rewriter must not carve a link out of its tail.
    expect(describedBy('Declared in xsystem/cache.zod.ts for now.')).toBe(
      'Declared in `xsystem/cache.zod.ts` for now.',
    );
  });
});

/**
 * #6420 — a path an author wrote in PARENTHESES is prose, not a link.
 *
 * The rewriter carried a lookaround pair, `(?<!\()` … `(?!\))`, from before the
 * tokenizer existed. Its job was "do not touch a path that is already a link's
 * destination", because `](route)` puts that path between exactly those two
 * characters. It never could state that (lookaround cannot say "not nested
 * inside a link" — the module comment is explicit), and since #6136 it has had
 * nothing left to state: a formed link is a `link` run and this step is only
 * ever shown `text` runs. What the pair still did was refuse every path an
 * author had put in ordinary parentheses, which is neither a link nor code —
 * so those paths rendered as bare text on three published pages:
 *
 *   automation/etl.mdx:16        `- **Enterprise Connector** (integration/connector.zod.ts) - …`
 *   integration/connector.mdx:17 `- **ETL Pipeline** (automation/etl.zod.ts) - …`
 *   shared/mapping.mdx:16-17     `- Integration connectors (integration/connector.zod.ts)` (+ external-lookup)
 *
 * MEASURED (reverse verification), the ordinary direction: putting either
 * guard back turns the four parenthesised cases below red — the two-sided pair
 * and each half on its own, since a path in `(…)` trips both — while the
 * unparenthesised cases and the whole #6229 block above stay green. Restoring
 * them also leaves `keeps a formed link's destination out of reach` green,
 * which is the point of that case: it is the tokenizer that holds the
 * invariant now, so removing the guards cannot re-open #6136.
 *
 * Corpus-wide the widening is exactly those four positions and nothing else
 * (`gen:docs` on the fixed generator: 231 files, 3 changed, 4 lines), and all
 * three routes it newly emits resolve to a real page.
 */
describe('renderFileDescription — #6420: a bare path in parentheses still links', () => {
  const ctx = {
    // Mirrors `build-docs.ts`'s `sourcePathToDocsRoute`, restricted to the two
    // categories these cases name, so an unroutable path is genuinely
    // unroutable rather than a stand-in that resolves everything.
    //
    // Written as if from `automation/` (#6484), which is where the first
    // verbatim input below lives. Every path here is category-qualified, so
    // none is completed.
    fromCategory: 'automation',
    sourcePathToDocsRoute: (t: string) => {
      const m = /(?:^|\/)(integration|automation)\/([\w-]+)\.zod\.ts$/.exec(t);
      return m ? `/docs/references/${m[1]}/${m[2]}` : null;
    },
    sectionLevel: PAGE_SECTION_LEVEL,
  };

  const describedBy = (line: string) =>
    renderFileDescription(['/**', ` * ${line}`, ' */', '', "import { z } from 'zod';", ''].join('\n'), ctx);

  it('links a parenthesised path — the published `automation/etl` line', () => {
    // `packages/spec/src/automation/etl.zod.ts` verbatim — the exact input
    // behind `content/docs/references/automation/etl.mdx:16`.
    expect(
      describedBy('- **Enterprise Connector** (integration/connector.zod.ts) - System integrators'),
    ).toBe(
      '- **Enterprise Connector** ([integration/connector.zod.ts](/docs/references/integration/connector)) - System integrators',
    );
  });

  it('links a parenthesised path that closes the line — the `shared/mapping` shape', () => {
    // `content/docs/references/shared/mapping.mdx:16`. Distinct from the case
    // above on purpose: there the `)` is followed by more prose, here it ends
    // the line, and the trailing guard `(?!\))` refused both.
    expect(describedBy('- Integration connectors (integration/connector.zod.ts)')).toBe(
      '- Integration connectors ([integration/connector.zod.ts](/docs/references/integration/connector))',
    );
  });

  it('keeps a `../` prefix inside the link when the path is parenthesised', () => {
    // #6229 and this fix compose: the prefix belongs inside the link, and the
    // parentheses stay outside it. Neither fix implies the other.
    expect(describedBy('The layer (../integration/connector.zod.ts) is the widest.')).toBe(
      'The layer ([../integration/connector.zod.ts](/docs/references/integration/connector)) is the widest.',
    );
  });

  it('prints an unroutable parenthesised path as code, never as a dead link', () => {
    // Widening the rewriter must not widen what it is willing to LINK. A path
    // with no page still falls back to a code span, so the parentheses can
    // never produce a 404 on the site.
    expect(describedBy('Nothing here (nowhere/absent.zod.ts) resolves.')).toBe(
      'Nothing here (`nowhere/absent.zod.ts`) resolves.',
    );
  });

  it('still links the same path outside parentheses — the fix widens, it does not move', () => {
    // The vacuity guard for the four cases above. Each of them asserts an
    // OUTPUT for a path in parentheses; if this `ctx` had stopped resolving
    // that path, the parenthesised cases could have been written around a
    // code-span fallback and passed while proving nothing. Pinning the same
    // path unparenthesised fixes the only variable to the parentheses.
    expect(describedBy('The layer integration/connector.zod.ts is the widest.')).toBe(
      'The layer [integration/connector.zod.ts](/docs/references/integration/connector) is the widest.',
    );
  });

  it('keeps a formed link destination out of reach — the tokenizer, not the guards', () => {
    // The case the deleted lookaround was actually written for, and the reason
    // deleting it is safe. A titled `{@link}` whose target has no page emits
    // `[label](../nowhere/absent.zod.ts)`: the raw path is now a link
    // DESTINATION, sitting between the very `(` and `)` the guards tested for.
    // With them gone the only thing standing between that path and a second
    // rewrite is #6136's tokenizer, which classifies the whole construct as a
    // `link` run this step is never shown. Were that protection to regress,
    // this case reports `[the fallback](\`../nowhere/absent.zod.ts\`)` — the
    // #6136 shape — while every other case here stays green.
    expect(describedBy('See {@link ../nowhere/absent.zod.ts|the fallback} for now.')).toBe(
      'See [the fallback](../nowhere/absent.zod.ts) for now.',
    );
  });
});

/**
 * #6484 — a path written relative to the module's OWN directory.
 *
 * Both halves of the mechanism used to require a directory segment: the
 * rewriter's `[\w-]+/` group was mandatory, and `sourcePathToDocsRoute` read
 * the segment before the slash as the category. So a module referring to a
 * neighbour the way authors actually write it — `auth.zod.ts`, not
 * `identity/auth.zod.ts` — matched nothing on either side and fell through as
 * plain prose. Not a link, and not the code-span fallback either: nine such
 * references on four published pages (`api/realtime-shared:19,21`,
 * `cloud/package:17,18`, `identity/identity:13`,
 * `system/security-context:14,16,17,18`), which is the one outcome of the three
 * that is simply wrong.
 *
 * The missing input was never the regex, it was the context: `build-docs.ts`
 * iterates BY CATEGORY and knows exactly which directory it is rendering, and
 * handed `renderFileDescription` a context object with one member that did not
 * include it. `fromCategory` is that member, and the completion happens on this
 * side of the seam on purpose — a bare filename is not an identity (#4696), so
 * a resolver that searched every category for one would answer with whichever
 * the directory walk reached last. `auth.zod.ts` below is exactly that
 * collision, pinned in both directions.
 *
 * MEASURED (reverse verification), the ordinary direction: reverting either
 * half — the optional `(?:[\w-]+\/)?` group, or the `completeFromCategory`
 * call — turns every same-directory case here red and leaves every
 * category-qualified case green, which is what the vacuity guard exists to make
 * meaningful.
 *
 * Corpus-wide the widening is exactly those nine positions and nothing else
 * (`gen:docs` on the fixed generator: 231 files, 4 changed, 9 lines): five
 * become links, four become code spans, none stays plain text.
 */
describe('renderFileDescription — #6484: a same-directory path resolves against its own category', () => {
  /**
   * Which pages exist, per category — an explicit set rather than "any file
   * under a real category".
   *
   * That second condition is the whole reason this stand-in is not a one-line
   * regex: `build-docs.ts` used to accept any file name under a real category,
   * which was survivable only while every path the old rewriter could match
   * happened to have a page behind it. Four of the nine references this issue
   * measured name a neighbour that does not exist at all (`identity/auth`,
   * `system/audit`, `system/compliance`, `system/masking`), so a stand-in that
   * resolved them would let a dead link pass for a fix.
   */
  const PAGES: Record<string, readonly string[]> = {
    api: ['auth', 'realtime', 'realtime-shared', 'websocket'],
    cloud: ['environment-package', 'package', 'package-version'],
    identity: ['identity', 'organization'],
    system: ['cache', 'encryption', 'security-context'],
  };

  // Mirrors `build-docs.ts`'s `sourcePathToDocsRoute`, both conditions: a real
  // category AND a page this run publishes.
  const sourcePathToDocsRoute = (t: string) => {
    const m = /(?:^|\/)([\w-]+)\/([\w.-]+)\.zod\.ts$/.exec(t);
    return m && PAGES[m[1]]?.includes(m[2]) ? `/docs/references/${m[1]}/${m[2]}` : null;
  };

  const describedBy = (fromCategory: string, line: string) =>
    renderFileDescription(
      ['/**', ` * ${line}`, ' */', '', "import { z } from 'zod';", ''].join('\n'),
      { fromCategory, sourcePathToDocsRoute, sectionLevel: PAGE_SECTION_LEVEL },
    );

  it('links a same-directory path whose page exists — the published `api/realtime-shared` line', () => {
    // `packages/spec/src/api/realtime-shared.zod.ts:17` verbatim — the exact
    // input behind `content/docs/references/api/realtime-shared.mdx:19`, which
    // published the file name as prose.
    expect(describedBy('api', '@see realtime.zod.ts for transport-layer configuration')).toBe(
      'See also: [realtime.zod.ts](/docs/references/api/realtime) for transport-layer configuration',
    );
  });

  it('links a same-directory path mid-sentence — the published `cloud/package` line', () => {
    // `packages/spec/src/cloud/package.zod.ts:15` verbatim. A different
    // position from the `@see` case above (inside a list item, in ordinary
    // parentheses), so neither published page can regress on its own.
    expect(
      describedBy('cloud', '- `sys_package_version` — immutable release snapshots (see package-version.zod.ts)'),
    ).toBe(
      '- `sys_package_version` — immutable release snapshots (see [package-version.zod.ts](/docs/references/cloud/package-version))',
    );
  });

  it('prints a same-directory path with NO page as code, never as a dead link', () => {
    // `packages/spec/src/identity/identity.zod.ts:11` verbatim. There is no
    // `packages/spec/src/identity/auth.zod.ts` and no `identity/auth` page, so
    // #6229's rule decides this: no page, no link. Widening the match without
    // this arm would have published a confident link to a 404 — strictly worse
    // than the plain text it replaces.
    expect(
      describedBy('identity', 'This is separate from authentication configuration (auth.zod.ts) which'),
    ).toBe('This is separate from authentication configuration (`auth.zod.ts`) which');
  });

  it('resolves the SAME bare name differently in a different category (#4696)', () => {
    // The pair that rules out searching every category for a bare filename, and
    // the reason the completion lives on the caller's side of the seam. `auth`
    // is a real page under `api` and no page at all under `identity`: a
    // resolver handed the bare name alone could only answer one of these two
    // correctly, and which one would depend on directory-walk order.
    expect(describedBy('api', 'Configuration lives in auth.zod.ts today.')).toBe(
      'Configuration lives in [auth.zod.ts](/docs/references/api/auth) today.',
    );
    expect(describedBy('identity', 'Configuration lives in auth.zod.ts today.')).toBe(
      'Configuration lives in `auth.zod.ts` today.',
    );
  });

  it('renders both outcomes from one authored list — the `system/security-context` lines', () => {
    // `packages/spec/src/system/security-context.zod.ts:16,18` verbatim, the
    // two neighbouring bullets of one list: `audit` was removed and has no
    // page, `encryption` survives and has one. Same shape, same line layout,
    // opposite verdicts — which is what "no occurrence stays plain text" means
    // in practice, as against "all nine become links".
    expect(
      describedBy('system', '- **Audit** (audit.zod.ts — REMOVED): the live audit path is plugin-audit’s'),
    ).toBe('- **Audit** (`audit.zod.ts` — REMOVED): the live audit path is plugin-audit’s');
    expect(
      describedBy('system', '- **Encryption** (encryption.zod.ts): Field-level encryption and key management'),
    ).toBe(
      '- **Encryption** ([encryption.zod.ts](/docs/references/system/encryption)): Field-level encryption and key management',
    );
  });

  it('completes a bare `{@link}` target the same way — one rule for every position', () => {
    // The tag form and the bare-prose form resolve through the same helper. A
    // relative spelling means the same file whichever one it is written in, so
    // completing only the prose form would make the shape of the tag decide
    // whether a neighbour resolves.
    expect(describedBy('api', 'See {@link realtime.zod.ts} for the transport.')).toBe(
      'See [realtime.zod.ts](/docs/references/api/realtime) for the transport.',
    );
    expect(describedBy('identity', 'See {@link auth.zod.ts} for the configuration.')).toBe(
      'See `auth.zod.ts` for the configuration.',
    );
  });

  it('does NOT complete a `../` spelling — that prefix leaves the category', () => {
    // Composition with #6229, and deliberately not symmetric with it. `../` out
    // of a category directory lands on `packages/spec/src/`, which publishes no
    // pages, so completing `../auth.zod.ts` with `identity` would invent a
    // reference the author did not write. It resolves to nothing and prints as
    // code — still an improvement, since before #6484 this shape matched
    // nothing at all and shipped as plain text.
    expect(describedBy('identity', 'Declared in ../auth.zod.ts for now.')).toBe(
      'Declared in `../auth.zod.ts` for now.',
    );
  });

  it('still keeps a `../../` prefix inside a category-qualified link (#6229 composes)', () => {
    // `packages/spec/src/api/http-cache.zod.ts:35` verbatim. The prefixed,
    // qualified shape is untouched by this change — asserted, not assumed,
    // because both fixes edit the same regex.
    expect(describedBy('api', '@see ../../system/cache.zod.ts for application-level caching')).toBe(
      'See also: [../../system/cache.zod.ts](/docs/references/system/cache) for application-level caching',
    );
  });

  it('still links the same file written WITH its category — the vacuity guard', () => {
    // Without this the cases above could all have been satisfied by a `ctx`
    // that resolves nothing, written around the code-span fallback, and would
    // have proved nothing at all. Pinning the qualified spelling of a file the
    // bare cases also name fixes the only variable to the SHAPE of the path.
    //
    // Both directions of the qualified form: from its own category, and from a
    // foreign one. Neither may depend on `fromCategory` — completion applies to
    // bare names only, so a qualified path resolves identically wherever it is
    // written.
    expect(describedBy('api', 'Configuration lives in api/auth.zod.ts today.')).toBe(
      'Configuration lives in [api/auth.zod.ts](/docs/references/api/auth) today.',
    );
    expect(describedBy('identity', 'Configuration lives in api/auth.zod.ts today.')).toBe(
      'Configuration lives in [api/auth.zod.ts](/docs/references/api/auth) today.',
    );
  });

  it('keeps the directory group capped at ONE segment — the widening is additive', () => {
    // `(?:[\w-]+\/)?`, not `(?:[\w-]+\/)*`. A nested source has always matched
    // from its LAST two segments, leaving the outer directory beside the
    // construct; that shape is #6229's business, not this issue's, and a
    // repeating group would silently change it. Pinned here because the choice
    // is otherwise invisible: both spellings pass every other case in this
    // block.
    expect(describedBy('data', 'Declared in data/driver/postgres.zod.ts for now.')).toBe(
      'Declared in data/`driver/postgres.zod.ts` for now.',
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

  /**
   * #6145 — the other side of #5059's ledger. Six more modules had written a
   * real module introduction and then glued it to their first declaration, so
   * the strict rule (correctly) read it as that symbol's TSDoc and their pages
   * went on opening with nothing. The prose was never the problem; its
   * attachment was. Each block was promoted VERBATIM to a true module header,
   * and this pins the result per file.
   *
   * Deliberately an assertion about the six SOURCES, not about the emitted
   * `.mdx`: `check:docs` compares the artifact to the source, so it stays green
   * while a re-glued header quietly empties the page — which is exactly how the
   * original six survived two rounds on `main`.
   */
  it('opens each of the six #6145 modules with its own module header', () => {
    const openingOf = (rel: string) =>
      opening(findModuleDocBlock(fs.readFileSync(path.join(SRC_DIR, rel), 'utf-8')));

    expect(openingOf('data/driver/postgres.zod.ts'))
      .toBe('PostgreSQL driver configuration — the `config` slot of a `datasource` whose');
    expect(openingOf('data/driver/mysql.zod.ts'))
      .toBe('MySQL / MariaDB driver configuration — the `config` slot of a `datasource`');
    expect(openingOf('data/driver/sqlite.zod.ts'))
      .toBe('SQLite driver configuration — the `config` slot of a `datasource` whose');
    expect(openingOf('cloud/template-manifest.zod.ts'))
      .toBe('`objectstack.manifest.json` — on-disk descriptor for a template / package');
    expect(openingOf('system/doc.zod.ts'))
      .toBe('Package Documentation Metadata Protocol (ADR-0046)');
    expect(openingOf('api/error-code-ledger.zod.ts'))
      .toBe('Error-Code Ledger (ADR-0112 D3).');
  });

  /**
   * #13263's corpus limb — the half that cannot rot.
   *
   * Re-derives the verdict from the real tree instead of restating a file list:
   * a selected block that sits inside the import block must have a COMMENT on
   * the far side of that plumbing, never a declaration. A source that acquires
   * the codemod shape later cannot quietly re-acquire a wrong page description,
   * and the three headers written above their imports are pinned by name in the
   * `#6145` case above, so neither direction can drift alone.
   */
  it('never selects a block with a declaration on the far side of the imports', () => {
    const PLUMBING = /^(?:import\b|export\s*(?:\*|\{|type\s*\{))/;
    const offenders: string[] = [];
    for (const file of zodFiles) {
      const source = fs.readFileSync(file, 'utf-8');
      const block = findModuleDocBlock(source);
      if (block === null) continue;
      const lines = source.split('\n');
      const marker = `/**${block}*/`;
      const at = source.indexOf(marker);
      if (at < 0) continue; // already reported by the case above
      const startLine = source.slice(0, at).split('\n').length - 1;
      const endLine = startLine + marker.split('\n').length - 1;
      if (!lines.slice(0, startLine).some(l => PLUMBING.test(l))) continue; // above the imports

      for (let i = endLine + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') continue;
        if (line.trimStart().startsWith('/')) break; // a comment ends the preamble
        if (PLUMBING.test(line)) continue;
        if (!/^[A-Za-z_$@]/.test(line)) continue; // continuation / closing punctuation
        offenders.push(`${path.relative(SRC_DIR, file)} → ${line.slice(0, 60)}`);
        break;
      }
    }
    expect(offenders).toEqual([]);
  });

  it('publishes no description for the modules whose opening was one schema\'s doc', () => {
    const openingOf = (rel: string) =>
      opening(findModuleDocBlock(fs.readFileSync(path.join(SRC_DIR, rel), 'utf-8')));

    // Four of the 28, one per shape: the plain single injected import, the run
    // of five, the wrapped import, and the one whose page-wide blast radius the
    // card measured (`gen:skill-refs` shipped `Field Type Enum` as the pointer
    // row for a module of ~40 field schemas).
    expect(openingOf('api/discovery.zod.ts')).toBeNull();
    expect(openingOf('automation/flow.zod.ts')).toBeNull();
    expect(openingOf('kernel/execution-context.zod.ts')).toBeNull();
    expect(openingOf('data/field.zod.ts')).toBeNull();
  });

  /**
   * #13334's corpus limb — the half that cannot rot.
   *
   * Re-derives the marker gate from the real tree: a SELECTED block that sits
   * inside the import list — plumbing somewhere before it, plumbing the first
   * thing after it — must carry `@module` on a prose line, unless nothing but
   * plumbing and blanks follows it to the end of the file. A source that
   * drifts back into the ambiguous position (the lazify codemod's insertion
   * point is exactly there) cannot quietly re-acquire a wrong page opening:
   * unmarked, it renders no description at all.
   */
  it('never selects an unmarked block inside the import list (#13334)', () => {
    const PLUMBING = /^(?:import\b|export\s*(?:\*|\{|type\s*\{))/;
    const offenders: string[] = [];
    for (const file of zodFiles) {
      const source = fs.readFileSync(file, 'utf-8');
      const block = findModuleDocBlock(source);
      if (block === null) continue;
      const marker = `/**${block}*/`;
      const at = source.indexOf(marker);
      if (at < 0) continue; // already reported by the first corpus case
      const lines = source.split('\n');
      const startLine = source.slice(0, at).split('\n').length - 1;
      const endLine = startLine + marker.split('\n').length - 1;
      if (!lines.slice(0, startLine).some(l => PLUMBING.test(l))) continue; // above the imports
      const next = lines.slice(endLine + 1).find(l => l.trim() !== '') ?? '';
      if (!PLUMBING.test(next)) continue; // a comment or declaration against the block decides for itself
      // The same walk the selector runs: over blanks and plumbing, does
      // anything but the end of the file lie beyond? A comment or a
      // declaration both count — only a pure re-export tail selects bare.
      const runsToEof = lines.slice(endLine + 1).every(
        l => l.trim() === '' || (PLUMBING.test(l) || (!l.trimStart().startsWith('/') && !/^[A-Za-z_$@]/.test(l))),
      );
      const marked = block.split('\n').some(l => /^@module\b/.test(l.replace(/^\s*\*\s?/, '')));
      if (!marked && !runsToEof) {
        offenders.push(path.relative(SRC_DIR, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('opens `system/cache` and `shared/mapping` with their marked headers (#13334)', () => {
    // The two genuine headers the ambiguous position held; each now carries
    // the one-line `@module` marker, and the gate is what makes that marker
    // load-bearing rather than decorative.
    const openingOf = (rel: string) =>
      opening(findModuleDocBlock(fs.readFileSync(path.join(SRC_DIR, rel), 'utf-8')));
    expect(openingOf('system/cache.zod.ts')).toBe('@module system/cache');
    expect(openingOf('shared/mapping.zod.ts')).toBe('@module shared/mapping');
  });

  it('publishes no description for the eight modules whose opening was one schema\'s doc (#13334)', () => {
    // The corpus half of route ② — each of the eight had a symbol's comment
    // wedged into its import list by the lazify codemod, published as the
    // page's opening and as the module's skill-index pointer row. The comments
    // moved back to the declarations they document (or to the family they
    // head), so no block sits in the header zone documenting nothing: the page
    // honestly prints no description. 宁可缺,不要错.
    const openingOf = (rel: string) =>
      opening(findModuleDocBlock(fs.readFileSync(path.join(SRC_DIR, rel), 'utf-8')));
    for (const rel of [
      'ai/agent.zod.ts',
      'data/datasource.zod.ts',
      'data/hook.zod.ts',
      'security/permission.zod.ts',
      'ui/action.zod.ts',
      'ui/app.zod.ts',
      'ui/component.zod.ts',
      'ui/page.zod.ts',
    ]) {
      expect(openingOf(rel), rel).toBeNull();
    }
  });
});

/**
 * #12249 — a module header's heading levels belong to the PAGE, not to the file.
 *
 * A `.zod.ts` header is written as if it were a standalone document, so its
 * author opens a section with `# `. Embedded in a reference page that compiles
 * to a SECOND `<h1>`, because `DocsTitle` already renders the frontmatter
 * `title` as the page's heading-one. Measured on `main` at `20b0fdb56`: 38 of
 * the 190 described modules, 43 headings between them (41 distinct texts) — and
 * the whole `content/docs/references/**` tree carved out of
 * `scripts/check-docs-single-h1.mjs` because the fix could not live there.
 *
 * The renderer places the block's SHALLOWEST heading at `ctx.sectionLevel` and
 * moves the rest with it. The three cases that shape pins are the three ways
 * the obvious "rewrite every `# ` to `## `" goes wrong: it demotes blocks that
 * were already correct, it collides two source levels into one wherever a block
 * mixes them, and — the expensive one — it cannot tell a heading from a shell
 * comment inside a fence.
 *
 * MEASURED (reverse verification), the ordinary direction: replacing the
 * `withHeadingsAtSectionLevel` call in `renderFileDescription` with the
 * identity turns 9 of these 70 cases red — every level-1 case here, plus both
 * corpus limbs, the first of them reporting exactly the 43 headings the issue
 * measured on `main`. The two cases about what the shift must NOT touch —
 * `already start at level 2` and `#NoSpace` — stay green, and so do the 61
 * cases this file already had. That asymmetry is what says the pin measures the
 * shift and not the renderer at large.
 */
describe('renderFileDescription — #12249: the fragment starts at the page\'s section level', () => {
  const ctx = { fromCategory: 'data', sourcePathToDocsRoute: () => null, sectionLevel: PAGE_SECTION_LEVEL };

  const moduleBlock = (...body: string[]): string =>
    ['/**', ...body.map(l => (l === '' ? ' *' : ` * ${l}`)), ' */', '', "import { z } from 'zod';", ''].join('\n');

  it('demotes a level-1 heading to the page\'s section level', () => {
    // `data/context-tokens.zod.ts:10` verbatim — the line the issue opened
    // with, published as `content/docs/references/data/context-tokens.mdx:11`.
    expect(renderFileDescription(moduleBlock('# Why this lives in `spec`', '', 'Prose.'), ctx)).toBe(
      '## Why this lives in `spec`\n\nProse.',
    );
  });

  it('moves the whole block, keeping the nesting the author wrote', () => {
    // The reason this is a renumbering and not a per-line rewrite: `# ` and
    // `## ` in one block are two levels, and collapsing both onto `## ` would
    // make a section its own subsection's sibling.
    expect(
      renderFileDescription(moduleBlock('# Top', '', 'Prose.', '', '## Under it', '', 'More prose.'), ctx),
    ).toBe('## Top\n\nProse.\n\n### Under it\n\nMore prose.');
  });

  it('leaves a description whose headings already start at level 2 byte-identical', () => {
    // 26 of the 64 described modules with headings are in this state
    // (`api/http-cache`, `automation/control-flow`, …). A blanket `#`→`##`
    // would have regenerated all 26 pages to no purpose, and pushed
    // `automation/control-flow`'s `###` to a fourth level.
    const source = moduleBlock('## A section', '', 'Prose.', '', '### Nested', '', 'More prose.');
    expect(renderFileDescription(source, ctx)).toBe('## A section\n\nProse.\n\n### Nested\n\nMore prose.');
    // The identity render is the same string, which is what "untouched" means.
    expect(renderFileDescription(source, { ...ctx, sectionLevel: 1 })).toBe(renderFileDescription(source, ctx));
  });

  it('never touches a `# ` inside a fenced block — it is a shell comment, not a heading', () => {
    // THE control, and the reason the shift lives beside `classifyLines`
    // instead of running as a regex over the emitted string in `build-docs.ts`.
    // A fence-blind pass rewrites working snippets to satisfy a rule about HTML
    // those lines never produce — the false positive `check-docs-single-h1.mjs`
    // measures at ten pages and calls more expensive than the defect itself.
    const out = renderFileDescription(
      moduleBlock('# Setup', '', '```bash', '# Install pnpm globally', 'npm i -g pnpm', '```'),
      ctx,
    );
    expect(out).toBe('## Setup\n\n```bash\n# Install pnpm globally\nnpm i -g pnpm\n```');
  });

  it('never touches a `# ` inside an indented block, which is re-emitted as a fence', () => {
    // `data/date-macros` and `data/context-tokens` write their examples this
    // way, and both are among the 38. The re-fencing (#5553) happens after the
    // shift, so the block has to be excluded by KIND, not by its final syntax.
    const out = renderFileDescription(moduleBlock('# Macros', '', '    # not a heading', '    value: 1'), ctx);
    expect(out).toBe('## Macros\n\n```\n# not a heading\nvalue: 1\n```');
  });

  it('does not mistake `#NoSpace` or a `#5059` issue reference for a heading', () => {
    const out = renderFileDescription(moduleBlock('#NotAHeading', '', '#5059 closed this.'), ctx);
    expect(out).toBe('#NotAHeading\n\n#5059 closed this.');
  });

  it('shifts a heading indented up to three spaces, which CommonMark still reads as one', () => {
    // A fourth space would make it an indented code block, which
    // `classifyLines` has already labelled `indented` by the time the shift
    // runs — so three is the boundary the shift has to reach. Prose first
    // because the fragment is trimmed as a whole, which would otherwise eat
    // the indentation this case is about.
    expect(renderFileDescription(moduleBlock('Prose.', '', '   # Indented'), ctx)).toBe('Prose.\n\n   ## Indented');
  });

  it('refuses rather than emitting seven hashes, which is not a heading at all', () => {
    // Unreachable on the current corpus — no level-1-bearing description goes
    // deeper than level 2 — and a loud failure is the right answer if a source
    // ever gets there. Silently clamping to 6 would flatten two source levels
    // into one; emitting `####### ` would publish the hashes as prose.
    expect(() => renderFileDescription(moduleBlock('# Top', '', '###### Six deep'), ctx)).toThrow(
      /would push a heading to level 7/,
    );
  });

  it('is the page that decides the level, not this module', () => {
    // The seam itself: `sectionLevel` is context, so a page whose sections sit
    // at 3 gets a fragment that starts at 3. Hard-coding 2 in the renderer
    // would make this untestable and the contract unstated.
    expect(renderFileDescription(moduleBlock('# Top', '', '## Under it'), { ...ctx, sectionLevel: 3 })).toBe(
      '### Top\n\n#### Under it',
    );
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

  /**
   * Which pages the generator publishes, per category — read from the emitted
   * tree, which is the same set `check:docs` holds to `packages/spec/src`.
   *
   * The category check alone is not the generator's rule any more (#6484).
   * Seven `.zod.ts` sources publish no page, and four of the neighbours the
   * corpus names have no source at all, so a stand-in that resolved every file
   * under a real category would hand these assertions link shapes the real run
   * never produces. Not circular: nothing below asserts that a route resolves —
   * they assert the markdown around it is well-formed and that no path reaches
   * a page still bare.
   */
  const pages = new Map<string, Set<string>>();
  for (const category of categories) {
    const dir = path.resolve(HERE, '../../../content/docs/references', category);
    if (!fs.existsSync(dir)) continue;
    pages.set(
      category,
      new Set(fs.readdirSync(dir).filter(f => f.endsWith('.mdx')).map(f => f.slice(0, -'.mdx'.length))),
    );
  }

  const sourcePathToDocsRoute = (target: string) => {
    const m = target.match(/(?:^|\/)([\w-]+)\/([\w.-]+)\.zod\.ts$/);
    return m && categories.has(m[1]) && pages.get(m[1])?.has(m[2])
      ? `/docs/references/${m[1]}/${m[2]}`
      : null;
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
    .map(file => {
      const rel = path.relative(SRC_DIR, file);
      // Each source is rendered from ITS OWN category, exactly as
      // `generateZodFileMarkdown` does — that is what makes a same-directory
      // reference resolvable at all (#6484), and rendering the whole corpus
      // from one fixed category would test a context the generator never
      // constructs.
      const ctx = { fromCategory: rel.split(path.sep)[0], sourcePathToDocsRoute, sectionLevel: PAGE_SECTION_LEVEL };
      return { rel, out: renderFileDescription(fs.readFileSync(file, 'utf-8'), ctx) };
    })
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
    // 146 at #13334 (154 before it — the marker gate blanked the eight modules
    // whose "description" was one schema's detached comment; the diff of every
    // per-file verdict, old selector vs new over all 208 sources, is in that
    // card's PR: 200 identical, 8 SELECTED→null, 0 to a different block).
    expect(described.length).toBeGreaterThan(140);
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

  it('never strands a `../` prefix outside the link it belongs to (#6229)', () => {
    // The corpus half of the unit block above, and the assertion behind the
    // issue's own acceptance grep (`\.\./\[` over `content/docs/references/`,
    // which this re-derives from source instead of from the artifact). The
    // published shape was `See also: ../../[system/cache.zod.ts](route)` on
    // `api/http-cache` and `system/cache`: the rewriter began matching at the
    // first path SEGMENT, so the prefix stayed behind as bare text beside the
    // construct that names it. The code-span fallback lost it the same way
    // (`../../` + a backtick), so both closers are checked.
    const offenders: string[] = [];
    for (const { rel, out } of described) {
      const stranded = out.match(/(?:\.\.\/)+[[`]/);
      if (stranded) offenders.push(`${rel}: ${stranded[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('never leaves a bare source path sitting in parentheses (#6420)', () => {
    // The corpus half of the unit block above. A path this step CAN match —
    // one with a category segment, `(?:\.\./)*<dir>/<file>.zod.ts` — must never
    // reach a page still bare: it is a link when a page renders it and a code
    // span when none does, and "plain text between parentheses" is the one
    // outcome the lookaround pair used to force. Scanned on the rendered
    // fragment rather than on the emitted `.mdx` for the same reason the rest
    // of this file is: `check:docs` reproduces the artifact faithfully and so
    // stayed green through all three published symptoms.
    //
    // Only the head character is examined, not a full `(…)` pair: `- Integration
    // connectors (integration/connector.zod.ts)` and `(…) - System integrators`
    // are different closers and both were victims, so what identifies the class
    // is a `(` immediately before the path. A path that follows `](` is a link
    // destination and belongs there — the tokenizer put it there.
    const offenders: string[] = [];
    for (const { rel, out } of described) {
      for (const line of withoutFences(out).split('\n')) {
        const bare = line.replace(/`[^`]*`/g, ''); // a code span is the null-route fallback
        const hit = /(^|[^\]])\((?:\.\.\/)*[\w-]+\/[\w.-]+\.zod\.ts/.exec(bare);
        if (hit) offenders.push(`${rel}: ${hit[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never leaves a same-directory source path as plain text (#6484)', () => {
    // The corpus half of the unit block above, and the issue's acceptance
    // criterion stated where it can be re-derived: a `*.zod.ts` reference this
    // step can match must reach the page as a link or as a code span, never as
    // prose. Deliberately NOT "every one of the nine becomes a link" — four of
    // them name a neighbour with no page, and #6229 says those get a code span.
    //
    // Scanned on the rendered fragment rather than on the emitted `.mdx` for
    // the reason the rest of this file is: `check:docs` reproduces the artifact
    // faithfully, so all nine published symptoms sailed through it green.
    //
    // A path is bare when it survives the removal of every formed link and every
    // code span. Link TEXT has to go with the link — the fallback the rewriter
    // emits is `[<path>](<route>)`, whose text is the path itself, so matching
    // inside it would report every fix as a defect.
    const offenders: string[] = [];
    for (const { rel, out } of described) {
      for (const line of withoutFences(out).split('\n')) {
        const bare = line
          .replace(/\[[^\]]*\]\([^)\s]*\)/g, '') // a formed link, text and destination
          .replace(/`[^`]*`/g, ''); //              a code span — the null-route fallback
        const hit = /(?:\.\.\/)*(?:[\w-]+\/)?[\w.-]+\.zod\.ts/.exec(bare);
        if (hit) offenders.push(`${rel}: ${hit[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never emits a level-1 heading — the page already has one (#12249)', () => {
    // The corpus half of the unit block above, and the issue's own acceptance
    // criterion re-derived from the sources: a fragment embedded under the
    // page's `<h1>` may not open a second one. 38 of these descriptions did,
    // 43 headings across them, which is what carved `content/docs/references/**`
    // out of `scripts/check-docs-single-h1.mjs`.
    //
    // Asserted on the RENDERED fragment, not on the emitted `.mdx`: the gate
    // that reads the tree is `check-docs-single-h1.mjs` and it reads the
    // artifact, so it can only ever see this AFTER a `gen:docs` run committed
    // the damage. This sees it at the source of the string.
    const offenders: string[] = [];
    for (const { rel, out } of described) {
      for (const [i, line] of withoutFences(out).split('\n').entries()) {
        if (/^ {0,3}#(?:[ \t]|$)/.test(line)) offenders.push(`${rel}:${i + 1} ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('demotes only the 37 descriptions that needed it (#12249)', () => {
    // The other half, and the reason this is a renumbering rather than a
    // blanket `#`→`##`: 26 described modules already start their headings at
    // level 2, and shifting those too would have moved 105 correct headings a
    // level deeper and regenerated 26 pages that were never wrong.
    //
    // Re-derived from the SOURCES: a description needed the shift exactly when
    // its own file header opens a heading at level 1. Rendering the same corpus
    // at `sectionLevel: 1` — the identity, since no header goes shallower —
    // gives the untouched string to compare against, so this counts real
    // shifts rather than restating the fixture list.
    const shifted = zodFiles
      .map(file => {
        const rel = path.relative(SRC_DIR, file);
        const source = fs.readFileSync(file, 'utf-8');
        const base = { fromCategory: rel.split(path.sep)[0], sourcePathToDocsRoute };
        return {
          rel,
          untouched: renderFileDescription(source, { ...base, sectionLevel: 1 }),
          emitted: renderFileDescription(source, { ...base, sectionLevel: PAGE_SECTION_LEVEL }),
        };
      })
      .filter(d => d.untouched !== d.emitted);

    // (38 -> 37: `kernel/metadata-customization.zod.ts` — one of the level-1
    // openers — was removed whole by #13135's ADR-0049 retirement.)
    expect(shifted.length).toBe(37);
    // …and every one of them was shifted because it opened at level 1.
    expect(shifted.filter(d => /^ {0,3}#(?:[ \t]|$)/m.test(withoutFences(d.untouched)))).toHaveLength(37);
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
