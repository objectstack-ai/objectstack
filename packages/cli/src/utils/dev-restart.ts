// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Testable seams for `objectstack dev`'s watch → rebuild → restart pipeline
 * (#5148).
 *
 * Background: the dev watcher rebuilds `dist/objectstack.json` on source
 * changes, but the running serve child only *partially* receives a rebuilt
 * artifact (new-object DDL + seeds sync and an SSE broadcast fire; hook
 * bodies and already-registered view metadata from the compiled bundle are
 * boot-time-only). #5148 measured the result: the artifact on disk and the
 * behaviour of the server disagree silently, so every dev edit/verify loop
 * can produce a false conclusion in either direction. Boot-time load is the
 * one path that applies the whole artifact, so the fix is nodemon-style: on
 * each successful rebuild, restart the serve child ({@link ServeRestartCoordinator}),
 * and at boot warn when the artifact is already older than the sources
 * ({@link assessArtifactStaleness}).
 */

import fs from 'fs';
import path from 'path';

/**
 * Paths the dev watcher does NOT consider objectstack sources. Shared between
 * the chokidar watcher (which triggers rebuilds) and the boot-time staleness
 * walk (which warns about a stale artifact), so both judge exactly the same
 * source surface — a file that can trigger a rebuild is a file that can make
 * the artifact stale, and vice versa.
 */
export const DEV_WATCH_IGNORED: RegExp[] = [
    /node_modules/,
    /\.git/,
    /\.objectstack\//,
    /\bdist\b/,
    /\.test\.[jt]sx?$/,
];

/** True when the path is outside the dev watcher's source surface. */
export function isDevWatchIgnored(p: string): boolean {
    return DEV_WATCH_IGNORED.some((re) => re.test(p));
}

export interface ArtifactStalenessReport {
    /** mtime (ms) of the compiled artifact. */
    artifactMtimeMs: number;
    /** mtime (ms) of the newest watched source file. */
    newestSourceMtimeMs: number;
    /** Absolute path of the newest watched source file. */
    newestSourcePath: string;
}

/**
 * Boot-time staleness check (#5148 startup variant): compare the compiled
 * artifact against the sources that compile into it (`objectstack.config.ts`
 * + `src/**`, minus {@link DEV_WATCH_IGNORED}).
 *
 * Returns a report when at least one source is strictly NEWER than the
 * artifact — i.e. booting now silently serves a stale build — and `null`
 * when the artifact is current, missing (dev auto-compiles a missing
 * artifact), or unreadable. This is a diagnostic: it must never throw and
 * never gate the boot.
 */
export function assessArtifactStaleness(opts: {
    artifactPath: string;
    configPath: string;
    srcDir?: string;
    /**
     * Walk budget — directory entries visited before the walk stops. A dev
     * project's `src/` is small; the cap only guards against pathological
     * trees. Best-effort by design: a capped walk can miss staleness, never
     * invent it.
     */
    maxEntries?: number;
}): ArtifactStalenessReport | null {
    let artifactMtimeMs: number;
    try {
        artifactMtimeMs = fs.statSync(opts.artifactPath).mtimeMs;
    } catch {
        return null; // no artifact → dev compiles it fresh; nothing stale to report
    }

    let newestPath: string | null = null;
    let newestMtimeMs = -Infinity;
    const consider = (p: string) => {
        try {
            const st = fs.statSync(p);
            if (st.isFile() && st.mtimeMs > newestMtimeMs) {
                newestMtimeMs = st.mtimeMs;
                newestPath = p;
            }
        } catch {
            /* raced deletion — skip */
        }
    };

    consider(opts.configPath);

    const budget = opts.maxEntries ?? 20_000;
    let visited = 0;
    const walk = (dir: string) => {
        if (visited >= budget) return;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const ent of entries) {
            if (visited++ >= budget) return;
            const p = path.join(dir, ent.name);
            if (isDevWatchIgnored(p)) continue;
            if (ent.isSymbolicLink()) continue; // no cycles
            if (ent.isDirectory()) walk(p);
            else if (ent.isFile()) consider(p);
        }
    };
    if (opts.srcDir) {
        try {
            if (fs.statSync(opts.srcDir).isDirectory()) walk(opts.srcDir);
        } catch {
            /* no src dir — config-only project */
        }
    }

    if (newestPath !== null && newestMtimeMs > artifactMtimeMs) {
        return { artifactMtimeMs, newestSourceMtimeMs: newestMtimeMs, newestSourcePath: newestPath };
    }
    return null;
}

