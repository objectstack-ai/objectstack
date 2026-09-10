// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { AgentSchema } from '../ai/agent.zod';
import { ProtectionSchema, applyProtection } from './protection.zod';

/**
 * The `unrecognized_keys` issue this parse raised, or `undefined`.
 *
 * Read off the ISSUE rather than the formatted string: the formatter is a
 * second surface with its own tests, and pinning through it would make these
 * assertions fail for a reason that has nothing to do with this block.
 */
function unknownKeyIssue(result: { success: boolean; error?: { issues: readonly unknown[] } }) {
    if (result.success) return undefined;
    return (result.error!.issues as { code: string; message: string; keys?: string[] }[])
        .find((i) => i.code === 'unrecognized_keys');
}

describe('ProtectionSchema', () => {
    it('accepts the four lock values', () => {
        for (const lock of ['none', 'no-overlay', 'no-delete', 'full'] as const) {
            expect(() => ProtectionSchema.parse({ lock, reason: 'r' })).not.toThrow();
        }
    });

    it('rejects unknown lock values', () => {
        expect(() => ProtectionSchema.parse({ lock: 'frozen' as any, reason: 'r' })).toThrow();
    });

    it('rejects unknown keys (strict mode)', () => {
        expect(() => ProtectionSchema.parse({ lock: 'full', reason: 'r', extras: 'no' as any }))
            .toThrow();
    });

    it('requires a non-empty reason', () => {
        expect(() => ProtectionSchema.parse({ lock: 'full' } as any)).toThrow();
        expect(() => ProtectionSchema.parse({ lock: 'full', reason: '' })).toThrow();
    });

    it('accepts optional reason and docsUrl', () => {
        const out = ProtectionSchema.parse({
            lock: 'full',
            reason: 'Locked by upstream package',
            docsUrl: 'https://example.com/lock',
        });
        expect(out.reason).toBe('Locked by upstream package');
        expect(out.docsUrl).toBe('https://example.com/lock');
    });

    it('rejects invalid docsUrl (non-URL string)', () => {
        expect(() => ProtectionSchema.parse({ lock: 'full', reason: 'r', docsUrl: 'not a url' }))
            .toThrow();
    });
});

describe('applyProtection', () => {
    it('translates protection → _lock envelope and strips the public block', () => {
        const item = {
            name: 'setup',
            label: 'Setup',
            protection: {
                lock: 'full',
                reason: 'Core admin UI',
                docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
            },
        } as Record<string, unknown>;
        applyProtection(item, { packageId: 'com.objectstack.platform-objects' });
        expect(item._lock).toBe('full');
        expect(item._lockReason).toBe('Core admin UI');
        expect(item._lockDocsUrl).toBe('https://objectstack.ai/docs/references/shared/protection');
        expect(item._lockSource).toBe('package');
        expect(item._provenance).toBe('package');
        expect(item._packageId).toBe('com.objectstack.platform-objects');
        expect(item.protection).toBeUndefined();
    });

    it('stamps packageId/_provenance without protection block', () => {
        const item = { name: 'task', label: 'Task' } as Record<string, unknown>;
        applyProtection(item, { packageId: 'crm', packageVersion: '1.2.3' });
        expect(item._packageId).toBe('crm');
        expect(item._packageVersion).toBe('1.2.3');
        expect(item._provenance).toBe('package');
        expect(item._lock).toBeUndefined();
    });

    it('leaves bare items unchanged (no packageId, no protection)', () => {
        const item = { name: 'x' } as Record<string, unknown>;
        applyProtection(item, {});
        expect(item._packageId).toBeUndefined();
        expect(item._provenance).toBeUndefined();
        expect(item._lock).toBeUndefined();
    });

    it('falls back to lockSource=artifact when no packageId', () => {
        const item = {
            name: 'x',
            protection: { lock: 'no-overlay', reason: 'r' },
        } as Record<string, unknown>;
        applyProtection(item, {});
        expect(item._lockSource).toBe('artifact');
        expect(item._lock).toBe('no-overlay');
    });

    it('does not overwrite pre-existing _lock fields', () => {
        const item = {
            _lock: 'no-delete',
            _lockReason: 'pre-set',
            _packageId: 'existing',
            protection: { lock: 'full', reason: 'new' },
        } as Record<string, unknown>;
        applyProtection(item, { packageId: 'override' });
        // _packageId is preserved (only sets when undefined).
        expect(item._packageId).toBe('existing');
        // But _lock IS overwritten because we treat `protection` as the
        // authoritative declaration; this matches loader semantics.
        expect(item._lock).toBe('full');
        expect(item._lockReason).toBe('new');
    });
});

/**
 * #16845 — the refusal TEXT, pinned at parse level.
 *
 * Before this block adopted `strictObject`, it was a bare `z.object(…).strict()`
 * with no error map, so its rejection was zod's own default —
 * `Unrecognized key: "lockk"` — carrying no surface name, no declared-key list
 * and no rename, on every one of the metadata types that mount it. Its own
 * closure was never the defect; the message was.
 *
 * These pins are written against the message the author actually reads, because
 * reading the source cannot distinguish "has an error map" from "has an error
 * map that says something useful".
 */
