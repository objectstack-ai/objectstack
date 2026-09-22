// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tests for the shared functional-completeness predicate (ADR-0078 Phase 1).
 *
 * Two disciplines from the #4001 campaign carry over:
 *
 * 1. Every rule is proven to GO RED on the inert shape it exists for — a
 *    completeness gate that cannot fail on a known-inert instance is the
 *    hollow-probe defect reproduced in the instrument built against it.
 * 2. The deliberate NON-rules are pinned as hard as the rules. `multiselect`
 *    without options is runtime-blessed free-form (`record-validator.ts`'s
 *    `validateOne`, verbatim: "free-form (tags without options)") — if someone
 *    "completes" this module by flagging it, that is a false prescription, and
 *    this test is where the attempt fails first.
 */

import { describe, expect, it } from 'vitest';

import {
  checkFieldCompleteness,
  checkViewCompleteness,
  checkWebhookCompleteness,
  FUNCTIONAL_COMPLETENESS_RULES,
  FIELD_SUMMARY_WITHOUT_OPERATIONS,
  FIELD_FORMULA_WITHOUT_EXPRESSION,
  FIELD_RELATIONSHIP_WITHOUT_REFERENCE,
  FIELD_CHOICE_WITHOUT_OPTIONS,
  VIEW_LAYOUT_WITHOUT_BINDING,
  VIEW_TREE_WITHOUT_PARENT_FIELD,
  VIEW_ROW_COLOR_WITHOUT_COLORS,
  VIEW_ROW_COLOR_UNRESOLVABLE_VALUE,
  WEBHOOK_WITHOUT_TRIGGERS,
} from './functional-completeness';

const only = (findings: ReturnType<typeof checkFieldCompleteness>) => {
  expect(findings).toHaveLength(1);
  return findings[0];
};

describe('checkFieldCompleteness — the verified inert shapes go red', () => {
  it('flags a bare summary as an ERROR (the cloud#687 founding case)', () => {
    const f = only(checkFieldCompleteness({ type: 'summary' }));
    expect(f.rule).toBe(FIELD_SUMMARY_WITHOUT_OPERATIONS);
    expect(f.severity).toBe('error');
    expect(f.fix).toContain('summaryOperations');
    // The message must carry the runtime evidence — a prescription with no
    // "why" is the kind this campaign shipped four wrong ones of.
    expect(f.message).toContain('engine.ts');
  });

  it('is silent on a complete summary', () => {
    expect(checkFieldCompleteness({
      type: 'summary',
      summaryOperations: { object: 'order_line', field: 'amount', function: 'sum' },
    })).toEqual([]);
  });

  it('flags a bare formula as an ERROR', () => {
    const f = only(checkFieldCompleteness({ type: 'formula' }));
    expect(f.rule).toBe(FIELD_FORMULA_WITHOUT_EXPRESSION);
    expect(f.severity).toBe('error');
  });

  it('is silent on a formula with an expression — either input form', () => {
    expect(checkFieldCompleteness({ type: 'formula', expression: 'record.a * record.b' })).toEqual([]);
    expect(checkFieldCompleteness({
      type: 'formula',
      expression: { dialect: 'cel', source: 'record.a * record.b' },
    })).toEqual([]);
  });

  it.each(['lookup', 'master_detail'])('flags a %s without reference as an ERROR', (type) => {
    const f = only(checkFieldCompleteness({ type }));
    expect(f.rule).toBe(FIELD_RELATIONSHIP_WITHOUT_REFERENCE);
    expect(f.severity).toBe('error');
    expect(checkFieldCompleteness({ type, reference: 'account' })).toEqual([]);
  });

  it('does NOT flag `user` — its target is implicitly sys_user', () => {
    expect(checkFieldCompleteness({ type: 'user' })).toEqual([]);
  });

  it.each(['select', 'radio'])('flags a %s without options as an ERROR', (type) => {
    const f = only(checkFieldCompleteness({ type }));
    expect(f.rule).toBe(FIELD_CHOICE_WITHOUT_OPTIONS);
    expect(f.severity).toBe('error');
    expect(checkFieldCompleteness({ type, options: [] })).toHaveLength(1);
    expect(checkFieldCompleteness({
      type,
      options: [{ label: 'Open', value: 'open' }],
    })).toEqual([]);
  });

  it('flags checkboxes without options as a WARNING, not an error', () => {
    // Shares the validator's free-form multi branch, so it MAY be deliberate —
    // but a zero-box checkbox group almost never is. ADR-0078 §1: degrades → warning.
    const f = only(checkFieldCompleteness({ type: 'checkboxes' }));
    expect(f.rule).toBe(FIELD_CHOICE_WITHOUT_OPTIONS);
    expect(f.severity).toBe('warning');
  });

  it('does NOT flag multiselect without options — the pinned NON-rule', () => {
    // record-validator.ts's `validateOne`, verbatim:
    // "free-form (tags without options)".
    // The runtime blesses this as a mode; flagging it would be a false
    // prescription. If product direction ever changes, change the runtime
    // first — this pin makes the lint follow the code, never lead it.
    expect(checkFieldCompleteness({ type: 'multiselect' })).toEqual([]);
  });

  it('never throws on junk — a lint must not be what crashes a build', () => {
    for (const junk of [undefined, null, 42, 'x', [], {}, { type: 7 }, { type: 'nonsense' }]) {
      expect(() => checkFieldCompleteness(junk)).not.toThrow();
      expect(checkFieldCompleteness(junk)).toEqual([]);
    }
  });
});

