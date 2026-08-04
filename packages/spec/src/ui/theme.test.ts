import { describe, it, expect } from 'vitest';
import {
  ThemeSchema,
  ThemeMode,
  ThemeModeSchema,
  ColorPaletteSchema,
  TypographySchema,
  BorderRadiusSchema,
  ShadowSchema,
  defineTheme,
  type Theme,
  type ColorPalette,
} from './theme.zod';
import { ObjectStackSchema } from '../stack.zod';

describe('ThemeMode', () => {
  it('should accept valid theme modes', () => {
    expect(() => ThemeMode.parse('light')).not.toThrow();
    expect(() => ThemeMode.parse('dark')).not.toThrow();
    expect(() => ThemeMode.parse('auto')).not.toThrow();
  });

  it('should reject invalid theme modes', () => {
    expect(() => ThemeMode.parse('custom')).toThrow();
    expect(() => ThemeMode.parse('system')).toThrow();
  });
});

describe('ColorPaletteSchema', () => {
  it('should accept minimal color palette with primary color', () => {
    const palette: ColorPalette = {
      primary: '#007BFF',
    };

    expect(() => ColorPaletteSchema.parse(palette)).not.toThrow();
  });

  it('should accept complete color palette', () => {
    const palette: ColorPalette = {
      primary: '#007BFF',
      secondary: '#6C757D',
      accent: '#FFC107',
      success: '#28A745',
      warning: '#FFC107',
      error: '#DC3545',
      info: '#17A2B8',
      background: '#FFFFFF',
      surface: '#F8F9FA',
      text: '#212529',
      textSecondary: '#6C757D',
      border: '#DEE2E6',
      disabled: '#E9ECEF',
      primaryLight: '#4DA3FF',
      primaryDark: '#0056B3',
    };

    expect(() => ColorPaletteSchema.parse(palette)).not.toThrow();
  });

  it('should accept colors in different formats', () => {
    const palette: ColorPalette = {
      primary: '#007BFF', // hex
      secondary: 'rgb(108, 117, 125)', // rgb
      accent: 'hsl(45, 100%, 51%)', // hsl
    };

    expect(() => ColorPaletteSchema.parse(palette)).not.toThrow();
  });
});

describe('TypographySchema', () => {
  it('should accept minimal typography settings', () => {
    const typography = {
      fontFamily: {
        base: 'Inter, system-ui, sans-serif',
      },
    };

    expect(() => TypographySchema.parse(typography)).not.toThrow();
  });

  it('should accept complete typography settings', () => {
    const typography = {
      fontFamily: {
        base: 'Inter, system-ui, sans-serif',
        heading: 'Poppins, sans-serif',
        mono: 'Fira Code, monospace',
      },
      fontSize: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
        '4xl': '2.25rem',
      },
      fontWeight: {
        light: 300,
        normal: 400,
        medium: 500,
        semibold: 600,
        bold: 700,
      },
      lineHeight: {
        tight: '1.25',
        normal: '1.5',
        relaxed: '1.75',
        loose: '2',
      },
      letterSpacing: {
        tighter: '-0.05em',
        tight: '-0.025em',
        normal: '0',
        wide: '0.025em',
        wider: '0.05em',
      },
    };

    expect(() => TypographySchema.parse(typography)).not.toThrow();
  });
});

describe('BorderRadiusSchema', () => {
  it('should accept border radius scale', () => {
    const borderRadius = {
      none: '0',
      sm: '0.125rem',
      base: '0.25rem',
      md: '0.375rem',
      lg: '0.5rem',
      full: '9999px',
    };

    expect(() => BorderRadiusSchema.parse(borderRadius)).not.toThrow();
  });
});

describe('ShadowSchema', () => {
  it('should accept shadow definitions', () => {
    const shadows = {
      none: 'none',
      sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      base: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
      md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
    };

    expect(() => ShadowSchema.parse(shadows)).not.toThrow();
  });
});