describe('ProtectionSchema — unknown-key refusal (#16845)', () => {
    it('names the surface, echoes the key and suggests the rename', () => {
        const issue = unknownKeyIssue(ProtectionSchema.safeParse({ lock: 'full', reason: 'r', lockk: 'system' } as never));
        expect(issue, 'a `.strict()` shape must still raise unrecognized_keys').toBeDefined();
        expect(issue!.keys).toEqual(['lockk']);
        // ① the surface — true at every mount, named without transcribing any.
        expect(issue!.message).toContain('the `protection` block of this metadata item');
        // ② the offending key, echoed back.
        expect(issue!.message).toContain('`lockk`');
        // ③ the rename.
        expect(issue!.message).toContain('Did you mean `lockk` → `lock`?');
        // …and the declared-key list, which the template carries in `history`.
        expect(issue!.message).toContain('The declared keys are `lock`, `reason` and `docsUrl`.');
        // The pre-fix message, pinned as ABSENT: zod's bare default is the defect.
        expect(issue!.message).not.toBe('Unrecognized key: "lockk"');
    });

    it('reaches an authorable surface — the card\'s own case, through `AgentSchema`', () => {
        const issue = unknownKeyIssue(AgentSchema.safeParse({ name: 'a', protection: { lockk: 'system' } } as never));
        expect(issue, 'the mount must carry the declaring schema\'s error map').toBeDefined();
        expect((issue as unknown as { path: unknown[] }).path).toEqual(['protection']);
        expect(issue!.message).toContain('the `protection` block of this metadata item');
        expect(issue!.message).toContain('Did you mean `lockk` → `lock`?');
    });

    it('corrects the two spellings the distance fallback answered WRONG', () => {
        // Measured on the pre-fix build: `docs` and `link` are each 2 edits from
        // `lock`, inside the length-relative budget, so the fallback pointed an
        // author who meant the documentation URL at the lock policy.
        for (const written of ['docs', 'link'] as const) {
            const issue = unknownKeyIssue(ProtectionSchema.safeParse({ lock: 'full', reason: 'r', [written]: 'x' } as never));
            expect(issue!.message).toContain(`Did you mean \`${written}\` → \`docsUrl\`?`);
            expect(issue!.message).not.toContain(`\`${written}\` → \`lock\``);
        }
    });

    it('answers the prose slot and the `_lock*` envelope family', () => {
        for (const written of ['description', 'message', 'explanation', 'lockReason'] as const) {
            const issue = unknownKeyIssue(ProtectionSchema.safeParse({ lock: 'full', [written]: 'x' } as never));
            expect(issue!.message).toContain(`Did you mean \`${written}\` → \`reason\`?`);
        }
        // One prescription for the whole family, once per message.
        const env = unknownKeyIssue(ProtectionSchema.safeParse(
            { lock: 'full', reason: 'r', _lock: 'full', _lockReason: 'r', _lockSource: 'package' } as never,
        ));
        expect(env!.message).toContain('the runtime\'s PRIVATE envelope');
        expect(env!.message.match(/PRIVATE envelope/g)).toHaveLength(1);
        // A wrong-layer boolean gets the VALUE mapping, not a bare rename.
        const ro = unknownKeyIssue(ProtectionSchema.safeParse({ lock: 'full', reason: 'r', readOnly: true } as never));
        expect(ro!.message).toContain("write `lock: 'no-overlay'`");
        expect(ro!.message).not.toContain('→ `lock`?');
    });

    it('the `history` key list is the shape\'s key list — the one transcription here, pinned', () => {
        // `history` spells the declared keys out in prose because the template
        // has no declared-key channel of its own. That is a second copy of the
        // shape, so it is held equal to the shape rather than trusted.
        const issue = unknownKeyIssue(ProtectionSchema.safeParse({ zzz: 1 } as never));
        for (const key of Object.keys(ProtectionSchema.shape)) {
            expect(issue!.message, `\`${key}\` is declared but the history sentence does not name it`)
                .toContain(`\`${key}\``);
        }
    });
});

/**
 * #16845 clause ② — the accept set did NOT move.
 *
 * `strictObject(options, shape)` is `z.object(shape, { error }).strict()`, and a
 * zod error map is consulted only for an issue already being raised, so it
 * cannot make a rejected value accepted or an accepted value rejected. That is
 * an argument; this is the measurement. Every row below reads identically on the
 * pre-fix build.
 */
describe('ProtectionSchema — accept set is unchanged (#16845)', () => {
    it('declares exactly `lock`, `reason`, `docsUrl`', () => {
        expect(Object.keys(ProtectionSchema.shape).sort()).toEqual(['docsUrl', 'lock', 'reason']);
    });

    it('accepts what it accepted, and returns the same data', () => {
        expect(ProtectionSchema.parse({ lock: 'full', reason: 'core', docsUrl: 'https://example.com/d' }))
            .toEqual({ lock: 'full', reason: 'core', docsUrl: 'https://example.com/d' });
        expect(ProtectionSchema.parse({ lock: 'none', reason: 'r' })).toEqual({ lock: 'none', reason: 'r' });
    });

    it('rejects what it rejected, with the same issue CODES', () => {
        const rows: [string, unknown, string][] = [
            ['unknown key',        { lock: 'full', reason: 'r', lockk: 'x' },   'unrecognized_keys'],
            ['missing lock',       { reason: 'r' },                             'invalid_value'],
            ['missing reason',     { lock: 'full' },                            'invalid_type'],
            ['bad lock value',     { lock: 'nope', reason: 'r' },               'invalid_value'],
            ['bad docsUrl',        { lock: 'full', reason: 'r', docsUrl: 'x' }, 'invalid_format'],
            ['reason too long',    { lock: 'full', reason: 'x'.repeat(501) },   'too_big'],
            ['reason empty',       { lock: 'full', reason: '' },                'too_small'],
        ];
        for (const [label, input, code] of rows) {
            const r = ProtectionSchema.safeParse(input as never);
            expect(r.success, label).toBe(false);
            expect(r.error!.issues.map((i) => i.code), label).toContain(code);
        }
    });

    it('a valid block still parses through a real mount', () => {
        const r = AgentSchema.safeParse({
            name: 'a', label: 'A', role: 'r', instructions: 'i',
            protection: { lock: 'full', reason: 'core' },
        } as never);
        expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
    });
});
