/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ACCEPTANCE BASELINE for objectui#5454 — carried forward from objectui#5401.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * This file began life on `claude/issue-5401-record-alert-visiblewhen` as a
 * MEASUREMENT harness: it recorded what the shipped pipeline did, including
 * four verdicts marked `[DEFECT]` that pinned the bug rather than the desired
 * behaviour. The maintainer ruling of 2026-08-21 on objectui#5454 fixed that
 * bug, and named this file the acceptance baseline: *"the bold SHOWN/SHOWN
 * rows must become polarity-correct"*.
 *
 * So the pin sweep landed here in two halves, and BOTH halves matter:
 *
 *   • groups 2 and 4 asserted the OLD inert behaviour. They are FLIPPED to
 *     assert the new semantics. Measured before flipping — the unmodified
 *     harness run against the fixed renderer went red on exactly three
 *     assertions, all three of them `[DEFECT]`-marked, and on nothing else.
 *   • groups 1 and 3 assert behaviour that was correct all along. They are
 *     KEPT VERBATIM — not one character changed, so `git diff` on this file is
 *     itself the evidence that nothing was "fixed" by deleting the pin that
 *     was in the way. Group 3 is the load-bearing one: it is the assertion
 *     that `properties.visible` comes out of objectui#5454 with its verdicts
 *     unchanged, on both polarities, which is what makes the change additive
 *     rather than a migration.
 *
 * What the four groups now record:
 *
 *   Group 1 — `record:alert` honours node-level `visibleWhen` for constant and
 *             `current_user` predicates, identically to `record:path`. True
 *             before objectui#5454 and true after; this was never the defect,
 *             which is what objectui#5401's roll-back established.
 *
 *   Group 2 — node-level `visibleWhen` now BINDS `record`, on every block. The
 *             evaluator used to be built from the ambient predicate scope plus
 *             `data: dataSource` (the connector ADAPTER) and
 *             `page: pageVariables`, with no `record` in any of them — so a
 *             `record.*` predicate could not resolve, the surface is fail-soft,
 *             and the block stayed VISIBLE whatever the row said.
 *
 *   Group 3 — `properties.visible` binds `record` on both polarities. Untouched.
 *
 *   Group 4 — a declared node `visibleWhen` now OUTRANKS a hoisted
 *             `properties.visible`. The hoist copies `properties.*` onto the
 *             node, and the chain used to test `visible` first, so the one key
 *             the spec tells authors to write was the one key that could be
 *             silently ignored.
 *
 * Every "hidden" verdict below is PAIRED with a "shown" mount of the same
 * schema, because this renderer has three other `return null` paths (dismissed,
 * empty record, and the props gate). Without the pair, "nothing rendered" does
 * not mean "the gate said no". Anything added here keeps that discipline.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { RecordContextProvider, SchemaRenderer, PredicateScopeProvider } from '@object-ui/react';
import '../../index';

/**
 * The ambient scope app-shell actually mounts on a record page
 * (`providers/ExpressionProvider.tsx` — `data` is `{}` at both of its two call
 * sites, and the `SchemaRendererProvider` `dataSource` is the connector
 * adapter). Reproduced verbatim so the absence of `record` is a property of the
 * fixture that matches production, not an omission in the test.
 */
const APP_SCOPE = {
  current_user: { id: 'u1', name: 'Ada', email_verified: true },
  user: { id: 'u1', email_verified: true },
  ctx: { user: { id: 'u1' } },
  os: { user: { id: 'u1' } },
  data: {},
  features: { multiOrgEnabled: true },
};

const IN_REVIEW = { id: 'r1', status: 'in_review' };
const DONE = { id: 'r1', status: 'done' };
const TITLE = 'Awaiting review';

const cel = (source: string) => ({ dialect: 'cel', source });

function mount(node: unknown, record: Record<string, unknown>) {
  return render(
    <PredicateScopeProvider scope={APP_SCOPE}>
      <RecordContextProvider objectName="showcase_task" recordId="r1" data={record}>
        <SchemaRenderer schema={node as never} />
      </RecordContextProvider>
    </PredicateScopeProvider>,
  );
}

const alertShown = (c: HTMLElement) => (c.textContent || '').includes(TITLE);
const pathShown = (c: HTMLElement) => c.innerHTML.length > 0;

const ALERT = { type: 'record:alert', properties: { title: TITLE } };
const PATH = {
  type: 'record:path',
  properties: {
    statusField: 'status',
    stages: [
      { value: 'in_review', label: 'In Review' },
      { value: 'done', label: 'Done' },
    ],
  },
};

afterEach(() => cleanup());

describe('#5401 group 1 — record:alert ALREADY honours node-level `visibleWhen`', () => {
  it('a constant-false `visibleWhen` hides the banner; the same schema without it renders', () => {
    expect(alertShown(mount({ ...ALERT, visibleWhen: cel('false') }, DONE).container)).toBe(false);
    cleanup();
    // The pair. Without it, `false` above could equally mean "never rendered".
    expect(alertShown(mount(ALERT, DONE).container)).toBe(true);
  });

  it('a `current_user` predicate keeps its verdict on BOTH polarities', () => {
    // `current_user.email_verified` is `true` in APP_SCOPE.
    expect(
      alertShown(mount({ ...ALERT, visibleWhen: cel('current_user.email_verified == false') }, DONE).container),
    ).toBe(false);
    cleanup();
    expect(
      alertShown(mount({ ...ALERT, visibleWhen: cel('current_user.email_verified == true') }, DONE).container),
    ).toBe(true);
  });

  it('`record:path` — the sibling the card calls "honoured" — behaves identically', () => {
    expect(pathShown(mount({ ...PATH, visibleWhen: cel('false') }, DONE).container)).toBe(false);
    cleanup();
    expect(pathShown(mount(PATH, DONE).container)).toBe(true);
  });
});