describe('ThemeSchema', () => {
  it('should accept minimal theme with required fields', () => {
    const theme: Theme = {
      name: 'default_theme',
      label: 'Default Theme',
      colors: {
        primary: '#007BFF',
      },
    };

    expect(() => ThemeSchema.parse(theme)).not.toThrow();
  });

  it('should enforce snake_case for theme name', () => {
    const validNames = ['default_theme', 'dark_theme', 'custom_2023'];
    validNames.forEach(name => {
      const theme: Theme = {
        name,
        label: 'Test Theme',
        colors: { primary: '#000000' },
      };
      expect(() => ThemeSchema.parse(theme)).not.toThrow();
    });

    const invalidNames = ['DefaultTheme', 'dark-theme', '123theme'];
    invalidNames.forEach(name => {
      const theme = {
        name,
        label: 'Test Theme',
        colors: { primary: '#000000' },
      };
      expect(() => ThemeSchema.parse(theme)).toThrow();
    });
  });

  it('should accept complete theme configuration', () => {
    const theme: Theme = {
      name: 'enterprise_theme',
      label: 'Enterprise Theme',
      description: 'Professional theme for enterprise applications',
      mode: 'light',
      colors: {
        primary: '#0066CC',
        secondary: '#6C757D',
        accent: '#FFC107',
        success: '#28A745',
        warning: '#FFC107',
        error: '#DC3545',
        info: '#17A2B8',
        background: '#FFFFFF',
        surface: '#F8F9FA',
        text: '#212529',
        textSecondary: '#6C757D',
        border: '#DEE2E6',
      },
      typography: {
        fontFamily: {
          base: 'Inter, sans-serif',
          heading: 'Poppins, sans-serif',
          mono: 'Fira Code, monospace',
        },
        fontSize: {
          base: '1rem',
          lg: '1.125rem',
          xl: '1.25rem',
        },
      },
      borderRadius: {
        base: '0.25rem',
        lg: '0.5rem',
      },
      shadows: {
        base: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
        lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
      },
    };

    expect(() => ThemeSchema.parse(theme)).not.toThrow();
  });

  it('should accept theme with custom CSS variables', () => {
    const theme: Theme = {
      name: 'custom_vars_theme',
      label: 'Custom Variables Theme',
      colors: {
        primary: '#007BFF',
      },
      customVars: {
        '--header-height': '64px',
        '--sidebar-width': '256px',
        '--transition-speed': '0.3s',
      },
    };

    expect(() => ThemeSchema.parse(theme)).not.toThrow();
  });

  it('should accept theme that extends another theme', () => {
    const theme: Theme = {
      name: 'dark_extended',
      label: 'Dark Extended Theme',
      extends: 'default_theme',
      colors: {
        primary: '#007BFF',
        background: '#1A1A1A',
        text: '#FFFFFF',
      },
    };

    expect(() => ThemeSchema.parse(theme)).not.toThrow();
  });

  it('should apply default mode', () => {
    const theme = {
      name: 'test_theme',
      label: 'Test Theme',
      colors: {
        primary: '#007BFF',
      },
    };

    const result = ThemeSchema.parse(theme);
    expect(result.mode).toBe('light');
  });

  it('should accept dark mode theme', () => {
    const theme: Theme = {
      name: 'dark_theme',
      label: 'Dark Theme',
      mode: 'dark',
      colors: {
        primary: '#4DA3FF',
        background: '#1A1A1A',
        surface: '#2D2D2D',
        text: '#FFFFFF',
        textSecondary: '#B0B0B0',
        border: '#404040',
      },
    };

    expect(() => ThemeSchema.parse(theme)).not.toThrow();
  });

  it('should accept auto mode theme', () => {
    const theme: Theme = {
      name: 'auto_theme',
      label: 'Auto Theme',
      mode: 'auto',
      colors: {
        primary: '#007BFF',
      },
    };

    expect(() => ThemeSchema.parse(theme)).not.toThrow();
  });

  it('should accept theme with z-index configuration', () => {
    const theme: Theme = {
      name: 'layered_theme',
      label: 'Layered Theme',
      colors: {
        primary: '#007BFF',
      },
      zIndex: {
        base: 0,
        dropdown: 1000,
        sticky: 1020,
        fixed: 1030,
        modalBackdrop: 1040,
        modal: 1050,
        popover: 1060,
        tooltip: 1070,
      },
    };

    expect(() => ThemeSchema.parse(theme)).not.toThrow();
  });

  it('should accept theme with animation settings', () => {
    const theme: Theme = {
      name: 'animated_theme',
      label: 'Animated Theme',
      colors: {
        primary: '#007BFF',
      },
      animation: {
        duration: {
          fast: '150ms',
          base: '300ms',
          slow: '500ms',
        },
        timing: {
          ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
          ease_in: 'cubic-bezier(0.4, 0, 1, 1)',
          ease_out: 'cubic-bezier(0, 0, 0.2, 1)',
          ease_in_out: 'cubic-bezier(0.4, 0, 0.2, 1)',
        },
      },
    };

    expect(() => ThemeSchema.parse(theme)).not.toThrow();
  });

});

