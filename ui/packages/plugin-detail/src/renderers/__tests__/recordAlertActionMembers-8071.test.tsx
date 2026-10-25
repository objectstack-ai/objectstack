/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `record:alert.action` — the CTA's MEMBER shape (objectui#8071)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The per-block member pin objectui#8068 asks for on this key. `action` is
 * declared as a bare `type: 'object'` whose member set lives only in the
 * registration's description — `{ actionName, label?, variant? }` — and until
 * this file nothing asserted which of those three `record-alert.tsx` reads or
 * what each one decides.
 *
 * ## Why the existing `record:alert` suites are not this pin
 *
 * All six were read end to end before this file was written rather than
 * credited on a grep. `record-alert.resultDialog.test.tsx` mounts
 * `action: { actionName, label }` and is nonetheless about something else
 * entirely: whether `ActionRunner.handlePostExecution` honours the ACTION
 * DEFINITION's `resultDialog` through the ambient provider. It would stay green
 * if `label` were ignored, if `variant` did not exist, and if an unresolvable
 * `actionName` rendered a button anyway. `rowBinding` and
 * `degenerateProperties` reference `action` only as part of a props bag whose
 * subject is the `visible` predicate's row and the `properties` envelope;
 * `severityIcons`, `loadingFrameDiagnostic` and `visibleWhen.evidence` never
 * touch it. So this is a new file rather than a promotion.
 *
 * ## What is pinned, member by member
 *
 *   • `actionName` — the CTA's IDENTITY. It is resolved against the OBJECT's
 *     metadata `actions[]`, so it is a reference and not a definition: a name
 *     that resolves to nothing renders NO button rather than an inert one.
 *   • `label` — an OVERRIDE over the resolved `ActionDef.label`, resolved
 *     through `pickLocalized` so an inline translation map works. Falls back
 *     to the ActionDef's own label, then to its name.
 *   • `variant` — reaches the button and OUTRANKS the severity-derived default
 *     (`error` -> destructive, everything else -> default).
 *
 * ## Doubles, and what is deliberately NOT doubled
 *
 * Only `useMetadataItem` is stubbed — the one fetch behind the CTA — matching
 * the surgical posture of the sibling `record-alert.resultDialog` suite. The
 * resolution (`objectMeta.actions.find`), the label ladder, the variant choice
 * and the dispatch are the real shipped code.
 *
 * ## Resolution
 *
 * Nothing resolves through any `dist/`: `../record-alert` is this package's own
 * source and `@object-ui/react` / `@object-ui/i18n` are mapped to their `src`
 * by the root `vitest.config.mts` alias table, so an ablation of
 * `record-alert.tsx` is visible here without a rebuild.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const primarySpy = vi.fn();
const neighbourSpy = vi.fn();

/** The action the CTA names. Its own label is what an absent `label` falls back to. */
const PRIMARY_ACTION = {
  name: 'verify_email',
  label: 'Verify email address',
  onClick: primarySpy,
};

/** A second declared action, so "the right one fired" is a real question. */
const NEIGHBOUR_ACTION = {
  name: 'resend_invite',
  label: 'Resend invite',
  onClick: neighbourSpy,
};

/** Declared with NO label of its own — the bottom rung of the label ladder. */
const UNLABELLED_ACTION = {
  name: 'rotate_api_key',
  onClick: vi.fn(),
};

const stub = { metadataItem: undefined as any };

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    useMetadataItem: (_type: string, _name: string | null) => ({ item: stub.metadataItem }),
  };
});

import { RecordAlertRenderer } from '../record-alert';
import { RecordContextProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';

type ActionMember = { actionName?: unknown; label?: unknown; variant?: unknown };

function mount(action: ActionMember | undefined, severity = 'warning', language = 'en') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <RecordContextProvider objectName="sys_user" recordId="u1" data={{ id: 'u1' }}>
        <RecordAlertRenderer
          schema={{ properties: { title: 'Account security', severity, action } } as any}
        />
      </RecordContextProvider>
    </I18nProvider>,
  );
}

/** The CTA is the only button in the banner unless `dismissible` is authored. */
const cta = (): HTMLElement | null => screen.queryByRole('button');

