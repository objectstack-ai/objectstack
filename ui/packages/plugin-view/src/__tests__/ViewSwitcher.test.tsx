/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ViewSwitcher } from '../ViewSwitcher';
import type { ViewSwitcherSchema, ViewType } from '@object-ui/types';

// Mock @object-ui/react to avoid circular dependency issues; mirrors
// ObjectView.test.tsx, including the data-invalidation bus that
// @object-ui/components imports at module-eval time.
vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => (
      <div data-testid="schema-renderer" data-schema-type={schema?.type}>
        {schema?.type}
      </div>
    ),
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});

// Every member of `ViewType`, derived from a TOTAL record rather than listed.
//
// ⚠️ The previous spelling — `const ALL_VIEW_TYPES: ViewType[] = [...]` — carried
// the comment "adding a member to the union without extending this list is a
// compile error here too". That claim was FALSE, and objectui#8127 is what
// proved it: an annotation of `ViewType[]` rejects an INVALID member and says
// nothing whatsoever about a MISSING one, because a short array is assignable to
// an array type. When `ViewType` gained the spec's `page`, this list stayed
// eleven long and compiled green; only the runtime `toEqual` below went red.
//
// That is the same failure the card records at six other sites, one level down:
// a structure promising exhaustiveness while providing none. A table plus a
// TOTALITY ASSERT is the spelling that actually delivers it — a member added to
// the union now fails to compile HERE, which is what the old comment said and
// could not do.
//
// ⚠️ objectui#9943 — the assert is separate from the table ON PURPOSE, and
// `satisfies Record<ViewType, true>` (this file's own previous spelling) is NOT
// an acceptable substitute. `satisfies` runs the excess-property check just as
// an annotation does, so the `page:` row below became TS2353 the moment
// objectstack#17063 retired that list-view kind from the spec — measured, same
// diagnostic as the three `Record<ViewType, …>` tables in `ViewSwitcher.tsx`
// and `ObjectView.tsx` that card repaired. `satisfies Record<string, true>`
// keeps the value constraint and drops the exactness; `_UncoveredViewType`
// keeps the ADDED-member half this comment is about.
type _AssertNever<T extends never> = T;

const ALL_VIEW_TYPES_TABLE = {
  list: true,
  detail: true,
  grid: true,
  kanban: true,
  calendar: true,
  timeline: true,
  map: true,
  gallery: true,
  gantt: true,
  chart: true,
  tree: true,
  page: true,
} satisfies Record<string, true>;

type _UncoveredViewType = _AssertNever<Exclude<ViewType, keyof typeof ALL_VIEW_TYPES_TABLE>>;

const ALL_VIEW_TYPES = Object.keys(ALL_VIEW_TYPES_TABLE) as ViewType[];

function schemaFor(types: ViewType[]): ViewSwitcherSchema {
  return {
    type: 'view-switcher',
    variant: 'buttons',
    views: types.map(type => ({ type })),
  };
}

function schemaForNamed(entries: Array<[string, string]>): ViewSwitcherSchema {
  return {
    type: 'view-switcher',
    variant: 'buttons',
    views: entries.map(([type, icon]) => ({ type: type as ViewType, icon })),
  };
}

/** Buttons of ONE render, scoped to its own container so probe and control cannot see each other. */
const buttonsIn = (container: HTMLElement): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll('button'));

/**
 * Read a sibling source file, from the repo root or from the package directory.
 *
 * NOT `new URL('../x', import.meta.url)`: Vite rewrites `import.meta.url` to a
 * SERVER-ROOT-relative path, so that form resolved to `/packages/plugin-view/
 * src/ObjectView.tsx` — an absolute path missing the repo root, ENOENT for the
 * whole suite. The two candidates below mirror the pair
 * `ObjectView.hostOnlyViewTypes.test.tsx` already uses for the same reason; the
 * first is the canonical repo-root invocation (objectui#3378).
 */
