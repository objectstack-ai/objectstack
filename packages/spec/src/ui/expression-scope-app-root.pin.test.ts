// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17203] `app` is NOT an expression-scope root, and no prose face of the UI
 * schemas may say it is.
 *
 * ## The fact being pinned
 *
 * `@objectstack/formula`'s `SCOPE_ROOTS` has never declared `app`, and
 * ADR-0068 has never ruled it. Decision batch #67 (2026-09-07) ruled option B
 * — the engine's `SCOPE_ROOTS` is the contract and the renderer aligns to it —
 * and ObjectUI shipped that: `buildExpressionScope` no longer binds `app`. The
 * producer-side option-A card (widen `SCOPE_ROOTS` to match the old prose) was
 * closed `not_planned` in the same ruling.
 *
 * So every sentence in this package that told an author `app` is a root the
 * renderer mounts was describing a binding that no longer exists — and it was
 * the LAST surface anywhere that could still teach an author, or a
 * metadata-generating agent (ADR-0033 lists AI as a primary consumer of these
 * `.describe()` strings), to write `app.tier == 'pro'`.
 *
 * ## Why that mattered enough to pin
 *
 * The resulting predicate does not fail uniformly, and it is silent either
 * way: a field `visibleWhen` and a nav / area `visible` fail **OPEN** (the
 * gate stops hiding), while a conditional-formatting `condition` and a
 * row-action `visible` / `disabled` fail **CLOSED** (the rule silently stops
 * matching). An author sees nothing but a console line.
 *
 * ## The six faces
 *
 * Two of them are published — `.describe()` text reaches authoring tools and
 * is republished verbatim into `content/docs/references/ui/page.mdx` by
 * `build-docs.ts`. The other four are TSDoc, which no generator reads, so they
 * are seen only by whoever opens the file — often an AI author. That is
 * exactly why the first probe of this class missed some of them, and why the
 * pin covers both kinds.
 *
 * ⛔ **Scope: the claim, not the wording.** Rephrasing these sentences,
 * reordering the surviving roots, or documenting a root that genuinely gets
 * bound later is free. Re-introducing `app` into a scope-root enumeration on
 * any of these faces is not.
 *
 * ⛔ This file must NOT restate which roots `SCOPE_ROOTS` declares — that list
 * is `@objectstack/formula`'s, tested there. The assertions below are about
 * what these six sentences claim, which is a fact about this package's text.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { describe, it, expect } from 'vitest';

import { PageComponentSchema } from './page.zod';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const read = (f: string) => fs.readFileSync(path.resolve(HERE, f), 'utf8');

const pageSource = read('page.zod.ts');
const actionSource = read('action.zod.ts');
const componentSource = read('component.zod.ts');

/**
 * The `app` token in a SCOPE-ROOT position — never the `app` metadata type,
 * which is a different word that legitimately appears all over these files
 * (`app` vs `utility` page types, `app.branding`, the `app` package type…).
 *
 * A bare /app/ search over any of these files matches dozens of those and is
 * therefore not a reading. Each assertion below is scoped to ONE sentence,
 * located by an anchor that survives rewording of everything around it.
 */
const sentenceContaining = (source: string, anchor: string): string => {
  const at = source.indexOf(anchor);
  expect(at, `anchor not found — the pin has drifted off its site: ${anchor}`).toBeGreaterThan(-1);
  // The docblock sentence: from the anchor to the next period that ends it.
  const tail = source.slice(at, at + 400);
  return tail.replace(/\n\s*\*\s?/g, ' ');
};

/** Root tokens that are still true on these surfaces and must stay in place. */
const SURVIVING_ROOTS = ['features', 'os.user'] as const;

