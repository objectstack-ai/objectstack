/**
 * The PageHeader docs demo is the CANONICAL `page:header` node (objectui#3906),
 * and it renders the component rather than a hand-rolled header (objectui#3787).
 *
 * `layout-page-header/basic-page-header` is the only runnable example on
 * `content/docs/layout/page-header.mdx`. Until objectui#3906 it was a
 * `page-header` node — the `@object-ui/layout` alias, a different renderer with
 * no `ComponentPropsMap` row — so the page's live demo taught the one spelling
 * the contract does not know. The maintainer's ruling on that card (direction
 * (b)) made the page's author face the canonical key; this file pins the demo to
 * it.
 *
 * ⚠️ The file keeps its old name on purpose. Tests in `packages/layout` cite it
 * BY PATH for the layout-registration and manifest pins at the bottom (the
 * `diagnose()` helper lives here; the `page-header` alias they once pinned is
 * retired, objectui#10859), so renaming it would silently falsify those
 * pointers. The demo it pins was renamed instead: it carries no actions any
 * more, for the reason the render pin below states.
 *
 * Pinned for the demo, each a different fact:
 *
 *  1. SHAPE — the root is `page:header`, its props sit in `properties` (the
 *     page-component spelling, the only place the contract judges them), and the
 *     JSON restates none of the classes the canonical renderer owns. The last
 *     half is the hand-rolled-copy guard of objectui#3787, re-derived against the
 *     canonical renderer's classes.
 *  2. RENDER — through the real `SchemaRenderer`, the node produces the bare
 *     header layout: a `<header>` root, an `<h1>` title, the subtitle, and the
 *     container classes the docs page's Styling section states.
 *  3. CONTRACT — the demo passes the spec's page-component shape and the
 *     `ComponentPropsMap['page:header']` row in FULL (value-level, not only
 *     "no unrecognized key"), and objectui's own schema mirror. Each pass is
 *     paired with a planted mistake the same validator must still refuse.
 *  4. DECLARATION — every key the demo writes is a declared input of the
 *     `page:header` registration, read through the manifest the app builds.
 *
 * Why no actions and no children (measured, objectui#3906): the canonical
 * renderer draws no `children` at all, and its `actions` are action IDS
 * resolved against the object bound to the page. A docs demo is bound to no
 * object, so ids there resolve to nothing (the renderer warns once per id) — a
 * demo "with actions" would render none. The contract refuses the other two
 * shapes the old demo used: `children` on this node (objectui#9256) and an
 * inline action object in `actions` (the spec's `z.array(z.string())`).
 *
 * Module-scope imports, not `beforeAll` (AGENTS.md §测试纪律): the registrations
 * are import-time side effects, and paying that cost at import time keeps it out
 * of every test/hook timeout budget.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@object-ui/components';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
import { registerLayout } from '@object-ui/layout';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { Diagnostic, SchemaElement } from '@object-ui/sdui-parser';
import { safeValidateSchema } from '@object-ui/types/zod';
import { ComponentPropsMap, PageComponentSchema } from '@objectstack/spec/ui';
import { getExample } from '../src/index.js';

const EXAMPLE_ID = 'layout-page-header/basic-page-header';

interface DemoNode {
  type?: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

const demo = (): DemoNode => getExample(EXAMPLE_ID).schema as DemoNode;

/**
 * Class strings the canonical renderer's bare layout puts on its own elements.
 * Their presence in the example JSON is the signature of a hand-rolled copy —
 * the defect objectui#3787 removed, not a styling choice.
 */
const COMPONENT_OWNED_CLASSES = [
  'border-b',
  'pb-4',
  'font-semibold',
  'tracking-tight',
  'text-2xl',
  'text-muted-foreground',
];

beforeAll(() => {
  registerLayout();
});

