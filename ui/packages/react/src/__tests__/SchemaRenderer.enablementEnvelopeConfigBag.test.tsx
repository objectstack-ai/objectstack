/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9107 — the ENABLEMENT keys carry objectui#9100's defect, and this is
 * the sibling of `SchemaRenderer.predicateEnvelopeConfigBag.test.tsx`.
 *
 * ## The same two loops, a different chain
 *
 * `disabled` / `disabledOn` / `enabled` sit in the same per-value `properties` /
 * `props` loops objectui#9100 measured, and were handed to
 * `ExpressionEvaluator.evaluate`, whose FIRST action unwraps any
 * `{ source: string }` object down to its bare `source`. The envelope is the
 * only thing that routes `evaluateCondition` to the canonical
 * `@objectstack/formula` engine, so the flattened predicate took the legacy JS
 * path, where a CEL stdlib call is not a function.
 *
 * They are NOT a seventh visibility leg: they route through
 * `evaluateEnablementPredicate` (the node gate) and through the action
 * renderers' own `useCondition` call (the legacy `enabled` alias), which is why
 * objectui#9104's guard — restricted to the six visibility legs — did not cover
 * them.
 *
 * ## Both polarities, and this chain's are the OPPOSITE way round to the card's
 *
 * MEASURED on the pre-fix tree, through this component, `properties` top level:
 *
 *   | key          | predicate HOLDS | predicate FAILS | reading                |
 *   |--------------|-----------------|-----------------|------------------------|
 *   | `disabled`   | DISABLED        | DISABLED        | fail-CLOSED, never gated |
 *   | `disabledOn` | DISABLED        | DISABLED        | fail-CLOSED, never gated |
 *   | `enabled`    | enabled         | enabled         | fail-OPEN, never gated   |
 *
 * A pair of EQUAL verdicts is the signature of a gate that was never consulted,
 * whichever way it landed. The two halves land in opposite directions because
 * `evaluateCondition`'s fail-soft answer is `true` on every internal path, and
 * the renderers NEGATE the `enabled` leg (`disabled = !isEnabled`) while the
 * node gate does not negate `disabled` / `disabledOn`.
 *
 * ⇒ ⚠️ neither polarity alone detects this. A suite asserting only the DISABLED
 * case is green on the two broken `disabled` legs; a suite asserting only the
 * ENABLED case is green on the broken `enabled` leg. Every key below is pinned
 * in BOTH directions for that reason.
 *
 * ## Why the predicate carries a CEL stdlib call
 *
 * `has(…)` is the discriminator, not decoration: a predicate both engines can
 * evaluate cannot detect the routing, and a suite written with one would have
 * been green on the broken tree.
 *
 * ## Why every mount writes the key in the BAG, never on the node
 *
 * `SchemaRenderer.predicateEnvelopeDeclared.test.tsx` (objectui#7530) pins this
 * same envelope on `disabled` at NODE level and was green throughout
 * objectui#9100's entire lifetime — nothing runs over a node-level key, so that
 * channel could never observe this. The `properties` spelling is what a
 * published artifact and both `/api/v1/meta/*` endpoints emit. The node-level
 * mount appears below exactly once, labelled as a CONTROL: it is green on the
 * broken tree and on the fixed one, which is what isolates the defect to the
 * config-bag channel rather than to the predicate or the harness.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry, ExpressionEvaluator } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import { useCondition, toPredicateInput } from '../hooks/useExpression';
import { PredicateScopeProvider } from '../hooks/useExpression';

const DATA = { status: 'draft' };

/** CEL stdlib call + a comparison. `has` does not exist on the legacy engine. */
const HOLDS = { dialect: 'cel', source: 'has(data.status) && data.status == "draft"' };
const FAILS = { dialect: 'cel', source: 'has(data.status) && data.status == "published"' };
/** Not evaluable on EITHER engine — the fault direction, measured rather than assumed. */
const FAULTS = { dialect: 'cel', source: 'nope(((' };

/**
 * A control, in both senses of the word: a real `<button disabled>` whose
 * disabled state is reached by the two channels the three keys actually use.
 *
 *   * `disabled` / `disabledOn` — the node gate's verdict, which this component
 *     forwards as a real `disabled` React prop (`_disabled`).
 *   * `enabled` — read off the schema and NEGATED, which is byte-for-byte what
 *     `action:button` / `action:icon` do one layer down
 *     (`toPredicateInput(schema.enabled)` -> `useCondition` -> `!isEnabled`).
 *     The node gate never consults this key, so the renderer leg is the only
 *     place its verdict can be observed at all.
 *
 * ⚠️ This probe does NOT re-spread the `disabled` prop it is handed over its own
 * answer, and the two real renderers do — they compute `disabled` before
 * `{...toFormControlDomProps(rest)}`, and `SchemaRenderer` always forwards a
 * `disabled` key (`__disabled || undefined`), so the legacy leg's verdict is
 * overwritten before it reaches the DOM on that mount path. Measured, and
 * PRE-EXISTING: a plain literal `enabled: false` — no envelope, no CEL, no
 * config bag — is disabled on a direct mount and NOT disabled through
 * `SchemaRenderer`. That is objectui#7238's mechanism left behind in the two
 * action renderers, a different defect from this card, filed separately and ⛔
 * not repaired here. The probe deliberately reads the key the way those
 * renderers read it and stops there, so this file measures the envelope's
 * survival rather than that unrelated seam.
 */
