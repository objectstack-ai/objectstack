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
 *
 * ## Rendering the selected block (#5553, #6136)
 *
 * Selection says WHICH block; the rest of this file says how it becomes MDX.
 * Two defects lived here, both from transforms applied at the wrong GRANULARITY:
 *
 * - **Per line instead of per block (#5553).** The renderer dropped every blank
 *   line and joined the surviving lines with `\n\n`, i.e. it declared each
 *   SOURCE LINE its own paragraph. Markdown constructs that legitimately wrap
 *   across lines were then cut in half by a paragraph boundary: an inline code
 *   span cannot cross a blank line, so both of its backticks rendered as
 *   literal text (`explain(principal, object,` / `operation)` on
 *   `security/explain`). It also flattened every list, heading, table and code
 *   block the sources had written, because their structure IS their line layout.
 *   The fix is to stop rewriting that layout: strip the ` * ` gutter and keep
 *   the lines as authored. Markdown's own rules then do what the issue asked
 *   for — consecutive lines are one paragraph, a blank line opens the next —
 *   while lists and fences keep working, which a literal space-join would have
 *   broken on 85 of the 185 sources that have a description.
 *
 * - **Everywhere instead of only in prose (#5553, #6136).** Brace escaping ran
 *   over the whole string, so `{` inside an inline code span became a visible
 *   `\{` — the backslash is not an escape character there, it is content. The
 *   bare-source-path rewriter had the same shape of bug one level up: it ran
 *   over text that already contained the markdown links the `{@link}` step had
 *   just produced, matched the path inside a link's TEXT, and wrapped it again
 *   into a link nested in a link (`automation/etl:54`, `integration/connector:102`).
 *
 * So every transform below is scoped to the runs it is actually about: code
 * lines (fenced or indented) are copied verbatim, and within prose the
 * tokenizer keeps inline code spans and already-formed links out of reach.
 * Widening the rewriter's lookaround instead would not have worked — lookaround
 * cannot express "not nested inside a link".
 *
 * The one place the output is NOT the source's own layout is an indented
 * (4-space) code block, which is re-emitted as a fenced one. MDX dropped
 * CommonMark's indented code blocks so that indentation could lay out JSX, so
 * keeping them would hand `{ $gte: '{last_quarter_start}' }` to MDX as an
 * expression and fail the docs build — the target dialect has one spelling for
 * a code block and this is it.
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
 * The doc block's lines with the ` * ` gutter removed and nothing else changed.
 *
 * Indentation AFTER the gutter is content, not decoration — it is what makes a
 * nested list nested and an indented code block code — so only the gutter and
 * trailing whitespace come off. The first and last lines of a block carry no
 * gutter (they are the fragments beside the opening and closing delimiters),
 * so they are trimmed outright.
 */
function stripDocGutter(block: string): string[] {
  return block.split('\n').map(line => {
    const gutter = /^\s*\*\s?/.exec(line);
    return gutter ? line.slice(gutter[0].length).trimEnd() : line.trim();
  });
}

/** What a line is, which decides which transforms may touch it. */
type LineKind = 'prose' | 'fenced' | 'indented';

/**
 * Classify every line as prose, fenced code, or an indented (4-space) code
 * block. Code of either kind is content the reader is meant to read literally,
 * so link resolution and brace escaping would be printing their own syntax into
 * it.
 *
 * Indented blocks have to be recognised separately rather than folded in with
 * fenced ones, because MDX does not have them: it dropped CommonMark's indented
 * code blocks precisely so indentation could be used to lay out JSX. Two sources
 * write their placeholder examples that way (`data/date-macros`,
 * `data/context-tokens`) and both are almost entirely braces, so leaving them
 * indented would hand `{ $gte: '{last_quarter_start}' }` to MDX as an expression
 * and fail the docs build. They are re-emitted as fenced blocks instead.
 */
function classifyLines(lines: readonly string[]): LineKind[] {
  const kind: LineKind[] = lines.map(() => 'prose');
  let fence: string | null = null;
  let indented = false;
  let prevBlank = true; // the start of the block is a block boundary
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const blank = line.trim() === '';

    if (fence !== null) {
      kind[i] = 'fenced';
      if (line.trimStart().startsWith(fence)) fence = null;
      prevBlank = false;
      continue;
    }
    if (indented) {
      if (blank) { prevBlank = true; continue; } // a blank line does not close it
      if (/^ {4,}\S/.test(line)) { kind[i] = 'indented'; prevBlank = false; continue; }
      indented = false; // dedented — this line is prose again
    }
    const opener = /^\s*(`{3,}|~{3,})/.exec(line);
    if (opener) { kind[i] = 'fenced'; fence = opener[1]; prevBlank = false; continue; }
    if (prevBlank && /^ {4,}\S/.test(line)) { kind[i] = 'indented'; indented = true; prevBlank = false; continue; }

    prevBlank = blank;
  }

  // A blank line BETWEEN two indented lines belongs to the block; one after the
  // last belongs to the prose that follows.
  for (let i = 0; i < kind.length; i++) {
    if (kind[i] !== 'indented') continue;
    let j = i + 1;
    while (j < kind.length && lines[j].trim() === '') j++;
    if (j < kind.length && kind[j] === 'indented') for (let k = i + 1; k < j; k++) kind[k] = 'indented';
    i = j - 1;
  }
  return kind;
}

/**
 * A blank line before every JSDoc block tag that does not already have one.
 *
 * Keeping the source's own blank lines is not sufficient on its own, because
 * the sources write RUNS of tags with no blank line between them —
 * `automation/etl` ends on three consecutive `@see` links. Those are three
 * blocks in JSDoc, so they must stay three blocks in markdown; joined into one
 * paragraph they would read as a single run-on sentence.
 */
function withTagBlocksSeparated(lines: readonly string[]): string[] {
  const kind = classifyLines(lines);
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (kind[i] === 'prose' && /^@\w+/.test(line) && out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
    out.push(line);
  });
  return out;
}

/** A run of prose the transforms may rewrite, or one they must leave alone. */
interface ProseRun {
  kind: 'text' | 'code' | 'link';
  text: string;
}

/**
 * Split prose into rewritable text, inline code spans, and markdown links.
 *
 * The two protected kinds are protected for different reasons. A code span is
 * content the reader sees literally, so escaping inside it leaks the escape
 * character onto the page. A link is a construct a previous transform BUILT,
 * and re-running a rewriter over its text is how a link ends up inside a link
 * (#6136) — the reason this is a tokenizer and not a longer lookaround.
 */
function tokenizeProse(text: string): ProseRun[] {
  const runs: ProseRun[] = [];
  let buffer = '';
  const flush = () => { if (buffer) { runs.push({ kind: 'text', text: buffer }); buffer = ''; } };

  for (let i = 0; i < text.length;) {
    if (text[i] === '`') {
      let open = i;
      while (open < text.length && text[open] === '`') open++;
      const width = open - i;
      // CommonMark: the closing run has to be exactly as wide as the opener.
      let end = -1;
      for (let j = open; j < text.length;) {
        if (text[j] !== '`') { j++; continue; }
        let k = j;
        while (k < text.length && text[k] === '`') k++;
        if (k - j === width) { end = j; break; }
        j = k;
      }
      if (end !== -1) {
        flush();
        runs.push({ kind: 'code', text: text.slice(i, end + width) });
        i = end + width;
        continue;
      }
      buffer += text.slice(i, open); // unmatched backticks are ordinary text
      i = open;
      continue;
    }
    if (text[i] === '[') {
      const link = /^\[[^\]]*\]\([^)\s]*\)/.exec(text.slice(i));
      if (link) {
        flush();
        runs.push({ kind: 'link', text: link[0] });
        i += link[0].length;
        continue;
      }
    }
    buffer += text[i];
    i++;
  }
  flush();
  return runs;
}

