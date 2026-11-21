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
 * The scan covers every source file that ships under `ui/packages/<pkg>/src`
 * and `ui/apps/<app>/src`; test files are skipped (they quote the bad spelling).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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

/** `hsl(var(--destructive…))`, optionally with a nested var fallback or an alpha. */
const VALID_HSL = /hsl\(\s*var\(--destructive[\w-]*(?:\s*,\s*var\(--destructive[\w-]*\))?\)(?:\s*\/\s*[^)]+)?\s*\)/g;
/** A custom property that holds a triplet may read another triplet: `--destructive-text: var(--destructive-text-light, …)`. */
const TRIPLET_DECLARATION = /--destructive[\w-]*\s*:\s*var\(--destructive[\w-]*\s*,/g;
const BARE_VAR = /var\(--destructive[\w-]*/g;
const FILL_OR_STROKE = /\b(?:fill|stroke)-destructive\b/g;

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

  it('no shipped source uses a bare var(--destructive…) as a colour value', () => {
    expect(offences(BARE_VAR, [VALID_HSL, TRIPLET_DECLARATION])).toEqual([]);
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
