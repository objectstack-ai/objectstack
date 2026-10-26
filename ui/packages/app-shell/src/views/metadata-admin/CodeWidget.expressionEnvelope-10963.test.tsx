// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10963 — `CodeWidget` reads and writes an `expression`-language slot
 * through the ADR-0089 envelope, and every other language keeps its string path.
 *
 * ## The defect
 *
 * A form row `{ type: 'code', language: 'expression' }` sits over a spec slot
 * that persists as the `{ dialect, source, … }` envelope (a field's
 * `visibleWhen` / `readonlyWhen` / `requiredWhen`, a formula's `expression`).
 * `CodeWidget` read its value with `String(value)`, so the editor showed the
 * literal text `[object Object]`, and its first edit wrote a bare string over
 * the envelope and dropped `meta`. `ConditionWidget` had the same defect and
 * was fixed through the shared `expressionSource` / `writeExpressionSource` pair
 * (objectui#3218). This file pins `CodeWidget` to that same pair and that same
 * write rule, not a second one.
 *
 * ## The switch is the DECLARED language
 *
 * Only `inferCodeLanguage(...) === 'expression'` takes the envelope path. The
 * non-expression control below is a `javascript` row holding an
 * envelope-looking object, and it must stay on the string path. A widget that
 * sniffed the value's shape instead would turn that control red, which is the
 * intended alarm.
 *
 * ## Fixtures
 *
 * The rows are the real rows the installed `@objectstack/spec` declares
 * (`objectForm`'s per-field `visibleWhen`, `hookForm`'s `body.source`), looked
 * up by name rather than retyped. The stored values are authored input fed
 * through `FieldSchema.parse`, so an envelope here is what the platform
 * persists, not a hand-written guess.
 *
 * ## The editor
 *
 * Monaco is lazy and has no DOM a test can type into, so
 * `@object-ui/plugin-editor`'s `CodeEditorRenderer` is mocked as a CONTROLLED
 * sink: a textarea that shows exactly the `value` it is handed and reports
 * every change through the `onChange` it is handed. Everything asserted is
 * `CodeWidget`'s own read (what it hands the editor) and write (what it hands
 * its host).
 *
 * The editor mounts only once the page's Monaco loader probe has resolved
 * (objectui#11858), so the loader is stubbed to resolve, and the sink paints
 * one `.view-line` row as a loaded Monaco does: this file is the
 * reachable-CDN page. The failing page is
 * `CodeWidget.loaderFallback-11858.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { FieldSchema, hookForm, objectForm } from '@objectstack/spec/data';

vi.mock('@object-ui/plugin-editor', () => ({
  CodeEditorRenderer: ({
    value,
    onChange,
    schema,
  }: {
    value?: string;
    onChange?: (next: string | undefined) => void;
    schema: { language?: string };
  }) => (
    <div>
      <div className="view-line" />
      <textarea
        data-testid="code-editor-sink"
        data-language={schema.language}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  ),
}));

// The CDN is reachable: the page's one `loader.init()` resolves.
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.resolve({}) } };
});

// The module `CodeWidget`'s `React.lazy` factory imports, loaded here at module
// scope so the lazy boundary resolves at once instead of racing a `findBy`
// window (the repo's flaky-test rule for lazy boundaries). Same specifier as
// the widget's own.
import '@object-ui/plugin-editor';

import { CodeWidget } from './widgets';
import type { FormFieldSpec } from './form-spec';

afterEach(cleanup);

type Row = Record<string, unknown> & { field?: string; fields?: Row[] };

/** A form row by path through composite / repeater `fields`, from a spec form. */
function specRow(form: unknown, path: string[]): FormFieldSpec {
  let rows: Row[] = ((form as { sections: Array<{ fields: Row[] }> }).sections ?? []).flatMap((s) => s.fields ?? []);
  let hit: Row | undefined;
  for (const name of path) {
    hit = rows.find((r) => r.field === name);
    if (!hit) throw new Error(`spec form has no row ${path.join('.')}`);
    rows = hit.fields ?? [];
  }
  return hit as unknown as FormFieldSpec;
}

/** `objectForm`'s per-field `visibleWhen` row: `type: 'code'`, `language: 'expression'`. */
const EXPRESSION_ROW = specRow(objectForm, ['fields', 'visibleWhen']);
/** `hookForm`'s `body.source` row: `type: 'code'`, `language: 'javascript'`, a script. */
const JAVASCRIPT_ROW = specRow(hookForm, ['body', 'source']);

/** A stored `visibleWhen`, authored the way a user writes it and parsed by the spec. */
function storedVisibleWhen(authored: unknown): unknown {
  return FieldSchema.parse({ name: 'amount', type: 'number', visibleWhen: authored }).visibleWhen;
}

const META = { rationale: 'Only invoices carry an amount', generatedBy: 'agent:invoice-form' };

/**
 * The member schema `SchemaForm` hands the widget. It does not pick the path:
 * `inferCodeLanguage` reads `fieldSpec.language` first, and every row here
 * declares one. A plain string schema keeps the fixtures free of a second
 * signal.
 */
const MEMBER_SCHEMA = { type: 'string' };

/** Render one `CodeWidget` and return its write spy. */
function renderCode(fieldSpec: FormFieldSpec, value: unknown) {
  const onChange = vi.fn();
  render(<CodeWidget schema={MEMBER_SCHEMA} fieldSpec={fieldSpec} value={value} onChange={onChange} />);
  return onChange;
}

const editor = () => screen.findByTestId('code-editor-sink') as Promise<HTMLTextAreaElement>;

describe('CodeWidget — an expression slot goes through the ADR-0089 envelope (objectui#10963)', () => {
  it('the fixtures are what they claim: the declared rows and a spec-parsed envelope', () => {
    // Guards the premises, so a spec that renames a row or stops normalising
    // fails here instead of turning the pins below into tests of nothing.
    expect(EXPRESSION_ROW).toMatchObject({ type: 'code', language: 'expression' });
    expect(JAVASCRIPT_ROW).toMatchObject({ type: 'code', language: 'javascript' });
    expect(storedVisibleWhen("record.type == 'invoice'")).toEqual({
      dialect: 'cel',
      source: "record.type == 'invoice'",
    });
  });

  it('an envelope on an expression row renders its `source` as the editor text', async () => {
    renderCode(EXPRESSION_ROW, storedVisibleWhen({ dialect: 'cel', source: "record.type == 'invoice'", meta: META }));

    const sink = await editor();
    expect(sink.dataset.language).toBe('expression');
    expect(sink.value, 'the envelope was stringified instead of read').toBe("record.type == 'invoice'");
  });

  it('an edit round-trips to an envelope that keeps `dialect` and `meta` and drops the stale `ast`', async () => {
    const prior = storedVisibleWhen({
      dialect: 'cel',
      source: "record.type == 'invoice'",
      meta: META,
      ast: { op: '==', left: 'record.type', right: 'invoice' },
    });
    expect(prior).toHaveProperty('ast');
    const onChange = renderCode(EXPRESSION_ROW, prior);

    fireEvent.change(await editor(), { target: { value: "record.type == 'credit_note'" } });

    // Exact equality: `dialect` and `meta` kept verbatim, `source` replaced,
    // `ast` gone because it was compiled from the old source.
    expect(onChange).toHaveBeenLastCalledWith({
      dialect: 'cel',
      source: "record.type == 'credit_note'",
      meta: META,
    });
  });

  it('a cleared expression writes `undefined`, the same as ConditionWidget, not an empty string', async () => {
    const onChange = renderCode(EXPRESSION_ROW, storedVisibleWhen({ dialect: 'cel', source: 'true', meta: META }));

    fireEvent.change(await editor(), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBeUndefined();
  });

  it('control — a bare-string prior on an expression row reads as itself and writes the bare shorthand back', async () => {
    // A row authored before the envelope, handed over unparsed. With no prior
    // envelope there is nothing to preserve, so the write is the bare string
    // the spec pipe normalises to `{ dialect: 'cel', source }`.
    const onChange = renderCode(EXPRESSION_ROW, "record.type == 'invoice'");

    const sink = await editor();
    expect(sink.value).toBe("record.type == 'invoice'");
    fireEvent.change(sink, { target: { value: "record.type == 'quote'" } });

    expect(onChange).toHaveBeenLastCalledWith("record.type == 'quote'");
  });

  it('control — an undefined prior (a new row) on an expression row starts empty and writes the bare shorthand', async () => {
    const onChange = renderCode(EXPRESSION_ROW, undefined);

    const sink = await editor();
    expect(sink.value).toBe('');
    fireEvent.change(sink, { target: { value: 'record.amount > 0' } });

    expect(onChange).toHaveBeenLastCalledWith('record.amount > 0');
  });

  it('non-expression control — a javascript row holding an envelope-looking object stays on the string path', async () => {
    const lookalike = { dialect: 'cel', source: 'return 1;', meta: META };
    const onChange = renderCode(JAVASCRIPT_ROW, lookalike);

    const sink = await editor();
    expect(sink.dataset.language).toBe('javascript');
    // The string path is unchanged: the value is stringified as before, and
    // the envelope's `source` is NOT extracted. Doing so is value-shape
    // sniffing, which the declared language is there to rule out.
    expect(sink.value).toBe(String(lookalike));
    expect(sink.value).not.toBe('return 1;');

    fireEvent.change(sink, { target: { value: 'return 2;' } });
    expect(onChange).toHaveBeenLastCalledWith('return 2;');

    fireEvent.change(sink, { target: { value: '' } });
    // The string path still writes '' for a cleared editor.
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});

describe('CodeWidget — control: a reachable Monaco loader keeps the editor (objectui#11858)', () => {
  it('mounts the editor, not the textarea fallback, and keeps it past the fallback backstop', async () => {
    renderCode(JAVASCRIPT_ROW, 'return 1;');
    const sink = await editor();

    // `useMonacoFallback` looks once, its default `fallbackDelayMs` after
    // mount, for a painted Monaco row, and falls back to the textarea without
    // one. The wait must outlast that look for this control to mean anything.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 4500));
    });

    expect(screen.getByTestId('code-editor-sink'), 'the editor stayed mounted').toBe(sink);
    expect(screen.getAllByRole('textbox'), 'a fallback textarea beside or instead of the editor').toEqual([sink]);
  });
});
