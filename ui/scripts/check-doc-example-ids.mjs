#!/usr/bin/env node
/**
 * Every `<SchemaExample id="…" />` reference in `content/docs/**` must name an
 * id the schema catalog registry actually carries — or be an ILLUSTRATIVE
 * reference whose value is metasyntax rather than an id, which this gate
 * recognises by SHAPE and reports on every run.
 *
 * Run:  node scripts/check-doc-example-ids.mjs   (also `pnpm check:doc-example-ids`)
 *       node scripts/check-doc-example-ids.mjs --root <dir>   (scan a throwaway tree)
 * Exit: 0 = every real reference resolves; the funnel and the exemptions printed
 *       above are this run's own reading.
 *       1 = THE GATE RAN AND FOUND ERRORS. A page references an id the registry
 *       does not carry, or carries a `<SchemaExample>` with no id at all.
 *       2 = THE GATE COULD NOT RUN, so nothing above is a verdict about any
 *       page: the walk found no pages or no references, the registry reading
 *       collapsed, a tag could not be terminated, or the exemption rule's own
 *       premise stopped holding.
 *
 * The three-code split is borrowed from `check-doc-example-types.mjs`, for the
 * reason that file's header gives: "I could not run" and "I ran and found
 * errors" are different facts and must not share a code. Here the distinction is
 * the whole point — a gate whose population is empty reports zero misses and
 * reads exactly like a clean tree.
 *
 * ## The failure this closes (objectui#8623)
 *
 * `SchemaExample` resolves its `id` prop through `getExample(id)`, and the
 * generated catalog index implements that as a lookup that THROWS on an unknown
 * id, naming the id and listing the known ones. That throw is the right runtime
 * behaviour and this gate does not touch it: silently rendering a wrong or empty
 * example is the worse failure, because an author would never learn the id was
 * wrong. The gap is that the throw arrives at PAGE RENDER, in the published
 * docs, and nothing asks the question before then. A contributor who mistypes an
 * id gets green from every check in the repository and a crashed page on the
 * site.
 *
 * Nothing in the tree answered it. The catalog's own smoke suite resolves every
 * REGISTRY ENTRY, which cannot see a page pointing at an id that is not there —
 * the entry simply is not present to render. `check-doc-component-types.mjs`
 * walks the same pages but asks about `type` string literals in code blocks,
 * a different vocabulary against a different universe. The MDX extractor CLI is
 * wired into no script and no workflow.
 *
 * ## Why a fourth `check-doc-*` script rather than a leg on one of the three
 *
 * The name space is crowded and each neighbour was read before this one was
 * named. None of them can be extended without blurring a question it declares it
 * answers alone:
 *
 *   - `check-doc-example-types.mjs` compiles FENCED ts/tsx blocks inside JSDoc
 *     `@example` comments on exported declarations under `packages/NAME/src/**`,
 *     against the built `.d.ts`. Different population (source comments, not
 *     pages), different instrument (a TypeScript program), different universe.
 *   - `check-doc-example-shared-reader.mjs` asks whether a doc comment
 *     hand-spells a call-site ladder that a published shared reader owns. Its
 *     header rules `content/docs/**` out of its surface explicitly.
 *   - `check-doc-component-types.mjs` is the closest in SHAPE — it walks these
 *     same pages and derives its universe from source on every run, which is why
 *     this file borrows both habits. But its subject is a `type` string literal
 *     inside a fenced code block, judged against the component registry, and its
 *     header states it answers one question only. A `SchemaExample` id is a JSX
 *     attribute in the page's PROSE, judged against the example catalog. Folding
 *     two universes into one gate would make its verdict line ambiguous about
 *     which vocabulary failed, for no shared work: the two scans overlap in
 *     nothing but the file walk.
 *
 * ## The population is `content/docs/**` and deliberately stops there
 *
 * The same reference shape appears outside these pages — in the examples
 * READMEs, in the generated index itself, in the catalog smoke test, in a script
 * test, in the extractor CLI, in the Python regenerator, and in the site's own
 * `SchemaExample` and `SchemaCatalogIndex` components. Every one of those is
 * either illustrative prose or the machinery itself, and a gate that failed on a
 * README's teaching id would be its own defect. `content/docs/**` is the surface
 * that RENDERS: an id here becomes a `getExample` call in a published page.
 *
 * Code fences inside those pages are NOT exempt, on purpose. A fenced
 * `<SchemaExample id="…" />` is a line a reader copies; a stale id there crashes
 * their page exactly as one in prose crashes ours. The only exemption is the
 * shape rule below.
 *
 * ## The exemption, declared here because it is a real carve-out
 *
 * Two references in the tree are not ids and never were. They live in the
 * catalog authoring guide: one is the angle-bracket template in the snippet that
 * TEACHES the tag's syntax, the other is an ellipsis inside the sentence
 * describing the tag. A naive gate reds on both on its first run.
 *
 * The tempting repair is a list of those two literal strings. That is a ledger,
 * and a ledger rots: it silently exempts a page that later reuses one of the
 * strings for a different reason, and it says nothing about the third
 * placeholder somebody writes next week. So the rule reads the SHAPE instead —
 * a value carrying metasyntax that no catalog id can contain:
 *
 *   - an angle-bracket metavariable (`<category>/<your-id>`)
 *   - an elision, Unicode `…` or ASCII `...`
 *
 * Ids are derived from `<category>/<slug>.json` file names, so neither marker
 * can occur in one. That claim is a PREMISE, not a belief: `assertMarkersAreImpossible`
 * re-derives it from the live registry on every run and exits 2 if it ever stops
 * holding, rather than letting the exemption quietly swallow a real id.
 *
 * Note what the rule deliberately does NOT exempt: an id that is merely
 * MALFORMED — wrong case, wrong segment count, a typo, a trailing space — is a
 * real reference and must resolve. Only the metasyntax vocabulary above is
 * illustrative. And exempted references are never silent: every run prints each
 * one with its page, its value and the marker that matched it.
 *
 * ## Controls, because green here proves nothing on its own
 *
 * On the day this landed, all 413 distinct real references resolved. A gate
 * whose population is clean is a gate nobody has seen fire, so three controls
 * run inside the gate and a fourth lives in the test:
 *
 *   1. The page walk must be non-empty. A walk that reads zero files reports
 *      zero misses.
 *   2. The reference scan must be non-empty. A matcher that has stopped
 *      matching produces the same clean verdict as a clean tree.
 *   3. The registry reading is taken TWICE from the generated index by two
 *      independent readers — the REGISTRY object's own keys, which is what
 *      `getExample` indexes, and the schema import specifiers above it — and the
 *      two must agree exactly. A parser that read half the file would otherwise
 *      turn correct pages red, which is the expensive direction.
 *   4. The firing control is in `scripts/__tests__/check-doc-example-ids.test.ts`:
 *      it runs THIS script over a throwaway tree carrying a deliberately unknown
 *      id and asserts the exit code and the message. A unit test of a helper
 *      would not have shown the gate going red.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

/** Pages this gate reads, relative to the scan root. */
export const DOCS_DIR = 'content/docs';

