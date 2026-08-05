// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4792 — an embedded host that never seals the vocabulary must be TOLD, not
 * left silent.
 *
 * #4771 moved the ADR-0018 §M1 node-type check out of `registerFlow` and into
 * `sealNodeTypeVocabulary()`. `AutomationServicePlugin` calls it at
 * `kernel:bootstrapped`, so plugin-hosted deployments are covered — but a host
 * that builds `new AutomationEngine()` itself and never calls seal lost the
 * check entirely, with no signal. Those hosts control their own ordering, so
 * the pre-#4771 verdict was *accurate* for them: the fix swapped an unreliable
 * warning for no warning at all, recoverable only by reading a changeset.
 *
 * Two halves, and the second is as load-bearing as the first:
 *
 *   1. the omission is now loud, once per engine instance;
 *   2. the paths that did nothing wrong — the plugin boot, and a host that
 *      calls seal itself — gain no log line at all, which is the only thing
 *      keeping this warning from becoming the noise #4771 deleted.
 *
 * Reverse-verified while writing: temporarily inverting the guard in
 * `warnIfNodeTypeVocabularyNeverSealed()` (warn when the vocabulary IS sealed)
 * turns the two sentinels below red and the embedded-host cases green-for-the-
 * wrong-reason, so the sentinels really do guard the seal, not just the string.
 */

import { describe, it, expect, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { AutomationEngine } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';

/** Substring that identifies the #4792 line, wherever logs are captured. */
const OMISSION_MARKER = 'node-type vocabulary was never sealed';

/** A flow that needs no plugin-contributed executor: structural nodes only. */
const trivialFlow = (name: string) => ({
    name,
    label: name,
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

/** A flow whose only real node type nothing registers (the #4771 subject). */
const approvalFlow = (name: string) => ({
    name,
    label: name,
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'signoff', type: 'approval', label: 'Sign-off', config: { approvers: [{ type: 'user', value: 'u1' }] } },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'signoff' },
        { id: 'e2', source: 'signoff', target: 'end' },
    ],
});

function loggerCapturing(lines: string[]) {
    const l: any = {
        info: (m: string) => lines.push(`info ${m}`),
        debug: () => {},
        error: (m: string) => lines.push(`error ${m}`),
        warn: (m: string) => lines.push(`warn ${m}`),
        child: () => l,
    };
    return l;
}

const omissionLines = (lines: string[]) => lines.filter((l) => l.includes(OMISSION_MARKER));

/**
 * Minimal `objectql` stand-in exposing the one seam the boot flow-pull reads,
 * mirroring `flow-node-type-audit.test.ts` — this is how a flow gets registered
 * during `AutomationServicePlugin.start()`, i.e. on the real plugin path.
 */
function fakeObjectqlPlugin(flows: unknown[]): Plugin {
    return {
        name: 'fake-objectql',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            (ctx as unknown as { registerService(n: string, s: unknown): void }).registerService('objectql', {
                registry: {
                    listItems: (type: string) => (type === 'flow' ? flows : []),
                    getObject: () => undefined,
                },
            });
        },
    };
}

const sealedState = (engine: AutomationEngine) =>
    (engine as unknown as { nodeTypeVocabularySealed: boolean }).nodeTypeVocabularySealed;

