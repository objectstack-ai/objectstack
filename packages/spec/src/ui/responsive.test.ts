import { describe, it, expect } from 'vitest';
import {
  ResponsiveConfigSchema,
  ResponsiveStylesSchema,
  StyleMapSchema,
  BreakpointColumnMapSchema,
  BreakpointOrderMapSchema,
  BreakpointName,
  type ResponsiveConfig,
} from './responsive.zod';
import { PageComponentSchema } from './page.zod';

describe('BreakpointName', () => {
  it('should accept all valid breakpoint names', () => {
    const names = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const;

    names.forEach(name => {
      expect(() => BreakpointName.parse(name)).not.toThrow();
    });
  });

  it('should reject invalid breakpoint names', () => {
    expect(() => BreakpointName.parse('xxl')).toThrow();
    expect(() => BreakpointName.parse('mobile')).toThrow();
    expect(() => BreakpointName.parse('')).toThrow();
  });
});

describe('ResponsiveConfigSchema', () => {
  it('should accept empty config', () => {
    expect(() => ResponsiveConfigSchema.parse({})).not.toThrow();
  });

  it('should accept config with breakpoint visibility', () => {
    const config: ResponsiveConfig = {
      breakpoint: 'md',
    };

    const result = ResponsiveConfigSchema.parse(config);
    expect(result.breakpoint).toBe('md');
  });

  it('should accept config with hiddenOn breakpoints', () => {
    const config: ResponsiveConfig = {
      hiddenOn: ['xs', 'sm'],
    };

    const result = ResponsiveConfigSchema.parse(config);
    expect(result.hiddenOn).toEqual(['xs', 'sm']);
  });

  it('should accept config with column mapping', () => {
    const config: ResponsiveConfig = {
      columns: { xs: 12, sm: 6, md: 4, lg: 3 },
    };

    const result = ResponsiveConfigSchema.parse(config);
    expect(result.columns?.xs).toBe(12);
    expect(result.columns?.lg).toBe(3);
  });

  it('should reject columns outside 1-12 range', () => {
    expect(() => ResponsiveConfigSchema.parse({
      columns: { xs: 0 },
    })).toThrow();

    expect(() => ResponsiveConfigSchema.parse({
      columns: { xs: 13 },
    })).toThrow();
  });

  it('should accept config with display order', () => {
    const config: ResponsiveConfig = {
      order: { xs: 2, lg: 1 },
    };

    const result = ResponsiveConfigSchema.parse(config);
    expect(result.order?.xs).toBe(2);
    expect(result.order?.lg).toBe(1);
  });

  it('should accept full responsive config', () => {
    const config: ResponsiveConfig = {
      breakpoint: 'sm',
      hiddenOn: ['xs'],
      columns: { xs: 12, sm: 6, md: 4, lg: 3, xl: 2 },
      order: { xs: 3, lg: 1 },
    };

    expect(() => ResponsiveConfigSchema.parse(config)).not.toThrow();
  });
});

// PerformanceConfigSchema tests removed with the schema (#3896 close-out):
// every carrier of a `performance` block was authorable and inert.
//
// The `type PerformanceConfig` import that survived beside them until #4001
// batch 13 did not: it named an export removed with the schema, so this file
// had been importing a type that does not exist. It compiled only because
// nothing here used it.

