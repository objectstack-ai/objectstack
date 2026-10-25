/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Registry } from '../Registry';

describe('Registry', () => {
  let registry: Registry;
  let consoleWarnSpy: any;

  beforeEach(() => {
    registry = new Registry();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe('Basic Registration', () => {
    it('should register a component without namespace', () => {
      const component = () => 'test';
      registry.register('button', component);
      
      expect(registry.has('button')).toBe(true);
      expect(registry.get('button')).toBe(component);
    });

    it('should warn when registering without namespace', () => {
      const component = () => 'test';
      registry.register('button', component);
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Registering component "button" without a namespace is deprecated')
      );
    });

    it('should register a component with namespace', () => {
      const component = () => 'test';
      registry.register('button', component, { namespace: 'ui' });
      
      expect(registry.has('button', 'ui')).toBe(true);
      expect(registry.get('button', 'ui')).toBe(component);
    });

    it('should not warn when registering with namespace', () => {
      const component = () => 'test';
      registry.register('button', component, { namespace: 'ui' });
      
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('Namespaced Registration', () => {
    it('should register components with the same name in different namespaces', () => {
      const gridComponent1 = () => 'grid1';
      const gridComponent2 = () => 'grid2';
      
      registry.register('grid', gridComponent1, { namespace: 'plugin-grid' });
      registry.register('grid', gridComponent2, { namespace: 'plugin-view' });
      
      expect(registry.get('grid', 'plugin-grid')).toBe(gridComponent1);
      expect(registry.get('grid', 'plugin-view')).toBe(gridComponent2);
    });

    it('should store full type as namespace:type', () => {
      const component = () => 'test';
      registry.register('button', component, { namespace: 'ui' });
      
      const config = registry.getConfig('button', 'ui');
      expect(config?.type).toBe('ui:button');
    });

    it('should preserve namespace in component config', () => {
      const component = () => 'test';
      registry.register('button', component, { 
        namespace: 'ui',
        label: 'Button',
        category: 'form'
      });
      
      const config = registry.getConfig('button', 'ui');
      expect(config?.namespace).toBe('ui');
      expect(config?.label).toBe('Button');
      expect(config?.category).toBe('form');
    });
  });

  describe('Namespace Lookup with Fallback', () => {
    it('should not fallback when namespace is explicitly specified', () => {
      const component = () => 'test';
      registry.register('button', component);
      
      // When no namespace is specified, should find it
      expect(registry.get('button')).toBe(component);
      
      // When namespace is specified but component isn't in that namespace, should return undefined
      expect(registry.get('button', 'ui')).toBeUndefined();
    });

    it('should prefer namespaced component over non-namespaced', () => {
      const component1 = () => 'non-namespaced';
      const component2 = () => 'namespaced';
      
      registry.register('button', component1);
      registry.register('button', component2, { namespace: 'ui' });
      
      // When searching with namespace, should get namespaced version
      expect(registry.get('button', 'ui')).toBe(component2);
      
      // When searching without namespace, should get the latest registered (namespaced one due to backward compatibility)
      expect(registry.get('button')).toBe(component2);
    });

    it('should return undefined when component not found in any namespace', () => {
      expect(registry.get('nonexistent', 'ui')).toBeUndefined();
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('has() method', () => {
    it('should check existence with namespace', () => {
      const component = () => 'test';
      registry.register('button', component, { namespace: 'ui' });
      
      expect(registry.has('button', 'ui')).toBe(true);
      // Due to backward compatibility, non-namespaced lookup also works
      expect(registry.has('button')).toBe(true);
      // Other namespaces should return false
      expect(registry.has('button', 'other')).toBe(false);
    });

    it('should fallback to non-namespaced check only when no namespace provided', () => {
      const component = () => 'test';
      registry.register('button', component);
      
      expect(registry.has('button')).toBe(true);
      // When namespace is explicitly requested, should not find non-namespaced component
      expect(registry.has('button', 'ui')).toBe(false);
    });
  });

  describe('getConfig() method', () => {
    it('should get config with namespace', () => {
      const component = () => 'test';
      registry.register('button', component, { 
        namespace: 'ui',
        label: 'Button' 
      });
      
      const config = registry.getConfig('button', 'ui');
      expect(config).toBeDefined();
      expect(config?.component).toBe(component);
      expect(config?.label).toBe('Button');
    });

    it('should not fallback when namespace is explicitly provided', () => {
      const component = () => 'test';
      registry.register('button', component, { label: 'Button' });
      
      // When no namespace is provided, should find it
      const config1 = registry.getConfig('button');
      expect(config1).toBeDefined();
      
      // When namespace is provided but component isn't in that namespace, should return undefined
      const config2 = registry.getConfig('button', 'ui');
      expect(config2).toBeUndefined();
    });
  });

  describe('getKnownTypes() / getMeta() / getVersion() — lazy-aware reads (objectui#2953)', () => {
    const loader = () => Promise.resolve();

    it('getKnownTypes() includes pending lazy stubs; getAllTypes() does not', () => {
      registry.register('button', () => 'b1');
      registry.registerLazy('object-kanban', loader, { namespace: 'plugin-kanban' });

      // getAllTypes() answers "what can render right now" — the stub cannot.
      expect(registry.getAllTypes()).not.toContain('object-kanban');
      // getKnownTypes() answers "what does this app know about" — the question
      // a whitelist or a manifest is actually asking. Building one off
      // getAllTypes() rejected lazily-registered blocks as unknown.
      expect(registry.getKnownTypes()).toContain('object-kanban');
      expect(registry.getKnownTypes()).toContain('plugin-kanban:object-kanban');
      expect(registry.getKnownTypes()).toContain('button');
    });

    it('getKnownTypes() dedupes a type that is both loaded and stubbed', () => {
      registry.registerLazy('object-map', loader, { namespace: 'plugin-map' });
      registry.register('object-map', () => 'm', { namespace: 'plugin-map' });

      const known = registry.getKnownTypes();
      expect(known.filter((t) => t === 'object-map')).toHaveLength(1);
    });

    it('getMeta() reads through to a stub, getConfig() stays loaded-only', () => {
      registry.registerLazy('object-gantt', loader, {
        namespace: 'plugin-gantt',
        category: 'view',
        isContainer: false,
      });

      expect(registry.getConfig('object-gantt')).toBeUndefined();
      expect(registry.getMeta('object-gantt')).toMatchObject({
        namespace: 'plugin-gantt',
        category: 'view',
        isContainer: false,
      });
      // A stub has no declared inputs until its chunk lands — "not yet known",
      // which consumers must not read as "declares no props".
      expect(registry.getMeta('object-gantt')?.inputs).toBeUndefined();
    });

    it('getMeta() prefers the loaded registration once the chunk lands', () => {
      registry.registerLazy('object-chart', loader, { namespace: 'plugin-charts' });
      registry.register('object-chart', () => 'c', {
        namespace: 'plugin-charts',
        inputs: [{ name: 'type', type: 'string' }],
      });

      expect(registry.getMeta('object-chart')?.inputs).toHaveLength(1);
    });

    it('getMeta() honours an explicit namespace', () => {
      registry.registerLazy('kanban', loader, { namespace: 'view' });

      expect(registry.getMeta('kanban', 'view')).toBeTruthy();
      expect(registry.getMeta('kanban', 'nope')).toBeUndefined();
    });

    it('getVersion() moves on every change to the known set', () => {
      const start = registry.getVersion();
      registry.register('button', () => 'b1');
      const afterRegister = registry.getVersion();
      registry.registerLazy('object-map', loader, { namespace: 'plugin-map' });
      const afterLazy = registry.getVersion();
      registry.unregister('button');
      const afterUnregister = registry.getVersion();

      // Counting types cannot substitute for this: a registration paired with
      // an unregistration leaves the count untouched while the set changed.
      expect(afterRegister).toBeGreaterThan(start);
      expect(afterLazy).toBeGreaterThan(afterRegister);
      expect(afterUnregister).toBeGreaterThan(afterLazy);
    });
  });

  describe('getAllTypes() and getAllConfigs()', () => {
    it('should return all registered types including namespaced ones', () => {
      registry.register('button', () => 'b1');
      registry.register('input', () => 'i1', { namespace: 'ui' });
      registry.register('grid', () => 'g1', { namespace: 'plugin-grid' });
      
      const types = registry.getAllTypes();
      // Due to backward compatibility, namespaced components are stored under both keys
      expect(types).toContain('button');
      expect(types).toContain('ui:input');
      expect(types).toContain('input'); // backward compat
      expect(types).toContain('plugin-grid:grid');
      expect(types).toContain('grid'); // backward compat
    });

    it('should return all configs', () => {
      registry.register('button', () => 'b1', { label: 'Button' });
      registry.register('input', () => 'i1', { 
        namespace: 'ui',
        label: 'Input' 
      });
      
      const configs = registry.getAllConfigs();
      // Due to backward compatibility, namespaced components are stored twice
      expect(configs.length).toBeGreaterThanOrEqual(2);
      expect(configs.map(c => c.type)).toContain('button');
      expect(configs.map(c => c.type)).toContain('ui:input');
    });
  });

  describe('Conflict Prevention', () => {
    it('should allow same type name in different namespaces', () => {
      const grid1 = () => 'grid-plugin-1';
      const grid2 = () => 'grid-plugin-2';
      
      registry.register('grid', grid1, { namespace: 'plugin-grid' });
      registry.register('grid', grid2, { namespace: 'plugin-view' });
      
      expect(registry.get('grid', 'plugin-grid')).toBe(grid1);
      expect(registry.get('grid', 'plugin-view')).toBe(grid2);
    });

    it('should handle complex namespace names', () => {
      const component = () => 'test';
      registry.register('table', component, { namespace: 'plugin-advanced-grid' });
      
      expect(registry.get('table', 'plugin-advanced-grid')).toBe(component);
      expect(registry.getConfig('table', 'plugin-advanced-grid')?.type).toBe('plugin-advanced-grid:table');
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain compatibility with existing non-namespaced code', () => {
      const component = () => 'test';
      
      // Old-style registration
      registry.register('button', component);
      
      // Old-style retrieval should still work
      expect(registry.get('button')).toBe(component);
      expect(registry.has('button')).toBe(true);
      expect(registry.getConfig('button')).toBeDefined();
    });

    it('should support mixed namespaced and non-namespaced registrations', () => {
      const oldButton = () => 'old';
      const newButton = () => 'new';
      
      registry.register('button-old', oldButton);
      registry.register('button-new', newButton, { namespace: 'ui' });
      
      expect(registry.get('button-old')).toBe(oldButton);
      expect(registry.get('button-new', 'ui')).toBe(newButton);
    });
    
    it('should allow non-namespaced lookup of namespaced components', () => {
      const component = () => 'test';
      
      // Register with namespace
      registry.register('button', component, { namespace: 'ui' });
      
      // Should be findable both ways for backward compatibility
      expect(registry.get('button')).toBe(component);
      expect(registry.get('button', 'ui')).toBe(component);
      
      // The full type should be namespaced
      const config = registry.getConfig('button');
      expect(config?.type).toBe('ui:button');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty namespace string', () => {
      const component = () => 'test';
      registry.register('button', component, { namespace: '' });
      
      // Empty namespace should be treated as no namespace
      expect(registry.get('button')).toBe(component);
    });

    it('should handle namespace with special characters', () => {
      const component = () => 'test';
      registry.register('button', component, { namespace: 'plugin-my-custom' });
      
      expect(registry.get('button', 'plugin-my-custom')).toBe(component);
    });

    it('should handle undefined meta', () => {
      const component = () => 'test';
      registry.register('button', component, undefined);
      
      expect(registry.get('button')).toBe(component);
    });
  });

  describe('skipFallback / bare-name collisions', () => {
    it('skipFallback prevents a namespaced registration from claiming the bare name', () => {
      const layout = () => 'layout-grid';
      const objectGrid = () => 'object-grid';
      // Layout component owns the bare `grid` key.
      registry.register('grid', layout, { namespace: 'layout' });
      // A view-namespaced alias registered WITHOUT skipFallback would clobber it;
      // WITH skipFallback it only registers `view:grid` and leaves bare `grid`.
      registry.register('grid', objectGrid, { namespace: 'view', skipFallback: true });

      expect(registry.get('grid')).toBe(layout);          // bare unchanged
      expect(registry.get('grid', 'view')).toBe(objectGrid); // namespaced still available
    });

    it('warns when a namespaced registration overwrites a DIFFERENT bare component', () => {
      const layout = () => 'layout-grid';
      const objectGrid = () => 'object-grid';
      registry.register('grid', layout, { namespace: 'layout' });
      registry.register('grid', objectGrid, { namespace: 'view' }); // no skipFallback → clobbers + warns

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(registry.get('grid')).toBe(objectGrid); // last-wins (documented behaviour)
    });

    it('does not warn when re-registering the same component under its namespace', () => {
      const same = () => 'same';
      registry.register('thing', same, { namespace: 'a' });
      consoleWarnSpy.mockClear();
      registry.register('thing', same, { namespace: 'a' });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  // Regression guard for the dev-console collision warnings. The real packages
  // register a form-input/display/view/plugin component under a bare name AND a
  // `field:`/`view:`/`plugin-markdown:` namespaced renderer that shares the same
  // short name. The bare key must stay with the DISPLAY/UI/view owner (forms
  // reach the field widget via the explicit `field:<type>` lookup), and no
  // collision warning must fire. Each case below mirrors the registration order
  // and skipFallback flags used by the shipping code.
  describe('bare-name ownership for field vs display/view/plugin collisions', () => {
    // [bareName, sequence in registration order]. The LAST entry whose
    // skipFallback is falsy owns the bare key; `owner` asserts the intended one.
    const CASES: Array<{
      name: string;
      owner: string; // namespace expected to own the bare key
      seq: Array<{ ns: string; skipFallback?: boolean }>;
    }> = [
      // @object-ui/components registers `ui:*` first (owns bare), then
      // @object-ui/fields registers `field:*` with skipFallback.
      { name: 'textarea', owner: 'ui', seq: [{ ns: 'ui' }, { ns: 'field', skipFallback: true }] },
      { name: 'select', owner: 'ui', seq: [{ ns: 'ui' }, { ns: 'field', skipFallback: true }] },
      { name: 'email', owner: 'ui', seq: [{ ns: 'ui' }, { ns: 'field', skipFallback: true }] },
      { name: 'password', owner: 'ui', seq: [{ ns: 'ui' }, { ns: 'field', skipFallback: true }] },
      { name: 'slider', owner: 'ui', seq: [{ ns: 'ui' }, { ns: 'field', skipFallback: true }] },
      // The bullet-list display primitive owns bare `list`; the data ListView is
      // a namespaced-only `view:list` alias.
      { name: 'list', owner: 'ui', seq: [{ ns: 'ui' }, { ns: 'view', skipFallback: true }] },
      // The markdown editor field registers first (skipFallback), then the
      // markdown DISPLAY plugin claims the bare key.
      { name: 'markdown', owner: 'plugin-markdown', seq: [{ ns: 'field', skipFallback: true }, { ns: 'plugin-markdown' }] },
    ];

    for (const { name, owner, seq } of CASES) {
      it(`bare "${name}" resolves to the "${owner}" owner with no collision warning`, () => {
        const components: Record<string, () => string> = {};
        for (const { ns, skipFallback } of seq) {
          const component = () => `${ns}:${name}`;
          components[ns] = component;
          registry.register(name, component, { namespace: ns, skipFallback });
        }

        // Bare key resolves to the intended display/view/plugin owner.
        expect(registry.get(name)).toBe(components[owner]);
        // Every namespaced renderer remains reachable via its explicit key —
        // this is the lookup forms use (`field:<type>`), so they are unaffected.
        for (const { ns } of seq) {
          expect(registry.get(name, ns)).toBe(components[ns]);
        }
        // No "bare-name fallback is being overwritten" warning.
        const collisionWarned = consoleWarnSpy.mock.calls.some((args: unknown[]) =>
          typeof args[0] === 'string' && args[0].includes('bare-name fallback is being overwritten'),
        );
        expect(collisionWarned).toBe(false);
      });
    }

    it('still warns if a field renderer drops skipFallback and clobbers the bare display key', () => {
      const display = () => 'ui:textarea';
      const field = () => 'field:textarea';
      registry.register('textarea', display, { namespace: 'ui' });
      // Simulate the bug this fix prevents: field:* without skipFallback.
      registry.register('textarea', field, { namespace: 'field' });
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(registry.get('textarea')).toBe(field); // bare clobbered (the regression)
    });
  });

  /**
   * CROSS-TABLE bare-name collisions (objectui#9821).
   *
   * The registry has two doors onto one bare key: `register` writes
   * `components`, `registerLazy` writes `lazyEntries`. Before this card only
   * `register` checked for a collision, and it read only its own table — so
   * the contest objectui#9533 filed, where a console stub claims bare
   * `dashboard` for `plugin-dashboard:dashboard` and the package then claims
   * the same bare key for `view:dashboard`, produced ZERO warnings. That zero
   * was measured against a real registry, in BOTH orders, before this fix.
   *
   * ⭐ Both orders are asserted deliberately, the discipline
   * `report-bare-key-ownership` / `timeline-bare-key-ownership` established: a
   * contest reported in only one registration order is a detector whose answer
   * depends on when it was asked, which is the defect, not the fix.
   */
  describe('cross-table bare-name collisions (objectui#9821)', () => {
    const loader = () => Promise.resolve();
    const collisionWarnings = () =>
      consoleWarnSpy.mock.calls
        .map((args: unknown[]) => (typeof args[0] === 'string' ? args[0] : ''))
        .filter((text: string) => text.includes('bare-name fallback is being overwritten'));

    it('warns when a LOADED registration takes a bare key a pending stub claims (the objectui#9533 order)', () => {
      // What the console actually does: stubs at boot, chunk later.
      registry.registerLazy('dashboard', loader, { namespace: 'plugin-dashboard' });
      consoleWarnSpy.mockClear();
      registry.register('dashboard', () => 'view', { namespace: 'view' });

      const warned = collisionWarnings();
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain('view:dashboard');
      expect(warned[0]).toContain('plugin-dashboard:dashboard');
      expect(warned[0]).toContain('pending lazy stub');
    });

    it('warns when a stub takes a bare key a LOADED registration claims (the reverse order)', () => {
      registry.register('dashboard', () => 'view', { namespace: 'view' });
      consoleWarnSpy.mockClear();
      registry.registerLazy('dashboard', loader, { namespace: 'plugin-dashboard' });

      const warned = collisionWarnings();
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain('Lazy component "dashboard"');
      expect(warned[0]).toContain('plugin-dashboard:dashboard');
      expect(warned[0]).toContain('view:dashboard');
    });

    it('warns when one stub takes a bare key another stub claims for a different full type', () => {
      registry.registerLazy('dashboard', loader, { namespace: 'plugin-dashboard' });
      consoleWarnSpy.mockClear();
      registry.registerLazy('dashboard', () => Promise.resolve(), { namespace: 'view' });

      const warned = collisionWarnings();
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain('another pending stub');
    });

    it('stays SILENT on the ordinary stub-then-real lifecycle, in both orders', () => {
      // 30 of this tree's 31 stub-claimed bare keys are exactly this shape: the
      // console declares `plugin-charts:chart` and the package registers the
      // same full type. A guard that fired here would fire at every boot.
      registry.registerLazy('chart', loader, { namespace: 'plugin-charts' });
      registry.register('chart', () => 'chart', { namespace: 'plugin-charts' });
      expect(collisionWarnings()).toHaveLength(0);

      const reverse = new Registry();
      reverse.register('chart', () => 'chart', { namespace: 'plugin-charts' });
      reverse.registerLazy('chart', loader, { namespace: 'plugin-charts' });
      expect(collisionWarnings()).toHaveLength(0);
    });

    it('stays SILENT when two files stub one full type with DIFFERENT loader closures', () => {
      // `preview-gallery.tsx` and `register-plugins.ts` drive the same plugin
      // set, so nine bare keys on this tree are stubbed twice with two distinct
      // arrow functions. This is why the predicate keys on the full type and
      // NOT on loader identity — the latter would warn on all nine, every boot.
      registry.registerLazy('metric', () => Promise.resolve(), { namespace: 'plugin-dashboard' });
      registry.registerLazy('metric', () => Promise.resolve(), { namespace: 'plugin-dashboard' });

      expect(collisionWarnings()).toHaveLength(0);
    });

    it('stays SILENT when the stub declines the bare key with skipFallback', () => {
      registry.register('dashboard', () => 'view', { namespace: 'view' });
      consoleWarnSpy.mockClear();
      registry.registerLazy('dashboard', loader, { namespace: 'plugin-dashboard', skipFallback: true });

      expect(collisionWarnings()).toHaveLength(0);
      expect(registry.hasLazy('dashboard', 'plugin-dashboard')).toBe(true);
      expect(registry.hasLazy('dashboard')).toBe(false); // bare key left alone
    });

    /**
     * ⭐ This pin was INVERTED by objectui#9839, and the inversion is the fix.
     *
     * It used to assert that the eager door left the bare key claimed by
     * NOBODY: `register` cleared the bare stub outside its
     * `namespace && !skipFallback` branch, so a registration that declined the
     * bare key deleted another declaration's stub anyway and then refused to
     * replace it. The comment it carried said so in as many words, which is
     * what made it a pin on a defect rather than a blessing of one.
     *
     * The clearing now sits inside that branch, under the same predicate that
     * takes the key, so declining the key declines the delete with it.
     */
    it('skipFallback on the EAGER door preserves the stub\'s bare claim', () => {
      registry.registerLazy('dashboard', loader, { namespace: 'plugin-dashboard' });
      expect(registry.hasLazy('dashboard')).toBe(true);

      registry.register('dashboard', () => 'view', { namespace: 'view', skipFallback: true });

      // The bare key is still the stub's: this registration declined to take
      // it, so it also declined to clear it. `view:dashboard` is reachable by
      // its full key only, which is the whole point of the opt-out.
      expect(registry.hasLazy('dashboard')).toBe(true);
      expect(registry.hasLazy('dashboard', 'plugin-dashboard')).toBe(true);
      expect(registry.get('dashboard', 'view')).toBeDefined();
      // ⛔ Not `toBeDefined()` on the bare read: the stub has not loaded, so
      // bare `dashboard` resolves to nothing YET — but it is spoken for, and
      // `hasLazy` above is what says by whom. Before the fix it was spoken for
      // by nobody at all, and those two states read identically through `get`.
      expect(registry.get('dashboard')).toBeUndefined();
    });

    /**
     * The opposite direction, which the repair must NOT disturb: a
     * registration that DOES claim the bare key still clears the stub under it.
     * Leaving that stub behind would be the converse defect — objectui#9533's
     * shape, a stub that outlives the registration that satisfied it.
     */
    it('a registration that DOES claim the bare key still clears the stub', () => {
      registry.registerLazy('dashboard', loader, { namespace: 'plugin-dashboard' });
      expect(registry.hasLazy('dashboard')).toBe(true);

      registry.register('dashboard', () => 'view', { namespace: 'view' });

      // The bare stub is gone because this registration took the bare key —
      // bare `dashboard` resolves to `view:dashboard` now, and a stub left
      // sitting under it would be unsatisfiable. (It warned on the way past;
      // that contest is the block above's subject, not this one's.)
      expect(registry.hasLazy('dashboard')).toBe(false);
      expect(registry.get('dashboard')).toBeDefined();
      // ⛔ `plugin-dashboard:dashboard` is a DIFFERENT key and this call never
      // addressed it — only the bare key was contested.
      expect(registry.hasLazy('dashboard', 'plugin-dashboard')).toBe(true);
    });

    it('the ordinary stub-then-real lifecycle still clears BOTH stub keys', () => {
      // The 30-of-31 shape: the stub and the registration that satisfies it
      // name one full type, so both the bare and the namespaced stub key are
      // this registration's to clear.
      registry.registerLazy('chart', loader, { namespace: 'plugin-charts' });
      expect(registry.hasLazy('chart')).toBe(true);
      expect(registry.hasLazy('chart', 'plugin-charts')).toBe(true);

      registry.register('chart', () => 'chart', { namespace: 'plugin-charts' });

      expect(registry.hasLazy('chart')).toBe(false);
      expect(registry.hasLazy('chart', 'plugin-charts')).toBe(false);
      expect(registry.get('chart')).toBeDefined();
    });

    it('a bare registration with no namespace still clears the bare stub', () => {
      // `fullType === type` here, so the unconditional delete below the branch
      // is the one that does it. A registration with no namespace claims the
      // bare key by definition, so it clears the bare key's stub.
      registry.registerLazy('dashboard', loader, { namespace: 'plugin-dashboard' });
      registry.register('dashboard', () => 'plain');

      expect(registry.hasLazy('dashboard')).toBe(false);
      expect(registry.get('dashboard')).toBeDefined();
    });

    it('each door prescribes the remedy that is true for it', () => {
      registry.register('dashboard', () => 'view', { namespace: 'view' });
      consoleWarnSpy.mockClear();
      registry.registerLazy('dashboard', loader, { namespace: 'plugin-dashboard' });
      expect(collisionWarnings()[0]).toMatch(/skipFallback: true/);

      const other = new Registry();
      consoleWarnSpy.mockClear();
      other.registerLazy('dashboard', loader, { namespace: 'plugin-dashboard' });
      other.register('dashboard', () => 'view', { namespace: 'view' });
      // ⛔ Not a wording preference, and the reason it now reads the same on
      // both doors is that the BEHAVIOUR converged (objectui#9839): the eager
      // door used to have to talk the author out of `skipFallback: true`,
      // because back then the opt-out left the bare key resolving to nothing.
      // The probe above is what says that is no longer so.
      expect(collisionWarnings()[0]).toMatch(/skipFallback: true/);
      expect(collisionWarnings()[0]).not.toMatch(/does not\s+settle/);
    });

    /**
     * ⭐ `unregister`'s docblock promised «the bare-name fallback (when the
     * fallback still points at this registration), plus any matching lazy
     * stub». objectui#9839 ruled «matching» against the code's own behaviour:
     * the components half of that same sentence is ownership-scoped, so the
     * stub half is too. Without this, the repair above would just move the
     * victim one function down — the same bare key, the same owner, taken by
     * the same caller.
     */
    it('unregister leaves a bare stub that belongs to a DIFFERENT full type', () => {
      registry.registerLazy('dashboard', loader, { namespace: 'plugin-dashboard' });
      registry.register('dashboard', () => 'view', { namespace: 'view', skipFallback: true });

      expect(registry.unregister('dashboard', 'view')).toBe(true);

      // `view:dashboard` is gone; the bare key is still the stub's.
      expect(registry.get('dashboard', 'view')).toBeUndefined();
      expect(registry.hasLazy('dashboard')).toBe(true);
      expect(registry.hasLazy('dashboard', 'plugin-dashboard')).toBe(true);
    });

    it('unregister still clears a bare stub that DOES belong to it', () => {
      registry.registerLazy('dashboard', loader, { namespace: 'plugin-dashboard' });
      registry.register('dashboard', () => 'dash', { namespace: 'plugin-dashboard' });

      expect(registry.unregister('dashboard', 'plugin-dashboard')).toBe(true);
      expect(registry.hasLazy('dashboard')).toBe(false);
      expect(registry.hasLazy('dashboard', 'plugin-dashboard')).toBe(false);
      expect(registry.get('dashboard')).toBeUndefined();
    });

    it('the BARE unregister form stays unconditional on both tables', () => {
      // Teardown sites pair `unregister(type, ns)` with `unregister(type)` to
      // force the bare key regardless of who holds it. That second call must
      // keep working, on `lazyEntries` as well as on `components`.
      registry.registerLazy('dashboard', loader, { namespace: 'plugin-dashboard' });
      registry.unregister('dashboard');

      expect(registry.hasLazy('dashboard')).toBe(false);
      // ⛔ Only the bare key: the namespaced stub is a different key and this
      // call never addressed it.
      expect(registry.hasLazy('dashboard', 'plugin-dashboard')).toBe(true);
    });
  });

  /**
   * A stub reached under its FULL key is named by that full type, once
   * (objectui#11680).
   *
   * `registerLazy` stores one entry under two keys, `namespace:type` and the
   * bare `type`. A registration whose bare key is itself colon-shaped can land
   * on the FULL one: the protocol placeholder for `view:calendar` claims the
   * bare key `view:calendar`, which is where the console's
   * `registerLazy('calendar', …, { namespace: 'view' })` stub lives. The guards
   * used to re-derive the stub's claim by prefixing its namespace onto the key
   * they looked it up under, which read `view:view:calendar` there, a type
   * nothing declares. The stub now records its full type when it is declared,
   * and each of the three readers below gets that one spelling.
   *
   * The registration shapes are written directly against a fresh registry, so
   * these pins reach the registry's own doors. `@object-ui/components`'
   * placeholder registrar no longer makes the first call at all while a stub is
   * pending; `placeholder-lazy-stub-ownership-11680.test.tsx` pins that half.
   */
  describe('a stub found under its FULL key names that full type once (objectui#11680)', () => {
    const loader = () => Promise.resolve();
    const collisionWarnings = () =>
      consoleWarnSpy.mock.calls
        .map((args: unknown[]) => (typeof args[0] === 'string' ? args[0] : ''))
        .filter((text: string) => text.includes('bare-name fallback is being overwritten'));
    /** The full type a collision warning says the key is already claimed for. */
    const claimantNamed = (text: string) => /already claims for "([^"]+)"/.exec(text)?.[1];

    beforeEach(() => {
      // The console's own declaration of the calendar view.
      registry.registerLazy('calendar', loader, { namespace: 'view', category: 'view' });
      consoleWarnSpy.mockClear();
    });

    it('the eager door names the stub by the full type it declared', () => {
      registry.register('view:calendar', () => 'placeholder', { namespace: 'protocol-placeholder' });

      const warned = collisionWarnings();
      expect(warned).toHaveLength(1);
      expect(claimantNamed(warned[0])).toBe('view:calendar');
      expect(warned[0]).not.toContain('view:view:');
    });

    it('the eager door still reports a registration whose own full type is the doubled spelling', () => {
      // `view:` written twice: the registration's full type is
      // `view:view:calendar`, exactly the doubled spelling. Compared against the
      // doubled claim, the guard read the stub as this registration's own and
      // said nothing while the bare `view:calendar` key changed hands.
      registry.register('view:calendar', () => 'twice', { namespace: 'view' });

      const warned = collisionWarnings();
      expect(warned).toHaveLength(1);
      expect(claimantNamed(warned[0])).toBe('view:calendar');
    });

    it('the lazy door names the prior stub by the full type it declared', () => {
      registry.registerLazy('view:calendar', () => Promise.resolve(), { namespace: 'protocol-placeholder' });

      const warned = collisionWarnings();
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain('another pending stub');
      expect(claimantNamed(warned[0])).toBe('view:calendar');
      expect(warned[0]).not.toContain('view:view:');
    });

    it('unregister of the doubled spelling leaves the stub it does not own', () => {
      // Nothing was ever registered as `view:view:calendar`. Read through the
      // doubled claim, the stub under bare `view:calendar` looked like that
      // registration's, and this call deleted the console's calendar stub.
      expect(registry.unregister('view:calendar', 'view')).toBe(false);

      expect(registry.hasLazy('calendar', 'view')).toBe(true);
      expect(registry.hasLazy('calendar')).toBe(true);
    });
  });
});