/** Apply `fn` to prose outside inline code spans, and outside links when asked. */
function mapProse(text: string, kinds: ProseRun['kind'][], fn: (plain: string) => string): string {
  return tokenizeProse(text).map(run => (kinds.includes(run.kind) ? fn(run.text) : run.text)).join('');
}

/** One run of consecutive prose lines, rendered to MDX. */
function renderProse(text: string, ctx: FileDescriptionContext): string {
  const { sourcePathToDocsRoute } = ctx;

  // A bare `@see <path>` tag renders as noise — turn it into prose.
  let out = text.replace(/^@see[ \t]+/gm, 'See also: ');

  // `{@link}` first, because this is the step that PRODUCES markdown links.
  out = mapProse(out, ['text'], s => s
    .replace(/\{@link\s+([^|]+?)\s*\|\s*([^}]+?)\s*\}/g, (_m, target: string, label: string) =>
      `[${label.trim()}](${sourcePathToDocsRoute(target.trim()) ?? target.trim()})`)
    .replace(/\{@link\s+([^}]+?)\s*\}/g, (_m, target: string) => {
      const route = sourcePathToDocsRoute(target.trim());
      return route ? `[${target.trim()}](${route})` : `\`${target.trim()}\``;
    }));

  // …and only then paths left BARE in prose. Re-tokenizing between the two is
  // the whole of #6136's fix: the untitled `{@link}` branch above emits
  // `[<path>](<route>)`, whose link text is the path itself, so a rewriter run
  // over the raw string matched it a second time and nested a link in a link.
  //
  // The `\b` sits AFTER the `../` prefix rather than before it (#6229). A word
  // boundary needs a word character on one side, and every character of `../`
  // is a non-word one, so a leading `\b` could not match at the `.` — the match
  // started at the first path segment instead and the prefix was left OUTSIDE
  // the link it belongs to (`../../[system/cache.zod.ts](route)`, published on
  // `api/http-cache` and `system/cache`). The prefix group was therefore dead
  // for every realistic input, not merely capped at one level: widening it to
  // `*` without moving the `\b` changes nothing, since a group that is never
  // reached repeats zero times either way. Both halves are load-bearing —
  // moving the `\b` alone would still strand the outer level of a `../../`.
  out = mapProse(out, ['text'], s =>
    s.replace(/(?<!\()((?:\.\.\/)*\b[\w-]+\/[\w.-]+\.zod\.ts)\b(?!\))/g, (_m, p: string) => {
      const route = sourcePathToDocsRoute(p);
      return route ? `[${p}](${route})` : `\`${p}\``;
    }));

  out = out.replace(/file:\/\//g, ''); // Remove file:// protocol

  // Escape `{ }` for MDX, but only where MDX would read them as an expression.
  // Inside a code span they are already literal, so escaping there printed the
  // backslash itself onto five published pages (#5553).
  return mapProse(out, ['text', 'link'], s => s.replace(/\{/g, '\\{').replace(/\}/g, '\\}'));
}

