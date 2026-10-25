/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `dashboard` — the honoured keys are published, per key, and the two ruled
 * out stay pinned out (objectui#5742).
 *
 * ## The card
 *
 * The `dashboard` registration published exactly three inputs (`columns`,
 * `gap`, `className`) while `DashboardRenderer` honoured `widgets`, `label` /
 * legacy `title`, `description`, `header`, `globalFilters`, `dateRange` and
 * `refreshIntervalSeconds` (spelled `refreshInterval` until @objectstack/spec
 * 17.4.0 renamed it — objectui#7783). `inputs` is not documentation: it is the published
 * authoring surface (`gen-manifest.ts` serializes it into
 * `sdui.manifest.json` — the save gate and parser whitelist — and into
 * `sdui-intrinsics.d.ts`, and `dashboard` is in `PUBLIC_BLOCKS`). So
 * `validateTree` warned authors off keys that work — `widgets` included, the
 * very prop whose CONTENTS the objectui#5709 `unconsumed-widget-option`
 * warning reasons about, two diagnostics reading incoherently side by side.
 *
 * ## The per-key line (the shipped #4668 / #5091 precedents)
 *
 * A key is DECLARED only when both hold: the renderer reads it AND
 * `@objectstack/spec`'s strict `DashboardSchema` accepts it — so the manifest
 * never offers a key the save gate refuses. That line puts seven keys in and
 * keeps two honest exclusions out:
 *
 *   - `title` — the legacy objectui spelling of the spec-canonical `label`
 *     (framework#1878). The spec REJECTS it by name, so declaring it would
 *     publish a key an author could not save.
 *
 *     ⚠️ SUPERSEDED IN PART (objectui#7509, maintainer ruling 2026-09-04,
 *     decision batch #29). This file used to add "and the `schema.title ||
 *     schema.label` read STAYS — documents in the wild carry it — which is
 *     exactly the #5091 shape: non-author surface, still read." That read is
 *     GONE: the five dashboard-root `title` read arms retired together under
 *     ADR-0049, and `label` is now the only header source. What is unchanged
 *     is this file's own subject — `title` stays OUT of the published `inputs`
 *     — and its reason only got stronger: the key is now neither authorable
 *     nor read. The retirement's own pins live in
 *     `DashboardRenderer.rootTitleRetired.test.tsx` and its four siblings; the
 *     block at the bottom of this file was rewritten to match, rather than
 *     deleted, because "the renderer's behaviour on the key" is a claim this
 *     file makes and must therefore keep making — correctly.
 *   - `aria` — the spec carries a TOMBSTONE for `dashboard.aria` (removed at
 *     the #3896 audit close-out, "no dashboard renderer ever applied it").
 *     Measured here too: this package has NO read site for `schema.aria`, so
 *     unlike `title` there is no "renderer still reads it" leg — the issue
 *     body's listing of `aria` among the honoured reads was wrong on that one
 *     key. The pin is that it stays unpublished and spec-refused.
 *
 * ## The third exclusion: `name` — ruled non-author, on weaker evidence
 *
 * `schema.name` is read too (it keys the `dashboards.{name}.*` translation
 * lookups), and it is NOT declared: objectui#5742 ruled it non-author for
 * the INLINE node.
 *
 * Its reason is NOT `title`'s or `aria`'s, and that difference is the point.
 * The spec ACCEPTS `name` — but on the DOCUMENT form, where it is REQUIRED,
 * not on this inline node. So the per-key line above never fires here at
 * all: its first clause ("the spec accepts it") is about a different shape.
 * Do not read this exclusion as "the spec rejects `name`" — it does not, and
 * a reader who sees `name` excluded beside `title` and assumes the same
 * reason has it wrong.
 *
 * The `schema.name` read STAYS untouched, exactly as `title`'s does — the
 * renderer still resolves `dashboards.{name}.*` through it.
 *
 * The evidence is the PRODUCER alone: `DashboardView` / the document loader
 * hands the loaded document to the renderer, so an inline author is not the
 * one who writes this key. That is a WEAKER pin than the two in `NON_AUTHOR`
 * below, each of which asserts a spec verdict a reader can re-check — and it
 * is why `name` carries no row there: there is no verdict for it to assert.
 * Its absence from `inputs` is ruled, not merely unexamined; do not read that
 * silence as the same strength of guarantee the other two carry.
 *
 * The supporting reason, had the above not already settled it: publishing
 * `name` inline would teach authors — AI authors especially — to fabricate a
 * dashboard identity that resolves NO translations and fails silently. That
 * is a newly manufactured silently-inert key: the exact defect class this
 * card removes.
 *
 * ## Why every positive has a control
 *
 * "No diagnostic" is also what a silenced check looks like: the undeclared
 * probe key must still draw `unknown-prop`, the declared control must be
 * published, and the spec must accept the full declared document — otherwise
 * every absence/rejection assertion here would pass against a registry that
 * published nothing or a schema that refuses everything (the same pairing
 * `ga-honoured-inputs-author-reach.test.ts` and `gridNonAuthorKeys.test.tsx`
 * use, for the same reason).
 *
 * Module-scope registration import, not a hook (AGENTS.md §测试纪律): the
 * registration is the fixture, and its cold transform must not be billed to a
 * bounded test/hook window.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { DashboardSchema } from '@objectstack/spec/ui';
import { manifestFromConfigs, validateTree, generateDts, propsName } from '@object-ui/sdui-parser';
import type { Diagnostic, SchemaElement } from '@object-ui/sdui-parser';
import { ActionProvider } from '@object-ui/react';
import { DashboardRenderer } from '../DashboardRenderer';
// Module scope, not a hook: this import IS the registration.
import '../index';

/**
 * The manifest exactly as `gen-manifest.ts` / `dump-public-manifest.mjs`
 * build the published one — `getPublicConfigs()` through
 * `manifestFromConfigs` — so the verdicts below are the ones a real author
 * gets, not ones a hand-written fixture was shaped to produce. (Only this
 * package's registrations are loaded here; `dashboard` is among them, which
 * is all these assertions read.)
 */
const manifest = manifestFromConfigs(
  ComponentRegistry.getPublicConfigs() as unknown as Parameters<typeof manifestFromConfigs>[0],
);

const diagnose = (node: Record<string, unknown>): Diagnostic[] =>
  validateTree({ type: 'dashboard', ...node } as unknown as SchemaElement, manifest).diagnostics;

/** Diagnostics naming a specific prop (the messages quote prop names). */
const codesMentioning = (node: Record<string, unknown>, prop: string): string[] =>
  diagnose(node)
    .filter((d) => d.message.includes(`"${prop}"`))
    .map((d) => d.code);

/** The spec's verdict on a minimal legal document plus one patch. */
const specVerdict = (patch: Record<string, unknown>) =>
  DashboardSchema.safeParse({ name: 'sales_ops', label: 'Sales Ops', widgets: [], ...patch });

/** Unrecognized KEYS from a failed parse — a key verdict, never a document one. */
const unrecognizedKeys = (result: { success: boolean; error?: unknown }): string[] =>
  ((result as { error?: { issues: Array<{ code: string; keys?: string[] }> } }).error?.issues ?? [])
    .filter((issue) => issue.code === 'unrecognized_keys')
    .flatMap((issue) => issue.keys ?? []);

/**
 * The newly published keys, each with a spec-legal sample value. The sample
 * doubles as the spec-acceptance evidence: `full declared document` below
 * parses all of them at once.
 */
const DECLARED: Array<[string, unknown]> = [
  ['widgets', [{ id: 'w1', type: 'bar', dataset: 'invoices', values: ['count'] }]],
  ['label', 'Sales Overview'],
  ['label', { en: 'Sales Overview', 'zh-CN': '销售总览' }],
  ['description', 'The numbers behind the pipeline'],
  ['description', { en: 'The numbers behind the pipeline' }],
  ['header', { showTitle: false, actions: [{ label: 'Open', actionUrl: '/x' }] }],
  ['globalFilters', [{ field: 'region', label: 'Region', type: 'select' }]],
  ['dateRange', { field: 'created_at', defaultRange: 'last_30_days' }],
  ['refreshIntervalSeconds', 30],
];

/** Values matching NO declared arm — each must still be reported. */
const OFF_ARM: Array<[string, unknown]> = [
  ['widgets', {}],
  ['label', 42],
  ['description', 42],
  ['header', true],
  ['globalFilters', 'region'],
  ['dateRange', []],
  ['refreshIntervalSeconds', '30'],
];

/** The two keys ruled OUT, with the evidence a reader can re-check. */
const NON_AUTHOR = [
  {
    key: 'title',
    sample: 'Legacy Ops',
    why:
      'legacy spelling of the spec-canonical `label` (framework#1878) — `DashboardSchema` '
      + 'rejects it by name, so publishing it would offer a key the save gate refuses',
  },
  {
    key: 'aria',
    sample: { ariaLabel: 'Ops' },
    why:
      'spec tombstone (#3896 audit close-out): no dashboard renderer ever applied it, and '
      + 'this package has no `schema.aria` read site',
  },
] as const;

afterEach(cleanup);

describe('the manifest resolves `dashboard`, and the check is live (objectui#5742)', () => {
  it('resolves the block (reachability before any absence claim)', () => {
    expect(manifest.components['dashboard']).toBeTruthy();
    expect(diagnose({}).map((d) => d.code)).not.toContain('unknown-component');
  });

  it('an undeclared key still draws unknown-prop — the control', () => {
    expect(codesMentioning({ objectui5742NotAProp: 'x' }, 'objectui5742NotAProp')).toContain(
      'unknown-prop',
    );
  });
});

describe('the honoured keys now validate clean on an inline dashboard node (objectui#5742)', () => {
  it.each(DECLARED)('%s draws no diagnostic', (key, value) => {
    expect(codesMentioning({ [key]: value }, key), `dashboard.${key}`).toEqual([]);
  });

  it.each(OFF_ARM)('%s still rejects an off-arm value — declaring is not disarming', (key, value) => {
    expect(codesMentioning({ [key]: value }, key)).toContain('type-mismatch');
  });

  it('the spec accepts the full declared document — the declarations rest on its verdicts', () => {
    const result = specVerdict({
      description: 'x',
      header: { showTitle: true },
      columns: 4,
      gap: 6,
      refreshIntervalSeconds: 30,
      dateRange: { field: 'created_at', defaultRange: 'last_30_days' },
      globalFilters: [{ field: 'region', label: 'Region', type: 'select' }],
    });
    expect(result.success, JSON.stringify((result as { error?: unknown }).error ?? {})).toBe(true);
  });

  it('both arms of the two union keys are spec-derived, not guessed', () => {
    // `label` / `description` are `string | inline locale map` on the spec —
    // the declared `['string', 'object']` arms restate exactly that, and a
    // kind matching neither arm is refused by BOTH authorities.
    for (const key of ['label', 'description']) {
      expect(specVerdict({ [key]: 'plain' }).success).toBe(true);
      expect(specVerdict({ [key]: { en: 'plain', 'zh-CN': '文' } }).success).toBe(true);
      expect(specVerdict({ [key]: 42 }).success).toBe(false);
    }
  });
});

describe('the two ruled-out keys stay unpublished — and checkably so (objectui#5742)', () => {
  const inputNames = (namespace?: string): string[] =>
    ((ComponentRegistry.getConfig('dashboard', namespace) as { inputs?: Array<{ name: string }> })
      ?.inputs ?? []).map((i) => i.name);

  // ⚠️ The namespaced spelling is `plugin-dashboard`, not `view`: objectui#9533
  // converged the bare `dashboard` key onto the namespace the console stubs and
  // the CLI whitelist declare. `view:dashboard` still resolves — to a retirement
  // TOMBSTONE that publishes no `inputs` at all — so looking the authoring
  // surface up there would read an empty list and pass the "publishes neither"
  // half while measuring nothing. The `label` / `widgets` controls below are
  // what catch that, and they are why this row moved rather than being dropped.
  it.each([undefined, 'plugin-dashboard'] as const)(
    'the registration publishes neither, looked up %s',
    (namespace) => {
      const declared = inputNames(namespace);
      for (const { key, why } of NON_AUTHOR) {
        expect(declared, `\`dashboard\` now publishes \`${key}\` — but ${why}.`).not.toContain(key);
      }
      // The declared controls: absence above means something only while the
      // same registration really publishes the ruled-in surface.
      expect(declared).toContain('label');
      expect(declared).toContain('widgets');
    },
  );

  it('the spec rejects `title` by name — the exclusion is checkable', () => {
    const result = specVerdict({ title: 'Legacy Ops' });
    expect(result.success, 'the spec now ACCEPTS dashboard.title — re-open objectui#5742').toBe(false);
    expect(unrecognizedKeys(result)).toContain('title');
  });

  it('the spec refuses every `aria` value — the tombstone is still standing', () => {
    const result = specVerdict({ aria: { ariaLabel: 'Ops' } });
    expect(result.success, 'the spec re-admitted dashboard.aria — re-open objectui#5742').toBe(false);
    const ariaIssue = (result as { error: { issues: Array<{ path: unknown[]; message: string }> } })
      .error.issues.find((i) => i.path.join('.') === 'aria');
    expect(ariaIssue, 'no issue at path `aria`').toBeTruthy();
    // The tombstone names the removal; a mere shape error would not.
    expect(ariaIssue!.message).toMatch(/removed/);
  });

  it.each(NON_AUTHOR)('$key draws unknown-prop from the real validator — the ruled outcome', ({ key, sample }) => {
    expect(
      codesMentioning({ [key]: sample }, key),
      `\`${key}\` no longer draws \`unknown-prop\`. If that is deliberate it means the key was`
        + ' declared — which the objectui#5742 triage forbids for this key.',
    ).toContain('unknown-prop');
  });
});

