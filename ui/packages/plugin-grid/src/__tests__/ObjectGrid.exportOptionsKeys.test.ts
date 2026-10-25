// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Structural drift guard for `exportOptions` (objectui#4535 / objectstack#8010).
 *
 * `ObjectGrid` reads a handful of keys off `schema.exportOptions`. Upstream,
 * `@objectstack/spec` derived `ListViewExportOptionsSchema`'s FIVE keys from
 * exactly that read set — so the declaration and the reads are one contract seen
 * from either end, and the whole point of objectstack#8010 was that they had
 * come apart: `streaming` was read here for releases while no schema declared
 * it, so authoring it was refused by nothing and honoured by nobody, and the
 * only way to discover the key was to read this renderer's source.
 *
 * That defect is silent by construction — an undeclared key does not fail to
 * compile, fail to parse, or fail to render; it simply has no authoring
 * surface. So the guard is mechanical, in the shape of the objectui#4302
 * package-door guard: scan `ObjectGrid.tsx` for the properties it actually
 * reads off `exportOptions` (through the `schema.exportOptions` expression and
 * through any local alias bound to it), scan `ListViewExportOptions` in
 * `@object-ui/types` for the properties it declares, and fail if the renderer
 * reads anything the type does not declare.
 *
 * Direction matters and is deliberate: read ⊆ declared. A DECLARED key with no
 * reader is not failed here — that is capability surface with no consumer,
 * caught on the type side by `objectql.exportOptions.test.ts`'s exact key-set
 * assertion. What this file forbids is the objectstack#8010 shape specifically:
 * a sixth key that the renderer honours and no author can legally write.
 *
 * Scope of the scan, stated rather than implied: it follows `schema.exportOptions`
 * and identifiers assigned from it in the same file. A key read through a helper
 * defined elsewhere, or through a dynamic `opts[name]`, would not be seen —
 * which is why both sides carry a floor assertion, so a scanner that goes blind
 * reds instead of passing on an empty set.
 *
 * ── objectui#8071: this file is `object-grid.exportOptions`' MEMBER PIN ──────
 *
 * The two directions above compare the renderer's read set against the local
 * TYPE. The third `describe` at the bottom adds the direction that makes this
 * file a per-block member pin under objectui#8068's criterion: it compares the
 * read set against the `object-grid` REGISTRATION — the surface an author of a
 * JSON view actually reads, and the only place this block states what a member
 * of `exportOptions` is. Neither the registration (`type: 'object'`, no `of`)
 * nor `ComponentPropsMap['object-grid'].exportOptions` (`z.unknown()`) fixes a
 * member shape, so that prose enumeration IS the declaration, and the read set
 * is the whole contract behind it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/plugin-grid/src/__tests__ -> repo root
const repoRoot = path.resolve(here, '../../../..');

const GRID_SOURCE = path.join(repoRoot, 'packages/plugin-grid/src/ObjectGrid.tsx');
const TYPES_SOURCE = path.join(repoRoot, 'packages/types/src/objectql.ts');

/**
 * The spec's five keys (`ListViewExportOptionsSchema`, `@objectstack/spec`
 * 17.0.0). Neither side of this test may be edited to make the other pass —
 * both are compared against this list, so widening the contract means changing
 * the spec first and this constant with it.
 */
const SPEC_KEYS = [
  'formats',
  'maxRecords',
  'includeHeaders',
  'fileNamePrefix',
  'streaming',
] as const;

/* ── Source scanning ─────────────────────────────────────────────────────── */

/**
 * Strip line and block comments and string/template literals.
 *
 * Without this, the prose above `exportableFormats` — which names
 * `schema.exportOptions.streaming` in a sentence — would be scanned as a read,
 * and a comment could silence a real one. Character-by-character rather than by
 * regex because `//` inside a string and a quote inside a comment each break
 * the naive version, in opposite directions.
 */
