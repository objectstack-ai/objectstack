/**
 * Danger colours are spelled so the browser keeps them, in both themes
 * (objectstack#35911, items 1 and 2).
 *
 * `--destructive` (and `--destructive-text`) hold a bare HSL triplet such as
 * `0 84.2% 60.2%`. A declaration whose value is a bare `var(--destructive)` is
 * therefore not a colour: the browser drops it — a `var()` fallback never
 * applies, because the variable IS defined — and the element renders in the
 * inherited colour. The export-error line of the grid and list views and the
 * Markdown caution alert rendered that way. The valid spellings wrap the
 * variable in `hsl(...)`, or use the `text-destructive` utility, which reads
 * the dark-aware text token (`--text-color-destructive`, objectstack#35658).
 *
 * `fill-destructive` / `stroke-destructive` resolve from `--color-destructive`,
 * the deep red chosen as the dark theme's button FILL, which is unreadable as a
 * line or glyph on a dark canvas. A danger stroke or glyph paints with
 * `currentColor` under `text-destructive` instead, so it follows the same text
 * token in dark and stays the same red in light.
 *
 * The danger tokens are not the only triplets. Every token a theme block
 * (`:root` / `.dark`) stores as a bare triplet — `--muted-foreground`,
 * `--border`, `--chart-N`, the sidebar and status tokens — fails the same way
 * when a declaration reads it bare, so the bare-`var()` case covers them all
 * (objectstack#35962: the state-machine chip's fallback dot read
 * `var(--muted-foreground)` and rendered nothing). The token list is READ from
 * the theme blocks below, never typed here, so a token added to a theme is
 * covered without editing this file. Tailwind's `(--token)` shorthand compiles
 * to the same bare `var()`, so it is scanned too.
 *
 * The scan covers every source file that ships under `ui/packages/<pkg>/src`
 * and `ui/apps/<app>/src`; test files are skipped (they quote the bad spelling).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(here, '../../../..');

const SOURCE = /\.(css|ts|tsx)$/;
const TEST = /\.(test|spec)\.(ts|tsx)$|__tests__/;

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE.test(entry.name) && !TEST.test(full)) out.push(full);
  }
}

function shippedSources(): string[] {
  const out: string[] = [];
  for (const group of ['packages', 'apps']) {
    const base = path.join(uiRoot, group);
    for (const pkg of fs.readdirSync(base)) {
      const src = path.join(base, pkg, 'src');
      if (fs.existsSync(src)) walk(src, out);
    }
  }
  return out;
}

/**
 * The files that define the theme tokens: the library stylesheet, the Console's
 * and the runner's own, and the stylesheet the CLI app generator writes (held
 * in a template string, which the block reader below reads the same way).
 */
const THEME_FILES = [
  'packages/components/src/index.css',
  'apps/console/src/index.css',
  'packages/runner/src/index.css',
  'packages/cli/src/utils/app-generator.ts',
];