describe('checkViewCompleteness — layout bindings', () => {
  // Six of the view `type` members carry a binding block, and the missing
  // block is the same defect on all six: the surface the author asked for is
  // not the one that renders, while authoring reports success.
  //
  // ⛔ What it is NOT is one shared mechanism. This comment used to say the
  // renderer's fallback for every one is a literal field name; objectui has
  // been deleting those floors one view type at a time, and for `calendar`
  // the renderer now REFUSES by name instead (#17445). The rule fires on all
  // six either way — that is what this pin holds — and the per-type
  // mechanism belongs to the table's docblock, which states each row's own
  // measurement and which of them have gone stale.
  it.each(['kanban', 'calendar', 'gantt', 'timeline', 'map', 'tree'])('flags a %s view missing its block as a WARNING', (type) => {
    const f = only(checkViewCompleteness({ type }) as never);
    expect(f.rule).toBe(VIEW_LAYOUT_WITHOUT_BINDING);
    expect(f.severity).toBe('warning');
    expect(f.path).toBe(type);
    // The prescription names the block and the keys that make it a binding.
    expect(f.fix.startsWith(`${type}: {`)).toBe(true);
  });

  it('is silent when the block is present and bound — one fixture per covered type', () => {
    expect(checkViewCompleteness({
      type: 'calendar',
      calendar: { startDateField: 'due_at', titleField: 'title' },
    })).toEqual([]);
    // The card's own repro, the direction that was silent before this table
    // reached `timeline`: the declared block must stay clean.
    expect(checkViewCompleteness({
      type: 'timeline',
      timeline: { startDateField: 'last_update_at', titleField: 'subject' },
    })).toEqual([]);
    // Both coordinate forms `ListMapConfigSchema` documents.
    expect(checkViewCompleteness({ type: 'map', map: { locationField: 'site' } })).toEqual([]);
    expect(checkViewCompleteness({
      type: 'map',
      map: { latitudeField: 'lat', longitudeField: 'lng' },
    })).toEqual([]);
    expect(checkViewCompleteness({ type: 'tree', tree: { parentField: 'parent' } })).toEqual([]);
  });

  it('the calendar body describes the REFUSAL, not a deleted literal fallback (#17445)', () => {
    // Re-measured on objectui `main` at `0cf2d6644` (2026-09-21), both halves
    // of the path: `ListView.tsx`'s `case 'calendar'` restates only declared
    // bindings — objectui#7029 deleted the `startDateField || 'start_date'` /
    // `endDateField || 'end_date'` floors — and `ObjectCalendar`'s
    // `getCalendarConfig` resolves `null`, so the component renders its
    // "Calendar configuration required" refusal screen. The body asserted
    // those floors as the reason for the warning, which is what this pin
    // stops from coming back.
    const f = only(checkViewCompleteness({ type: 'calendar' }) as never);
    expect(f.message).not.toContain('falls back to literal default field names');
    expect(f.message).toContain('Calendar configuration required');
    expect(f.message).toContain('ObjectCalendar.tsx');
    // ⛔ The half the correction had to PRESERVE: a warning an author meets at
    // authoring time earns its place by naming the key to declare, not by
    // reporting that something is missing.
    expect(f.message).toContain('calendar.startDateField');
    expect(f.fix).toContain('startDateField');
    // Severity is deliberately untouched here. Whether a renderer that
    // refuses BY NAME still deserves WARNING under ADR-0078 §1 is #16577's
    // question; correcting false prose does not answer it.
    expect(f.severity).toBe('warning');
  });

  it('the five types with no per-type body keep the generic one — an override, not a rewrite', () => {
    // ⚠️ An honest pin: it records WHICH body each type receives, NOT that
    // the body is true of each. The table's re-measurement note says `gantt`,
    // `timeline` and `map` inherit this sentence pending corrections of their
    // own; `kanban` and `tree` were re-read at the same ref and still floor a
    // literal. Correcting one of the three means adding an entry beside
    // `calendar`'s and moving that type out of this list — a deliberate edit,
    // which is the point.
    for (const type of ['kanban', 'gantt', 'timeline', 'map', 'tree']) {
      const f = only(checkViewCompleteness({ type }) as never);
      expect(f.rule).toBe(VIEW_LAYOUT_WITHOUT_BINDING);
      expect(f.message).toContain('falls back to literal default field names');
      expect(f.message).toContain(`A \`${type}\` view with no \`${type}\` block`);
    }
  });

  it('names the schema-required keys in the timeline prescription', () => {
    // `TimelineConfigSchema` requires exactly these two; the hint must not
    // send an author to declare a block the parser then refuses.
    const f = only(checkViewCompleteness({ type: 'timeline' }) as never);
    expect(f.fix).toContain('startDateField');
    expect(f.fix).toContain('titleField');
  });

  it('flags a `map` block that declares neither coordinate form — `map: {}` is the unbound view with braces', () => {
    // `ListMapConfigSchema` requires no key, so block presence alone would
    // bless `map: { titleField }` on its way to `locationField || 'location'`.
    for (const map of [{}, { titleField: 'title' }, { latitudeField: 'lat' }, { longitudeField: 'lng' }]) {
      const f = only(checkViewCompleteness({ type: 'map', map }) as never);
      expect(f.rule).toBe(VIEW_LAYOUT_WITHOUT_BINDING);
      expect(f.severity).toBe('warning');
      expect(f.path).toBe('map.locationField');
      expect(f.message).toContain("locationField || 'location'");
      expect(f.fix).toContain('locationField');
      expect(f.fix).toContain('latitudeField');
    }
  });

  it('is silent on the types with no binding block to demand (grid, gallery, chart)', () => {
    // `gallery` IS measured (`titleField || 'name'`) and deliberately absent:
    // `GalleryConfigSchema` requires no key, so block presence would assert
    // nothing, and the fallback mis-titles cards rather than emptying them.
    for (const type of ['grid', 'gallery', 'chart']) {
      expect(checkViewCompleteness({ type })).toEqual([]);
    }
  });
});

