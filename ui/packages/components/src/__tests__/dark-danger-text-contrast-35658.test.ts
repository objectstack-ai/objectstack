/**
 * Danger text stays readable in dark theme (objectstack#35658).
 *
 * The dark `--destructive` is a deep red chosen as the FILL of red buttons
 * (white text on it). Used as text — `text-destructive` on a menu's Delete —
 * it measured about 1.6:1 on the near-black menu. One value cannot serve both
 * jobs, so text utilities read their own token: Tailwind resolves a `text-*`
 * colour from `--text-color-*` before `--color-*`, and every shipped `@theme`
 * maps `--text-color-destructive` to `--destructive-text`. `.dark` defines a
 * light red; `:root` defines red-700 (objectstack#35911 ruling), so light
 * danger text clears 4.5:1 too while the `--destructive` fill stays the brand red.
 *
 * Pinned here, per stylesheet that ships a theme:
 *  - the compiled `text-destructive` reads the text token, and `bg-destructive`
 *    / `border-destructive` still read the fill;
 *  - light danger text clears 4.5:1 on every light surface, and the light
 *    `--destructive` fill is unchanged;
 *  - dark danger text clears 4.5:1 on every dark surface a menu or page draws;
 *  - the red-button pair (`--destructive-foreground` on `--destructive`) keeps
 *    its dark values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from 'tailwindcss';
// @ts-expect-error -- plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { stripComments } from '../../../../scripts/js-comment-mask.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(here, '../../../..');

const SHEETS = [
  'packages/components/src/index.css',
  'apps/console/src/index.css',
  'packages/runner/src/index.css',
] as const;

const read = (rel: string) => fs.readFileSync(path.join(uiRoot, rel), 'utf8');

/** Every top-level-or-nested block opened by `selector {`, in source order. */
function blocks(css: string, selector: RegExp): string[] {
  const out: string[] = [];
  const re = new RegExp(selector.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 0;
    const open = css.indexOf('{', m.index);
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) { out.push(css.slice(open + 1, i)); break; }
    }
  }
  return out;
}

/** Custom properties declared across `blocks`, later blocks winning. */
function vars(css: string, selector: RegExp): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of blocks(css, selector)) {
    for (const m of (stripComments(b) as string).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  }
  return out;
}

function hslToRgb(triple: string): [number, number, number] {
  const [h, s, l] = triple.split(/\s+/).map((p) => parseFloat(p));
  const sat = s / 100, lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function contrast(a: string, b: string): number {
  const lum = (rgb: number[]) => {
    const [r, g, bl] = rgb.map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(hslToRgb(a)), lum(hslToRgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

async function compiled(sheet: string, candidates: string[]): Promise<string> {
  const theme = `@theme {${blocks(read(sheet), /@theme\s*\{/)[0]}}`;
  const twDir = path.dirname(fs.realpathSync(path.join(uiRoot, 'node_modules/tailwindcss/index.css')));
  const compiler = await compile(`@import "tailwindcss";\n${theme}\n`, {
    base: uiRoot,
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss'
        ? path.join(twDir, 'index.css')
        : id.startsWith('tailwindcss/') ? path.join(twDir, id.slice('tailwindcss/'.length)) : path.resolve(base, id);
      return { base: path.dirname(file), path: file, content: fs.readFileSync(file, 'utf8') };
    },
  });
  return compiler.build(candidates);
}

const rule = (css: string, cls: string) => {
  const m = css.match(new RegExp(`\\.${cls.replace(/[:/]/g, (c) => `\\\\${c}`)}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
};

describe.each(SHEETS)('danger text colour in %s (objectstack#35658)', (sheet) => {
  const css = read(sheet);
  const root = vars(css, /:root\s*\{/);
  const dark = vars(css, /\.dark\s*\{/);

  it('text-destructive reads the text token; bg- and border-destructive keep the fill', async () => {
    const out = await compiled(sheet, ['text-destructive', 'bg-destructive', 'border-destructive']);
    expect(rule(out, 'text-destructive')).toContain('var(--text-color-destructive)');
    expect(out).toMatch(/--text-color-destructive:\s*hsl\(var\(--destructive-text,\s*var\(--destructive\)\)\)/);
    expect(rule(out, 'bg-destructive')).toContain('var(--color-destructive)');
    expect(rule(out, 'border-destructive')).toContain('var(--color-destructive)');
  });

  it('light danger text is red-700 and clears 4.5:1 on every light surface; the fill keeps the brand red', () => {
    expect(root['--destructive-text']).toBe('0 73.7% 41.8%');
    for (const surface of ['--background', '--card', '--popover', '--muted', '--accent', '--secondary']) {
      expect(root[surface], `:root defines ${surface}`).toBeTruthy();
      expect(contrast(root['--destructive-text'], root[surface]), `${surface} ${root[surface]}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(root['--destructive']).toBe('0 84.2% 60.2%');
  });

  it('dark danger text clears 4.5:1 on every dark surface', () => {
    const text = dark['--destructive-text'];
    expect(text, '.dark defines --destructive-text').toBeTruthy();
    for (const surface of ['--background', '--card', '--popover', '--muted', '--accent', '--secondary']) {
      expect(dark[surface], `.dark defines ${surface}`).toBeTruthy();
      expect(contrast(text, dark[surface]), `${surface} ${dark[surface]}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the red-button fill and its text keep their dark values', () => {
    expect(dark['--destructive']).toBe('0 62.8% 30.6%');
    expect(dark['--destructive-foreground']).toBe('210 40% 98%');
  });
});

describe('new-app template (objectstack#35658)', () => {
  it('generated apps carry the same split', () => {
    const tpl = read('packages/cli/src/utils/app-generator.ts');
    expect(tpl).toContain('--text-color-destructive: hsl(var(--destructive-text, var(--destructive)));');
    expect(tpl).toContain('--destructive-text: 0 91% 71%;');
    expect(tpl).toContain('--destructive-text: 0 73.7% 41.8%;');
  });
});
