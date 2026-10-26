/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6877 — the `div` migration guidance is TRUE, and all four surfaces
 * that state it agree.
 *
 * The guidance is stated four times: the console notice
 * (`renderers/basic/div.tsx`), the machine-readable `deprecated.replacement` on
 * the same registration (objectui#6674), `content/docs/components/basic/div.mdx`,
 * and the `components-basic-div` catalog category. Until this file, only the
 * first two were held together at all — by
 * `deprecation-guidance-agreement.test.tsx` (objectui#6823) — and NOTHING held
 * any of them to the truth.
 *
 * ## Why "they agree" is not enough on its own
 *
 * Agreement is satisfied by four surfaces that are identically wrong, which is
 * exactly the state objectui#6877 found. Every replacement the old guidance
 * named was measured NON-drop-in (each injects classes of its own; `card` also
 * moves the children into an extra element; four of the five read `children`
 * only, so a `body`-authoring node loses its content silently at an unchanged
 * element count), and the one class-transparent swap — `box`, minted by
 * objectui#3965 — was the one it never named.
 *
 * A pin asserting merely "the notice mentions `box`" would pass on a notice
 * that mentions `box` AND still recommends every non-drop-in replacement
 * unchanged — an implementation strictly worse than the text it replaced. So
 * the drop-in claim below is a MEASUREMENT taken through the real renderer,
 * not a list of names kept here, and the guidance is asserted against what the
 * measurement says. Re-rank the renderers and this file re-ranks with them.
 *
 * ## The plausible WRONG FIX this exists to catch
 *
 * Edit one statement of the guidance and leave the others behind, so the four
 * surfaces disagree. objectui#6823 catches exactly one shape of that — the
 * notice and the declaration disagreeing with each other — and it is blind to
 * the other two surfaces by construction: it never reads them. MEASURED on this
 * branch, with the mdx reverted to its pre-#6877 bullets and, separately, with
 * the new fixture deleted: all 18 cases of the five pre-existing deprecation
 * suites stay GREEN in both states. The stale copy is also the one an automated
 * gate repeats to authors, at a scale no console notice reaches. Case 3 is that
 * pin, and it reddens in both states.
 *
 * ## Quoting convention, shared with objectui#6823
 *
 * Both statements name a component type in DOUBLE QUOTES and a property name in
 * backticks, so the offered alternatives can be read out of either without a
 * list kept here — a hard-coded list would be a fifth copy of the thing this
 * file exists to keep from drifting. The mdx follows the same discipline with
 * `<code>` inside the callout list.
 *
 * ⛔ `span` is deliberately out of scope (`box` is block-level; the inline
 * replacement story did not change), and case 5 asserts this edit did not sweep
 * it in. What that adds, measured rather than assumed: with `"box"` added to
 * BOTH of span's statements at once, objectui#6823 stays green (it compares the
 * two to each other, and they still agree) and so does every `toContain` pin on
 * span's NOTICE — `span-deprecation-provenance` and `span-deprecation-warn-once`
 * assert containment, which a longer bullet still satisfies. The one
 * pre-existing case that does redden is the `toEqual` on span's DECLARATION, so
 * the notice half of that sweep is covered here and nowhere else.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

/**
 * Resolved off this module, so nothing here depends on the process cwd.
 *
 * String paths, not `new URL(rel, base)`: under the `dom` project happy-dom
 * installs its own global `URL`, and a URL it builds is not the shape
 * `fileURLToPath` accepts — it fails with `The URL must be of scheme file` at
 * module load, i.e. as a suite that reports ZERO tests rather than a red one.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const DIV_MDX_PATH = path.join(REPO_ROOT, 'content/docs/components/basic/div.mdx');
const SPAN_MDX_PATH = path.join(REPO_ROOT, 'content/docs/components/basic/span.mdx');
const CATALOG_DIR = path.join(
  REPO_ROOT,
  'examples/schema-catalog/src/schemas/components-basic-div',
);

/** The component type names a piece of guidance offers: its double-quoted runs. */
function offeredTypeNames(guidance: string): Set<string> {
  return new Set([...guidance.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

/** The notice's migration guidance: its bullet lines, and only those. */
function bulletLines(notice: string): string[] {
  return notice.split('\n').filter((line) => line.trimStart().startsWith('- '));
}

/**
 * The `div` notice, read the way every reader reads it — off the console.
 *
 * Memoized because the warn-once guard (objectui#3965) is a module-level Set:
 * the type may be rendered for its notice exactly once per module instance, so
 * the FIRST render in this file has to be the one that captures it, whichever
 * case happens to ask first. A wrong count throws rather than returning
 * something — a renderer that stopped warning must not reach an assertion as an
 * empty string, where several of the checks below would read as vacuously true.
 */
let cachedNotice: Record<string, string> = {};
function noticeFor(type: string): string {
  const cached = cachedNotice[type];
  if (cached !== undefined) return cached;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const Component = ComponentRegistry.get(type);
  if (!Component) throw new Error(`Component "${type}" is not registered`);
  render(<Component schema={{ type }} />);
  const deprecation = new RegExp(`The "${type}" component is deprecated`);
  const hits = warn.mock.calls
    .map((args: unknown[]) => String(args[0]))
    .filter((message) => deprecation.test(message));
  warn.mockRestore();
  if (hits.length !== 1) {
    throw new Error(
      `expected exactly one "${type}" deprecation notice, observed ${hits.length}. ` +
        'A type that stopped warning, or stopped resolving, must fail here rather ' +
        'than hand an empty string to the assertions below.',
    );
  }
  cachedNotice = { ...cachedNotice, [type]: hits[0] };
  return hits[0];
}

/** The declared, machine-readable guidance for a type on the json surface. */
function declaredReplacement(type: string): string {
  const declared = ComponentRegistry.deprecationFor(type, 'json')?.replacement;
  if (!declared) throw new Error(`"${type}" declares no json-surface replacement guidance`);
  return declared;
}

/**
 * What a node of `type` actually renders, for one authored `className` and one
 * piece of content — the measurement the guidance has to be true about.
 */
const PROBE_CLASS = 'os6877-probe-class';
const PROBE_TEXT = 'os6877-probe-content';

function measure(type: string, contentKey: 'children' | 'body') {
  const node: Record<string, unknown> = { type, className: PROBE_CLASS };
  node[contentKey] = [{ type: 'text', content: PROBE_TEXT }];
  const { container } = render(<SchemaRenderer schema={node as never} />);
  const root = container.firstElementChild as HTMLElement | null;
  return {
    elements: container.querySelectorAll('*').length,
    classVerbatim: (root?.className ?? '') === PROBE_CLASS,
    keepsContent: (container.textContent ?? '').includes(PROBE_TEXT),
  };
}

/**
 * The offered replacements that really ARE drop-in for a `children`-authoring
 * `div`: same element count, the authored `className` through verbatim, content
 * preserved. Measured against `div` itself rather than against a constant, so
 * the baseline cannot go stale either.
 */
function measuredDropInReplacements(offered: Iterable<string>): string[] {
  const baseline = measure('div', 'children');
  return [...offered]
    .filter((type) => {
      const m = measure(type, 'children');
      return (
        m.elements === baseline.elements && m.classVerbatim && m.keepsContent
      );
    })
    .sort();
}

/** Root `type` of every fixture in the `components-basic-div` category. */
function catalogRootTypes(): string[] {
  const files = readdirSync(CATALOG_DIR).filter((n) => n.endsWith('.json'));
  if (files.length === 0) throw new Error(`no fixtures under ${CATALOG_DIR}`);
  return files.map((name) => {
    const parsed = JSON.parse(readFileSync(`${CATALOG_DIR}/${name}`, 'utf8')) as { type?: string };
    if (!parsed.type) throw new Error(`fixture ${name} has no root type`);
    return parsed.type;
  });
}

/** The replacement types the mdx callout offers: its `<code>` runs, in the list. */
function mdxOfferedTypeNames(mdx: string): Set<string> {
  const list = mdx.match(/<ul[^>]*>([\s\S]*?)<\/ul>/);
  if (!list) throw new Error('div.mdx no longer opens with the deprecation callout list');
  return new Set([...list[1].matchAll(/<code>([^<]+)<\/code>/g)].map((m) => m[1]));
}

describe('div deprecation guidance — true, and agreed across four surfaces (#6877)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names exactly the replacements that are MEASURED drop-in — one of them', () => {
    const offered = offeredTypeNames(bulletLines(noticeFor('div')).join('\n'));

    // Control: the comparison is not vacuous, and the classification below had
    // something to reject. A notice offering nothing, or offering one name, is
    // not a test of "exactly the drop-in ones".
    expect(offered.size).toBeGreaterThan(1);

    const dropIn = measuredDropInReplacements(offered);

    // The measurement, stated: exactly one offered replacement reproduces what
    // `div` renders. This is the fact objectui#3965 established and the reason
    // this card exists; if a renderer changes so that a second one qualifies,
    // this fails and the guidance gets rewritten rather than quietly drifting
    // out of date.
    expect(dropIn).toEqual(['box']);

    // Control on the other side: the classifier really discriminates. A
    // predicate that answered `true` for everything would satisfy nothing here.
    expect(offered.size - dropIn.length).toBeGreaterThan(0);
  });

  it('offers the drop-in replacement, and ONLY it, for the plain-wrapper case', () => {
    const bullets = bulletLines(noticeFor('div'));
    // Control: the notice really carries bullet guidance. A reflow that
    // dissolves the bullets has to come back through here.
    expect(bullets.length).toBeGreaterThan(1);

    const dropIn = measuredDropInReplacements(
      offeredTypeNames(bullets.join('\n')),
    );
    const plainWrapperBullets = bullets.filter((line) =>
      dropIn.some((type) => line.includes(`"${type}"`)),
    );

    // Exactly one bullet is about the mechanical swap…
    expect(plainWrapperBullets).toHaveLength(1);
    // …and it offers the drop-in replacement ALONE. This is the assertion a
    // "mentions box" pin cannot make: guidance that adds `box` to the old
    // "for simple wrappers use container/stack/grid" bullet still points
    // authors at replacements that silently change the page, and fails here.
    expect([...offeredTypeNames(plainWrapperBullets[0])].sort()).toEqual(dropIn);
  });

  it('states the same alternatives on all four surfaces', () => {
    const notice = offeredTypeNames(bulletLines(noticeFor('div')).join('\n'));
    const declared = offeredTypeNames(declaredReplacement('div'));
    const mdx = mdxOfferedTypeNames(readFileSync(DIV_MDX_PATH, 'utf8'));

    // Controls: nothing below compares two empty sets.
    expect(notice.size).toBeGreaterThan(0);
    expect(declared.size).toBeGreaterThan(0);
    expect(mdx.size).toBeGreaterThan(0);

    // Set equality both ways, not containment: drift has no preferred
    // direction. This is the pin that reddens when the plausible wrong fix
    // updates one surface and leaves the others behind.
    expect([...declared].sort()).toEqual([...notice].sort());
    expect([...mdx].sort()).toEqual([...notice].sort());

    // The catalog category is the fourth surface. It DOCUMENTS the deprecated
    // type, so `div` itself is expected among its root types — that exemption
    // is the one `examples/schema-catalog/test/deprecated-component-types.test.ts`
    // grants and checks for non-vacuity. Everything else it demonstrates must
    // be a replacement the other three surfaces actually offer…
    const fixtures = catalogRootTypes();
    const demonstrated = [...new Set(fixtures.filter((type) => type !== 'div'))].sort();
    expect(demonstrated.length).toBeGreaterThan(0);
    expect(demonstrated.filter((type) => !notice.has(type))).toEqual([]);

    // …and the one mechanical swap has to be among them, reachable from the
    // migration guide. A guide that teaches `box` while the corpus only
    // exemplifies the non-drop-in conversions is the same defect one surface
    // over.
    expect(demonstrated).toContain('box');
    expect(readFileSync(DIV_MDX_PATH, 'utf8')).toContain(
      'components-basic-div/use-box-instead',
    );
    expect(fixtures.length).toBe(readdirSync(CATALOG_DIR).filter((n) => n.endsWith('.json')).length);
  });

  it('no surface still carries the falsified recommendations', () => {
    const notice = noticeFor('div');
    const declared = declaredReplacement('div');
    const mdx = readFileSync(DIV_MDX_PATH, 'utf8');

    // The two sentences objectui#6877 retired. Both offered a NON-drop-in
    // replacement for the plain-wrapper case, which is the falsehood; keeping
    // either while adding `box` elsewhere would leave the guidance wrong for
    // the reader who follows it literally.
    for (const [surface, text] of [
      ['notice', notice],
      ['declaration', declared],
      ['div.mdx', mdx],
    ] as const) {
      expect(text, `${surface} still recommends "semantic layout components"`).not.toContain(
        'semantic layout components',
      );
      expect(text, `${surface} still carries the old simple-wrapper bullet`).not.toContain(
        'For simple wrappers',
      );
    }

    // Controls, same shape and same surfaces: each `not.toContain` above is
    // read over text that really was loaded. Without these, an empty string
    // would satisfy every one of them.
    expect(notice).toContain('deprecated');
    expect(declared).toContain('"box"');
    expect(mdx).toContain('Migration Guide');
  });

  it('leaves `span` alone — a separate judgement, not swept in', () => {
    // `box` is a block-level container; nothing about the inline replacement
    // story changed, so span's guidance must be untouched by this edit.
    const notice = noticeFor('span');
    const declared = declaredReplacement('span');
    const mdx = readFileSync(SPAN_MDX_PATH, 'utf8');

    const offered = offeredTypeNames(bulletLines(notice).join('\n'));
    // Control first: span's guidance was really read, and really offers
    // something — otherwise the absence checks below are vacuous.
    expect([...offered].sort()).toEqual(['badge', 'text']);

    expect(offered.has('box')).toBe(false);
    expect(declared).not.toContain('box');
    expect(mdx).not.toContain('<code>box</code>');
  });
});
