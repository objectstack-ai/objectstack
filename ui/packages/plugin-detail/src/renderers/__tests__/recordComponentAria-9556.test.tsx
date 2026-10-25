/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `record:*` — the `aria` bag is declared by the protocol and honoured here
 * (objectui#9556)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * objectui#9556 measured the bag as declared on six interfaces and read by one
 * renderer. Re-measured on this branch's base, the shape is SHARPER than that
 * and points the other way on both halves — which is why this file re-derives
 * every population instead of restating the card's (AGENTS.md #9):
 *
 *   - the PROTOCOL declares `aria` on all six blocks, so the declarations in
 *     `@object-ui/types` are faithful and a retirement would have to move
 *     `@objectstack/spec` first. Under the maintainer's standing principle
 *     (spec > implementation > docs), an accepted-then-dropped key is an
 *     IMPLEMENTATION GAP, closed by making the renderer honour it;
 *   - `record:path` was NOT the healthy row the card's table recorded. It read
 *     `(schema.aria as any)?.label` — the one spelling the shared ARIA shape
 *     REFUSES — and therefore discarded the spec-valid `aria.ariaLabel` it was
 *     credited with reading. Zero of the six spec-declared slots was honoured;
 *   - `record:quick_actions` was NOT missing a props interface. It declares one
 *     (`RecordQuickActionsRendererProps`) in its own module, `aria` included.
 *     What is true is narrower and sharper: the PROTOCOL declares no `aria` on
 *     `RecordQuickActionsProps`, so that block's read is unreachable for any
 *     contract-valid document.
 *
 * ## What each half of this file can and cannot prove
 *
 *   - The CENSUS cases read the INSTALLED `@objectstack/spec` artifact. They are
 *     the PREMISE of the routing decision, never its evidence — they were green
 *     before this change and are green after. They earn their place by going RED
 *     the day the protocol moves either boundary: declaring `aria` on
 *     `record:quick_actions` (which its own refusal message says it will do once
 *     objectui's renderer and the contract agree), or retiring it from one of
 *     the six.
 *   - The RENDER cases are the only half that discriminates the defect from the
 *     fix. A source grep cannot: `SchemaRenderer` hands a node's leftover keys
 *     to the component as React props, so a renderer can consume a key it never
 *     names (AGENTS.md). These mount the real renderers and read the
 *     accessibility tree.
 *
 * ## The refused alias is read on NO block, and that is asserted here
 *
 * This change read the contract-refused `aria.label` spelling on
 * `record:path` and `record:quick_actions` only, the two blocks that already
 * read it before. objectui#9945 then retired it on those two as well. So
 * ⛔ no block reads it now, and the cases below assert that on all seven, each
 * absence paired with the control that shows the same block honours the
 * canonical spelling. The retirement's own pins (the default name, the report)
 * live in `recordAriaLabelRetired-9945.test.tsx`.
 *
 * ## Why the assertions are accessible NAMES, not attributes
 *
 * `aria-label` on a bare `div` reaches nobody — a `div` is `generic`, and
 * browsers expose no accessible name on a generic element. This block family has
 * already paid for that once: `record:path`'s `aria-label="Alternative terminal
 * stages"` sat on a `div` and was inert rather than untranslated
 * (`record-path.containerLabel.test.tsx`). An assertion on the ATTRIBUTE would
 * pass for a fix that no screen-reader user can hear, so every case below goes
 * through `getByRole(role, { name })` or `toHaveAccessibleName`.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, cleanup, type RenderResult } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider } from '@object-ui/react';
