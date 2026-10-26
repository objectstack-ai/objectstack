/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The RENDERER half of the metadata read-warning chain (objectui#7741): an
 * event becomes the message a user without devtools can act on.
 *
 * The connection between the adapter's channel and this renderer is
 * `AdapterProvider.readWarningSink.test.tsx`'s; the classification that decides
 * whether an event exists at all is `data-objectstack`'s
 * `listImportMappings.test.ts`. This file owns only the wording and the
 * branching, over events it writes by hand.
 */

import { describe, it, expect, vi } from 'vitest';
import type { MetadataReadWarningEvent } from '@object-ui/data-objectstack';
import {
  emitMetadataReadWarning,
  type MetadataReadWarningSink,
} from './metadataReadWarningToast';

/** The provider-less English fallback, which is what `t` resolves to here. */
const t = (key: string, options?: Record<string, unknown>): string => {
  const raw = String(options?.defaultValue ?? key);
  return raw.replace(/\{\{(\w+)\}\}/g, (_m, hole: string) => String(options?.[hole] ?? `{{${hole}}}`));
};

function sink() {
  return { warning: vi.fn() } satisfies MetadataReadWarningSink;
}

const REFUSED: MetadataReadWarningEvent = {
  operation: 'listImportMappings',
  kind: 'mapping',
  objectName: 'crm_plant_cost',
  reason: 'refused',
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'authentication required',
};

describe('emitMetadataReadWarning (objectui#7741)', () => {
  it('names the object the empty list is about', () => {
    const s = sink();

    emitMetadataReadWarning(REFUSED, t, s);

    const [title] = s.warning.mock.calls[0];
    expect(title).toContain('crm_plant_cost');
  });

  it('⭐ says the list is empty because it could not be READ, not because it is empty', () => {
    // The whole point of the surface. A message that merely reported an error
    // would leave the user's actual question — "are there no saved mappings?" —
    // unanswered, which is the ambiguity that produced objectstack#14026.
    const s = sink();

    emitMetadataReadWarning(REFUSED, t, s);

    const [, options] = s.warning.mock.calls[0];
    expect(options.description).toContain('could not be read');
    expect(options.description).toContain('not because nothing is registered');
  });

  it('gives a refusal a remedy that names a person, not a retry', () => {
    const s = sink();

    emitMetadataReadWarning(REFUSED, t, s);

    const [, options] = s.warning.mock.calls[0];
    expect(options.description).toContain('Sign in again');
  });

  it('gives an unreadable answer the retry remedy instead', () => {
    const s = sink();

    emitMetadataReadWarning({ ...REFUSED, reason: 'unreadable', code: undefined, status: 500, message: 'metadata store unavailable' }, t, s);

    const [, options] = s.warning.mock.calls[0];
    expect(options.description).toContain('Try again');
    expect(options.description).not.toContain('Sign in again');
  });

  it("carries the server's own words verbatim, so the user has evidence to paste", () => {
    const s = sink();

    emitMetadataReadWarning(REFUSED, t, s);

    const [, options] = s.warning.mock.calls[0];
    expect(options.description).toContain('UNAUTHENTICATED');
    expect(options.description).toContain('HTTP 401');
    expect(options.description).toContain('authentication required');
  });

  it('adds no detail line at all when the failure declared nothing', () => {
    const s = sink();

    emitMetadataReadWarning(
      { operation: 'listImportMappings', kind: 'mapping', objectName: 'task', reason: 'unreadable' },
      t,
      s,
    );

    const [, options] = s.warning.mock.calls[0];
    // One line — the remedy — and no trailing empty parenthesis pretending the
    // server said something.
    expect(options.description).not.toContain('\n');
    expect(options.description).not.toContain('HTTP');
  });

  it('refuses an unhandled reason rather than rendering the wrong remedy', () => {
    // Unreachable for a type-checked caller; reachable for a JS one, because
    // the event type is published. The caller swallows, so the failure mode is
    // "no toast", never "a toast naming the wrong fix".
    const s = sink();

    expect(() =>
      emitMetadataReadWarning(
        { ...REFUSED, reason: 'exploded' as unknown as MetadataReadWarningEvent['reason'] },
        t,
        s,
      ),
    ).toThrow(/no remedy for reason/);
  });

  it('uses the warning tier and the long duration, like its advisory sibling', () => {
    const s = sink();

    emitMetadataReadWarning(REFUSED, t, s);

    const [, options] = s.warning.mock.calls[0];
    expect(options.duration).toBe(10_000);
  });
});

/**
 * The SECOND emitter on this channel (objectui#8151).
 *
 * `listViews` carried the same swallow one adapter method over, and adding it
 * to `MetadataReadWarningEvent`'s `operation` union is the widening
 * objectui#7741 kept that union single-member FOR. This block is that widening
 * arriving at its consumer: the pins below are about which SENTENCE a views
 * failure gets, and — just as load-bearing — about the mapping sentences not
 * moving while it happened.
 */
const VIEWS_REFUSED: MetadataReadWarningEvent = {
  operation: 'listViews',
  kind: 'view',
  objectName: 'crm_lead',
  reason: 'refused',
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'authentication required',
};

describe('emitMetadataReadWarning — the listViews emitter (objectui#8151)', () => {
  it('⭐ denies the reading the empty list invites: not "this object has no saved views"', () => {
    // The user's actual question in front of a view switcher is "where did my
    // views go?" — so the sentence has to answer THAT, not the import wizard's
    // question about whether anything is registered.
    const s = sink();

    emitMetadataReadWarning(VIEWS_REFUSED, t, s);

    const [title, options] = s.warning.mock.calls[0];
    expect(title).toBe('Saved views for crm_lead could not be loaded');
    expect(options.description).toContain('could not be read');
    expect(options.description).toContain('no saved views');
    expect(options.description).toContain('Sign in again');
  });

  it('⛔ never renders the import-mapping wording for a views failure', () => {
    // The exact runtime lie the closed `operation` union existed to prevent:
    // before this card the title was one hard-coded `importMappingsUnavailable`,
    // so a second emitter would have toasted "Saved import mappings for
    // crm_lead could not be loaded" with nothing failing to compile.
    const s = sink();

    emitMetadataReadWarning(VIEWS_REFUSED, t, s);

    const [title, options] = s.warning.mock.calls[0];
    expect(title).not.toContain('import');
    expect(String(options.description)).not.toContain('registered');
  });

  it('says retry-and-report on an unreadable views answer', () => {
    const s = sink();

    emitMetadataReadWarning({ ...VIEWS_REFUSED, reason: 'unreadable', code: undefined, status: 500 }, t, s);

    const [, options] = s.warning.mock.calls[0];
    expect(options.description).toContain('no saved views');
    expect(options.description).toContain('Try again');
    expect(options.description).not.toContain('Sign in again');
  });

  it("carries the server's own words on this arm too", () => {
    const s = sink();

    emitMetadataReadWarning(VIEWS_REFUSED, t, s);

    const [, options] = s.warning.mock.calls[0];
    expect(options.description).toContain('UNAUTHENTICATED');
    expect(options.description).toContain('HTTP 401');
  });

  it('refuses an unhandled operation rather than rendering another read’s sentence', () => {
    // Same discipline as the unhandled-reason pin, one level up. Unreachable
    // for a type-checked caller; reachable for a JS one.
    const s = sink();

    expect(() =>
      emitMetadataReadWarning(
        {
          ...VIEWS_REFUSED,
          operation: 'listSomethingElse' as unknown as MetadataReadWarningEvent['operation'],
        },
        t,
        s,
      ),
    ).toThrow(/no title for operation/);
  });

  it('⭐ THE LIT CONTROL — the import-mapping copy is byte-identical to what objectui#7741 shipped', () => {
    // A widening that quietly reworded the sibling's toast would pass every
    // pin above. These three strings are the ones objectui#7741 put in `en`,
    // asserted whole rather than by substring.
    const s = sink();

    emitMetadataReadWarning(REFUSED, t, s);

    const [title, options] = s.warning.mock.calls[0];
    expect(title).toBe('Saved import mappings for crm_plant_cost could not be loaded');
    expect(String(options.description).split('\n')[0]).toBe(
      'The server refused this request, so this list is empty because it could not be read — not because nothing is registered. Sign in again, or ask an administrator for access.',
    );

    const s2 = sink();
    emitMetadataReadWarning({ ...REFUSED, reason: 'unreadable', code: undefined, status: undefined, message: undefined }, t, s2);
    const [, options2] = s2.warning.mock.calls[0];
    expect(options2.description).toBe(
      'This list is empty because it could not be read, not because nothing is registered. Try again, and report this if it keeps happening.',
    );
  });
});
