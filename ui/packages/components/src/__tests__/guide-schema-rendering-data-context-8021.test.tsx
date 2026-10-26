/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The guide's Data Context passages teach a wiring that RESOLVES (objectui#8021).
 *
 * ## The two independent errors this file holds apart
 *
 * `SchemaRendererProps` declares exactly ONE prop, `schema`
 * (`packages/react/src/SchemaRenderer.tsx`). The docblock beside it names the
 * mechanism: the renderer "passes every prop it does not itself read straight
 * through to the component the schema names". So a `data={…}` or `scope={…}`
 * written on a `SchemaRenderer` element is not ignored and does not warn — it
 * is FORWARDED, and the evaluator never sees it.
 *
 * The evaluator's scope is `usePredicateScope()` plus `current_user`, an
 * optional `record` and `page: pageVariables`. So a host's own values are
 * reachable under whatever NAME it published them through
 * `PredicateScopeProvider`, and a `${data.…}` addresses a root the renderer no
 * longer binds at all.
 *
 * Two coordinates, and the page had both wrong. A repair that moves only one
 * leaves it broken, which is why legs B, D and E below are LIT CONTROLS rather
 * than commentary:
 *
 *   | leg | wiring                  | expression            | rendered                |
 *   |-----|-------------------------|-----------------------|-------------------------|
 *   | A   | what the page teaches   | what the page teaches | must be `Welcome, John!`|
 *   | B   | `scope` prop on element | the page's expression | the raw source text     |
 *   | C   | `PredicateScopeProvider`| `${user.…}`           | `Welcome, John!`        |
 *   | D   | `PredicateScopeProvider`| `${data.user.…}`      | the raw source text     |
 *   | E   | provider `dataSource`   | `${data.user.…}`      | the raw source text     |
 *
 * B proves the prop supplies nothing even when the expression is right; D
 * proves the name matters even when the wiring is right; E is objectui#9308's
 * own coordinate — the ADAPTER seam is not an expression root, so the wiring
 * this page used to teach now renders the characters the author typed. Leg A
 * is not transcribed from the page — it is READ OFF the page on every run, so
 * it can only go green when both coordinates have moved.
 *
 * ## objectui#9308 — what moved here, and why this file had to move with it
 *
 * The maintainer ruling of 2026-09-13 (option B) removed `data: dataSource`
 * from the evaluator scope and pointed `useDataScope` at the scope channel.
 * The teaching this file pins was meaning 2 of that one key — publish page
 * values through `dataSource`, read them back under `data.*` — so the pages
 * moved and this pin was RE-DERIVED to the new teaching rather than relaxed.
 * Leg C's wiring and leg D's expression are the two halves that swapped; leg E
 * is new and is the direct pin on the removal.
 *
 * ## Why leg A is derived rather than listed
 *
 * A transcription of the fence is a second copy that drifts, and the anchors on
 * this card already drifted twice before it was dispatched. The wiring half is
 * read from the `## Data Context` fence and the expression half from the
 * `### Accessing Data in Schemas` fence, then RENDERED. Edit either passage
 * back and this file reddens.
 *
 * ⚠️ `content/docs/**` is EXCLUDED from `ci.yml`'s full-run decision on
 * `pull_request`, so a green PR page is not evidence that this file ran on a
 * docs-only edit. It lives in `packages/components` for the same reason
 * `guide-layout-page-buttons-7926.test.tsx` does, and the document is declared
 * in `scripts/markdown-test-inputs.mjs`.
 *
 * Module-scope import of the renderers, not `beforeAll` (AGENTS.md 测试纪律):
 * registering them is an unbounded module load and must not be billed to a
 * bounded hook timeout.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../renderers';
import { SchemaRenderer, SchemaRendererProvider, PredicateScopeProvider } from '@object-ui/react';
import type { DataSource, TextSchema } from '@object-ui/types';
import { uiRoot } from '../../../../scripts/ui-root.mjs';

const ROOT = uiRoot();
const GUIDE = 'content/docs/guide/schema-rendering.md';
const readDoc = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/**
 * The host values every leg is given, published under the names the guide now
 * teaches: as a `scope`, as the `scope` prop, or as a `dataSource`.
 */