const Probe = (props: { schema?: Record<string, unknown>; disabled?: boolean }) => {
  const schema = props.schema ?? {};
  const isEnabled = useCondition(toPredicateInput(schema.enabled) as never, { data: DATA });
  const gatedByLegacyLeg = schema.enabled !== undefined && !isEnabled;
  return (
    <button
      data-testid="probe"
      // What the `props`-bag value still IS by the time a renderer reads it.
      // `@object-ui/components`' `readProps` merges `{ ...schema.props,
      // ...schema.properties }`, so that bag is a real consumer surface even
      // though the node gate never consults it (objectui#9108, not repaired
      // here).
      data-props-kind={JSON.stringify(
        Object.fromEntries(
          Object.entries((schema.props ?? {}) as Record<string, unknown>).map(([k, v]) => [
            k,
            v && typeof v === 'object' ? `envelope:${String((v as { dialect?: unknown }).dialect)}` : typeof v,
          ]),
        ),
      )}
      disabled={Boolean(props.disabled) || gatedByLegacyLeg}
    />
  );
};

function mount(schema: unknown) {
  return render(
    <PredicateScopeProvider scope={{ data: DATA }}>
        <SchemaRendererContext.Provider value={{ dataSource: DATA } as never}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererContext.Provider>
      </PredicateScopeProvider>,
  );
}

/** Is the rendered control disabled? Throws rather than answering for a control that never rendered. */
function isDisabled(): boolean {
  return (screen.getByTestId('probe') as HTMLButtonElement).disabled;
}

/** Mount one bag twice — holding and failing — and report the pair. */
function pair(key: string, bag: 'properties' | 'props' = 'properties') {
  const holds = (() => {
    mount({ type: 'probe-9107', [bag]: { [key]: HOLDS } });
    const r = isDisabled();
    cleanup();
    return r;
  })();
  const fails = (() => {
    mount({ type: 'probe-9107', [bag]: { [key]: FAILS } });
    const r = isDisabled();
    cleanup();
    return r;
  })();
  return { holds, fails };
}

function useProbe() {
  beforeEach(() => {
    ComponentRegistry.register('probe-9107', Probe as never);
  });
  afterEach(() => {
    cleanup();
    ComponentRegistry.unregister?.('probe-9107');
  });
}

describe('#9107 — a CEL envelope on an enablement key reaches the CEL engine', () => {
  useProbe();

  // The node-gate legs. `true` means DISABLED and is NOT negated, so the
  // pre-fix fail-soft `true` left BOTH rows disabled: the `fails: false` half
  // of this assertion is the one that was red on the broken tree.
  it.each(['disabled', 'disabledOn'])(
    'properties.%s (node gate): holds disables, fails leaves the control usable',
    (key) => {
      expect(pair(key)).toEqual({ holds: true, fails: false });
    },
  );

  // The legacy renderer leg. It is NEGATED, so the pre-fix fail-soft `true`
  // left BOTH rows ENABLED: here the `fails: true` half is the one that was red
  // on the broken tree — the user pressing a button the author disabled.
  it('properties.enabled (legacy renderer leg): holds leaves it usable, fails disables', () => {
    expect(pair('enabled')).toEqual({ holds: false, fails: true });
  });

  /**
   * CONTROL — ⛔ not a detector. This is the one channel objectui#7530 measured
   * and the reason this card exists: it is green on the broken tree AND on the
   * fixed one. Its job is to prove the predicates, the engines and this harness
   * are right, so a red row above can only mean the config-bag channel.
   */
  it.each(['disabled', 'enabled'])(
    'CONTROL — the same envelope written at NODE level already decided, before and after',
    (key) => {
      mount({ type: 'probe-9107', [key]: HOLDS });
      const holds = isDisabled();
      cleanup();
      mount({ type: 'probe-9107', [key]: FAILS });
      const fails = isDisabled();
      // `disabled` holds -> disabled; `enabled` holds -> usable. Both gate.
      expect({ holds, fails }).toEqual(key === 'disabled' ? { holds: true, fails: false } : { holds: false, fails: true });
    },
  );

  /**
   * The `props` alias gets the SAME guard, and it has to: objectui#5123 ruled
   * "one answer per key, whichever channel reads it". What that bag CANNOT do
   * is drive the node gate — the hoist copies `properties` onto the node and
   * nothing copies `props` (objectui#9108, filed separately, ⛔ not repaired
   * here) — so the assertion is on the value a renderer receives, not on a
   * verdict.
   */
  it.each(['disabled', 'disabledOn', 'enabled'])(
    'props.%s keeps its envelope for the renderer that reads that bag',
    (key) => {
      mount({ type: 'probe-9107', props: { [key]: HOLDS } });
      expect(JSON.parse(screen.getByTestId('probe').getAttribute('data-props-kind') as string)).toEqual({
        [key]: 'envelope:cel',
      });
    },
  );
});