// Named imports, ⛔ never `import * as` — the repo's `no-restricted-imports` rule
// bans a namespace import of this module because it would drag in the spec's
// form-VIEW `FormField`/`FormFieldSchema`, whose type erases to `any`
// (objectui#3090). Naming each schema also makes a removed export a build
// failure rather than a census that quietly reports one block fewer.
import {
  AriaPropsSchema,
  RecordDetailsProps,
  RecordHighlightsProps,
  RecordRelatedListProps,
  RecordActivityProps,
  RecordChatterProps,
  RecordPathProps,
  RecordQuickActionsProps,
} from '@objectstack/spec/ui';
import { RecordDetailsRenderer } from '../record-details';
import { RecordHighlightsRenderer } from '../record-highlights';
import { RecordActivityRenderer } from '../record-activity';
import { RecordChatterRenderer } from '../record-chatter';
import { RecordRelatedListRenderer } from '../record-related-list';
import { RecordPathRenderer } from '../record-path';
import { RecordQuickActionsRenderer } from '../record-quick-actions';

/**
 * ONE fetch double, at module scope, never torn down (objectui#6640 /
 * objectui#7439).
 *
 * `record:details` probes `POST /api/v1/security/explain` for the row-level
 * verdict and `record:related_list` fetches its rows; happy-dom resolves both
 * relative URLs to a REAL socket, which the repo's network-escape guard fails
 * the file for. Neither answer is what any case here asserts — every assertion
 * is about the container's ARIA — so an empty, always-allowed double is the
 * whole requirement. It is installed once and left up, rather than restored in
 * an `afterEach`, because both blocks can issue a read after the test body
 * returns and a restored `fetch` would let that one escape.
 */
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ allowed: true, value: [], data: [], records: [] }),
  text: async () => '{"allowed":true}',
})) as never);

afterEach(() => cleanup());

/**
 * The renderer's OWN container — the element every case below is about.
 *
 * ⛔ Not `screen.getByRole('region')`: `record:activity` and `record:chatter`
 * mount a panel that already renders its own named `<section>` (a `region` in
 * its own right), so a document-wide role query answers about the PANEL and
 * cannot see whether the block's container gained anything. Measured, not
 * assumed — that inner section is what an earlier draft of the absence cases
 * below was actually reading.
 */
const rootOf = (r: RenderResult): HTMLElement => r.container.firstElementChild as HTMLElement;

// ---------------------------------------------------------------------------
// Census — read off the installed contract, never written down here
// ---------------------------------------------------------------------------

/** Protocol props schemas for the blocks this package renders a container for. */
const SPEC_BLOCK_SCHEMAS: Record<string, any> = {
  'record:details': RecordDetailsProps,
  'record:highlights': RecordHighlightsProps,
  'record:related_list': RecordRelatedListProps,
  'record:activity': RecordActivityProps,
  'record:chatter': RecordChatterProps,
  'record:path': RecordPathProps,
  'record:quick_actions': RecordQuickActionsProps,
};

/** The schema's own key set, read off the installed artifact. */
function ownKeys(schema: any): string[] {
  const shape = typeof schema?._def?.shape === 'function' ? schema._def.shape() : schema?.shape;
  return Object.keys(shape ?? {});
}

/** Does the installed contract declare an `aria` member on this block? */
function declaresAria(schema: any): boolean {
  return ownKeys(schema).includes('aria');
}

