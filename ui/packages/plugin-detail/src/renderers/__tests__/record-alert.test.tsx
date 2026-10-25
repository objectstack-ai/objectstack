/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Regression tests for the `record:alert` renderer. We lock in the
 * contract that the renderer is a thin, predictable wrapper over the
 * shared ActionEngine: visibility predicates gate the banner, the CTA
 * is resolved from object metadata and dispatched through
 * `useActionEngine`, dismiss state persists per (object, record, key)
 * in localStorage, and severity → tailwind classes never silently
 * swap default icons.
 *
 * The renderer relies on several `@object-ui/react` hooks that normally
 * require a live provider tree (RecordContext, ActionProvider,
 * MetadataProvider). We stub the DATA layer surgically so the tests stay
 * focused on renderer behaviour, not on provider wiring — the same approach
 * the live render in `RecordDetailView` relies on at runtime.
 *
 * The PREDICATE entry is deliberately NOT stubbed (objectui#3941) — see the
 * mock factory below.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const mockExecuteAction = vi.fn(async () => ({ success: true }));

const stub = {
  recordCtx: undefined as any,
  metadataItem: undefined as any,
};

// Only the DATA layer is doubled here — record context, the metadata fetch
// behind the CTA, and the action dispatch. The predicate entry
// (`toPredicateInput` / `useCondition`) and the ambient
// `PredicateScopeProvider` are the REAL ones (objectui#3941).
//
// They used to be doubled too: an IDENTITY `toPredicateInput` that only
// recorded its argument, plus a `useCondition` pinned to a constant. Between
// them the banner's whole `visible` verdict was unobservable from its own
// suite — the only assertable fact left was "the renderer handed `props.visible`
// to something", so any normalization or evaluation defect stayed green here.
// That is the objectstack#4984 family (a fixture keeping a broken pipeline
// green), and this file is where objectui#3871's defect actually lived: the
// documented `${…}` spelling was double-wrapped, the reparse failed, this
// renderer's fail-SOFT `useCondition` handed back the original non-empty
// string, and `Boolean(…)` made a conditionally-authored banner permanently
// visible. `DeclaredActionsBar.test.tsx:22-34` wrote the same lesson down after
// objectui#3835; a re-spelled stub cannot fix it, because a stub is a second
// copy of exactly the semantics under test. `@object-ui/react`'s barrel is
// cheap for the light `dom` project (the sibling
// `record-quick-actions.template-predicate.test.tsx` imports it unmocked), so
// the verdicts below are judged by the shipped pipeline instead.
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    useRecordContext: () => stub.recordCtx,
    useMetadataItem: (_type: string, _name: string | null) => ({ item: stub.metadataItem }),
    useActionEngine: (_opts: unknown) => ({
      executeAction: mockExecuteAction,
      getActionsForLocation: () => [],
      getBulkActions: () => [],
      handleShortcut: async () => null,
      engine: {} as any,
    }),
  };
});

vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Alert: ({ children, className, role, ...rest }: any) => (
    <div data-testid="alert" role={role} className={className} {...rest}>
      {children}
    </div>
  ),
  AlertTitle: ({ children }: any) => <h5 data-testid="alert-title">{children}</h5>,
  AlertDescription: ({ children }: any) => <div data-testid="alert-body">{children}</div>,
  Button: ({ children, onClick, variant, ...rest }: any) => (
    <button data-testid="alert-cta" data-variant={variant} onClick={onClick} {...rest}>
      {children}
    </button>
  ),
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
  LazyIcon: ({ name, className }: any) => (
    <svg data-testid="alert-icon" data-name={name} className={className} />
  ),
}));

import { RecordAlertRenderer } from '../record-alert';
// The real provider — the `@object-ui/react` double above spreads `actual`, so
// the ambient predicate scope pinned at the bottom of this file is the shipped
// one, not a stand-in for it.
import { PredicateScopeProvider } from '@object-ui/react';
// Real I18nProvider (not mocked) — pins the active language so the locale-map
// case below (objectui#4998) resolves deterministically instead of riding
// whatever language another test file left on the global i18next singleton.
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';

