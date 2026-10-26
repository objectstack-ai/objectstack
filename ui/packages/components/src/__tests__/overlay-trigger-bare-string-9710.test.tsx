/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9710 — the CLASS pin for a Radix `*Trigger` fed an authored
 * `trigger` node slot. objectui#9701 repaired one instance (`collapsible`);
 * this file is what keeps the tenth key from repeating it, and triage asked for
 * exactly that: 「任一 `asChild` trigger 收到裸字符串即红」.
 *
 * ## Why this file enumerates the REGISTRY and never a list of files
 *
 * A pin that names the eight renderers this card repaired is green forever on
 * the ninth — it re-asserts the diff that was already written instead of
 * guarding the class. So the population here is derived at run time: every
 * block in the registry that DECLARES a `trigger` slot in its `inputs`. A key
 * added tomorrow is covered on the day it registers one, in whatever file and
 * whatever spelling, and a key deleted stops being asserted with no edit here.
 * ⛔ No count is written down anywhere in this file (AGENTS.md #9) — the
 * enumeration is the instrument, and the readings are whatever it enumerates.
 *
 * ⭐ This file is now the ONLY live instrument for the class. A repaired call
 * site carries no `asChild` attribute and no `*Trigger` tag of its own, so the
 * source-grep recipe published on the card can no longer tell a repaired
 * renderer from a deleted one.
 *
 * ⚠️ Named limit: the enumeration sees what `../renderers` registered. A block
 * in a `plugin-*` package registering its own `trigger` slot is NOT covered
 * here and would need the same reading in its own package. Measured, not
 * assumed: no such block exists today.
 *
 * ## The two arms, which are NOT the same mismatch
 *
 * They were reported as one in this card's first delivery, and that was wrong
 * in a way that hid a regression, so they are separated here by construction.
 *
 *  - **Non-empty, not a single element** — a bare string, a number, a
 *    multi-node array. `asChild` resolves the primitive to Radix's `Slot`,
 *    which merges onto a single React element and THROWS on anything else it is
 *    given. Both published faces admit these (`SchemaNode` names `string`
 *    explicitly and the zod mirror types each `trigger` key against that same
 *    union), so `trigger: 'Open it'` validated twice and then painted
 *    `SchemaRenderer`'s error boundary. THIS is the defect objectui#9710 filed.
 *  - **Empty** — omitted, `null`, `''`, `0`, `[]`. Read from the
 *    lockfile-pinned `@radix-ui/react-slot`, the throwing branch is guarded by
 *    `if (children || children === 0)`, so a `null` child is returned as-is and
 *    NEVER threw. This arm was never broken — and the first repair broke it,
 *    turning "no trigger at all" into one empty focusable button on every key
 *    whose zod face makes `trigger` optional. `OMITTED_TRIGGER_PAINTS_NOTHING`
 *    below is that arm, pinned so it cannot be broken silently again.
 *
 * ## Controls — a green here is worthless without them
 *
 *  - `ENUMERATION_CONNECTED` — the population is non-empty and contains blocks
 *    this card did NOT touch (`collapsible`, repaired earlier and living in
 *    `renderers/disclosure/`; `context-menu`, which was never defective because
 *    its `asChild` child is a real `div`). A pin covering only this PR's own
 *    eight files would fail this control, which is the failure mode the file
 *    exists to avoid.
 *  - `ZOD_FACES_READ` — the optional/required split used by the omitted-trigger
 *    arm is derived from the published zod faces at run time, and is asserted
 *    to DISCRIMINATE (at least one of each). A derivation that silently
 *    returned nothing would make that arm vacuous, which is the one way this
 *    file could go quietly green while broken.
 *  - `ASCHILD_STILL_ON` — an ELEMENT trigger is still MERGED onto the Radix
 *    trigger rather than wrapped by it. This is what makes the repair targeted
 *    rather than a blanket `asChild` removal: withheld only where Radix
 *    structurally cannot serve.
 *  - `OVER_REACH_IS_VISIBLE` — the control above is observed CATCHING an
 *    over-reach, on a block registered inside the test that withholds `asChild`
 *    where Radix could have served. Without it, "the detector is strong" is a
 *    claim about an assertion nobody has seen go red — and one version of that
 *    detector silently saw only one of this card's eight renderers.
 *  - `REDDENS_FOR_A_NINTH` — a deliberately defective block is registered
 *    inside the test, and THE assertion above (the errored-out list is empty)
 *    is observed holding exactly that block's name. Without this, "the pin
 *    covers a ninth renderer" would be a claim about an assertion that has
 *    never once been observed failing.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';
import * as zodFaces from '@object-ui/types/zod';
import { Popover, PopoverContent, PopoverTrigger } from '../ui';
import { renderChildren } from '../lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
 * Harness
 * ───────────────────────────────────────────────────────────────────────── */

const BARE_STRING = 'Open it';
const ELEMENT_LABEL = 'Toggle';

/** The marker `SchemaRenderer`'s error boundary paints when a node throws. */
const ERROR_BOUNDARY_MARKER = 'failed to render';

/** Everything a keyboard user can land on. */
const FOCUSABLE =
  'button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

/**
 * The attributes Radix stamps on the trigger element it OWNS. Used to tell
 * "merged onto the authored element" from "wrapped by the primitive's own".
 */
const RADIX_TRIGGER_WIRING = '[data-state],[aria-haspopup],[aria-expanded]';

/**
 * The elements a Radix trigger draws when `asChild` is NOT in play — `button`
 * for most, an anchor for `HoverCardTrigger`, a span for `ContextMenuTrigger`
 * (read from the installed Radix dists).
 *
 * ⚠️ The named limit of this control: a RENDERER that authors its own wrapper
 * in one of these tags would read as over-reach. `div` is excluded for exactly
 * that reason — `context-menu` authors a `div` around its slot and the
 * primitive merges onto it, which is correct and must not trip this.
 */
const RADIX_DRAWN_TRIGGER_TAGS = new Set(['BUTTON', 'A', 'SPAN']);

interface TriggerBlock {
  /** The registry's canonical (namespaced) type, e.g. `ui:dialog`. */
  type: string;
  /** The same type with its namespace stripped, as the zod faces spell it. */
  bare: string;
}

/**
 * The population: every registered block declaring a `trigger` SLOT.
 *
 * The registry stores each block under both its bare and its namespaced key
 * pointing at one config, so dedupe by the canonical `type` the config itself
 * carries rather than by the map key.
 */
function triggerBlocks(): TriggerBlock[] {
  const byType = new Map<string, TriggerBlock>();
  for (const config of ComponentRegistry.getAllConfigs()) {
    const inputs = config.inputs ?? [];
    const declaresTriggerSlot = inputs.some(
      (input) => input?.name === 'trigger' && input?.type === 'slot',
    );
    if (!declaresTriggerSlot) continue;
    if (byType.has(config.type)) continue;
    byType.set(config.type, {
      type: config.type,
      bare: config.type.includes(':')
        ? config.type.slice(config.type.indexOf(':') + 1)
        : config.type,
    });
  }
  return [...byType.values()].sort((a, b) => a.type.localeCompare(b.type));
}

/**
 * Which block types may LEGALLY omit their trigger, read from the published zod
 * faces rather than written down here.
 *
 * Every overlay face is a `z.object` carrying a `type` literal and, where it
 * has one, a `trigger` key — so the declaration itself says which documents are
 * legal, and a key that changes its mind is followed with no edit to this file.
 *
 * ⛔ NOT `shape.trigger.isOptional()`, which is a DEAD instrument on these
 * keys: `SchemaNodeSchema` itself admits `undefined` (the published
 * `SchemaNode` union names it), so `isOptional()` answers `true` for every
 * trigger key including the ones carrying no `.optional()` at all. Measured:
 * it cannot separate `dialog` from `popover`, and a population derived from it
 * would be "all of them", which is how this arm would go quietly vacuous.
 *
 * ⛔ NOT a whole-object `safeParse` without the key either: that is confounded
 * by the face's OTHER required keys, and reads `context-menu` as refusing a
 * trigger-less document when its own `describe` says such documents are legal.
 *
 * The `.optional()` WRAPPER is the operative fact — in this zod, a missing key
 * is admitted when and only when the field carries it, whatever the field's
 * own type accepts.
 */
function triggerOptionalByType(): Map<string, boolean> {
  const optional = new Map<string, boolean>();
  for (const face of Object.values(zodFaces as Record<string, unknown>)) {
    const shape = (face as { shape?: Record<string, unknown> })?.shape;
    if (!shape?.type || !shape?.trigger) continue;
    const literal = (shape.type as { value?: unknown }).value;
    if (typeof literal !== 'string') continue;
    const trigger = shape.trigger as {
      def?: { type?: string };
      _def?: { typeName?: string };
    };
    optional.set(
      literal,
      trigger.def?.type === 'optional' ||
        trigger._def?.typeName === 'ZodOptional',
    );
  }
  return optional;
}

interface Reading {
  /** Whether the node reached the error boundary instead of painting. */
  erroredOut: boolean;
  /** Everything the block painted. */
  text: string;
  /** How many `button` elements the block produced. */
  buttons: number;
  /** How many elements a keyboard user can land on. */
  focusable: number;
  /**
   * The authored element is WRAPPED by the primitive rather than merged onto.
   *
   * ⛔ Not a `button button` selector: `HoverCardTrigger` draws an anchor and
   * `ContextMenuTrigger` a span, so a nested-button test cannot see over-reach
   * on either. The general fact is that Radix stamps its wiring on whatever
   * element it owns — merged, the authored element wears it; wrapped, an
   * ANCESTOR of the authored element wears it instead.
   */
  wrapped: boolean;
}

function read(type: string, schema: Record<string, unknown>): Reading {
  cleanup();
  const { container } = render(
    <SchemaRenderer schema={{ type, ...schema } as never} />,
  );
  // ⛔ NOT the first button whose text matches. When a primitive WRAPS the
  // authored button, the Radix-drawn wrapper has the same `textContent` and
  // comes FIRST in document order — so a first-match finder hands back the
  // wrapper, `closest` then searches ABOVE it, and the over-reach reads as
  // clean. That is not hypothetical: it is how this control went from catching
  // seven of this card's eight renderers to catching one. Take the INNERMOST
  // match — the one that contains no button of its own.
  const authored = [...container.querySelectorAll('button')].find(
    (node) =>
      node.textContent === ELEMENT_LABEL && node.querySelector('button') === null,
  );
  const owner = authored?.parentElement?.closest(RADIX_TRIGGER_WIRING) ?? null;
  return {
    erroredOut: (container.textContent ?? '').includes(ERROR_BOUNDARY_MARKER),
    text: container.textContent ?? '',
    buttons: container.querySelectorAll('button').length,
    focusable: container.querySelectorAll(FOCUSABLE).length,
    wrapped:
      authored !== undefined &&
      owner !== null &&
      RADIX_DRAWN_TRIGGER_TAGS.has(owner.tagName),
  };
}

/** Read EVERY block in the population against one schema shape. */
function survey(
  schema: (block: TriggerBlock) => Record<string, unknown>,
): Array<Reading & { type: string }> {
  return triggerBlocks().map((block) => ({
    type: block.type,
    ...read(block.type, schema(block)),
  }));
}

/**
 * A red run must name every offending block at once. A per-block `expect`
 * inside a loop stops at the first one and reports a single file — which, for a
 * card whose entire subject is a CLASS, is the wrong diagnostic.
 */
const named = (
  rows: Array<Reading & { type: string }>,
  predicate: (row: Reading) => boolean,
): string[] => rows.filter(predicate).map((row) => row.type);

/* ────────────────────────────────────────────────────────────────────────────
 * The defective ninth, used only by `REDDENS_FOR_A_NINTH`
 * ───────────────────────────────────────────────────────────────────────── */

const NINTH_TYPE = 'ninth-overlay-key';
const NINTH_NAMESPACE = 'test-9710';
const NINTH_CANONICAL = `${NINTH_NAMESPACE}:${NINTH_TYPE}`;

/**
 * A block written the way all nine were written before this card: the authored
 * slot handed DIRECTLY to an unconditionally-`asChild` Radix trigger. It is
 * registered inside one test and removed in `afterEach`.
 */
function registerDefectiveNinth(): void {
  ComponentRegistry.register(
    NINTH_TYPE,
    ({ schema }: { schema: { trigger?: unknown }; [key: string]: unknown }) => (
      <Popover>
        <PopoverTrigger asChild>{renderChildren(schema.trigger)}</PopoverTrigger>
        <PopoverContent />
      </Popover>
    ),
    {
      namespace: NINTH_NAMESPACE,
      label: 'Defective ninth overlay key',
      inputs: [{ name: 'trigger', type: 'slot' }],
      skipFallback: true,
    },
  );
}

const OVER_REACH_TYPE = 'over-reaching-key';
const OVER_REACH_CANONICAL = `${NINTH_NAMESPACE}:${OVER_REACH_TYPE}`;

/**
 * A block that withholds `asChild` on a path Radix COULD have served, so the
 * primitive draws its own button around the authored one. `Popover` is chosen
 * because it draws a BUTTON — the shape seven of this card's eight renderers
 * have, and the shape the previous version of `wrapped` was blind to.
 *
 * This exists so the over-reach detector's FAILURE is observed on every run
 * rather than argued for. A control whose red has never been seen certifies
 * nothing, which is exactly how a regression reached this file.
 */
function registerOverReaching(): void {
  ComponentRegistry.register(
    OVER_REACH_TYPE,
    ({ schema }: { schema: { trigger?: unknown }; [key: string]: unknown }) => (
      <Popover>
        <PopoverTrigger asChild={false}>
          {renderChildren(schema.trigger)}
        </PopoverTrigger>
        <PopoverContent />
      </Popover>
    ),
    {
      namespace: NINTH_NAMESPACE,
      label: 'Over-reaching overlay key',
      inputs: [{ name: 'trigger', type: 'slot' }],
      skipFallback: true,
    },
  );
}

afterEach(() => {
  ComponentRegistry.unregister(NINTH_TYPE, NINTH_NAMESPACE);
  ComponentRegistry.unregister(OVER_REACH_TYPE, NINTH_NAMESPACE);
  cleanup();
});

/* ────────────────────────────────────────────────────────────────────────────
 * Readings
 * ───────────────────────────────────────────────────────────────────────── */

describe('overlay triggers: every block declaring a `trigger` slot (objectui#9710)', () => {
  it("ENUMERATION_CONNECTED control: the population is live and reaches past this card's own files", () => {
    const types = triggerBlocks().map((block) => block.type);

    expect(types.length).toBeGreaterThan(0);
    // Repaired by objectui#9701, and it lives in `renderers/disclosure/` — so
    // this population is not a restatement of this card's `renderers/overlay/`
    // diff.
    expect(types).toContain('ui:collapsible');
    // Never defective: its `asChild` child is a real `div`, so the rendered
    // slot goes INSIDE it and `Children.only` never sees the string. It is
    // asserted here anyway, because "immune today" is a reading that expires.
    expect(types).toContain('ui:context-menu');
  });

  it('ZOD_FACES_READ control: the optional/required split is derived and it discriminates', () => {
    const optional = triggerOptionalByType();

    // A derivation that returned nothing would make the omitted-trigger arm
    // vacuous — green over a population of zero.
    expect(optional.size).toBeGreaterThan(0);
    // Both answers are actually present, so the arm below is neither
    // everything nor nothing.
    expect([...optional.values()]).toContain(true);
    expect([...optional.values()]).toContain(false);
    // Anchors, by symbol rather than by count: `dialog` carries `.optional()`
    // and may omit its trigger; `popover` does not and may not.
    expect(optional.get('dialog')).toBe(true);
    expect(optional.get('popover')).toBe(false);
    // Every block in the population has a face to read.
    expect(
      triggerBlocks()
        .filter((block) => !optional.has(block.bare))
        .map((block) => block.type),
    ).toEqual([]);
  });

  it('paints the string instead of reaching the error boundary, on every block in the population', () => {
    const rows = survey(() => ({ trigger: BARE_STRING }));

    // THE assertion. Its expected value is the empty list, ⛔ not a count — the
    // population is whatever the registry holds, and a red run prints the names
    // of every block that still has the defect.
    expect(named(rows, (row) => row.erroredOut)).toEqual([]);
    expect(named(rows, (row) => !row.text.includes(BARE_STRING))).toEqual([]);
  });

  it('OMITTED_TRIGGER_PAINTS_NOTHING: a legal trigger-less document gains no empty tab stop', () => {
    const optional = triggerOptionalByType();
    const mayOmit = (row: { type: string }) =>
      optional.get(
        row.type.includes(':')
          ? row.type.slice(row.type.indexOf(':') + 1)
          : row.type,
      ) === true;

    // `title` so the node is not empty for reasons unrelated to the trigger.
    const rows = survey(() => ({ title: 'T' })).filter(mayOmit);

    // Non-vacuity: the filter must leave something, or this asserts nothing.
    expect(rows.length).toBeGreaterThan(0);
    expect(named(rows, (row) => row.erroredOut)).toEqual([]);
    // An empty `*Trigger` still paints its own element, and an empty `button`
    // is an unlabeled tab stop a keyboard user lands on with nothing to read.
    // ⚠️ `context-menu` legitimately substitutes a visible placeholder when the
    // slot is omitted (its own zod `describe` says so), which is text, not a
    // focusable — so this is asserted on FOCUSABLES, not on painted output.
    expect(named(rows, (row) => row.focusable > 0)).toEqual([]);
  });

  it('ASCHILD_STILL_ON control: an element trigger is merged onto, never wrapped by, the primitive', () => {
    const rows = survey(() => ({
      trigger: [{ type: 'button', label: ELEMENT_LABEL }],
    }));

    expect(named(rows, (row) => row.erroredOut)).toEqual([]);
    expect(named(rows, (row) => !row.text.includes(ELEMENT_LABEL))).toEqual([]);
    // Wrapping would mean `asChild` was dropped on a path Radix can serve —
    // the over-reach this control refuses.
    expect(named(rows, (row) => row.wrapped)).toEqual([]);
  });

  it('OVER_REACH_IS_VISIBLE control: the wrapped detector sees a primitive that drew its own button', () => {
    registerOverReaching();

    const rows = survey(() => ({
      trigger: [{ type: 'button', label: ELEMENT_LABEL }],
    }));

    expect(rows.map((row) => row.type)).toContain(OVER_REACH_CANONICAL);
    // The list ASCHILD_STILL_ON asserts empty now holds exactly the
    // over-reaching block — so that control is observed CATCHING the thing it
    // exists to catch, on a button-drawing primitive. With a first-match
    // authored-element finder this reads `[]` and reddens here instead.
    expect(named(rows, (row) => row.wrapped)).toEqual([OVER_REACH_CANONICAL]);
  });

  it('REDDENS_FOR_A_NINTH control: a newly registered defective block enters the population and breaks THE assertion', () => {
    registerDefectiveNinth();

    const rows = survey(() => ({ trigger: BARE_STRING }));

    // The enumeration is live: a block registered a moment ago is in it, with
    // no edit to this file. That is what covers the ninth overlay key.
    expect(rows.map((row) => row.type)).toContain(NINTH_CANONICAL);
    // And the assertion the test above makes — the errored-out list is empty —
    // now holds exactly one name: the defective block, and nothing else. This
    // is the property triage asked for, OBSERVED rather than asserted about.
    expect(named(rows, (row) => row.erroredOut)).toEqual([NINTH_CANONICAL]);
  });
});
