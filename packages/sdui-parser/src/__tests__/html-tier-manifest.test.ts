/**
 * The manifest carries the html tier's intrinsic elements marked
 * `tier: 'html'` — the objectui#10735 mechanism, ported into this copy in
 * lockstep (objectstack#20112).
 *
 * objectui's `getPublicConfigs()` stamps the html tier's registered intrinsic
 * set `tier: 'html'` in its projection, and the tracked repo-root
 * `sdui.manifest.json` is serialised through THIS copy's `manifestFromConfigs`
 * (`scripts/gen-sdui-manifest-node.mjs`). Before the port this copy's
 * `RegistryConfigLike.tier` admitted only `'public' | 'internal'` and the
 * serializer dropped the key, so the manifest declared the html tier's tags
 * with no marker at all. `check:sdui-lockstep` compares diagnostic codes, the grammar
 * region and the containment predicate — never a type union — so nothing
 * surfaced the drift.
 *
 * The cases below are the ones objectui pins in its own
 * `html-tier-manifest-10735.test.ts`, one per reader of the ONE flat
 * `components` map:
 *
 *   - `manifestFromConfigs` copies exactly `'html'` and nothing else, so every
 *     curated entry serialises byte-identically to before the key existed;
 *   - `compile` whitelists the html tags by key — the gate that reads the
 *     manifest needs no change — and still refuses `<div>` because the roster
 *     leaves it out;
 *   - `generateBlockList` sections the html tier under its own count instead
 *     of reading it as curated blocks;
 *   - `generateDts` emits the tags into `JSX.IntrinsicElements`, which is the
 *     authoring surface a `kind:'html'` page type-checks against.
 */

import { describe, expect, it } from 'vitest';
import { compile, generateBlockList, generateDts, manifestFromConfigs, type RegistryConfigLike } from '../index.js';

const configs: RegistryConfigLike[] = [
  { type: 'flex', namespace: 'ui', isContainer: true, inputs: [{ name: 'gap', type: 'number' }, { name: 'children', type: 'slot' }] },
  { type: 'my-widget', namespace: 'x', tier: 'public', inputs: [{ name: 'label', type: 'string' }] },
  { type: 'studio-admin', namespace: 'app-shell', tier: 'internal', inputs: [] },
  { type: 'p', namespace: 'ui', tier: 'html', inputs: [{ name: 'className', type: 'string' }, { name: 'children', type: 'slot' }] },
  { type: 'a', namespace: 'ui', tier: 'html', inputs: [{ name: 'className', type: 'string' }, { name: 'href', type: 'string' }, { name: 'children', type: 'slot' }] },
  { type: 'img', namespace: 'ui', tier: 'html', inputs: [{ name: 'src', type: 'string' }, { name: 'alt', type: 'string' }] },
  { type: 'main', namespace: 'ui', tier: 'html', isContainer: true, inputs: [{ name: 'className', type: 'string' }, { name: 'children', type: 'slot' }] },
];

const manifest = manifestFromConfigs(configs);
/** What a consumer reads back off disk — `JSON.stringify` drops every `undefined`. */
const published = JSON.parse(JSON.stringify(manifest)) as typeof manifest;

describe('manifestFromConfigs carries the html-tier stamp, and only that stamp', () => {
  it('writes `tier: html` on a stamped config', () => {
    for (const tag of ['p', 'a', 'img', 'main']) {
      expect(published.components[tag].tier, `${tag} lost its stamp`).toBe('html');
    }
  });

  it('publishes NO `tier` key for a curated, an opted-in or an internal config — byte-identical to before', () => {
    for (const tag of ['flex', 'my-widget', 'studio-admin']) {
      expect(Object.prototype.hasOwnProperty.call(published.components[tag], 'tier'), `${tag} grew a tier key`).toBe(false);
    }
  });

  it('keeps every other field exactly as the registration declared it', () => {
    expect(published.components.a.inputs.map((i) => i.name)).toEqual(['className', 'href', 'children']);
    expect(published.components.main.isContainer).toBe(true);
    expect(published.components.img.inputs.map((i) => i.name)).toEqual(['src', 'alt']);
  });

  it('`publicOnly` keeps the curated tier alone — the html tier is not `public`', () => {
    expect(Object.keys(manifestFromConfigs(configs, { publicOnly: true }).components)).toEqual(['my-widget']);
  });
});

describe('compile reads the manifest as a whitelist — the stamp changes nothing for that reader', () => {
  it('accepts an html-tier tag with its declared inputs and child slot', () => {
    const r = compile('<main className="x"><p className="lead">Hello <a href="/docs">docs</a></p><img src="/x.png" alt="x" /></main>', published);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.tree?.type).toBe('main');
  });

  it('refuses `<div>` — the roster leaves it out, so it is `forbidden-tag` like any unknown tag', () => {
    const r = compile('<main><div>hi</div></main>', published);
    expect(r.ok).toBe(false);
    expect(r.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: 'error', code: 'forbidden-tag', tag: 'div' })]),
    );
    // The lit control: the same source with `p` in place of `div` is clean.
    expect(compile('<main><p>hi</p></main>', published).ok).toBe(true);
  });

  it('warns `not-a-container` on a void tag authored with children — the slot is declared per tag, honestly', () => {
    const r = compile('<main><img src="/x.png" alt="x">stray</img></main>', published);
    expect(r.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: 'warning', code: 'not-a-container', tag: 'img' })]),
    );
  });
});

describe('generateBlockList sections the html tier under its own count', () => {
  it('counts curated blocks in the title and lists the html tier separately', () => {
    const list = generateBlockList(published);
    // Curated title counts `flex`, `my-widget`, `studio-admin` — not the four html-tier rows.
    expect(list).toContain('# SDUI public blocks (3)');
    expect(list).toContain('## html tier intrinsic elements (4)');
    // Rows land in the right section: the html rows come AFTER the section heading.
    const heading = list.indexOf('## html tier intrinsic elements');
    for (const tag of ['p', 'a', 'img', 'main']) {
      expect(list.indexOf(`| \`${tag}\` |`), `${tag} row is missing or above the html section`).toBeGreaterThan(heading);
    }
    for (const tag of ['flex', 'my-widget']) {
      expect(list.indexOf(`| \`${tag}\` |`), `${tag} row landed in the html section`).toBeLessThan(heading);
    }
  });

  it('emits no html section for a manifest without html-tier entries — the curated list is unchanged', () => {
    const curatedOnly = manifestFromConfigs(configs.filter((c) => c.tier !== 'html'));
    const list = generateBlockList(curatedOnly);
    expect(list).toContain('# SDUI public blocks (3)');
    expect(list).not.toContain('html tier intrinsic elements');
  });
});

describe('generateDts publishes the html tier into JSX.IntrinsicElements', () => {
  it('emits an interface and an intrinsic entry per html-tier tag, beside the curated ones', () => {
    const dts = generateDts(published);
    expect(dts).toContain('"p": PProps;');
    expect(dts).toContain('"a": AProps;');
    expect(dts).toContain('export interface AProps extends Omit<SduiBaseProps, "className"> {\n  className?: string;\n  href?: string;\n}');
    expect(dts).toContain('"flex": FlexProps;');
  });
});