const readSibling = (file: string): string => {
  const candidates = [
    resolve(process.cwd(), 'packages/plugin-view/src', file),
    resolve(process.cwd(), 'src', file),
  ];
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) {
    throw new Error(
      `cannot locate plugin-view/src/${file} from ${process.cwd()} — tried:\n  ${candidates.join('\n  ')}`,
    );
  }
  return readFileSync(found, 'utf8');
};

/**
 * The `key: value` pairs of one named const object literal, read out of source
 * — here the quoted strings of `ObjectView`'s icon-NAME map. Read from source
 * because the map is module-private and stays that way: exporting it would
 * widen the package's surface for the sake of a test. A parse that finds
 * nothing is caught by the precondition test.
 */
function parseMapEntries(source: string, declaration: string): Array<[string, string]> {
  const start = source.indexOf(declaration);
  if (start === -1) return [];
  const open = start + declaration.length;
  const rest = source.slice(open);
  // The close is the first line that ENDS the literal. objectui#9943 moved
  // these maps off the exact `Record<ViewType, …>` annotation onto
  // `} satisfies Record<string, …>;`, which no longer contains the two-character
  // `};` the previous reader searched for.
  //
  // ⚠️ The hazard is LATENT, not live, and the distinction was measured rather
  // than assumed: reverting this line to `indexOf('};')` leaves this suite GREEN
  // today. It over-reads 392 characters past the literal — the totality assert
  // and the head of the `return { type, label, icon }` beside it — and none of
  // those lines happens to match the `key: value,` shape below, so the parse is
  // unchanged. One `label: something,` added to that block would make it a 13th
  // entry and redden the precondition test for a reason that has nothing to do
  // with `iconMap`. Matching the closing brace and whatever follows it covers
  // `};`, `} satisfies …;` and `} as …;` alike, and stops depending on luck.
  const close = rest.search(/^\s*\}\s*(?:satisfies\b|as\b|;)/m);
  if (close === -1) return [];
  return [...rest.slice(0, close).matchAll(/^\s*(\w+)\s*:\s*(?:'([\w-]+)'|(\w+))\s*,\s*$/gm)]
    .map(m => [m[1], (m[2] ?? m[3]) as string] as [string, string]);
}