/** The generated catalog index — the artifact `getExample` indexes at runtime. */
export const CATALOG_INDEX = 'examples/schema-catalog/src/index.ts';

/** Both extensions render as pages; `.md` is not a second-class surface here. */
export const DOC_EXTENSIONS = ['.mdx', '.md'];

/** The JSX tag whose `id` attribute reaches `getExample`. */
export const TAG = 'SchemaExample';

/**
 * Metasyntax vocabulary that marks a reference as illustrative rather than an
 * id. See "The exemption" above for why this is a shape rule and not a list of
 * the two strings it currently matches.
 */
export const PLACEHOLDER_MARKERS = [
  { name: 'angle-bracket metavariable', matches: (value) => /[<>]/.test(value) },
  { name: 'elision', matches: (value) => value.includes('…') || value.includes('...') },
];

/** The marker (if any) that makes `value` illustrative. */
export function placeholderMarker(value) {
  return PLACEHOLDER_MARKERS.find((marker) => marker.matches(value)) ?? null;
}

/** Every `.mdx`/`.md` page under `DOCS_DIR`, relative to `root`, sorted. */
export function scanDocs(root) {
  const base = path.join(root, DOCS_DIR);
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (DOC_EXTENSIONS.includes(path.extname(entry.name))) {
        out.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  };
  walk(base);
  return out;
}