describe('checkViewCompleteness — the tree parent pointer (the silent-flat half)', () => {
  // A `tree: {}` block satisfies the binding-block table (every key is
  // optional) and still renders flat on an object with no self-reference —
  // the shape a block-presence gate would vouch for. This rule is the second
  // check the triage asked for. Its `lookup` / `master_detail` arm mirrors
  // objectui's `detectParentField` (a reference back to the object); its
  // `tree` arm reads the #14892 rule the parse door enforces — a `tree` field
  // with no `reference`, or one naming this object — which is stricter than
  // the renderer's "any `tree` field" (see the predicate's docblock).
  const flatObject = {
    name: 'business_unit',
    fields: { name: { type: 'text' }, manager: { type: 'lookup', reference: 'sys_user' } },
  };
  const rulesOf = (view: unknown, object: unknown) =>
    checkViewCompleteness(view, object).map((f) => f.rule).sort();

  it('flags a tree view whose block is EMPTY on an object with nothing to auto-detect', () => {
    const f = only(checkViewCompleteness({ type: 'tree', tree: {} }, flatObject) as never);
    expect(f.rule).toBe(VIEW_TREE_WITHOUT_PARENT_FIELD);
    expect(f.severity).toBe('warning');
    expect(f.path).toBe('tree.parentField');
    // The message carries the renderer evidence — the discipline every rule
    // in this module is held to.
    expect(f.message).toContain('ObjectTree.tsx');
    expect(f.message).toContain('depth 0');
    expect(f.fix).toContain('parentField');
  });

  it('flags a tree view whose block is ABSENT — both the binding rule and the parent-pointer rule', () => {
    expect(rulesOf({ type: 'tree' }, flatObject)).toEqual([
      VIEW_LAYOUT_WITHOUT_BINDING,
      VIEW_TREE_WITHOUT_PARENT_FIELD,
    ]);
  });

  it('a block that binds only the label is still flat', () => {
    expect(rulesOf({ type: 'tree', tree: { labelField: 'name' } }, flatObject))
      .toEqual([VIEW_TREE_WITHOUT_PARENT_FIELD]);
    // An empty string is not a declaration either.
    expect(rulesOf({ type: 'tree', tree: { parentField: '' } }, flatObject))
      .toEqual([VIEW_TREE_WITHOUT_PARENT_FIELD]);
  });

  it('is silent when `parentField` is declared, whatever the object declares', () => {
    expect(checkViewCompleteness({ type: 'tree', tree: { parentField: 'parent' } }, flatObject)).toEqual([]);
  });

  it('is silent when the object carries a `tree` field — the renderer auto-detects it', () => {
    expect(checkViewCompleteness({ type: 'tree', tree: {} }, {
      name: 'category',
      fields: { name: { type: 'text' }, parent: { type: 'tree' } },
    })).toEqual([]);
  });

  // [#14892] The `tree` arm reads the rule the object schema enforces: a
  // `tree` field's `reference`, when present, must name the declaring object.
  it('a `tree` field naming THIS object is a parent pointer — silent', () => {
    expect(checkViewCompleteness({ type: 'tree', tree: {} }, {
      name: 'category',
      fields: { name: { type: 'text' }, parent: { type: 'tree', reference: 'category' } },
    })).toEqual([]);
  });

  it('a `tree` field naming ANOTHER object is not a parent pointer — flagged, as the parse door refuses it', () => {
    expect(rulesOf({ type: 'tree', tree: {} }, {
      name: 'showcase_field_zoo',
      fields: { name: { type: 'text' }, f_tree: { type: 'tree', reference: 'showcase_category' } },
    })).toEqual([VIEW_TREE_WITHOUT_PARENT_FIELD]);
  });

  it('a `tree` field with no `reference` is a parent pointer even on a nameless object; one WITH a reference cannot be matched there', () => {
    expect(checkViewCompleteness({ type: 'tree', tree: {} }, {
      fields: { parent: { type: 'tree' } },
    })).toEqual([]);
    expect(rulesOf({ type: 'tree', tree: {} }, {
      fields: { parent: { type: 'tree', reference: 'category' } },
    })).toEqual([VIEW_TREE_WITHOUT_PARENT_FIELD]);
  });

  it.each(['lookup', 'master_detail'])('is silent when the object carries a %s back to itself', (type) => {
    expect(checkViewCompleteness({ type: 'tree', tree: {} }, {
      name: 'business_unit',
      fields: { name: { type: 'text' }, parent: { type, reference: 'business_unit' } },
    })).toEqual([]);
    // …and not when the same field points at ANOTHER object: a lookup is only
    // a parent pointer when it comes back to the object it lives on.
    expect(rulesOf({ type: 'tree', tree: {} }, {
      name: 'business_unit',
      fields: { name: { type: 'text' }, parent: { type, reference: 'department' } },
    })).toEqual([VIEW_TREE_WITHOUT_PARENT_FIELD]);
  });

  it('reads array-form fields too — both authorable spellings', () => {
    expect(checkViewCompleteness({ type: 'tree', tree: {} }, {
      name: 'business_unit',
      fields: [{ name: 'name', type: 'text' }, { name: 'parent', type: 'lookup', reference: 'business_unit' }],
    })).toEqual([]);
    expect(rulesOf({ type: 'tree', tree: {} }, {
      name: 'business_unit',
      fields: [{ name: 'name', type: 'text' }],
    })).toEqual([VIEW_TREE_WITHOUT_PARENT_FIELD]);
  });

  it('needs the object name to recognise a self-reference — mirrors the renderer, which needs it too', () => {
    expect(rulesOf({ type: 'tree', tree: {} }, {
      fields: { parent: { type: 'lookup', reference: 'business_unit' } },
    })).toEqual([VIEW_TREE_WITHOUT_PARENT_FIELD]);
  });

  it('stays silent with no object in hand — the second clause cannot be asserted', () => {
    // The one-argument call is the pre-existing signature every other consumer
    // uses; it must not start guessing about objects it was never shown. A
    // view naming an object the stack does not declare belongs to
    // `validate-object-references`.
    expect(checkViewCompleteness({ type: 'tree', tree: {} })).toEqual([]);
    expect(checkViewCompleteness({ type: 'tree', tree: {} }, undefined)).toEqual([]);
  });

  it('never throws on junk objects', () => {
    for (const junk of [null, 42, 'x', [], {}, { fields: 'nope' }, { fields: [null, 7] }, { fields: { a: null } }]) {
      expect(() => checkViewCompleteness({ type: 'tree', tree: {} }, junk)).not.toThrow();
    }
  });
});