const RECORD_DEFAULTS = {
  recordCtx: {
    data: { id: 'rec_1', name: 'Acme', email_verified: false },
    objectName: 'sys_user',
    recordId: 'rec_1',
  },
  metadataItem: {
    actions: [
      {
        name: 'resend_verification_email',
        label: 'Resend Verification Email',
        type: 'api',
        target: '/api/v1/auth/send-verification-email',
        successMessage: 'Verification email sent — check your inbox.',
      },
    ],
  },
};

beforeEach(() => {
  mockExecuteAction.mockClear();
  stub.recordCtx = RECORD_DEFAULTS.recordCtx;
  stub.metadataItem = RECORD_DEFAULTS.metadataItem;
  // happy-dom doesn't always ship a working localStorage; install a
  // minimal Storage shim so the renderer's persistence path is
  // exercised the same way as in the browser.
  const store: Record<string, string> = {};
  const shim = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  } as Storage;
  Object.defineProperty(window, 'localStorage', { value: shim, configurable: true, writable: true });
  cleanup();
});

describe('RecordAlertRenderer', () => {
  it('renders title + body + default info icon when severity is omitted', () => {
    render(
      <RecordAlertRenderer
        schema={{ properties: { title: 'Heads up', body: 'Pay attention.' } }}
      />,
    );
    expect(screen.getByTestId('alert-title').textContent).toBe('Heads up');
    expect(screen.getByTestId('alert-body').textContent).toContain('Pay attention.');
    expect(screen.getByTestId('alert-icon').getAttribute('data-name')).toBe('Info');
  });

  it('applies warning severity classes + warning icon', () => {
    render(<RecordAlertRenderer schema={{ properties: { severity: 'warning', title: 'Verify' } }} />);
    const alert = screen.getByTestId('alert');
    expect(alert.className).toMatch(/amber/);
    expect(screen.getByTestId('alert-icon').getAttribute('data-name')).toBe('AlertTriangle');
  });

  it('respects an explicit icon override', () => {
    render(
      <RecordAlertRenderer schema={{ properties: { severity: 'warning', icon: 'mail', title: 'X' } }} />,
    );
    expect(screen.getByTestId('alert-icon').getAttribute('data-name')).toBe('mail');
  });

  it('sets role=alert + aria-live=assertive for error severity', () => {
    render(<RecordAlertRenderer schema={{ properties: { severity: 'error', title: 'Oops' } }} />);
    const alert = screen.getByTestId('alert');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });

  it('renders the CTA when action.actionName resolves to an object action', () => {
    render(
      <RecordAlertRenderer
        schema={{
          properties: {
            title: 'Email unverified',
            action: { actionName: 'resend_verification_email' },
          },
        }}
      />,
    );
    expect(screen.getByTestId('alert-cta').textContent).toBe('Resend Verification Email');
  });

  it('CTA label override takes precedence over action.label', () => {
    render(
      <RecordAlertRenderer
        schema={{
          properties: {
            title: 'X',
            action: { actionName: 'resend_verification_email', label: 'Send again' },
          },
        }}
      />,
    );
    expect(screen.getByTestId('alert-cta').textContent).toBe('Send again');
  });

  // objectui#4998 — `action.label` accepts the inline locale map, not just a
  // plain string. The renderer already resolved one before this pin existed
  // (`const ctaLabel = pickLocalized(props.action?.label, language)`), so a
  // plain-string CTA label is green whether or not the local
  // `RecordAlertRendererProps` type admits a map — that's the
  // `label: 'Send again'` case just above, and it cannot tell the widened
  // declaration apart from the narrow one it replaced. This case can: a bare
  // `label?: string` refused a locale-map value at the TYPE level even though
  // `pickLocalized` (an `unknown` input) already resolved it correctly at
  // runtime, exactly the `title` / `body` contradiction objectui#4970 fixed
  // one level up in the same interface.
  it('resolves an inline locale-map action.label to the active-language string (objectui#4998)', () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <RecordAlertRenderer
          schema={{
            properties: {
              title: 'X',
              action: {
                actionName: 'resend_verification_email',
                label: { en: 'Send again', 'zh-CN': '再次发送' },
              },
            },
          }}
        />
      </I18nProvider>,
    );
    expect(screen.getByTestId('alert-cta').textContent).toBe('Send again');
  });

  // objectui#12145 — the dismiss button's accessible name is read from the
  // pack (`home.recoveryReminder.dismiss`, borrowed rather than a second key
  // for the same name). It was `aria-label="Dismiss"`, so under zh a screen
  // reader heard English. Read against the PACK, never against a literal.
  it('names the dismiss button from the pack under zh, not with the English word (objectui#12145)', async () => {
    const zhName = zh.home.recoveryReminder.dismiss;
    const enName = en.home.recoveryReminder.dismiss;
    expect(zhName).not.toBe(enName);
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        <RecordAlertRenderer schema={{ properties: { title: 'X', dismissible: true, dismissKey: 'zh_name' } }} />
      </I18nProvider>,
    );
    expect(await screen.findByRole('button', { name: zhName })).toBeTruthy();
    expect(screen.queryByRole('button', { name: enName })).toBeNull();
  });

  it('does NOT render a CTA when the action name fails to resolve in metadata', () => {
    render(
      <RecordAlertRenderer
        schema={{
          properties: { title: 'X', action: { actionName: 'no_such_action' } },
        }}
      />,
    );
    expect(screen.queryByTestId('alert-cta')).toBeNull();
  });

  it('clicking the CTA dispatches through useActionEngine by action name', () => {
    render(
      <RecordAlertRenderer
        schema={{
          properties: { title: 'X', action: { actionName: 'resend_verification_email' } },
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('alert-cta'));
    expect(mockExecuteAction).toHaveBeenCalledTimes(1);
    expect(mockExecuteAction).toHaveBeenCalledWith('resend_verification_email');
  });

  it('hides while the record is still loading (empty record)', () => {
    stub.recordCtx = { data: {}, objectName: 'sys_user', recordId: 'rec_1' };
    const { container } = render(<RecordAlertRenderer schema={{ properties: { title: 'X' } }} />);
    expect(container.firstChild).toBeNull();
  });

  // The `visible` VERDICT — every shape, both polarities — is pinned in its own
  // describe at the bottom of this file, against the real predicate pipeline.
  it('renders unconditionally when no `visible` predicate is supplied', () => {
    render(<RecordAlertRenderer schema={{ properties: { title: 'Always visible' } }} />);
    expect(screen.getByTestId('alert')).toBeTruthy();
  });

  it('dismissible: click hides + localStorage persists across remounts (scoped by object+id+key)', () => {
    const { container } = render(
      <RecordAlertRenderer
        schema={{
          properties: {
            title: 'Verify',
            body: 'Verify your email',
            dismissible: true,
            dismissKey: 'unverified_email',
          },
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(container.firstChild).toBeNull();

    expect(window.localStorage.getItem('os.record-alert:sys_user:rec_1:unverified_email')).toBe('1');

    // Fresh mount of the same alert against the same record → reads
    // localStorage and stays hidden without further interaction.
    cleanup();
    const fresh = render(
      <RecordAlertRenderer
        schema={{
          properties: {
            title: 'Verify',
            body: 'Verify your email',
            dismissible: true,
            dismissKey: 'unverified_email',
          },
        }}
      />,
    );
    expect(fresh.container.firstChild).toBeNull();
  });

  it('dismiss is scoped per record — dismissing record A does NOT silence record B', () => {
    render(
      <RecordAlertRenderer
        schema={{ properties: { title: 'X', dismissible: true, dismissKey: 'k' } }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    cleanup();

    // Different record id → alert should render fresh.
    stub.recordCtx = {
      data: { id: 'rec_2', email_verified: false },
      objectName: 'sys_user',
      recordId: 'rec_2',
    };
    const other = render(
      <RecordAlertRenderer
        schema={{ properties: { title: 'X', dismissible: true, dismissKey: 'k' } }}
      />,
    );
    expect(other.getByTestId('alert')).toBeTruthy();
  });

  it('flat properties (legacy shape) are read as a fallback to nested .properties', () => {
    render(<RecordAlertRenderer schema={{ severity: 'success', title: 'Saved' } as any} />);
    expect(screen.getByTestId('alert-title').textContent).toBe('Saved');
    expect(screen.getByTestId('alert-icon').getAttribute('data-name')).toBe('circle-check');
  });
});

/**
 * objectui#3941 — the `visible` VERDICT on `record:alert`, judged by the
 * shipped pipeline (`toPredicateInput` -> `useCondition`, both real).
 *
 * What the renderer actually asks (`record-alert.tsx:140-141` / `:193`):
 *
 *   const predicateInput = toPredicateInput(props.visible);
 *   const passesPredicate = useCondition(predicateInput, { record });
 *   if (predicateInput !== undefined && !passesPredicate) return null;
 *
 * Two facts about that shape drive every case below:
 *
 *   1. "Is a gate declared" is asked of the NORMALIZED value, not of the
 *      authored one, so `visible: false` is a declared gate (a boolean survives
 *      normalization) while `visible: ''` is not (it normalizes to `undefined`).
 *      This is the reading the objectui#3492 / #3850 / #3862 family settled on,
 *      and asking it of the normalized value is what keeps `false` from being
 *      read as "no gate" the way a truthiness test would.
 *   2. This surface is fail-SOFT — no `throwOnError` — so a predicate that
 *      cannot be evaluated resolves to SHOWN, not hidden. That sets the
 *      direction of the objectui#3871 case below, and it is the opposite of
 *      the fail-CLOSED direction pinned for the same spelling on
 *      `record-quick-actions` (`record-quick-actions.template-predicate.test.tsx`,
 *      where the engine hid the action instead).
 *
 * Both polarities are pinned for every expression shape. A single-polarity pin
 * cannot tell a verdict from a constant: "always hidden" satisfies every
 * "should be hidden" assertion on its own, and "always shown" satisfies every
 * "should be shown" one. Where a hidden verdict is asserted, the SAME record
 * and the SAME schema are also mounted in the shown direction — the renderer
 * has two other `return null` paths besides this gate (dismissed, and an empty
 * record), so "nothing rendered" needs the paired mount to mean "the gate said
 * no".
 */
const UNVERIFIED = { id: 'rec_1', name: 'Acme', email_verified: false };
const VERIFIED = { id: 'rec_1', name: 'Acme', email_verified: true };
const BANNER_TITLE = 'Verify your email';

function mountAlert(visible: unknown, record: Record<string, unknown> = UNVERIFIED) {
  stub.recordCtx = { data: record, objectName: 'sys_user', recordId: 'rec_1' };
  return render(
    <RecordAlertRenderer schema={{ properties: { title: BANNER_TITLE, visible } }} />,
  );
}

/** Mount inside a real ambient predicate scope (what a host shell feeds). */
function mountAlertInScope(visible: unknown, scope: Record<string, unknown>) {
  stub.recordCtx = { data: UNVERIFIED, objectName: 'sys_user', recordId: 'rec_1' };
  return render(
    <PredicateScopeProvider scope={scope}>
      <RecordAlertRenderer schema={{ properties: { title: BANNER_TITLE, visible } }} />
    </PredicateScopeProvider>,
  );
}

const bannerShown = () => screen.queryByTestId('alert') !== null;

describe('record:alert — the `visible` verdict, real predicate pipeline (objectui#3941)', () => {
  it('visible:false hides the banner', () => {
    // The most explicit "never show this" an author can write. Asked of the
    // AUTHORED value by a truthiness test, `false` reads as "no gate declared"
    // and the banner renders for everyone — the objectui#3492 family defect.
    expect(mountAlert(false).container.firstChild).toBeNull();
    cleanup();
    // Same record, same schema, predicate REMOVED → the banner renders. Without
    // this half, "hidden" above could equally mean the render never happened.
    mountAlert(undefined);
    expect(bannerShown()).toBe(true);
  });

  it('visible:true renders the banner', () => {
    mountAlert(true);
    expect(bannerShown()).toBe(true);
  });

  it('an empty-string `visible` is not a declared gate — the banner renders', () => {
    // Semantics documentation, not a mutation detector: `toPredicateInput('')`
    // is `undefined`, so the gate is skipped; and even if the gate were widened
    // to ask the AUTHORED value, `evaluateCondition('')` is "no condition →
    // true". `''` is shown on both sides of that change, so a reader should not
    // read this passing as proof the `!== undefined` limb is exercised — the
    // `false` case above is what exercises it.
    mountAlert('');
    expect(bannerShown()).toBe(true);
  });

  it('a bare-expression `visible` keeps its verdict — holds shows, fails hides', () => {
    const PRED = 'record.email_verified == false';
    mountAlert(PRED, UNVERIFIED);
    expect(bannerShown()).toBe(true);
    cleanup();
    mountAlert(PRED, VERIFIED);
    expect(bannerShown()).toBe(false);
  });

  it('a `${…}`-spelled `visible` keeps its verdict — holds shows, fails hides (objectui#3871)', () => {
    // `${…}` is a spelling this repo documents (AGENTS.md §4) and one of the
    // shapes `EvaluatorPredicateInput` lists as a normalized OUTPUT, so the
    // normalizer must leave it alone. While it did not (objectui#3871), the
    // double wrap `'${${…}}'` missed the single-template fast path, the global
    // replace could not parse `'${x'`, and this fail-SOFT caller got the
    // original non-empty string back — `Boolean(…)` a constant `true`.
    //
    // Direction, predicted before running: the FAILING half below is the
    // detector (it was shown when it should have been hidden — a banner the
    // author gated stayed on screen for everyone); the HOLDING half is green
    // either way, because a constant `true` and a correct `true` look the same.
    // Both are kept: without the holding half, "hide unconditionally" would
    // satisfy the detector.
    const PRED = '${record.email_verified == false}';
    mountAlert(PRED, UNVERIFIED);
    expect(bannerShown()).toBe(true);
    cleanup();
    mountAlert(PRED, VERIFIED);
    expect(bannerShown()).toBe(false);
  });

  it('a `{ dialect: cel }` envelope keeps its verdict — holds shows, fails hides', () => {
    // The envelope must survive normalization: only while it is still
    // `{ dialect: 'cel' }` does `evaluateCondition` route to the canonical
    // `@objectstack/formula` engine — the one the SERVER enforces with.
    // Collapsed to `${source}` it falls to the legacy JS path, whose verdicts
    // differ (#2661 / #3314), and this banner would then disagree with the
    // action buttons it is authored next to.
    const PRED = { dialect: 'cel', source: 'record.email_verified == false' };
    mountAlert(PRED, UNVERIFIED);
    expect(bannerShown()).toBe(true);
    cleanup();
    mountAlert(PRED, VERIFIED);
    expect(bannerShown()).toBe(false);
  });

  it('the ambient predicate scope reaches the banner — a `features.*` gate resolves both ways', () => {
    // The renderer passes only `{ record }`; everything else the header
    // docblock promises (`features`, `user`, …) arrives through the
    // ambient `PredicateScopeProvider` that host shells mount, merged UNDER the
    // local context by `useCondition`. Stubbing the predicate entry hid this
    // path entirely — a deployment-level gate could stop resolving with the
    // suite still green.
    const PRED = 'features.email_verification_banner == true';
    mountAlertInScope(PRED, { features: { email_verification_banner: true } });
    expect(bannerShown()).toBe(true);
    cleanup();
    mountAlertInScope(PRED, { features: { email_verification_banner: false } });
    expect(bannerShown()).toBe(false);
  });
});
