import { describe, it, expect } from 'vitest';
import {
  FocusTrapConfigSchema,
  KeyboardShortcutSchema,
  FocusManagementSchema,
  KeyboardNavigationConfigSchema,
  type FocusTrapConfig,
  type KeyboardShortcut,
  type FocusManagement,
  type KeyboardNavigationConfig,
} from './keyboard.zod';

describe('FocusTrapConfigSchema', () => {
  it('should apply defaults for empty config', () => {
    const result = FocusTrapConfigSchema.parse({});
    expect(result.enabled).toBe(false);
    expect(result.returnFocus).toBe(true);
    expect(result.escapeDeactivates).toBe(true);
  });

  it('should accept enabled with initialFocus selector', () => {
    const config: FocusTrapConfig = {
      enabled: true,
      initialFocus: '#first-input',
      returnFocus: false,
      escapeDeactivates: false,
    };
    const result = FocusTrapConfigSchema.parse(config);
    expect(result.enabled).toBe(true);
    expect(result.initialFocus).toBe('#first-input');
    expect(result.returnFocus).toBe(false);
  });

  it('should leave initialFocus undefined when not provided', () => {
    const result = FocusTrapConfigSchema.parse({});
    expect(result.initialFocus).toBeUndefined();
  });
});

describe('KeyboardShortcutSchema', () => {
  it('should accept a valid shortcut', () => {
    const shortcut: KeyboardShortcut = {
      key: 'Ctrl+S',
      action: 'save',
      description: 'Save the current form',
      scope: 'form',
    };
    const result = KeyboardShortcutSchema.parse(shortcut);
    expect(result.key).toBe('Ctrl+S');
    expect(result.action).toBe('save');
    expect(result.scope).toBe('form');
  });

  it('should default scope to global', () => {
    const result = KeyboardShortcutSchema.parse({ key: 'Escape', action: 'close' });
    expect(result.scope).toBe('global');
  });

  it('should accept all valid scopes', () => {
    const scopes = ['global', 'view', 'form', 'modal', 'list'] as const;
    scopes.forEach(scope => {
      expect(() => KeyboardShortcutSchema.parse({ key: 'a', action: 'test', scope })).not.toThrow();
    });
  });

  it('should reject invalid scope', () => {
    expect(() => KeyboardShortcutSchema.parse({ key: 'a', action: 'test', scope: 'page' })).toThrow();
  });

  it('should reject missing key or action', () => {
    expect(() => KeyboardShortcutSchema.parse({ action: 'save' })).toThrow();
    expect(() => KeyboardShortcutSchema.parse({ key: 'Ctrl+S' })).toThrow();
  });
});

describe('FocusManagementSchema', () => {
  it('should apply defaults for empty config', () => {
    const result = FocusManagementSchema.parse({});
    expect(result.tabOrder).toBe('auto');
    expect(result.skipLinks).toBe(false);
    expect(result.focusVisible).toBe(true);
    expect(result.arrowNavigation).toBe(false);
  });

  it('should accept manual tab order with skipLinks', () => {
    const config: FocusManagement = {
      tabOrder: 'manual',
      skipLinks: true,
      focusVisible: true,
    };
    const result = FocusManagementSchema.parse(config);
    expect(result.tabOrder).toBe('manual');
    expect(result.skipLinks).toBe(true);
  });

  it('should accept nested focusTrap', () => {
    const result = FocusManagementSchema.parse({
      focusTrap: { enabled: true, initialFocus: '.modal-body' },
    });
    expect(result.focusTrap?.enabled).toBe(true);
    expect(result.focusTrap?.initialFocus).toBe('.modal-body');
  });

  it('should reject invalid tabOrder', () => {
    expect(() => FocusManagementSchema.parse({ tabOrder: 'random' })).toThrow();
  });
});

describe('KeyboardNavigationConfigSchema', () => {
  it('should accept empty config', () => {
    expect(() => KeyboardNavigationConfigSchema.parse({})).not.toThrow();
  });

  it('should default rovingTabindex to false', () => {
    const result = KeyboardNavigationConfigSchema.parse({});
    expect(result.rovingTabindex).toBe(false);
  });

  it('should accept full config with shortcuts and focus management', () => {
    const config: KeyboardNavigationConfig = {
      shortcuts: [
        { key: 'Ctrl+S', action: 'save', scope: 'form' },
        { key: 'Ctrl+Z', action: 'undo', scope: 'global' },
      ],
      focusManagement: {
        tabOrder: 'manual',
        skipLinks: true,
        focusVisible: true,
        focusTrap: { enabled: true, returnFocus: true, escapeDeactivates: true },
        arrowNavigation: true,
      },
      rovingTabindex: true,
    };
    const result = KeyboardNavigationConfigSchema.parse(config);
    expect(result.shortcuts).toHaveLength(2);
    expect(result.focusManagement?.arrowNavigation).toBe(true);
    expect(result.rovingTabindex).toBe(true);
  });
});