/**
 * The manifest the running app validates against, built the way the app builds
 * it — keyed by every KNOWN registry tag (bare and namespaced) rather than by
 * `getAllConfigs()`, whose `.type` is always the namespaced form. Mirrors
 * `getJsxManifest()` in `packages/components/src/renderers/layout/page.tsx`
 * (module-private, hence the four lines here): key it off `getAllConfigs()`
 * instead and the bare `page-header` tag authors write is absent from the
 * manifest, so every alias assertion below would pass on `unknown-component`
 * and never reach the check it names.
 */
const diagnose = (schema: unknown): Diagnostic[] => {
  const configs = ComponentRegistry.getKnownTypes().map((t) => {
    const meta = ComponentRegistry.getMeta(t);
    return { type: t, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
  });
  const manifest = manifestFromConfigs(configs as unknown as Parameters<typeof manifestFromConfigs>[0]);
  return validateTree(schema as SchemaElement, manifest).diagnostics;
};

/** Every issue as `path: code`, so a red run says what broke rather than `false`. */
const issuesOf = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; code: string }> } }) =>
  result.success ? [] : (result.error?.issues ?? []).map((i) => `${i.path.map(String).join('.')}: ${i.code}`);

describe('the page-header docs demo is the canonical `page:header` node (objectui#3906)', () => {
  it('is rooted at `page:header` and carries its props in `properties`', () => {
    const schema = demo();
    expect(schema.type).toBe('page:header');
    // Nothing else on the node: a prop written beside `type` is read by the
    // renderer but judged by no validator (see the CONTRACT describe below),
    // which is exactly the unchecked spelling the page tells authors not to use.
    expect(Object.keys(schema).sort()).toEqual(['properties', 'type']);
    expect(schema.properties).toEqual({
      title: 'Users',
      subtitle: 'Manage your team members and permissions',
    });
  });

  it('restates none of the classes the canonical renderer owns (the objectui#3787 guard)', () => {
    const json = JSON.stringify(demo());
    for (const cls of COMPONENT_OWNED_CLASSES) {
      expect(json, `example JSON should not restate \`${cls}\``).not.toContain(cls);
    }
  });

  it('renders the real canonical header: `<header>` root, `<h1>` title, subtitle', () => {
    const { container } = render(<SchemaRenderer schema={demo() as never} />);

    const root = container.querySelector('[data-obj-type="page:header"]');
    // The canonical renderer, not the alias's `<div>` root.
    expect(root?.tagName).toBe('HEADER');

    const h1 = container.querySelector('h1');
    expect(h1?.textContent).toBe('Users');
    expect(screen.getByText('Manage your team members and permissions')).toBeTruthy();

    // No actions authored and none resolvable without a bound object, and the
    // node draws no children: the header renders no button at all.
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('renders the classes the docs Styling section states for the bare layout', () => {
    // Pins the CODE side of the bare-layout bullets in
    // `content/docs/layout/page-header.mdx`. Changing any of them turns this
    // red, which is the prompt to update that section.
    const { container } = render(<SchemaRenderer schema={demo() as never} />);
    const root = container.querySelector('[data-obj-type="page:header"]');
    const cls = root?.className ?? '';
    expect(cls).toContain('gap-2');
    expect(cls).toContain('pb-4');
    expect(cls).toContain('border-b');
    expect(cls).not.toMatch(/\b(sm|md|lg|xl):(pb|gap)-/);

    const h1Cls = container.querySelector('h1')?.className ?? '';
    expect(h1Cls).toContain('text-2xl');
    expect(h1Cls).toContain('font-semibold');
    expect(h1Cls).not.toMatch(/\b(sm|md|lg|xl):text-/);
  });
});

/**
 * The demo satisfies the contract the page teaches — and the same validators
 * still refuse the mistakes the page warns about.
 *
 * Every positive is paired with a control, because "passes" is also what a
 * validator that stopped judging looks like. Controls assert the issue's CODE
 * and PATH, never its wording.
 */
describe('the demo satisfies the `page:header` contract (objectui#3906)', () => {
  const row = ComponentPropsMap['page:header'];

  it('passes the spec page-component shape and the `page:header` props row in full', () => {
    const schema = demo();
    expect(issuesOf(PageComponentSchema.safeParse(schema))).toEqual([]);
    // A FULL parse, not only "no unrecognized key": the row also judges values.
    expect(issuesOf(row.safeParse(schema.properties))).toEqual([]);
  });

  it('passes objectui’s own schema mirror', () => {
    expect(issuesOf(safeValidateSchema(demo()))).toEqual([]);
  });

  it('CONTROL — the row refuses the retired `icon` by name', () => {
    const issues = issuesOf(row.safeParse({ ...demo().properties, icon: 'users' }));
    expect(issues).toEqual(['icon: invalid_type']);
  });

  it('CONTROL — the mirror refuses a misspelled key inside `properties`', () => {
    const result = safeValidateSchema({ ...demo(), properties: { ...demo().properties, subTitle: 'x' } });
    expect(issuesOf(result)).toEqual(['properties: unrecognized_keys']);
  });

  it('CONTROL — the spec refuses a prop written beside `type`, which is why the demo uses `properties`', () => {
    const issues = issuesOf(PageComponentSchema.safeParse({ ...demo(), title: 'Users' }));
    expect(issues).toEqual([': unrecognized_keys']);
  });

  it('CONTROL — the mirror refuses `children` on this node, which is why the demo carries none', () => {
    const result = safeValidateSchema({ ...demo(), children: [{ type: 'button', label: 'Export' }] });
    expect(issuesOf(result)).toEqual(['children: invalid_type']);
  });
});

/**
 * The declaration face: every key the demo writes is a declared input of the
 * `page:header` registration.
 *
 * `validateTree` reads keys on the node itself, the way the JSX tier writes them
 * (as attributes); it has no notion of the `properties` bag. `SchemaRenderer`
 * hoists `properties.*` onto the node before the renderer reads it, so the demo
 * is validated here in that hoisted shape — the shape the registration's
 * `inputs` describe.
 */
describe('the `page:header` registration declares every key the demo writes (objectui#3906)', () => {
  const hoisted = (extra: Record<string, unknown> = {}) => {
    const { properties, ...node } = demo();
    return { ...node, ...properties, ...extra };
  };

  it('draws no diagnostic at all', () => {
    const diagnostics = diagnose(hoisted());
    // Reachability first: an `unknown-component` return never reaches the prop
    // check, and an empty list would then mean nothing.
    expect(diagnostics.filter((d) => d.code === 'unknown-component')).toEqual([]);
    expect(diagnostics.map((d) => d.code)).toEqual([]);
  });

  it('CONTROL — a misspelled key still draws `unknown-prop`', () => {
    expect(diagnose(hoisted({ subTitle: 'x' })).map((d) => d.code)).toContain('unknown-prop');
  });

  it('CONTROL — children under `page:header` draw `not-a-container`', () => {
    // The manifest agrees with the renderer and the mirror: the canonical node
    // takes no child list.
    const codes = diagnose(hoisted({ children: [{ type: 'button', label: 'Export' }] })).map((d) => d.code);
    expect(codes).toContain('not-a-container');
  });
});

/**
 * ── `@object-ui/layout`'s registrations, below this line ──────────────────────
 *
 * Everything from here down is about `@object-ui/layout`'s registrations, not
 * about the docs demo. Until objectui#10859 batch 8 (phase 2c) this section
 * pinned the `page-header` ALIAS: that a children-bearing alias node validated
 * clean of `not-a-container` (#3900), and that its declaration face matched what
 * its renderer read (#3972: `icon`, `actions`, the `description` cost of
 * objectui#11044), read off `ALIAS_FIXTURE`, the former demo JSON. That phase
 * retired the alias, so the alias half is now the retirement pin.
 *
 * Until objectui#11441 the section also pinned the `navigation-renderer`
 * declaration through this manifest: `items` declared as an array (#3972) and
 * as required (#3987), with `responsive-grid` as the all-optional control. The
 * maintainer's ruling on that card retired both registrations, so those
 * describes ended with the declaration they read. The retirement pin below
 * replaces them, and the containment control (#3900) moved to
 * `app-schema-renderer`.
 */
const RETIRED_ALIAS_NODE = {
  type: 'page-header',
  title: 'Users',
  subtitle: 'Manage your team members and permissions',
  children: [{ type: 'button', label: 'Add User' }],
};

describe('the retired `page-header` alias is unknown to the manifest (objectui#10859 batch 8)', () => {
  it('draws `unknown-component`, and the canonical `page:header` does not', () => {
    // Lit control first: the key authors write still resolves in the same manifest.
    expect(
      diagnose({ type: 'page:header', title: 'Users' }).filter((d) => d.code === 'unknown-component'),
    ).toEqual([]);
    expect(diagnose(RETIRED_ALIAS_NODE).map((d) => d.code)).toContain('unknown-component');
  });
});

/**
 * The layout key the same manifest still resolves — the lit control below. Its
 * app document is nested under `schema` with its own `type: 'app'`, the one
 * spelling `AppSchemaRendererNodeSchema` accepts since objectui#11494, so the
 * node is clean on every face, not only in this manifest.
 */
const APP_SCHEMA_NODE = { type: 'app-schema-renderer', schema: { type: 'app', name: 'crm', navigation: [] } };

describe('the retired `navigation-renderer` and `responsive-grid` keys are unknown to the manifest (objectui#11441)', () => {
  it('draws `unknown-component` for both spellings of `navigation-renderer`', () => {
    // Lit control first: a layout key the same manifest still resolves.
    expect(diagnose(APP_SCHEMA_NODE).filter((d) => d.code === 'unknown-component')).toEqual([]);
    // The keys are literals on purpose, one assertion each, so a reader
    // grepping for either spelling lands here.
    expect(diagnose({ type: 'navigation-renderer', items: [] }).map((d) => d.code)).toContain('unknown-component');
    expect(diagnose({ type: 'layout:navigation-renderer', items: [] }).map((d) => d.code)).toContain(
      'unknown-component',
    );
  });

  it('draws `unknown-component` for both spellings of `responsive-grid`, and `grid` resolves', () => {
    // Lit control: the spelling the retirement points authors to.
    expect(
      diagnose({ type: 'grid', columns: { xs: 1, md: 2 } }).filter((d) => d.code === 'unknown-component'),
    ).toEqual([]);
    expect(diagnose({ type: 'responsive-grid', columns: { xs: 1, md: 2 } }).map((d) => d.code)).toContain(
      'unknown-component',
    );
    expect(diagnose({ type: 'layout:responsive-grid', columns: { xs: 1, md: 2 } }).map((d) => d.code)).toContain(
      'unknown-component',
    );
  });
});

/**
 * The containment control (#3900), kept without the alias it used to stand
 * beside: a layout registration that takes no child list must still report
 * `not-a-container`, because children under it are an authoring mistake the
 * author has to hear about. Its subject was `navigation-renderer` until
 * objectui#11441 retired that key. `app-schema-renderer` builds its whole shell
 * from `schema` and draws no authored child list either;
 * `packages/layout/src/__tests__/containment-declared-slot-9910.test.tsx`
 * renders that fact.
 */
describe('a layout component that takes no child list still reports `not-a-container` (#3900)', () => {
  it('reports `not-a-container` for children under `app-schema-renderer`', () => {
    // If this component ever legitimately becomes a container, this assertion
    // goes red — move the control to another childless registration rather than
    // deleting it. The node is otherwise clean (reachability below), so the
    // planted defect — children under a childless component — is the only
    // thing wrong with it.
    const codes = diagnose({ ...APP_SCHEMA_NODE, children: [{ type: 'button', label: 'Nope' }] }).map(
      (d) => d.code,
    );
    expect(codes).not.toContain('unknown-component');
    expect(codes).toContain('not-a-container');
    expect(diagnose(APP_SCHEMA_NODE).map((d) => d.code)).toEqual([]);
  });
});