describe('census: which record blocks the CONTRACT declares `aria` on (objectui#9556)', () => {
  it('declares it on every block except `record:quick_actions`', () => {
    const declaring = Object.entries(SPEC_BLOCK_SCHEMAS)
      .filter(([, schema]) => declaresAria(schema))
      .map(([block]) => block);

    // Stated as the two SETS the routing decision turns on, derived above.
    expect(declaring).not.toContain('record:quick_actions');
    expect(declaring.length).toBe(Object.keys(SPEC_BLOCK_SCHEMAS).length - 1);
  });

  it('the census instrument fires — a key every one of them declares is found', () => {
    // Non-vacuity: `declaresAria` reading a mis-shaped schema would answer
    // `false` everywhere and the case above would pass for the wrong reason.
    expect(ownKeys(RecordPathProps)).toContain('statusField');
    expect(ownKeys(RecordQuickActionsProps)).toContain('actionNames');
    // …and an absent control, so "declared" is not simply always true.
    expect(ownKeys(RecordPathProps)).not.toContain('qqzz_absent_key_9556');
  });

  it('`record:quick_actions` REFUSES the bag, so its read is unreachable by contract', () => {
    const refused = RecordQuickActionsProps.safeParse({
      actionNames: ['convert'],
      aria: { ariaLabel: 'Account actions' },
    });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
    // `keys` lives on the `unrecognized_keys` variant only, so it is read off the
    // issue rather than annotated onto every arm of the union.
    expect(
      refused.error?.issues.flatMap((i) => (i as { keys?: string[] }).keys ?? []),
    ).toContain('aria');

    // The control that makes the refusal mean something: the same document
    // without the bag parses.
    expect(
      RecordQuickActionsProps.safeParse({ actionNames: ['convert'] }).success,
    ).toBe(true);
  });

  it('the shared ARIA shape accepts `ariaLabel` (string OR inline map) and refuses `label`', () => {
    expect(AriaPropsSchema.safeParse({ ariaLabel: 'Deal stages' }).success).toBe(true);
    // The arm the declaration was narrower than until objectui#9556.
    expect(AriaPropsSchema.safeParse({ ariaLabel: { en: 'Deal stages', 'zh-CN': '阶段' } }).success)
      .toBe(true);

    const alias = AriaPropsSchema.safeParse({ label: 'Deal stages' });
    expect(alias.success).toBe(false);
    expect(alias.error?.issues.flatMap((i) => (i as { keys?: string[] }).keys ?? [])).toContain('label');
  });
});

// ---------------------------------------------------------------------------
// Render — the accessibility tree, not the source
// ---------------------------------------------------------------------------

const NAME = 'Account overview';

function mount(node: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <RecordContextProvider objectName="crm_account" recordId="rec-1" data={{ id: 'rec-1', stage: 'won' }}>
        {node}
      </RecordContextProvider>
    </I18nProvider>,
  );
}

/** The five blocks whose container carried no ARIA at all before objectui#9556. */
const CONTAINER_BLOCKS: Array<[string, (aria?: unknown) => React.ReactElement]> = [
  ['record:details', (aria) => <RecordDetailsRenderer schema={{ ...(aria ? { aria } : {}) } as never} />],
  ['record:highlights', (aria) => <RecordHighlightsRenderer schema={{ fields: ['name'], ...(aria ? { aria } : {}) } as never} />],
  ['record:activity', (aria) => <RecordActivityRenderer schema={{ items: [], ...(aria ? { aria } : {}) } as never} />],
  ['record:chatter', (aria) => <RecordChatterRenderer schema={{ ...(aria ? { aria } : {}) } as never} />],
];

describe('an authored `aria.ariaLabel` reaches the accessibility tree (objectui#9556)', () => {
  for (const [block, mk] of CONTAINER_BLOCKS) {
    it(`${block} exposes the authored name on a role that can carry one`, () => {
      mount(mk({ ariaLabel: NAME }));
      // `getByRole` reads the accessibility tree: it fails both when the name is
      // absent AND when the name sits on a `generic` element that cannot expose
      // one — which an attribute-level assertion would not catch.
      expect(screen.getByRole('region', { name: NAME })).toBeInTheDocument();
    });

    it(`${block} adds nothing to its own container when no aria is authored`, () => {
      // The other half of the bargain: a page that never wrote the key renders
      // the DOM it always did. A blanket `role="region"` would show up here.
      const root = rootOf(mount(mk(undefined)));
      expect(root).not.toHaveAttribute('role');
      expect(root).not.toHaveAttribute('aria-label');
      expect(root).not.toHaveAttribute('aria-describedby');
      // …and nothing anywhere answers to the authored name, which is the user-
      // visible form of the same claim.
      expect(screen.queryByRole('region', { name: NAME })).toBeNull();
    });

    it(`${block} honours an authored role instead of the fallback`, () => {
      mount(mk({ ariaLabel: NAME, role: 'group' }));
      expect(screen.getByRole('group', { name: NAME })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: NAME })).toBeNull();
    });

    it(`${block} resolves an inline locale map rather than rendering an object`, () => {
      // The widened declaration is only worth having if the read side resolves
      // it: an unresolved map reaches the DOM as `[object Object]`.
      mount(mk({ ariaLabel: { en: NAME, 'zh-CN': '客户概览' } }));
      expect(screen.getByRole('region', { name: NAME })).toBeInTheDocument();
    });
  }

  it('record:related_list exposes the authored name too', () => {
    mount(
      <RecordRelatedListRenderer
        schema={{ objectName: 'crm_contact', relationshipField: 'account_id', aria: { ariaLabel: NAME } } as never}
      />,
    );
    expect(screen.getByRole('region', { name: NAME })).toBeInTheDocument();
  });

  it('an authored `ariaDescribedBy` reaches the same container', () => {
    mount(<RecordChatterRenderer schema={{ aria: { ariaLabel: NAME, ariaDescribedBy: 'desc-1' } } as never} />);
    expect(screen.getByRole('region', { name: NAME })).toHaveAttribute('aria-describedby', 'desc-1');
  });
});

