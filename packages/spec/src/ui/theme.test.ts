import { describe, it, expect } from 'vitest';
import {
  ThemeSchema,
  ThemeMode,
  ThemeModeSchema,
  ColorPaletteSchema,
  TypographySchema,
  BorderRadiusSchema,
  ShadowSchema,
  type Theme,
  type ColorPalette,
} from './theme.zod';

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
