// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    ServeRestartCoordinator,
    type ServeChildLike,
    assessArtifactStaleness,
    formatMtimeGap,
    isDevWatchIgnored,
} from './dev-restart.js';

// ────────────────────────────────────────────────────────────────────────────
// assessArtifactStaleness — the #5148 startup variant: booting on an artifact
// older than the sources must be detectable (loudly warned by dev.ts), and a
// current artifact must produce NO report.
// ────────────────────────────────────────────────────────────────────────────

describe('assessArtifactStaleness', () => {
    const tmpDirs: string[] = [];
    const mkProject = () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-dev-stale-'));
        tmpDirs.push(dir);
        const configPath = path.join(dir, 'objectstack.config.ts');
        const srcDir = path.join(dir, 'src');
        const artifactPath = path.join(dir, 'dist', 'objectstack.json');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
        fs.writeFileSync(configPath, '// config');
        return { dir, configPath, srcDir, artifactPath };
    };
    const touch = (p: string, epochSec: number) => {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        if (!fs.existsSync(p)) fs.writeFileSync(p, '// x');
        fs.utimesSync(p, epochSec, epochSec);
    };
    afterEach(() => {
        for (const d of tmpDirs.splice(0)) {
            try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
        }
    });

    const T = 1_700_000_000; // arbitrary fixed epoch base (seconds)

    it('returns null when the artifact is missing (dev compiles it fresh)', () => {
        const p = mkProject();
        touch(p.configPath, T + 100);
        expect(
            assessArtifactStaleness({ artifactPath: p.artifactPath, configPath: p.configPath, srcDir: p.srcDir }),
        ).toBeNull();
    });

    it('returns null when the artifact is newer than every source', () => {
        const p = mkProject();
        touch(p.configPath, T);
        touch(path.join(p.srcDir, 'views', 'a.view.ts'), T + 10);
        touch(p.artifactPath, T + 100);
        expect(
            assessArtifactStaleness({ artifactPath: p.artifactPath, configPath: p.configPath, srcDir: p.srcDir }),
        ).toBeNull();
    });

    it('reports the config file when it is newer than the artifact', () => {
        const p = mkProject();
        touch(p.artifactPath, T);
        touch(p.configPath, T + 60);
        const report = assessArtifactStaleness({
            artifactPath: p.artifactPath, configPath: p.configPath, srcDir: p.srcDir,
        });
        expect(report).not.toBeNull();
        expect(report!.newestSourcePath).toBe(p.configPath);
        expect(report!.newestSourceMtimeMs).toBeGreaterThan(report!.artifactMtimeMs);
    });

    it('reports a nested src file when it is the newest source', () => {
        const p = mkProject();
        touch(p.configPath, T);
        touch(p.artifactPath, T + 50);
        const hook = path.join(p.srcDir, 'hooks', 'rating.hook.ts');
        touch(hook, T + 120);
        const report = assessArtifactStaleness({
            artifactPath: p.artifactPath, configPath: p.configPath, srcDir: p.srcDir,
        });
        expect(report?.newestSourcePath).toBe(hook);
    });

    it('ignores the same paths the watcher ignores (node_modules, tests, dist)', () => {
        const p = mkProject();
        touch(p.configPath, T);
        touch(p.artifactPath, T + 50);
        // All newer than the artifact, all outside the watched surface:
        touch(path.join(p.srcDir, 'node_modules', 'dep', 'index.ts'), T + 500);
        touch(path.join(p.srcDir, 'views', 'a.view.test.ts'), T + 500);
        touch(path.join(p.srcDir, 'dist', 'out.ts'), T + 500);
        expect(
            assessArtifactStaleness({ artifactPath: p.artifactPath, configPath: p.configPath, srcDir: p.srcDir }),
        ).toBeNull();
    });

    it('works without a src dir (config-only project)', () => {
        const p = mkProject();
        fs.rmSync(p.srcDir, { recursive: true, force: true });
        touch(p.artifactPath, T);
        touch(p.configPath, T + 60);
        const report = assessArtifactStaleness({
            artifactPath: p.artifactPath, configPath: p.configPath, srcDir: p.srcDir,
        });
        expect(report?.newestSourcePath).toBe(p.configPath);
    });
});