/**
 * The end index of the JSX tag opening at `start`, honouring quoted attribute
 * values.
 *
 * A naive `<SchemaExample[^>]*>` cannot read this population: the authoring
 * guide's own template puts a `>` INSIDE the quoted id, and a scan that stops at
 * the first `>` silently truncates the value it is about to judge.
 *
 * Returns `-1` when the tag never terminates, which the caller escalates rather
 * than skipping — an unterminated tag is a reference this gate can see and
 * cannot decide.
 */
export function findTagEnd(text, start) {
  let quote = null;
  for (let i = start + TAG.length + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return i + 1;
  }
  return -1;
}

const ID_ATTRIBUTE = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/;

/** Every `<SchemaExample …>` reference in `files`, in page order. */
export function scanReferences(root, files) {
  const refs = [];
  const unterminated = [];
  const opener = new RegExp(`<${TAG}(?![A-Za-z0-9_])`, 'g');
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    opener.lastIndex = 0;
    let match;
    while ((match = opener.exec(text)) !== null) {
      const start = match.index;
      const end = findTagEnd(text, start);
      const line = text.slice(0, start).split('\n').length;
      if (end === -1) {
        unterminated.push({ file, line });
        break;
      }
      const raw = text.slice(start, end);
      const attribute = ID_ATTRIBUTE.exec(raw);
      refs.push({ file, line, id: attribute ? (attribute[1] ?? attribute[2]) : null });
      opener.lastIndex = end;
    }
  }
  return { refs, unterminated };
}

/**
 * The catalog's id universe, read twice from the generated index.
 *
 * `keys` is what `getExample` indexes. `imports` is the schema import specifiers
 * the generator writes above it. They are independent readings of one file and
 * must agree; see control 3 in the header.
 */
export function deriveCatalogIds(root) {
  const file = path.join(root, CATALOG_INDEX);
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    return { keys: [], imports: [], error: `cannot read ${CATALOG_INDEX}` };
  }
  const registryStart = source.indexOf('const REGISTRY');
  if (registryStart === -1) {
    return { keys: [], imports: [], error: `no REGISTRY object in ${CATALOG_INDEX}` };
  }
  const body = source.slice(registryStart);
  const keys = [...body.matchAll(/(?<=\n)\s{2}'([^']+)':\s*\{/g)].map((m) => m[1]);
  const imports = [...source.matchAll(/from\s+'\.\/schemas\/([^']+)\.json'/g)].map((m) => m[1]);
  return { keys, imports, error: null };
}

/**
 * Re-derive the exemption rule's premise from the live registry.
 *
 * The rule only stays honest while no real id can carry a marker. If one ever
 * can, the exemption would swallow a reference that should have been judged —
 * so the gate stops instead of guessing.
 */
export function assertMarkersAreImpossible(ids) {
  return ids
    .map((id) => ({ id, marker: placeholderMarker(id) }))
    .filter((row) => row.marker !== null);
}

/** Split the references into exempted, resolved and failing. */
export function classify(refs, ids) {
  const known = new Set(ids);
  const placeholders = [];
  const resolved = [];
  const unresolved = [];
  const missingId = [];
  for (const ref of refs) {
    if (ref.id === null) {
      missingId.push(ref);
      continue;
    }
    const marker = placeholderMarker(ref.id);
    if (marker) placeholders.push({ ...ref, marker: marker.name });
    else if (known.has(ref.id)) resolved.push(ref);
    else unresolved.push(ref);
  }
  return { placeholders, resolved, unresolved, missingId };
}