/**
 * REWRITTEN by objectui#7509 (maintainer ruling 2026-09-04, decision batch
 * #29). This block used to be headed "the legacy `title` read stays —
 * non-author surface, still honoured (objectui#5742)" and asserted that a wild
 * document carrying only the legacy spelling KEPT its header title. That arm
 * retired under ADR-0049, so the assertion is inverted rather than deleted: the
 * claim "what this renderer does with a wild `title`" belongs to this file, and
 * a file that simply dropped the case would leave the claim unmade.
 *
 * `title` stays out of the published `inputs` either way — that part of #5742
 * is untouched, and is asserted by the `NON_AUTHOR` rows above.
 */
describe('the legacy `title` read is RETIRED — unpublished AND unread (objectui#7509)', () => {
  const renderDashboard = (schema: Record<string, unknown>) =>
    render(
      <ActionProvider>
        <DashboardRenderer schema={{ type: 'dashboard', widgets: [], header: {}, ...schema } as never} />
      </ActionProvider>,
    );

  it('a wild document carrying only the legacy spelling gets NO header title', () => {
    renderDashboard({ title: 'Legacy Ops' });
    expect(screen.queryByRole('heading', { name: 'Legacy Ops' })).not.toBeInTheDocument();
  });

  it('a wild document carrying BOTH shows the `label` — the visible change the ruling names', () => {
    renderDashboard({ title: 'Legacy Ops', label: 'Canonical Ops' });
    expect(screen.getByRole('heading', { name: 'Canonical Ops' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Legacy Ops' })).not.toBeInTheDocument();
  });

  it('the canonical spelling renders — the control, without which the two above are vacuous', () => {
    renderDashboard({ label: 'Canonical Ops' });
    expect(screen.getByRole('heading', { name: 'Canonical Ops' })).toBeInTheDocument();
  });
});

describe('the published artifacts carry the change — same generators as gen-manifest (objectui#5742)', () => {
  it('the manifest entry publishes exactly the triaged input list', () => {
    // Exact list, not `toContain`: the failure mode both ways is silent — a
    // shrink un-publishes a key authors rely on, a growth publishes one the
    // triage ruled out.
    expect(manifest.components['dashboard'].inputs.map((i) => i.name)).toEqual([
      'widgets',
      'label',
      'description',
      'header',
      'globalFilters',
      'dateRange',
      'refreshIntervalSeconds',
      'columns',
      'gap',
      'className',
    ]);
  });

  it('the generated JSX intrinsics type the new keys, unions included', () => {
    const dts = generateDts(manifest);
    // `label` and `description` are `where-undeclared` base props, and
    // `className` an `every-node` one: each declared input outranks the base
    // one, so each is `Omit`ted (objectui#11044, objectui#11075).
    const match = dts.match(
      new RegExp(
        `export interface ${propsName('dashboard')} extends Omit<SduiBaseProps, "label" \\| "description" \\| "className"> \\{[^}]*\\}`,
      ),
    );
    expect(match, `no ${propsName('dashboard')} interface in the generated d.ts`).toBeTruthy();
    const block = match![0];
    expect(block).toContain('widgets?: unknown[];');
    expect(block).toContain('label?: string | Record<string, unknown>;');
    expect(block).toContain('description?: string | Record<string, unknown>;');
    expect(block).toContain('header?: Record<string, unknown>;');
    expect(block).toContain('globalFilters?: unknown[];');
    expect(block).toContain('dateRange?: Record<string, unknown>;');
    expect(block).toContain('refreshIntervalSeconds?: number;');
    // The exclusions stay out of the type surface an author compiles against.
    expect(block).not.toMatch(/\btitle\b/);
    expect(block).not.toMatch(/\baria\b/);
  });
});
