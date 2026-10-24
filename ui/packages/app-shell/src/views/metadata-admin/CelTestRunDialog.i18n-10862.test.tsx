// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10862, slice 1 — the RLS policy editor's CEL try-it dialog under zh-CN.
 *
 * `testRunCelPredicate` (`celAuthoring.ts`) wrote two sentences of its own in
 * English: the result for an empty predicate, and the fallback when the
 * engine reports a failure without a message. It now hands them back as
 * catalogue keys (`messageKey`), and `CelTestRunDialog` reads them through the
 * `t` its host binds to the designer locale — so `celAuthoring.ts` imports
 * nothing at load. The dialog's own sample-JSON refusal ("expected a JSON
 * object.") reads its row through the same `t`.
 *
 * Each case mounts the REAL dialog under the i18n provider in its language,
 * with `t` bound the way `PermissionMatrixEditor` binds it. Each zh
 * expectation is read back from the catalogue and guarded by `zhRow`; each en
 * case reads the en row for `en-US`, the control that the en row renders what
 * the literal rendered.
 *
 * Lit control, on the same mount: the error banner's title
 * (`perm.cel.test.error`) was already read through `t`.
 *
 * Left as written: the engine's own message (`Unknown variable: …`) and the
 * JSON parser's, in every locale.
 *
 * Reaching the two dry-run sites through the dialog:
 *  - Empty predicate — the dialog offers only clauses that have a predicate,
 *    so the result shows when the selected clause's predicate is cleared while
 *    the dialog is open and the other clause still has one (a re-render with
 *    new props, as a live draft update gives).
 *  - No message — the `__setCelFormulaLoader` seam hands the dry-run an engine
 *    whose failure carries no message; no real engine input reaches it.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

import { t } from './i18n';
import { __setCelFormulaLoader } from './celAuthoring';
import { CelTestRunDialog } from './CelTestRunDialog';

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
});

type Lang = 'en' | 'zh';
const LANGS = ['zh', 'en'] as const;
const LOCALE = { en: 'en-US', zh: 'zh-CN' } as const;

/** The row `key` in `lang`. */
const row = (lang: Lang, key: string): string => t(key, LOCALE[lang]);

/** A zh catalogue row that is really there: not the echoed key, not the en row. */
function zhRow(key: string): string {
  const zh = t(key, 'zh-CN');
  expect(zh, `${key}: a missing zh row echoes the key back`).not.toBe(key);
  expect(zh, `${key}: the zh row must not be the English one`).not.toBe(t(key, 'en-US'));
  return zh;
}

/** The dialog as `PermissionAdvancedFacets` mounts it, with `t` bound as `PermissionMatrixEditor` binds it. */
function Dialog({ lang, using, check }: { lang: Lang; using?: string; check?: string }) {
  const bound = React.useCallback((k: string) => t(k, LOCALE[lang]), [lang]);
  return (
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      <CelTestRunDialog
        open
        onOpenChange={() => {}}
        policyName="own_rows"
        objectName="account"
        fieldNames={['organization_id']}
        using={using}
        check={check}
        t={bound}
      />
    </I18nProvider>
  );
}

const run = (lang: Lang) => fireEvent.click(screen.getByRole('button', { name: row(lang, 'perm.cel.test.run') }));

/** The outcome banner's title and body text, once it shows. */
async function banner() {
  const el = await screen.findByRole('status', {}, { timeout: 3000 });
  const [title, body] = Array.from(el.children);
  return { title: title?.textContent?.trim() ?? null, body: body?.textContent?.trim() ?? null };
}

describe('CelTestRunDialog — the dry-run words read the designer locale (objectui#10862)', () => {
  for (const lang of LANGS) {
    it(`${lang}: an emptied predicate reads engine.celTest.predicateEmpty under the error title`, async () => {
      const view = render(<Dialog lang={lang} using="organization_id == 'a'" check="organization_id == 'b'" />);
      // The USING clause is selected; clear it while the dialog is open.
      view.rerender(<Dialog lang={lang} using="" check="organization_id == 'b'" />);
      run(lang);
      expect(await banner()).toEqual({
        title: row(lang, 'perm.cel.test.error'),
        body: row(lang, 'engine.celTest.predicateEmpty'),
      });
      if (lang === 'zh') for (const k of ['engine.celTest.predicateEmpty', 'perm.cel.test.error']) zhRow(k);
    });

    it(`${lang}: a failure without a message reads engine.flowSim.note.evaluationFailed`, async () => {
      __setCelFormulaLoader(async () => ({
        ExpressionEngine: { evaluate: () => ({ ok: false as const, error: { kind: 'runtime' } }) },
      }));
      render(<Dialog lang={lang} using="organization_id == 'a'" />);
      run(lang);
      expect(await banner()).toEqual({
        title: row(lang, 'perm.cel.test.error'),
        body: row(lang, 'engine.flowSim.note.evaluationFailed'),
      });
      if (lang === 'zh') zhRow('engine.flowSim.note.evaluationFailed');
    });

    it(`${lang}: the engine's own message passes through as written`, async () => {
      __setCelFormulaLoader(async () => ({
        ExpressionEngine: {
          evaluate: () => ({ ok: false as const, error: { kind: 'runtime', message: 'Unknown variable: region' } }),
        },
      }));
      render(<Dialog lang={lang} using="region == 'a'" />);
      run(lang);
      expect((await banner()).body).toBe('Unknown variable: region');
    });

    it(`${lang}: a sample that is not a JSON object reads engine.celTest.notObject after its field label`, async () => {
      render(<Dialog lang={lang} using="organization_id == 'a'" />);
      fireEvent.change(document.getElementById('cel-test-record') as HTMLTextAreaElement, { target: { value: '[]' } });
      run(lang);
      const expected = `${row(lang, 'perm.cel.test.record')}: ${row(lang, 'engine.celTest.notObject')}`;
      await waitFor(() => expect(screen.getByText(expected)).toBeTruthy(), { timeout: 3000 });
      if (lang === 'zh') zhRow('engine.celTest.notObject');
    });
  }
});