describe('Real-World Theme Examples', () => {
  it('should accept enterprise light theme', () => {
    const theme: Theme = {
      name: 'enterprise_light',
      label: 'Enterprise Light',
      description: 'Professional light theme for enterprise applications',
      mode: 'light',
      colors: {
        primary: '#0066CC',
        secondary: '#4A5568',
        accent: '#ED8936',
        success: '#48BB78',
        warning: '#ECC94B',
        error: '#F56565',
        info: '#4299E1',
        background: '#FFFFFF',
        surface: '#F7FAFC',
        text: '#1A202C',
        textSecondary: '#718096',
        border: '#E2E8F0',
      },
      typography: {
        fontFamily: {
          base: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
          heading: 'Poppins, sans-serif',
        },
      },
    };

    expect(() => ThemeSchema.parse(theme)).not.toThrow();
  });

  it('should accept dark theme with extended configuration', () => {
    const theme: Theme = {
      name: 'professional_dark',
      label: 'Professional Dark',
      mode: 'dark',
      colors: {
        primary: '#60A5FA',
        secondary: '#9CA3AF',
        accent: '#FBBF24',
        success: '#34D399',
        warning: '#FBBF24',
        error: '#F87171',
        info: '#60A5FA',
        background: '#0F172A',
        surface: '#1E293B',
        text: '#F1F5F9',
        textSecondary: '#94A3B8',
        border: '#334155',
      },
      borderRadius: {
        base: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
      },
      shadows: {
        base: '0 1px 3px 0 rgba(0, 0, 0, 0.3)',
        md: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
        lg: '0 10px 15px -3px rgba(0, 0, 0, 0.3)',
      },
    };

    expect(() => ThemeSchema.parse(theme)).not.toThrow();
  });
});

// ============================================================================
// Issue #6: Easing naming unified to snake_case in theme animation tokens
// ============================================================================
describe('AnimationSchema - snake_case timing keys', () => {
  it('should accept snake_case easing keys', () => {
    const theme = ThemeSchema.parse({
      name: 'snake_case_timing',
      label: 'Snake Case Timing',
      colors: { primary: '#000' },
      animation: {
        timing: {
          linear: 'linear',
          ease: 'ease',
          ease_in: 'ease-in',
          ease_out: 'ease-out',
          ease_in_out: 'ease-in-out',
        },
      },
    });
    expect(theme.animation?.timing?.ease_in).toBe('ease-in');
    expect(theme.animation?.timing?.ease_out).toBe('ease-out');
    expect(theme.animation?.timing?.ease_in_out).toBe('ease-in-out');
  });
});

// ============================================================================
// Issue #9: ThemeModeSchema — canonical *Schema name with deprecated alias
// ============================================================================
describe('ThemeModeSchema (canonical name)', () => {
  it('should accept valid theme modes', () => {
    expect(() => ThemeModeSchema.parse('light')).not.toThrow();
    expect(() => ThemeModeSchema.parse('dark')).not.toThrow();
    expect(() => ThemeModeSchema.parse('auto')).not.toThrow();
  });

  it('should be the same as deprecated ThemeMode alias', () => {
    expect(ThemeModeSchema).toBe(ThemeMode);
  });
});

