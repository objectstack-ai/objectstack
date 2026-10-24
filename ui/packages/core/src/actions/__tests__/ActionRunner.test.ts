/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import {
  ActionRunner,
  executeAction,
  type ActionDef,
  type ActionContext,
} from '../ActionRunner';

describe('ActionRunner', () => {
  let runner: ActionRunner;
  let context: ActionContext;

  beforeEach(() => {
    context = {
      data: { id: 1, name: 'Test' },
      record: { id: 1, status: 'active' },
      user: { id: 'u1', role: 'admin' },
    };
    runner = new ActionRunner(context);
  });

  // ==========================================================================
  // Basic execution
  // ==========================================================================

  describe('basic execution', () => {
    it('should execute an onClick callback', async () => {
      const onClick = vi.fn();
      const result = await runner.execute({ onClick });
      expect(result.success).toBe(true);
      expect(onClick).toHaveBeenCalledOnce();
    });

    it('should handle async onClick', async () => {
      const onClick = vi.fn().mockResolvedValue(undefined);
      const result = await runner.execute({ onClick });
      expect(result.success).toBe(true);
      expect(onClick).toHaveBeenCalledOnce();
    });

    it('should catch errors and return failure', async () => {
      const onClick = vi.fn().mockRejectedValue(new Error('boom'));
      const result = await runner.execute({ onClick });
      expect(result.success).toBe(false);
      expect(result.error).toBe('boom');
    });
  });

  // ==========================================================================
  // Unresolvable dispatch (objectui#2960)
  // ==========================================================================

  describe('unresolvable dispatch', () => {
    it('fails loudly when the schema declares nothing executable', async () => {
      // A legacy string row action reaches the runner as `{ type: <name> }` —
      // the NAME in the `type` slot. It matches no built-in type and no
      // registered handler, so there is nothing to run. This used to return
      // `{ success: true, reload: true, close: true }` after issuing zero
      // requests.
      const result = await runner.execute({ type: 'convert_lead', params: { record: { id: 1 } } });

      expect(result.success).toBe(false);
      expect(result.error).toContain('convert_lead');
      expect(result.reload).toBeUndefined();
    });

    it('does not toast success for an action it never ran', async () => {
      const toastHandler = vi.fn();
      runner.setToastHandler(toastHandler);

      await runner.execute({ type: 'convert_lead' });

      expect(toastHandler).toHaveBeenCalledTimes(1);
      expect(toastHandler).toHaveBeenCalledWith(
        expect.stringContaining('convert_lead'),
        expect.objectContaining({ type: 'error' }),
      );
    });

    it('still runs a handler registered under the action name', async () => {
      // The by-name dispatch path is how consumers wire custom row actions;
      // the guard must not close it.
      const handler = vi.fn().mockResolvedValue({ success: true });
      runner.registerHandler('convert_lead', handler);

      const result = await runner.execute({ type: 'convert_lead' });

      expect(result.success).toBe(true);
      expect(handler).toHaveBeenCalledOnce();
    });

    it('still runs a typeless action that only declares a redirect', async () => {
      const result = await runner.execute({ redirect: '/leads/1' });

      expect(result.success).toBe(true);
      expect(result.redirect).toBe('/leads/1');
    });
  });

  // ==========================================================================
  // Conditions and disabled
  // ==========================================================================

  describe('conditions', () => {
    it('should skip action when condition evaluates to false', async () => {
      const onClick = vi.fn();
      const result = await runner.execute({
        condition: '${record.status === "inactive"}',
        onClick,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Action condition not met');
      expect(onClick).not.toHaveBeenCalled();
    });

    it('should execute action when condition evaluates to true', async () => {
      const onClick = vi.fn();
      const result = await runner.execute({
        condition: '${record.status === "active"}',
        onClick,
      });
      expect(result.success).toBe(true);
      expect(onClick).toHaveBeenCalledOnce();
    });

    it('should skip action when disabled is true (boolean)', async () => {
      const onClick = vi.fn();
      const result = await runner.execute({ disabled: true, onClick });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Action is disabled');
      expect(onClick).not.toHaveBeenCalled();
    });

    it('should skip action when disabled expression evaluates to true', async () => {
      const onClick = vi.fn();
      const result = await runner.execute({
        disabled: '${user.role === "admin"}',
        onClick,
      });
      expect(result.success).toBe(false);
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Confirmation
  // ==========================================================================

  describe('confirmation', () => {
    it('should show confirmation and proceed when accepted', async () => {
      const confirmHandler = vi.fn().mockResolvedValue(true);
      runner.setConfirmHandler(confirmHandler);

      const onClick = vi.fn();
      const result = await runner.execute({
        confirmText: 'Are you sure?',
        onClick,
      });

      expect(confirmHandler).toHaveBeenCalledWith('Are you sure?');
      expect(result.success).toBe(true);
      expect(onClick).toHaveBeenCalledOnce();
    });

    it('should cancel when confirmation is rejected', async () => {
      const confirmHandler = vi.fn().mockResolvedValue(false);
      runner.setConfirmHandler(confirmHandler);

      const onClick = vi.fn();
      const result = await runner.execute({
        confirmText: 'Are you sure?',
        onClick,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Action cancelled by user');
      expect(onClick).not.toHaveBeenCalled();
    });

    it('ignores the retired structured confirm object (objectui#4314)', async () => {
      const confirmHandler = vi.fn().mockResolvedValue(false);
      runner.setConfirmHandler(confirmHandler);

      const onClick = vi.fn();
      // Metadata that still carries the retired arm (e.g. stored before the
      // retirement) — cast, because `ActionDef.confirm` is a `never` tombstone
      // and the key cannot be AUTHORED in TypeScript at all.
      const result = await runner.execute({
        confirm: { title: 'Delete', message: 'Delete this item?' },
        onClick,
      } as unknown as ActionDef);

      // No confirm gate: the runner reads only `confirmText`. Under the old
      // precedence read, the REJECTING handler above would have cancelled the
      // action — success here is what pins the read's removal.
      expect(confirmHandler).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(onClick).toHaveBeenCalledOnce();
    });
  });

  // ==========================================================================
  // Custom handlers
  // ==========================================================================

  describe('custom handlers', () => {
    it('should dispatch to registered custom handler', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true, data: 42 });
      runner.registerHandler('my-action', handler);

      const action: ActionDef = { type: 'my-action', params: { foo: 'bar' } };
      const result = await runner.execute(action);

      // The runner context carries the derived `os.user` identity alias
      // (server-CEL parity, #2358) alongside the caller-provided keys.
      expect(handler).toHaveBeenCalledWith(action, { ...context, os: { user: context.user } });
      expect(result.success).toBe(true);
      expect(result.data).toBe(42);
    });

    it('should allow unregistering a handler', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      runner.registerHandler('temp', handler);
      runner.unregisterHandler('temp');

      const result = await runner.execute({ type: 'temp', onClick: vi.fn() });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Script action type
  // ==========================================================================

  describe('script action type', () => {
    it('should evaluate script expression', async () => {
      const result = await runner.execute({
        type: 'script',
        target: 'record.id + 100',
      });
      expect(result.success).toBe(true);
      expect(result.data).toBe(101);
    });

    it('should evaluate a script expression against the data scope', async () => {
      const result = await runner.execute({
        type: 'script',
        target: 'data.name',
      });
      expect(result.success).toBe(true);
      expect(result.data).toBe('Test');
    });

    it('should not read the retired execute alias, and should prescribe the rename', async () => {
      // `execute` was removed in @objectstack/spec 17 (#3855) — the parser now
      // rejects it outright, so no parsed action can carry it and the runner has
      // exactly one handler slot (#3856). Pinned as a test because the failure
      // mode of re-adding `target || execute` used to be invisible: it ran, and
      // it type-checked while `ActionDef` was open-ended, so it could quietly
      // resurrect the two-slot ambiguity that had one action running different
      // scripts on each side of the wire (#3713).
      //
      // `ActionDef` has since been CLOSED (objectstack#4075 step 3, pinned next
      // door in `actionDef-closed-surface.test.ts`), so authoring `execute` is
      // now a compile error as well — a fact this file could not state until it
      // was type-checked (objectui#4040). `@ts-expect-error` rather than a cast:
      // it pins the refusal in BOTH directions, since re-opening the surface
      // would make the unused suppression itself an error, while the runtime
      // assertions below keep pinning the runner's own refusal message.
      const result = await runner.execute({
        type: 'script',
        // @ts-expect-error -- `execute` is not a key of the closed `ActionDef`
        execute: 'record.id + 100',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('`execute` was removed');
      expect(result.error).toContain('`target`');
    });

    it('should fail when no script provided', async () => {
      const result = await runner.execute({ type: 'script' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No script provided');
    });

    it('should report a server-side body rather than claiming no script was provided', async () => {
      // Spec-valid action: `body` IS the script, but bodies run server-side.
      // The old message sent authors hunting for a field they had written.
      const result = await runner.execute({
        type: 'script',
        body: { language: 'expression', source: 'input.amount > 1000' },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('server-side');
      expect(result.error).not.toContain('No script provided');
    });

    it('should not interpret a js body client-side', async () => {
      // L2 needs an isolated VM enforcing capabilities/timeout/memory — the
      // browser has none, so this must refuse rather than approximate.
      const result = await runner.execute({
        type: 'script',
        body: { language: 'js', source: 'return 1 + 1;', capabilities: [] },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('server-side');
    });

    it('should still evaluate a client-side target when a body is also present', async () => {
      const result = await runner.execute({
        type: 'script',
        target: 'data.name',
        body: { language: 'expression', source: 'input.amount > 1000' },
      });
      expect(result.success).toBe(true);
      expect(result.data).toBe('Test');
    });

    it('should return data as undefined for expressions referencing missing vars', async () => {
      const result = await runner.execute({
        type: 'script',
        target: 'data.nonExistent',
      });
      // ExpressionEvaluator returns undefined for missing properties (doesn't throw)
      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });
  });

  // ==========================================================================
  // URL action type
  // ==========================================================================

  describe('url action type', () => {
    it('should return redirect for relative URL', async () => {
      const result = await runner.execute({
        type: 'url',
        target: '/dashboard',
      });
      expect(result.success).toBe(true);
      expect(result.redirect).toBe('/dashboard');
    });

    it('should use navigation handler when provided', async () => {
      const navHandler = vi.fn();
      runner.setNavigationHandler(navHandler);

      const result = await runner.execute({
        type: 'url',
        target: '/dashboard',
      });

      expect(result.success).toBe(true);
      expect(navHandler).toHaveBeenCalledWith('/dashboard', {
        external: false,
        newTab: false,
      });
    });

    it('should detect external URLs', async () => {
      const navHandler = vi.fn();
      runner.setNavigationHandler(navHandler);

      await runner.execute({
        type: 'url',
        target: 'https://example.com',
      });

      expect(navHandler).toHaveBeenCalledWith('https://example.com', {
        external: true,
        newTab: true,
      });
    });

    it('should force a new tab for a relative URL when openIn is "new-tab"', async () => {
      const navHandler = vi.fn();
      runner.setNavigationHandler(navHandler);

      await runner.execute({
        type: 'url',
        target: '/print/a3',
        openIn: 'new-tab',
      });

      expect(navHandler).toHaveBeenCalledWith('/print/a3', {
        external: false,
        newTab: true,
      });
    });

    it('should force same-page navigation for an external URL when openIn is "self"', async () => {
      const navHandler = vi.fn();
      runner.setNavigationHandler(navHandler);

      await runner.execute({
        type: 'url',
        target: 'https://example.com',
        openIn: 'self',
      });

      expect(navHandler).toHaveBeenCalledWith('https://example.com', {
        external: true,
        newTab: false,
      });
    });

    it('should reject javascript: URLs', async () => {
      const result = await runner.execute({
        type: 'url',
        target: 'javascript:alert(1)',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });

    it('should fail when no URL provided', async () => {
      const result = await runner.execute({ type: 'url' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No URL provided');
    });
  });

  // ==========================================================================
  // Modal action type
  // ==========================================================================

  describe('modal action type', () => {
    it('should return modal schema when no handler registered', async () => {
      const modalSchema = { type: 'dialog', title: 'Edit' };
      const result = await runner.execute({
        type: 'modal',
        modal: modalSchema,
      });
      expect(result.success).toBe(true);
      expect(result.modal).toEqual(modalSchema);
    });

    it('should delegate to modal handler when provided', async () => {
      const modalHandler = vi.fn().mockResolvedValue({ success: true, data: { saved: true } });
      runner.setModalHandler(modalHandler);

      const modalSchema = { type: 'form', fields: [] };
      const result = await runner.execute({
        type: 'modal',
        modal: modalSchema,
      });

      expect(modalHandler).toHaveBeenCalledWith(modalSchema, { ...context, os: { user: context.user } });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ saved: true });
    });

    it('should use target as modal schema fallback', async () => {
      const result = await runner.execute({
        type: 'modal',
        target: 'edit_form',
      });
      expect(result.success).toBe(true);
      expect(result.modal).toBe('edit_form');
    });

    it('should fail when no modal schema/target provided', async () => {
      const result = await runner.execute({ type: 'modal' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No modal schema');
    });
  });

  // ==========================================================================
  // Flow action type
  // ==========================================================================

  describe('flow action type', () => {
    it('should delegate to registered flow handler', async () => {
      const flowHandler = vi.fn().mockResolvedValue({ success: true, data: 'flow_started' });
      runner.registerHandler('flow', flowHandler);

      const action: ActionDef = { type: 'flow', target: 'approval_flow' };
      const result = await runner.execute(action);

      expect(flowHandler).toHaveBeenCalledWith(action, { ...context, os: { user: context.user } });
      expect(result.success).toBe(true);
    });

    it('should fail when no flow handler registered', async () => {
      const result = await runner.execute({ type: 'flow', target: 'my_flow' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Flow handler not registered');
    });

    it('should fail when no flow target provided', async () => {
      const result = await runner.execute({ type: 'flow' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No flow target');
    });
  });

  // ==========================================================================
  // API action type
  // ==========================================================================

  describe('api action type', () => {
    // `vi.stubGlobal` rather than `global.fetch = ...`, and handed back here:
    // this file runs in the `unit` project, which is `isolate: false`, so a raw
    // assignment to a shared global outlives the file and every later file in
    // the worker inherits it (objectui#8500).
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should call fetch with simple string endpoint', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ id: 1 }) };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const result = await runner.execute({
        type: 'api',
        api: '/api/records',
        method: 'GET',
      });

      expect(global.fetch).toHaveBeenCalledWith('/api/records', expect.objectContaining({
        method: 'GET',
      }));
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 1 });
    });

    it('should use endpoint field as alias', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ ok: true }) };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const result = await runner.execute({
        type: 'api',
        endpoint: '/api/v2/records',
      });

      expect(global.fetch).toHaveBeenCalledWith('/api/v2/records', expect.any(Object));
      expect(result.success).toBe(true);
    });

    it('should support complex API config', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ done: true }) };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const result = await runner.execute({
        type: 'api',
        api: {
          url: '/api/records',
          method: 'PUT',
          headers: { Authorization: 'Bearer xyz' },
          body: { name: 'Updated' },
          queryParams: { include: 'details' },
        },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/records?include=details',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({ Authorization: 'Bearer xyz' }),
          body: JSON.stringify({ name: 'Updated' }),
        }),
      );
      expect(result.success).toBe(true);
    });

    it('should handle HTTP errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      }));

      const result = await runner.execute({
        type: 'api',
        api: '/api/missing',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
    });

    it('should handle network errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const result = await runner.execute({
        type: 'api',
        api: '/api/records',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('should fail when no endpoint provided', async () => {
      const result = await runner.execute({ type: 'api' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No API endpoint');
    });
  });

  // ==========================================================================
  // Navigation action type
  // ==========================================================================

  describe('navigation action type', () => {
    it('should return redirect for internal navigation', async () => {
      const result = await runner.execute({
        type: 'navigation',
        navigate: { to: '/records/1' },
      });
      expect(result.success).toBe(true);
      expect(result.redirect).toBe('/records/1');
    });

    it('should use navigation handler when provided', async () => {
      const navHandler = vi.fn();
      runner.setNavigationHandler(navHandler);

      await runner.execute({
        type: 'navigation',
        navigate: { to: '/records/1', replace: true },
      });

      expect(navHandler).toHaveBeenCalledWith('/records/1', expect.objectContaining({
        replace: true,
      }));
    });

    it('should reject invalid URLs', async () => {
      const result = await runner.execute({
        type: 'navigation',
        navigate: { to: 'data:text/html,...' },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });

    it('accepts a flat `to` with no `navigate` block (element:button CTAs)', async () => {
      const navHandler = vi.fn();
      runner.setNavigationHandler(navHandler);
      const result = await runner.execute({
        type: 'navigation',
        to: '/apps/cloud_control/sys_environment',
      });
      expect(result.success).toBe(true);
      expect(navHandler).toHaveBeenCalledWith(
        '/apps/cloud_control/sys_environment',
        expect.objectContaining({ external: false }),
      );
    });

    it('errors when no target is given, instead of reporting a no-op as success', async () => {
      const result = await runner.execute({ type: 'navigation' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No URL provided');
    });

    // ------------------------------------------------------------------
    // `navigation` is an alias of `url` (#2944 item 3) and shares its
    // navigator. Before that, it was quietly the weaker of the two: no
    // `${param.X}` interpolation, `openIn` ignored, no `/api/…` full-page
    // short-circuit. These pin the convergence.
    // ------------------------------------------------------------------

    it('interpolates ${param.X} in the target, as `url` always did', async () => {
      const navHandler = vi.fn();
      runner.setNavigationHandler(navHandler);
      await runner.execute({
        type: 'navigation',
        to: '/records?owner=${param.owner}',
        params: { owner: 'u 1' },
      });
      expect(navHandler).toHaveBeenCalledWith(
        '/records?owner=u%201',
        expect.objectContaining({ external: false }),
      );
    });

    it('honours `openIn` — the declarative switch it used to ignore', async () => {
      const navHandler = vi.fn();
      runner.setNavigationHandler(navHandler);
      await runner.execute({ type: 'navigation', to: '/print/a3', openIn: 'new-tab' });
      expect(navHandler).toHaveBeenCalledWith(
        '/print/a3',
        expect.objectContaining({ newTab: true }),
      );
    });

    it('still lets `navigate.newTab` force a new tab without `openIn`', async () => {
      const navHandler = vi.fn();
      runner.setNavigationHandler(navHandler);
      await runner.execute({
        type: 'navigation',
        navigate: { to: '/print/a4', newTab: true },
      });
      expect(navHandler).toHaveBeenCalledWith(
        '/print/a4',
        expect.objectContaining({ newTab: true }),
      );
    });

    it('treats an explicit `navigate.external` as external', async () => {
      const navHandler = vi.fn();
      runner.setNavigationHandler(navHandler);
      await runner.execute({
        type: 'navigation',
        navigate: { to: '/go/elsewhere', external: true },
      });
      expect(navHandler).toHaveBeenCalledWith(
        '/go/elsewhere',
        expect.objectContaining({ external: true }),
      );
    });
  });

  describe('url ⇄ navigation share one navigator (#2944 item 3)', () => {
    it('`url` passes `replace` through — the one modifier only the alias carried', async () => {
      const navHandler = vi.fn();
      runner.setNavigationHandler(navHandler);
      await runner.execute({ type: 'url', target: '/records/1', replace: true });
      expect(navHandler).toHaveBeenCalledWith(
        '/records/1',
        expect.objectContaining({ replace: true }),
      );
    });

    it('omits `replace` from the handler options when unset', async () => {
      const navHandler = vi.fn();
      runner.setNavigationHandler(navHandler);
      await runner.execute({ type: 'navigation', to: '/records/1' });
      expect(navHandler).toHaveBeenCalledWith('/records/1', { external: false, newTab: false });
    });

    it('both names resolve the same target the same way', async () => {
      const viaUrl = vi.fn();
      const viaNav = vi.fn();
      runner.setNavigationHandler(viaUrl);
      await runner.execute({ type: 'url', target: '/x?p=${param.p}', params: { p: 'a b' } });
      runner.setNavigationHandler(viaNav);
      await runner.execute({ type: 'navigation', to: '/x?p=${param.p}', params: { p: 'a b' } });
      expect(viaNav.mock.calls[0]).toEqual(viaUrl.mock.calls[0]);
    });

  });

  // The two branches the shared navigator must not lose. Both were untested
  // while `executeUrl` was their only caller, and both are what the better-auth
  // social-login redirect dance depends on: an `/api/…` target has to be a
  // full-page load, because pushing it into the SPA router matches no route and
  // lands on the home page, so the OAuth flow never starts.
  describe('the /api/ full-page short-circuit', () => {
    // This project runs in a node environment, so there is no `window` at all —
    // which is exactly why these two branches had no coverage. Stub the minimum
    // the navigator touches and put it back afterwards.
    type MaybeWindow = { window?: unknown };
    // Typed with the setter's own signature: `ReturnType<typeof vi.fn>` is the
    // un-instantiated `Mock<Procedure | Constructable>`, which `tsc` reports as
    // not callable at the `href(v)` call site below (objectui#4040).
    let href: Mock<(url: string) => void>;
    let hadWindow: boolean;
    let previousWindow: unknown;

    beforeEach(() => {
      href = vi.fn();
      hadWindow = 'window' in globalThis;
      previousWindow = (globalThis as MaybeWindow).window;
      (globalThis as MaybeWindow).window = {
        location: {
          origin: 'http://localhost',
          get href() { return ''; },
          set href(v: string) { href(v); },
        },
        open: vi.fn(),
      };
    });

    afterEach(() => {
      if (hadWindow) (globalThis as MaybeWindow).window = previousWindow;
      else delete (globalThis as MaybeWindow).window;
    });

    it('sends an /api/ target to a full-page load, not the SPA router', async () => {
      const navHandler = vi.fn();
      runner.setNavigationHandler(navHandler);

      const result = await runner.execute({
        type: 'url',
        target: '/api/v1/auth/sign-in/social?provider=${param.provider}',
        params: { provider: 'github' },
      });

      expect(result.success).toBe(true);
      expect(href).toHaveBeenCalledWith('/api/v1/auth/sign-in/social?provider=github');
      expect(navHandler).not.toHaveBeenCalled();
    });

    it('prefixes an /api/ target with the context apiBase (split SPA + backend)', async () => {
      const split = new ActionRunner({ ...context, apiBase: 'http://localhost:3000/' });
      await split.execute({ type: 'url', target: '/api/v1/auth/sign-in/social' });

      expect(href).toHaveBeenCalledWith('http://localhost:3000/api/v1/auth/sign-in/social');
    });
  });

  describe('form action type', () => {
    it('opens the form route with the record id (regression: Log Time no-op)', async () => {
      const result = await runner.execute({
        type: 'form',
        target: 'showcase_task.default',
      });
      expect(result.success).toBe(true);
      expect(result.redirect).toBe('/forms/showcase_task.default?recordId=1');
    });

    it('uses the navigation handler when provided', async () => {
      const navHandler = vi.fn();
      runner.setNavigationHandler(navHandler);
      const result = await runner.execute({ type: 'form', target: 'showcase_task.default' });
      expect(result.success).toBe(true);
      expect(navHandler).toHaveBeenCalledWith(
        '/forms/showcase_task.default?recordId=1',
        expect.objectContaining({ external: false }),
      );
    });

    it('falls back to a bare form route when there is no record id', async () => {
      const bare = new ActionRunner({ user: { id: 'u1' } } as ActionContext);
      const result = await bare.execute({ type: 'form', target: 'showcase_task.default' });
      expect(result.redirect).toBe('/forms/showcase_task.default');
    });

    it('errors when no form target is given', async () => {
      const result = await runner.execute({ type: 'form' } as never);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/form target/i);
    });
  });

  // ==========================================================================
  // Post-execution: toast, refreshAfter
  // ==========================================================================

  describe('post-execution', () => {
    it('should emit success toast', async () => {
      const toastHandler = vi.fn();
      runner.setToastHandler(toastHandler);

      await runner.execute({
        onClick: vi.fn(),
        successMessage: 'Saved!',
      });

      expect(toastHandler).toHaveBeenCalledWith('Saved!', { type: 'success', duration: undefined });
    });

    it('does not let a server message (result.data.message) override successMessage', async () => {
      const toastHandler = vi.fn();
      runner.setToastHandler(toastHandler);
      // This row pinned the opposite until objectui#11344: the server's
      // sentence outranked the author's copy. Ruling A on
      // objectstack-ai/cloud#2315 retired that rung \u2014 the server returns facts
      // and the author's copy (here, `${result.*}`-interpolated) is the toast.
      runner.registerHandler('check-updates', vi.fn().mockResolvedValue({
        success: true,
        data: { message: '2 app update(s) available: CRM 1.0.0\u21921.0.1', update_count: 2 },
      }));

      await runner.execute({ type: 'check-updates', successMessage: 'Checked: ${result.update_count} update(s).' });

      expect(toastHandler).toHaveBeenCalledWith(
        'Checked: 2 update(s).',
        { type: 'success', duration: undefined },
      );
    });

    it('should fall back to successMessage when result.data has no message', async () => {
      const toastHandler = vi.fn();
      runner.setToastHandler(toastHandler);
      runner.registerHandler('noop', vi.fn().mockResolvedValue({ success: true, data: { update_count: 0 } }));

      await runner.execute({ type: 'noop', successMessage: 'Done.' });

      expect(toastHandler).toHaveBeenCalledWith('Done.', { type: 'success', duration: undefined });
    });

    it('should emit error toast on failure', async () => {
      const toastHandler = vi.fn();
      runner.setToastHandler(toastHandler);

      await runner.execute({
        onClick: vi.fn().mockRejectedValue(new Error('fail')),
        errorMessage: 'Custom error',
      });

      expect(toastHandler).toHaveBeenCalledWith('Custom error', { type: 'error', duration: undefined });
    });

    it('coerces a non-string result.error to its message before toasting (React #31 guard)', async () => {
      const toastHandler = vi.fn();
      runner.setToastHandler(toastHandler);
      // A buggy handler leaks the ObjectStack error envelope OBJECT through
      // `result.error`. Passing it to toast.error() renders it as a React
      // child and crashes the page — the sink must flatten it to a string.
      runner.registerHandler('leaky', vi.fn().mockResolvedValue({
        success: false,
        error: { code: 'invalid_request', message: 'Provide either password or generatePassword, not both' },
      }));

      await runner.execute({ type: 'leaky' });

      expect(toastHandler).toHaveBeenCalledWith(
        'Provide either password or generatePassword, not both',
        { type: 'error', duration: undefined },
      );
    });

    it('falls back to a generic string when a non-string result.error has no message', async () => {
      const toastHandler = vi.fn();
      runner.setToastHandler(toastHandler);
      runner.registerHandler('leaky', vi.fn().mockResolvedValue({
        success: false,
        error: { code: 'boom' },
      }));

      await runner.execute({ type: 'leaky' });

      expect(toastHandler).toHaveBeenCalledWith('Action failed', { type: 'error', duration: undefined });
    });

    it('should suppress toast when showOnSuccess is false', async () => {
      const toastHandler = vi.fn();
      runner.setToastHandler(toastHandler);

      await runner.execute({
        onClick: vi.fn(),
        toast: { showOnSuccess: false },
      });

      expect(toastHandler).not.toHaveBeenCalled();
    });

    it('should set reload when refreshAfter is true', async () => {
      const toastHandler = vi.fn();
      runner.setToastHandler(toastHandler);

      const result = await runner.execute({
        onClick: vi.fn(),
        refreshAfter: true,
        toast: { showOnSuccess: false },
      });

      expect(result.reload).toBe(true);
    });
  });

  // ==========================================================================
  // Action chaining
  // ==========================================================================

  describe('chaining', () => {
    it('should execute chained actions sequentially', async () => {
      const order: number[] = [];
      const handler1 = vi.fn(async () => { order.push(1); return { success: true }; });
      const handler2 = vi.fn(async () => { order.push(2); return { success: true }; });
      runner.registerHandler('step1', handler1);
      runner.registerHandler('step2', handler2);

      const result = await runner.execute({
        onClick: vi.fn(),
        chain: [
          { type: 'step1' },
          { type: 'step2' },
        ],
      });

      expect(result.success).toBe(true);
      expect(order).toEqual([1, 2]);
    });

    it('should stop sequential chain on failure', async () => {
      const handler1 = vi.fn().mockResolvedValue({ success: false, error: 'step1 fail' });
      const handler2 = vi.fn().mockResolvedValue({ success: true });
      runner.registerHandler('step1', handler1);
      runner.registerHandler('step2', handler2);

      const result = await runner.execute({
        onClick: vi.fn(),
        chain: [
          { type: 'step1' },
          { type: 'step2' },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('step1 fail');
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should execute chained actions in parallel', async () => {
      const handler1 = vi.fn().mockResolvedValue({ success: true });
      const handler2 = vi.fn().mockResolvedValue({ success: true });
      runner.registerHandler('a', handler1);
      runner.registerHandler('b', handler2);

      const result = await runner.execute({
        onClick: vi.fn(),
        chain: [{ type: 'a' }, { type: 'b' }],
        chainMode: 'parallel',
      });

      expect(result.success).toBe(true);
      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });
  });

  // ==========================================================================
  // onSuccess / onFailure callbacks
  // ==========================================================================

  describe('callbacks', () => {
    // The `onSuccess` chained-callback channel (`ActionDef | ActionDef[]`) was
    // retired by objectui#5934 (maintainer ruling 2026-08-31): the spec
    // strict-refuses a callback shape inside `onSuccess` at parse, and the
    // census found zero producers outside this file's own pins. The two tests
    // that used to pin the channel now pin its ABSENCE — stored rows rehydrate
    // UNPARSED (#3903), so the shapes still reach the runner as data, and must
    // get no reading. `onFailure` is untouched: the spec declares no such key,
    // so it keeps its one runner-native meaning.
    it('a callback-shaped onSuccess is not dispatched — the channel is retired', async () => {
      const successHandler = vi.fn().mockResolvedValue({ success: true });
      runner.registerHandler('notify', successHandler);

      const result = await runner.execute({
        onClick: vi.fn(),
        // `as never`: since #5934 the declared type derives the spec's
        // `{ navigate, openIn }` block, so the compiler refuses this shape at
        // the authoring site — the cast reaches around it to pin the runtime.
        onSuccess: { type: 'notify', params: { msg: 'ok' } },
        toast: { showOnSuccess: false },
      } as never);

      expect(result.success).toBe(true);
      expect(successHandler).not.toHaveBeenCalled();
    });

    it('should execute onFailure callback after failure', async () => {
      const failureHandler = vi.fn().mockResolvedValue({ success: true });
      runner.registerHandler('log-error', failureHandler);

      await runner.execute({
        onClick: vi.fn().mockRejectedValue(new Error('fail')),
        onFailure: { type: 'log-error' },
        toast: { showOnError: false },
      });

      expect(failureHandler).toHaveBeenCalledOnce();
    });

    it('an array of callback-shaped onSuccess entries is not dispatched either', async () => {
      const h1 = vi.fn().mockResolvedValue({ success: true });
      const h2 = vi.fn().mockResolvedValue({ success: true });
      runner.registerHandler('cb1', h1);
      runner.registerHandler('cb2', h2);

      const result = await runner.execute({
        onClick: vi.fn(),
        onSuccess: [{ type: 'cb1' }, { type: 'cb2' }],
        toast: { showOnSuccess: false },
      } as never);

      expect(result.success).toBe(true);
      expect(h1).not.toHaveBeenCalled();
      expect(h2).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // executeChain
  // ==========================================================================

  describe('executeChain', () => {
    it('should return success for empty chain', async () => {
      const result = await runner.executeChain([]);
      expect(result.success).toBe(true);
    });

    it('should execute single action chain', async () => {
      const onClick = vi.fn();
      const result = await runner.executeChain([{ onClick }]);
      expect(result.success).toBe(true);
      expect(onClick).toHaveBeenCalledOnce();
    });
  });

  // ==========================================================================
  // Context management
  // ==========================================================================

  describe('context', () => {
    it('should update context', () => {
      runner.updateContext({ record: { id: 2, status: 'closed' } });
      const ctx = runner.getContext();
      expect(ctx.record?.id).toBe(2);
    });

    it('should expose evaluator', () => {
      const ev = runner.getEvaluator();
      expect(ev).toBeDefined();
      expect(ev.evaluate('${data.name}')).toBe('Test');
    });
  });

  // ==========================================================================
  // executeAction convenience function
  // ==========================================================================

  describe('executeAction', () => {
    it('should execute an action with the convenience function', async () => {
      const result = await executeAction(
        { type: 'script', target: '1 + 2' },
        { data: {} },
      );
      expect(result.success).toBe(true);
      expect(result.data).toBe(3);
    });
  });
});
