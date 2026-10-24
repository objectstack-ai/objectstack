// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11858 — when Monaco's CDN loader script cannot be fetched (no
 * egress, a strict CSP), SchemaForm's `code` widget renders an editable
 * textarea that saves, the failure is reported once per page, and nothing
 * escapes as an uncaught error.
 *
 * ## The defect this file keeps fixed
 *
 * `CodeWidget` rendered `@object-ui/plugin-editor`'s `CodeEditorRenderer`, the
 * bare Monaco `<Editor>`, with no fallback. With the CDN blocked it stayed on
 * Monaco's own "Loading..." with nothing editable, so a hook body could not be
 * written at all, and each editor's own `loader.init()` logged "Monaco
 * initialization: error" and leaked an uncaught rejection. The source editors
 * already fell back through `useMonacoFallback` (objectui#11800); the widget
 * now reads that same one-per-page loader probe.
 *
 * ## The rows
 *
 *  - `hookForm`'s `body.source` (`language: 'javascript'`), rendered by
 *    `SchemaForm` from the installed `@objectstack/spec` form, with the hook's
 *    JSON Schema derived through the same `z.toJSONSchema` call `/meta/types`
 *    serves it with: what the hook edit page renders. "Saves" is read as the
 *    next draft the form hands its host carrying the edit, and that draft
 *    passing the spec's own `HookSchema`.
 *  - `objectForm`'s per-field `expression` (`language: 'expression'`), a
 *    formula's ADR-0089 envelope parsed by the spec: the envelope write the
 *    editor makes (objectui#10963) is the one the textarea makes.
 *
 * ## Nothing about Monaco is mocked
 *
 * As in `useMonacoFallback.loaderRejection-11800.test.tsx`, this drives the REAL
 * `@monaco-editor/loader` and the real plugin-editor `<Editor>`: the leak lives
 * in the loader, and a stubbed `loader.init` would hand back a promise the
 * caller CAN catch. Two pieces of browser behaviour are modelled, and only
 * these two, the same way that file models them:
 *
 *  - **The network.** The loader appends a `vs/loader.js` script and waits for
 *    its `error` event. The script is held back from the DOM and its `error`
 *    event fired by the test, after both lazy editor modules have loaded, so
 *    an editor that mounted before the loader answered would have mounted.
 *  - **Unhandled rejections.** Each Node report is replayed as a cancelable
 *    `unhandledrejection` event on `window`, and the ones left uncancelled are
 *    counted. Vitest's own listeners are put back afterwards.
 *
 * The probe's outcome is module state, so this file owns the failing page and
 * the reachable-loader control lives in `CodeWidget.expressionEnvelope-10963.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { z } from 'zod';
import { FieldSchema, HookSchema, hookForm, objectForm } from '@objectstack/spec/data';

// The modules behind the widget's two lazy boundaries, loaded at module scope
// so both `React.lazy` factories resolve at once (the repo's lazy-boundary
// rule). The first is the widget's own specifier; the second is the file
// plugin-editor's `React.lazy(() => import('./MonacoImpl'))` resolves to. With
// both loaded, an editor mounted before the loader answers WOULD mount, so
// the counts below can see it.
import '@object-ui/plugin-editor';
import '../../../../plugin-editor/src/MonacoImpl';

import { SchemaForm } from './SchemaForm';
import { CodeWidget } from './widgets';
import type { FormFieldSpec, FormViewSpec } from './form-spec';

const LOADER_SCRIPT = /\/vs\/loader\.js$/;

let uncaught: unknown[] = [];
let vitestListeners: NodeJS.UnhandledRejectionListener[] = [];
let heldLoaderScripts: HTMLScriptElement[] = [];

function replayAsBrowser(reason: unknown): void {
  const event = new Event('unhandledrejection', { cancelable: true });
  Object.defineProperty(event, 'reason', { value: reason });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) uncaught.push(reason);
}

/** The console lines that speak about Monaco — other warnings on the page are not this card's. */
function monacoReports(calls: unknown[][]): string[] {
  return calls.map((args) => args.map(String).join(' ')).filter((line) => /monaco/i.test(line));
}

/** Let Node finish a microtask checkpoint and report what it left unhandled. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  uncaught = [];
  heldLoaderScripts = [];
  vitestListeners = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', replayAsBrowser);

  const append = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLScriptElement && LOADER_SCRIPT.test(node.src)) {
      heldLoaderScripts.push(node);
      return node;
    }
    return append(node);
  });
});

afterEach(() => {
  cleanup();
  process.off('unhandledRejection', replayAsBrowser);
  for (const listener of vitestListeners) process.on('unhandledRejection', listener);
  vi.restoreAllMocks();
});

/** A row of a spec form by path through composite / repeater `fields`. */
function specRow(form: unknown, path: string[]): FormFieldSpec {
  type Row = Record<string, unknown> & { field?: string; fields?: Row[] };
  let rows: Row[] = ((form as { sections: Array<{ fields: Row[] }> }).sections ?? []).flatMap((s) => s.fields ?? []);
  let hit: Row | undefined;
  for (const name of path) {
    hit = rows.find((r) => r.field === name);
    if (!hit) throw new Error(`spec form has no row ${path.join('.')}`);
    rows = hit.fields ?? [];
  }
  return hit as unknown as FormFieldSpec;
}

const HOOK_SCHEMA = z.toJSONSchema(HookSchema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
const HOOK_FORM = hookForm as unknown as FormViewSpec;
const HOOK_DRAFT: Record<string, unknown> = {
  name: 'invoice_guard',
  label: 'Invoice guard',
  object: 'invoice',
  events: ['beforeInsert'],
  body: { language: 'js', source: 'return;' },
};

/** `objectForm`'s per-field `expression` row: `type: 'code'`, `language: 'expression'`. */
const EXPRESSION_ROW = specRow(objectForm, ['fields', 'expression']);
const META = { rationale: 'Twice the amount', generatedBy: 'agent:invoice-form' };
/** A stored formula `expression`, authored with `meta` and parsed by the spec. */
const STORED_EXPRESSION = FieldSchema.parse({
  name: 'total',
  type: 'formula',
  returnType: 'number',
  expression: { dialect: 'cel', source: 'record.amount * 2', meta: META },
}).expression;

describe('CodeWidget — a failing Monaco loader falls back to an editable textarea (objectui#11858)', () => {
  it('the rows are what they claim: spec code rows, and a spec-parsed envelope', () => {
    // Guards the premises, so a spec that renames a row or changes its type
    // fails here instead of turning the pins below into tests of nothing.
    expect(specRow(hookForm, ['body', 'source'])).toMatchObject({ type: 'code', language: 'javascript' });
    expect(EXPRESSION_ROW).toMatchObject({ type: 'code', language: 'expression' });
    expect(STORED_EXPRESSION).toEqual({ dialect: 'cel', source: 'record.amount * 2', meta: META });
    expect(HookSchema.safeParse(HOOK_DRAFT).success, 'the hook fixture is a valid hook').toBe(true);
  });

  it('a hook body and an expression row are editable and save; one report, nothing uncaught, and a reopen adds nothing', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const consoleWarn = vi.spyOn(console, 'warn');
    const onHookChange = vi.fn();
    const onExpressionChange = vi.fn();

    // The hook edit page's form and a formula's expression row on one page;
    // StrictMode doubles every effect, as the dev build does.
    render(
      <React.StrictMode>
        <SchemaForm schema={HOOK_SCHEMA} form={HOOK_FORM} value={HOOK_DRAFT} onChange={onHookChange} />
        <span id="formula-expression-label">Formula expression</span>
        <CodeWidget
          schema={{ type: 'string' }}
          fieldSpec={EXPRESSION_ROW}
          value={STORED_EXPRESSION}
          onChange={onExpressionChange}
          ariaLabelledBy="formula-expression-label"
        />
      </React.StrictMode>,
    );
    await settle();

    expect(heldLoaderScripts, 'the loader appends its script once per page').toHaveLength(1);
    const [loaderScript] = heldLoaderScripts;
    // Before the network answers, no Monaco editor is mounted: it would show
    // its own "Loading..." and call `loader.init()` itself.
    expect.soft(screen.queryAllByText('Loading...'), 'Monaco editors mounted before the loader answered').toHaveLength(0);

    // The network answers: the loader script failed to load.
    act(() => {
      loaderScript.dispatchEvent(new Event('error'));
    });

    const hookBody = (await screen.findByRole('textbox', { name: /^source/i }, { timeout: 2000 })) as HTMLTextAreaElement;
    expect(hookBody.tagName, "the hook body's editing surface").toBe('TEXTAREA');
    expect(hookBody.value).toBe('return;');
    const expression = screen.getByRole('textbox', { name: 'Formula expression' }) as HTMLTextAreaElement;
    expect(expression.tagName, "the expression row's editing surface").toBe('TEXTAREA');
    expect(expression.value, 'the envelope is read through its `source`').toBe('record.amount * 2');

    // The hook body: the next draft the form hands its host to save.
    fireEvent.change(hookBody, { target: { value: 'if (!ctx.record.amount) throw new Error("amount");' } });
    const savedHook = onHookChange.mock.lastCall?.[0] as Record<string, unknown>;
    expect(savedHook.body).toEqual({ language: 'js', source: 'if (!ctx.record.amount) throw new Error("amount");' });
    expect(HookSchema.safeParse(savedHook).success, 'the saved hook is a valid hook').toBe(true);

    // The expression row: the same write the editor makes, an envelope that
    // keeps `dialect` and `meta` with the new `source`.
    fireEvent.change(expression, { target: { value: 'record.amount * 3' } });
    expect(onExpressionChange).toHaveBeenLastCalledWith({ dialect: 'cel', source: 'record.amount * 3', meta: META });

    await settle();
    // Soft, so a regression reports every reading at once, not just the first.
    expect.soft(uncaught, 'uncaught rejections after the loader failed').toHaveLength(0);
    const editorInitErrors = consoleError.mock.calls.filter(
      ([first]) => typeof first === 'string' && first.startsWith('Monaco initialization'),
    );
    expect.soft(editorInitErrors, "<Editor>'s own init error lines").toHaveLength(0);
    const reports = monacoReports(consoleWarn.mock.calls);
    expect.soft(reports, 'console lines reporting the Monaco failure').toHaveLength(1);
    expect.soft(reports.join('\n'), 'the report names the loader script URL').toContain(loaderScript.src);
    expect.soft(screen.queryAllByText('Loading...'), 'Monaco editors mounted after the failure').toHaveLength(0);

    // Reopen: a code row mounted after the failure is known renders the
    // textarea at once, read-only when the row is, with no loading state.
    cleanup();
    render(
      <>
        <span id="hook-body-label">Hook body</span>
        <CodeWidget
          schema={{ type: 'string' }}
          fieldSpec={specRow(hookForm, ['body', 'source'])}
          value="return;"
          onChange={() => {}}
          readOnly
          ariaLabelledBy="hook-body-label"
        />
      </>,
    );
    const reopened = screen.getByRole('textbox', { name: 'Hook body' }) as HTMLTextAreaElement;
    expect(reopened.value).toBe('return;');
    expect(reopened.readOnly).toBe(true);
    await settle();

    expect.soft(uncaught, 'uncaught rejections after a reopen').toHaveLength(0);
    expect.soft(heldLoaderScripts, 'loader scripts after a reopen').toHaveLength(1);
    expect.soft(monacoReports(consoleWarn.mock.calls), 'reports after a reopen').toHaveLength(1);
  });
});