/**
 * The module's doc block, rendered as the MDX fragment a reference page opens
 * with. Empty string when the module has no description — callers print nothing
 * rather than a placeholder.
 */
export function renderFileDescription(source: string, ctx: FileDescriptionContext): string {
  const block = findModuleDocBlock(source);
  if (block === null) return '';

  const lines = withTagBlocksSeparated(stripDocGutter(block));
  const kind = classifyLines(lines);

  // Prose is rendered a RUN of lines at a time, never line by line: a sentence,
  // an inline code span and a `{@link}` tag may each wrap across source lines,
  // and a transform applied per line cuts them in half (#5553).
  const out: string[] = [];
  for (let i = 0; i < lines.length;) {
    if (kind[i] === 'fenced') { out.push(lines[i]); i++; continue; }

    if (kind[i] === 'indented') {
      const start = i;
      while (i < lines.length && kind[i] === 'indented') i++;
      // Re-emitted as a fence: MDX has no indented code blocks, so left as it
      // was authored this would be parsed as prose containing JSX expressions.
      out.push('```', ...lines.slice(start, i).map(line => line.replace(/^ {4}/, '')), '```');
      continue;
    }

    const start = i;
    while (i < lines.length && kind[i] === 'prose') i++;
    out.push(renderProse(lines.slice(start, i).join('\n'), ctx));
  }
  return out.join('\n').trim();
}
