// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: **a HOST config's `os serve` boot composes `@objectstack/metadata`'s
 * `MetadataPlugin` when no artifact door does, and that door names no
 * artifact, primes nothing and registers none of the stack** (#22989, the
 * maintainer's option A).
 *
 * ## Why it exists
 *
 * A host config (its `plugins[]` holds plugin instances: `examples/app-showcase`
 * and every `create-objectstack` scaffold) never reaches
 * `createStandaloneStack`, the composition that gives every other config boot
 * a `MetadataPlugin`. Outside `os dev`'s artifact door its `metadata` slot fell
 * to the kernel's in-memory core fallback, which has no `matchEndpoint`, so
 * every declared `apis` endpoint answered `404 ENDPOINT_NOT_FOUND` on
 * `os serve` (measured on the showcase: `GET /api/v1/apps/showcase/tasks`
 * with no session, 404 before, 401 after). The behavioural pin is
 * `test/serve-host-config-metadata-door.integration.test.ts`; this file holds
 * the composition's STRUCTURE, which that boot cannot see.
 *
 * ## What is pinned
 *
 *   • ONE decision, a single named value, gated on the dev artifact door being
 *     absent, on a host config, and on the composition holding no
 *     `MetadataPlugin` of its own.
 *   • No `artifactSource`: the door reads nothing of the stack, so the AppPlugin
 *     wrap stays the single registrar of the four ADR-0057 security
 *     collections and keeps the default `'app-plugin'` registrar. ⛔ The wrap's
 *     `'artifact-door'` declaration is never keyed on this door.
 *   • `bootstrap: 'lazy'`: the default `eager` mode runs a filesystem priming
 *     pass when no artifact is named, which would register a second copy of
 *     anything under `rootDir/<type>/`. The behavioural leg below shows the
 *     option is load-bearing: the same root primes an item under `eager` and
 *     none under `lazy`.
 *   • `rootDir` is `hostRoot`, the served app's root, never the operator's cwd.
 *   • It is `kernel.use`d after the HTTP server plugin, at the dev door's site.
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MetadataManager, MetadataPlugin } from '@objectstack/metadata';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVE_TS = path.join(HERE, 'serve.ts');
const source = fs.readFileSync(SERVE_TS, 'utf8');

/** Occurrences of `needle` in the source, as a plain substring count. */
function count(needle: string): number {
    return source.split(needle).length - 1;
}

/** The construction window: from the assignment to the closing `});`. */
function constructionWindow(): string {
    const at = source.indexOf('hostConfigMetadataDoor = new MetadataPlugin({');
    expect(at).toBeGreaterThan(-1);
    return source.slice(at, source.indexOf('});', at) + 3);
}

describe('#22989 A — `os serve` of a HOST config composes an artifact-less MetadataPlugin', () => {
    it('the door is ONE named decision, gated on no artifact door, a host config and no MetadataPlugin', () => {
        expect(count('let hostConfigMetadataDoor: any;')).toBe(1);
        expect(count('hostConfigMetadataDoor = new MetadataPlugin({')).toBe(1);
        const gateAt = source.indexOf('let hostConfigMetadataDoor: any;');
        const gate = source.slice(gateAt, source.indexOf('hostConfigMetadataDoor = new MetadataPlugin({'));
        expect(gate).toContain('!devArtifactDoor');
        expect(gate).toContain('isHostConfig(config)');
        expect(gate).toContain(
            "!plugins.some((p: any) => p?.name === 'com.objectstack.metadata' || p?.constructor?.name === 'MetadataPlugin')",
        );
        // Decided after the dev door (it reads that value) and before the wrap.
        expect(source.indexOf('let devArtifactDoor: any;')).toBeLessThan(gateAt);
        expect(gateAt).toBeLessThan(
            source.indexOf("devArtifactDoor ? { securityMetadataRegistrar: 'artifact-door' } : {},"),
        );
    });

    it('the door names no artifact, primes nothing, and roots at the served app', () => {
        const ctor = constructionWindow();
        expect(ctor).not.toContain('artifactSource');
        expect(ctor).not.toContain('artifactWatch');
        expect(ctor).toContain("config: { bootstrap: 'lazy' },");
        expect(ctor).toContain('rootDir: hostRoot,');
        expect(ctor).toContain('watch: false,');
    });

    it('the wrap\'s registrar is never keyed on this door: the four collections keep their one registrar', () => {
        // The ONLY spelling of the declaration is the dev door's.
        expect(count("securityMetadataRegistrar: 'artifact-door'")).toBe(1);
        expect(source).toContain("devArtifactDoor ? { securityMetadataRegistrar: 'artifact-door' } : {},");
        expect(source).not.toMatch(/hostConfigMetadataDoor\s*\?/);
    });

    it('the door is `kernel.use`d once, after the HTTP server plugin', () => {
        expect(count('await kernel.use(hostConfigMetadataDoor);')).toBe(1);
        expect(source.indexOf('await kernel.use(serverPlugin);'))
            .toBeLessThan(source.indexOf('await kernel.use(hostConfigMetadataDoor);'));
    });

    it('behavioural: `bootstrap: \'lazy\'` is load-bearing — the same root primes an item under eager and none under lazy', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'os-22989-door-'));
        try {
            fs.mkdirSync(path.join(root, 'object'), { recursive: true });
            fs.writeFileSync(
                path.join(root, 'object', 'probe_door.object.json'),
                JSON.stringify({ name: 'probe_door', label: 'Probe Door', fields: {} }),
            );
            const primed = async (options: ConstructorParameters<typeof MetadataPlugin>[0]) => {
                const services = new Map<string, unknown>();
                const ctx: any = {
                    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
                    registerService: (name: string, svc: unknown) => services.set(name, svc),
                    getService: (name: string) => {
                        if (!services.has(name)) throw new Error(`no ${name}`);
                        return services.get(name);
                    },
                    hook: vi.fn(),
                    trigger: vi.fn(),
                };
                const register = vi.spyOn(MetadataManager.prototype, 'register');
                const plugin = new MetadataPlugin(options);
                try {
                    await plugin.init(ctx);
                    await plugin.start(ctx);
                    return register.mock.calls.map(([type, name]) => `${type}/${name}`);
                } finally {
                    register.mockRestore();
                    await plugin.destroy();
                }
            };
            // CONTROL: the default mode primes the item this root holds.
            expect(await primed({ watch: false, rootDir: root })).toEqual(['object/probe_door']);
            // The composition's options: nothing is primed.
            expect(await primed({ watch: false, config: { bootstrap: 'lazy' }, rootDir: root })).toEqual([]);
            // Attaching the repository writes nothing at boot.
            expect(fs.existsSync(path.join(root, '.objectstack', 'metadata'))).toBe(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