describe('#5454 group 2 — node-level `visibleWhen` BINDS `record`, on every block', () => {
  it('a `record.*` predicate on record:alert reaches opposite verdicts on the two rows', () => {
    // Was `[DEFECT]`: both mounts rendered, because the predicate could not
    // resolve and this surface fails soft to visible. The two mounts differ
    // only in the row, so a difference here IS the binding.
    expect(
      alertShown(mount({ ...ALERT, visibleWhen: cel("record.status == 'in_review'") }, DONE).container),
    ).toBe(false);
    cleanup();
    expect(
      alertShown(mount({ ...ALERT, visibleWhen: cel("record.status == 'in_review'") }, IN_REVIEW).container),
    ).toBe(true);
  });

  it('record:path binds it too — this was never a record:alert defect, and the fix is not one either', () => {
    expect(pathShown(mount({ ...PATH, visibleWhen: cel("record.status == 'done'") }, DONE).container)).toBe(true);
    cleanup();
    expect(pathShown(mount({ ...PATH, visibleWhen: cel("record.status == 'zzz'") }, DONE).container)).toBe(false);
    cleanup();
    // Counter-probe retained from the measurement harness: this block CAN be
    // hidden through this channel, so the `true` above is a verdict and not an
    // inability to hide.
    expect(pathShown(mount({ ...PATH, visibleWhen: cel('false') }, DONE).container)).toBe(false);
  });
});

describe('#5401 group 3 — `properties.visible` DOES bind `record`, both polarities', () => {
  it('the showcase node, verbatim, gates correctly on the record', () => {
    // examples/app-showcase/src/ui/pages/task-detail.page.ts, unmodified.
    const showcase = {
      type: 'record:alert',
      properties: {
        severity: 'warning',
        icon: 'eye',
        title: TITLE,
        body: 'This task is in review — confirm the work before marking it done.',
        visible: "record.status == 'in_review'",
        dismissible: true,
      },
    };
    expect(alertShown(mount(showcase, IN_REVIEW).container)).toBe(true);
    cleanup();
    expect(alertShown(mount(showcase, DONE).container)).toBe(false);
  });
});

describe('#5454 group 4 — a declared `visibleWhen` outranks a hoisted `properties.visible`', () => {
  it('a co-declared `properties.visible` no longer short-circuits it, on any block type', () => {
    // `SchemaRenderer` hoists `properties.visible` onto `schema.visible`. The
    // chain used to test `visible` BEFORE `visibleWhen`, so the node gate was
    // never consulted — which is what objectui#5401 observed in a browser as
    // "adding visibleWhen to record:alert does nothing", and it was generic to
    // every block rather than a property of this renderer.
    const withBoth = (type: string, extra: Record<string, unknown>) => ({
      type,
      properties: { visible: 'true', ...extra },
      visibleWhen: cel('false'),
    });
    expect(alertShown(mount(withBoth('record:alert', { title: TITLE }), DONE).container)).toBe(false);
    cleanup();
    expect(pathShown(mount(withBoth('record:path', PATH.properties), DONE).container)).toBe(false);
    cleanup();
    // The other direction, so "always hide when both are present" passes
    // nothing: the node gate DECIDES, it does not merely veto. Demonstrated on
    // `record:path`, which reads no `visible` prop of its own.
    const pathFlipped = {
      ...PATH,
      properties: { ...PATH.properties, visible: 'false' },
      visibleWhen: cel('true'),
    };
    expect(pathShown(mount(pathFlipped, DONE).container)).toBe(true);
    cleanup();
    // And the paired control kept from the harness: with no `properties.visible`
    // at all, the node gate still bites.
    expect(alertShown(mount({ ...ALERT, visibleWhen: cel('false') }, DONE).container)).toBe(false);
  });

  it('on record:alert the two gates compose as AND, because this renderer reads `visible` ITSELF', () => {
    // Measured while flipping this file: the same `properties.visible: false`
    // that `record:path` ignores still hides `record:alert`, whatever the node
    // gate says — `record-alert.tsx` evaluates `props.visible` through its own
    // `useCondition` + `usePredicateRecordContext` and returns null on false,
    // one layer BELOW the chain in `SchemaRenderer`.
    //
    // So objectui#5454 gave the node gate a vote it did not have; it did not
    // take the props gate's vote away. Pinned because the asymmetry between the
    // two blocks is otherwise invisible and reads as a bug in whichever one you
    // look at second.
    const bothFalseProp = {
      ...ALERT,
      properties: { ...ALERT.properties, visible: 'false' },
      visibleWhen: cel('true'),
    };
    expect(alertShown(mount(bothFalseProp, DONE).container)).toBe(false);
    cleanup();
    // The pair: same node, props gate open — now the node gate's `true` shows it.
    const bothOpen = {
      ...ALERT,
      properties: { ...ALERT.properties, visible: 'true' },
      visibleWhen: cel('true'),
    };
    expect(alertShown(mount(bothOpen, DONE).container)).toBe(true);
  });
});
