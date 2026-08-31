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
 *    declaration, and — when the block sits INSIDE the import list, an import
 *    the first thing on its far side — it carries the explicit `@module`
 *    marker (see the #13334 section below; a far side that is nothing but
 *    plumbing to the end of the file needs no marker).
 *
 * (3) is the load-bearing one, and it is simply TSDoc's own rule read back: a
 * doc block belongs to the declaration it immediately precedes, which is why
 * every editor shows that text when you hover the symbol. So a block glued to
 * `export const TransportProtocol` is that enum's documentation — publishing it
 * as the Realtime page's opening paragraph was the generator inventing a second
 * meaning for text that already had one. "Immediately" means blank lines only:
 * nobody separates a JSDoc from its symbol with a `// ═══` banner, so a banner
 * (or another doc block) between the two marks the end of the preamble rather
 * than an attachment.
 *
 * ## An import between a block and its symbol is not a separator (#13263)
 *
 * The one exception to that last sentence, and it is not a judgement call — it
 * is a codemod. `scripts/lazify-schemas.ts` injects
 * `import { lazySchema } from '…/shared/lazy-schema';` at the END of the file's
 * leading run of comments, blank lines and imports, and the regex it uses for
 * that run counts a doc block among the comments (its comment alternative is
 * slash-star, any run, star-slash — a doc block matches it). So when a module
 * was written as an `import { z } from 'zod';`, a blank line, a doc block
 * reading `Service Status Enum`, and then `export const ServiceStatus`,
 * the run swallowed the doc block and the injected import landed BETWEEN the
 * block and the symbol it documents. Nothing about the block changed; only the
 * detector's view of it did. Reading that import as "the preamble ends here"
 * republished 28 symbol comments as their pages' subjects, `api/discovery`'s
 * `Service Status Enum` and `data/field`'s `Field Type Enum` among them — and
 * `gen:skill-refs` copied each one's first line into the PUBLISHED skill
 * indexes, so the misattribution shipped to customer projects.
 *
 * Hence condition 3's second half: a declaration reachable across nothing but
 * blank lines and plumbing is still the block's subject. Two things keep this a
 * tightening rather than a demotion of the spelling `MODULE_PLUMBING` exists to
 * permit — measured over all 193 reference sources, and both are load-bearing:
 *
 * - **It applies only INSIDE the import block.** A header written ABOVE the
 *   imports is where the codemod cannot have put it: the injection point is
 *   after the last import, so a block preceding every import was preceding them
 *   before the codemod ran too. Without that half, `api/error-code-ledger`,
 *   `cloud/template-manifest` and `system/doc` — three real headers whose
 *   imports happen to be followed directly by a declaration — lose their
 *   opening paragraph.
 * - **A comment directly against the block's far side still ends the preamble.**
 *   A `// ═══` banner or a second doc block as the FIRST thing after the block
 *   means the block did NOT sit against an injected import at all, so the
 *   codemod's ambiguity never arises. `api/analytics` (banner) keeps its header
 *   through exactly this clause.
 *
 * ## Inside the import list, only `@module` selects (#13334)
 *
 * What position cannot decide is the block whose far side opens with an IMPORT
 * and whose walk beyond that plumbing then meets a comment: `system/cache` and
 * `shared/mapping` were genuine headers there and eight others were detached
 * symbol docs, and every positional signal was measured and separates nothing —
 * line number, imports-before count, block length, whether the next declaration
 * has its own JSDoc; only the prose differs (#13334 carries the table). A
 * first-sentence pattern check is the approach this header already rejects, so
 * the rule asks the author instead: a block sitting inside the import list —
 * imports before it, an import the first thing after it — is selected only when
 * it carries an explicit `@module` marker on a prose line of its own. The
 * marker is this repo's existing spelling for "this block is the module's"
 * (fourteen headers above their imports already open with it), and it decides
 * in BOTH directions: with it the block is the header whatever lies beyond the
 * plumbing, without it the block is not selected even though a comment on the
 * far side would once have kept it. One exception needs no marker: plumbing
 * that runs to the end of the file leaves no symbol the block could have been
 * torn from (a pure re-export module), so the block still selects bare.
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
 *
 * ## Heading levels are the PAGE's, not the source file's (#12249)
 *
 * The second such place, and the same argument. A `.zod.ts` header is written
 * as a standalone document, so its author opens a section with `# `; embedded
 * in a reference page that `# ` compiles to a second `<h1>`, because the page
 * already renders one from its frontmatter `title` (`DocsTitle`, in
 * `apps/docs/app/[lang]/docs/[[...slug]]/page.tsx`). Measured on `main`: 38 of
 * the 190 described modules did that, 43 headings across them, and the whole
 * `content/docs/references/**` tree had to be carved out of
 * `scripts/check-docs-single-h1.mjs` because of it.
 *
 * So the fragment is renumbered on the way out: its SHALLOWEST heading is
 * placed at `ctx.sectionLevel` and every other heading moves with it, keeping
 * the relative structure the author wrote. Three properties this shape has that
 * the obvious "demote every `# ` to `## `" does not:
 *
 * - **It only ever demotes.** A description whose headings already start at
 *   level 2 is left byte-identical — 26 of the 64 described modules with
 *   headings are in that state, and a blanket +1 would have pushed all of them
 *   a level deeper and regenerated 26 pages that were never wrong.
 * - **It moves the block, not the level-1 lines.** `automation/control-flow`
 *   writes `##` with a `###` under it; renumbering the run keeps that nesting,
 *   whereas rewriting only the `# ` lines would collide two source levels into
 *   one output level wherever a block mixes them.
 * - **It cannot silently corrupt code.** The shift is applied to `prose` lines
 *   only, so a `# Install pnpm globally` inside a fenced or indented block is
 *   left alone. That is the load-bearing half, and it is why this lives here
 *   rather than as a regex over the emitted string in `build-docs.ts`:
 *   `classifyLines` is already the one model in this pipeline that knows which
 *   lines are code, and a fence-blind pass over the same text would rewrite
 *   working snippets to satisfy a rule about HTML those lines never produce
 *   (the same false positive `check-docs-single-h1.mjs`'s header measures at
 *   ten pages, and calls more expensive than the defect).
 *
 * ATX only: no source writes a setext (`===` underline) heading, and both this
 * renderer's consumers and `check-docs-single-h1.mjs` model headings the same
 * ATX-only way. A shift that would push a heading past level 6 throws rather
 * than emitting a seven-hash line, which CommonMark renders as paragraph text —
 * unreachable on the current corpus (no h1-bearing description goes deeper than
 * level 2) and a loud failure is the right answer if a source ever gets there.
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
   * The `packages/spec/src/` category directory the module being rendered lives
   * in (`identity`, `system`, …) — i.e. what a path written relative to the
   * module's OWN directory is relative TO.
   *
   * Required, not optional, and that is the point of #6484. A module referring
   * to a neighbour writes `auth.zod.ts`, not `identity/auth.zod.ts`, and until
   * this member existed the renderer had no way to know which directory that
   * name was written in: nine such references on four published pages matched
   * nothing and shipped as plain prose — not a link, not even a code span.
   *
   * The completion happens HERE rather than inside `sourcePathToDocsRoute`
   * because a bare filename is not an identity (#4696): `auth.zod.ts` exists
   * under more than one category, and a resolver that searched all of them
   * would answer with whichever the directory walk reached last. The writer's
   * own category is the only thing that disambiguates it, and only the caller
   * knows it — the same seam, and the same argument, as `schemaHrefFrom`.
   */
  fromCategory: string;

  /**
   * A `*.zod.ts` path as written in JSDoc -> the docs route rendering it, or
   * `null` when no page renders it (the reference is then printed as code,
   * never as a link that 404s).
   *
   * Always called with a path that HAS a category segment: `fromCategory`
   * completes the relative spellings before they get here, so this stays the
   * `<category>/<file>.zod.ts` lookup #4696 settled on.
   */
  sourcePathToDocsRoute: (target: string) => string | null;

  /**
   * The heading level a TOP-LEVEL section of the embedding page sits at — 2 for
   * a reference page, whose `<h1>` is the frontmatter `title`.
   *
   * Required for the reason `fromCategory` is (#6484): only the caller knows
   * it. A `.zod.ts` header is written as if it were its own document and has no
   * way to know what page it will be embedded in, while `build-docs.ts` emits
   * the page's other top-level sections itself and therefore owns the number.
   * Hard-coding `2` here would put the page's heading contract in the module
   * that is least able to state it, and would drift silently the first time a
   * page's layout changed.
   */
  sectionLevel: number;
}

/**
 * A reference written relative to the module's own directory, completed with
 * the category it was written in — `auth.zod.ts` inside `identity/` is
 * `identity/auth.zod.ts`. Anything that already carries a directory segment is
 * returned untouched.
 *
 * The test is deliberately "no `/` at all" rather than "does not start with a
 * category": `../auth.zod.ts` does NOT get completed, because a `../` from a
 * category directory leaves that category, and `packages/spec/src/auth.zod.ts`
 * is not a page. It resolves to no route and prints as code, which is the
 * honest answer — completing it would invent a page the author never named.
 */
function completeFromCategory(target: string, fromCategory: string): string {
  return /^[\w.-]+\.zod\.ts$/.test(target) ? `${fromCategory}/${target}` : target;
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
 * What the walk from `from`, over blank lines and plumbing, reaches first.
 *
 * Only ever asked of a block that sits INSIDE the import list (see the module
 * comment's #13334 section), where the answer routes an UNMARKED block:
 * `'eof'` selects it — the plumbing runs to the end of the file, so there is
 * no symbol the block could have been torn from (a pure re-export module) —
 * while `'declaration'` (the #13263 codemod shape) and `'comment'` (the
 * position #13334 measured as undecidable) both refuse it, leaving `@module`
 * as the only thing that selects there.
 *
 * A comment of any kind — a `// ═══` banner, a second doc block, an import's
 * own explanatory note — stops the walk instead of being walked over. That is
 * the same boundary `nextNonBlankLine` draws and for the same reason.
 *
 * Continuation and closing lines of a multi-line import (`  Foo,`,
 * `} from './x';`) are plumbing too — they open with neither an identifier
 * character nor a comment delimiter, exactly as `findModuleDocBlock`'s own walk
 * reads them.
 */
function beyondPlumbing(lines: readonly string[], from: number): 'declaration' | 'comment' | 'eof' {
  for (let i = from; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (line.trimStart().startsWith('/')) return 'comment';
    if (MODULE_PLUMBING.test(line)) continue;
    if (!startsDeclaration(line)) continue; // continuation / closing punctuation
    return 'declaration';
  }
  return 'eof';
}

/**
 * Does the block carry the `@module` marker — this repo's existing spelling
 * for "this block documents the module" — on a prose line of its own?
 *
 * Judged on gutter-stripped lines through the same `classifyLines` model the
 * renderer uses, so an `@module` shown inside a fenced example (an author
 * illustrating the convention) is content, never a marker. The line must OPEN
 * with the tag: fourteen real headers write it exactly that way (`@module
 * ui/sharing`), and a mid-sentence mention of the tag is prose about it.
 */
function hasModuleMarker(inner: string): boolean {
  const lines = stripDocGutter(inner);
  const kind = classifyLines(lines);
  return lines.some((line, i) => kind[i] === 'prose' && /^@module\b/.test(line));
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

  // Whether the walk has passed an import / re-export, i.e. whether a block
  // found from here on sits INSIDE the import block rather than above it. Only
  // there can the lazify codemod have put an import between a block and its
  // symbol, so only there does the far-side check below apply (#13263).
  let insideImportBlock = false;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('/**')) {
      const end = endOfBlockComment(lines, i);
      if (end >= lines.length) return null; // unterminated — nothing to trust
      const next = nextNonBlankLine(lines, end + 1);
      if (next !== null && startsDeclaration(lines[next])) return null; // documents a symbol
      const raw = lines.slice(i, end + 1).join('\n');
      const inner = raw.slice(raw.indexOf('/**') + 3, raw.lastIndexOf('*/'));
      // INSIDE the import list — imports before the block, an import the first
      // thing after it — position cannot say what the block documents (#13334;
      // the measurement is in the module comment). Only the author's explicit
      // `@module` marker selects it there, except when the plumbing runs to the
      // end of the file and no symbol exists for the block to have been torn
      // from. This subsumes #13263's far-side rule: an unmarked block with a
      // declaration beyond the plumbing is still refused.
      if (
        insideImportBlock &&
        next !== null &&
        MODULE_PLUMBING.test(lines[next]) &&
        !hasModuleMarker(inner) &&
        beyondPlumbing(lines, next) !== 'eof'
      ) {
        return null;
      }
      return inner;
    }

    if (line.startsWith('/*')) { i = endOfBlockComment(lines, i) + 1; continue; }
    if (line.trim() === '' || line.trim().startsWith('//') || !/^\S/.test(line)) { i++; continue; }
    if (MODULE_PLUMBING.test(line)) { insideImportBlock = true; i++; continue; }
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

/**
 * The `check:skill-examples` opt-in marker, which must never reach the page.
 *
 * That gate (`../check-skill-examples.ts`, which owns this spelling — it cannot
 * be imported from here, it is a top-level script that runs on load) opts a
 * docblock code block into type-checking with an HTML comment on the line
 * directly above its fence. In a `.ts` source the marker HAS to be that HTML
 * comment form, because the MDX roots' wrapper spelling ends in the two
 * characters star-then-slash, which terminate a block comment — it would close
 * the JSDoc early. (This comment avoids writing that pair out for the same
 * reason.)
 *
 * The marker sits ABOVE the fence, so it is a prose line, and prose is emitted
 * verbatim — which lands the marker in the generated MDX. MDX has no HTML
 * comments; fumadocs-mdx fails the build outright on one ("Unexpected character
 * `!`…"), directing the author at the wrapper form instead. So a marker on any
 * MODULE-level doc block would both publish an internal annotation to a
 * customer-facing reference page and break the docs build. Measured on
 * `studio/object-designer` and `studio/plugin`, the two spec modules whose
 * marked examples live in the module block rather than on a declaration.
 *
 * Dropped rather than escaped: it is machinery, not content, and the reader of
 * the rendered page has no use for it.
 */
const SKILL_EXAMPLE_MARKER = '<!-- os:check -->';

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
 * An ATX heading, and the three pieces a renumbering needs: the leading
 * indent, the hash run, and where the rest of the line starts.
 *
 * CommonMark allows up to three leading spaces (a fourth makes it an indented
 * code block, which `classifyLines` has already labelled `indented` by the time
 * this runs). The trailing `(?=[ \t]|$)` is what keeps `#NotAHeading` and a
 * `#5059` issue reference at the start of a line out of the match — a hash run
 * is only a heading when a space or the end of the line closes it.
 */
const ATX_HEADING = /^( {0,3})(#{1,6})(?=[ \t]|$)/;

/**
 * The block's headings renumbered so its shallowest one sits at `sectionLevel`.
 *
 * See the module comment for why this only ever demotes, why it moves the whole
 * block rather than the level-1 lines, and why it is scoped to `prose`. Returns
 * the lines untouched when the block has no heading, or when its shallowest one
 * is already at or below the page's section level.
 */
function withHeadingsAtSectionLevel(
  lines: readonly string[],
  kind: readonly LineKind[],
  sectionLevel: number,
): string[] {
  const headingLevel = (line: string, i: number): number | null => {
    if (kind[i] !== 'prose') return null;
    const m = ATX_HEADING.exec(line);
    return m ? m[2].length : null;
  };

  const levels = lines.map(headingLevel).filter((l): l is number => l !== null);
  if (levels.length === 0) return [...lines];

  const shift = sectionLevel - Math.min(...levels);
  if (shift <= 0) return [...lines]; // already at or below the page's level

  const deepest = Math.max(...levels) + shift;
  if (deepest > 6) {
    throw new Error(
      `file-description: renumbering this module header to start at level ${sectionLevel} would ` +
        `push a heading to level ${deepest}, and a run of seven hashes is not a heading at all. ` +
        `Reduce the heading depth in the source's own file header instead.`,
    );
  }

  return lines.map((line, i) => {
    const level = headingLevel(line, i);
    if (level === null) return line;
    const m = ATX_HEADING.exec(line)!;
    return `${m[1]}${'#'.repeat(level + shift)}${line.slice(m[1].length + m[2].length)}`;
  });
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
  // ONE resolution rule for every position a path can be referenced from — the
  // two `{@link}` forms and the bare-prose form below. A relative spelling means
  // the same file whichever of the three it is written in, so completing it in
  // one place and not the others would make the shape of the tag decide whether
  // a neighbour resolves (#6484).
  const routeFor = (target: string) =>
    ctx.sourcePathToDocsRoute(completeFromCategory(target, ctx.fromCategory));

  // A bare `@see <path>` tag renders as noise — turn it into prose.
  let out = text.replace(/^@see[ \t]+/gm, 'See also: ');

  // `{@link}` first, because this is the step that PRODUCES markdown links.
  out = mapProse(out, ['text'], s => s
    .replace(/\{@link\s+([^|]+?)\s*\|\s*([^}]+?)\s*\}/g, (_m, target: string, label: string) =>
      `[${label.trim()}](${routeFor(target.trim()) ?? target.trim()})`)
    .replace(/\{@link\s+([^}]+?)\s*\}/g, (_m, target: string) => {
      const route = routeFor(target.trim());
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
  //
  // No lookaround guards the parentheses any more (#6420). The pair `(?<!\()`
  // … `(?!\))` was this step's ORIGINAL, pre-tokenizer attempt at "do not touch
  // a path that is already a link's destination" — `](route)` puts that path
  // between exactly those two characters. It never could express that (the
  // module comment above says why: lookaround cannot say "not nested inside a
  // link"), and since #6136 it has had nothing left to do — a formed link is a
  // `link` run and this step is only shown `text` runs. What the pair still did
  // was refuse every path an AUTHOR wrote in parentheses, which is ordinary
  // prose and not a link at all: `- **Enterprise Connector**
  // (integration/connector.zod.ts) - …` rendered as neither a link nor code,
  // just plain text, on three published pages. So the guards go and the
  // tokenizer keeps the invariant they were reaching for.
  //
  // The directory segment is OPTIONAL (#6484). It used to be mandatory on both
  // sides of the mechanism — here and in `sourcePathToDocsRoute` — so a path
  // written relative to the module's own directory (`auth.zod.ts` inside
  // `identity/`) matched nothing at all and fell through as plain prose. Not a
  // link and not even the code-span fallback: nine such references on four
  // published pages, the one outcome of the three that is simply wrong.
  //
  // `?` and not `*`: the group stays capped at one segment so this widening is
  // strictly additive. `data/driver/postgres.zod.ts` still matches from
  // `driver/`, exactly as before — a two-segment group would swallow `data/`
  // too and change a shape this issue is not about.
  out = mapProse(out, ['text'], s =>
    s.replace(/((?:\.\.\/)*\b(?:[\w-]+\/)?[\w.-]+\.zod\.ts)\b/g, (_m, p: string) => {
      const route = routeFor(p);
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

  // Dropped BEFORE classification, so the marker never reaches the page and
  // never separates a fence from the `@example` tag above it. Only at prose
  // level: the same text inside a fenced block is an author illustrating the
  // convention, which is content (see SKILL_EXAMPLE_MARKER).
  const gutterless = stripDocGutter(block);
  const markerKind = classifyLines(gutterless);
  const lines = withTagBlocksSeparated(
    gutterless.filter((line, i) => !(markerKind[i] === 'prose' && line.trim() === SKILL_EXAMPLE_MARKER)),
  );
  const kind = classifyLines(lines);

  // Renumbered against the SAME classification the render loop below uses, so
  // the shift and the "this line is code" verdict can never disagree. Adding
  // hashes cannot change a line's kind — the indent is preserved, so a prose
  // line stays prose (#12249).
  const leveled = withHeadingsAtSectionLevel(lines, kind, ctx.sectionLevel);

  // Prose is rendered a RUN of lines at a time, never line by line: a sentence,
  // an inline code span and a `{@link}` tag may each wrap across source lines,
  // and a transform applied per line cuts them in half (#5553).
  const out: string[] = [];
  for (let i = 0; i < leveled.length;) {
    if (kind[i] === 'fenced') { out.push(leveled[i]); i++; continue; }

    if (kind[i] === 'indented') {
      const start = i;
      while (i < leveled.length && kind[i] === 'indented') i++;
      // Re-emitted as a fence: MDX has no indented code blocks, so left as it
      // was authored this would be parsed as prose containing JSX expressions.
      out.push('```', ...leveled.slice(start, i).map(line => line.replace(/^ {4}/, '')), '```');
      continue;
    }

    const start = i;
    while (i < leveled.length && kind[i] === 'prose') i++;
    out.push(renderProse(leveled.slice(start, i).join('\n'), ctx));
  }
  return out.join('\n').trim();
}