describe('ViewSwitcher default view labels and icons', () => {
  it('renders a non-empty label and an icon for every ViewType', () => {
    render(<ViewSwitcher schema={schemaFor(ALL_VIEW_TYPES)} />);

    for (const type of ALL_VIEW_TYPES) {
      // A missing entry falls back to the raw type key for the label and to no
      // icon at all, which is what a hole in either Record<ViewType, ...> map
      // looked like on screen.
      const button = screen
        .getAllByRole('button')
        .find(b => b.textContent?.trim().toLowerCase() === type || b.textContent?.trim() === type);
      expect(button, `no button rendered for view type "${type}"`).toBeDefined();
      expect(button!.querySelector('svg'), `view type "${type}" rendered without an icon`).not.toBeNull();
    }
  });

  it('labels the chart view "Chart" rather than falling back to the type key', () => {
    render(<ViewSwitcher schema={schemaFor(['chart'])} />);

    expect(screen.getByText('Chart')).toBeInTheDocument();
    expect(screen.queryByText('chart')).toBeNull();
  });

  it('still lets an explicit label and icon override the defaults', () => {
    const { container } = render(
      <ViewSwitcher
        schema={{
          type: 'view-switcher',
          variant: 'buttons',
          views: [{ type: 'chart', label: 'Revenue', icon: 'chart-pie' }],
        }}
      />
    );

    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.queryByText('Chart')).toBeNull();
    // The icon half of the same override, asserted rather than assumed. This
    // fixture read `pie-chart` until objectui#5586: a deprecated lucide alias
    // that is absent from the runtime `icons` record, so the override rendered
    // a label and NO icon — and the test stayed green because it only ever
    // looked at the label. `chart-pie` is the spelling the record carries.
    expect(
      container.querySelector('button svg'),
      'the explicit `icon` override rendered no icon at all',
    ).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// objectui#5586 — a name that stopped resolving renders NOTHING at all.
//
// `ViewSwitcher` turns an icon NAME into a component by looking it up in
// lucide's runtime `icons` record, and draws nothing when the lookup misses.
// lucide retires a spelling by dropping it from that record while KEEPING it as
// a deprecated named export, so a retired name still imports, still
// type-checks, and still renders when used as a COMPONENT — and silently
// resolves to nothing when used as a STRING. That is how a major lucide bump
// took the `chart` and `gantt` icons out of the switcher with nothing going
// red: `packages/plugin-view` names the same glyphs both ways.
//
// ⚠️ The MEMBERSHIP half of this pin was retired by objectui#5633 and lives in
// `scripts/check-lucide-icon-record-names.mjs`, which judges `iconMap` and
// `DEFAULT_VIEW_ICONS` — plus the other six record-reading resolvers this
// package's local pin could never see — against the same record with the same
// predicate. What stays here is what the gate does NOT do: RENDER this
// component and look. A membership check cannot see an icon slot that stopped
// being rendered at all, and that is the other half of "renders nothing".
// ---------------------------------------------------------------------------

/** `ObjectView`'s producer map: view type → icon NAME, resolved at render time. */
const HOST_ICON_NAMES = parseMapEntries(
  readSibling('ObjectView.tsx'),
  'const iconMap = {',
);

describe('every icon name plugin-view supplies still resolves (objectui#5586)', () => {
  it('the source read found a real, TOTAL map — the precondition for "every"', () => {
    // A parse that quietly found nothing would leave every assertion below
    // vacuously green, which is the failure mode a widened pin invites. The
    // key-set comparison carries the totality claim too: `iconMap` is asserted
    // total over `ViewType` at its declaration (objectui#9943), so the compiler
    // will not let a view type land without an entry. Left on a bare
    // `satisfies Record<string, …>` with that assert DELETED, "every name"
    // would quietly shrink to "every name someone remembered".
    expect(
      HOST_ICON_NAMES.map(([type]) => type).sort(),
      'cannot read `iconMap` out of ObjectView.tsx — the declaration moved, was re-annotated, or\n'
        + 'no longer covers every ViewType. Fix the reader or the map; do not delete the pin.',
    ).toEqual([...ALL_VIEW_TYPES].sort());
  });

  it('renders an icon for every name `ObjectView` supplies', () => {
    const { container } = render(<ViewSwitcher schema={schemaForNamed(HOST_ICON_NAMES)} />);

    for (const [type, icon] of HOST_ICON_NAMES) {
      const button = buttonsIn(container).find(b => b.textContent?.trim().toLowerCase() === type);
      expect(button, `no button rendered for view type "${type}"`).toBeDefined();
      expect(
        button!.querySelector('svg'),
        `\`${type}: '${icon}'\` renders NO icon. The name is resolved through lucide's runtime\n`
          + '`icons` record, and a spelling lucide keeps only as a DEPRECATED NAMED EXPORT is absent\n'
          + 'from that record — that it imports and type-checks elsewhere says nothing about this\n'
          + 'path. Replace it with a spelling the record carries (objectui#5586).',
      ).not.toBeNull();
    }
  });

  it('renders NO icon for a name that does not resolve — the control', () => {
    // Same component, same schema shape, same container-scoped query as the
    // assertion above, so it fails on exactly what that one passes on. Without
    // it, "every button has an svg" would hold just as well against a build
    // whose icon slot always rendered something — and an always-filled slot is
    // not what `{Icon ? <Icon /> : null}` does. This is also the precise shape
    // the two broken names had on screen: a label, and nothing beside it.
    const { container } = render(
      <ViewSwitcher schema={schemaForNamed([['grid', 'no-such-lucide-icon']])} />,
    );

    const button = buttonsIn(container).find(b => b.textContent?.trim() === 'Grid');
    expect(button, 'no button rendered for the control view').toBeDefined();
    expect(button!.querySelector('svg')).toBeNull();
  });
});