describe('#17203 — no UI prose face advertises `app` as an expression-scope root', () => {
  describe('published faces (read by authoring tools and republished into the reference docs)', () => {
    it('`PageComponentSchema.visibleWhen`.describe() does not name `app` among the mounted roots', () => {
      // ⚠️ NOT `.shape` — ADR-0089 D3a made this schema a `.strict().transform(…)`
      // pipe (see `lazySchema`'s docblock), so it is a ZodPipe and the object
      // with the property descriptions is its INPUT side. Reaching for `.shape`
      // here yields `undefined` and every assertion below would then throw
      // rather than measure.
      const shape = (PageComponentSchema as unknown as {
        def: { in: { shape: Record<string, { description?: string }> } };
      }).def.in.shape;
      const description = shape.visibleWhen.description;

      expect(description, 'the describe() must exist — this pin is about its content').toBeTruthy();
      const mounts = description!.slice(description!.indexOf('additionally mounts'));

      // The claim: whatever this sentence says the renderer mounts, `app` is not in it.
      expect(mounts).not.toMatch(/`app`/);

      // Survival controls — deleting the token must not have taken the sentence with it.
      for (const root of SURVIVING_ROOTS) expect(mounts).toContain(root);
      expect(mounts).toContain('`data`');
      expect(mounts).toContain('NOT contract-guaranteed');

      // Contract-bound roots are a different clause and are untouched.
      expect(description).toContain('`record`');
      expect(description).toContain('`current_user`');
    });
  });

  describe('TSDoc faces (no generator reads these — an AI author opening the file does)', () => {
    it('page.zod.ts — the "Ambient roots" docblock', () => {
      const s = sentenceContaining(pageSource, 'The shipping renderer additionally mounts');

      expect(s).not.toMatch(/`app`/);
      for (const root of SURVIVING_ROOTS) expect(s).toContain(root);
      expect(s).toContain('binds `data`');
    });

    it('action.zod.ts — the param-level `visible` scope list', () => {
      const s = sentenceContaining(actionSource, 'same scope as the action-level');

      expect(s).not.toMatch(/`app`/);
      expect(s).toContain('`current_user`');
      expect(s).toContain('`data`');
      expect(s).toContain('`features`');
    });

    it('action.zod.ts — the action-level `visible` scope list, stated unbackticked', () => {
      // This face states the same claim in different words — `record/user/app/features`,
      // no backticks. A probe shaped for the backticked token could not see it.
      const s = sentenceContaining(actionSource, 'a predicate gates it per');

      expect(s).not.toMatch(/\bapp\b/);
      expect(s).toContain('record/user/features');
    });

    it('component.zod.ts — the ambient-root name-resolution example', () => {
      const s = sentenceContaining(componentSource, 'so an ambient root (');

      expect(s).not.toMatch(/`app`/);
      expect(s).toContain('`features`');
      expect(s).toContain('`user`');
    });

    it('component.zod.ts — the page:tabs "also mounts the ambient …" sentence', () => {
      const s = sentenceContaining(componentSource, 'it also mounts the ambient');

      expect(s).not.toMatch(/`app`/);
      for (const root of SURVIVING_ROOTS) expect(s).toContain(root);
    });
  });

  describe('probe controls — a zero above is only a reading if these hold', () => {
    /**
     * LIT. `page.zod.ts` still says `app` twice, both times about the page
     * TYPE (`app` vs `utility` vs `blank`) — a different word that this card
     * deliberately did NOT touch. It is the standing proof that a bare /app/
     * probe over this file cannot answer the scope-root question, and that the
     * anchored, sentence-scoped assertions above are the required shape.
     *
     * If this ever reads 0, someone deleted the page-type prose and the
     * assertions above quietly became unable to distinguish a real regression
     * from a file that simply stopped using the word.
     */
    it('LIT: the `app` page TYPE prose survives, so a scoped probe is still required', () => {
      expect(pageSource).toContain('`app` is an app-level page');
      // THREE occurrences on TWO lines — `grep -c` answers lines and reads 2,
      // which is the whole reason this is asserted on occurrences instead.
      expect(pageSource.match(/`app`/g) ?? []).toHaveLength(3);
    });

    /**
     * DARK. A fabricated token, which must read absent everywhere. It proves
     * the `not.toMatch` / `not.toContain` arms above are wired to something
     * that can actually fail, rather than passing on an empty haystack.
     */
    it('DARK: a fabricated root token reads absent on every face', () => {
      for (const source of [pageSource, actionSource, componentSource]) {
        expect(source).not.toContain('`appzz_scope_root`');
      }
    });

    /**
     * The other half of the dark control: the helper must throw when its
     * anchor is gone, so a site that gets renamed out from under this pin
     * fails loudly instead of asserting over an empty string.
     */
    it('DARK: a missing anchor fails the pin rather than passing vacuously', () => {
      expect(() => sentenceContaining(pageSource, 'no such anchor exists in this file')).toThrow();
    });
  });
});