describe('checkViewCompleteness — rowColor without a colour map (the parse-clean no-op)', () => {
  // `RowColorConfigSchema` requires `field` and leaves `colors` optional, so
  // `rowColor: { field }` parses, publishes, and colours nothing: objectui's
  // `useRowColor.ts` returns `undefined` unless BOTH are present. Every key is
  // one we know, which is why nothing else in the stack can see it.

  it('flags `rowColor: { field }` with no `colors` as a WARNING', () => {
    const f = only(checkViewCompleteness({ type: 'grid', rowColor: { field: 'status' } }) as never);
    expect(f.rule).toBe(VIEW_ROW_COLOR_WITHOUT_COLORS);
    expect(f.severity).toBe('warning');
    expect(f.path).toBe('rowColor.colors');
    // The first sentence, verbatim: it names the view, the bound field and the
    // consequence — a prescription with no diagnosis is the shape ADR-0078 §6
    // rejects.
    expect(f.message).toContain(
      'A `grid` view whose `rowColor` binds `status` and declares no `colors` map never colours a row',
    );
    // …and the runtime line that makes it true.
    expect(f.message).toContain('if (!config?.field || !config.colors) return undefined');
    // The prescription is machine-pastable and carries the authored field back.
    expect(f.fix).toContain("field: 'status'");
    expect(f.fix).toContain('colors');
  });

  // #18791 — the sharpest half of this card. The `fix` string this rule hands
  // the author read `colors: { '<field_value>': '<hex_or_token>' }`, and a hex
  // is the ONE spelling `colorToClass` cannot resolve. So the chain ran: the
  // gate fires, the gate itself hands the author a hex, the hex parses,
  // publishes, turns this rule GREEN, and colours nothing. A control whose own
  // prescription switches it off.
  //
  // Pinning the literal string would rot. What is pinned instead is the
  // PROPERTY that made it wrong: the value the prescription suggests is fed
  // back through this module, and must survive it.
  it('hands the author a prescription this module itself accepts (#18791)', () => {
    const f = only(checkViewCompleteness({ type: 'grid', rowColor: { field: 'status' } }) as never);
    const suggested = /'<field_value>':\s*'([^']+)'/.exec(f.fix)?.[1];
    expect(suggested, `no suggested colour value in the prescription: ${f.fix}`).toBeDefined();
    expect(
      checkViewCompleteness({ type: 'grid', rowColor: { field: 'status', colors: { open: suggested! } } }),
      `the prescription suggests \`${suggested}\`, which this module's own resolvability rule rejects — `
        + 'the gate would be handing the author the defect it just reported',
    ).toEqual([]);
  });

  it('⛔ names no hex placeholder anywhere in the prescription (#18791)', () => {
    // The direct, dumb half of the pin above: whatever the wording becomes, it
    // must not put a hex back in front of an author. `token` is refused for the
    // same reason — it named nothing an author could look up, and stood beside
    // hex as an equal alternative.
    const f = only(checkViewCompleteness({ type: 'grid', rowColor: { field: 'status' } }) as never);
    expect(f.fix).not.toMatch(/hex|#[0-9a-f]{3}|token/i);
  });

  it('is silent once a `colors` map is declared — the negative fixture', () => {
    // ⚠️ This fixture used to spell the colour `'#0f0'`. That hex is exactly
    // the shape the sibling rule below exists to catch, so the negative
    // fixture for THIS rule was modelling the trap: it asserted "presence is
    // enough" over a map that colours nothing. The value is now a resolvable
    // colour name, which is what makes this a clean negative for one rule
    // instead of a silent positive for the other.
    expect(checkViewCompleteness({
      type: 'grid',
      rowColor: { field: 'status', colors: { open: 'green' } },
    })).toEqual([]);
  });

  it('flags `colors: {}` the same — an empty map passes the guard and then matches nothing', () => {
    // The renderer's own test is `!config.colors`, which an empty object
    // PASSES; the lookup one line down matches no value and the row keeps its
    // default background anyway. Mirroring the guard expression alone would
    // have blessed this shape; the rule mirrors the outcome.
    const f = only(checkViewCompleteness({ type: 'grid', rowColor: { field: 'status', colors: {} } }) as never);
    expect(f.rule).toBe(VIEW_ROW_COLOR_WITHOUT_COLORS);
    expect(f.path).toBe('rowColor.colors');
  });

  it('does NOT flag the view types whose renderer never reads `rowColor` — the pinned NON-rule', () => {
    // objectui's ListView adapter forwards `rowColor` in its `grid` branch
    // only. On a kanban board the block is inert too, but declaring a `colors`
    // map would not fix it — so warning here would be a false prescription,
    // which is what this module refuses to ship. Recorded, not enforced.
    for (const type of ['kanban', 'gallery', 'chart', 'timeline']) {
      const findings = checkViewCompleteness({ type, rowColor: { field: 'status' } });
      expect(findings.map((f) => f.rule)).not.toContain(VIEW_ROW_COLOR_WITHOUT_COLORS);
    }
  });

  it('stays silent without a `field` to bind — that half is the schema\'s to refuse', () => {
    // `field` is REQUIRED by `RowColorConfigSchema`, so a block without one is
    // a parse error, not a completeness finding. Asserting it here would
    // double-report the same defect in two different vocabularies.
    expect(checkViewCompleteness({ type: 'grid', rowColor: {} })).toEqual([]);
    expect(checkViewCompleteness({ type: 'grid', rowColor: { field: '' } })).toEqual([]);
  });

  it('leaves a non-record `colors` alone — only what was verified is asserted', () => {
    // The schema refuses these at parse; this module is not a second parser.
    expect(checkViewCompleteness({ type: 'grid', rowColor: { field: 'status', colors: 'red' } })).toEqual([]);
    expect(checkViewCompleteness({ type: 'grid', rowColor: { field: 'status', colors: [] } })).toEqual([]);
  });

  it('never throws on junk', () => {
    expect(checkViewCompleteness({ type: 'grid', rowColor: 'red' })).toEqual([]);
    expect(checkViewCompleteness({ type: 'grid', rowColor: null })).toEqual([]);
  });
});