const SCOPE = { user: { name: 'John', role: 'admin' }, stats: { totalUsers: 1234 } };

const textNode = (content: string): TextSchema => ({ type: 'text', content });

/**
 * Leg B wiring: the prop written on the element, with no provider above it.
 *
 * ⭐ No cast is needed, and that is itself the measurement: `SchemaRenderer`'s
 * declared type is `SchemaRendererProps & Record<string, any>`, the open
 * forwarding surface. TypeScript therefore ACCEPTS `scope` here — the prop is
 * not rejected anywhere, at compile time or at runtime. It is simply handed to
 * whatever component the schema names.
 */
function renderWithScopeProp(content: string): string {
  return render(<SchemaRenderer schema={textNode(content)} scope={SCOPE} />).container.textContent ?? '';
}

/** Leg C/D wiring: the provider that actually seeds the evaluator. */
function renderWithScopeProvider(content: string): string {
  return (
    render(
      <PredicateScopeProvider scope={SCOPE}>
        <SchemaRenderer schema={textNode(content)} />
      </PredicateScopeProvider>,
    ).container.textContent ?? ''
  );
}

/**
 * Leg E wiring: the ADAPTER seam.
 *
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` declares the
 * published `DataSource` adapter contract, and the value below is deliberately
 * NOT an adapter — it is the page-values bag the guide used to teach putting
 * there. The crossing is explicit, and it is the subject of this leg rather
 * than an inconvenience: objectui#9308 is exactly the ruling that this seam is
 * an adapter injection point and not an expression root.
 */
function renderWithAdapter(content: string): string {
  return (
    render(
      <SchemaRendererProvider dataSource={SCOPE as unknown as DataSource}>
        <SchemaRenderer schema={textNode(content)} />
      </SchemaRendererProvider>,
    ).container.textContent ?? ''
  );
}

// ---------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------

/** The slice of `src` from `heading` to the next heading at the same level. */
function sectionOf(src: string, heading: string): string {
  const level = /^#+/.exec(heading)?.[0].length ?? 2;
  const start = src.indexOf(`\n${heading}\n`);
  if (start < 0) throw new Error(`heading not found: ${heading}`);
  const rest = src.slice(start + 1 + heading.length);
  const next = new RegExp(`\\n#{1,${level}} `).exec(rest);
  return rest.slice(0, next ? next.index : undefined);
}

/** The body of the first fenced block in `src` opened with `lang`. */
function firstFence(src: string, lang: string): string {
  const re = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)\\n```');
  const m = re.exec(src);
  if (!m) throw new Error(`no \`\`\`${lang} fence in the section`);
  return m[1];
}

/**
 * Every `<SchemaRenderer …/>` element in a document.
 *
 * `\b` after the name is what keeps `SchemaRendererProvider` out of the set:
 * the character after `SchemaRenderer` there is `P`, a word character, so the
 * boundary does not match. The providers are the CORRECT carriers for these
 * props and must not be counted as offenders.
 */
function schemaRendererElements(src: string): string[] {
  return src.match(/<SchemaRenderer\b[\s\S]*?\/>/g) ?? [];
}

/**
 * The four props that LOOK like evaluator wiring and are not: `SchemaRenderer`
 * reads none of them. `scope` reaches the evaluator only through
 * `PredicateScopeProvider`; `data` and `dataSource` reach nothing at all on
 * this element (`dataSource` on `SchemaRendererProvider` is the host's ADAPTER
 * and, since objectui#9308, not an expression root anywhere); `debug` is read
 * off the renderer context (`SchemaRenderer.tsx`:
 * `context?.debug || context?.debugFlags?.enabled`). Written on the element
 * they are forwarded to whatever component the schema names — silently.
 */
