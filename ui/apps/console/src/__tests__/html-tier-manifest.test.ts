/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10735 — the published manifest declares the html tier's registered
 * intrinsic elements, exactly as the registry declares them, and `div` stays out
 * (the maintainer's ruling A on objectstack#20112).
 *
 * Built the way both manifest producers build it — `getPublicConfigs()` through
 * `manifestFromConfigs`, over the console's REAL registration graph
 * (`@object-ui/components` plus `src/register-plugins.ts`, the pair
 * `dev/manifest-dump.tsx` loads) — so what is asserted here is what
 * `sdui.manifest.json` will carry, not what a fixture was shaped to say.
 *
 * Three things are pinned:
 *
 *   1. COVERAGE — every roster tag reaches the manifest stamped `tier: 'html'`,
 *      with its registered `inputs` and its child slot declared exactly where
 *      the registration declares it (the void tags declare none);
 *   2. THE CURATED TIER IS UNMOVED — the entries WITHOUT the stamp are exactly
 *      the registered `PUBLIC_BLOCKS`, so the JSON-surface vocabulary did not
 *      grow by a single tag;
 *   3. THE CENSUS — every bare registration whose key is an HTML element name
 *      is on one of the two rosters or in the exclusion ledger below, WITH a
 *      reason. The population is derived from `@types/react`'s
 *      `JSX.IntrinsicElements` (the one machine-readable list of element names
 *      this repo already depends on), so a registration that newly squats on a
 *      tag name lands here by absence rather than by memory.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { LayoutSchema } from '@object-ui/types/zod';
import { compile, generateDts, manifestFromConfigs, type RegistryConfigLike } from '@object-ui/sdui-parser';
import {
  ComponentRegistry,
  HTML_TIER_INTRINSICS,
  HTML_TIER_INTRINSIC_SET,
  PUBLIC_BLOCKS,
  PUBLIC_BLOCK_SET,
} from '@object-ui/core';
// The layout/content primitives (Tier B) and every html-tier renderer …
import '@object-ui/components';
// … and the console's own plugin layer, from the module main.tsx boots from.
import '../register-plugins';

/** Exactly the generators' read (`dev/manifest-dump.tsx`, `sdui-parser/scripts/gen-manifest.ts`). */
const manifest = manifestFromConfigs(ComponentRegistry.getPublicConfigs() as unknown as RegistryConfigLike[]);
/** What a consumer reads back off disk — `JSON.stringify` drops every `undefined`. */
const published = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
const entries = Object.values(published.components);

const inputNames = (tag: string): string[] => (ComponentRegistry.getMeta(tag)?.inputs ?? []).map((i) => i.name);
const declaresSlot = (tag: string): boolean =>
  (ComponentRegistry.getMeta(tag)?.inputs ?? []).some((i) => i.name === 'children');

/**
 * The tags `html-elements.tsx` renders WITHOUT a child list (`VOID_TAGS`
 * there) — asserted against the registration rather than restated, below.
 */
const VOID_TAGS = ['img', 'hr', 'br'];

/**
 * HTML-named bare registrations that are on NEITHER roster, each with the
 * reason. A forcing function, not an allowlist: a registration that squats on
 * an element name and is absent from both rosters AND from here fails the
 * census by absence, and a stale entry — one no longer registered, or one
 * since admitted to a roster — fails the liveness pin.
 */
const EXCLUDED_HTML_NAMED: Record<string, string> = {
  div:
    'deprecated on the JSON surface in favour of `box` (objectui#3965, PR objectui#6878) and kept out of the ' +
    'published contract by the objectstack#20112 ruling A: the gate that reads the manifest refuses `<div>` on ' +
    'an html page. The renderer still registers it, and its declared deprecation names both surfaces, `json` and ' +
    '`html` (objectui#10757): the console\'s html compile refuses it too, naming `box`.',
  // `summary`, `object` (bare fallbacks of the `field:summary` / `field:object`
  // widgets) and `view` (a bare `@object-ui/plugin-view` alias sharing the SVG
  // element's name) left this ledger with objectui#10859 batch 8, which retired
  // all three registrations: none squats on an element name any more.
  kbd:
    'a `ui` component rendering `keys` / `label` under an HTML tag name; not named by the objectstack#20112 ruling. ' +
    'Admitting it is additive on a named need, while retracting a declared tag is a narrowing — so it waits.',
  form: 'a JSON-surface form component; the html tier excludes form controls by design (the exclusion list in `html-elements.tsx`).',
  input: 'a JSON-surface field component; the html tier excludes form controls by design (the exclusion list in `html-elements.tsx`).',
  textarea: 'a JSON-surface field component; the html tier excludes form controls by design (the exclusion list in `html-elements.tsx`).',
  select: 'a JSON-surface field component; the html tier excludes form controls by design (the exclusion list in `html-elements.tsx`).',
  switch: 'a JSON-surface field component; the html tier excludes form controls by design (the exclusion list in `html-elements.tsx`).',
  progress: 'a `ui` component reading `value` under an HTML tag name, not an element passthrough; not named by the ruling.',
  dialog: 'a `ui` overlay component under an HTML tag name, not an element passthrough; not named by the ruling.',
};

/**
 * Every element name React knows — read off `@types/react`'s
 * `JSX.IntrinsicElements`, the one declaration of the HTML/SVG tag set this
 * repo already depends on. Resolved through the package's `package.json`
 * because its `exports` map does not expose `index.d.ts` as a subpath.
 */
function reactIntrinsicNames(): Set<string> {
  const pkg = createRequire(import.meta.url).resolve('@types/react/package.json');
  const dts = readFileSync(join(dirname(pkg), 'index.d.ts'), 'utf8');
  const block = dts.match(/interface IntrinsicElements \{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
  const names = new Set<string>();
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*"?([a-zA-Z][a-zA-Z0-9-]*)"?\s*:/);
    if (m) names.add(m[1]);
  }
  return names;
}

/**
 * The two tag families the JSON layout union declares by `z.enum` — the
 * flow/inline set (holding `p`) and the sectioning set (holding `main`). Read
 * off `LayoutSchema`'s arms, because `HtmlElementSchema` and
 * `SemanticElementSchema` are deliberately not exported (objectui#9067).
 */
type EnumTypeArm = { shape?: { type?: { def?: { type?: string }; options?: readonly string[] } } };
const enumArms = (): string[][] =>
  (LayoutSchema as unknown as { options: EnumTypeArm[] }).options
    .filter((arm) => arm.shape?.type?.def?.type === 'enum')
    .map((arm) => [...(arm.shape?.type?.options ?? [])]);
const flowInlineTags = (): string[] => enumArms().find((arm) => arm.includes('p')) ?? [];
const sectioningTags = (): string[] => enumArms().find((arm) => arm.includes('main')) ?? [];

describe('the manifest carries the html tier exactly as the registry declares it (objectui#10735)', () => {
  it('every roster tag is registered under `ui` and reaches the manifest stamped `tier: html`', () => {
    for (const tag of HTML_TIER_INTRINSICS) {
      const comp = published.components[tag];
      expect(comp, `\`${tag}\` is on the roster and absent from the manifest`).toBeDefined();
      expect(comp.tier, `\`${tag}\` reached the manifest unstamped`).toBe('html');
      expect(comp.namespace, `\`${tag}\` is not a \`ui\` registration`).toBe('ui');
      expect(comp.type).toBe(tag);
    }
  });

  it('carries each tag with its registered inputs — the manifest copies the declaration, verbatim', () => {
    for (const tag of HTML_TIER_INTRINSICS) {
      expect(published.components[tag].inputs.map((i) => i.name), `\`${tag}\` inputs drifted`).toEqual(inputNames(tag));
    }
  });

  it('declares the child slot exactly where the registration renders a child list', () => {
    expect(enumArms()).toHaveLength(2);
    const flowInline = flowInlineTags();
    const sectioning = sectioningTags();
    expect(flowInline.length).toBeGreaterThan(30);
    expect(sectioning).toHaveLength(7);

    const slotDeclared = (tag: string): boolean =>
      published.components[tag].inputs.some((i) => i.name === 'children' && i.type === 'slot');

    // The void tags declare NO slot — `<br>` taking children would be the lie
    // in the other direction (objectui#9910) — and every other flow/inline tag,
    // every sectioning tag and `span` declare one.
    for (const tag of VOID_TAGS) {
      expect(slotDeclared(tag), `void tag \`${tag}\` declares a child slot`).toBe(false);
    }
    for (const tag of [...flowInline.filter((t) => !VOID_TAGS.includes(t)), ...sectioning, 'span']) {
      expect(slotDeclared(tag), `\`${tag}\` declares no child slot`).toBe(true);
    }
    // `table` and `label` are declared as registered: no slot, because their
    // renderers read `columns` / `data` and `text`, not a child list.
    for (const tag of ['table', 'label']) {
      expect(slotDeclared(tag), `\`${tag}\` grew a child slot its renderer does not read`).toBe(false);
      expect(declaresSlot(tag)).toBe(false);
    }
  });

  it('leaves `div` out, and the ledgered look-alike `kbd` with it', () => {
    for (const tag of ['div', 'kbd']) {
      // Registered — the tier resolves them at runtime — and deliberately undeclared.
      expect(ComponentRegistry.getKnownTypes(), `\`${tag}\` is no longer registered; re-read its ledger entry`).toContain(tag);
      expect(published.components[tag], `\`${tag}\` reached the manifest`).toBeUndefined();
    }
  });

  it('declares `code` — the element passthrough, not the `field:code` widget the bare key used to fall back to (objectui#10756)', () => {
    // The ledger held `code` while the only bare registration was the field
    // widget's namespace fallback. `html-elements.tsx` now registers it from
    // `TAGS` and the widget stands down from the bare key, so the manifest
    // carries the passthrough's own declaration: `ui`, a className, a child slot.
    const comp = published.components.code;
    expect(comp).toBeDefined();
    expect(comp.tier).toBe('html');
    expect(comp.namespace).toBe('ui');
    expect(comp.inputs.map((i) => `${i.name}:${i.type}`)).toEqual(['className:string', 'children:slot']);
    // The registration behind it is the passthrough, and the widget is still its own key.
    expect(ComponentRegistry.getConfig('code')?.type).toBe('ui:code');
    expect(ComponentRegistry.getConfig('field:code')?.type).toBe('field:code');
  });
});

describe('the curated tier is unmoved — the JSON-surface vocabulary did not grow (objectui#10735)', () => {
  it('the unstamped entries are exactly the registered PUBLIC_BLOCKS, in roster order', () => {
    const curated = entries.filter((c) => c.tier !== 'html').map((c) => c.type);
    expect(curated).toEqual(PUBLIC_BLOCKS.filter((tag) => tag in published.components));
    // Anti-vacuity: the curated tier resolved, and to the vocabulary it is.
    expect(curated.length).toBeGreaterThan(50);
    expect(curated).toEqual(expect.arrayContaining(['object-grid', 'box', 'html']));
  });

  it('the stamped entries are exactly the roster, in roster order, and nothing else', () => {
    expect(entries.filter((c) => c.tier === 'html').map((c) => c.type)).toEqual([...HTML_TIER_INTRINSICS]);
  });

  it('no entry is on both tiers, and every entry is on one of them', () => {
    for (const c of entries) {
      const onCurated = PUBLIC_BLOCK_SET.has(c.type) || ComponentRegistry.getMeta(c.type)?.tier === 'public';
      const onHtml = HTML_TIER_INTRINSIC_SET.has(c.type);
      expect(onCurated !== onHtml, `\`${c.type}\` is on ${onCurated && onHtml ? 'both tiers' : 'neither tier'}`).toBe(true);
      expect(c.tier === 'html', `\`${c.type}\` is stamped against its roster`).toBe(onHtml);
    }
  });
});

describe('the census — every HTML-named bare registration is accounted for (objectui#10735)', () => {
  const intrinsicNames = reactIntrinsicNames();
  const bareKnown = ComponentRegistry.getKnownTypes().filter((k) => !k.includes(':'));
  const htmlNamed = bareKnown.filter((k) => intrinsicNames.has(k)).sort();

  it('reads a real element-name population and a real registration population', () => {
    // Lit controls, both sides: the instrument resolved React's element list
    // (HTML and SVG), and the registry resolved this console's bare keys.
    expect(intrinsicNames.size).toBeGreaterThan(100);
    expect(intrinsicNames.has('div')).toBe(true);
    expect(intrinsicNames.has('p')).toBe(true);
    expect(intrinsicNames.has('svg')).toBe(true);
    expect(intrinsicNames.has('object-grid')).toBe(false);
    expect(bareKnown).toEqual(expect.arrayContaining(['object-grid', 'box', 'div', 'p']));
    // The intersection is the population this file is about, and it is not empty.
    expect(htmlNamed.length).toBeGreaterThan(40);
  });

  it('places every HTML-named registration on a roster or in the ledger — none unaccounted', () => {
    const unaccounted = htmlNamed.filter(
      (tag) => !PUBLIC_BLOCK_SET.has(tag) && !HTML_TIER_INTRINSIC_SET.has(tag) && !(tag in EXCLUDED_HTML_NAMED),
    );
    expect(
      unaccounted,
      `HTML-named registration(s) on neither roster and not in the ledger: ${unaccounted.join(', ')}. ` +
        'Admit each to HTML_TIER_INTRINSICS (an element renderer the html tier should declare), to PUBLIC_BLOCKS ' +
        '(a curated block), or record it in EXCLUDED_HTML_NAMED with the reason.',
    ).toEqual([]);
  });

  it('keeps every ledger entry live — registered, HTML-named, on neither roster, with a reason', () => {
    for (const [tag, reason] of Object.entries(EXCLUDED_HTML_NAMED)) {
      expect(htmlNamed, `\`${tag}\` is no longer an HTML-named registration; delete its entry`).toContain(tag);
      expect(PUBLIC_BLOCK_SET.has(tag) || HTML_TIER_INTRINSIC_SET.has(tag), `\`${tag}\` is now on a roster; delete its entry`).toBe(false);
      expect(reason.length, `\`${tag}\` states no reason`).toBeGreaterThan(40);
    }
  });
});

describe('what an html-tier author gets from the gate that reads this manifest (objectui#10735)', () => {
  const errors = (src: string) => compile(src, published).diagnostics.filter((d) => d.severity === 'error');
  const codes = (src: string) => compile(src, published).diagnostics.map((d) => `${d.code}:${d.tag ?? ''}`);

  it('accepts the everyday tags with their declared attributes', () => {
    expect(
      errors(
        '<main className="page"><h1>Title</h1><p className="lead">Read the <a href="/docs" target="_blank" rel="noopener">docs</a>.</p>' +
          '<ul><li>one</li><li>two</li></ul><figure><img src="/x.png" alt="x" width={320} /><figcaption>x</figcaption></figure><hr /></main>',
      ),
    ).toEqual([]);
  });

  it('accepts `span`, the sectioning tags, and `table` / `label` written as registered', () => {
    expect(errors('<section><header><span className="k">k</span></header><label text="Name" /><table columns={[]} data={[]} /></section>')).toEqual([]);
  });

  it('refuses `<div>` — `forbidden-tag`, the same refusal the ledger of objectstack#19922 records', () => {
    expect(codes('<main><div>hi</div></main>')).toContain('forbidden-tag:div');
    expect(compile('<main><div>hi</div></main>', published).ok).toBe(false);
  });

  it('accepts `<code>` with text — declared with its child slot, so neither `forbidden-tag` nor `not-a-container` fires (objectui#10756)', () => {
    expect(errors('<p>Read <code className="k">inline</code> here.</p>')).toEqual([]);
    expect(codes('<p><code>x</code></p>')).not.toContain('forbidden-tag:code');
    expect(codes('<p><code>x</code></p>')).not.toContain('not-a-container:code');
  });

  it('judges a `label` authored with children by its registration — `text` is required and there is no slot', () => {
    // Declared "exactly as the registry declares it": the renderer reads `text`
    // (required) and never a child list, so an html author who writes the
    // HTML-shaped `<label>Name</label>` is told both facts instead of getting
    // a green save and a blank label.
    const src = '<main><label>Name</label></main>';
    expect(codes(src)).toEqual(expect.arrayContaining(['missing-required-prop:label', 'not-a-container:label']));
    expect(errors(src).map((d) => d.code)).toEqual(['missing-required-prop']);
    // The registered spelling is clean.
    expect(errors('<main><label text="Name" /></main>')).toEqual([]);
  });
});

describe('the generated intrinsics type the html tier (objectui#10735)', () => {
  it('emits every roster tag into JSX.IntrinsicElements with its declared attributes', () => {
    const dts = generateDts(published);
    for (const tag of HTML_TIER_INTRINSICS) {
      expect(dts, `\`${tag}\` missing from the intrinsics`).toContain(`"${tag}": `);
    }
    // `a` declares `className`, a base attribute, so it `Omit`s it (objectui#11075).
    expect(dts).toContain('export interface AProps extends Omit<SduiBaseProps, "className"> {');
    expect(dts).toContain('  href?: string;');
    expect(dts).toContain('"object-grid": ObjectGridProps;');
  });
});