beforeEach(() => {
  stub.metadataItem = { actions: [PRIMARY_ACTION, NEIGHBOUR_ACTION, UNLABELLED_ACTION] };
  primarySpy.mockClear();
  neighbourSpy.mockClear();
  cleanup();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('`record:alert.action` member `actionName` is a REFERENCE, not a definition (objectui#8071)', () => {
  it('resolves against the object metadata `actions[]` and renders that CTA', () => {
    mount({ actionName: 'verify_email' });
    expect(cta()).toHaveTextContent('Verify email address');
  });

  it('an `actionName` that resolves to NOTHING renders no button at all', () => {
    // The member is looked up, not trusted: an author's typo produces no CTA
    // rather than a button that cannot do anything when pressed.
    mount({ actionName: 'verify_emial' });
    expect(cta()).toBeNull();
    // …and the banner itself still renders, so "no button" is not "no banner".
    expect(screen.getByText('Account security')).toBeTruthy();
  });

  it('CONTROL — with the metadata EMPTIED, even a correct name renders no CTA', () => {
    // Proves the resolution really runs against `actions[]`. Without this,
    // "a typo renders nothing" is satisfiable by a renderer that never draws
    // a CTA in this harness at all.
    stub.metadataItem = { actions: [] };
    mount({ actionName: 'verify_email' });
    expect(cta()).toBeNull();
  });

  it('omitting the whole `action` member renders no CTA', () => {
    mount(undefined);
    expect(cta()).toBeNull();
    expect(screen.getByText('Account security')).toBeTruthy();
  });

  it('dispatches the action it NAMES, not a neighbouring declared one', () => {
    // Identity, the half a presence check cannot see: two actions are declared
    // and exactly one must fire.
    mount({ actionName: 'verify_email' });
    fireEvent.click(cta() as HTMLElement);
    expect(primarySpy).toHaveBeenCalledTimes(1);
    expect(neighbourSpy).not.toHaveBeenCalled();
  });

  it('CONTROL — naming the OTHER action fires the other spy', () => {
    // The mirror, so the leg above is not satisfied by "the first spy always wins".
    mount({ actionName: 'resend_invite' });
    fireEvent.click(cta() as HTMLElement);
    expect(neighbourSpy).toHaveBeenCalledTimes(1);
    expect(primarySpy).not.toHaveBeenCalled();
  });
});

describe('`record:alert.action` member `label` OVERRIDES the resolved action label (objectui#8071)', () => {
  it('an authored `label` wins over the ActionDef\'s own label', () => {
    mount({ actionName: 'verify_email', label: 'Confirm your address' });
    expect(cta()).toHaveTextContent('Confirm your address');
    expect(cta()).not.toHaveTextContent('Verify email address');
  });

  it('CONTROL — omitting `label` falls back to the ActionDef\'s own label', () => {
    // What makes the override a measurement: the fallback really is a
    // different string, so the leg above could not have read it.
    mount({ actionName: 'verify_email' });
    expect(cta()).toHaveTextContent('Verify email address');
  });

  it('falls back to the action NAME when neither the member nor the ActionDef has a label', () => {
    // The bottom rung of the ladder, which no other suite reaches.
    mount({ actionName: 'rotate_api_key' });
    expect(cta()).toHaveTextContent('rotate_api_key');
  });

  it('an inline translation map is resolved to the session language', () => {
    // `label` goes through `pickLocalized`, the same resolution `title` and
    // `body` get — so the member accepts `{ en, 'zh-CN' }`, not only a string.
    mount({ actionName: 'verify_email', label: { en: 'Verify now', 'zh-CN': '立即验证' } });
    expect(cta()).toHaveTextContent('Verify now');
  });

  it('CONTROL — the SAME map under a different language resolves to the other entry', () => {
    // Without this, "Verify now" is satisfiable by a renderer that prints
    // whichever entry happens to be first.
    mount({ actionName: 'verify_email', label: { en: 'Verify now', 'zh-CN': '立即验证' } }, 'warning', 'zh-CN');
    expect(cta()).toHaveTextContent('立即验证');
  });
});

describe('`record:alert.action` member `variant` OUTRANKS the severity default (objectui#8071)', () => {
  // The variant reaches the DOM as the cva class the button is painted with,
  // the same observable `HistoryTimeline.test.tsx` reads for this design system.
  const classOf = () => (cta() as HTMLElement).className;

  it('an authored `variant` paints the button with it', () => {
    mount({ actionName: 'verify_email', variant: 'secondary' });
    expect(classOf()).toContain('bg-secondary');
  });

  it('CONTROL — with no `variant`, a non-error banner takes the default paint', () => {
    mount({ actionName: 'verify_email' });
    expect(classOf()).toContain('bg-primary');
    expect(classOf()).not.toContain('bg-secondary');
  });

  it('CONTROL — with no `variant`, an ERROR banner derives `destructive`', () => {
    // The severity-derived default this member has to outrank, pinned first so
    // the outranking leg below has something to be measured against.
    mount({ actionName: 'verify_email' }, 'error');
    expect(classOf()).toContain('bg-destructive');
  });

  it('the member beats the severity default — `error` + an authored `variant`', () => {
    // The discriminating case for the whole describe: the two sources of a
    // variant disagree, and the authored member is the one that wins.
    mount({ actionName: 'verify_email', variant: 'secondary' }, 'error');
    expect(classOf()).toContain('bg-secondary');
    expect(classOf()).not.toContain('bg-destructive');
  });
});
