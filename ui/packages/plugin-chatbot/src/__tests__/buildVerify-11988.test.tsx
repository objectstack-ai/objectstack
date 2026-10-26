/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#11988 — the build-progress RECEIVER reads the post-apply
 * verification loop (cloud#2172 ruling A, the wire shape of cloud PR #2721).
 *
 * The loop reports on its own `data-build-progress` part, id `build-verify`,
 * beside the apply_blueprint tree: a hop is `{ phase: 'verify', hop, tool }`
 * and the exit is `{ phase: 'done' }`. The receiver used to take the LAST
 * `data-build-progress` part whatever its id and coerce any phase but
 * `data` / `done` to `structure`, so the first hop replaced the finished tree
 * with "Building your app…".
 *
 * Pinned here, through the real mapper and the real panel:
 *   - the tree and the verify part are read apart, by part id, in either order;
 *   - the verify line advances per hop and closes on `done`;
 *   - control: a message with only the tree is unchanged;
 *   - a phase outside the spec's vocabulary is surfaced, never "Building".
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BUILD_PROGRESS_PHASES, type BuildProgressPhase } from '@objectstack/spec/ai';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced, type ChatBuildProgress } from '../ChatbotEnhanced';
import { uiMessageToChatMessage } from '../mapMessages';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

const ITEMS = [
  { type: 'object', name: 'customer' },
  { type: 'view', name: 'customer.list' },
  { type: 'app', name: 'crm' },
];

/** The apply_blueprint tree, finished — what the verify loop runs after. */
const TREE = {
  type: 'data-build-progress',
  id: 'build-progress',
  data: { phase: 'done', appLabel: 'CRM', items: ITEMS, done: 3, total: 3 },
};

function verifyPart(data: Record<string, unknown>) {
  return { type: 'data-build-progress', id: 'build-verify', data };
}

function map(parts: Array<Record<string, unknown>>) {
  return uiMessageToChatMessage({ id: 'a1', role: 'assistant', parts });
}

function renderIn(language: string, parts: Array<Record<string, unknown>>) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ChatbotEnhanced messages={[map(parts)]} onSendMessage={vi.fn()} />
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe('the published phase union IS the spec vocabulary plus `unknown` (objectui#11988)', () => {
  it('is pinned at compile time, in both directions', () => {
    // A `tsc` error, not a runtime failure: compiled by this package's
    // `tsconfig.test.json`. A phase the spec adds or drops turns it red.
    type _TreePhaseIsSpec = Assert<Equal<Exclude<ChatBuildProgress['phase'], 'unknown'>, BuildProgressPhase>>;
    type _VerifyPhaseIsSpec = Assert<
      Equal<Exclude<NonNullable<ChatBuildProgress['verify']>['phase'], 'unknown'>, BuildProgressPhase>
    >;
    expect(true).toBe(true);
  });
});

