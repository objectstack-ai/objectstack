/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * P2.3/P2.4 Spec Protocol Type Re-export Tests
 *
 * Verifies that P2.3 (Sharing & Embedding) and P2.4 (View Configuration)
 * Zod schemas from @objectstack/spec/ui are properly re-exported and functional.
 *
 * The types index re-exports these as `export type { ... }`, so we verify:
 *   1. Type-level re-exports compile correctly (import type from '../index')
 *   2. Runtime Zod schemas from @objectstack/spec/ui validate data correctly
 */
import { describe, it, expect } from 'vitest';
// Minimal fixtures below are parse INPUT, not parsed output: these schemas
// `.default()` several fields, so `{ enabled: true }` is valid input while the
// inferred output type requires them. Spec draws the same distinction itself
// (`ActionInput = z.input<typeof ActionSchema>`). Typing them as the output type
// was wrong, and went unnoticed because nothing type-checked this file
// (objectstack#4074).
import type { z } from 'zod';
// The `…Schema` names are deliberately NOT part of this package's surface:
// #2561 decision (a) dropped the spec/ui zod-validator re-exports, and
// `spec-ui-schema-reexports.test.ts` asserts their absence. This file went on
// importing eight of them as types for the whole interval, which no `tsc` run
// ever read (objectstack#4074) — a type-only import of a nonexistent name erases
// at runtime, so the suite stayed green while contradicting its own sibling
// guard. Only the value types are re-exported, so only they are imported here;
// the runtime validators come from `@objectstack/spec/ui` below, as #2561
// prescribes.
import type {
  SharingConfig,
  AddRecordConfig,
  AppearanceConfig,
  UserActionsConfig,
  ViewTab,
  ViewFilterRule,
} from '../index';

/**
 * The type-level half of this file's contract (point 1 of the header): the
 * non-`…Schema` value types ARE part of this package's surface — #2561 dropped
 * only the zod validators — so importing them must keep compiling. Asserted here
 * rather than left implicit in fixture annotations, because most fixtures are
 * now typed as parse INPUT and stopped referencing these names.
 */
type _ReexportedValueTypes = [
  SharingConfig,
  AddRecordConfig,
  AppearanceConfig,
  UserActionsConfig,
  ViewTab,
  ViewFilterRule,
];
void 0 as unknown as _ReexportedValueTypes;

// Runtime Zod schemas are imported directly from the spec package
import {
  SharingConfigSchema as SharingConfigZod,
  AddRecordConfigSchema as AddRecordConfigZod,
  AppearanceConfigSchema as AppearanceConfigZod,
  UserActionsConfigSchema as UserActionsConfigZod,
  ViewTabSchema as ViewTabZod,
  ViewFilterRuleSchema as ViewFilterRuleZod,
} from '@objectstack/spec/ui';
// `ThemeModeSchema` no longer imported: objectstack#10485 (PR objectstack#10695)
// retired the spec's whole `ui/theme.zod.ts` module, and the objectstack#10856
// ruling had objectui drop its dangling imports (objectui#5710) — its
// spec-liveness `describe` block left with it.

