/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * objectui#9100 — a `record:alert` `properties.visible` authored as the CEL
 * ENVELOPE must reach the CEL engine, not the legacy JS one
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Found from the consumer side (hotcrm#1887) and measured in a real browser
 * against a real app instance: a duplicate-lead banner gated on
 * `has(record.duplicate_status) && record.duplicate_status == "confirmed"`,
 * authored in the declared `{ dialect: 'cel', source }` envelope, rendered on
 * SIX of six leads whose `duplicate_status` was `null`. The gate never bit in
 * either direction.
 *
 * ## Why this file mounts the RENDERER and not the normalizer
 *
 * The fault was never in `toPredicateInput` — that function preserves a `cel`
 * envelope, and the ACTION path that works calls the very same function. It
 * was in the wiring: `SchemaRenderer`'s per-value `properties` / `props`
 * evaluation loop handed every bag value to `ExpressionEvaluator.evaluate`,
 * which unwraps ANY `{ source }` object to its bare `source` string before it
 * does anything else. So the envelope was already gone by the time the
 * renderer — or `SchemaRenderer`'s own `shouldHide` chain — could route on it.
 *
 * A test that asserts on the normalizer's RETURN VALUE therefore cannot fail
 * on this defect: it passed throughout. Only a mount through the real
 * `SchemaRenderer` exercises renderer → `toPredicateInput` → `useCondition` →
 * `evaluateCondition` end to end, which is what every case below does.
 *
 * ## Why the assertions are on the HIDDEN case
 *
 * `evaluateCondition` is fail-soft here (`record-alert.tsx` does not pass
 * `throwOnError`), so a predicate that CANNOT be evaluated renders the banner
 * — identically to one that said yes. A suite that only checked the shown
 * case could not fail on this card. Every group below therefore pins a pair
 * of OPPOSITE verdicts across two rows that differ in one field; a pair of
 * EQUAL verdicts is the signature of a gate that was never consulted,
 * whichever way it landed.
 *
 * ## The ablation arm, and why both arms are pinned
 *
 * The card isolated the fault with an ablation: the same gate respelled as a
 * BARE string with no CEL stdlib call started biting correctly, while the
 * sibling left in the envelope stayed wrongly shown IN THE SAME RUN. That
 * asymmetry is what proved the legacy engine does bind `record` and that only
 * the stdlib was missing — i.e. the fault is envelope ROUTING, not scope
 * binding. Group C reproduces it in-process. Both arms are pinned so a future
 * regression cannot pass by repairing one of them.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, type RenderResult } from '@testing-library/react';
import { RecordContextProvider, SchemaRenderer, PredicateScopeProvider } from '@object-ui/react';
import '../../index';

/**
 * The ambient scope app-shell actually mounts on a record page, reproduced
 * from `packages/app-shell/src/providers/ExpressionProvider.tsx`. Carries no
 * `record` — the row arrives through `RecordContextProvider` — and DOES carry
 * an unrelated `data: {}`, both properties of production.
 */
const APP_SCOPE = {
  current_user: { id: 'u1', name: 'Ada' },
  user: { id: 'u1' },
  data: {},
  features: {},
};

const TITLE = 'This lead is a confirmed duplicate';

/** The `P` tagged-template form, as `@objectstack/spec` normalizes it. */
const cel = (source: string) => ({ dialect: 'cel', source });

/**
 * The card's own predicate, verbatim. `has()` is CEL stdlib and does not
 * exist on the legacy JS engine, so this exact source is what turns a routing
 * mistake into a thrown predicate and a fail-soft SHOWN.
 */
const ENVELOPE_SRC = 'has(record.duplicate_status) && record.duplicate_status == "confirmed"';

/** The card's ablation: same gate, no stdlib call, bare (non-envelope) string. */
const BARE_SRC = 'record.duplicate_status == "confirmed"';

const CONFIRMED = { id: 'l1', duplicate_status: 'confirmed' };
const SUSPECTED = { id: 'l2', duplicate_status: 'suspected' };
/** All 21 leads in the instance the card measured carried `null` here. */
const UNSET = { id: 'l3', duplicate_status: null };

function mount(visible: unknown, record: Record<string, unknown>): RenderResult {
  return render(
    <PredicateScopeProvider scope={APP_SCOPE}>
      <RecordContextProvider objectName="crm_lead" recordId={String(record.id)} data={record}>
        <SchemaRenderer
          schema={{ type: 'record:alert', properties: { title: TITLE, visible } } as never}
        />
      </RecordContextProvider>
    </PredicateScopeProvider>,
  );
}

/** What the USER sees — never a computed style, never a predicate's return value. */
const bannerInDocument = (r: RenderResult) => r.queryByText(TITLE) !== null;

/** Mount one predicate against all three rows and report the verdicts together. */
function verdicts(visible: unknown): Record<string, boolean> {
  const onConfirmed = bannerInDocument(mount(visible, CONFIRMED));
  cleanup();
  const onSuspected = bannerInDocument(mount(visible, SUSPECTED));
  cleanup();
  const onUnset = bannerInDocument(mount(visible, UNSET));
  cleanup();
  return { onConfirmed, onSuspected, onUnset };
}

afterEach(() => cleanup());

describe('#9100 group A — controls: the harness paints the banner, and this channel can hide it', () => {
  // Without these, a `false` below would read "never rendered", not "the gate
  // said no": this renderer has four separate `return null` paths.
  it('with no predicate declared the banner is on screen for every row', () => {
    expect(verdicts(undefined)).toEqual({ onConfirmed: true, onSuspected: true, onUnset: true });
  });

  it('a constant CEL envelope decides it in both directions', () => {
    // Same key, same tier, same mount as the real predicate — so a hidden
    // verdict in group B is this channel answering, not an inert surface.
    expect(verdicts(cel('false'))).toEqual({ onConfirmed: false, onSuspected: false, onUnset: false });
    expect(verdicts(cel('true'))).toEqual({ onConfirmed: true, onSuspected: true, onUnset: true });
  });
});

describe('#9100 group B — the CEL envelope reaches the CEL engine and the gate bites', () => {
  it('`has()` resolves, so the banner is SHOWN only on the confirmed row', () => {
    // Before the fix this read `{ true, true, true }`: the envelope was
    // flattened to a bare string upstream, `has` was not a function on the
    // legacy engine, the predicate threw, and fail-soft rendered the banner.
    expect(verdicts(cel(ENVELOPE_SRC))).toEqual({
      onConfirmed: true,
      onSuspected: false,
      onUnset: false,
    });
  });

  it('the row with the field ABSENT entirely is hidden, not shown', () => {
    // `has()` exists precisely so an absent column is a clean `false` rather
    // than the strict-CEL `No such key` abort that `driver-memory` /
    // `driver-mongodb` raise — the reason the card refuses the bare-string
    // respelling as a consumer workaround.
    const r = mount(cel(ENVELOPE_SRC), { id: 'l4' });
    expect(bannerInDocument(r)).toBe(false);
  });
});

describe('#9100 group C — the card ablation, pinned as the other arm', () => {
  it('a BARE string with no stdlib call also gates correctly', () => {
    // This arm passed before the fix too. It is pinned so the pair cannot be
    // repaired by regressing the envelope arm back onto the legacy engine —
    // and so the asymmetry that isolated the fault stays visible.
    expect(verdicts(BARE_SRC)).toEqual({
      onConfirmed: true,
      onSuspected: false,
      onUnset: false,
    });
  });

  it('the two arms agree on every row — the inversion the card measured is gone', () => {
    expect(verdicts(cel(ENVELOPE_SRC))).toEqual(verdicts(BARE_SRC));
  });
});
