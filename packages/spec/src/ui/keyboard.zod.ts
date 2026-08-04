// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { lazySchema } from '../shared/lazy-schema';

// ---------------------------------------------------------------------------
// NOT CLOSED AGAINST UNKNOWN KEYS -- AND THAT IS THE MEASURED VERDICT
// (#4001 batch 13 / 批 13, ADR-0078). Read this before "finishing" the file.
//
// The strictness ledger scheduled this file's 4 object sites as `authorable
// (p)` -- provisional. #4001's own rule is verify-before-tightening, and here
// the verification came back NEGATIVE: no metadata document is ever parsed
// against these shapes, because nothing in the protocol carries them.
//
// Three independent measurements, 2026-08-03:
//
//   1. STATIC -- nothing under `packages/spec/src` imports this module except
//      the `ui/index.ts` barrel. No schema anywhere declares a `component.keyboard / app.keyboard`
//      slot, so there is no key an author can write to reach these shapes.
//   2. GRAPH -- a BFS over this build's in-memory Zod graph from all 24
//      metadata-type roots (`listMetadataTypeSchemaTypes`) plus
//      `ObjectStackSchema` (`defineStack`) -- the closure `build-schemas.ts`
//      uses for the #4650 deletion check -- reaches none of them. Its three
//      positive controls resolve `root-graph` in the same run: `PageSchema`,
//      `WebhookSchema` (batch 11's `defineStack({ webhooks })` door) and
//      `StateMachineSchema` (batch 10's `agent.lifecycle` door). So
//      "unreachable" is a fact about the graph, not a broken instrument.
//   3. CALL SITES -- no `.parse()` / `.safeParse()` on any schema here exists
//      in `objectstack`, `objectui` or the example apps, outside this file's
//      own unit test. objectui re-exports the inferred TYPES only and says so
//      (`@object-ui/types`, the #2561 note: the validators are deliberately
//      NOT re-exported).
//
// `.strict()` would therefore gate nothing -- strictness is a property of a
// PARSE, and there is no parse. Adding it would spend a v17 breaking change to
// make this file LOOK finished, and leave behind the artefact the ledger
// itself warns about: "a *precisely validated* dead slot is the more
// convincing lie" (#4583). The real question is ADR-0049 enforce-or-remove --
// retire this vocabulary or give it a carrier -- filed as #4988, with the same
// verdict recorded in this file's ledger row.
//
// DO NOT convert these sites to `strictObject` before #4988 is decided: a
// strict shape reads as load-bearing and makes the retirement harder, which is
// the opposite of what the measurement asks for.
// ---------------------------------------------------------------------------

/**
 * Focus Trap Configuration Schema
 * Constrains keyboard focus within a specific container (e.g., modals, dialogs).
 */
export const FocusTrapConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable focus trapping within this container'),
  initialFocus: z.string().optional().describe('CSS selector for the element to focus on activation'),
  returnFocus: z.boolean().default(true).describe('Return focus to trigger element on deactivation'),
  escapeDeactivates: z.boolean().default(true).describe('Allow Escape key to deactivate the focus trap'),
}).describe('Focus trap configuration for modal-like containers'));

export type FocusTrapConfig = z.infer<typeof FocusTrapConfigSchema>;

/**
 * Keyboard Shortcut Schema
 * Defines a single keyboard shortcut binding.
 */
export const KeyboardShortcutSchema = lazySchema(() => z.object({
  key: z.string().describe('Key combination (e.g., "Ctrl+S", "Alt+N", "Escape")'),
  action: z.string().describe('Action identifier to invoke when shortcut is triggered'),
  description: I18nLabelSchema.optional().describe('Human-readable description of what the shortcut does'),
  scope: z.enum(['global', 'view', 'form', 'modal', 'list']).default('global')
    .describe('Scope in which this shortcut is active'),
}).describe('Keyboard shortcut binding'));

export type KeyboardShortcut = z.infer<typeof KeyboardShortcutSchema>;

/**
 * Focus Management Schema
 * Controls tab order, focus visibility, and navigation behavior.
 */
export const FocusManagementSchema = lazySchema(() => z.object({
  tabOrder: z.enum(['auto', 'manual']).default('auto')
    .describe('Tab order strategy: auto (DOM order) or manual (explicit tabIndex)'),
  skipLinks: z.boolean().default(false).describe('Provide skip-to-content navigation links'),
  focusVisible: z.boolean().default(true).describe('Show visible focus indicators for keyboard users'),
  focusTrap: FocusTrapConfigSchema.optional().describe('Focus trap settings'),
  arrowNavigation: z.boolean().default(false)
    .describe('Enable arrow key navigation between focusable items'),
}).describe('Focus and tab navigation management'));

export type FocusManagement = z.infer<typeof FocusManagementSchema>;

/**
 * Keyboard Navigation Configuration Schema
 * Top-level keyboard navigation and shortcut configuration.
 */
export const KeyboardNavigationConfigSchema = lazySchema(() => z.object({
  shortcuts: z.array(KeyboardShortcutSchema).optional().describe('Registered keyboard shortcuts'),
  focusManagement: FocusManagementSchema.optional().describe('Focus and tab order management'),
  rovingTabindex: z.boolean().default(false)
    .describe('Enable roving tabindex pattern for composite widgets'),
}).merge(AriaPropsSchema.partial())
  // `.strip()` is LOAD-BEARING (#4001 批 16): `AriaPropsSchema` became `strictObject` and
  // `.merge()` adopts the incoming schema's unknown-key posture, so without this the shape
  // would silently become `.strict()` — with zod's generic message, not the campaign's — and
  // would contradict this file's measured `no door` verdict (#4988: nothing parses it, so a
  // strict shell enforces nothing). Keep it until #4988 says what happens to this file.
  .strip()
  .describe('Keyboard navigation and shortcut configuration'));

export type KeyboardNavigationConfig = z.infer<typeof KeyboardNavigationConfigSchema>;