// ============================================================================
// P2.3 Sharing & Embedding
// ============================================================================
describe('P2.3 Spec Protocol Type Re-exports — Sharing & Embedding', () => {
  describe('SharingConfigSchema', () => {
    it('should be a valid Zod schema with parse method', () => {
      expect(SharingConfigZod).toBeDefined();
      expect(typeof SharingConfigZod.parse).toBe('function');
      expect(typeof SharingConfigZod.safeParse).toBe('function');
    });

    it('should validate a minimal SharingConfig', () => {
      const config: z.input<typeof SharingConfigZod> = { enabled: true };
      const result = SharingConfigZod.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should validate a full SharingConfig', () => {
      const config: SharingConfig = {
        enabled: true,
        publicLink: 'https://example.com/shared/abc123',
        password: 'secret',
        allowedDomains: ['example.com'],
        expiresAt: '2025-12-31',
        allowAnonymous: false,
      };
      const result = SharingConfigZod.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  // `EmbedConfigSchema` block REMOVED: `EmbedConfig` / `EmbedConfigSchema` were
  // retired in @objectstack/spec 17.0.0-rc.3 (objectstack#5015, PR
  // objectstack#5300) — published `ui` vocabulary with NO AUTHORING DOOR, and
  // no iframe route ever read an embed config, so nothing ran to regress.
  // objectui#3362 pre-declared this file as one of the three that would go red
  // on the dependency refresh that brought the retirement in.
  //
  // The SURVIVOR half above is the load-bearing one and is deliberately kept:
  // `SharingConfigSchema` must still be exported and must still parse, because
  // a retirement that deleted the whole `ui/sharing` module would satisfy the
  // absence half of this contract while destroying working surface. Public form
  // sharing is unaffected — `FormView.sharing` still gates the anonymous
  // endpoints on `allowAnonymous` + `publicLink`.
});

// ============================================================================
// P2.4 View Configuration
// ============================================================================
describe('P2.4 Spec Protocol Type Re-exports — View Configuration', () => {
  describe('AddRecordConfigSchema', () => {
    it('should be a valid Zod schema with parse method', () => {
      expect(AddRecordConfigZod).toBeDefined();
      expect(typeof AddRecordConfigZod.parse).toBe('function');
      expect(typeof AddRecordConfigZod.safeParse).toBe('function');
    });

    it('should validate a minimal AddRecordConfig', () => {
      const config: z.input<typeof AddRecordConfigZod> = { enabled: true };
      const result = AddRecordConfigZod.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should validate an AddRecordConfig with enabled and position', () => {
      const config: AddRecordConfig = {
        enabled: true,
        position: 'top',
      };
      const result = AddRecordConfigZod.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('AppearanceConfigSchema', () => {
    it('should be a valid Zod schema with parse method', () => {
      expect(AppearanceConfigZod).toBeDefined();
      expect(typeof AppearanceConfigZod.parse).toBe('function');
      expect(typeof AppearanceConfigZod.safeParse).toBe('function');
    });

    it('should validate a minimal AppearanceConfig', () => {
      const config: z.input<typeof AppearanceConfigZod> = {};
      const result = AppearanceConfigZod.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should validate a full AppearanceConfig', () => {
      const config: AppearanceConfig = {
        showDescription: true,
        allowedVisualizations: ['grid', 'kanban', 'calendar'],
      };
      const result = AppearanceConfigZod.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('UserActionsConfigSchema', () => {
    it('should be a valid Zod schema with parse method', () => {
      expect(UserActionsConfigZod).toBeDefined();
      expect(typeof UserActionsConfigZod.parse).toBe('function');
      expect(typeof UserActionsConfigZod.safeParse).toBe('function');
    });

    it('should validate a minimal UserActionsConfig', () => {
      const config: z.input<typeof UserActionsConfigZod> = {};
      const result = UserActionsConfigZod.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should validate a full UserActionsConfig', () => {
      const config: z.input<typeof UserActionsConfigZod> = {
        sort: true,
        search: true,
        filter: true,
        rowHeight: true,
      };
      const result = UserActionsConfigZod.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('ViewTabSchema', () => {
    it('should be a valid Zod schema with parse method', () => {
      expect(ViewTabZod).toBeDefined();
      expect(typeof ViewTabZod.parse).toBe('function');
      expect(typeof ViewTabZod.safeParse).toBe('function');
    });

    it('should validate a minimal ViewTab', () => {
      const tab: z.input<typeof ViewTabZod> = { name: 'all', label: 'All Records' };
      const result = ViewTabZod.safeParse(tab);
      expect(result.success).toBe(true);
    });

    it('should validate a full ViewTab', () => {
      // A filter rule's TYPED input `operator` is the canonical
      // `ViewFilterOperator` since objectstack#20503, so a typed author writes
      // `'equals'`; the legacy alias `'eq'` is refused by the compiler. Only the
      // type narrowed: upstream's runtime still folds a stored or plain-JS `'eq'`
      // onto `equals` at parse time, and objectstack pins that in
      // `view-filter-operator-input-typed.test.ts`, not here.
      const tab: z.input<typeof ViewTabZod> = {
        name: 'active',
        label: 'Active',
        icon: 'CheckCircle',
        filter: [{ field: 'status', operator: 'equals', value: 'active' }],
        order: 1,
        pinned: true,
        isDefault: true,
        visible: true,
      };
      const result = ViewTabZod.safeParse(tab);
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================================
// v3.0.10 New Spec Types
// ============================================================================
describe('v3.0.10 Spec Protocol New Types', () => {
  describe('ViewFilterRuleSchema', () => {
    it('should be a valid Zod schema with parse method', () => {
      expect(ViewFilterRuleZod).toBeDefined();
      expect(typeof ViewFilterRuleZod.parse).toBe('function');
      expect(typeof ViewFilterRuleZod.safeParse).toBe('function');
    });

    it('should validate a ViewFilterRule', () => {
      const rule: z.input<typeof ViewFilterRuleZod> = { field: 'status', operator: 'equals', value: 'active' };
      const result = ViewFilterRuleZod.safeParse(rule);
      expect(result.success).toBe(true);
    });
  });

  // `describe('ThemeModeSchema')` DELETED, not rewritten: its whole point was
  // that the spec publishes a live `ThemeModeSchema` validator, and
  // objectstack#10485 (PR objectstack#10695) retired the spec's entire theme
  // module — there is no upstream referent left to assert against
  // (objectui#5710). The mode-only provider that test pointed at retired with
  // the `@object-ui/providers` theme trio (objectui#13453).
});
describe('Type re-exports from @object-ui/types index', () => {
  it('should re-export P2.3 types (compile-time verification)', async () => {
    // Dynamic import to verify exports exist on the module
    const types = await import('../index');

    // These are type-only re-exports, so they won't appear as runtime properties.
    // We verify the module itself is importable and other runtime exports are intact.
    expect(types).toBeDefined();
    expect(typeof types.defineStack).toBe('function');
  });

  it('should allow type annotations with P2.3 Sharing types', () => {
    // Compile-time check: this line would fail to compile if the type were not
    // re-exported. The `EmbedConfigZod` half is gone with objectstack#5015 —
    // see the `EmbedConfigSchema` note above.
    const sharing: z.input<typeof SharingConfigZod> = { enabled: true };
    expect(sharing.enabled).toBe(true);
  });

  it('should allow type annotations with P2.4 View Configuration types', () => {
    const addRecord: z.input<typeof AddRecordConfigZod> = { enabled: true };
    const appearance: AppearanceConfig = { showDescription: true };
    const userActions: z.input<typeof UserActionsConfigZod> = { sort: true };
    const tab: z.input<typeof ViewTabZod> = { name: 'main', label: 'Main' };
    expect(addRecord.enabled).toBe(true);
    expect(appearance.showDescription).toBe(true);
    expect(userActions.sort).toBe(true);
    expect(tab.name).toBe('main');
  });
});
