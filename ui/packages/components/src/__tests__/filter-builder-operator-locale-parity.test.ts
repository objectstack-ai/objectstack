/**
 * Every operator the FilterBuilder dropdown can DRAW carries a label in every
 * locale pack (objectstack#8815).
 *
 * ## The hole this closes
 *
 * The operator label is looked up with a key the component BUILDS:
 *
 * ```tsx
 * {t(`filterBuilder.operators.${op.value}`)}
 * ```
 *
 * Nothing upstream can check that. `scripts/check-i18n-call-site-keys.mjs`
 * classifies a template key as `missing-prefix` and asks only whether the
 * PREFIX (`filterBuilder.operators`) resolves — it does, sixteen members deep —
 * because there is no static way to know which members a dynamic key needs.
 * `all-locales-key-parity.test.ts` asks whether the ten packs AGREE, and its own
 * header records why that is green here by construction: "Ten packs identically
 * missing it is full parity."
 *
 * So six operators — `startsWith`, `endsWith`, `isNull`, `isNotNull`, `exists`,
 * `notExists` — were absent from ALL TEN packs at once and every existing gate
 * was green. What the user saw was the raw key: i18next resolves a missing key
 * to the key itself, and the component's `createSafeTranslation` defaults table
 * cannot save it — that table serves only the NO-PROVIDER path, and the Console
 * mounts a provider, so the pack's answer is the one that renders.
 *
 * The reported repro (a `date` column) shows exactly four of them, because a
 * date field's bucket offers the four nullness operators and not
 * `startsWith`/`endsWith`; a `text` column shows all six. That is why this test
 * asserts over the whole DRAWABLE vocabulary rather than the four that were
 * reported — the defect was never about which bucket the reporter opened.
 *
 * ## Why the assertion is against `FILTER_BUILDER_OPERATORS`
 *
 * That export is the vocabulary the dropdown draws, derived from the operators
 * the component actually renders — so a new operator added to `defaultOperators`
 * lands here as a red test naming the packs it still needs, instead of shipping
 * as a raw key. It includes the opt-in ids (`exists`, `notExists`):
 * `OPT_IN_OPERATORS` governs which CONSUMERS are offered an operator, not
 * whether the builder can draw it, and `FilterConditionField` grants both — a
 * drawable operator needs a label. (The case-insensitive contains was a third
 * opt-in id, `containsCaseInsensitive`, until objectui#9306 made it the
 * ordinary protocol id `icontains`.)
 *
 * Placement is forced by the dependency graph: `@object-ui/components` depends
 * on `@object-ui/i18n`, so this is the side that can see both the vocabulary and
 * the packs. The reverse import would be a cycle, which is why this guard cannot
 * live beside the other locale-parity tests in `packages/i18n`.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '@object-ui/i18n/locales';

import { FILTER_BUILDER_OPERATORS } from '../custom/filter-builder';

type LocaleCode = keyof typeof builtInLocales;

const LOCALES = Object.keys(builtInLocales) as LocaleCode[];

/** Read a dot-path out of a nested translation node. */
function readPath(node: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, seg) =>
      acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[seg] : undefined,
    node,
  );
}

const operatorsNode = (code: LocaleCode): unknown =>
  readPath(builtInLocales[code], 'filterBuilder.operators');

describe('filterBuilder.operators locale parity', () => {
  it('every pack defines the namespace', () => {
    const missing = LOCALES.filter((code) => !operatorsNode(code));
    expect(missing).toEqual([]);
  });

  it.each(LOCALES)('%s labels every operator the dropdown can draw', (code) => {
    const node = operatorsNode(code) as Record<string, unknown>;
    // Reported as the full list rather than one `toBeDefined()` per operator:
    // these went missing six at a time, and a failure that names all six is the
    // difference between one fix and six rounds of it.
    const missing = FILTER_BUILDER_OPERATORS.filter((op) => {
      const label = node?.[op];
      return typeof label !== 'string' || label.trim() === '';
    });
    expect(missing).toEqual([]);
  });

  it.each(LOCALES)('%s defines no operator label the dropdown cannot draw', (code) => {
    // The other direction: a label for an operator that no longer exists is
    // dead weight that reads as coverage. Keeps the two sides converging.
    const node = operatorsNode(code) as Record<string, unknown>;
    const orphaned = Object.keys(node ?? {}).filter(
      (key) => !(FILTER_BUILDER_OPERATORS as readonly string[]).includes(key),
    );
    expect(orphaned).toEqual([]);
  });

  it('no pack renders an operator label as its own raw key', () => {
    // The exact user-visible symptom: `t('filterBuilder.operators.isNull')`
    // returning `'filterBuilder.operators.isNull'`. A pack that "defines" the
    // key as the key would satisfy the presence assertions above while showing
    // the user the same machine name.
    const offenders: string[] = [];
    for (const code of LOCALES) {
      const node = operatorsNode(code) as Record<string, unknown>;
      for (const op of FILTER_BUILDER_OPERATORS) {
        const label = node?.[op];
        if (typeof label === 'string' && label.includes('filterBuilder.operators')) {
          offenders.push(`${code}.${op}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