/**
 * #18791 — the half `view/row-color-without-colors` structurally cannot see.
 *
 * `RowColorConfigSchema.colors` is `z.record(z.string(), z.string())`, so every
 * string parses. `useRowColor.ts`'s `colorToClass` resolves far less: a
 * `bg-`-prefixed literal passes through, the lower-cased and trimmed value is
 * looked up in a closed vocabulary of colour NAMES, and everything else returns
 * `undefined`. A hex map therefore CLEARS the `!config.colors` guard — which is
 * to say it turns the presence rule GREEN — and colours nothing, which is why
 * presence-only can never be the detector for it.
 *
 * Measured, not argued: PR #18787's reverse-verification leg B swapped four
 * colour names for the four hexes the `priority` field already declares; the
 * app-local resolvability arm went red naming all four, and the presence arm
 * stayed green.
 */
describe('checkViewCompleteness — rowColor values the renderer resolves to nothing (#18791)', () => {
  const grid = (colors: Record<string, unknown>) =>
    checkViewCompleteness({ type: 'grid', rowColor: { field: 'priority', colors } });

  it('flags a hex map as a WARNING, naming every dead value', () => {
    const f = only(grid({ low: '#94A3B8', high: '#EF4444' }) as never);
    expect(f.rule).toBe(VIEW_ROW_COLOR_UNRESOLVABLE_VALUE);
    expect(f.severity).toBe('warning');
    expect(f.path).toBe('rowColor.colors');
    // The author has to be able to find them, so each offending entry is named
    // with the value it holds — a count alone sends them re-reading the map.
    expect(f.message).toContain('`low` = "#94A3B8"');
    expect(f.message).toContain('`high` = "#EF4444"');
    // …and the runtime symbol that makes it true, per this module's discipline.
    expect(f.message).toContain('colorToClass');
    expect(f.fix).toContain("field: 'priority'");
  });

  it('⭐ says out loud that this shape SILENCES the presence rule', () => {
    // The whole reason the card is p1: the obvious "fix" for
    // `view/row-color-without-colors` is to paste the field's own option
    // colours in, which are hexes — strictly worse than the original defect,
    // because it removes the one signal that was working. A finding that does
    // not say so invites exactly that move again.
    const f = only(grid({ low: '#94A3B8' }) as never);
    expect(f.message).toContain(VIEW_ROW_COLOR_WITHOUT_COLORS);
    expect(grid({ low: '#94A3B8' }).map((x) => x.rule)).not.toContain(VIEW_ROW_COLOR_WITHOUT_COLORS);
  });

  it('accepts what the renderer accepts — colour names and `bg-` classes', () => {
    // The showcase's shipped map, verbatim.
    expect(grid({ low: 'slate', medium: 'blue', high: 'amber', urgent: 'red' })).toEqual([]);
    // A complete Tailwind class is handed through untouched by `colorToClass`.
    expect(grid({ open: 'bg-red-200', shut: 'bg-emerald-50/50' })).toEqual([]);
    // The lookup lower-cases and trims, so these resolve too. A rule that
    // tested the raw value would report both — a false prescription.
    expect(grid({ open: 'RED', shut: '  green  ' })).toEqual([]);
  });

  it('flags the other unresolvable spellings, not just hex', () => {
    for (const dead of ['rgb(255,0,0)', 'var(--danger)', '#f00', 'hsl(0 100% 50%)', 'red-500', '']) {
      const findings = grid({ open: dead });
      expect(findings.map((x) => x.rule), `\`${dead}\` should be reported`)
        .toContain(VIEW_ROW_COLOR_UNRESOLVABLE_VALUE);
    }
    // ⚠️ ` bg-red-100` with a leading space is NOT resolvable: `startsWith`
    // tests the RAW value and sees the space, and the lower-cased form is not a
    // bare word either. Pinned because it is the one place where "looks like a
    // Tailwind class" and "resolves" come apart.
    expect(grid({ open: ' bg-red-100' }).map((x) => x.rule)).toContain(VIEW_ROW_COLOR_UNRESOLVABLE_VALUE);
  });

  it('⛔ PINNED NON-RULE: an unknown colour NAME is passed, deliberately', () => {
    // `chartreuse` is shaped like a key and is almost certainly not one, so
    // this rule lets it through. That is the price of refusing to transcribe
    // another repo's 23-entry map: a copy drifts silently in both directions,
    // and a rule that accuses a value the renderer WOULD have resolved is the
    // false prescription this module's discipline forbids. Sound, not complete
    // — if someone "completes" it by pasting the vocabulary in, this is where
    // the trade-off they are reversing is written down.
    expect(grid({ open: 'chartreuse' })).toEqual([]);
  });

  it('⛔ does not double-report the shapes the presence rule owns', () => {
    // `{}` is the presence rule's second spelling; it must not also arrive here
    // as "zero resolvable values", which would report one defect twice in two
    // vocabularies — the thing the sibling block's own tests refuse.
    const empty = checkViewCompleteness({ type: 'grid', rowColor: { field: 'priority', colors: {} } });
    expect(empty.map((f) => f.rule)).toEqual([VIEW_ROW_COLOR_WITHOUT_COLORS]);
  });

  it('is silent on the view types whose renderer never reads `rowColor`', () => {
    for (const type of ['kanban', 'gallery', 'chart', 'timeline']) {
      const findings = checkViewCompleteness({ type, rowColor: { field: 'priority', colors: { a: '#fff' } } });
      expect(findings.map((f) => f.rule)).not.toContain(VIEW_ROW_COLOR_UNRESOLVABLE_VALUE);
    }
  });

  it('leaves what the schema refuses to the schema, and never throws', () => {
    // Non-string values and non-record maps are parse errors, not completeness
    // findings — this module is not a second parser.
    expect(grid({ open: 42, shut: null })).toEqual([]);
    expect(checkViewCompleteness({ type: 'grid', rowColor: { field: 'priority', colors: 'red' } })).toEqual([]);
    expect(() => grid({ open: { nested: true } })).not.toThrow();
  });
});