function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === ch) { i++; break; }
        i++;
      }
      out += ' ';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Identifiers bound to `schema.exportOptions` in the same file, e.g.
 * `const exportConfig = schema.exportOptions;`. The renderer reads through both
 * spellings, so a scan that only followed `schema.exportOptions` would miss
 * every key read off the alias — which is most of them.
 *
 * The trailing lookahead is load-bearing: without it
 * `const declared = schema.exportOptions?.formats` binds `declared` as an alias
 * of the OPTIONS, when it is really the format array — and every `declared.…`
 * call downstream (`.filter`) is then scanned as an undeclared option key. The
 * first run of this guard failed exactly that way, on `filter`.
 */
function exportOptionAliases(src: string): string[] {
  const aliases: string[] = [];
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*schema\s*\??\.\s*exportOptions\s*(?!\??\.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) aliases.push(m[1]);
  return aliases;
}

/**
 * Property names read off `exportOptions` (directly or via an alias).
 *
 * Tolerates the intervening forms the renderer may legally use — a wrapping
 * paren, an `as T` assertion, `?.` — so that re-introducing a cast cannot hide
 * a key from the scan. That matters: the `as any` this card deleted is exactly
 * how `streaming` stayed invisible.
 */
function readKeys(src: string): Set<string> {
  const clean = stripCommentsAndStrings(src);
  const roots = ['schema\\s*\\??\\.\\s*exportOptions', ...exportOptionAliases(clean).map((a) => `\\b${a}`)];
  const found = new Set<string>();
  for (const root of roots) {
    const re = new RegExp(`${root}\\s*(?:as\\s+[A-Za-z_$][\\w$<>\\[\\]., ]*)?\\s*\\)*\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) found.add(m[1]);
  }
  return found;
}

/**
 * Property names declared by the `ListViewExportOptions` interface body.
 *
 * Read from the type's own source rather than restated here: a restated list is
 * a third copy of the contract, and the copy is what drifts.
 */
function declaredKeys(src: string): Set<string> {
  const at = src.indexOf('export interface ListViewExportOptions');
  if (at === -1) return new Set();
  const open = src.indexOf('{', at);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return new Set();
  const body = stripCommentsAndStrings(src.slice(open + 1, end));
  const found = new Set<string>();
  const re = /(?:^|;|\n)\s*([A-Za-z_$][\w$]*)\s*\??\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) found.add(m[1]);
  return found;
}

const gridSource = readFileSync(GRID_SOURCE, 'utf8');
const typesSource = readFileSync(TYPES_SOURCE, 'utf8');

describe('exportOptions — the renderer reads only what the spec declares (objectui#4535)', () => {
  it('scans something: the alias and both sources are found', () => {
    // Non-vacuity floor. Every assertion below is a subset check, and a subset
    // check over an empty set passes for the worst possible reason.
    expect(gridSource).toContain('schema.exportOptions');
    expect(exportOptionAliases(stripCommentsAndStrings(gridSource)).length).toBeGreaterThan(0);
    expect(readKeys(gridSource).size).toBeGreaterThanOrEqual(4);
    expect(declaredKeys(typesSource).size).toBe(SPEC_KEYS.length);
  });

  it('declares exactly the spec\'s five keys — no more, no fewer', () => {
    expect([...declaredKeys(typesSource)].sort()).toEqual([...SPEC_KEYS].sort());
  });

  it('reads no key the type does not declare', () => {
    const declared = declaredKeys(typesSource);
    const undeclared = [...readKeys(gridSource)].filter((k) => !declared.has(k));
    // Named rather than counted: a failure must say WHICH key went undeclared,
    // because the fix is to declare it in the spec first — not to widen the
    // local type and re-open objectstack#8010 from the other side.
    expect(undeclared).toEqual([]);
  });

  it('still reads the keys the export menu depends on', () => {
    // The other direction of the floor: silently dropping a read would leave
    // the subset check green while the feature stopped working.
    const read = readKeys(gridSource);
    for (const key of ['formats', 'maxRecords', 'includeHeaders', 'fileNamePrefix', 'streaming']) {
      expect(read.has(key)).toBe(true);
    }
  });

  it('reads `streaming` without a cast — the key is declared now', () => {
    // objectui#4535 item 3: the read went through `as any` for as long as no
    // schema declared the key. A re-introduced cast here means the type and the
    // reader have come apart again.
    const clean = stripCommentsAndStrings(gridSource);
    expect(clean).not.toMatch(/exportOptions\s+as\s+any/);
    expect(clean).not.toMatch(/exportConfig\s+as\s+any/);
  });
});

/* ── The registration side (objectui#8071) ───────────────────────────────── */

const REGISTRATION_SOURCE = path.join(repoRoot, 'packages/plugin-grid/src/index.tsx');
const registrationSource = readFileSync(REGISTRATION_SOURCE, 'utf8');

/**
 * The `exportOptions` entry of the input array `object-grid` is registered
 * with, as its raw declaration line.
 *
 * Read out of the source rather than imported: pulling in the plugin's entry
 * module registers ~30 keys into the `ComponentRegistry` singleton, which this
 * project shares across files (see `vitest.config.mts`' `unit` project note on
 * absence assertions). The scan is the same instrument the rest of this file
 * already uses, and it is anchored on the registration call so it cannot drift
 * onto some other array.
 */
function objectGridInputLine(key: string): string | null {
  const arrayName = registrationSource
    .slice(registrationSource.indexOf("ComponentRegistry.register('object-grid'"))
    .match(/inputs:\s*([A-Za-z_$][\w$]*)/)?.[1];
  if (!arrayName) return null;
  const declAt = registrationSource.indexOf(`const ${arrayName}`);
  if (declAt === -1) return null;
  const end = registrationSource.indexOf('\n];', declAt);
  const body = registrationSource.slice(declAt, end === -1 ? undefined : end);
  return body.split('\n').find((l) => l.includes(`name: '${key}'`)) ?? null;
}

/**
 * The member keys the registration's description ENUMERATES, from its single
 * backticked `{ … }` list. That list is the block's whole statement about what
 * a member of `exportOptions` is.
 */
function documentedMemberKeys(line: string): string[] {
  const inner = line.match(/`\{([^`]*)\}`/)?.[1];
  return inner ? inner.split(',').map((k) => k.trim()).filter(Boolean) : [];
}

describe('object-grid `exportOptions` — members the BLOCK declares vs members the renderer reads (objectui#8071)', () => {
  const line = objectGridInputLine('exportOptions');

  it('scans something: `object-grid` registers an `exportOptions` input that enumerates members', () => {
    // Non-vacuity floor, in the same shape as the one above: both assertions
    // below are set comparisons, and a set comparison against nothing is the
    // cheapest possible green.
    expect(registrationSource).toContain("ComponentRegistry.register('object-grid'");
    expect(line, 'the object-grid registration declares an `exportOptions` input').toBeTruthy();
    expect(documentedMemberKeys(line!).length).toBeGreaterThan(0);
  });

  it('advertises no member key the renderer ignores', () => {
    // The direction that is safe to enforce outright: a documented member key
    // with no reader is authoring surface that does nothing — the failure the
    // page:header.actions hole (objectstack#11592) is made of, seen from the
    // declaration side. Named rather than counted, because the fix depends on
    // WHICH key: either the renderer lost a read, or the prose invented one.
    const read = readKeys(gridSource);
    const advertisedButUnread = documentedMemberKeys(line!).filter((k) => !read.has(k));
    expect(advertisedButUnread).toEqual([]);
  });

  it('reads no member key it does not advertise (objectui#8731)', () => {
    // Until objectui#8731, this asserted an EXACT non-empty gap
    // (`UNDOCUMENTED_BUT_READ = ['streaming']`): the registration's prose
    // enumeration was missing a key the renderer honours, and the assertion
    // named it so the fix would have to touch this file. The description now
    // enumerates `streaming` too, so the gap this pin measures is empty — the
    // regression this guards against is a FUTURE undocumented-but-read key,
    // caught the same way objectstack#8010 was: named, not just counted.
    const read = readKeys(gridSource);
    const documented = new Set(documentedMemberKeys(line!));
    const undocumentedButRead = [...read].filter((k) => !documented.has(k)).sort();
    expect(undocumentedButRead).toEqual([]);
  });
});
