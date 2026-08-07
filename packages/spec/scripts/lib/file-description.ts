// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which doc block of a `*.zod.ts` module is the MODULE's description — the
 * prose a reference page opens with — and how that block renders to MDX.
 *
 * Extracted from `build-docs.ts` (#5059) for the same reason `format-type.ts`
 * (#4912) and `escape-mdx.ts` (#5452) were: the generator is a top-level script
 * with side effects, so the only way to assert on its block SELECTION used to be
 * to run the whole thing and read the emitted `.mdx`. That is how six public
 * reference pages came to open with an internal comment — twice on `main`, with
 * `check:docs` green throughout, because that gate compares the artifact to the
 * source and the artifact faithfully reproduced the wrong block.
 *
 * ## The rule
 *
 * The old selection was "the first doc block anywhere in the file, verbatim".
 * That is not a rule about module descriptions at all — it is a rule about
 * ORDERING, so whichever declaration happens to sit at the top donates its
 * comment to a public page. Moving a helper up a file silently rewrote a
 * published document, and nothing in the pipeline could see it: a page opened
 * with `Shared history for this file (#4001)` (an internal note on a private
 * const) or `Transport Protocol Enum` (one enum's doc, on a page documenting
 * fourteen schemas).
 *
 * A block describes the MODULE only when all three hold:
 *
 * 1. **Top-level** — the delimiter starts at column 0. A comment indented
 *    inside an object literal documents a property, not a module: `api/contract`
 *    opened with the doc of `ApiErrorSchema.code`.
 * 2. **In the header zone** — no declaration precedes it. Imports and
 *    re-exports do not close the zone (they introduce no symbol of their own,
 *    and this repo writes module headers on either side of them); the first
 *    `const`/`export const`/… does.
 * 3. **Documenting nothing** — the block is not immediately followed by a
 *    declaration.
 *
 * (3) is the load-bearing one, and it is simply TSDoc's own rule read back: a
 * doc block belongs to the declaration it immediately precedes, which is why
 * every editor shows that text when you hover the symbol. So a block glued to
 * `export const TransportProtocol` is that enum's documentation — publishing it
 * as the Realtime page's opening paragraph was the generator inventing a second
 * meaning for text that already had one. "Immediately" means blank lines only:
 * nobody separates a JSDoc from its symbol with a `// ═══` banner, so a banner
 * (or another doc block, or an import) between the two marks the end of the
 * preamble rather than an attachment.
 *
 * When no block qualifies, the module has no description and the page prints
 * none. 宁可缺,不要错 — a missing paragraph is a gap the reader can see, while
 * a confidently rendered internal note is a page that lies about its subject.
 * A module that wants an opening paragraph writes one block that documents no
 * symbol; 178 of the 200 reference sources already have exactly that.
 *
 * This IS the gate. The issue floated a first-sentence pattern check
 * (`#\d{3,}` / `Shared history`), but that only recognises one subclass of
 * wrong block after it has been published — and the measurement on #5059 found
 * four victims with no history constant anywhere near them. A selection rule
 * that cannot pick a symbol's comment in the first place makes the whole class
 * impossible. Its enforcement is `file-description.test.ts`, which pins the
 * selection on the real shapes instead of on the emitted `.mdx`.
 */

/**
 * Context a description needs to turn a source path referenced from JSDoc into
 * a link that resolves on the docs site.
 *
 * Injected rather than imported so this module stays free of the generator's
 * module-level category maps — the same seam `TypeContext.schemaHref` uses.
 */
export interface FileDescriptionContext {
  /**
   * A `*.zod.ts` path as written in JSDoc -> the docs route rendering it, or
   * `null` when no page renders it (the reference is then printed as code,
   * never as a link that 404s).
   */
  sourcePathToDocsRoute: (target: string) => string | null;
}

/**
 * Lines that may sit around the module's doc block without closing the header
 * zone. They introduce no symbol, so a block next to them is still a candidate.
 */
const MODULE_PLUMBING = /^(?:import\b|export\s*(?:\*|\{|type\s*\{))/;

/**
 * Does this top-level line start something a doc block above it would be
 * documenting?
 *
 * Deliberately coarse in the safe direction: anything at column 0 opening with
 * an identifier character that is not module plumbing counts. The closing
 * punctuation of a multi-line statement (`} from './x';`, `]);`) does not open
 * with one, and neither does a comment — so the scan walks over those, while an
 * unrecognised top-level statement closes the zone instead of being skipped.
 */
function startsDeclaration(line: string): boolean {
  return /^[A-Za-z_$@]/.test(line) && !MODULE_PLUMBING.test(line);
}

/** Index of the line closing the block comment opened at `start`. */
function endOfBlockComment(lines: readonly string[], start: number): number {
  let end = start;
  // A one-line block closes on its own line, hence the check starts at `start`.
  while (end < lines.length && !lines[end].includes('*/')) end++;
  return end;
}

/**
 * First non-blank line after `from`, or `null` at end of file.
 *
 * ONLY blank lines are skipped, and that is the whole of the attachment rule: a
 * doc block documents the declaration it immediately precedes. Anything else
 * between them — a section banner, another doc block, an import — means the
 * block was written about the module, not about that declaration. Nobody
 * separates a JSDoc from the symbol it documents with a `// ═══` banner; that
 * banner is where the preamble ends.
 */
function nextNonBlankLine(lines: readonly string[], from: number): number | null {
  let i = from;
  while (i < lines.length && lines[i].trim() === '') i++;
  return i < lines.length ? i : null;
}

/**
 * The module's own doc block, INNER text only (delimiters stripped, `*` line
 * prefixes intact) — or `null` when the module does not have one.
 *
 * See the module comment for the three conditions. This is the whole of the
 * fix: expressed as what the generator will select, not as a detector bolted on
 * beside it, because a rule that makes the wrong page impossible needs no
 * detector.
 *
 * It is line-oriented rather than AST-based on purpose — `build-docs.ts` reads
 * `.zod.ts` sources as text and has no TypeScript program to ask, and every
 * shape it cannot resolve resolves to `null`, i.e. to no description.
 */
export function findModuleDocBlock(source: string): string | null {
  const lines = source.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('/**')) {
      const end = endOfBlockComment(lines, i);
      if (end >= lines.length) return null; // unterminated — nothing to trust
      const next = nextNonBlankLine(lines, end + 1);
      if (next !== null && startsDeclaration(lines[next])) return null; // documents a symbol
      const raw = lines.slice(i, end + 1).join('\n');
      return raw.slice(raw.indexOf('/**') + 3, raw.lastIndexOf('*/'));
    }

    if (line.startsWith('/*')) { i = endOfBlockComment(lines, i) + 1; continue; }
    if (line.trim() === '' || line.trim().startsWith('//') || !/^\S/.test(line)) { i++; continue; }
    if (MODULE_PLUMBING.test(line)) { i++; continue; }
    if (startsDeclaration(line)) return null; // header zone closed before any block

    i++; // closing punctuation of a multi-line import / re-export
  }
  return null;
}

/**
 * The module's doc block, rendered as the MDX fragment a reference page opens
 * with. Empty string when the module has no description — callers print nothing
 * rather than a placeholder.
 */
export function renderFileDescription(source: string, ctx: FileDescriptionContext): string {
  const block = findModuleDocBlock(source);
  if (block === null) return '';
  const { sourcePathToDocsRoute } = ctx;
  return block
    .split('\n')
    .map(line => line.replace(/^\s*\*\s?/, '').trim())
    .filter(line => line)
    // A bare `@see <path>` tag renders as noise — turn it into prose.
    .map(line => line.replace(/^@see\s+/, 'See also: '))
    .join('\n\n')
    .replace(/\{@link\s+([^|]+?)\s*\|\s*([^}]+?)\s*\}/g, (_m, target: string, text: string) =>
      `[${text.trim()}](${sourcePathToDocsRoute(target.trim()) ?? target.trim()})`)
    .replace(/\{@link\s+([^}]+?)\s*\}/g, (_m, target: string) => {
      const route = sourcePathToDocsRoute(target.trim());
      return route ? `[${target.trim()}](${route})` : `\`${target.trim()}\``;
    })
    // Same for a bare source path left in prose by `See also:` above.
    .replace(/(?<!\()\b((?:\.\.\/)?[\w-]+\/[\w.-]+\.zod\.ts)\b(?!\))/g, (_m0, p: string) => {
      const route = sourcePathToDocsRoute(p);
      return route ? `[${p}](${route})` : `\`${p}\``;
    })
    .replace(/file:\/\//g, '') // Remove file:// protocol
    .replace(/\{/g, '\\{').replace(/\}/g, '\\}'); // Escape { } for MDX
}