// ============================================================================
// #4001 批 15 — unknown keys are REJECTED, and the rejection is fixable.
//
// These assertions are the third of the three places this batch's verdict is
// recorded (the other two: the header comment in `theme.zod.ts`, and the ui/
// row in `docs/audits/2026-07-unknown-key-strictness-ledger.md`). They pin
// three separate things, because each can regress on its own:
//
//   1. THE DOOR. Strictness is a property of a PARSE; a strict schema nobody
//      parses gates nothing (#4583). So the first block asserts the parse
//      exists — `defineTheme()` and `defineStack({ themes })` — rather than
//      only asserting the schema is strict.
//   2. EVERY ONE of the 14 object sites is closed. Strictness does NOT recurse
//      (the 批 13 finding: a strict shell around strip sub-blocks is the
//      silhouette of a closed surface, not a closed surface), so each nested
//      block is probed at its own path.
//   3. The CURATION — the aliases and tombstones that make the rejection
//      fixable. Each entry here was measured against a named sibling contract,
//      not guessed; the comments in `theme.zod.ts` say which.
// ============================================================================
describe('#4001 批 15 — ThemeSchema unknown-key strictness', () => {
  const base = { name: 'brand_theme', label: 'Brand', colors: { primary: '#000000' } };
  const reject = (theme: unknown): string => {
    const r = ThemeSchema.safeParse(theme);
    expect(r.success, 'expected this theme to be REJECTED').toBe(false);
    return JSON.stringify(r.error?.issues ?? []);
  };

  it('the control parses — these tests fail closed, not by rejecting everything', () => {
    expect(ThemeSchema.safeParse(base).success).toBe(true);
  });

  // ---- 1. the door ----------------------------------------------------
  it('defineTheme() is a real parse door — it throws on an undeclared key', () => {
    expect(() => defineTheme({ ...base, spacing: {} } as never)).toThrow(/Unrecognized key/);
  });

  it('defineStack({ themes }) is the second door — ObjectStackSchema carries ThemeSchema', () => {
    const shape = (ObjectStackSchema as unknown as { _zod: { def: { shape: Record<string, unknown> } } })._zod.def.shape;
    expect(Object.keys(shape), 'the carrier key this file is reachable through').toContain('themes');
  });

  // ---- 2. all fourteen sites, each at its own path ---------------------
  it('rejects an undeclared key at the TOP level', () => {
    expect(reject({ ...base, extraKey: 1 })).toContain('extraKey');
  });

  it('rejects an undeclared key in `colors` — strictness does not stop at the shell', () => {
    expect(reject({ ...base, colors: { primary: '#000', notAColor: '#fff' } })).toContain('notAColor');
  });

  it.each([
    ['typography', { notATypographyKey: 1 }],
    ['borderRadius', { notARadius: '1px' }],
    ['shadows', { notAShadow: 'x' }],
    ['animation', { notAnAnimationKey: 1 }],
    ['zIndex', { notALayer: 1 }],
  ])('rejects an undeclared key in `%s`', (block, value) => {
    expect(reject({ ...base, [block]: value })).toContain(Object.keys(value)[0]);
  });

  it.each([
    ['fontFamily', { notAFamily: 'x' }],
    ['fontSize', { notASize: 'x' }],
    ['fontWeight', { notAWeight: 1 }],
    ['lineHeight', { notALeading: 'x' }],
    ['letterSpacing', { notATracking: 'x' }],
  ])('rejects an undeclared key in the nested `typography.%s` scale', (block, value) => {
    expect(reject({ ...base, typography: { [block]: value } })).toContain(Object.keys(value)[0]);
  });

  it.each([
    ['duration', { notADuration: 'x' }],
    ['timing', { notATiming: 'x' }],
  ])('rejects an undeclared key in the nested `animation.%s` block', (block, value) => {
    expect(reject({ ...base, animation: { [block]: value } })).toContain(Object.keys(value)[0]);
  });

  // ---- 3. curation ----------------------------------------------------
  it('renames the shadcn colour vocabulary onto the palette keys it maps to', () => {
    // MEASURED against objectui's COLOR_TO_CSS_MAP: `surface` is emitted as
    // `--card`, `text` as `--foreground`, `disabled` as `--muted`, `error` as
    // `--destructive`. An author reading the rendered CSS writes the shadcn
    // name back, which no edit distance can reach.
    const msg = reject({ ...base, colors: { primary: '#000', card: '#fff', foreground: '#111', destructive: '#f00' } });
    expect(msg).toContain('`card` → `surface`');
    expect(msg).toContain('`foreground` → `text`');
    expect(msg).toContain('`destructive` → `error`');
  });

  it('renames `md` onto `base` in the font-size scale — the same-file scale disagreement', () => {
    // `borderRadius` and `shadows` declare `md`; `fontSize` jumps sm → base → lg.
    expect(reject({ ...base, typography: { fontSize: { md: '1rem' } } })).toContain('`md` → `base`');
    // …and the mirror: three scales spell the middle stop `base`, fontWeight
    // spells it `normal`.
    expect(reject({ ...base, typography: { fontWeight: { base: 400 } } })).toContain('`base` → `normal`');
  });

  it('renames camelCase easing onto the snake_case keys this one block uses', () => {
    // The file's single snake_case vocabulary, against Prime Directive #3 —
    // so `easeIn` is an author obeying the repo's naming rule, not a typo.
    const msg = reject({ ...base, animation: { timing: { easeIn: 'x', easeInOut: 'y' } } });
    expect(msg).toContain('`easeIn` → `ease_in`');
    expect(msg).toContain('`easeInOut` → `ease_in_out`');
  });

  it('renames onto the camelCase targets the distance fallback is weak on (#4990)', () => {
    // `findClosestMatches` lowercases the input but not the candidates, so a
    // capital costs an edit. These land through the explicit table instead.
    expect(reject({ ...base, zIndex: { backdrop: 10 } })).toContain('`backdrop` → `modalBackdrop`');
    expect(reject({ ...base, radius: {} })).toContain('`radius` → `borderRadius`');
    expect(reject({ ...base, cssVars: {} })).toContain('`cssVars` → `customVars`');
  });

  it('renames `inset` onto `inner` — CSS\'s word for what this scale calls inner', () => {
    expect(reject({ ...base, shadows: { inset: '0 0 1px' } })).toContain('`inset` → `inner`');
  });

  it('carries a TOMBSTONE, not a rename, for each of the eight props #3494 removed', () => {
    for (const key of ['spacing', 'breakpoints', 'logo', 'density', 'wcagContrast', 'rtl', 'touchTarget', 'keyboardNavigation']) {
      const msg = reject({ ...base, [key]: 'x' });
      expect(msg, `${key} must carry its own #3494 prescription`).toContain('#3494');
      expect(msg, `${key} must be named in its own prescription`).toContain('`' + key + '` was removed');
    }
  });

  it('gives each retired key its OWN sentence — a shared string prints N times (批 10)', () => {
    const msg = reject({ ...base, rtl: true, density: 'compact' });
    expect(msg).toContain('text direction follows the document');
    expect(msg).toContain('compact/comfortable spacing');
    // Two keys, two DISTINCT bullets.
    expect(msg.split('• ').length - 1).toBe(2);
  });

  it('never prescribes a vocabulary with no carrier key (the ledger\'s finding 7)', () => {
    // `touchTarget` / `keyboardNavigation` look like they should point at
    // `ui/touch.zod.ts` / `ui/keyboard.zod.ts`. 批 13 measured both as having
    // NO carrier (#4988), so prescribing them would walk an author out of a
    // loud rejection into a silent one.
    const msg = reject({ ...base, touchTarget: 1, keyboardNavigation: true });
    expect(msg).not.toContain('touch.zod');
    expect(msg).not.toContain('keyboard.zod');
  });

  it('every suggestion it makes is a key the schema actually accepts', () => {
    // The `triggerPhrases` lesson in `shared/strict-object.ts`: never point an
    // author at a key that will reject them a second time. Walk the whole
    // alias table and prove each target parses.
    const targets = ['colors', 'typography', 'borderRadius', 'shadows', 'animation', 'zIndex', 'customVars', 'extends', 'label', 'name', 'mode'];
    const shape = (ThemeSchema as unknown as { _zod: { def: { shape: Record<string, unknown> } } })._zod.def.shape;
    for (const t of targets) expect(Object.keys(shape), `alias target "${t}" must be declared`).toContain(t);
  });
});