export function run(root) {
  const out = [];
  const say = (line) => out.push(line);
  const stop = (code, why) => {
    say(why);
    return { code, output: out.join('\n') };
  };

  const registry = deriveCatalogIds(root);
  if (registry.error) {
    return stop(2, `⛔ THE GATE COULD NOT RUN — ${registry.error}. Nothing above is a verdict.`);
  }
  if (registry.keys.length === 0) {
    return stop(
      2,
      `⛔ THE GATE COULD NOT RUN — the registry reading found 0 ids in ${CATALOG_INDEX}. ` +
        'A zero here would make every reference below look unresolvable.',
    );
  }
  const keySet = new Set(registry.keys);
  const importSet = new Set(registry.imports);
  const agree =
    keySet.size === importSet.size && [...keySet].every((id) => importSet.has(id));
  if (!agree) {
    return stop(
      2,
      `⛔ THE GATE COULD NOT RUN — the two readings of ${CATALOG_INDEX} disagree: ` +
        `${keySet.size} REGISTRY key(s) vs ${importSet.size} schema import(s). ` +
        'The generated shape moved out from under this parser; nothing above is a verdict.',
    );
  }

  const impossible = assertMarkersAreImpossible(registry.keys);
  if (impossible.length > 0) {
    return stop(
      2,
      '⛔ THE GATE COULD NOT RUN — the placeholder rule\'s premise no longer holds. ' +
        `${impossible.length} real catalog id(s) now carry metasyntax that this gate treats as ` +
        `illustrative (first: "${impossible[0].id}", ${impossible[0].marker.name}). ` +
        'The exemption would swallow a real reference; fix the rule rather than the run.',
    );
  }

  const files = scanDocs(root);
  if (files.length === 0) {
    return stop(
      2,
      `⛔ THE GATE COULD NOT RUN — the walk of ${DOCS_DIR} found 0 page(s). ` +
        'A walk that reads nothing reports no misses and reads exactly like a clean tree.',
    );
  }

  const { refs, unterminated } = scanReferences(root, files);
  if (unterminated.length > 0) {
    const first = unterminated[0];
    return stop(
      2,
      `⛔ THE GATE COULD NOT RUN — an unterminated <${TAG}> tag in ${first.file} (line ${first.line}). ` +
        'This gate can see the reference and cannot decide it; nothing above is a verdict.',
    );
  }
  if (refs.length === 0) {
    return stop(
      2,
      `⛔ THE GATE COULD NOT RUN — ${files.length} page(s) walked but 0 <${TAG}> reference(s) found. ` +
        'The matcher has stopped matching; a clean verdict here would be a reading of nothing.',
    );
  }

  const { placeholders, resolved, unresolved, missingId } = classify(refs, registry.keys);
  const distinct = new Set(refs.map((r) => r.id)).size;
  say(
    `Doc example ids — walked ${files.length} page(s) under ${DOCS_DIR}, found ${refs.length} ` +
      `<${TAG}> reference(s) (${distinct} distinct), against ${registry.keys.length} catalog id(s).`,
  );

  if (placeholders.length > 0) {
    say(`\nExempted ${placeholders.length} illustrative reference(s) — metasyntax, never an id:`);
    for (const p of placeholders) {
      say(`  ${p.file} (line ${p.line})  id="${p.id}"  — ${p.marker}`);
    }
  }

  if (missingId.length > 0) {
    say(`\n⛔ ${missingId.length} <${TAG}> tag(s) carry no id at all — getExample() throws on those too:`);
    for (const m of missingId) say(`  ${m.file} (line ${m.line})`);
  }

  if (unresolved.length > 0) {
    say(`\n⛔ ${unresolved.length} reference(s) name an id the catalog registry does not carry:`);
    for (const u of unresolved) {
      say(`  ${u.file} (line ${u.line})  id="${u.id}"`);
    }
    say(
      '\nEach one is a throw at page render in the published docs, not a blank tile. ' +
        'Fix the id, or add the schema and regenerate the catalog index. ' +
        '⛔ Do not make getExample fall back — a silently wrong example teaches the wrong thing.',
    );
  }

  if (unresolved.length > 0 || missingId.length > 0) {
    return { code: 1, output: out.join('\n') };
  }

  say(`\n✅ ${resolved.length} real reference(s) all resolve in the catalog registry.`);
  return { code: 0, output: out.join('\n') };
}

export function main(argv) {
  const rootFlag = argv.indexOf('--root');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = rootFlag === -1 ? path.resolve(here, '..') : path.resolve(argv[rootFlag + 1]);
  const { code, output } = run(root);
  return { code, output };
}

// The ONE predicate every `scripts/**` entry guard goes through. A hand-typed
// comparison against `process.argv[1]` is silently wrong: node leaves that value
// as the caller typed it, so a script reached through a symlink compares two
// different paths, answers false and does nothing — exit 0, no output, which a
// CI wrapper reading only the status cannot tell from a pass.
if (isEntrypoint(import.meta.url)) {
  const { code, output } = main(process.argv.slice(2));
  process.stdout.write(`${output}\n`);
  process.exit(code);
}