describe('#4792 — a never-sealed node-type vocabulary announces itself at the first execution', () => {
    it('warns on the first execute() of an embedded host that never sealed', async () => {
        const lines: string[] = [];
        const engine = new AutomationEngine(loggerCapturing(lines));
        // The embedded shape: register the executors, register the flows, run —
        // and never call sealNodeTypeVocabulary(), because no plugin does it here.
        engine.registerFlow('embedded_flow', trivialFlow('embedded_flow'));
        expect(omissionLines(lines), 'registration alone must stay quiet').toEqual([]);

        const result = await engine.execute('embedded_flow');
        expect(result.success).toBe(true);

        const warned = omissionLines(lines);
        expect(warned).toHaveLength(1);
        // The line owes both halves AGENTS.md asks a degradation for: what was
        // lost, and the call that restores it.
        expect(warned[0]).toMatch(/^warn /);
        expect(warned[0]).toContain('sealNodeTypeVocabulary()');
        expect(warned[0]).toContain('NO_EXECUTOR');
        expect(warned[0]).toContain('kernel:bootstrapped');
    });

    it('says it ONCE per engine — and every engine instance speaks for itself', async () => {
        const lines: string[] = [];
        const engine = new AutomationEngine(loggerCapturing(lines));
        engine.registerFlow('a', trivialFlow('a'));
        engine.registerFlow('b', trivialFlow('b'));

        await engine.execute('a');
        await engine.execute('a');
        await engine.execute('b');
        expect(omissionLines(lines), 'one line per engine, not one per run').toHaveLength(1);

        // Dedupe is per instance, not per process/module: a host that builds one
        // engine per tenant forgot the call on each of them, and a module-level
        // flag would report only whichever engine happened to run first.
        const otherLines: string[] = [];
        const other = new AutomationEngine(loggerCapturing(otherLines));
        other.registerFlow('a', trivialFlow('a'));
        await other.execute('a');
        expect(omissionLines(otherLines)).toHaveLength(1);
    });

    it('does not fire for an unknown or disabled flow name — the trigger is a real run', async () => {
        const lines: string[] = [];
        const engine = new AutomationEngine(loggerCapturing(lines));
        engine.registerFlow('off', trivialFlow('off'));
        await engine.toggleFlow('off', false);

        expect((await engine.execute('never_registered')).success).toBe(false);
        expect((await engine.execute('off')).success).toBe(false);
        // Both already answer loudly on their own; the omission is reported when
        // an execution actually starts, which is the moment the issue argues is
        // both safe and certain to be reached.
        expect(omissionLines(lines)).toEqual([]);
    });

    it('warns but does NOT seal — the host keeps authority over closing the vocabulary', async () => {
        const lines: string[] = [];
        const engine = new AutomationEngine(loggerCapturing(lines));
        engine.registerFlow('embedded_flow', trivialFlow('embedded_flow'));
        await engine.execute('embedded_flow');
        expect(omissionLines(lines)).toHaveLength(1);

        // Auto-sealing here would put two answers behind "who decides the
        // vocabulary is closed", and the second one would not be harmless: after
        // a seal `registerFlow` validates inline, so a host that registers a
        // plugin's executors AFTER its first run — legal, ADR-0018 keeps the
        // vocabulary open — would start getting the false "will fail at
        // execution time" assertions #4771 exists to delete.
        expect(sealedState(engine)).toBe(false);
        engine.registerFlow('later', approvalFlow('later'));
        expect(lines.filter((l) => l.includes('no registered executor or descriptor'))).toEqual([]);

        // …and the host's own seal still works, and still reports the finding.
        const audit = engine.sealNodeTypeVocabulary();
        expect(audit.map((e) => e.flowName)).toEqual(['later']);
        expect(lines.filter((l) => l.includes('no registered executor or descriptor'))).toHaveLength(1);
    });

    it('SENTINEL — a host that called seal itself gets no extra line', async () => {
        const lines: string[] = [];
        const engine = new AutomationEngine(loggerCapturing(lines));
        engine.registerFlow('embedded_flow', trivialFlow('embedded_flow'));
        expect(engine.sealNodeTypeVocabulary()).toEqual([]);

        const before = [...lines];
        expect((await engine.execute('embedded_flow')).success).toBe(true);

        expect(omissionLines(lines)).toEqual([]);
        // Nothing at warn/error was added by the run at all — the new code is
        // reachable here (execute ran) and stayed silent because the host did
        // its part, not because the path was skipped.
        expect(sealedState(engine)).toBe(true);
        const added = lines.slice(before.length).filter((l) => l.startsWith('warn ') || l.startsWith('error '));
        expect(added).toEqual([]);
    });

    it('SENTINEL — the AutomationServicePlugin path is untouched: sealed at boot, no new log', async () => {
        // `kernel:bootstrapped` fires strictly after every plugin's start() and
        // every kernel:ready handler, so any execute() is necessarily after the
        // seal and this warning can never reach the normal deployment.
        const stdout: string[] = [];
        const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
            stdout.push(String(chunk));
            return true;
        }) as never);
        const kernel = new LiteKernel();
        kernel.use(fakeObjectqlPlugin([trivialFlow('plugin_flow')]));
        kernel.use(new AutomationServicePlugin());
        try {
            await kernel.bootstrap();
            const engine = kernel.getService<AutomationEngine>('automation');
            expect(sealedState(engine), 'the plugin seals at kernel:bootstrapped').toBe(true);

            const bootLines = stdout.length;
            expect((await engine.execute('plugin_flow')).success).toBe(true);

            expect(omissionLines(stdout)).toEqual([]);
            expect(stdout.slice(bootLines).join('')).not.toContain('sealNodeTypeVocabulary');
        } finally {
            spy.mockRestore();
            await kernel.shutdown();
        }
    });
});
