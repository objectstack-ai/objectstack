/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `MarkdownSchema.sanitize` and `MarkdownSchema.components`
 * are REFUSED, not silently ignored (objectui#6972, ADR-0049
 * enforce-or-remove). The two keys do NOT share a disposition — triage recorded
 * the asymmetry — so each is argued on its own below, then pinned by one
 * mechanism.
 *
 * ## The failure this pin exists to prevent — `sanitize`
 *
 * `sanitize` was declared `?: boolean` with `@default true` on both published
 * faces (`data-display.ts` and the Zod mirror; `@object-ui/plugin-markdown`
 * re-exports the same authority since objectui#6172), documented, and read by
 * NOTHING. Worse than an ordinary inert key, it implied a switch that does not
 * exist: sanitization is UNCONDITIONAL. `rehypePlugins` in
 * `plugin-markdown/src/MarkdownImpl.tsx` is a module-level `const` array whose
 * last link is `[rehypeSanitize, sanitizeSchema]`, handed to `ReactMarkdown`
 * as-is — no ternary, no `if`, no runtime assembly. `MarkdownRenderer` forwards
 * exactly `content` and `className`; `MarkdownImplProps` accepts only those
 * two. So `sanitize: false` type-checked, parsed green and changed nothing
 * while reading as a security-relevant control, and `sanitize: true` promised
 * a gate the author never controlled either. Both readings lied.
 *
 * The enforce arm of enforce-or-remove would be a switch that DISABLES XSS
 * sanitization — not an acceptable outcome — so for this key the ruling
 * collapses to remove (triage on objectui#6972). The deliverable is therefore
 * not "sanitize works"; it is: **an authored `sanitize` is refused loudly at
 * the authoring boundary, and the refusal says why** (sanitization is
 * unconditional; there is no spelling that disables it).
 *
 * ## The failure this pin exists to prevent — `components`
 *
 * `components` was declared `?: Record<string, any>` ("custom components for
 * markdown elements") and read by NOTHING: the `components` map `MarkdownImpl`
 * hands to `ReactMarkdown` is its OWN module-level `mdComponents` (the mermaid
 * / metadata fence overrides), never merged with anything off the schema, and
 * no host path — no `MarkdownImpl` prop, no plugin API, no app-shell or runner
 * site — consumes such a map. Triage left both arms open here; the PM's
 * disposition (declared veto window on objectui#6972) is remove: a map of
 * React component overrides is not a JSON-authorable value, the same shape as
 * the handler keys objectui#6124 retired, and with no host consumer there is
 * no `runtime-slot` twin to keep callable. The falsifiable premise — "no host
 * path consumes a `components` map" — was re-measured on the retiring PR's
 * base before this half was written.
 *
 * ## Why the tombstone, and not simply deleting the keys
 *
 * `BaseSchema` is `.passthrough()` on the Zod side and carried a
 * `[key: string]: any` index signature on the TS side until objectui#8347. An
 * UNDECLARED key is accepted by the Zod half, unvalidated (and was by the TS
 * half; since objectui#8347 only through a widened value) — deleting `sanitize` outright would
 * hand the authored spelling exactly the silent no-op this card exists to
 * close (and would hand `components` the same). `?: never` /
 * `retirementTombstone()` is this package's convention —
 * {@link StaticTableColumn} (objectui#5474), `DataTableSchema.toolbar`
 * (objectui#6881), `ComponentInput.inputType` (objectui#5905) — and it is
 * lockstep: both halves or neither. The "deleted" row is pinned live below as
 * a control, so the contrast cannot rot into prose.
 *
 * The `@ts-expect-error` directives are REAL enforcement: this package
 * type-checks its tests through `tsconfig.test.json`, so re-widening the
 * declaration fails the build on the unused directive. A green `vitest` run is
 * NOT evidence about them — type assertions are erased before it runs.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { MarkdownSchema } from '../zod/data-display.zod.js';
import type { MarkdownSchema as MarkdownSchemaTS } from '../data-display.js';

/**
 * The retired keys, each with the values an author would plausibly have
 * written, the FULL guidance string (pinned as a literal so the derived
 * assertions below cannot all drift together), and the prescriptive half —
 * the sentence that tells the author what is true and what to do.
 */
const RETIRED = {
  sanitize: {
    values: [false, true] as const,
    guidance:
      'RETIRED (objectui#6972) — sanitization is unconditional: rehype-sanitize is a fixed last link of the '
      + 'markdown renderer\'s rehype chain, and no value of this key ever switched it. There is no authored '
      + 'spelling that disables XSS sanitization; delete the key.',
    prescriptive: 'There is no authored spelling that disables XSS sanitization; delete the key.',
  },
  components: {
    // The shapes an author reaching for react-markdown's `components` prop
    // would write: a tag remap, and an empty map.
    values: [{ h1: 'h2' }, {}] as const,
    guidance:
      'RETIRED (objectui#6972) — never read: the markdown renderer forwards only `content` and `className`, '
      + 'and a map of React component overrides is not a JSON-authorable value. Delete the key; the fenced '
      + 'mermaid / metadata block overrides are the renderer\'s own fixed map, not an authoring surface.',
    prescriptive: 'Delete the key; the fenced mermaid / metadata block overrides are the renderer\'s own fixed map, not an authoring surface.',
  },
} as const;

type RetiredKey = keyof typeof RETIRED;

/** A minimal document that is valid TODAY and stays valid — the inside of the boundary. */
const VALID_MARKDOWN = {
  type: 'markdown',
  content: '# Hello\n\nSome **markdown**.',
} as const;

const shapeOf = (schema: unknown): Record<string, unknown> =>
  (schema as { shape: Record<string, unknown> }).shape;

const describeOf = (schema: unknown, key: string): string | undefined =>
  (shapeOf(schema)[key] as { description?: string } | undefined)?.description;

/* ── the Zod half: refused BY NAME, with the guidance in the message ─────── */

describe.each(Object.keys(RETIRED) as RetiredKey[])(
  'MarkdownSchema.%s is RETIRED — the Zod half of the tombstone (objectui#6972)',
  (key) => {
    const { values, guidance, prescriptive } = RETIRED[key];

    it.each(values.map((v) => [JSON.stringify(v), v] as const))(
      'REFUSES `%s`, naming the retired key in the path — every value, not one spelling',
      (_label, value) => {
        // The pin. Before the retirement this document parsed GREEN (`sanitize`
        // was `z.boolean().optional()`, `components` was
        // `z.record(z.string(), z.any()).optional()`), measured ACCEPTED on the
        // retiring PR's base. Asserting the ENVELOPE — not merely
        // `success:false` — so the pin cannot be satisfied by an unrelated
        // rejection.
        const result = MarkdownSchema.safeParse({ ...VALID_MARKDOWN, [key]: value });
        expect(
          result.success,
          `an authored \`${key}: ${JSON.stringify(value)}\` was ACCEPTED — it parses green and changes nothing`,
        ).toBe(false);
        if (result.success) return;

        const issue = result.error.issues.find((i) => i.path[0] === key);
        expect(issue, `parse failed, but not on the \`${key}\` path`).toBeTruthy();
        // The accept-set contract: same address, same code a bare `z.never()`
        // reports — `retirementTombstone()` customises the MESSAGE only.
        expect(issue?.code).toBe('invalid_type');
        expect((issue as { expected?: string } | undefined)?.expected).toBe('never');
        expect(issue?.path).toEqual([key]);
      },
    );

    it('the refusal CARRIES the guidance — the prescriptive sentence, not zod\'s generic message', () => {
      const result = MarkdownSchema.safeParse({ ...VALID_MARKDOWN, [key]: values[0] });
      expect(result.success).toBe(false);
      if (result.success) return;

      const issue = result.error.issues.find((i) => i.path[0] === key);
      expect(issue?.message).not.toContain('Invalid input: expected never, received ');
      // The half an author acts on: what is TRUE (sanitization is unconditional;
      // nothing reads an override map) and what to DO (delete the key). Pinned
      // as text, because the wording is the contract here — a message that only
      // said "retired" would leave the security-shaped misreading of `sanitize`
      // in place.
      expect(issue?.message).toContain(prescriptive);
      expect(issue?.message).toBe(guidance);
      // ONE string, BOTH channels — asserted derived, so the parse message and
      // the generated-docs metadata cannot drift apart (objectui#6931).
      expect(issue?.message).toBe(describeOf(MarkdownSchema, key));
    });

    it('keeps the key DECLARED — a tombstone, not a deletion', () => {
      // The route guard. `BaseSchema` is `.passthrough()`, so removing the key
      // from the mirror would make the authored spelling parse green again and
      // do nothing — the silent no-op reintroduced by the very edit meant to
      // remove it.
      expect(
        Object.keys(MarkdownSchema.shape),
        `${key} left the mirror — under .passthrough() the retired key becomes a SILENT no-op again`,
      ).toContain(key);
      expect(describeOf(MarkdownSchema, key)).toContain('RETIRED (objectui#6972)');
    });
  },
);

/* ── the inside of the boundary: everything else is untouched ────────────── */

describe('the retirement narrows exactly the retired keys and nothing else (objectui#6972)', () => {
  it('a document that never wrote either key parses GREEN — `absent` stays valid', () => {
    // `.optional()` on both tombstones. The retirement narrows exactly two keys.
    const result = MarkdownSchema.safeParse(VALID_MARKDOWN);
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('still ACCEPTS `className` — the live sibling the renderer actually forwards', () => {
    // `className` is the OTHER value `MarkdownRenderer` forwards (with
    // `content`). Without this leg the refusals above would be satisfied by a
    // schema that refuses every optional key — a narrowing that refuses too
    // much would pass a refusal-only test.
    const result = MarkdownSchema.safeParse({ ...VALID_MARKDOWN, className: 'prose-lg' });
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('still REFUSES a wrong `content` — the mirror did not stop validating', () => {
    // Counter-probe in the other direction: the schema is not `z.any()` in
    // disguise, so the green results above are readings.
    const result = MarkdownSchema.safeParse({ type: 'markdown', content: 42 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.find((i) => i.path[0] === 'content')).toBeTruthy();
  });

  it('the shipped example document parses GREEN — the fixture that used to author the key', () => {
    // `packages/types/examples/data-display-examples.json#examples.markdown`
    // authored `"sanitize": true` — the one in-repo write of either key, dropped
    // by the retiring PR because the tombstone refuses it. Pinned here so the
    // fixture cannot silently regress into a document the published mirror
    // rejects: it is documentation consumers copy from.
    const ROOT = resolve(__dirname, '../../../..');
    const doc = JSON.parse(
      readFileSync(resolve(ROOT, 'packages/types/examples/data-display-examples.json'), 'utf8'),
    ) as { examples: { markdown: Record<string, unknown> } };
    const markdown = doc.examples.markdown;
    expect(markdown.type).toBe('markdown');
    for (const key of Object.keys(RETIRED)) {
      expect(markdown, `the fixture still authors the retired \`${key}\``).not.toHaveProperty(key);
    }
    const result = MarkdownSchema.safeParse(markdown);
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('an UNDECLARED key still rides `.passthrough()` — the DELETED row, measured live', () => {
    // This is the contrast that justifies `?: never` over deletion, pinned
    // rather than argued: a key the mirror does not declare is neither refused
    // nor stripped, it is KEPT. Had either key been deleted instead of
    // tombstoned, an authored value would sit exactly where this one sits —
    // green, forwarded, and read by nothing.
    const result = MarkdownSchema.safeParse({ ...VALID_MARKDOWN, notAKeyAtAll: 'anything' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveProperty('notAKeyAtAll', 'anything');
  });
});

/* ── the TS half: the `tsc` channel ──────────────────────────────────────── */

describe('MarkdownSchema.sanitize is RETIRED — the TS half of the tombstone (objectui#6972)', () => {
  it('refuses the retired key at compile time', () => {
    // On the pre-fix tree `sanitize` is `boolean | undefined`, so the
    // assignment is LEGAL, the directive below is unused, and `tsc` fails the
    // build with TS2578 naming the key — this leg is red before the fix in
    // `type-check`, not in vitest, which strips types.

    // @ts-expect-error — `sanitize` is RETIRED (objectui#6972): declared `?: never`, so no value is authorable.
    const retired: MarkdownSchemaTS['sanitize'] = false;

    // Counter-probe on the same surface: the live sibling still accepts its
    // value, so the directive above pins the KEY's retirement and not a
    // blanket narrowing of the interface.
    const sibling: MarkdownSchemaTS['content'] = '# Hello';

    expect([retired, sibling]).toHaveLength(2);
  });

  it('refuses the retired key in the form authors actually write', () => {
    // The leg that proved the tombstone survives `BaseSchema`'s
    // `[key: string]: any` while it stood (objectui#8347 removed it): if the
    // index signature had won, `sanitize` would have widened back to `any`
    // here and the directive would have gone unused (TS2578).
    const retiredDocument: MarkdownSchemaTS = {
      type: 'markdown',
      content: '# Hello',
      // @ts-expect-error — `sanitize` is RETIRED (objectui#6972); sanitization is unconditional, there is no spelling that disables it.
      sanitize: false,
    };

    // The migrated document — the key simply deleted — still type-checks.
    const migratedDocument: MarkdownSchemaTS = {
      type: 'markdown',
      content: '# Hello',
      className: 'prose-lg',
    };

    expect([retiredDocument, migratedDocument]).toHaveLength(2);
  });

  it('refuses it through a WIDENED value too — the half a deletion would have missed', () => {
    // Excess-property checking only reaches a FRESH literal (objectui#7654
    // measured the contrast): a deleted key would ride a widened value
    // silently. The declared `never` makes the assignment itself ill-typed,
    // so freshness stops mattering.
    const raw = { type: 'markdown' as const, content: '# Hello', sanitize: true };
    // @ts-expect-error — `sanitize` is RETIRED (objectui#6972), reached through a non-fresh value.
    const document: MarkdownSchemaTS = raw;
    expect(document.type).toBe('markdown');
  });
});

describe('MarkdownSchema.components is RETIRED — the TS half of the tombstone (objectui#6972)', () => {
  it('refuses the retired key at compile time', () => {
    // On the pre-fix tree `components` is `Record<string, any> | undefined`,
    // so this assignment is LEGAL and the directive is unused (TS2578) —
    // red before the fix in `type-check`.

    // @ts-expect-error — `components` is RETIRED (objectui#6972): declared `?: never`, so no value is authorable.
    const retired: MarkdownSchemaTS['components'] = { h1: 'h2' };

    const sibling: MarkdownSchemaTS['className'] = 'prose-lg';
    expect([retired, sibling]).toHaveLength(2);
  });

  it('refuses the retired key in the form authors actually write', () => {
    // Survived `BaseSchema`'s `[key: string]: any` while it stood (objectui#8347
    // removed it): if the index signature had won, `components` would have
    // widened back to `any` here and the directive would have gone unused
    // (TS2578).
    const retiredDocument: MarkdownSchemaTS = {
      type: 'markdown',
      content: '# Hello',
      // @ts-expect-error — `components` is RETIRED (objectui#6972); the renderer forwards only `content` and `className`.
      components: { h1: 'h2' },
    };
    expect(retiredDocument.type).toBe('markdown');
  });

  it('refuses it through a WIDENED value too — and there is NO runtime-slot twin to keep callable', () => {
    // The `runtime-slot` arm (`handlerKeyRefusal`, objectui#6124) keeps a TS
    // twin callable when a host-supplied value actually REACHES a renderer.
    // Nothing reaches this one — `MarkdownImplProps` has no such prop — so the
    // TS face refuses it outright, on the widened path as well.
    const raw = { type: 'markdown' as const, content: '# Hello', components: { h1: 'h2' } };
    // @ts-expect-error — `components` is RETIRED (objectui#6972), reached through a non-fresh value.
    const document: MarkdownSchemaTS = raw;
    expect(document.type).toBe('markdown');
  });
});
