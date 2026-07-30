// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework#4095 — a config-booted app lost its `onEnable`, so every `script`
 * action was declared and none was executable.
 *
 * `os serve <config>` calls `createStandaloneStack()`, which reads
 * `dist/objectstack.json` and returns a ready-made `AppPlugin`. That tripped
 * serve's "does the host already wrap itself?" guard, so the
 * `new AppPlugin(config)` built from the loaded MODULE — the only one carrying
 * the module's `onEnable` — never ran. A JSON artifact cannot hold a function,
 * so `examples/app-todo` booted with eight action declarations and zero
 * handlers and every button answered `404 Action 'complete_task' on object
 * 'todo_task' not found`.
 *
 * These pin the graft that repairs it, and — just as important — the cases where
 * it must REFUSE, since attaching one app's handlers to another app's bundle
 * would be worse than the bug.
 */

import { describe, it, expect } from 'vitest';
import {
  GRAFTABLE_RUNTIME_MEMBERS,
  graftAuthoredRuntimeMembers,
  isAppPluginLike,
} from './graft-runtime-hooks.js';

/** An AppPlugin as `createStandaloneStack()` builds it: artifact metadata, no code. */
const artifactApp = (id: string, extra: Record<string, unknown> = {}) => ({
  name: `plugin.app.${id}`,
  type: 'app',
  bundle: {
    manifest: { id },
    objects: [{ name: 'x_task' }],
    actions: [{ name: 'do_thing', type: 'script', target: 'doThing' }],
    ...extra,
  },
});

/** The authored module as serve assembles it — metadata PLUS the code half. */
const authoredConfig = (id: string, extra: Record<string, unknown> = {}) => ({
  manifest: { id },
  objects: [{ name: 'x_task' }],
  onEnable: async () => {},
  ...extra,
});

describe('isAppPluginLike', () => {
  it('recognises every shape serve\'s own guard recognised', () => {
    // Must stay in lockstep with the guard that decides to SKIP the wrap, or the
    // skip and the graft that compensates for it disagree.
    expect(isAppPluginLike({ type: 'app' })).toBe(true);
    expect(isAppPluginLike({ name: 'plugin.app.com.example.todo' })).toBe(true);
    class AppPlugin { }
    expect(isAppPluginLike(new AppPlugin())).toBe(true);
  });

  it('is not fooled by ordinary plugins or non-objects', () => {
    expect(isAppPluginLike({ name: 'com.objectstack.metadata' })).toBe(false);
    expect(isAppPluginLike({ name: 'com.objectstack.engine.objectql' })).toBe(false);
    expect(isAppPluginLike({ type: 'service' })).toBe(false);
    expect(isAppPluginLike(null)).toBe(false);
    expect(isAppPluginLike(undefined)).toBe(false);
    expect(isAppPluginLike('plugin.app.x')).toBe(false);
  });
});