/** Human-readable rendering of an mtime gap, for the staleness warning. */
export function formatMtimeGap(ms: number): string {
    const s = Math.max(1, Math.round(ms / 1000));
    if (s < 90) return `${s}s`;
    const m = Math.round(s / 60);
    if (m < 90) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 36) return `${h}h`;
    return `${Math.round(h / 24)}d`;
}

/**
 * The slice of `child_process.ChildProcess` the coordinator needs — narrow so
 * tests can drive the state machine with a fake child.
 */
export interface ServeChildLike {
    readonly pid?: number;
    kill(signal?: NodeJS.Signals): boolean;
    once(
        event: 'exit',
        listener: (code: number | null, signal: NodeJS.Signals | null) => void,
    ): unknown;
}

export interface ServeRestartCoordinatorOptions {
    /**
     * Spawn a serve child. `restartIndex` is 0 for the initial boot and 1+
     * for restarts, so the caller can vary its messaging (e.g. print the MCP
     * connect hint only once).
     */
    spawnChild: (info: { restartIndex: number }) => ServeChildLike;
    /** Terminate the dev parent process with this exit code. */
    exitParent: (code: number) => void;
    /** Line sink for coordinator messages (default: console.log). */
    log?: (line: string) => void;
    /**
     * SIGTERM → SIGKILL escalation delay for a child that ignores the
     * graceful stop. The kernel's shutdown handler normally exits well within
     * this window; the escalation only exists so a wedged child cannot stall
     * the restart loop forever.
     */
    forceKillAfterMs?: number;
}

export type ServeRestartState = 'idle' | 'running' | 'stopping' | 'shutdown';

/**
 * Supervises the single serve child of `objectstack dev` (#5148, nodemon
 * style).
 *
 * States: `idle` → `running` ⇄ `stopping` → `shutdown`.
 *
 * - {@link requestRestart} (called after each successful rebuild lands on
 *   disk): SIGTERM the child; when it exits, spawn a replacement, which
 *   reads the newest artifact at boot. Requests arriving while a restart is
 *   already tearing down are absorbed — the upcoming boot picks up the
 *   newest build anyway, so consecutive rebuilds coalesce into one restart.
 * - A child exit the coordinator did NOT initiate keeps the pre-#5148
 *   contract: the parent follows with the child's exit code (`code ?? 0`),
 *   loudly when the exit follows a restart.
 * - {@link beginShutdown} (parent got SIGINT/SIGTERM): forward the signal to
 *   the child; its exit then ends the parent — the same path a Ctrl-C took
 *   before, but now also covered when no TTY process group delivers the
 *   signal to the child for us.
 */
