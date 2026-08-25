import { describe, it, expect } from 'vitest';
import {
  ResponsiveStylesSchema,
  StyleMapSchema,
} from './responsive.zod';
import { PageComponentSchema } from './page.zod';

// BreakpointName / ResponsiveConfigSchema / BreakpointColumnMapSchema /
// BreakpointOrderMapSchema tests removed with the schemas (#11027, ADR-0049
// D2): every authorable carrier of the `responsive` layout block was inert —
// `view.responsive` (#3896), `dashboard.widgets[].responsive` (#4876), and
// finally `page.components[].responsive`, whose two objectui consumer
// implementations had zero callers. The retirement pins live in
// `page.test.ts` ("[#11027] PageComponentSchema — retired `responsive`");
// the #4001 批 13 curation measurements those suites kept executable are
// preserved on the surviving shape below where they still have a subject.

// ---------------------------------------------------------------------------
// #4001 batch 13 (ADR-0078). This file used to carry TWO breakpoint
// vocabularies sixteen lines apart on the same page component; since #11027
// only `responsiveStyles` (large/medium/small/xsmall, ADR-0065) survives, and
// the curation's job is to catch the vocabularies authors still carry in —
// the Tailwind ramp, and the knobs of the retired `responsive` block.
// ---------------------------------------------------------------------------
describe('unknown keys are rejected, not stripped (#4001 batch 13)', () => {
  const unknownKeyIssue = (schema: { safeParse: (v: unknown) => any }, value: unknown) => {
    const result = schema.safeParse(value);
    expect(result.success).toBe(false);
    return result.error!.issues.find((i: { code: string }) => i.code === 'unrecognized_keys');
  };

  describe('ResponsiveStylesSchema', () => {
    it('rejects an undeclared bucket instead of dropping it', () => {
      expect(unknownKeyIssue(ResponsiveStylesSchema, { desktop: { fontSize: '40px' } })!.message)
        .toContain('`desktop`');
    });

    it('maps the Tailwind ramp onto the max-width bucket that contains it', () => {
      // The vocabulary the retired sibling `responsive` block was keyed by
      // (#11027), and the one authors carry in from Tailwind itself. Edit
      // distance cannot get from `lg` to `large`, so only a written-down
      // alias answers it.
      const cases: Array<[string, string]> = [
        ['xs', 'xsmall'], ['sm', 'small'], ['md', 'medium'],
        ['lg', 'large'], ['xl', 'large'], ['2xl', 'large'],
      ];
      for (const [wrote, meant] of cases) {
        expect(
          unknownKeyIssue(ResponsiveStylesSchema, { [wrote]: { fontSize: '1px' } })!.message,
          `\`${wrote}\` should point at \`${meant}\``,
        ).toContain(`\`${wrote}\` → \`${meant}\``);
      }
    });

    it('answers a retired `responsive` knob with its CSS translation', () => {
      // `columns` / `hiddenOn` / `order` were the knobs of the retired layout
      // block (#11027). An author who lands one here is migrating off it, so
      // each entry names the removal and the CSS that IS applied.
      for (const key of ['columns', 'hiddenOn', 'order']) {
        const message = unknownKeyIssue(ResponsiveStylesSchema, { [key]: {} })!.message;
        expect(message, `\`${key}\` should name the retirement`).toContain('retired `responsive` layout block');
        expect(message).toContain('#11027');
        expect(message).toContain('per-breakpoint CSS');
      }
    });

    it('still accepts every declared bucket', () => {
      const parsed = ResponsiveStylesSchema.parse({
        large: { display: 'flex', gap: 'var(--space-2)' },
        medium: { gap: '4px' },
        small: { fontSize: '18px' },
        xsmall: { display: 'none' },
      });
      expect(parsed.large?.display).toBe('flex');
      expect(parsed.xsmall?.display).toBe('none');
    });
  });

  // THE SEAM #4001 批 13 EXISTED FOR. `PageComponentSchema` has been `.strict()`
  // since ADR-0089 D3a, and that never reached these blocks — a strict shell
  // over strip-mode children is not a closed surface, it is a closed surface's
  // silhouette.
  describe('the page-component seam', () => {
    const component = (extra: Record<string, unknown>) => ({
      type: 'element:text', id: 't1', ...extra,
    });

    it('keeps parsing exactly what it parsed before — pinned', () => {
      // The showcase authors `responsiveStyles` on ~40 nodes in this shape
      // (`examples/app-showcase/src/ui/pages/*.page.ts`). It must be untouched
      // by the #11027 retirement of its sibling.
      const parsed = PageComponentSchema.parse(component({
        responsiveStyles: {
          large: { fontSize: '40px', fontWeight: '700' },
          small: { fontSize: '30px' },
        },
      }));
      expect(parsed.responsiveStyles?.large?.fontSize).toBe('40px');
      expect(parsed.responsiveStyles?.small?.fontSize).toBe('30px');
    });

    it('no longer accepts a component whose styling silently evaporates', () => {
      // Before #4001 批 13 the SAME input parsed clean and returned
      // `{ responsiveStyles: {} }` — every styling instruction the author
      // wrote, gone, reported valid.
      const result = PageComponentSchema.safeParse(component({
        responsiveStyles: { lg: { fontSize: '40px' } },
      }));
      expect(result.success).toBe(false);
    });

    it('reports the nested failure at the nested path, not at the component', () => {
      const result = PageComponentSchema.safeParse(component({
        responsiveStyles: { lg: { fontSize: '40px' } },
      }));
      expect(result.success).toBe(false);
      const issue = result.error!.issues[0];
      expect(issue.path).toEqual(['responsiveStyles']);
      expect(issue.message).toContain('`lg` → `large`');
    });
  });

  // Asserted, not assumed, so the next sweep reads a test rather than reaching
  // for `strictObject`.
  describe('deliberately still open', () => {
    it('StyleMapSchema stays open — its key space is every CSS property', () => {
      // objectui's `declarations()` camel→kebab-cases whatever it is handed and
      // emits it verbatim (`@object-ui/core`, `styling/scoped-styles.ts`), so
      // closing this would mean transcribing the CSS property list into the
      // spec and rejecting each new one until someone noticed.
      const parsed = StyleMapSchema.parse({
        containerType: 'inline-size',
        aspectRatio: '16 / 9',
        '--custom-token': 'red',
      });
      expect(parsed.containerType).toBe('inline-size');
      expect(parsed['--custom-token']).toBe('red');
    });

    it('…and an open style map does not reopen the bucket around it', () => {
      const result = ResponsiveStylesSchema.safeParse({ lg: { containerType: 'inline-size' } });
      expect(result.success).toBe(false);
    });
  });
});