describe('graftAuthoredRuntimeMembers', () => {
  it('moves onEnable onto the artifact-derived bundle — the #4095 repair', () => {
    const app = artifactApp('com.example.todo');
    const config = authoredConfig('com.example.todo');
    const result = graftAuthoredRuntimeMembers([{ name: 'com.objectstack.metadata' }, app], config);

    expect(result.grafted).toEqual(['onEnable']);
    expect(result.orphaned).toEqual([]);
    expect(result.appId).toBe('com.example.todo');
    // The load-bearing assertion: AppPlugin reads this at start().
    expect(typeof (app.bundle as any).onEnable).toBe('function');
    expect((app.bundle as any).onEnable).toBe(config.onEnable);
  });

  it('moves the `functions` map too — string-named hook/job handlers are code as well', () => {
    const app = artifactApp('com.example.todo');
    const config = authoredConfig('com.example.todo', { functions: { doThing: () => 1 } });
    const result = graftAuthoredRuntimeMembers([app], config);

    expect(result.grafted).toEqual(['onEnable', 'functions']);
    expect(typeof (app.bundle as any).functions.doThing).toBe('function');
  });

  it('grafts nothing the artifact never lost', () => {
    // Only executable members travel. Metadata is the artifact's job, and the
    // artifact is the richer source (it carries compile-time docs the config
    // never has), so nothing else may be copied over it.
    const app = artifactApp('com.example.todo', { docs: [{ name: 'readme' }] });
    const config = authoredConfig('com.example.todo', { objects: [{ name: 'DIFFERENT' }] });
    graftAuthoredRuntimeMembers([app], config);

    expect((app.bundle as any).objects).toEqual([{ name: 'x_task' }]);
    expect((app.bundle as any).docs).toEqual([{ name: 'readme' }]);
  });

  it('never overwrites a hook the bundle already has', () => {
    // A host that wrapped itself on purpose already decided what runs.
    const own = async () => {};
    const app = artifactApp('com.example.todo', { onEnable: own });
    const result = graftAuthoredRuntimeMembers([app], authoredConfig('com.example.todo'));

    expect(result.grafted).toEqual([]);
    expect(result.reason).toBe('already-present');
    expect((app.bundle as any).onEnable).toBe(own);
  });

  it('matches by manifest.id, so one app never gets another app\'s handlers', () => {
    const todo = artifactApp('com.example.todo');
    const crm = artifactApp('com.example.crm');
    const result = graftAuthoredRuntimeMembers([todo, crm], authoredConfig('com.example.crm'));

    expect(result.grafted).toEqual(['onEnable']);
    expect(result.appId).toBe('com.example.crm');
    expect((crm.bundle as any).onEnable).toBeTypeOf('function');
    expect((todo.bundle as any).onEnable).toBeUndefined();
  });

  it('refuses rather than guess when the authored id matches nothing', () => {
    // Grafting onto "the only candidate" here would wire the wrong app.
    const other = artifactApp('com.example.other');
    const result = graftAuthoredRuntimeMembers([other], authoredConfig('com.example.todo'));

    expect(result.grafted).toEqual([]);
    expect(result.orphaned).toEqual(['onEnable']);
    expect(result.reason).toBe('no-app-plugin');
    expect((other.bundle as any).onEnable).toBeUndefined();
  });

  it('falls back to the single app bundle when the config declares no manifest id', () => {
    const app = artifactApp('com.example.todo');
    const result = graftAuthoredRuntimeMembers([app], { objects: [], onEnable: async () => {} });
    expect(result.grafted).toEqual(['onEnable']);
  });

  it('refuses when there is no id AND several candidates', () => {
    const result = graftAuthoredRuntimeMembers(
      [artifactApp('com.example.todo'), artifactApp('com.example.crm')],
      { objects: [], onEnable: async () => {} },
    );
    expect(result.grafted).toEqual([]);
    expect(result.orphaned).toEqual(['onEnable']);
    expect(result.reason).toBe('ambiguous-app-plugin');
  });

  it('reports orphaned code when no app bundle is registered at all', () => {
    // The silent-drop case that hid #4095 — the caller has to be able to shout.
    const result = graftAuthoredRuntimeMembers(
      [{ name: 'com.objectstack.metadata' }],
      authoredConfig('com.example.todo'),
    );
    expect(result.orphaned).toEqual(['onEnable']);
    expect(result.reason).toBe('no-app-plugin');
  });

  it('stays quiet for a config that carries no code', () => {
    const app = artifactApp('com.example.todo');
    const result = graftAuthoredRuntimeMembers([app], { manifest: { id: 'com.example.todo' } });
    expect(result).toEqual({ grafted: [], orphaned: [], reason: 'no-authored-members' });
  });

  it('tolerates the degenerate inputs a boot can hand it', () => {
    for (const plugins of [undefined, [], [null], [undefined]]) {
      expect(() => graftAuthoredRuntimeMembers(plugins as any, authoredConfig('x'))).not.toThrow();
    }
    for (const authored of [undefined, null, 'nope', 42, {}]) {
      expect(graftAuthoredRuntimeMembers([artifactApp('x')], authored).grafted).toEqual([]);
    }
    // An app plugin with no bundle at all must not throw.
    expect(
      graftAuthoredRuntimeMembers([{ type: 'app' }], authoredConfig('x')).reason,
    ).toBe('no-app-plugin');
  });

  it('grafts only members AppPlugin actually executes', () => {
    // `onDisable` is declared in packages/spec but called by no kernel, runtime
    // or service — grafting it would wire a hook nothing runs.
    expect([...GRAFTABLE_RUNTIME_MEMBERS]).toEqual(['onEnable', 'functions']);

    const app = artifactApp('com.example.todo');
    graftAuthoredRuntimeMembers([app], authoredConfig('com.example.todo', {
      onDisable: async () => {},
    }));
    expect((app.bundle as any).onDisable).toBeUndefined();
  });
});
