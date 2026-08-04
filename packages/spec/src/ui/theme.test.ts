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

  // REPLACED at #5021 (fixture triage, disposition 3). The fixture that used to
  // sit here authored all four retired scales plus `fontFamily.heading`/`.mono`
  // and asserted `not.toThrow()` — i.e. it pinned exactly the limbs the
  // retirement deletes. Re-spelling it was not an option (there is no canonical
  // spelling to move to) and keeping it would have made the whole surviving
  // block untested, so it is replaced by a fixture the narrowed schema really
  // reads. The rejection side is pinned in the #5021 block at the bottom.
  it('accepts the whole SURVIVING typography surface — which is `fontFamily.base`', () => {
    const typography = { fontFamily: { base: 'Inter, system-ui, sans-serif' } };

    const parsed = TypographySchema.parse(typography);
    expect(parsed.fontFamily?.base).toBe('Inter, system-ui, sans-serif');
    // Nothing else is left to WRITE: `base` emits `--font-sans`, the one
    // typography variable objectui actually reads. (The four retired scales are
    // still in the shape as tombstones, but they accept nothing, so they never
    // appear on a parsed value.)
    expect(Object.keys(parsed)).toEqual(['fontFamily']);
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
      // #5021 fixture triage, disposition 1 (re-spell): this fixture merely
      // USED `fontFamily.heading`/`.mono` and a `fontSize` scale, so it drops
      // them and keeps the live `base`. It is still a "complete" theme — the
      // completeness that matters is the set of blocks with live consumers.
      typography: {
        fontFamily: {
          base: 'Inter, sans-serif',
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

  // The `zIndex` and `animation` acceptance fixtures that sat here were
  // REPLACED at #5021 (fixture triage, disposition 3) — they pinned the two
  // keys the retirement deletes, and an `expect(…).not.toThrow()` on a deleted
  // key has no honest re-spelling. Their replacements are the layering and
  // motion fixtures below, which express the SAME intent through the door that
  // survived, plus the rejection pins in the #5021 block at the bottom.

  it('a layering scale is still expressible — through `customVars`, the live door', () => {
    const theme: Theme = {
      name: 'layered_theme',
      label: 'Layered Theme',
      colors: { primary: '#007BFF' },
      // The variable names are spelled out because that is what the engine used
      // to derive from the `zIndex` key names. Byte for byte the same custom
      // properties reach the document — which is the whole basis on which the
      // retirement claims to remove no capability.
      customVars: {
        'z-base': '0',
        'z-dropdown': '1000',
        'z-sticky': '1020',
        'z-fixed': '1030',
        'z-modal-backdrop': '1040',
        'z-modal': '1050',
        'z-popover': '1060',
        'z-tooltip': '1070',
      },
    };

    const parsed = ThemeSchema.parse(theme);
    expect(parsed.customVars?.['z-modal']).toBe('1050');
  });

  it('a motion scale is still expressible — same door, same variables', () => {
    const theme: Theme = {
      name: 'animated_theme',
      label: 'Animated Theme',
      colors: { primary: '#007BFF' },
      customVars: {
        'duration-fast': '150ms',
        'duration-base': '300ms',
        'duration-slow': '500ms',
        'timing-ease': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'timing-ease_in': 'cubic-bezier(0.4, 0, 1, 1)',
      },
    };

    const parsed = ThemeSchema.parse(theme);
    expect(parsed.customVars?.['duration-fast']).toBe('150ms');
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
      // #5021 fixture triage, disposition 1 (re-spell): `heading` dropped, the
      // live `base` kept.
      typography: {
        fontFamily: {
          base: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
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
//
// RETIRED at #5021. `AnimationSchema` no longer exists, so the snake_case-vs-
// camelCase question this block settled is moot at the schema — there is no
// declared easing vocabulary left to be inconsistent about. The old fixture
// (fixture triage, disposition 3) pinned `animation.timing` directly.
//
// Kept as a pin rather than deleted, because the useful half of #6's finding
// SURVIVES the retirement and would otherwise go untested: an author who wants
// snake_case easing variables can still emit them, and now spells the variable
// name in full instead of relying on the engine's key-to-variable derivation —
// which is the one thing that actually changed for them.
// ============================================================================
describe('easing tokens after the #5021 retirement', () => {
  it('the snake_case easing vocabulary is still emittable through `customVars`', () => {
    const theme = ThemeSchema.parse({
      name: 'snake_case_timing',
      label: 'Snake Case Timing',
      colors: { primary: '#000' },
      customVars: {
        'timing-linear': 'linear',
        'timing-ease': 'ease',
        'timing-ease_in': 'ease-in',
        'timing-ease_out': 'ease-out',
        'timing-ease_in_out': 'ease-in-out',
      },
    });
    expect(theme.customVars?.['timing-ease_in']).toBe('ease-in');
    expect(theme.customVars?.['timing-ease_in_out']).toBe('ease-in-out');
  });

  it('`animation` itself is gone — the key no longer exists on the parsed theme', () => {
    const theme = ThemeSchema.parse({
      name: 'no_animation',
      label: 'No Animation',
      colors: { primary: '#000' },
    });
    expect(theme).not.toHaveProperty('animation');
    expect(theme).not.toHaveProperty('zIndex');
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

  // #5021 shrank this list from fourteen sites to six. The `animation`,
  // `zIndex`, `typography.fontSize`/`.fontWeight`/`.lineHeight`/
  // `.letterSpacing` and `animation.duration`/`.timing` rows were not
  // re-spelled — those schemas no longer exist, so an unknown-key probe against
  // them has nothing to probe. What replaced them is the retirement pin at the
  // bottom of this file: writing the BLOCK is now the rejection, which is
  // strictly stronger than rejecting one bad key inside it.
  it.each([
    ['typography', { notATypographyKey: 1 }],
    ['borderRadius', { notARadius: '1px' }],
    ['shadows', { notAShadow: 'x' }],
  ])('rejects an undeclared key in `%s`', (block, value) => {
    expect(reject({ ...base, [block]: value })).toContain(Object.keys(value)[0]);
  });

  it('rejects an undeclared key in the nested `typography.fontFamily` block', () => {
    expect(reject({ ...base, typography: { fontFamily: { notAFamily: 'x' } } })).toContain('notAFamily');
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

  // The `md` → `base` (font-size), `base` → `normal` (font-weight) and
  // `easeIn` → `ease_in` (animation timing) curation tests lived here until
  // #5021. All three graded aliases INSIDE a retired scale, so they went with
  // their schemas rather than being re-spelled — there is no surviving surface
  // on which `md` or `easeIn` means anything. This is the honest reading of the
  // fixture-triage rule: a fixture whose subject was deleted is replaced by one
  // the surviving rule reads, not kept alive on a technicality.

  it('renames onto the camelCase targets the distance fallback is weak on (#4990)', () => {
    // `findClosestMatches` lowercases the input but not the candidates, so a
    // capital costs an edit. These land through the explicit table instead.
    //
    // The `backdrop` → `modalBackdrop` case that used to anchor this test was
    // on `zIndex` and retired with it (#5021); `radius` and `cssVars` carry the
    // same property on surfaces that are still live.
    expect(reject({ ...base, radius: {} })).toContain('`radius` → `borderRadius`');
    expect(reject({ ...base, cssVars: {} })).toContain('`cssVars` → `customVars`');
    expect(reject({ ...base, customProperties: {} })).toContain('`customProperties` → `customVars`');
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
    //
    // `animation` and `zIndex` left this list at #5021 — WITH the five aliases
    // that pointed at them (`animations`/`motion`/`transitions`/`layers`/
    // `stacking`). That pairing is the point of the test, not bookkeeping: had
    // the aliases stayed, this assertion would be the thing that caught it.
    const targets = ['colors', 'typography', 'borderRadius', 'shadows', 'customVars', 'extends', 'label', 'name', 'mode'];
    const shape = (ThemeSchema as unknown as { _zod: { def: { shape: Record<string, unknown> } } })._zod.def.shape;
    for (const t of targets) expect(Object.keys(shape), `alias target "${t}" must be declared`).toContain(t);
  });
});

// ============================================================================
// #5021 — the nine emitted-but-unread token groups, RETIRED (ADR-0049 D2)
//
// The measurement (objectui `main`, re-confirmed 2026-08-04): `--font-size-*`,
// `--font-weight-*`, `--line-height-*`, `--letter-spacing-*`, `--duration-*`,
// `--timing-*`, `--z-*`, `--font-heading` and `--font-mono` have ZERO consumers
// across objectui's `packages/**`, while `--font-sans`, `--radius*`,
// `--shadow*` and the colour variables are read — the positive controls that
// make the zero mean something.
//
// Route: STRICT REMOVAL + guidance map, not a `retiredKey()` tombstone. Both
// channels are still covered and it is worth being explicit about which does
// what, because the two routes' evidence looks different:
//   * `tsc` — the key is gone from the inferred input type, so authoring one
//     fails to compile. (A `retiredKey()` would type it `never`; deleting it
//     from a `.strict()` shape is the same outcome by a different mechanism.)
//   * the parse — `strictObject`'s `guidance` map carries the prescription, so
//     the rejection is the upgrade instruction rather than a bare
//     "unrecognized key". That is what these tests pin.
// ============================================================================
describe('#5021 — retired theme token scales', () => {
  const base = { name: 'demo_theme', label: 'Demo', colors: { primary: '#000' } };
  const reject = (input: unknown): string => {
    const r = ThemeSchema.safeParse(input);
    expect(r.success, 'fixture must be REJECTED — a passing parse means the key is still live').toBe(false);
    return r.error!.issues.map((i) => i.message).join('\n');
  };

  // ---- 1. the control: this suite fails closed ------------------------
  it('the surviving theme parses — these tests reject specific keys, not everything', () => {
    expect(ThemeSchema.safeParse({
      ...base,
      typography: { fontFamily: { base: 'Inter' } },
      borderRadius: { base: '0.25rem' },
      shadows: { base: '0 1px 2px rgba(0,0,0,.1)' },
      customVars: { 'z-modal': '1050' },
    }).success).toBe(true);
  });

  // ---- 2. every retired key rejects, at its own path -------------------
  it('rejects `animation` and `zIndex` at the theme top level', () => {
    expect(reject({ ...base, animation: { duration: { fast: '150ms' } } })).toContain('`theme.animation` was removed');
    expect(reject({ ...base, zIndex: { modal: 1050 } })).toContain('`theme.zIndex` was removed');
  });

  it.each(['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'])(
    'rejects the retired `typography.%s` scale',
    (key) => {
      const msg = reject({ ...base, typography: { [key]: {} } });
      expect(msg).toContain('`theme.typography.' + key + '` was removed');
    },
  );

  it.each(['heading', 'mono'])('rejects the retired `typography.fontFamily.%s`', (key) => {
    const msg = reject({ ...base, typography: { fontFamily: { base: 'Inter', [key]: 'Georgia' } } });
    expect(msg).toContain('`theme.typography.fontFamily.' + key + '` was removed');
  });

  // ---- 3. the prescription is the payload -----------------------------
  it('every prescription names `customVars`, the door measured to have real consumers', () => {
    for (const [input, key] of [
      [{ ...base, animation: {} }, 'animation'],
      [{ ...base, zIndex: {} }, 'zIndex'],
      [{ ...base, typography: { fontSize: {} } }, 'typography.fontSize'],
      [{ ...base, typography: { fontWeight: {} } }, 'typography.fontWeight'],
      [{ ...base, typography: { lineHeight: {} } }, 'typography.lineHeight'],
      [{ ...base, typography: { letterSpacing: {} } }, 'typography.letterSpacing'],
      [{ ...base, typography: { fontFamily: { heading: 'x' } } }, 'typography.fontFamily.heading'],
      [{ ...base, typography: { fontFamily: { mono: 'x' } } }, 'typography.fontFamily.mono'],
    ] as const) {
      const msg = reject(input);
      expect(msg, `${key} must prescribe customVars`).toContain('customVars');
      expect(msg, `${key} must name the migration command`).toContain('os migrate meta --from 16');
      expect(msg, `${key} must cite the issue`).toContain('#5021');
    }
  });

  it('gives each retired key its OWN sentence — a shared string prints N times (批 10)', () => {
    const r = ThemeSchema.safeParse({ ...base, animation: {}, zIndex: {} });
    expect(r.success).toBe(false);
    const msg = r.error!.issues.map((i) => i.message).join('\n');
    expect(msg).toContain('every transition ran at the renderer default');
    expect(msg).toContain('still stacked by document order');
    // Two keys, two DISTINCT issues. Note the shape difference from the #4001
    // block above: a `guidance` prescription arrives as ONE unrecognized-key
    // issue carrying N bullets, whereas a `retiredKey()` raises its own issue
    // per key — so this counts issues, not bullets.
    expect(r.error!.issues).toHaveLength(2);
  });

  // ---- 4. finding 7: no suggestion may point at a retired key ----------
  it('the five aliases that pointed at `animation`/`zIndex` are GONE, not re-pointed', () => {
    // Had `layers: 'zIndex'` survived, an author writing `layers` would be told
    // "did you mean `zIndex`?" and then rejected for writing `zIndex` — walked
    // out of one rejection into a second. The ledger's finding 7, which this
    // file's own header has now signposted three times.
    for (const alias of ['animations', 'motion', 'transitions', 'layers', 'stacking']) {
      const msg = reject({ ...base, [alias]: {} });
      expect(msg, `${alias} must not be renamed onto a retired key`).not.toContain('→ `animation`');
      expect(msg, `${alias} must not be renamed onto a retired key`).not.toContain('→ `zIndex`');
    }
  });

  it('the typography aliases that pointed at retired scales are GONE too', () => {
    for (const alias of ['sizes', 'size', 'weights', 'weight', 'tracking', 'leading']) {
      const msg = reject({ ...base, typography: { [alias]: {} } });
      for (const dead of ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']) {
        expect(msg, `${alias} must not be renamed onto retired \`${dead}\``).not.toContain('→ `' + dead + '`');
      }
    }
    for (const alias of ['headings', 'display', 'monospace', 'code']) {
      const msg = reject({ ...base, typography: { fontFamily: { base: 'Inter', [alias]: 'x' } } });
      expect(msg, `${alias} must not be renamed onto retired \`heading\``).not.toContain('→ `heading`');
      expect(msg, `${alias} must not be renamed onto retired \`mono\``).not.toContain('→ `mono`');
    }
  });

  it('the retired keys are DECLARED-but-unwritable, not deleted — the tombstone route', () => {
    // The distinction that decides how `authorable-surface.json` moves: a
    // tombstoned key STAYS in the walked shape (gaining a `[RETIRED]` marker
    // in the baseline) rather than vanishing from it. Assert the mechanism
    // directly, so a future "tidy-up" that deletes these keys outright fails
    // here rather than in `gen:schema`'s #4650 deletion check.
    const shapeOf = (s: unknown) =>
      (s as { _zod: { def: { shape: Record<string, unknown> } } })._zod.def.shape;

    const themeShape = shapeOf(ThemeSchema);
    const typoShape = shapeOf(TypographySchema);
    expect(Object.keys(themeShape)).toContain('animation');
    expect(Object.keys(themeShape)).toContain('zIndex');
    expect(Object.keys(typoShape)).toEqual(
      expect.arrayContaining(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']),
    );

    // …and every one of them accepts NOTHING, which is what makes it a
    // tombstone rather than a live key.
    for (const [shape, keys] of [
      [themeShape, ['animation', 'zIndex']],
      [typoShape, ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']],
    ] as const) {
      for (const k of keys) {
        const inner = (shape[k] as { _zod: { def: { innerType?: { _zod: { def: { type: string } } } } } })
          ._zod.def.innerType;
        expect(inner?._zod.def.type, `${k} must be a never-typed tombstone`).toBe('never');
      }
    }
  });

  // ---- 5. the capability survives -------------------------------------
  it('`customVars` reproduces every retired variable by name — capability is not lost', () => {
    // This is the claim the whole retirement rests on, so it is pinned rather
    // than asserted in prose: the engine emits `customVars` as `--<key>:
    // <value>` verbatim, so each retired variable has an exact spelling here.
    const parsed = ThemeSchema.parse({
      ...base,
      customVars: {
        'font-size-lg': '1.125rem',
        'font-weight-bold': '700',
        'line-height-relaxed': '1.75',
        'letter-spacing-wide': '0.025em',
        'duration-fast': '150ms',
        'timing-ease_in': 'cubic-bezier(0.4, 0, 1, 1)',
        'z-modal': '1050',
        'font-heading': 'Georgia, serif',
        'font-mono': 'ui-monospace, monospace',
      },
    });
    // One entry per retired GROUP — all nine the issue measured.
    expect(Object.keys(parsed.customVars ?? {})).toHaveLength(9);
  });

  // ---- 6. the live blocks are untouched -------------------------------
  it('the blocks with live consumers still parse — the retirement is scoped, not a sweep', () => {
    const parsed = ThemeSchema.parse({
      ...base,
      colors: { primary: '#7C3AED', surface: '#F8F9FA', text: '#1F2937' },
      typography: { fontFamily: { base: 'Inter, sans-serif' } },
      borderRadius: { none: '0', base: '0.25rem', full: '9999px' },
      shadows: { base: '0 1px 3px rgba(0,0,0,.1)', inner: 'inset 0 2px 4px rgba(0,0,0,.06)' },
    });
    expect(parsed.colors.surface).toBe('#F8F9FA');
    expect(parsed.typography?.fontFamily?.base).toBe('Inter, sans-serif');
    expect(parsed.borderRadius?.full).toBe('9999px');
    expect(parsed.shadows?.inner).toBe('inset 0 2px 4px rgba(0,0,0,.06)');
  });

  // ---- 7. the authoring DOORS carry the rejection ----------------------
  it('both authoring doors reject a retired key — `defineTheme` and `defineStack`', () => {
    expect(() => defineTheme({ ...base, zIndex: { modal: 1 } } as never)).toThrow(/`theme\.zIndex` was removed/s);

    const stack = ObjectStackSchema.safeParse({
      name: 'demo', label: 'Demo',
      themes: [{ ...base, typography: { fontSize: { base: '1rem' } } }],
    });
    expect(stack.success).toBe(false);
    expect(stack.error!.issues.map((i) => i.message).join('\n'))
      .toContain('`theme.typography.fontSize` was removed');
  });
});