// ---------------------------------------------------------------------------
// #4001 batch 13 (ADR-0078). This file carries TWO breakpoint vocabularies and
// they sit sixteen lines apart on the same page component — `responsiveStyles`
// (large/medium/small/xsmall, ADR-0065) and `responsive` (columns/order keyed
// xs…2xl). Crossing them is the mistake this file invites, and until now every
// crossing was silent.
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
      // The sibling vocabulary: `BreakpointName`, declared in this same file and
      // used by `responsive` on the same component. Edit distance cannot get
      // from `lg` to `large`, so only a written-down alias answers it.
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

    it('points a `responsive` key at the sibling key, not at a bucket', () => {
      for (const key of ['columns', 'hiddenOn', 'order']) {
        const message = unknownKeyIssue(ResponsiveStylesSchema, { [key]: {} })!.message;
        expect(message, `\`${key}\` should be sent one level out`).toContain('sibling key');
        expect(message).toContain('`responsive:');
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

  describe('ResponsiveConfigSchema', () => {
    it('rejects an undeclared key instead of dropping it', () => {
      expect(unknownKeyIssue(ResponsiveConfigSchema, { colums: { lg: 4 } })!.message)
        .toContain('`colums` → `columns`');
    });

    it('answers a bare breakpoint name with the knob-first shape', () => {
      // The legacy breakpoint-keyed form. Not hypothetical: it is the `before`
      // fixture of the `view-inert-keys-removed` conversion, from the
      // `view.responsive` retired in 17 (#3896).
      const message = unknownKeyIssue(ResponsiveConfigSchema, { sm: {} })!.message;
      expect(message).toContain('BREAKPOINT NAME');
      expect(message).toContain("columns: { sm: 6 }");
    });

    it('names each offending breakpoint separately, not once for all of them', () => {
      // `guidance` emits one bullet VERBATIM per key, so a shared prescription
      // string prints the same paragraph N times (the batch 10 `join` /
      // `joinGateway` lesson). Each name carries its own text instead.
      const message = unknownKeyIssue(ResponsiveConfigSchema, { sm: {}, lg: {} })!.message;
      expect(message).toContain("columns: { sm: 6 }");
      expect(message).toContain("columns: { lg: 6 }");
    });

    it('sends a `responsiveStyles` bucket back to the sibling key', () => {
      for (const bucket of ['large', 'medium', 'small', 'xsmall']) {
        expect(unknownKeyIssue(ResponsiveConfigSchema, { [bucket]: {} })!.message)
          .toContain('`responsiveStyles`');
      }
      expect(unknownKeyIssue(ResponsiveConfigSchema, { responsiveStyles: {} })!.message)
        .toContain('one level');
    });

    it('reaches `hiddenOn` from both wrong spellings', () => {
      // `hidden` is objectui's RESOLVED spelling (`useResponsiveConfig` returns
      // `{ hidden, columns, order, breakpoint }`). `hideOn` is the same word,
      // and the distance fallback measurably cannot reach it — it lowercases
      // the input but not the candidates, so the capital in `hiddenOn` costs an
      // extra edit against a budget of 2 (filed as #4990).
      expect(unknownKeyIssue(ResponsiveConfigSchema, { hidden: true })!.message)
        .toContain('`hidden` → `hiddenOn`');
      expect(unknownKeyIssue(ResponsiveConfigSchema, { hideOn: ['xs'] })!.message)
        .toContain('`hideOn` → `hiddenOn`');
    });
  });

  describe('the per-breakpoint maps', () => {
    it('maps the styling vocabulary back onto the Tailwind ramp', () => {
      for (const schema of [BreakpointColumnMapSchema, BreakpointOrderMapSchema]) {
        for (const [wrote, meant] of [['large', 'lg'], ['medium', 'md'], ['small', 'sm'], ['xsmall', 'xs']]) {
          expect(unknownKeyIssue(schema, { [wrote]: 4 })!.message)
            .toContain(`\`${wrote}\` → \`${meant}\``);
        }
      }
    });

    it('answers the recorded `xxl` near-miss with `2xl`', () => {
      // Pinned as an invalid breakpoint name by this file's own test since
      // before #4001 ("should reject invalid breakpoint names", above).
      expect(unknownKeyIssue(BreakpointColumnMapSchema, { xxl: 4 })!.message)
        .toContain('`xxl` → `2xl`');
    });

    it('was the worst of the three, because half the map survived', () => {
      // Measured on `main` before this change:
      //   ResponsiveConfigSchema.parse({ columns: { large: 4, lg: 3 } })
      //     → { columns: { lg: 3 } }
      // The node did lay out — at the wrong width, on the breakpoints the
      // author never named. A total loss is at least visible.
      const result = ResponsiveConfigSchema.safeParse({ columns: { large: 4, lg: 3 } });
      expect(result.success).toBe(false);
    });

    it('still accepts every declared breakpoint, including the quoted one', () => {
      expect(BreakpointColumnMapSchema.parse({ xs: 12, sm: 6, md: 4, lg: 3, xl: 2, '2xl': 1 })['2xl']).toBe(1);
      expect(BreakpointOrderMapSchema.parse({ xs: 3, '2xl': 1 })['2xl']).toBe(1);
    });
  });

  // THE SEAM THIS CHANGE EXISTS FOR. `PageComponentSchema` has been `.strict()`
  // since ADR-0089 D3a, and that never reached these blocks — a strict shell
  // over strip-mode children is not a closed surface, it is a closed surface's
  // silhouette.
  describe('the page-component seam', () => {
    const component = (extra: Record<string, unknown>) => ({
      type: 'element:text', id: 't1', ...extra,
    });

    it('keeps parsing exactly what it parsed before — pinned', () => {
      // The showcase authors `responsiveStyles` on ~40 nodes in this shape
      // (`examples/app-showcase/src/ui/pages/*.page.ts`); `page.test.ts` authors
      // `responsive: { hiddenOn: [...] }`. Both must be untouched by this change.
      const parsed = PageComponentSchema.parse(component({
        responsiveStyles: {
          large: { fontSize: '40px', fontWeight: '700' },
          small: { fontSize: '30px' },
        },
        responsive: { hiddenOn: ['xs', 'sm'], columns: { xs: 12, lg: 4 }, order: { lg: 1 } },
      }));
      expect(parsed.responsiveStyles?.large?.fontSize).toBe('40px');
      expect(parsed.responsive?.hiddenOn).toEqual(['xs', 'sm']);
      expect(parsed.responsive?.columns?.lg).toBe(4);
    });

    it('no longer accepts a component whose styling silently evaporates', () => {
      // Before this change the SAME input parsed clean and returned
      // `{ responsiveStyles: {}, responsive: {} }` — every styling and layout
      // instruction the author wrote, gone, reported valid.
      const result = PageComponentSchema.safeParse(component({
        responsiveStyles: { lg: { fontSize: '40px' } },
        responsive: { colums: { lg: 4 }, hideOn: ['xs'] },
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