export class ServeRestartCoordinator {
    private state: ServeRestartState = 'idle';
    private child: ServeChildLike | null = null;
    /** Number of spawns so far — 0 until start(), 1 after the initial boot. */
    private spawnCount = 0;
    private forceKillTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly opts: ServeRestartCoordinatorOptions) {}

    getState(): ServeRestartState {
        return this.state;
    }

    /** Boot the initial serve child. No-op unless idle. */
    start(): void {
        if (this.state !== 'idle') return;
        this.spawn();
    }

    /**
     * A successful rebuild landed on disk — restart the serve child so the
     * running server matches `dist/objectstack.json` again.
     */
    requestRestart(reason: string): void {
        if (this.state === 'shutdown' || this.state === 'idle') return;
        if (this.state === 'stopping') {
            // Coalesce: the restart already in flight boots from disk, which
            // now holds the newer build.
            this.log('  ↻ restart already in progress — the pending boot picks up the newest build');
            return;
        }
        this.state = 'stopping';
        this.log(`  ↻ restarting server to apply the new build (${reason})...`);
        const child = this.child;
        if (!child) {
            // Defensive: running-with-no-child cannot happen; recover by booting.
            this.spawn();
            return;
        }
        this.armForceKill(child);
        try {
            child.kill('SIGTERM');
        } catch {
            /* child raced its own exit — the exit handler takes over */
        }
    }

    /**
     * The dev parent received `signal`: forward it to the child and let the
     * child's exit end the parent (pre-existing dev semantics).
     */
    beginShutdown(signal: NodeJS.Signals): void {
        if (this.state === 'shutdown') return;
        this.state = 'shutdown';
        if (this.child) {
            try {
                this.child.kill(signal);
            } catch {
                /* already gone */
            }
        }
    }

    /**
     * Last-resort orphan guard for `process.on('exit')`: whatever path ends
     * the parent (a `--fresh` SIGINT handler's early `process.exit`, an
     * uncaught error), the serve child must not linger. Sync-only.
     */
    killChildOnParentExit(): void {
        if (this.child) {
            try {
                this.child.kill('SIGTERM');
            } catch {
                /* noop */
            }
        }
    }

    private log(line: string): void {
        (this.opts.log ?? console.log)(line);
    }

    private spawn(): void {
        const info = { restartIndex: this.spawnCount };
        let child: ServeChildLike;
        try {
            child = this.opts.spawnChild(info);
        } catch (e: any) {
            this.log(
                `  ✗ failed to ${info.restartIndex > 0 ? 'restart' : 'start'} server: ${e?.message ?? e}`,
            );
            this.state = 'shutdown';
            this.opts.exitParent(1);
            return;
        }
        this.child = child;
        this.spawnCount++;
        this.state = 'running';
        child.once('exit', (code, signal) => this.onChildExit(child, code, signal));
    }

    private onChildExit(
        child: ServeChildLike,
        code: number | null,
        signal: NodeJS.Signals | null,
    ): void {
        if (child !== this.child) return; // late event from an already-replaced child
        this.clearForceKill();
        this.child = null;
        if (this.state === 'shutdown') {
            this.opts.exitParent(code ?? 0);
            return;
        }
        if (this.state === 'stopping') {
            // We asked it to stop — bring up the replacement on the fresh artifact.
            this.spawn();
            return;
        }
        // Exited on its own (crash, or killed externally). Keep the
        // pre-#5148 contract — the parent follows the child — and say so
        // when the dead child was a restarted one, so a rebuild that boots
        // into a crash is loud instead of a silently vanished dev session.
        this.state = 'shutdown';
        if (this.spawnCount > 1) {
            this.log(
                `  ✗ server exited (${signal ? `signal ${signal}` : `code ${code}`}) — stopping dev`,
            );
        }
        this.opts.exitParent(code ?? 0);
    }

    private armForceKill(child: ServeChildLike): void {
        this.clearForceKill();
        const ms = this.opts.forceKillAfterMs ?? 8000;
        const t = setTimeout(() => {
            this.log(`  ⚠ server did not exit within ${ms}ms — force-killing (SIGKILL)`);
            try {
                child.kill('SIGKILL');
            } catch {
                /* gone */
            }
        }, ms);
        (t as { unref?: () => void }).unref?.();
        this.forceKillTimer = t;
    }

    private clearForceKill(): void {
        if (this.forceKillTimer) {
            clearTimeout(this.forceKillTimer);
            this.forceKillTimer = null;
        }
    }
}
