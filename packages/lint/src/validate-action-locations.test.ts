// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ACTION_LOCATIONS } from '@objectstack/spec/ui';
import {
  validateActionLocations as validateActionLocationsUnrecorded,
  ACTION_NO_PLACEMENT,
} from './validate-action-locations.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Every call below records what it fired, and the last cases in this
// file hold each recorded `fix:` line to one line of at most 200 characters.
// Run the whole file: those cases read what the cases above fired.
const fired: Array<{ rule: string; message: string; hint: string }> = [];
const validateActionLocations: typeof validateActionLocationsUnrecorded = (...args) => {
  const findings = validateActionLocationsUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

/** A stack whose single action declares a real placement. */
const placed = () => ({
  objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
  actions: [
    {
      name: 'crm_convert_lead',
      label: 'Convert',
      type: 'script',
      locations: ['record_header'],
    },
  ],
});

/** The same action with the placement key absent. */
const unplaced = () => ({
  objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
  actions: [{ name: 'crm_convert_lead', label: 'Convert', type: 'script' }],
});

describe('validateActionLocations', () => {
  it('flags an action that declares no locations and that no view places', () => {
    const findings = validateActionLocations(unplaced());

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(ACTION_NO_PLACEMENT);
    expect(findings[0].path).toBe('actions[0]');
    expect(findings[0].where).toBe('action "crm_convert_lead"');
    expect(findings[0].message).toContain('renders on no surface');
    expect(findings[0].hint).toContain('locations: []');
  });

  it('accepts a declared placement', () => {
    expect(validateActionLocations(placed())).toEqual([]);
  });

  it('walks object-embedded actions too', () => {
    const findings = validateActionLocations({
      objects: [
        {
          name: 'crm_lead',
          actions: [{ name: 'crm_score', label: 'Score', type: 'script' }],
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[0].actions[0]');
  });

  it('ignores a nameless action — that is action-name-*’s problem, not this rule’s', () => {
    expect(validateActionLocations({ actions: [{ label: 'Nameless', type: 'script' }] })).toEqual([]);
  });

  describe('— headless actions (`locations: []`) are never flagged', () => {
    it('accepts an explicitly empty placement', () => {
      // `content/docs/ui/actions.mdx` documents the empty array as the way to
      // declare a REST/MCP/AI-callable action with no UI surface. ADR-0110 D3
      // refuses an UNdeclared handler, so this is the only legal shape for one
      // — flagging it would fight that ADR.
      const findings = validateActionLocations({
        actions: [{ name: 'crm_sync_remote', label: 'Sync', type: 'script', locations: [] }],
      });
      expect(findings).toEqual([]);
    });

    it('distinguishes "nowhere, deliberately" from an unstated placement', () => {
      const findings = validateActionLocations({
        actions: [
          { name: 'said_nowhere', type: 'script', locations: [] },
          { name: 'said_nothing', type: 'script' },
        ],
      });
      expect(findings.map((f) => f.where)).toEqual(['action "said_nothing"']);
    });
  });

  describe('— a view that places the action by NAME exempts it', () => {
    it('exempts an action named in a list view’s bulkActions', () => {
      const findings = validateActionLocations({
        ...unplaced(),
        views: [{ name: 'crm_lead', list: { bulkActions: ['crm_convert_lead'] } }],
      });
      expect(findings).toEqual([]);
    });

    it('exempts an action named in a bulkActionDefs entry (incl. aggregate defs)', () => {
      // objectui#3139: an aggregate bulk action has no single-record location
      // by construction — the view naming it IS the placement.
      const findings = validateActionLocations({
        ...unplaced(),
        views: [
          {
            name: 'crm_lead',
            list: {
              bulkActionDefs: [
                { name: 'crm_convert_lead', operation: 'custom', execution: 'aggregate' },
              ],
            },
          },
        ],
      });
      expect(findings).toEqual([]);
    });

    it('exempts an action named in rowActions', () => {
      const findings = validateActionLocations({
        ...unplaced(),
        views: [{ name: 'crm_lead', list: { rowActions: ['crm_convert_lead'] } }],
      });
      expect(findings).toEqual([]);
    });

    it('exempts via a named listViews entry, not just the default list', () => {
      const findings = validateActionLocations({
        ...unplaced(),
        views: [{ name: 'crm_lead', listViews: { hot: { bulkActions: ['crm_convert_lead'] } } }],
      });
      expect(findings).toEqual([]);
    });

    it('exempts via an OBJECT-embedded list view — an object has no top-level `list`', () => {
      const findings = validateActionLocations({
        objects: [
          {
            name: 'crm_lead',
            listViews: { all: { bulkActions: ['crm_convert_lead'] } },
          },
        ],
        actions: [{ name: 'crm_convert_lead', label: 'Convert', type: 'script' }],
      });
      expect(findings).toEqual([]);
    });

    it('still flags an action no view names, alongside one that is named', () => {
      const findings = validateActionLocations({
        actions: [
          { name: 'named_one', type: 'script' },
          { name: 'orphan_one', type: 'script' },
        ],
        views: [{ name: 'crm_lead', list: { bulkActions: ['named_one'] } }],
      });
      expect(findings.map((f) => f.where)).toEqual(['action "orphan_one"']);
    });
  });

  describe('— floor', () => {
    it('returns nothing for a clean stack', () => {
      expect(validateActionLocations(placed())).toEqual([]);
    });

    it('returns nothing for an empty stack', () => {
      expect(validateActionLocations({})).toEqual([]);
    });

    it('returns nothing for a null stack', () => {
      expect(validateActionLocations(null as unknown as Record<string, unknown>)).toEqual([]);
    });
  });
});

// [#22161] Slice 14: the `fix:` line names the three ways out in one line; the
// location vocabulary, name placement, what the headless shape keeps and why it
// is a warning are `os explain action-no-placement`, an entry this id gains.
describe('[#22161] one-line fix — action-no-placement', () => {
  it('every `fix:` line the cases above fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === ACTION_NO_PLACEMENT);
    // Coverage control: the id fired.
    expect(converted.length).toBeGreaterThan(0);
    for (const f of converted) {
      expect(f.hint, f.rule).not.toContain('\n');
      expect(f.hint.length, `${f.rule}: ${f.hint}`).toBeLessThanOrEqual(200);
    }
  });

  it('`os explain action-no-placement` carries what the `fix:` line no longer says', () => {
    const entry = explainRule(ACTION_NO_PLACEMENT);
    expect(entry, 'no `os explain action-no-placement` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    for (const fact of ['`bulkActionDefs`', '`rowActions`', 'REST, MCP and AI', 'never reported', 'ADR-0110 D3', 'another installed package']) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
  });

  it('the explanation\'s location list is the spec\'s own', () => {
    // The explanation module imports nothing, so the vocabulary it writes out
    // is held to `ACTION_LOCATIONS` here.
    const text = explainRule(ACTION_NO_PLACEMENT)!.paragraphs.join('\n');
    expect(text).toContain(`The locations an action can declare: ${ACTION_LOCATIONS.map((l) => `\`${l}\``).join(', ')}.`);
  });
});