/**
 * objectui#9107's ⭐ stop condition, measured rather than assumed: can a
 * repaired gate leave a control permanently unreachable with no authored
 * recourse?
 *
 * ⇒ No, and the direction of travel is the opposite of the one feared. The
 * fault VERDICT is byte-for-byte unchanged by this card — `evaluateCondition`
 * still fails soft to `true` — so what moves is only WHICH predicates fault.
 * Before this change EVERY CEL-authored `disabled` gate faulted (the flattened
 * source is not evaluable on the legacy engine), so it disabled its control on
 * every row and no predicate the author could write would re-enable it. After
 * it, only a genuinely unevaluable CEL source does, and a well-formed one
 * decides — which is authored recourse where there was none.
 */
describe('#9107 — what a FAULTING enablement predicate does after the fix', () => {
  useProbe();

  it('a faulting predicate still fails soft, in each leg\'s own direction', () => {
    mount({ type: 'probe-9107', properties: { disabled: FAULTS } });
    // Un-negated leg: fail-soft `true` disables. Unchanged by this card.
    expect(isDisabled()).toBe(true);
    cleanup();
    mount({ type: 'probe-9107', properties: { enabled: FAULTS } });
    // Negated leg: the same `true` arrives as "not disabled". Unchanged too.
    expect(isDisabled()).toBe(false);
  });

  it('and the recourse is real: a well-formed predicate re-enables the control', () => {
    mount({ type: 'probe-9107', properties: { disabled: FAULTS } });
    expect(isDisabled()).toBe(true);
    cleanup();
    // The same key, the same channel, a predicate the CEL engine can answer.
    mount({ type: 'probe-9107', properties: { disabled: FAILS } });
    expect(isDisabled()).toBe(false);
  });
});

describe('#9107 — what the widened guard deliberately does NOT change', () => {
  useProbe();

  it('a TEMPLATE envelope on an enablement key still interpolates on the legacy path', () => {
    // Only the `cel` dialect is held back. Widening this to "any envelope"
    // would silently retire the template spelling.
    mount({ type: 'probe-9107', properties: { disabled: { dialect: 'template', source: '${data.status === "draft"}' } } });
    expect(isDisabled()).toBe(true);
    cleanup();
    mount({ type: 'probe-9107', properties: { disabled: { dialect: 'template', source: '${data.status === "published"}' } } });
    expect(isDisabled()).toBe(false);
  });

  it('a NON-predicate bag key still has its envelope flattened as before', () => {
    // The guard is keyed on the two predicate chains, not on the envelope
    // alone, so `content` / `title` / … keep the behaviour they have always had.
    const ev = new ExpressionEvaluator({ data: DATA });
    expect(ev.evaluate({ dialect: 'cel', source: 'data.status' } as never)).toBe('data.status');
  });

  it('the loops are SHALLOW, so an enablement envelope nested in an array is passed through', () => {
    // An action's own `disabled` sits inside `actions[]`, one level down.
    // `evaluate` returns a non-string untouched and nothing walks into it,
    // which is why the action path never carried this defect.
    const ev = new ExpressionEvaluator({ data: DATA });
    const nested = [{ name: 'a', disabled: HOLDS, enabled: HOLDS }];
    expect(ev.evaluate(nested as never)).toEqual(nested);
  });

  /**
   * The ONE stated consequence, pinned so it cannot drift silently.
   *
   * Eight of the nine guarded keys are stripped by the metadata destructure
   * before `createElement`. The legacy `enabled` alias is not — the action
   * renderers read it off the schema, not off React props — so on a renderer
   * that spreads what it is handed onto a DOM node the attribute changes
   * spelling: raw CEL source text before, `[object Object]` after. Both are
   * inert, neither warns, and the same `[object Object]` is already what the
   * `properties` bag itself puts on such a node. Pre-existing leak, ⛔ not
   * repaired here.
   */
  it('the unstripped `enabled` alias reaches a spreading renderer as the envelope', () => {
    const Spreader = ({ schema: _schema, ...rest }: Record<string, unknown>) => (
      <div data-testid="spread" {...(rest as Record<string, never>)} />
    );
    ComponentRegistry.register('probe-9107-spread', Spreader as never);
    try {
      mount({ type: 'probe-9107-spread', properties: { enabled: HOLDS } });
      expect(screen.getByTestId('spread').getAttribute('enabled')).toBe('[object Object]');
    } finally {
      ComponentRegistry.unregister?.('probe-9107-spread');
    }
  });
});
