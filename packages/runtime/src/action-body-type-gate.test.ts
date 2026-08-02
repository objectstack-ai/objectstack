// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4352] `action.body` binds a handler ONLY for `type: 'script'`.
 *
 * `ActionSchema.body` has always said "Only used when type is `script`", and
 * its JSDoc is more explicit still ("Only meaningful when `type === 'script'`").
 * The runtime read neither: `collectBundleActions` collected any named action
 * and `actionBodyRunnerFactory` bound a handler the moment `body` parsed. So a
 * `type: 'url'` action carrying a leftover body was registered in the action
 * registry and executed in the sandbox — the declared ≠ enforced shape of
 * Prime Directive #10, in its nastiest form: an author flips `type` away from
 * `script`, reasonably concludes the body is now dead, and it is not.
 *
 * The sibling tests in `sandbox/body-runner.test.ts` pin the factory in
 * isolation. THIS file pins the composition AppPlugin actually performs —
 * `collectBundleActions(bundle)` → `actionBodyRunnerFactory(...)` → skip when
 * no handler → `ql.registerAction(...)` — because that loop is where the
 * registration decision is really made, and a factory that returns `undefined`
 * only matters if the loop honours it (it does: `if (!handler) continue`).
 *
 * The bind loop is replicated rather than driven through a booted AppPlugin on
 * purpose: booting one needs a kernel, an ObjectQL engine and a QuickJS
 * sandbox, none of which participate in the decision under test. The
 * replication is kept honest by asserting the collector's own output too, so a
 * change to how actions are collected still surfaces here.
 */

import { describe, it, expect } from 'vitest';
import { collectBundleActions } from './app-plugin.js';
import { actionBodyRunnerFactory } from './sandbox/body-runner.js';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';

const jsBody = { language: 'js', source: 'return { ran: true };', capabilities: [] } as const;

/** The exact registration loop from `AppPlugin.bindDeclarativeActions`. */
function bindActions(bundle: unknown, logger?: { warn: (msg: string) => void }) {
  const registered: Array<{ object: string; name: string }> = [];
  const actions = collectBundleActions(bundle);
  const runner = actionBodyRunnerFactory(new QuickJSScriptRunner(), {
    ql: {},
    appId: 'crm',
    logger,
  });
  for (const action of actions) {
    const handler = runner(action);
    if (!handler) continue;
    registered.push({ object: action.object ?? 'global', name: action.name });
  }
  return { collected: actions, registered };
}

describe('#4352 — a non-script action with a body binds no handler', () => {
  it("registers the script action and skips the `type: 'url'` one", () => {
    const warnings: string[] = [];
    const { collected, registered } = bindActions(
      {
        actions: [
          // The regression population: an explicit non-script type + a body.
          { name: 'open_docs', label: 'Docs', type: 'url', target: 'https://x', body: jsBody },
          // The overwhelmingly common case — unchanged.
          { name: 'close_deal', label: 'Close', type: 'script', object: 'crm_deal', body: jsBody },
        ],
      },
      { warn: (msg: string) => warnings.push(msg) },
    );

    // The collector stays type-blind by design — it feeds governance surfaces
    // that must see every declared action, bound or not.
    expect(collected.map((a) => a.name)).toEqual(['open_docs', 'close_deal']);

    // ...but only the script action becomes an executable handler.
    expect(registered).toEqual([{ object: 'crm_deal', name: 'close_deal' }]);

    // And the refusal is audible: silence here would just move the invisibility.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('open_docs');
    expect(warnings[0]).toContain("type: 'url'");
  });

  it('skips a non-script body declared under an object', () => {
    const { registered } = bindActions({
      objects: [
        {
          name: 'crm_lead',
          actions: [
            { name: 'open_portal', label: 'Portal', type: 'url', target: '/p', body: jsBody },
            { name: 'score_lead', label: 'Score', type: 'script', body: jsBody },
          ],
        },
      ],
    });
    expect(registered).toEqual([{ object: 'crm_lead', name: 'score_lead' }]);
  });

  it('binds an action that omits `type` — `ActionType.default(\'script\')`', () => {
    // Bundles reach the collector RAW. A `strict: false` `defineStack` and a
    // legacy `manifest.actions[]` never pass through `ActionSchema`, so the
    // schema's default has to be applied here or the common shape breaks.
    const { registered } = bindActions({
      manifest: { actions: [{ name: 'legacy_untyped', label: 'Legacy', body: jsBody }] },
    });
    expect(registered).toEqual([{ object: 'global', name: 'legacy_untyped' }]);
  });

  it('leaves bodyless non-script actions exactly as they were', () => {
    const warnings: string[] = [];
    const { collected, registered } = bindActions(
      {
        actions: [
          { name: 'open_docs', label: 'Docs', type: 'url', target: 'https://x' },
          { name: 'convert', label: 'Convert', type: 'flow', target: 'crm_convert' },
        ],
      },
      { warn: (msg: string) => warnings.push(msg) },
    );
    expect(collected).toHaveLength(2);
    // They never bound a handler before this change either — nothing to warn about.
    expect(registered).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
