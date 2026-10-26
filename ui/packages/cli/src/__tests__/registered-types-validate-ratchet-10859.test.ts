/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * How many REGISTERED component types does `objectui validate` refuse at
 * `type`? A ratchet (objectui#10859).
 *
 * ## The gap this closes
 *
 * `objectui validate` judges a document through the strict authoring face
 * (`validateAuthoredDocument`, objectui#5250), whose root is the strict twin of
 * `AnyComponentSchema` — a union discriminated on `type`. A registered type
 * with no arm in that union is refused with one `invalid_union` issue at
 * `['type']`, whatever else the document says: `ai-form-assist`, which
 * `packages/plugin-ai/README.md` teaches, was one of them. The mirror-parity
 * ratchet in `@object-ui/types` counts declaration↔mirror PAIRS and the keys
 * inside them; a registered type with no mirror at all is in neither, so
 * nothing counted this family until this file.
 *
 * ## What is counted, and against what
 *
 * The population is the bare (un-namespaced) keys of `KNOWN_SCHEMA_TYPES`
 * (`../utils/known-schema-types.ts`), the list generated from the registration
 * calls themselves, which `objectui check` already uses. A key is REFUSED when
 * `validateAuthoredDocument({ type: KEY })` fails with an `invalid_union` issue at
 * path `['type']` — the "no arm claims this literal" reading. A key whose arm
 * exists but wants more than the bare `type` (a required member) is not
 * refused here: its `type` is claimed, and the missing member is the
 * document's problem, not the union's.
 *
 * ## The pin moves ONE way
 *
 * `REFUSED_AT_TYPE` is the head's count. objectui#10859 lowers it batch by
 * batch as each registered, declared type gets its arm (or, for a type that is
 * not meant to be authored, as the seat rules on it). ⛔ It never rises: a
 * registration added without an arm, or an arm removed, turns this file red
 * with the refused keys listed, which is where the next author finds out.
 * ⛔ Do not raise the constant to make it pass — arm the type, or take the
 * registration's authorability to the card.
 *
 * ## The namespaced half (objectui#10872)
 *
 * The same list carries the NAMESPACED keys (`view:grid`, `record:details`,
 * `action:button`), and the same union refuses them the same way. They are
 * counted separately, against `NAMESPACED_REFUSED_AT_TYPE`, because they are a
 * separate family card with its own batches — objectui#10872 — and a single
 * total would let a batch on one card mask a regression on the other. Same
 * rule, same direction: the pin is the head's count, it falls with each batch,
 * and ⛔ it never rises.
 *
 * ## `field:` keys are not in the namespaced count (objectui#12176)
 *
 * A `field:` key is a record-form field widget. It is selected through a
 * field's `widget`, which the spec resolves as `field:` + widget, and it is
 * never authored at a node's `type`, so no arm claims it and none is meant to.
 * Counted, every new field widget was a rise of a pin that never rises. So the
 * namespaced population leaves out the `field:` namespace, read from the key
 * (`isFieldWidgetKey`), not from a list of keys: registering a field widget
 * leaves `NAMESPACED_REFUSED_AT_TYPE` where it is, and any other namespaced
 * registration without an arm still turns this file red.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateAuthoredDocument } from '../utils/authoring-face.js';

import { KNOWN_SCHEMA_TYPES } from '../utils/known-schema-types.js';
import { validate } from '../commands/validate.js';

/**
 * The head's refused count (objectui#10859 batch 1: 79 on `main` before it,
 * minus the three `@object-ui/plugin-ai` arms; batch 2: minus `pivot`,
 * `object-metric` and `object-master-detail-form`; batch 3: minus
 * `object-timeline`, armed from its `@objectstack/spec` 17.5.0 row; batch 7:
 * minus the six `@object-ui/plugin-designer` keys; batch 8: minus the thirty
 * (iii) keys RETIRED rather than armed — the 28 bare field-widget fallbacks
 * and the `tree` / `view` aliases, see `RETIRED_BARE_KEYS_10859_BATCH_8`;
 * batch 8 phase 2b: minus twelve more RETIRED keys, see
 * `RETIRED_BARE_KEYS_10859_BATCH_8_PHASE_2B`; batch 8 phase 2c: minus four
 * more, see `UNREGISTERED_10859_BATCH_8_PHASE_2C`; objectui#11441, run as one
 * more batch of this card: minus `navigation-renderer` and `responsive-grid`,
 * see `UNREGISTERED_11441`; batch 8 phase 2d: minus the ten `sidebar-*`
 * primitives, see `UNREGISTERED_10859_BATCH_8_PHASE_2D`; objectui#11440: minus
 * the seven keys its first pull request armed, see `ARMED_11440`, and then
 * `spec-report`, which its second pull request RETIRED, see
 * `UNREGISTERED_11440`). LOWER it when a batch arms or retires more keys;
 * never raise it.
 *
 * None remains: `STILL_REFUSED_10859` is empty, and the row below pins the
 * refused set to exactly that list, with a lit control that the filter still
 * fires on an unregistered key, so an empty reading is a measurement and not
 * an instrument that stopped running. Of the eight keys the seat ruling left
 * registered, seven are armed — `object-pivot`, `embeddable-form`,
 * `detail-section`, `home`, `record`, `utility` and `app-schema-renderer` —
 * and `spec-report`, an alias of `report`, is retired in the ruling's step
 * order: `report` declares the wrapper shape `spec-report` carried, the
 * dashboard's drill drawer writes `report`, then the alias goes.
 *
 * `navigation-renderer` and `responsive-grid`, the two the seat sent to the
 * maintainer, were ruled B / B on objectui#11441 (record `5950208338`) and are
 * retired.
 *
 * The ten `sidebar-*` primitives were phase 2b's third fork. The seat's fork
 * ruling (`5948252391`) chose A, conditionally, and phase 2d executed it: the
 * armed `sidebar` supplies its own `SidebarProvider` only when no provider is
 * above it, the four `components-basic-sidebar` documents and `sidebar.mdx`
 * teach that node, and the ten are unregistered.
 *
 * Phase 2b's other forks are closed by the same ruling and retired in phase 2c:
 * `pie-chart`, `donut-chart` and `radar-chart` once
 * `@object-ui/plugin-charts`' `examples/chart-examples.ts`, their one producer,
 * moved to `{ type: 'chart', chartType }`; and `page-header`, whose phase-2b
 * reason was a misreading. objectstack's `page-header-subtitle-alias`
 * conversion renames the KEY `description` → `subtitle` on both header
 * spellings. Its docblock says it does not rewrite the type, and that the type
 * registration is objectui's to retire on its own schedule; its fixtures are
 * test data, not producers.
 *
 * The seat's projection was 10 after phase 2d and 2 after objectui#11440, the
 * last 2 waiting on objectui#11441. That card ran first, so the count is 8
 * after phase 2d, and objectui#11440 then takes it to 0.
 */
const REFUSED_AT_TYPE = 0;

/**
 * The head's refused count over the NAMESPACED keys (objectui#10872 batch 1:
 * 418 on `main` before it, minus the twenty ADR-0080 public blocks armed from
 * their `@objectstack/spec` `ComponentPropsMap` rows; batch 2: minus
 * `element:number`, armed with the spec's `dataSource` waiver (its row by reference since `@objectstack/spec` 18, objectui#12030); batch 4: minus
 * the six blocks `@objectstack/spec` 17.5.0 gave a row; objectui#10859 batch 8:
 * minus `view:tree` and `plugin-view:view`, the namespaced twins of the `tree` /
 * `view` aliases it unregistered; objectui#10859 batch 8 phase 2b: minus the
 * ten namespaced twins of the keys it unregistered — `plugin-charts:scatter-chart`,
 * `plugin-dashboard:dashboard-grid`, `plugin-form:form-analytics`,
 * `plugin-grid:import-wizard`, `view:shared-view-link`, the four
 * `plugin-designer:` keys and `plugin-detail:related-list`; objectui#10859
 * batch 8 phase 2c: minus the five namespaced twins of the four keys it
 * unregistered — `plugin-charts:pie-chart`, `plugin-charts:donut-chart`,
 * `plugin-charts:radar-chart`, `layout:page-header` and
 * `protocol-placeholder:page-header`; objectui#11441: minus
 * `layout:navigation-renderer` and `layout:responsive-grid`, the namespaced
 * twins of the two keys it unregistered; objectui#10859 batch 8 phase 2d: minus
 * the ten `ui:sidebar-*` twins of the ten `sidebar-*` primitives it
 * unregistered). LOWER it when a batch arms or retires more keys; never raise
 * it. objectui#11440 armed seven bare keys and none of their namespaced twins
 * (`ARMED_11440` maps each to its twins), so its first pull request did not
 * move this pin; its second took it down by one, `plugin-report:spec-report`,
 * the namespaced twin of the `spec-report` key it unregistered. objectui#10872:
 * minus `record:line_items`, armed from the row `@objectstack/spec` 17.6.0
 * gave it, the last public block held. objectui#7611 PR-5: plus
 * `field:position-ref` and `field:permission-ref`, record-form field widgets
 * refused at `type` by design (seat answer 6116842485), a named stopgap raise.
 * objectui#12176: minus every `field:` key, those two among them (fifty-four on
 * `main` at the time), once the `field:` namespace left the population, so a
 * field widget moves this pin no more. objectui#12363: minus `record:approvals`
 * and `record:attachments`, the two spec-18 record panels the default record
 * page emits, armed from their `ComponentPropsMap` rows. objectui#12733: minus
 * the Installed Apps widget's key and its `app-shell:` twin, both retired from
 * the registry with the view. objectui#12954: minus `cloud:onboarding-next` and
 * its `app-shell:` twin, retired from the registry with the widget; the armed
 * `cloud:plan-status` left with its arm, so it moved nothing here.
 * objectui#13301: plus `app-shell:hero`, `app-shell:stat`,
 * `app-shell:usage-bar`, `app-shell:checklist` and `app-shell:tile-grid`, the
 * console home blocks namespaced so the registry stops warning on every boot,
 * refused at `type` by design so the bare spelling stays the one authorable
 * key (maintainer ruling 6312301934), a named stopgap raise. The raise covers
 * these five keys only; any other rise is still a regression.
 * objectui#13449: minus `ui:html`, the namespaced twin of the raw-HTML `html`
 * node type, retired from the registry with its renderer; the armed bare `html`
 * left with its arm, which became a refusal, so it moved nothing here.
 */
const NAMESPACED_REFUSED_AT_TYPE = 306;

/** The bare registry keys — the population the card measured. */
const BARE_KEYS = KNOWN_SCHEMA_TYPES.filter((key) => !key.includes(':'));

/** Every namespaced registry key — what is registered, `field:` keys included. */
const NAMESPACED_KEYS = KNOWN_SCHEMA_TYPES.filter((key) => key.includes(':'));

/**
 * Is `key` a record-form field widget, selected through a field's `widget` and
 * never authored at a node's `type` (objectui#12176)? The namespace is the
 * key's first segment, so the `protocol-placeholder:field:text` placeholder is
 * not one.
 */
const isFieldWidgetKey = (key: string): boolean => key.startsWith('field:');

/**
 * objectui#10872's population out of a list of registry keys: every namespaced
 * key but a field widget. A function, so the pins below put a probe through the
 * same filter the count reads.
 */
function namespacedPopulation(keys: readonly string[]): string[] {
  return keys.filter((key) => key.includes(':') && !isFieldWidgetKey(key));
}

/** The namespaced keys `NAMESPACED_REFUSED_AT_TYPE` counts over. */
const NAMESPACED_POPULATION = namespacedPopulation(KNOWN_SCHEMA_TYPES);

/**
 * The public blocks objectui#10872 batch 1 armed — named, so the row below
 * says WHICH keys left the refused set rather than only that the count fell.
 */
const ARMED_PUBLIC_BLOCKS_10872 = [
  'page:header', 'page:tabs', 'page:card', 'page:accordion', 'page:section', 'page:footer', 'page:sidebar',
  'record:details', 'record:highlights', 'record:related_list', 'record:path', 'record:activity',
  'record:discussion', 'record:history', 'record:quick_actions', 'record:reference_rail', 'record:alert',
  'element:text', 'element:button', 'element:divider',
] as const;

/** The public block objectui#10872 batch 2 armed. */
const ARMED_PUBLIC_BLOCKS_10872_BATCH_2 = ['element:number'] as const;

/** The six public blocks objectui#10872 batch 4 armed, held until `@objectstack/spec` 17.5.0 carried their rows. */
const ARMED_PUBLIC_BLOCKS_10872_BATCH_4 = [
  'action:button', 'action:icon', 'action:group', 'action:menu', 'element:definition-list', 'element:repeater',
] as const;

/** The last public block objectui#10872 held, armed once `@objectstack/spec` 17.6.0 carried its row. */
const ARMED_PUBLIC_BLOCKS_10872_LINE_ITEMS = ['record:line_items'] as const;

/**
 * The thirty bare keys objectui#10859 batch 8 RETIRED (the seat's ruling on the
 * card), named so the row below says which keys left the population and how:
 * the 28 field-widget fallbacks through `FIELD_TYPES_SKIP_FALLBACK` in
 * `@object-ui/fields` (their `field:TYPE` keys stay), and the `tree` / `view`
 * aliases by unregistration.
 */
const RETIRED_FIELD_FALLBACKS_10859_BATCH_8 = [
  'auto_number', 'boolean', 'checkboxes', 'color', 'currency', 'date', 'datetime',
  'file', 'formula', 'geolocation', 'location', 'lookup', 'master_detail', 'multiselect',
  'number', 'object', 'percent', 'phone', 'qrcode', 'radio', 'rating', 'richtext',
  'signature', 'summary', 'tags', 'url', 'user', 'vector',
] as const;
const RETIRED_BARE_KEYS_10859_BATCH_8 = [...RETIRED_FIELD_FALLBACKS_10859_BATCH_8, 'tree', 'view'] as const;

/**
 * The twelve bare keys objectui#10859 batch 8 phase 2b RETIRED (the seat's
 * ruling `5945530142`, as amended by `5945583855`): ten by unregistration, each
 * with a tombstone docblock where it was registered, and the `metric` /
 * `metric-card` node keys through `skipFallback: true` (M3 option A — the
 * dashboard surfaces emit the namespaced keys; the widget vocabulary is
 * untouched).
 */
const UNREGISTERED_10859_BATCH_8_PHASE_2B = {
  'scatter-chart': 'plugin-charts:scatter-chart',
  'dashboard-grid': 'plugin-dashboard:dashboard-grid',
  'form-analytics': 'plugin-form:form-analytics',
  'import-wizard': 'plugin-grid:import-wizard',
  'shared-view-link': 'view:shared-view-link',
  'app-creation-wizard': 'plugin-designer:app-creation-wizard',
  'branding-editor': 'plugin-designer:branding-editor',
  'dashboard-editor': 'plugin-designer:dashboard-editor',
  'navigation-designer': 'plugin-designer:navigation-designer',
  'related-list': 'plugin-detail:related-list',
} as const;
const SKIP_FALLBACK_10859_BATCH_8_PHASE_2B = {
  metric: 'plugin-dashboard:metric',
  'metric-card': 'plugin-dashboard:metric-card',
} as const;
const RETIRED_BARE_KEYS_10859_BATCH_8_PHASE_2B = [
  ...Object.keys(UNREGISTERED_10859_BATCH_8_PHASE_2B),
  ...Object.keys(SKIP_FALLBACK_10859_BATCH_8_PHASE_2B),
];

/**
 * The four bare keys objectui#10859 batch 8 phase 2c RETIRED by unregistration
 * (the seat's fork ruling `5948252391`), each mapped to the namespaced twins
 * that went with it. `page-header` had two: `@object-ui/layout`'s registration
 * and the opt-in `PROTOCOL_COMPONENTS` placeholder in `@object-ui/components`.
 */
const UNREGISTERED_10859_BATCH_8_PHASE_2C = {
  'pie-chart': ['plugin-charts:pie-chart'],
  'donut-chart': ['plugin-charts:donut-chart'],
  'radar-chart': ['plugin-charts:radar-chart'],
  'page-header': ['layout:page-header', 'protocol-placeholder:page-header'],
} as const;

/**
 * The two bare keys objectui#11441 RETIRED by unregistration (the maintainer's
 * ruling `5950208338`, letters B / B, run as one more batch of this card), each
 * mapped to the namespaced twin that went with it. Both were
 * `@object-ui/layout` registrations; `NavigationRenderer` and `ResponsiveGrid`
 * stay exports.
 */
const UNREGISTERED_11441 = {
  'navigation-renderer': ['layout:navigation-renderer'],
  'responsive-grid': ['layout:responsive-grid'],
} as const;

/**
 * The ten bare keys objectui#10859 batch 8 phase 2d RETIRED by unregistration
 * (the seat's fork ruling `5948252391`, "Fork 3"), each mapped to the `ui:`
 * twin that went with it. One tombstone docblock in
 * `@object-ui/components`' `renderers/navigation/sidebar.tsx` covers all ten.
 */
const UNREGISTERED_10859_BATCH_8_PHASE_2D = {
  'sidebar-provider': ['ui:sidebar-provider'],
  'sidebar-header': ['ui:sidebar-header'],
  'sidebar-content': ['ui:sidebar-content'],
  'sidebar-group': ['ui:sidebar-group'],
  'sidebar-menu': ['ui:sidebar-menu'],
  'sidebar-menu-item': ['ui:sidebar-menu-item'],
  'sidebar-menu-button': ['ui:sidebar-menu-button'],
  'sidebar-footer': ['ui:sidebar-footer'],
  'sidebar-inset': ['ui:sidebar-inset'],
  'sidebar-trigger': ['ui:sidebar-trigger'],
} as const;

/**
 * The seven bare keys objectui#11440's first pull request ARMED (the seat
 * ruling `5945530142`, as amended by `5945583855`), each mapped to its
 * namespaced twins. A twin is a separate registry key with its own literal, so
 * arming the bare key does not arm it: each twin is still refused at `type`,
 * and `NAMESPACED_REFUSED_AT_TYPE` does not move. The three page kinds are
 * registered in the `ui` namespace by `@object-ui/components`.
 */
const ARMED_11440 = {
  home: ['ui:home'],
  record: ['ui:record'],
  utility: ['ui:utility'],
  'app-schema-renderer': ['layout:app-schema-renderer'],
  'object-pivot': ['plugin-dashboard:object-pivot'],
  'embeddable-form': ['plugin-form:embeddable-form'],
  'detail-section': ['plugin-detail:detail-section'],
} as const;

/**
 * The bare key objectui#11440's second pull request RETIRED by unregistration
 * (the seat ruling `5945530142`: the capability passes, the spelling is an
 * alias of `report`), mapped to the namespaced twin that went with it.
 */
const UNREGISTERED_11440 = {
  'spec-report': ['plugin-report:spec-report'],
} as const;

/**
 * Every bare key still refused at `type` after objectui#11440 — none. The
 * `REFUSED_AT_TYPE` docblock says how each of the last eight left.
 */
const STILL_REFUSED_10859: readonly string[] = [];

/** Is `type` unclaimed by every arm of the validator's root union? */
function refusedAtType(type: string): boolean {
  const result = validateAuthoredDocument({ type });
  if (result.success) return false;
  return result.error.issues.some(
    (issue) => issue.code === 'invalid_union' && issue.path.length === 1 && issue.path[0] === 'type',
  );
}

describe('registered component types refused at `type` — a ratchet (objectui#10859)', () => {
  it('the refused count equals the pin, and only ever falls', () => {
    const refused = BARE_KEYS.filter(refusedAtType);
    expect(
      refused.length,
      [
        `\`objectui validate\` refuses ${refused.length} registered bare key(s) at \`type\`; the pin is ${REFUSED_AT_TYPE}.`,
        refused.length < REFUSED_AT_TYPE
          ? `Fewer than the pin — an arm landed. LOWER \`REFUSED_AT_TYPE\` to ${refused.length} in this same change (objectui#10859).`
          : 'MORE than the pin — a registered key lost its arm or a registration landed without one. '
            + 'Arm it in `@object-ui/types/zod` (or take its authorability to objectui#10859); ⛔ never raise the pin.',
        `Refused: ${refused.join(', ')}`,
      ].join('\n'),
    ).toBe(REFUSED_AT_TYPE);
  });

  it('reads the whole generated population, not a fragment of it (non-vacuity)', () => {
    // The card's measurement was over this same population; a filter that
    // matched nothing would make the count above trivially small. (The floor
    // was 200 until objectui#10859 batch 8 unregistered thirty bare keys.)
    expect(BARE_KEYS.length).toBeGreaterThan(150);
    expect(BARE_KEYS).toContain('timeline');
    expect(BARE_KEYS).toContain('ai-form-assist');
  });

  it('tells a claimed type from an unclaimed one — both instrument controls fire', () => {
    // Lit control: an armed, registered key is not refused at `type`.
    expect(refusedAtType('timeline')).toBe(false);
    // A key whose arm wants a required member fails, but NOT at `type`.
    expect(validateAuthoredDocument({ type: 'chart' }).success).toBe(false);
    expect(refusedAtType('chart')).toBe(false);
    // And a type no arm claims IS refused there.
    expect(refusedAtType('no-such-component-10859')).toBe(true);
  });

  it('counts the three plugin-ai keys as armed (objectui#10859 batch 1)', () => {
    for (const key of ['ai-form-assist', 'ai-recommendations', 'nl-query']) {
      expect(BARE_KEYS, key).toContain(key);
      expect(refusedAtType(key), key).toBe(false);
    }
  });

  it('counts the three keys batch 2 armed (objectui#10859 batch 2)', () => {
    for (const key of ['pivot', 'object-metric', 'object-master-detail-form']) {
      expect(BARE_KEYS, key).toContain(key);
      expect(refusedAtType(key), key).toBe(false);
    }
  });

  it('counts the key batch 3 armed (objectui#10859 batch 3)', () => {
    expect(BARE_KEYS).toContain('object-timeline');
    expect(refusedAtType('object-timeline')).toBe(false);
  });

  it('counts the six designer keys batch 7 armed (objectui#10859 batch 7)', () => {
    for (const key of [
      'page-designer', 'data-model-designer', 'process-designer',
      'report-designer', 'object-manager', 'field-designer',
    ]) {
      expect(BARE_KEYS, key).toContain(key);
      expect(refusedAtType(key), key).toBe(false);
    }
  });

  it('counts the thirty keys batch 8 retired as gone from the registry (objectui#10859 batch 8)', () => {
    // Retired, not armed: each key left the generated population, so it can
    // neither be refused nor pass. Still refused at `type` — no arm was added.
    for (const key of RETIRED_BARE_KEYS_10859_BATCH_8) {
      expect(BARE_KEYS, key).not.toContain(key);
      expect(refusedAtType(key), key).toBe(true);
    }
    // The field widgets themselves stay registered, under `field:TYPE` only.
    for (const key of RETIRED_FIELD_FALLBACKS_10859_BATCH_8) {
      expect(NAMESPACED_KEYS, `field:${key}`).toContain(`field:${key}`);
    }
    // The aliases' namespaced twins went with them; the canonical blocks stay.
    expect(NAMESPACED_KEYS).not.toContain('view:tree');
    expect(NAMESPACED_KEYS).not.toContain('plugin-view:view');
    expect(BARE_KEYS).toContain('object-tree');
    expect(BARE_KEYS).toContain('object-view');
  });

  it('counts the twelve keys batch 8 phase 2b retired as gone from the registry (objectui#10859 batch 8)', () => {
    expect(RETIRED_BARE_KEYS_10859_BATCH_8_PHASE_2B).toHaveLength(12);
    // Retired, not armed: each bare key left the population and is still
    // refused at `type`, because no arm was added.
    for (const key of RETIRED_BARE_KEYS_10859_BATCH_8_PHASE_2B) {
      expect(BARE_KEYS, key).not.toContain(key);
      expect(refusedAtType(key), key).toBe(true);
    }
    // Unregistered: the namespaced twin went too.
    for (const twin of Object.values(UNREGISTERED_10859_BATCH_8_PHASE_2B)) {
      expect(NAMESPACED_KEYS, twin).not.toContain(twin);
    }
    // `skipFallback`: the namespaced key the dashboard surfaces emit stays.
    for (const kept of Object.values(SKIP_FALLBACK_10859_BATCH_8_PHASE_2B)) {
      expect(NAMESPACED_KEYS, kept).toContain(kept);
    }
    // Lit controls: the canonical spellings the retirements point authors to.
    expect(BARE_KEYS).toContain('chart');
    expect(BARE_KEYS).toContain('dashboard');
    expect(NAMESPACED_KEYS).toContain('record:related_list');
  });

  it('counts the four keys batch 8 phase 2c retired as gone from the registry (objectui#10859 batch 8)', () => {
    expect(Object.keys(UNREGISTERED_10859_BATCH_8_PHASE_2C)).toHaveLength(4);
    for (const [key, twins] of Object.entries(UNREGISTERED_10859_BATCH_8_PHASE_2C)) {
      // Retired, not armed: out of the population, still refused at `type`.
      expect(BARE_KEYS, key).not.toContain(key);
      expect(refusedAtType(key), key).toBe(true);
      for (const twin of twins) expect(NAMESPACED_KEYS, twin).not.toContain(twin);
    }
    // Lit controls: the spellings the retirements point authors to.
    expect(BARE_KEYS).toContain('chart');
    expect(refusedAtType('chart')).toBe(false);
    expect(NAMESPACED_KEYS).toContain('page:header');
    expect(refusedAtType('page:header')).toBe(false);
  });

  it('counts the two keys objectui#11441 retired as gone from the registry (objectui#10859)', () => {
    expect(Object.keys(UNREGISTERED_11441)).toHaveLength(2);
    for (const [key, twins] of Object.entries(UNREGISTERED_11441)) {
      // Retired, not armed: out of the population, still refused at `type`.
      expect(BARE_KEYS, key).not.toContain(key);
      expect(refusedAtType(key), key).toBe(true);
      for (const twin of twins) expect(NAMESPACED_KEYS, twin).not.toContain(twin);
    }
    // Lit controls: `grid`, the spelling the `responsive-grid` retirement
    // points authors to, is registered and claimed; `app-schema-renderer`, the
    // whole-shell door navigation goes through, stays registered (armed since
    // objectui#11440).
    expect(BARE_KEYS).toContain('grid');
    expect(refusedAtType('grid')).toBe(false);
    expect(BARE_KEYS).toContain('app-schema-renderer');
    expect(NAMESPACED_KEYS).toContain('layout:app-schema-renderer');
  });

  it('counts the ten keys batch 8 phase 2d retired as gone from the registry (objectui#10859 batch 8)', () => {
    expect(Object.keys(UNREGISTERED_10859_BATCH_8_PHASE_2D)).toHaveLength(10);
    for (const [key, twins] of Object.entries(UNREGISTERED_10859_BATCH_8_PHASE_2D)) {
      // Retired, not armed: out of the population, still refused at `type`.
      expect(BARE_KEYS, key).not.toContain(key);
      expect(refusedAtType(key), key).toBe(true);
      for (const twin of twins) expect(NAMESPACED_KEYS, twin).not.toContain(twin);
    }
    // Lit controls: the node the retirement points authors to is registered
    // and claimed by an arm. Its `ui:sidebar` twin stays registered too; it is
    // one of the namespaced keys objectui#10872 still counts as refused, so
    // only its presence is asserted here.
    expect(BARE_KEYS).toContain('sidebar');
    expect(refusedAtType('sidebar')).toBe(false);
    expect(NAMESPACED_KEYS).toContain('ui:sidebar');
  });

  it('counts the seven keys objectui#11440 armed, and none of their namespaced twins (objectui#10859)', () => {
    expect(Object.keys(ARMED_11440)).toHaveLength(7);
    for (const [key, twins] of Object.entries(ARMED_11440)) {
      // Armed: still registered, and claimed by an arm.
      expect(BARE_KEYS, key).toContain(key);
      expect(refusedAtType(key), key).toBe(false);
      // The twin is its own literal, so the bare arm does not claim it.
      for (const twin of twins) {
        expect(NAMESPACED_KEYS, twin).toContain(twin);
        expect(refusedAtType(twin), twin).toBe(true);
      }
    }
  });

  it('counts the key objectui#11440 retired as gone from the registry (objectui#10859)', () => {
    expect(Object.keys(UNREGISTERED_11440)).toHaveLength(1);
    for (const [key, twins] of Object.entries(UNREGISTERED_11440)) {
      // Retired, not armed: out of the population, still refused at `type`.
      expect(BARE_KEYS, key).not.toContain(key);
      expect(refusedAtType(key), key).toBe(true);
      for (const twin of twins) expect(NAMESPACED_KEYS, twin).not.toContain(twin);
    }
    // Lit controls: `report`, the spelling the retirement points authors to, is
    // registered and claimed, and its wrapper shape, the one `spec-report`
    // carried, validates on the face `objectui validate` runs.
    expect(BARE_KEYS).toContain('report');
    expect(refusedAtType('report')).toBe(false);
    const wrapper = {
      type: 'report',
      report: { name: 'opp_by_stage', label: 'Opportunities by Stage', type: 'summary', dataset: 'pipeline', rows: ['stage'], values: ['amount_sum'] },
    };
    expect(validateAuthoredDocument(wrapper).success).toBe(true);
  });

  it('the refused set is exactly the named remainder — the pin comment cannot drift (objectui#10859 batch 8)', () => {
    const refused = BARE_KEYS.filter(refusedAtType).sort();
    expect(refused).toEqual([...STILL_REFUSED_10859]);
    expect(STILL_REFUSED_10859).toHaveLength(REFUSED_AT_TYPE);
    // Lit control (objectui#11440): the remainder is empty, so prove the same
    // filter over the same population still fires — one unregistered key added
    // to it is the one key it returns.
    const probe = 'no-such-component-11440';
    expect([...BARE_KEYS, probe].filter(refusedAtType)).toEqual([probe]);
  });
});

describe('registered NAMESPACED component types refused at `type` — a ratchet (objectui#10872)', () => {
  it('the refused count equals the pin, and only ever falls', () => {
    const refused = NAMESPACED_POPULATION.filter(refusedAtType);
    expect(
      refused.length,
      [
        `\`objectui validate\` refuses ${refused.length} registered namespaced key(s) at \`type\`; the pin is ${NAMESPACED_REFUSED_AT_TYPE}.`,
        refused.length < NAMESPACED_REFUSED_AT_TYPE
          ? `Fewer than the pin — an arm landed. LOWER \`NAMESPACED_REFUSED_AT_TYPE\` to ${refused.length} in this same change (objectui#10872).`
          : 'MORE than the pin — a registered key lost its arm or a registration landed without one. '
            + 'Arm it in `@object-ui/types/zod` (or take its authorability to objectui#10872); ⛔ never raise the pin.',
        `Refused: ${refused.join(', ')}`,
      ].join('\n'),
    ).toBe(NAMESPACED_REFUSED_AT_TYPE);
  });

  it('reads the whole generated namespaced population (non-vacuity)', () => {
    // The floor was 400 until objectui#10859 batch 8 phase 2d unregistered the
    // ten `ui:sidebar-*` twins (391 namespaced keys once objectui#11441 had
    // unregistered its two `layout:` twins as well).
    expect(NAMESPACED_KEYS.length).toBeGreaterThan(350);
    // The counted population is that list less its `field:` keys
    // (objectui#12176): one namespace fewer, not a filter that matched nothing.
    expect(NAMESPACED_POPULATION.length).toBeGreaterThan(300);
    // Lit control: the one namespaced key armed before objectui#10872.
    expect(NAMESPACED_POPULATION).toContain('ui:calendar');
    expect(refusedAtType('ui:calendar')).toBe(false);
    // And a namespaced key no arm claims IS refused there.
    expect(refusedAtType('no-such-namespace:component-10872')).toBe(true);
  });

  it('counts the public blocks objectui#10872 batch 1 armed', () => {
    for (const key of ARMED_PUBLIC_BLOCKS_10872) {
      expect(NAMESPACED_KEYS, key).toContain(key);
      expect(refusedAtType(key), key).toBe(false);
    }
  });

  it('counts the public block objectui#10872 batch 2 armed', () => {
    for (const key of ARMED_PUBLIC_BLOCKS_10872_BATCH_2) {
      expect(NAMESPACED_KEYS, key).toContain(key);
      expect(refusedAtType(key), key).toBe(false);
    }
  });

  it('counts the six public blocks objectui#10872 batch 4 armed', () => {
    for (const key of ARMED_PUBLIC_BLOCKS_10872_BATCH_4) {
      expect(NAMESPACED_KEYS, key).toContain(key);
      expect(refusedAtType(key), key).toBe(false);
    }
  });

  it('counts `record:line_items` armed — the last public block held (objectui#10872)', () => {
    for (const key of ARMED_PUBLIC_BLOCKS_10872_LINE_ITEMS) {
      expect(NAMESPACED_KEYS, key).toContain(key);
      expect(refusedAtType(key), key).toBe(false);
    }
    // Registered with `skipFallback: true`, so the namespaced key is its only
    // spelling: it left the namespaced count and no bare twin moved.
    expect(BARE_KEYS).not.toContain('line_items');
  });

  it('refuses `cloud:plan-status` BY NAME at `type` — its registration left and its arm became a refusal (objectui#12954)', () => {
    // It was one registry key, armed, so the pair leaving in one change moves
    // neither count. The arm stays as `retiredNodeType()`'s refusal (the
    // objectui#8802 shape), so the strict face answers with a `custom` issue
    // naming the remedy — not the generic `invalid_union` `refusedAtType` reads.
    expect(NAMESPACED_KEYS).not.toContain('cloud:plan-status');
    const result = validateAuthoredDocument({ type: 'cloud:plan-status', properties: { plan: 'free' } });
    expect(result.success).toBe(false);
    const named = (result.success ? [] : result.error.issues).filter(
      (issue) => issue.code === 'custom' && issue.path.length === 1 && issue.path[0] === 'type',
    );
    expect(named).toHaveLength(1);
    expect(named[0]?.message).toContain('visibleWhen');
    expect(refusedAtType('cloud:plan-status')).toBe(false);
    // Control: an unknown `cloud:` literal still takes the generic path.
    expect(refusedAtType('cloud:no-such-widget-12954')).toBe(true);
  });

  it('refuses `html` BY NAME at `type` — its registration left and its arm became a refusal (objectui#13449)', () => {
    // The bare key was armed and `ui:html` was not, so the bare count did not
    // move and the namespaced pin above fell by one. The arm stays as
    // `retiredNodeType()`'s refusal, so the strict face — the one `objectui
    // validate` judges through — answers with a `custom` issue at `type`, not
    // the generic `invalid_union` `refusedAtType` reads.
    expect(BARE_KEYS).not.toContain('html');
    expect(NAMESPACED_KEYS).not.toContain('ui:html');
    const result = validateAuthoredDocument({ type: 'html', html: '<p>x</p>' });
    expect(result.success).toBe(false);
    const named = (result.success ? [] : result.error.issues).filter(
      (issue) => issue.code === 'custom' && issue.path.length === 1 && issue.path[0] === 'type',
    );
    expect(named).toHaveLength(1);
    expect(named[0]?.message).toContain('`html` is a RETIRED node type');
    expect(refusedAtType('html')).toBe(false);
    // Control: an unknown bare literal still takes the generic path.
    expect(refusedAtType('no-such-node-13449')).toBe(true);
  });

  it('counts `cloud:workspace-timezone-notice` armed — it registered WITH its arm (objectui#11930)', () => {
    // One registry key (`skipFallback: true`, so no bare `workspace-timezone-notice`),
    // armed in `@object-ui/types/zod` in the same change, so the pin above did not move.
    expect(NAMESPACED_KEYS).toContain('cloud:workspace-timezone-notice');
    expect(BARE_KEYS).not.toContain('workspace-timezone-notice');
    expect(refusedAtType('cloud:workspace-timezone-notice')).toBe(false);
  });

  it('counts `record:approval_decision` armed — it registered WITH its arm (objectui#12342)', () => {
    // One registry key (`skipFallback: true`, so no bare `approval_decision`),
    // armed in `@object-ui/types/zod` in the same change, so the pin above did not move.
    // Its two spec-18 siblings were armed after it (objectui#12363, the row below).
    expect(NAMESPACED_KEYS).toContain('record:approval_decision');
    expect(BARE_KEYS).not.toContain('approval_decision');
    expect(refusedAtType('record:approval_decision')).toBe(false);
  });

  it('counts `record:approvals` and `record:attachments` armed — the pin fell by two (objectui#12363)', () => {
    // Registered (`skipFallback: true`, so no bare twin) before they had arms,
    // so both sat inside the count; their arms in `@object-ui/types/zod` took
    // the pin down by exactly these two.
    for (const key of ['record:approvals', 'record:attachments']) {
      expect(NAMESPACED_KEYS, key).toContain(key);
      expect(BARE_KEYS, key).not.toContain(key.slice('record:'.length));
      expect(refusedAtType(key), key).toBe(false);
    }
    // Lit control: an unclaimed `record:` literal is still refused at `type`.
    expect(refusedAtType('record:no_such_panel_12363')).toBe(true);
  });

  it('leaves a newly registered `field:` widget out of the count (objectui#12176)', () => {
    // A field widget registers with no arm, as every one does. Lit control: the
    // probe is refused at `type`, so it would count if it reached the
    // population. It does not, so the refused set, and the pin, stay put.
    const probe = 'field:no-such-widget-12176';
    expect(refusedAtType(probe)).toBe(true);
    const population = namespacedPopulation([...KNOWN_SCHEMA_TYPES, probe]);
    expect(population).not.toContain(probe);
    expect(population.filter(refusedAtType)).toEqual(NAMESPACED_POPULATION.filter(refusedAtType));
  });

  it('still counts a newly registered non-`field:` namespaced key with no arm — the control (objectui#12176)', () => {
    // The exclusion is the `field:` namespace and nothing wider: any other
    // namespaced registration without an arm is one more refused key, which
    // the count row above reads as MORE than the pin.
    const probe = 'view:no-such-view-12176';
    const head = NAMESPACED_POPULATION.filter(refusedAtType);
    expect(namespacedPopulation([...KNOWN_SCHEMA_TYPES, probe]).filter(refusedAtType)).toEqual([...head, probe]);
  });
});

/* ── End to end: the README document through `objectui validate` ─────────── */

/** Rooted on this file, never on `process.cwd()`. */
const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_AI_README = join(HERE, '..', '..', '..', 'plugin-ai', 'README.md');
const QUICK_START = join(HERE, '..', '..', '..', '..', 'content', 'docs', 'guide', 'quick-start.md');

/** See `validate-root-path-line.test.ts` — the escape byte is never spelled. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

let dir: string;
let out: string[];
let exitCodes: number[];
let restore: () => void;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'objectui-validate-10859-'));
  out = [];
  exitCodes = [];
  const originalLog = console.log;
  const originalError = console.error;
  const capture = (...args: unknown[]) => {
    out.push(args.map(String).join(' '));
  };
  console.log = capture;
  console.error = capture;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCodes.push(code ?? 0);
    return undefined as never;
  }) as never);
  restore = () => {
    console.log = originalLog;
    console.error = originalError;
    exitSpy.mockRestore();
  };
});

afterEach(() => {
  restore();
  rmSync(dir, { recursive: true, force: true });
});

describe('objectui validate — the plugin-ai README document (objectui#10859)', () => {
  it('validates the "Schema-Driven Usage" `ai-form-assist` document', async () => {
    const readme = readFileSync(PLUGIN_AI_README, 'utf8');
    const section = readme.slice(readme.indexOf('## Schema-Driven Usage'));
    const fence = /```json\n([\s\S]*?)\n```/.exec(section);
    expect(fence, 'no ```json fence under "## Schema-Driven Usage"').not.toBeNull();
    const file = join(dir, 'ai-form-assist.json');
    writeFileSync(file, (fence as RegExpExecArray)[1], 'utf-8');
    // Lit control on the extraction: it is the taught node.
    expect(JSON.parse((fence as RegExpExecArray)[1]).type).toBe('ai-form-assist');

    await validate(file);

    const text = out.join('\n').replace(ANSI, '');
    expect(text).not.toContain('Schema validation failed');
    expect(text).toContain('Schema is valid');
    expect(exitCodes).toEqual([0]);
  });
});

/* ── End to end: a page of public blocks through `objectui validate` ─────── */

describe('objectui validate — a page built from ADR-0080 public blocks (objectui#10872)', () => {
  it('validates a page of `page:header`, `record:details` and `element:text`', async () => {
    // Each block in the spelling the platform's own producers write — the
    // spec's `{ type, properties }` bag (`buildDefaultPageSchema`'s
    // `componentNode`, the page designer) — with one bare node, which is the
    // synthesizer's shape for a block it configures nothing on.
    const page = {
      type: 'page',
      title: 'Account',
      children: [
        { type: 'page:header', properties: { title: 'Account', subtitle: 'Customer' } },
        { type: 'record:details' },
        { type: 'element:text', properties: { content: 'Recent activity' } },
      ],
    };
    const file = join(dir, 'public-blocks-page.json');
    writeFileSync(file, JSON.stringify(page, null, 2), 'utf-8');

    await validate(file);

    const text = out.join('\n').replace(ANSI, '');
    expect(text).not.toContain('Schema validation failed');
    expect(text).toContain('Schema is valid');
    expect(exitCodes).toEqual([0]);
  });

  it('still judges a public block\'s bag — an undeclared prop is refused and named', async () => {
    // The control that keeps the row above from passing for the wrong reason:
    // the same page with one invented prop on a nested block fails.
    const page = {
      type: 'page',
      children: [{ type: 'page:header', properties: { title: 'Account', inventedProp10872: true } }],
    };
    const file = join(dir, 'public-blocks-page-refused.json');
    writeFileSync(file, JSON.stringify(page, null, 2), 'utf-8');

    await validate(file);

    const text = out.join('\n').replace(ANSI, '');
    expect(text).toContain('Schema validation failed');
    expect(text).toContain('inventedProp10872');
    expect(exitCodes).toEqual([1]);
  });

  it('validates `element:number` in its binding form (objectui#10872 batch 2, objectui#12030)', async () => {
    // The `dataSource` form, the one form since `@objectstack/spec` 18 retired the
    // flat `properties.object` (objectui#12030).
    const page = {
      type: 'page',
      children: [
        { type: 'element:number', dataSource: { object: 'order' }, properties: { aggregate: 'count' } },
        { type: 'element:number', dataSource: { object: 'order' }, properties: { aggregate: 'sum', field: 'total' } },
      ],
    };
    const file = join(dir, 'element-number-page.json');
    writeFileSync(file, JSON.stringify(page, null, 2), 'utf-8');

    await validate(file);

    const text = out.join('\n').replace(ANSI, '');
    expect(text).not.toContain('Schema validation failed');
    expect(text).toContain('Schema is valid');
    expect(exitCodes).toEqual([0]);
  });

  it('refuses an `element:number` that writes the retired flat `properties.object`', async () => {
    // The control that keeps the row above from passing for the wrong reason:
    // the same block with its object in the bag, which `@objectstack/spec` 18
    // refuses by name and points at `dataSource.object` (objectui#12030).
    const page = { type: 'page', children: [{ type: 'element:number', properties: { object: 'order', aggregate: 'count' } }] };
    const file = join(dir, 'element-number-page-refused.json');
    writeFileSync(file, JSON.stringify(page, null, 2), 'utf-8');

    await validate(file);

    const text = out.join('\n').replace(ANSI, '');
    expect(text).toContain('Schema validation failed');
    expect(text).toContain('dataSource.object');
    expect(exitCodes).toEqual([1]);
  });

  it('validates a page with the taught `action:button` node (objectui#10872 batch 4)', async () => {
    // The node the quick-start's "Add Actions" section teaches — the one
    // AGENTS.md #4 and the handler-key refusals' own remedy point at — read
    // from the page that teaches it, beside a `page:header`. Since
    // objectui#11183 the page writes it in the spec's spelling, the block's
    // props in `properties`, so this row passes on the strict face as well.
    const quickStart = readFileSync(QUICK_START, 'utf8');
    const fence = /```json\n([\s\S]*?)\n```/.exec(quickStart.slice(quickStart.indexOf('### Add Actions')));
    expect(fence, 'no ```json fence under "### Add Actions" in the quick-start').not.toBeNull();
    const taught = JSON.parse((fence as RegExpExecArray)[1]);
    // Lit control on the extraction: it is the taught node, in the bag spelling.
    expect(taught.type).toBe('action:button');
    expect(taught.properties?.actionType).toBe('url');
    expect(taught).not.toHaveProperty('actionType');
    const page = {
      type: 'page',
      title: 'Users',
      children: [{ type: 'page:header', properties: { title: 'Users' } }, taught],
    };
    const file = join(dir, 'action-button-page.json');
    writeFileSync(file, JSON.stringify(page, null, 2), 'utf-8');

    await validate(file);

    const text = out.join('\n').replace(ANSI, '');
    expect(text).not.toContain('Schema validation failed');
    expect(text).toContain('Schema is valid');
    expect(exitCodes).toEqual([0]);
  });

  it('validates a page of the six batch-4 blocks in the spec\'s `properties` spelling', async () => {
    const page = {
      type: 'page',
      children: [
        { type: 'action:button', properties: { label: 'Open details', actionType: 'url', target: '/users/ada' } },
        { type: 'action:icon', properties: { icon: 'pencil', label: 'Edit', actionType: 'url', target: '/users/ada/edit' } },
        { type: 'action:group', properties: { display: 'dropdown', actions: [{ name: 'archive', label: 'Archive' }] } },
        { type: 'action:menu', properties: { actions: [{ name: 'delete', label: 'Delete' }] } },
        { type: 'element:definition-list', properties: { columns: 2, items: [{ term: 'Owner', description: 'Ada' }] } },
        { type: 'element:repeater', dataSource: { object: 'task', limit: 5 }, properties: { fields: ['subject'] } },
      ],
    };
    const file = join(dir, 'held-blocks-page.json');
    writeFileSync(file, JSON.stringify(page, null, 2), 'utf-8');

    await validate(file);

    const text = out.join('\n').replace(ANSI, '');
    expect(text).not.toContain('Schema validation failed');
    expect(text).toContain('Schema is valid');
    expect(exitCodes).toEqual([0]);
  });

  it('still judges an `action:button` bag — an undeclared prop is refused and named (batch 4)', async () => {
    // The control that keeps the two rows above from passing for the wrong reason.
    const page = {
      type: 'page',
      children: [{ type: 'action:button', properties: { label: 'Go', inventedProp10872b4: true } }],
    };
    const file = join(dir, 'action-button-page-refused.json');
    writeFileSync(file, JSON.stringify(page, null, 2), 'utf-8');

    await validate(file);

    const text = out.join('\n').replace(ANSI, '');
    expect(text).toContain('Schema validation failed');
    expect(text).toContain('inventedProp10872b4');
    expect(exitCodes).toEqual([1]);
  });
});