describe('the contract-refused `aria.label` alias is read on NO block', () => {
  /**
   * The alias is `AriaPropsSchema`'s rename prescription — refused on parse,
   * on every bag (the census above measures that). objectui#4663 installed a
   * back-compat fold for it on `record:quick_actions`, and `record:path` read
   * it and nothing else; objectui#9945 retired both.
   *
   * ⚠️ The first draft of the shared read point folded it for EVERY caller,
   * which handed a contract-refused spelling five new readers while the
   * changeset said nothing had been introduced. These cases are why no block
   * can start reading it again quietly, each absence with the control that
   * makes it mean something.
   */
  const ALIAS = 'Legacy name';

  for (const [block, mk] of CONTAINER_BLOCKS) {
    it(`${block} does NOT honour the refused alias`, () => {
      mount(mk({ label: ALIAS }));
      expect(screen.queryByRole('region', { name: ALIAS })).toBeNull();
      // Nothing anywhere answers to it — not just "not on a region".
      expect(screen.queryByText(ALIAS)).toBeNull();
    });

    it(`${block} control — the SAME block does honour the canonical spelling`, () => {
      // Without this the absence above would pass for a block that renders
      // nothing at all, which is the way this kind of assertion goes vacuous.
      mount(mk({ ariaLabel: ALIAS }));
      expect(screen.getByRole('region', { name: ALIAS })).toBeInTheDocument();
    });
  }

  it('record:related_list does not honour it either', () => {
    mount(
      <RecordRelatedListRenderer
        schema={{ objectName: 'crm_contact', relationshipField: 'account_id', aria: { label: ALIAS } } as never}
      />,
    );
    expect(screen.queryByRole('region', { name: ALIAS })).toBeNull();
  });

  it('record:path and record:quick_actions do not either, since objectui#9945', () => {
    // These two used to be the positive half. They are restated beside the five
    // absences so all seven are read together rather than a screen apart; each
    // announces its default name instead (the retirement's own file pins that,
    // and the report it emits).
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount(
      <RecordPathRenderer
        schema={{ statusField: 'stage', stages: [{ value: 'won', label: 'Won' }], aria: { label: ALIAS } } as never}
      />,
    );
    expect(screen.queryAllByRole('list', { name: ALIAS })).toHaveLength(0);
    expect(screen.getAllByRole('list', { name: 'Record path' })).toHaveLength(2);
    cleanup();

    const ACT = { name: 'act', label: 'Act', type: 'script', locations: ['record_header'] };
    mount(<RecordQuickActionsRenderer schema={{ actions: [ACT], aria: { label: ALIAS } } as never} />);
    expect(screen.queryByRole('toolbar', { name: ALIAS })).toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Quick actions' })).toBeInTheDocument();
    warn.mockRestore();
  });
});