/** The bodies of every `:root { … }` and `.dark { … }` block in `text`, comments blanked by the shared mask. */
function themeBlocks(text: string): string[] {
  const out: string[] = [];
  const open = /(?:^|[\s}`])(?::root|\.dark)\s*\{/g;
  for (let m = open.exec(text); m; m = open.exec(text)) {
    let i = open.lastIndex;
    let depth = 1;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    out.push(maskComments(text.slice(open.lastIndex, i - 1)));
  }
  return out;
}

/** `215.4 16.3% 46.9%` — the value shape `hsl()` must wrap. */
const TRIPLET = /^-?[\d.]+(?:deg)?\s+[\d.]+%\s+[\d.]+%$/;

/**
 * Every custom property a theme block stores as a bare triplet, plus the
 * engine variable a triplet token reads with a triplet fallback
 * (`--destructive-text: var(--destructive-text-light, 0 73.7% 41.8%)` makes
 * both names triplets; the ThemeEngine writes the inner one inline).
 */
function tripletTokens(files: string[] = THEME_FILES): Set<string> {
  const tokens = new Set<string>();
  for (const rel of files) {
    const text = fs.readFileSync(path.join(uiRoot, rel), 'utf8');
    for (const body of themeBlocks(text)) {
      for (const [, name, raw] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        const value = raw.trim();
        const fallback = value.match(/^var\((--[\w-]+)\s*,\s*([^()]*)\)$/);
        if (TRIPLET.test(value)) tokens.add(name);
        else if (fallback && TRIPLET.test(fallback[2].trim())) {
          tokens.add(name);
          tokens.add(fallback[1]);
        }
      }
    }
  }
  return tokens;
}

const TOKENS = tripletTokens();
const NAMES = [...TOKENS].sort((a, b) => b.length - a.length).map((n) => n.slice(2));
/** A triplet token read through `var()`; the lookahead keeps `--muted` from matching `--muted-foreground`. */
const TRIPLET_VAR = new RegExp(`var\\(--(?:${NAMES.join('|')})(?![\\w-])`, 'g');
/** Tailwind 4's `bg-(--token)` shorthand, which compiles to the same bare `var(--token)`. */
const TRIPLET_SHORTHAND = new RegExp(`-\\(--(?:${NAMES.join('|')})\\)`);

/**
 * Whether the `var(` at `at` is spelled so the triplet is never the colour
 * value itself: directly inside `hsl(` / `hsla(`, as the value of a custom
 * property (a triplet may alias a triplet), or as the fallback of an outer
 * `var()` that is itself in one of those positions.
 */
function wrapped(line: string, at: number): boolean {
  const before = line.slice(0, at);
  if (/hsla?\(\s*$/.test(before)) return true;
  if (/--[\w-]+['"]?\s*:\s*['"]?$/.test(before)) return true;
  const outer = before.match(/var\(--[\w-]+\s*,\s*$/);
  return outer ? wrapped(line, before.length - outer[0].length) : false;
}

const FILL_OR_STROKE = /\b(?:fill|stroke)-destructive\b/g;

function bareTripletReads(): string[] {
  const hits: string[] = [];
  for (const file of shippedSources()) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const bare =
        [...line.matchAll(TRIPLET_VAR)].some((m) => !wrapped(line, m.index ?? 0)) || TRIPLET_SHORTHAND.test(line);
      if (bare) hits.push(`${path.relative(uiRoot, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

function offences(re: RegExp, strip?: RegExp[]): string[] {
  const hits: string[] = [];
  for (const file of shippedSources()) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const rest = (strip ?? []).reduce((acc, re) => acc.replace(re, ''), line);
      if (rest.match(re)) hits.push(`${path.relative(uiRoot, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

describe('danger colour spelling (#35911)', () => {
  it('the scan reaches the files it guards', () => {
    const files = shippedSources().map((f) => path.relative(uiRoot, f));
    expect(files).toContain('packages/plugin-grid/src/ObjectGrid.tsx');
    expect(files).toContain('packages/plugin-list/src/ListView.tsx');
    expect(files).toContain('packages/plugin-markdown/src/markdown-theme.ts');
    expect(files).toContain('packages/app-shell/src/views/metadata-admin/previews/FlowCanvas.tsx');
  });

  it('the token list is read from every theme block and holds the triplet tokens', () => {
    for (const rel of THEME_FILES) {
      const text = fs.readFileSync(path.join(uiRoot, rel), 'utf8');
      expect(themeBlocks(text).length, rel).toBeGreaterThanOrEqual(2);
      expect(tripletTokens([rel]).size, rel).toBeGreaterThan(20);
    }
    for (const name of [
      '--destructive',
      '--destructive-text',
      '--destructive-text-light',
      '--destructive-text-dark',
      '--destructive-foreground',
      '--muted-foreground',
      '--border',
      '--chart-1',
    ]) {
      expect(TOKENS.has(name), name).toBe(true);
    }
    // A token whose value is already a colour, or not a colour, is not a triplet.
    for (const name of ['--surface', '--text-muted', '--radius', '--shadow-sm']) {
      expect(TOKENS.has(name), name).toBe(false);
    }
  });

  it('the bare-read detector tells a wrapped triplet from a bare one', () => {
    const bare = (line: string) => [...line.matchAll(TRIPLET_VAR)].some((m) => !wrapped(line, m.index ?? 0));
    expect(bare(`style={{ backgroundColor: color ?? 'var(--muted-foreground)' }}`)).toBe(true);
    expect(bare('color: var(--destructive);')).toBe(true);
    expect(bare('color: var(--x, var(--muted));')).toBe(true);
    expect(bare('border-color: hsl(var(--border));')).toBe(false);
    expect(bare('background: hsl(var(--muted) / 0.4);')).toBe(false);
    expect(bare('color: hsl(var(--destructive-text, var(--destructive)));')).toBe(false);
    expect(bare('--destructive-text: var(--destructive-text-light, 0 73.7% 41.8%);')).toBe(false);
    expect(bare('color: var(--muted-foreground-x);')).toBe(false);
    expect(TRIPLET_SHORTHAND.test('bg-(--muted)')).toBe(true);
    expect(TRIPLET_SHORTHAND.test('bg-(--os-dot-bg)')).toBe(false);
  });

  it('no shipped source uses a bare var() of a triplet theme token as a colour value', () => {
    expect(bareTripletReads()).toEqual([]);
  });

  it('no shipped source paints a danger fill or stroke from the dark button-fill red', () => {
    expect(offences(FILL_OR_STROKE)).toEqual([]);
  });

  it('the Markdown theme wraps every theme variable it paints with in hsl()', () => {
    const css = fs.readFileSync(path.join(uiRoot, 'packages/plugin-markdown/src/markdown-theme.ts'), 'utf8');
    const caution = css
      .split('\n')
      .filter((l) => l.includes('.markdown-alert-caution') && !l.includes('::before'));
    expect(caution).toHaveLength(2);
    for (const rule of caution) expect(rule).toContain('hsl(var(--destructive-text, var(--destructive)))');
    // The same file paints anchors, quotes and blockquotes from triplet variables too.
    const bare = css.match(/(?<!hsl\(|, )var\(--[\w-]+\)/g) ?? [];
    expect(bare).toEqual([]);
  });
});