describe('checkWebhookCompleteness — the rule the runtime comment argued against', () => {
  it('flags a webhook with no `triggers` as an ERROR', () => {
    const f = only(checkWebhookCompleteness({ name: 'notify_slack', url: 'https://x' }) as never);
    expect(f.rule).toBe(WEBHOOK_WITHOUT_TRIGGERS);
    expect(f.severity).toBe('error');
  });

  it('flags `triggers: []` the same — an empty array is not an off switch here', () => {
    // Contrast with an action's `locations: []`, which IS the documented
    // headless spelling. A webhook's off switch is `isActive: false`, so an
    // empty trigger list carries no "I meant it" signal — it is the same dead
    // shape written out longhand.
    const f = only(checkWebhookCompleteness({ triggers: [] }) as never);
    expect(f.severity).toBe('error');
  });

  it('is silent once a trigger is declared', () => {
    expect(checkWebhookCompleteness({ triggers: ['create'] })).toEqual([]);
    expect(checkWebhookCompleteness({ triggers: ['create', 'update', 'delete'] })).toEqual([]);
  });

  it('carries BOTH sources, because either one alone gets this wrong', () => {
    // The skip site's own comment says "or a manual-only webhook with none",
    // which reads as a runtime blessing — the exact shape that makes
    // `multiselect` a NON-rule. What defeats it is webhook.zod.ts's #3196 note
    // that no manual fire path exists, so the blessed mode is unreachable.
    // If someone later demotes or deletes this rule on the strength of that
    // comment alone, this assertion is where the missing half is stated.
    const [f] = checkWebhookCompleteness({});
    expect(f.message).toContain('auto-enqueuer.ts');
    expect(f.message).toContain('no manual fire path exists');
    expect(f.message).toContain('isActive');
  });

  it('never throws on junk', () => {
    for (const junk of [undefined, null, 42, 'x', [], { triggers: 'create' }, { triggers: 7 }]) {
      expect(() => checkWebhookCompleteness(junk)).not.toThrow();
    }
    // A non-array `triggers` is not a declared trigger list — it is the dead
    // shape wearing the wrong type, so it must not slip through as "declared".
    expect(checkWebhookCompleteness({ triggers: 'create' })).toHaveLength(1);
  });
});

