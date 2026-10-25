// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `common.search` is retired from all ten locale packs, and must stay that way
 * (objectui#4392).
 *
 * ## What was removed and why
 *
 * One key — `common.search` (`Search`, no ellipsis) — in each of the ten packs.
 * Its only consumer was `LookupField`, which built its dialog placeholder by
 * concatenating `common.search` with three ASCII full stops. objectui#4375 /
 * PR #4391 retired that concatenation: the placeholder is now the reused
 * `table.search` pack value (`Search…`, one U+2026 glyph), which is what let
 * objectui#3878's glyph pin cover it. That left `common.search` with no reader
 * anywhere in the repo, in any package or app.
 *
 * The ruling on objectui#4392 was RETIRE rather than keep-as-vocabulary: nothing
 * pins a dormant key's meaning, so its next reader inherits an unreviewed
 * contract, and a dormant key is exactly where a future author reaches first and
 * re-creates a second dialect alongside `table.search`. Same reasoning as the
 * objectui#4328 dead-surface family.
 *
 * ## Why this pin is NEGATIVE, and why it is needed at all
 *
 * Every i18n gate in this repo runs **call site → key**, never key → call site
 * (the mechanism objectui#4145 wrote down for `report.editor.*`, unchanged):
 *
 *   - `scripts/check-i18n-call-site-keys.mjs` asks whether each call site's key
 *     resolves in `en`. A key with no call site is never visited.
 *   - `all-locales-key-parity.test.ts` compares the ten packs' key SETS to each
 *     other. One dead key present in all ten packs is exactly what it wants.
 *   - `scripts/check-i18n-en-drift.mjs` only fires when an `en` value CHANGES.
 *     This value was static.
 *
 * So a single key can return to all ten packs with every gate green. Restoring
 * `common.search` to any pack must go red here.
 *
 * Reverse-verified: restoring the key to ONE pack turns two independent gates
 * red — this pin (naming the pack) and `all-locales-key-parity`'s "en defines
 * every key the other packs define"; restoring it to all ten leaves parity green
 * and only this pin red, which is the case parity structurally cannot see.
 *
 * ## What this file does NOT claim
 *
 * `common` itself is a live namespace with ~45 keys and many readers. Only the
 * one leaf went. The sibling assertions below exist so a green here cannot be
 * bought by deleting the neighbourhood — in particular `common.select`, minted
 * one commit earlier by objectui#4386 / PR #4397 and a different key entirely.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtInLocales } from '../locales/index';

/**
 * The repo root, derived from THIS FILE's own location — never from
 * `process.cwd()` (objectui#7799).
 *
 * It was `process.cwd()` until then, on the reasoning that
 * `scripts/vitest-invocation-guard.mjs` refuses any invocation whose vitest root
 * is not the repo root. That guard is real, but it is a DIFFERENT invariant:
 * `--root` moves VITEST's root and moves nothing about `process.cwd()`. This
 * package's own `test` script — `vitest run --root ../.. packages/i18n/`, which
 * is what `pnpm --filter … test` and `turbo run test` both run — leaves cwd at
 * `packages/i18n/`, so every read below resolved against the package directory
 * and the assertions guarding them failed.
 *
 * Spelled in string operations, copying the landed precedent of objectui#7791
 * (PR #7796): `new URL(rel, import.meta.url)` is REWRITTEN by Vite into a
 * `http://localhost:3000/@fs/…` dev-server URL, so only bare `import.meta.url`
 * is read here and taken apart by hand. Measured on this card under both cwds
 * and in both the `unit` and the `dom` project, it is
 * `file:///…/packages/i18n/src/__tests__/<this file>`.
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 5; // packages / i18n / src / __tests__ / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');


// Derived from the map rather than left as `string[]`: `Object.keys` erases
// which keys it enumerated, so `builtInLocales[lang]` below would be an
// implicit-`any` index into a `const` map (TS7053). Same convention as
// `report-editor-retired-4145.test.ts` next door.
type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

/** The retired leaf, named rather than counted. */
const RETIRED = 'search';

/**
 * The keys the deletion swept AROUND, in the packs' own order. `create` and
 * `filter` are the immediate neighbours of the removed line; `select` is the
 * near-homograph the dispatch for this retirement warned about.
 */
const SURVIVING_NEIGHBOURS = ['create', 'filter', 'select'] as const;

/** This file names the retired key in call shape, so it excludes itself below. */
const SELF = fileURLToPath(import.meta.url);

describe('`common.search` is retired from the ten packs (objectui#4392)', () => {
  it('covers all ten packs and a live `common` root (guards the loops from emptying)', () => {
    // Guards the premise the rest of the file rests on. A pin that iterates an
    // empty pack list, or asserts absence inside a namespace that itself
    // vanished, is green for the wrong reason.
    expect(LANGS).toHaveLength(10);
    for (const lang of LANGS) {
      const common = at(builtInLocales[lang], 'common');
      expect(common, `${lang} lost the common root`).toBeDefined();
      expect(Object.keys(common as Record<string, unknown>).length, lang).toBeGreaterThan(30);
    }
  });

  it('no pack defines `common.search`, in any of the ten packs', () => {
    const revived: string[] = [];
    for (const lang of LANGS) {
      if (at(builtInLocales[lang], `common.${RETIRED}`) !== undefined) {
        revived.push(`${lang} :: common.${RETIRED}`);
      }
    }
    // Named, not counted: the failure message has to say WHICH pack, because a
    // half-reverted retirement is repaired pack by pack.
    expect(
      revived,
      '`common.search` is back in a locale pack. It is retired (objectui#4392): ' +
        'the search placeholder every widget uses is `table.search`, which is ' +
        'already translated in all ten packs and carries the U+2026 glyph ' +
        'objectui#3878 pinned. Read that key instead of restoring this one.',
    ).toEqual([]);
  });

  it('the deletion swept around its neighbours — they are real translations in all ten packs', () => {
    // A green "the key is gone" is worth nothing if the line above or below it
    // went too. `select` is here by name because it is one letter of intent away
    // from the retired key and was minted the commit before this retirement.
    for (const lang of LANGS) {
      for (const key of SURVIVING_NEIGHBOURS) {
        const value = at(builtInLocales[lang], `common.${key}`);
        expect(typeof value, `${lang} :: common.${key}`).toBe('string');
        expect((value as string).length, `${lang} :: common.${key}`).toBeGreaterThan(0);
      }
    }
    // A sample across writing systems, so "all ten packs kept the keys" cannot
    // be satisfied by ten copies of the English string.
    expect(at(builtInLocales.en, 'common.select')).toBe('Select…');
    expect(at(builtInLocales.zh, 'common.select')).toBe('选择…');
    expect(at(builtInLocales.ru, 'common.select')).toBe('Выбрать…');
    expect(at(builtInLocales.ar, 'common.select')).toBe('اختر…');
    expect(at(builtInLocales.en, 'common.filter')).toBe('Filter');
    expect(at(builtInLocales.zh, 'common.filter')).toBe('筛选');
  });

  it('no package or app reads `common.search`, and no fallback table re-declares it', () => {
    // Repo-wide rather than root-scoped: `common.*` is the shared vocabulary
    // namespace, so unlike a feature namespace there is no short list of trees
    // that could plausibly reach for it.
    //
    // Why pin the READER when `check:i18n-keys` already fails on a `t()` key no
    // pack defines: that gate reports it as "key missing from `en`", and the
    // obvious repair for a missing key is to backfill it — which is exactly the
    // move that revives the retired key. This assertion is where the reason
    // lives, so the next author reads "this key is retired" instead of "the
    // packs are behind".
    //
    // Two offence shapes, both deliberately narrow so that PROSE naming the key
    // stays legal (this file's own header does it, and so does the note in
    // `packages/fields/src/complex-widgets.test.tsx`):
    //
    //   1. a call-shaped read — an identifier, `(`, then the quoted key. Bare
    //      `common.search` in a comment has no call around it and is fine.
    //   2. a no-provider fallback table entry — the quoted key in KEY position,
    //      i.e. followed by `:`. That is the shape the dormant copy in
    //      `useFieldTranslation.ts` had, and no pack gate can see it: those
    //      tables are plain `Record<string, string>` literals in consuming
    //      packages, read only when no `LocalizationProvider` is mounted.
    //
    // Comments are NOT stripped before this runs — same trade objectui#4145
    // made: a comment stripper mishandling `//` inside a string literal drops
    // real code from the scan, and a false negative is the one direction a
    // revival gate must not fail in.
    const CALL_SHAPED = /\b[A-Za-z_$][\w$]*\(\s*['"`]common\.search['"`]/;
    const TABLE_ENTRY = /['"`]common\.search['"`]\s*:/;

    const roots = ['packages', 'apps'];
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        // This file spells the key in call shape (`at(pack, 'common.search')`)
        // to assert its absence, and would otherwise score itself as the
        // offence. Resolved from `import.meta.url` so a rename cannot silently
        // turn the exclusion into a scan of nothing.
        if (full === SELF) continue;
        const src = readFileSync(full, 'utf8');
        if (CALL_SHAPED.test(src)) offenders.push(`${full} :: reads common.search`);
        if (TABLE_ENTRY.test(src)) offenders.push(`${full} :: declares common.search`);
      }
    };

    for (const root of roots) {
      const abs = join(REPO_ROOT, root);
      expect(existsSync(abs), `scan root missing: ${abs}`).toBe(true);
      walk(abs);
    }

    expect(
      offenders,
      '`common.search` is being read or re-declared. The key is retired ' +
        '(objectui#4392) — do NOT backfill it into the packs. A search ' +
        'placeholder should read `table.search`; a fallback table should ' +
        'declare `table.search` for the same reason. If this hit is ' +
        'DOCUMENTATION, name the key on its own rather than spelling a t() ' +
        'call around it; comments are intentionally not stripped here.',
    ).toEqual([]);
  });

  it('the dynamic `common.${…}` reader cannot reach the retired key', () => {
    // The one reader that composes a `common.*` key at runtime is
    // `useChatbotLabel`, whose parameter is a two-member union type. A type
    // union is not visible to the scan above, so it is asserted here by shape
    // rather than by path: every file that composes a dynamic `common.*` key
    // must not carry a bare `search` string token that could widen into it.
    //
    // Path-free on purpose — `packages/plugin-chatbot` has in-flight owners
    // (objectui#4383), and a pin naming its files would go red on an unrelated
    // rename instead of on the thing it guards.
    const DYNAMIC = /\b[A-Za-z_$][\w$]*\(\s*`common\.\$\{/;
    const BARE_SEARCH_TOKEN = /(['"`])search\1/;

    const risky: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (full === SELF) continue;
        const src = readFileSync(full, 'utf8');
        if (DYNAMIC.test(src) && BARE_SEARCH_TOKEN.test(src)) {
          risky.push(`${full} :: dynamic common.\${…} alongside a 'search' key token`);
        }
      }
    };
    for (const root of ['packages', 'apps']) walk(join(REPO_ROOT, root));

    expect(
      risky,
      'A file composes `common.${…}` at runtime AND names a bare `search` key ' +
        'token, so it may resolve the retired `common.search` (objectui#4392). ' +
        'Point that slot at `table.search` instead.',
    ).toEqual([]);
  });
});