const FORWARDED_LOOKALIKES = /\b(data|dataSource|debug|scope)=\{/;

/**
 * The teaching surfaces this repair covers IN FULL. Not a glob: each document
 * was read and repaired by hand, and a new page inheriting the pin by accident
 * is the failure mode a glob would create.
 *
 * ⚠️ Three more documents carry the same element and are deliberately NOT here.
 * The sweep this card's triage asked for was run BEFORE any writing, and it
 * measured 18 `<SchemaRenderer …/>` elements across five surfaces, nine of them
 * carrying a forwarded look-alike. On `content/docs/guide/expressions.md`,
 * `content/docs/guide/architecture.md` and the root `README.md` the element is
 * only half the defect: their expression spellings are bare across the whole
 * page (about fifty sites on `expressions.md` alone), and several of those are
 * legitimate AMBIENT `user` references rather than data-scope ones. Moving only
 * the wiring there would produce exactly leg D — a page that reads as repaired
 * and still prints raw source — so that population is filed as its own card
 * with the census rather than half-moved here. The two documents below are the
 * ones where every site in the passage moves together.
 */
const TEACHING_SURFACES = [GUIDE, 'packages/react/README.md'];

afterEach(cleanup);

describe('objectui#8021 leg A — the guide’s own pair, read off the page', () => {
  it('renders the resolved value, not the characters the author typed', () => {
    const src = readDoc(GUIDE);
    const dataContext = sectionOf(src, '## Data Context');
    const wiringFence = firstFence(dataContext, 'tsx');
    const accessing = sectionOf(dataContext, '### Accessing Data in Schemas');
    const node = JSON.parse(firstFence(accessing, 'json')) as { content?: string };

    // Lit control on the READER: a silent parse failure would otherwise make
    // this leg pass by measuring nothing.
    expect(node.content, 'the Accessing Data fence must carry a `content` string').toEqual(
      expect.stringContaining('${'),
    );
    expect(wiringFence, 'the Data Context fence must show a SchemaRenderer').toContain(
      'SchemaRenderer',
    );

    // Which carrier does the page teach? The branch is what makes this leg a
    // reading of the page rather than a transcription of it: move the fence
    // back to either of the other two carriers and the render below changes
    // with it.
    const teachesScope = /<PredicateScopeProvider[\s\S]*?\bscope=\{/.test(wiringFence);
    const teachesAdapter = /<SchemaRendererProvider[\s\S]*?\bdataSource=\{/.test(wiringFence);
    const rendered = teachesScope
      ? renderWithScopeProvider(node.content as string)
      : teachesAdapter
        ? renderWithAdapter(node.content as string)
        : renderWithScopeProp(node.content as string);

    expect(rendered).toBe('Welcome, John!');
  });
});

describe('objectui#8021 legs B–E — the controls that keep the errors apart', () => {
  it('leg B: a `scope` prop on the element supplies nothing', () => {
    // Unresolvable, so the evaluator hands back its own SOURCE TEXT — which is
    // the failure the reader actually sees on the page.
    expect(renderWithScopeProp('Welcome, ${user.name}!')).toBe('Welcome, ${user.name}!');
  });

  it('leg C: the provider plus a published name is the green wiring', () => {
    expect(renderWithScopeProvider('Welcome, ${user.name}!')).toBe('Welcome, John!');
  });

  it('leg D: the right wiring still prints raw source for a `${data.…}` read', () => {
    // Nothing published `data` here, and since objectui#9308 the renderer
    // publishes none of its own, so the template is unresolvable.
    expect(renderWithScopeProvider('Welcome, ${data.user.name}!')).toBe('Welcome, ${data.user.name}!');
  });

  it('leg E: the ADAPTER seam is not an expression root (objectui#9308)', () => {
    // The wiring this page used to teach, with the expression it used to teach.
    // Both were moved by the same ruling, and this is the leg that says so.
    expect(renderWithAdapter('Welcome, ${data.user.name}!')).toBe('Welcome, ${data.user.name}!');
  });
});

describe('objectui#8021 sweep — no repaired surface hands SchemaRenderer wiring props', () => {
  it.each(TEACHING_SURFACES)('%s', (doc) => {
    const elements = schemaRendererElements(readDoc(doc));
    // Lit control, per document: a scanner that stopped matching would report
    // an empty offender list, which is indistinguishable from a clean page.
    expect(elements.length, `no <SchemaRenderer …/> element found in ${doc}`).toBeGreaterThan(0);
    expect(elements.filter((el) => FORWARDED_LOOKALIKES.test(el))).toEqual([]);
  });
});