describe('isDevWatchIgnored', () => {
    it('matches the watcher ignore surface', () => {
        expect(isDevWatchIgnored('/proj/src/node_modules/x.ts')).toBe(true);
        expect(isDevWatchIgnored('/proj/src/a.view.test.ts')).toBe(true);
        expect(isDevWatchIgnored('/proj/dist/objectstack.json')).toBe(true);
        expect(isDevWatchIgnored('/proj/.objectstack/data/dev.db')).toBe(true);
        expect(isDevWatchIgnored('/proj/src/views/a.view.ts')).toBe(false);
        expect(isDevWatchIgnored('/proj/objectstack.config.ts')).toBe(false);
        // \bdist\b must not swallow lookalike segments:
        expect(isDevWatchIgnored('/proj/src/distribution/a.ts')).toBe(false);
    });
});

describe('formatMtimeGap', () => {
    it('renders humane gap sizes', () => {
        expect(formatMtimeGap(500)).toBe('1s');
        expect(formatMtimeGap(42_000)).toBe('42s');
        expect(formatMtimeGap(3 * 60_000)).toBe('3m');
        expect(formatMtimeGap(5 * 3_600_000)).toBe('5h');
        expect(formatMtimeGap(3 * 86_400_000)).toBe('3d');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// ServeRestartCoordinator — the restart decision seam.
// ────────────────────────────────────────────────────────────────────────────

class FakeChild implements ServeChildLike {
    pid = 4242;
    signals: (NodeJS.Signals | undefined)[] = [];
    private exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
    kill(signal?: NodeJS.Signals): boolean {
        this.signals.push(signal);
        return true;
    }
    once(_event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this {
        this.exitListeners.push(listener);
        return this;
    }
    emitExit(code: number | null, signal: NodeJS.Signals | null = null): void {
        for (const l of this.exitListeners.splice(0)) l(code, signal);
    }
}

function makeHarness(opts: { forceKillAfterMs?: number; failSpawnAt?: number } = {}) {
    const children: FakeChild[] = [];
    const spawnInfos: Array<{ restartIndex: number }> = [];
    const exits: number[] = [];
    const logs: string[] = [];
    const coordinator = new ServeRestartCoordinator({
        spawnChild: (info) => {
            spawnInfos.push(info);
            if (opts.failSpawnAt !== undefined && spawnInfos.length - 1 === opts.failSpawnAt) {
                throw new Error('spawn boom');
            }
            const c = new FakeChild();
            children.push(c);
            return c;
        },
        exitParent: (code) => { exits.push(code); },
        log: (line) => { logs.push(line); },
        forceKillAfterMs: opts.forceKillAfterMs,
    });
    return { coordinator, children, spawnInfos, exits, logs };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ServeRestartCoordinator', () => {
    it('start() boots exactly one child with restartIndex 0', () => {
        const h = makeHarness();
        h.coordinator.start();
        h.coordinator.start(); // idempotent
        expect(h.children).toHaveLength(1);
        expect(h.spawnInfos).toEqual([{ restartIndex: 0 }]);
        expect(h.coordinator.getState()).toBe('running');
    });

    it('requestRestart: SIGTERMs the child, then spawns a replacement on exit', () => {
        const h = makeHarness();
        h.coordinator.start();
        h.coordinator.requestRestart('src/a.view.ts');
        expect(h.children[0].signals).toEqual(['SIGTERM']);
        expect(h.coordinator.getState()).toBe('stopping');
        h.children[0].emitExit(0);
        expect(h.children).toHaveLength(2);
        expect(h.spawnInfos[1]).toEqual({ restartIndex: 1 });
        expect(h.coordinator.getState()).toBe('running');
        expect(h.exits).toEqual([]); // the parent survives a restart
    });

    it('coalesces restart requests that arrive while a restart is tearing down', () => {
        const h = makeHarness();
        h.coordinator.start();
        h.coordinator.requestRestart('first');
        h.coordinator.requestRestart('second'); // absorbed — pending boot reads newest artifact
        h.coordinator.requestRestart('third');  // absorbed
        expect(h.children[0].signals).toEqual(['SIGTERM']); // exactly one kill
        h.children[0].emitExit(0);
        expect(h.children).toHaveLength(2); // exactly one replacement
    });

    it('a rebuild landing while the replacement runs triggers a fresh restart cycle', () => {
        const h = makeHarness();
        h.coordinator.start();
        h.coordinator.requestRestart('a');
        h.children[0].emitExit(0);
        h.coordinator.requestRestart('b'); // replacement is 'running' again
        expect(h.children[1].signals).toEqual(['SIGTERM']);
        h.children[1].emitExit(0);
        expect(h.children).toHaveLength(3);
        expect(h.exits).toEqual([]);
    });

    it('a child exit the coordinator did not initiate exits the parent with code ?? 0', () => {
        const h = makeHarness();
        h.coordinator.start();
        h.children[0].emitExit(7);
        expect(h.exits).toEqual([7]);
        expect(h.children).toHaveLength(1); // no respawn
        // signal-killed child (code null) keeps the pre-#5148 `code ?? 0` contract:
        const h2 = makeHarness();
        h2.coordinator.start();
        h2.children[0].emitExit(null, 'SIGKILL');
        expect(h2.exits).toEqual([0]);
    });

    it('is loud when a restarted child dies on its own', () => {
        const h = makeHarness();
        h.coordinator.start();
        h.coordinator.requestRestart('a');
        h.children[0].emitExit(0);
        h.children[1].emitExit(1); // the restarted child crashed (e.g. bad new build at boot)
        expect(h.exits).toEqual([1]);
        expect(h.logs.some((l) => l.includes('server exited'))).toBe(true);
    });

    it('beginShutdown forwards the signal and the child exit then ends the parent — no respawn', () => {
        const h = makeHarness();
        h.coordinator.start();
        h.coordinator.beginShutdown('SIGTERM');
        expect(h.children[0].signals).toEqual(['SIGTERM']);
        h.children[0].emitExit(0);
        expect(h.exits).toEqual([0]);
        expect(h.children).toHaveLength(1);
        // and restart requests after shutdown are ignored:
        h.coordinator.requestRestart('late');
        expect(h.children).toHaveLength(1);
        expect(h.children[0].signals).toEqual(['SIGTERM']);
    });

    it('shutdown during a restart teardown wins over the respawn', () => {
        const h = makeHarness();
        h.coordinator.start();
        h.coordinator.requestRestart('a');
        h.coordinator.beginShutdown('SIGINT');
        h.children[0].emitExit(0);
        expect(h.children).toHaveLength(1); // no replacement spawned
        expect(h.exits).toEqual([0]);
    });

    it('requestRestart before start() is a no-op (first boot reads the fresh artifact)', () => {
        const h = makeHarness();
        h.coordinator.requestRestart('early');
        expect(h.children).toHaveLength(0);
        h.coordinator.start();
        expect(h.children).toHaveLength(1);
    });

    it('escalates to SIGKILL when the child ignores SIGTERM, then still respawns', async () => {
        const h = makeHarness({ forceKillAfterMs: 20 });
        h.coordinator.start();
        h.coordinator.requestRestart('a');
        expect(h.children[0].signals).toEqual(['SIGTERM']);
        await sleep(60);
        expect(h.children[0].signals).toEqual(['SIGTERM', 'SIGKILL']);
        expect(h.logs.some((l) => l.includes('force-killing'))).toBe(true);
        h.children[0].emitExit(null, 'SIGKILL');
        expect(h.children).toHaveLength(2); // replacement still comes up
        expect(h.exits).toEqual([]);
    });

    it('does not force-kill a child that exited in time', async () => {
        const h = makeHarness({ forceKillAfterMs: 20 });
        h.coordinator.start();
        h.coordinator.requestRestart('a');
        h.children[0].emitExit(0); // graceful, well inside the window
        await sleep(60);
        expect(h.children[0].signals).toEqual(['SIGTERM']); // no SIGKILL
    });

    it('a failed respawn is loud and exits the parent', () => {
        const h = makeHarness({ failSpawnAt: 1 });
        h.coordinator.start();
        h.coordinator.requestRestart('a');
        h.children[0].emitExit(0);
        expect(h.exits).toEqual([1]);
        expect(h.logs.some((l) => l.includes('failed to restart server'))).toBe(true);
    });

    it('killChildOnParentExit SIGTERMs a live child and is a no-op after exit', () => {
        const h = makeHarness();
        h.coordinator.start();
        h.coordinator.killChildOnParentExit();
        expect(h.children[0].signals).toEqual(['SIGTERM']);
        h.children[0].emitExit(0); // (counts as self-exit → parent exit recorded)
        h.coordinator.killChildOnParentExit();
        expect(h.children[0].signals).toEqual(['SIGTERM']); // no second signal
    });

    it('ignores a late exit event from an already-replaced child', () => {
        const h = makeHarness();
        h.coordinator.start();
        h.coordinator.requestRestart('a');
        h.children[0].emitExit(0);
        expect(h.children).toHaveLength(2);
        h.children[0].emitExit(1); // stale double-fire from the dead child
        expect(h.exits).toEqual([]); // replacement unaffected, parent alive
        expect(h.coordinator.getState()).toBe('running');
    });
});
