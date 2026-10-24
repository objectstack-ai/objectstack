/**
 * Tests for ActionBar (action:bar) renderer
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import { renderComponent, validateComponentRegistration } from './test-utils';
import type { ActionBarSchema } from '@object-ui/types';

/**
 * Types each literal below as the `action:bar` node it is rather than as the
 * `BaseSchema` `renderComponent` accepts (objectui#11347): since objectui#8347
 * removed `BaseSchema`'s index signature, a literal checked against
 * `BaseSchema` may author only `BaseSchema`'s own keys.
 */
const actionBar = (schema: ActionBarSchema): ActionBarSchema => schema;

// Ensure action renderers are loaded (side-effect imports via vitest.setup.tsx)

describe('ActionBar (action:bar)', () => {
  describe('registration', () => {
    it('is registered in ComponentRegistry', () => {
      const reg = validateComponentRegistration('action:bar');
      expect(reg.isRegistered).toBe(true);
      expect(reg.hasRenderer).toBe(true);
      expect(reg.hasLabel).toBe(true);
      expect(reg.hasInputs).toBe(true);
      expect(reg.hasDefaultProps).toBe(true);
    });
  });

  describe('rendering', () => {
    it('renders nothing when actions array is empty', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        actions: [],
      }));
      expect(container.innerHTML).toBe('');
    });

    it('renders action buttons for provided actions', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        actions: [
          { name: 'save', label: 'Save', type: 'script', component: 'action:button' },
          { name: 'cancel', label: 'Cancel', type: 'script', component: 'action:button' },
        ],
      }));
      expect(container.textContent).toContain('Save');
      expect(container.textContent).toContain('Cancel');
    });

    it('renders with role="toolbar" and aria-label', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        actions: [
          { name: 'test', label: 'Test', type: 'script' },
        ],
      }));
      const toolbar = container.querySelector('[role="toolbar"]');
      expect(toolbar).toBeTruthy();
      expect(toolbar?.getAttribute('aria-label')).toBe('Actions');
    });

    it('filters actions by location', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        location: 'list_toolbar',
        actions: [
          { name: 'toolbar_action', label: 'Toolbar Action', type: 'script', locations: ['list_toolbar'] },
          { name: 'header_action', label: 'Header Action', type: 'script', locations: ['record_header'] },
          { name: 'both_action', label: 'Both Action', type: 'script', locations: ['list_toolbar', 'record_header'] },
        ],
      }));
      expect(container.textContent).toContain('Toolbar Action');
      expect(container.textContent).not.toContain('Header Action');
      expect(container.textContent).toContain('Both Action');
    });

    // [#3142] Deliberately INVERTED from "shows actions without locations".
    // An undeclared placement is not a wildcard: this bar used to show such an
    // action at every location, while ActionEngine, RecordDetailView,
    // DeclaredActionsBar and the related-list bridge all showed it at none —
    // so the same action appeared or vanished with the renderer. `locations`
    // is the declaration; no declaration, no located placement (ADR-0078 reads
    // an action with no `locations` as inert for exactly this reason).
    it('hides an action that declares no locations when filtering by location', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        location: 'record_header',
        actions: [
          { name: 'no_loc', label: 'No Location', type: 'script' },
          { name: 'empty_loc', label: 'Empty Location', type: 'script', locations: [] },
          { name: 'other_loc', label: 'Other Location', type: 'script', locations: ['list_toolbar'] },
          { name: 'here_loc', label: 'Here Location', type: 'script', locations: ['record_header'] },
        ],
      }));
      expect(container.textContent).not.toContain('No Location');
      // An empty array reads the same as an absent one — the third dialect
      // (`action:group` hid `[]` but showed `undefined`) is gone too.
      expect(container.textContent).not.toContain('Empty Location');
      expect(container.textContent).not.toContain('Other Location');
      expect(container.textContent).toContain('Here Location');
    });

    it('renders all actions when no location filter is set', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        actions: [
          { name: 'a1', label: 'Action 1', type: 'script', locations: ['list_toolbar'] },
          { name: 'a2', label: 'Action 2', type: 'script', locations: ['record_header'] },
        ],
      }));
      expect(container.textContent).toContain('Action 1');
      expect(container.textContent).toContain('Action 2');
    });

    it('deduplicates actions by name', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        actions: [
          { name: 'change_status', label: 'Change Status', type: 'script', component: 'action:button' },
          { name: 'assign_user', label: 'Assign User', type: 'script', component: 'action:button' },
          { name: 'change_status', label: 'Change Status', type: 'script', component: 'action:button' },
        ],
      }));
      const toolbar = container.querySelector('[role="toolbar"]');
      expect(toolbar).toBeTruthy();
      // Should only render 2 actions (duplicates removed)
      expect(toolbar!.children.length).toBe(2);
      expect(container.textContent).toContain('Change Status');
      expect(container.textContent).toContain('Assign User');
    });

    it('deduplicates actions after location filtering', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        location: 'record_header',
        actions: [
          { name: 'change_status', label: 'Change Status', type: 'script', locations: ['record_header'] },
          { name: 'assign_user', label: 'Assign User', type: 'script', locations: ['record_header'] },
          { name: 'change_status', label: 'Change Status', type: 'script', locations: ['record_header', 'record_more'] },
          { name: 'assign_user', label: 'Assign User', type: 'script', locations: ['record_header'] },
        ],
      }));
      const toolbar = container.querySelector('[role="toolbar"]');
      expect(toolbar).toBeTruthy();
      // Should only render 2 unique actions
      expect(toolbar!.children.length).toBe(2);
    });
  });

  describe('overflow', () => {
    it('groups excess actions into overflow menu when maxVisible is exceeded', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        maxVisible: 2,
        actions: [
          { name: 'a1', label: 'Action 1', type: 'script' },
          { name: 'a2', label: 'Action 2', type: 'script' },
          { name: 'a3', label: 'Action 3', type: 'script' },
          { name: 'a4', label: 'Action 4', type: 'script' },
        ],
      }));
      // First 2 should be visible as buttons
      expect(container.textContent).toContain('Action 1');
      expect(container.textContent).toContain('Action 2');
      // Remaining 2 should be in a dropdown (rendered as action:menu trigger)
      const toolbar = container.querySelector('[role="toolbar"]');
      expect(toolbar).toBeTruthy();
      // There should be 3 children: 2 inline buttons + 1 menu trigger
      const children = toolbar!.children;
      expect(children.length).toBe(3);
    });

    it('does not show overflow when actions fit within maxVisible', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        maxVisible: 5,
        actions: [
          { name: 'a1', label: 'Action 1', type: 'script' },
          { name: 'a2', label: 'Action 2', type: 'script' },
        ],
      }));
      const toolbar = container.querySelector('[role="toolbar"]');
      expect(toolbar!.children.length).toBe(2);
    });
  });

  describe('order (#2670)', () => {
    const inlineButtonsSelector =
      ':scope > button:not([aria-haspopup]), :scope > [role="button"]:not([aria-haspopup])';

    it('orders inline actions by `order` (lower = earlier / primary slot)', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        location: 'record_header',
        maxVisible: 5,
        actions: [
          // Registration order puts the app action first; `order` must reorder.
          { name: 'close_deal', label: 'Close', type: 'script', locations: ['record_header'] },
          { name: 'print', label: 'Print', type: 'script', locations: ['record_header'], order: 5 },
          { name: 'approve', label: 'Approve', type: 'script', locations: ['record_header'], order: -10 },
        ],
      }));
      const toolbar = container.querySelector('[role="toolbar"]');
      const inlineText = Array.from(toolbar!.querySelectorAll(inlineButtonsSelector))
        .map(b => b.textContent)
        .join('|');
      // approve (-10) → close_deal (unset = 0) → print (5)
      expect(inlineText.indexOf('Approve')).toBeLessThan(inlineText.indexOf('Close'));
      expect(inlineText.indexOf('Close')).toBeLessThan(inlineText.indexOf('Print'));
    });

    it('promotes a low-`order` action into the primary slot even when registered last', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        location: 'record_header',
        maxVisible: 1,
        actions: [
          { name: 'app_action', label: 'App Action', type: 'script', locations: ['record_header'] },
          { name: 'approve', label: 'Approve', type: 'script', locations: ['record_header'], order: -100 },
        ],
      }));
      const toolbar = container.querySelector('[role="toolbar"]');
      // 1 inline primary button + 1 overflow menu trigger
      expect(toolbar!.children.length).toBe(2);
      const inlineText = Array.from(toolbar!.querySelectorAll(inlineButtonsSelector))
        .map(b => b.textContent)
        .join(' ');
      expect(inlineText).toContain('Approve');
      expect(inlineText).not.toContain('App Action');
    });

    it('is stable — actions without `order` keep their registration order', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        location: 'record_header',
        maxVisible: 5,
        actions: [
          { name: 'a', label: 'Alpha', type: 'script', locations: ['record_header'] },
          { name: 'b', label: 'Bravo', type: 'script', locations: ['record_header'] },
          { name: 'c', label: 'Charlie', type: 'script', locations: ['record_header'] },
        ],
      }));
      const toolbar = container.querySelector('[role="toolbar"]');
      const inlineText = Array.from(toolbar!.querySelectorAll(inlineButtonsSelector))
        .map(b => b.textContent)
        .join('|');
      expect(inlineText.indexOf('Alpha')).toBeLessThan(inlineText.indexOf('Bravo'));
      expect(inlineText.indexOf('Bravo')).toBeLessThan(inlineText.indexOf('Charlie'));
    });

    it('tie-break: a `primary` action wins the primary slot when nobody sets `order`', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        location: 'record_header',
        maxVisible: 1,
        actions: [
          // Registered first, but plain variant — the tie-break must let the
          // `primary` sibling registered after it claim the primary slot.
          { name: 'export', label: 'Export', type: 'script', locations: ['record_header'] },
          { name: 'submit', label: 'Submit', type: 'script', variant: 'primary', locations: ['record_header'] },
        ],
      }));
      const toolbar = container.querySelector('[role="toolbar"]');
      // 1 inline primary button + 1 overflow menu trigger
      expect(toolbar!.children.length).toBe(2);
      const inlineText = Array.from(toolbar!.querySelectorAll(inlineButtonsSelector))
        .map(b => b.textContent)
        .join(' ');
      expect(inlineText).toContain('Submit');
      expect(inlineText).not.toContain('Export');
    });

    it('`order` outranks the `primary` tie-break', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        location: 'record_header',
        maxVisible: 5,
        actions: [
          // `primary` variant but no `order` (= 0); the explicit low-`order`
          // sibling must still sort ahead of it — `order` is the primary key.
          { name: 'submit', label: 'Submit', type: 'script', variant: 'primary', locations: ['record_header'] },
          { name: 'approve', label: 'Approve', type: 'script', order: -100, locations: ['record_header'] },
        ],
      }));
      const toolbar = container.querySelector('[role="toolbar"]');
      const inlineText = Array.from(toolbar!.querySelectorAll(inlineButtonsSelector))
        .map(b => b.textContent)
        .join('|');
      expect(inlineText.indexOf('Approve')).toBeLessThan(inlineText.indexOf('Submit'));
    });
  });

  describe('systemActions', () => {
    it('renders a single overflow menu when only systemActions are provided', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        systemActions: [
          { name: 'sys_duplicate', label: 'Duplicate', type: 'script' },
          { name: 'sys_export', label: 'Export', type: 'script' },
        ],
      }));
      const toolbar = container.querySelector('[role="toolbar"]');
      expect(toolbar).toBeTruthy();
      // 0 inline buttons + 1 overflow menu trigger
      expect(toolbar!.children.length).toBe(1);
    });

    it('merges business overflow and systemActions into ONE overflow menu', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        maxVisible: 2,
        actions: [
          { name: 'biz1', label: 'Biz 1', type: 'script' },
          { name: 'biz2', label: 'Biz 2', type: 'script' },
          { name: 'biz3', label: 'Biz 3', type: 'script' },
          { name: 'biz4', label: 'Biz 4', type: 'script' },
        ],
        systemActions: [
          { name: 'sys_duplicate', label: 'Duplicate', type: 'script' },
          { name: 'sys_delete', label: 'Delete', type: 'script' },
        ],
      }));
      const toolbar = container.querySelector('[role="toolbar"]');
      // 2 inline buttons + exactly 1 overflow menu trigger — never two
      expect(toolbar!.children.length).toBe(3);
      // No business-action overflow was rendered as a separate menu
      const menus = toolbar!.querySelectorAll('[aria-haspopup]');
      expect(menus.length).toBe(1);
    });

    it('systemActions never appear inline regardless of maxVisible', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        maxVisible: 10,
        actions: [
          { name: 'biz1', label: 'Biz 1', type: 'script' },
        ],
        systemActions: [
          { name: 'sys_duplicate', label: 'Duplicate', type: 'script' },
        ],
      }));
      const toolbar = container.querySelector('[role="toolbar"]');
      // 1 inline business button + 1 overflow menu for the system action
      expect(toolbar!.children.length).toBe(2);
      // The system action label is not inline
      const inlineButtons = toolbar!.querySelectorAll(':scope > button:not([aria-haspopup]), :scope > [role="button"]:not([aria-haspopup])');
      const inlineText = Array.from(inlineButtons).map(b => b.textContent).join(' ');
      expect(inlineText).not.toContain('Duplicate');
    });

    it('renders overflow menu when only systemActions exist even with empty actions', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        actions: [],
        systemActions: [
          { name: 'sys_history', label: 'History', type: 'script' },
        ],
      }));
      const toolbar = container.querySelector('[role="toolbar"]');
      expect(toolbar).toBeTruthy();
      expect(toolbar!.children.length).toBe(1);
    });
  });

  describe('styling', () => {
    it('applies custom className', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        className: 'my-custom-bar',
        actions: [
          { name: 'test', label: 'Test', type: 'script' },
        ],
      }));
      const toolbar = container.querySelector('[role="toolbar"]');
      expect(toolbar?.className).toContain('my-custom-bar');
    });

    it('supports vertical direction', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        direction: 'vertical',
        actions: [
          { name: 'test', label: 'Test', type: 'script' },
        ],
      }));
      const toolbar = container.querySelector('[role="toolbar"]');
      expect(toolbar?.className).toContain('flex-col');
    });

    it('defaults to horizontal direction', () => {
      const { container } = renderComponent(actionBar({
        type: 'action:bar',
        actions: [
          { name: 'test', label: 'Test', type: 'script' },
        ],
      }));
      const toolbar = container.querySelector('[role="toolbar"]');
      expect(toolbar?.className).toContain('flex-row');
    });
  });

  /**
   * [ADR-0066 D4 / framework#3923] The bar filters its own action list instead
   * of going through `ActionEngine.getActionsForLocation`, so the engine's
   * capability gate never reached `list_toolbar`: an action declaring a
   * capability nobody holds rendered as a live button, with nothing behind it
   * for a `type: 'api'` action pointed at a custom endpoint (the platform's
   * action route — the source of the 403 — never sees that request).
   */
  describe('requiredPermissions capability gate', () => {
    const Bar = ({ actions, systemActions }: { actions?: any[]; systemActions?: any[] }) => {
      const Component = ComponentRegistry.get('action:bar')!;
      return <Component schema={actionBar({ type: 'action:bar', location: 'list_toolbar', actions, systemActions })} />;
    };
    const withUser = (user: unknown, props: { actions?: any[]; systemActions?: any[] }) =>
      render(<ActionProvider context={{ user } as any}><Bar {...props} /></ActionProvider>);

    // Both fixtures declare the harness's location (#3142): without it the
    // strict placement filter would drop them before the capability gate ever
    // ran, and every `not.toContain` below would pass VACUOUSLY — the suite
    // would keep reporting green while testing nothing.
    const gated = { name: 'gated', label: 'Bulk Reassign', type: 'api', locations: ['list_toolbar'], requiredPermissions: ['manage_users'] };
    const plain = { name: 'plain', label: 'Export', type: 'api', locations: ['list_toolbar'] };

    it('hides an action whose capability the caller lacks', () => {
      const { container } = withUser({ id: 'u1', systemPermissions: ['setup.access'] }, { actions: [gated, plain] });
      expect(container.textContent).not.toContain('Bulk Reassign');
      expect(container.textContent).toContain('Export');
    });

    it('shows it when the capability is held', () => {
      const { container } = withUser({ id: 'u1', systemPermissions: ['manage_users'] }, { actions: [gated] });
      expect(container.textContent).toContain('Bulk Reassign');
    });

    it('gates on an EMPTY held set — "holds nothing" is known, not unknown', () => {
      const { container } = withUser({ id: 'u1', systemPermissions: [] }, { actions: [gated] });
      expect(container.textContent).not.toContain('Bulk Reassign');
    });

    it('fails OPEN when the host never resolved capabilities', () => {
      const { container } = withUser({ id: 'u1' }, { actions: [gated] });
      expect(container.textContent).toContain('Bulk Reassign');
    });

    it('gates systemActions too — the overflow slot is not a bypass', () => {
      const { container } = withUser(
        { id: 'u1', systemPermissions: [] },
        { actions: [plain], systemActions: [{ ...gated, label: 'Purge All' }] },
      );
      expect(container.textContent).not.toContain('Purge All');
    });
  });
});