describe('how the authored name COMPOSES with a panel that already has one', () => {
  /**
   * objectui#9556 asked this as an open question and called it an a11y decision
   * rather than a typing one. This is the measurement the decision needs, and
   * ⛔ it is not the decision: `record:activity` and `record:chatter` mount a
   * panel that renders its own named `<section>`, so an authored name lands on
   * the block's OUTER container and the panel keeps its inner one — two nested
   * named regions, not a replacement.
   *
   * ⚠️ This is pinned as the SHIPPED behaviour, not as the right answer.
   * Whether an authored name should instead REPLACE the panel's own is
   * objectui#9556's open question, and it would have to be plumbed into
   * `RecordActivityTimeline` / `RecordChatterPanel` rather than decided here.
   */
  it('record:activity nests the authored name outside the panel\'s own', () => {
    const r = mount(<RecordActivityRenderer schema={{ items: [], aria: { ariaLabel: NAME } } as never} />);
    const root = rootOf(r);
    expect(root).toHaveAttribute('role', 'region');
    expect(root).toHaveAccessibleName(NAME);
    // The panel's own section is still there, still named by the panel.
    const inner = root.querySelector('section[aria-label]');
    expect(inner).not.toBeNull();
    expect(inner?.getAttribute('aria-label')).not.toBe(NAME);
  });
});

describe('record:path honours the CONTRACT spelling, not the refused alias (objectui#9556)', () => {
  const STAGES = [
    { value: 'draft', label: 'Draft' },
    { value: 'won', label: 'Won', terminal: 'won' as const },
  ];
  const path = (aria?: unknown) => (
    <RecordPathRenderer
      schema={{ statusField: 'stage', stages: STAGES, ...(aria ? { aria } : {}) } as never}
    />
  );

  it('the spec-valid `aria.ariaLabel` now names both rails — it used to be discarded', () => {
    mount(path({ ariaLabel: 'Deal stages' }));
    const rails = screen.getAllByRole('list', { name: 'Deal stages' });
    // Desktop and mobile rails are both rendered; the split is CSS-only.
    expect(rails).toHaveLength(2);
  });

  it('the refused `aria.label` alias no longer folds in (objectui#9945): the pack name stays', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount(path({ label: 'Legacy stages' }));
    expect(screen.queryAllByRole('list', { name: 'Legacy stages' })).toHaveLength(0);
    expect(screen.getAllByRole('list', { name: 'Record path' })).toHaveLength(2);
    warn.mockRestore();
  });

  it('the canonical spelling wins when a stored document carries both', () => {
    // The regression this file exists to prevent: `record:path` honoured the
    // alias and ONLY the alias, so this case returned the legacy name.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount(path({ ariaLabel: 'Deal stages', label: 'Legacy stages' }));
    expect(screen.getAllByRole('list', { name: 'Deal stages' })).toHaveLength(2);
    expect(screen.queryAllByRole('list', { name: 'Legacy stages' })).toHaveLength(0);
    warn.mockRestore();
  });

  it('with nothing authored the rails keep their localized pack name', () => {
    mount(path(undefined));
    expect(screen.getAllByRole('list', { name: 'Record path' })).toHaveLength(2);
  });

  it('the rails stay `list`s, so their stages keep their owner', () => {
    // An authored name must not cost the `list`/`listitem` pairing the stage
    // labels depend on.
    mount(path({ ariaLabel: 'Deal stages' }));
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
  });
});

describe('record:quick_actions keeps objectui#4663\'s canonical read and built-in default', () => {
  const ACT = { name: 'act', label: 'Act', type: 'script', locations: ['record_header'] };
  const bar = (aria?: unknown) => (
    <RecordQuickActionsRenderer schema={{ actions: [ACT], ...(aria ? { aria } : {}) } as never} />
  );

  it('still reads the canonical spelling', () => {
    mount(bar({ ariaLabel: 'Account actions' }));
    expect(screen.getByRole('toolbar', { name: 'Account actions' })).toBeInTheDocument();
  });

  it('still falls back to the built-in name', () => {
    mount(bar(undefined));
    expect(screen.getByRole('toolbar', { name: 'Quick actions' })).toBeInTheDocument();
  });

  it('still treats an authored empty canonical name as no name, and does not read the alias', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount(bar({ ariaLabel: '', label: 'Legacy' }));
    expect(screen.getByRole('toolbar', { name: 'Quick actions' })).toBeInTheDocument();
    warn.mockRestore();
  });
});
