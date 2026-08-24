// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Detector unit tests for `page-envelope-audit.ts` (#11255 → #11480).
 *
 * The detector's behaviour is tested ONCE, here at its home: these are the
 * negative controls and door-necessity proofs that landed with the first
 * consuming gate (`packages/platform-objects/src/pages/
 * canonical-expression-envelopes.test.ts`) and moved when the detector was
 * extracted. What stays in each consuming package is what only that package
 * can assert: its population scan, its per-page precondition asserts, and a
 * downgrade control over one of its own SHIPPED pages — proof the imported
 * detector actually reaches that package's exports.
 *
 * Two families below:
 *
 *  - **negative controls** — the detector fires on a bare predicate (and only
 *    on a bare one), naming page + key path, at every position class: a
 *    top-level slot component, a component nested inside `properties`, the
 *    opaque props bag itself, and the deprecated `visibility` alias.
 *  - **door-necessity proofs** — each parse door catches a position the
 *    others cannot see, shown by running the other doors in isolation over
 *    the same fixture and getting nothing. `collectBare` is exported (module-
 *    level, not from the barrel) exactly for these single-door runs.
 */

import { describe, expect, it } from 'vitest';
import { PageComponentSchema, PageSchema } from '@objectstack/spec/ui';
import { walkPageComponents } from './page-walk.js';
import {
  auditPageExpressionEnvelopes,
  collectBare,
  renderBareExpressionFindings,
} from './page-envelope-audit.js';
import type { BareExpressionFinding } from './page-envelope-audit.js';

type AnyRec = Record<string, unknown>;

/** The minimal zod face the doors are driven through in the isolation runs. */
interface Parseable {
  safeParse(value: unknown): { success: boolean; data?: unknown };
}

const BARE = 'has(record.id) && record.id == ctx.user.id';

/** A page whose ONE predicate sits on a top-level slot component. */
function topLevelPredicatePage(visibleWhen: unknown): AnyRec {
  return {
    name: 'nc_top_level',
    label: 'Negative control',
    type: 'record',
    object: 'sys_user',
    template: 'default',
    kind: 'slotted',
    regions: [],
    slots: { alerts: [{ type: 'record:alert', visibleWhen, properties: { severity: 'warning' } }] },
  };
}

/** A page whose ONE predicate sits on a component NESTED inside `properties`. */
function nestedPredicatePage(visibleWhen: unknown): AnyRec {
  return {
    name: 'nc_nested',
    label: 'Negative control',
    type: 'record',
    object: 'sys_user',
    template: 'default',
    kind: 'slotted',
    regions: [],
    slots: {
      tabs: {
        type: 'page:tabs',
        properties: {
          items: [
            {
              label: { en: 'Tab' },
              children: [{ type: 'record:alert', visibleWhen, properties: { severity: 'warning' } }],
            },
          ],
        },
      },
    },
  };
}

/** A page whose ONE predicate sits INSIDE the opaque `properties` bag. */
function propsPredicatePage(visible: unknown): AnyRec {
  return {
    name: 'nc_props',
    label: 'Negative control',
    type: 'record',
    object: 'sys_user',
    template: 'default',
    kind: 'slotted',
    regions: [],
    slots: { alerts: [{ type: 'record:alert', properties: { severity: 'warning', visible } }] },
  };
}

const envelope = { dialect: 'cel' as const, source: BARE };

describe('negative control — the detector fires, and every door earns its place', () => {
  it('catches a bare predicate on a top-level component, naming page and key path', () => {
    const audit = auditPageExpressionEnvelopes(topLevelPredicatePage(BARE), 'nc (nc_top_level)');
    expect(audit.findings).toHaveLength(1);
    expect(audit.findings[0]!.path).toBe('slots.alerts[0].visibleWhen');
    expect(audit.findings[0]!.authored).toBe(BARE);

    const rendered = renderBareExpressionFindings(audit.findings);
    expect(rendered).toContain('nc_top_level');
    expect(rendered).toContain('slots.alerts[0].visibleWhen');
    expect(rendered).toContain('authored BARE');
  });

  it('passes the SAME predicate authored as the canonical envelope (no blanket flagging)', () => {
    const audit = auditPageExpressionEnvelopes(topLevelPredicatePage(envelope), 'nc (nc_top_level)');
    expect(renderBareExpressionFindings(audit.findings)).toBe('');
    // The preconditions hold on the control fixtures too, so a green above is a
    // real verdict rather than a door that never opened.
    expect(audit.pageParseError ?? '').toBe('');
    expect(audit.componentParseErrors).toEqual([]);
  });

  it('catches a bare predicate on a component NESTED inside `properties` — which door 1 alone cannot see', () => {
    const page = nestedPredicatePage(BARE);
    const audit = auditPageExpressionEnvelopes(page, 'nc (nc_nested)');
    expect(audit.findings.map(f => f.path)).toEqual([
      'slots.tabs.properties.items[0].children[0].visibleWhen',
    ]);
    expect(audit.findings[0]!.door).toBe('PageComponentSchema');

    // Door 1 in isolation: `PageSchema` serves `properties` verbatim, so the
    // nested predicate is still a bare string in its own output — nothing to
    // compare against, nothing found. This is why door 2 exists.
    const doorOneOnly: BareExpressionFinding[] = [];
    const parsed = (PageSchema as unknown as Parseable).safeParse(page);
    expect(parsed.success).toBe(true);
    collectBare(page, parsed.data, '', 'nc', 'PageSchema', doorOneOnly);
    expect(doorOneOnly).toEqual([]);
  });

  it('catches a bare predicate inside the `properties` bag — which doors 1 and 2 alone cannot see', () => {
    const page = propsPredicatePage(BARE);
    const audit = auditPageExpressionEnvelopes(page, 'nc (nc_props)');
    expect(audit.findings.map(f => f.path)).toEqual([
      'slots.alerts[0].properties.visible',
    ]);
    expect(audit.findings[0]!.door).toBe('ComponentPropsMap');

    // Doors 1 and 2 both treat `properties` as an opaque record.
    const doorsOneTwo: BareExpressionFinding[] = [];
    const parsedPage = (PageSchema as unknown as Parseable).safeParse(page);
    collectBare(page, parsedPage.data, '', 'nc', 'PageSchema', doorsOneTwo);
    for (const { component, path } of walkPageComponents(page, '')) {
      const parsedComponent = (PageComponentSchema as unknown as Parseable).safeParse(component);
      collectBare(component, parsedComponent.data, path.replace(/^\./, ''), 'nc', 'PageComponentSchema', doorsOneTwo);
    }
    expect(doorsOneTwo).toEqual([]);
  });

  it('catches a bare predicate at the DEPRECATED `visibility` key and names the canonical one', () => {
    const page = {
      name: 'nc_alias',
      label: 'Negative control',
      type: 'record',
      object: 'sys_user',
      template: 'default',
      kind: 'slotted',
      regions: [],
      slots: { alerts: [{ type: 'record:alert', visibility: BARE, properties: { severity: 'warning' } }] },
    };
    const audit = auditPageExpressionEnvelopes(page, 'nc (nc_alias)');
    expect(audit.findings.map(f => f.path)).toEqual(['slots.alerts[0].visibility']);
    expect(audit.findings[0]!.normalizedTo).toBe('visibleWhen');
    expect(renderBareExpressionFindings(audit.findings)).toContain('deprecated key');
  });
});