describe('the receiver keeps the tree and the build-verify part apart (objectui#11988)', () => {
  it('a verify hop never displaces the finished tree', () => {
    const out = map([TREE, verifyPart({ phase: 'verify', hop: 1, tool: 'verify_build' })]);
    expect(out.buildProgress).toEqual({
      phase: 'done',
      appLabel: 'CRM',
      items: ITEMS,
      done: 3,
      total: 3,
      verify: { phase: 'verify', hop: 1, tool: 'verify_build' },
    });
  });

  it('is keyed by part id, not by position: a verify part ahead of the tree changes nothing', () => {
    const out = map([verifyPart({ phase: 'verify', hop: 1, tool: 'verify_build' }), TREE]);
    expect(out.buildProgress).toMatchObject({ phase: 'done', appLabel: 'CRM', items: ITEMS });
    expect(out.buildProgress?.verify).toEqual({ phase: 'verify', hop: 1, tool: 'verify_build' });
  });

  it('the exit frame closes the verify state', () => {
    const out = map([TREE, verifyPart({ phase: 'done' })]);
    expect(out.buildProgress?.verify).toEqual({ phase: 'done' });
    expect(out.buildProgress?.phase).toBe('done');
  });

  it('control: a message with only the tree maps exactly as before, with no verify state', () => {
    const out = map([TREE]);
    expect(out.buildProgress).toEqual({ phase: 'done', appLabel: 'CRM', items: ITEMS, done: 3, total: 3 });
  });

  it('a verify part with no tree beside it is not read as a build tree', () => {
    const out = map([verifyPart({ phase: 'verify', hop: 2, tool: 'verify_build' })]);
    expect(out.buildProgress).toBeUndefined();
  });

  it('reads every phase of the spec vocabulary as itself, on the tree and on the verify part', () => {
    for (const phase of BUILD_PROGRESS_PHASES) {
      const out = map([{ ...TREE, data: { ...TREE.data, phase } }, verifyPart({ phase })]);
      expect(out.buildProgress?.phase).toBe(phase);
      expect(out.buildProgress?.verify?.phase).toBe(phase);
    }
  });

  it('a phase outside the vocabulary is `unknown` on either part, never coerced to `structure`', () => {
    const out = map([{ ...TREE, data: { ...TREE.data, phase: 'deploying' } }, verifyPart({ phase: 'rechecking' })]);
    expect(out.buildProgress?.phase).toBe('unknown');
    expect(out.buildProgress?.verify?.phase).toBe('unknown');
  });
});

describe('the build panel renders the verify line (objectui#11988)', () => {
  it('shows the finished tree AND a verify line that advances per hop', () => {
    renderIn('en', [TREE, verifyPart({ phase: 'verify', hop: 1, tool: 'verify_build' })]);
    expect(screen.getByText('Built CRM')).toBeInTheDocument();
    expect(screen.getByTestId('build-verify')).toHaveTextContent('Checking the change… step 1');
    expect(screen.getByTestId('build-verify')).toHaveAttribute('title', 'verify_build');
    expect(screen.queryByText(/Building/)).not.toBeInTheDocument();
    cleanup();

    renderIn('en', [TREE, verifyPart({ phase: 'verify', hop: 2, tool: 'verify_build' })]);
    expect(screen.getByTestId('build-verify')).toHaveTextContent('Checking the change… step 2');
  });

  it('closes the verify line on `done`', () => {
    renderIn('en', [TREE, verifyPart({ phase: 'done' })]);
    expect(screen.getByText('Built CRM')).toBeInTheDocument();
    expect(screen.getByTestId('build-verify')).toHaveTextContent('Checked the change');
    expect(screen.getByTestId('build-verify')).not.toHaveTextContent(/Checking/);
  });

  it('control: a tree-only message renders the panel unchanged, with no verify line', () => {
    renderIn('en', [TREE]);
    expect(screen.getByText('Built CRM')).toBeInTheDocument();
    expect(screen.queryByTestId('build-verify')).not.toBeInTheDocument();
  });

  it('an unknown tree phase is surfaced as a warning, not rendered as "Building"', () => {
    renderIn('en', [{ ...TREE, data: { ...TREE.data, phase: 'deploying' } }]);
    expect(screen.getByText('Unknown build phase')).toBeInTheDocument();
    expect(screen.queryByText(/Building/)).not.toBeInTheDocument();
  });

  it('an unknown verify phase is surfaced as a warning on the verify line', () => {
    renderIn('en', [TREE, verifyPart({ phase: 'rechecking' })]);
    expect(screen.getByTestId('build-verify')).toHaveTextContent('Unknown build phase');
  });

  it('the verify line is localized through the pack', () => {
    renderIn('zh', [TREE, verifyPart({ phase: 'verify', hop: 3, tool: 'verify_build' })]);
    expect(screen.getByTestId('build-verify')).toHaveTextContent('正在检查改动… 第 3 步');
    expect(screen.queryByText(/Checking the change/)).not.toBeInTheDocument();
  });
});
