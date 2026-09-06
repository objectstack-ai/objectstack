// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A name-keyed `pages:` map reaches the four source-page lints (#15728).
//
// ## What was vacuous, and why it read as green
//
// `pages` is an authoring surface with TWO carriers. `MAP_SUPPORTED_FIELDS`
// (`packages/spec/src/shared/metadata-collection.zod.ts`) lists it, and
// `normalizeStackInput` folds the map into an array — injecting the map key as
// `name` — BEFORE `ObjectStackDefinitionSchema` sees it, which is why
// `stack.zod.ts` declares the post-normalization form `z.array(PageSchema)`
// and a raw map fails a bare `safeParse`. Reading that declaration alone says
// "map is not authorable", and that reading is wrong.
//
// These four rules are pure `(stack) => Finding[]` (ADR-0019) and run on the
// RAW `os lint` path as well as the parsed one, so on the raw path they see
// exactly what the author's file deserialised to — the map. Each of them used
// to coerce it with a private
// `(v: unknown): AnyRec[] => (Array.isArray(v) ? (v as AnyRec[]) : [])`, which
// answers a map with `[]`. So every page lint below passed on a map-shaped
// stack by never running: no finding, no error, nothing to notice. That is the
// failure mode this file exists to keep closed — a lint whose green means it
// looked, not a lint whose green means it never did.
//
// Each case therefore asserts a SPECIFIC rule id and the finding's path. The
// path is the second half of the fix: `collectionEntries` reports the map key
// (`pages.home.source`), not a synthetic array index nobody can look up, so
// the finding stays usable as an edit target on either carrier.
import { describe, expect, it } from 'vitest';
import { validateJsxPages } from './validate-jsx-pages.js';
import { validatePageSourceStyling, PAGE_SOURCE_CLASSNAME } from './validate-page-source-styling.js';
import { validateReactPageProps, REACT_PAGE_SOURCE_UNPARSEABLE } from './validate-react-page-props.js';
import { validateReactPages } from './validate-react-pages.js';

/** The same page, authored both ways. `home` is the map key and the `name`. */
const asMap = (page: Record<string, unknown>) => ({ pages: { home: page } });
const asList = (page: Record<string, unknown>) => ({ pages: [{ name: 'home', ...page }] });

describe('a name-keyed `pages:` map reaches every source-page lint (#15728)', () => {
  it('validateReactPages reports the empty source it used to walk past', () => {
    const f = validateReactPages(asMap({ kind: 'react' }));
    expect(f.map((x) => x.rule)).toContain('react-page-empty-source');
    expect(f.find((x) => x.rule === 'react-page-empty-source')?.path).toBe('pages.home.source');
  });

  it('validateJsxPages reports the empty source it used to walk past', () => {
    const f = validateJsxPages(asMap({ kind: 'html' }));
    expect(f.map((x) => x.rule)).toContain('jsx-page-empty-source');
    expect(f.find((x) => x.rule === 'jsx-page-empty-source')?.path).toBe('pages.home.source');
  });

  it('validatePageSourceStyling reports the Tailwind className it used to walk past', () => {
    const f = validatePageSourceStyling(asMap({ kind: 'react', source: 'function Page(){ return <div className="p-4" />; }' }));
    expect(f.map((x) => x.rule)).toContain(PAGE_SOURCE_CLASSNAME);
    expect(f.find((x) => x.rule === PAGE_SOURCE_CLASSNAME)?.path).toBe('pages.home.source');
  });

  it('validateReactPageProps reports the unparseable source it used to walk past', () => {
    const wrecked = 'function Page(){\n  /* TODO\n  return <ObjectForm mode="edit" />;\n}\n';
    const f = validateReactPageProps(asMap({ kind: 'react', source: wrecked }));
    expect(f.map((x) => x.rule)).toContain(REACT_PAGE_SOURCE_UNPARSEABLE);
    expect(f.find((x) => x.rule === REACT_PAGE_SOURCE_UNPARSEABLE)?.path).toBe('pages.home.source');
  });

  // The array carrier is the control: the same page authored as a list still
  // reports the same rule at the positional path, so the map cases above are a
  // carrier the rules GAINED and not a path spelling they swapped to.
  it('POSITIVE CONTROL — the list carrier still reports at its positional path', () => {
    const f = validateReactPages(asList({ kind: 'react' }));
    expect(f.map((x) => x.rule)).toContain('react-page-empty-source');
    expect(f.find((x) => x.rule === 'react-page-empty-source')?.path).toBe('pages[0].source');
  });
});