describe('Type exports', () => {
  it('should have valid type exports', () => {
    const trap: FocusTrapConfig = { enabled: false, returnFocus: true, escapeDeactivates: true };
    const shortcut: KeyboardShortcut = { key: 'Ctrl+N', action: 'new', scope: 'global' };
    const focus: FocusManagement = { tabOrder: 'auto', skipLinks: false, focusVisible: true, arrowNavigation: false };
    const nav: KeyboardNavigationConfig = { rovingTabindex: false };
    expect(trap).toBeDefined();
    expect(shortcut).toBeDefined();
    expect(focus).toBeDefined();
    expect(nav).toBeDefined();
  });
});

describe('I18n and ARIA integration', () => {
  it('should reject I18n description on KeyboardShortcutSchema', () => {
    expect(() => KeyboardShortcutSchema.parse({
      key: 'Ctrl+S',
      action: 'save',
      description: { key: 'shortcuts.save', defaultValue: 'Save the current document' },
    })).toThrow();
  });

  it('should accept plain string description on KeyboardShortcutSchema', () => {
    const result = KeyboardShortcutSchema.parse({
      key: 'Ctrl+Z',
      action: 'undo',
      description: 'Undo last action',
    });
    expect(result.description).toBe('Undo last action');
  });

  it('should accept ARIA props on KeyboardNavigationConfigSchema', () => {
    const result = KeyboardNavigationConfigSchema.parse({
      ariaLabel: 'Keyboard navigation region',
      ariaDescribedBy: 'nav-help',
      role: 'navigation',
    });
    expect(result.ariaLabel).toBe('Keyboard navigation region');
    expect(result.ariaDescribedBy).toBe('nav-help');
    expect(result.role).toBe('navigation');
  });

  it('should leave I18n/ARIA fields undefined when not provided', () => {
    const shortcut = KeyboardShortcutSchema.parse({ key: 'Escape', action: 'close' });
    expect(shortcut.description).toBeUndefined();
    const nav = KeyboardNavigationConfigSchema.parse({});
    expect(nav.ariaLabel).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #4001 batch 13 -- THIS FILE IS DELIBERATELY NOT `.strict()`, on a measurement.
//
// The strictness ledger scheduled these 4 sites as `authorable (p)`. Resolving
// the `(p)` found no authoring door at all: nothing under `packages/spec/src`
// imports this module except the `ui/index.ts` barrel, a BFS from all 24
// metadata-type roots plus `defineStack`'s `ObjectStackSchema` never reaches
// these schemas (`PageSchema` / `WebhookSchema` / `StateMachineSchema` pass as
// positive controls in the same run), and no `.parse()` on any of them exists
// in `objectstack`, `objectui` or the example apps outside this test file.
// `.strict()` is a property of a PARSE, and there is no parse to gate.
//
// So the strip pinned below is not an unfinished row -- it is the recorded
// verdict. The open question is ADR-0049 enforce-or-remove, filed as #4988.
// These assertions exist so the next sweep stops and reads instead of reaching
// for `strictObject` and shipping a precisely-validated dead slot (#4583). The
// header comment in `keyboard.zod.ts` and this file's ledger row carry the same verdict.
// ---------------------------------------------------------------------------
describe('unknown-key posture is an open question, not an omission (#4001 batch 13 -> #4988)', () => {
  it('FocusTrapConfigSchema still strips rather than rejecting -- deliberate, pending #4988', () => {
    const parsed = FocusTrapConfigSchema.parse({ aKeyThisShapeDoesNotDeclare: 1 }) as Record<string, unknown>;
    expect(parsed.aKeyThisShapeDoesNotDeclare).toBeUndefined();
  });

  it('KeyboardShortcutSchema still strips rather than rejecting -- deliberate, pending #4988', () => {
    const parsed = KeyboardShortcutSchema.parse({ key: 'Ctrl+S', action: 'save', aKeyThisShapeDoesNotDeclare: 1 }) as Record<string, unknown>;
    expect(parsed.aKeyThisShapeDoesNotDeclare).toBeUndefined();
  });

  it('FocusManagementSchema still strips rather than rejecting -- deliberate, pending #4988', () => {
    const parsed = FocusManagementSchema.parse({ aKeyThisShapeDoesNotDeclare: 1 }) as Record<string, unknown>;
    expect(parsed.aKeyThisShapeDoesNotDeclare).toBeUndefined();
  });

  it('KeyboardNavigationConfigSchema still strips rather than rejecting -- deliberate, pending #4988', () => {
    const parsed = KeyboardNavigationConfigSchema.parse({ aKeyThisShapeDoesNotDeclare: 1 }) as Record<string, unknown>;
    expect(parsed.aKeyThisShapeDoesNotDeclare).toBeUndefined();
  });

  // The standing half of measurement 1, so the verdict cannot go stale in
  // silence: the day someone gives this vocabulary a carrier they will add an
  // import, and this is where they are told to revisit #4988 and the ledger.
  it('is still imported by nothing but the ui/ barrel', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
          && full !== path.join(root, 'ui', 'keyboard.zod.ts')) {
          if (/(?:import|export)[^;]*['"][^'"]*\/keyboard\.zod['"]/.test(fs.readFileSync(full, 'utf-8'))) {
            importers.push(path.relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(importers, 'a new importer means this vocabulary got a carrier -- re-read #4988')
      .toEqual(['ui/index.ts']);
  });
});