describe('registry hygiene', () => {
  it('pins the rule-id list — ids are API for suppressions and dashboards', () => {
    expect([...FUNCTIONAL_COMPLETENESS_RULES].sort()).toEqual([
      'field/choice-without-options',
      'field/formula-without-expression',
      'field/relationship-without-reference',
      'field/summary-without-operations',
      'view/layout-without-binding',
      'view/row-color-unresolvable-value',
      'view/row-color-without-colors',
      'view/tree-without-parent-field',
      'webhook/without-triggers',
    ]);
  });

  it('every emitted finding carries a fix — the prescription IS the payload', () => {
    const all = [
      ...checkFieldCompleteness({ type: 'summary' }),
      ...checkFieldCompleteness({ type: 'formula' }),
      ...checkFieldCompleteness({ type: 'lookup' }),
      ...checkFieldCompleteness({ type: 'select' }),
      ...checkFieldCompleteness({ type: 'checkboxes' }),
      ...checkViewCompleteness({ type: 'kanban' }),
      ...checkViewCompleteness({ type: 'tree', tree: {} }, { name: 'unit', fields: {} }),
      ...checkViewCompleteness({ type: 'grid', rowColor: { field: 'status' } }),
      ...checkViewCompleteness({ type: 'grid', rowColor: { field: 'status', colors: { open: '#0f0' } } }),
      ...checkWebhookCompleteness({ url: 'https://x' }),
    ];
    expect(all).toHaveLength(10);
    for (const f of all) {
      expect(f.fix.length).toBeGreaterThan(8);
      expect(f.message.length).toBeGreaterThan(60);
    }
  });
});
