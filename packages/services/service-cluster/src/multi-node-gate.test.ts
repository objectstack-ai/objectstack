// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect, afterEach } from 'vitest';
import {
    registerMultiNodeGate,
    checkMultiNodeAllowed,
    hasMultiNodeGate,
    MULTI_NODE_NO_GATE_REASON,
    __resetMultiNodeGate,
} from './multi-node-gate.js';

afterEach(() => __resetMultiNodeGate());

describe('multi-node gate', () => {
    it('allows when no gate is registered and no count is declared', () => {
        // #13537: the no-gate default is fail-closed only for a DECLARED
        // multi-node topology. An undeclared count states no topology, so the
        // historical allow stands (single-replica path unchanged).
        expect(checkMultiNodeAllowed()).toEqual({ allowed: true, refused: 0, capped: false });
    });

    it('allows a single declared replica with no gate registered', () => {
        // The single-replica negative (#13537): one replica declares no
        // multi-node topology, so an unregistered gate must not refuse it.
        expect(checkMultiNodeAllowed(1)).toEqual({ allowed: true, refused: 0, capped: false });
    });

    it('refuses a declared multi-node topology when no gate is registered', () => {
        // #13537 — the default direction itself: an unregistered gate must not
        // silently mean "permitted" on the licensed capability. Smallest
        // multi-node count first, same verdict shape as a registered gate's
        // outright denial (no third branch for consumers).
        expect(checkMultiNodeAllowed(2)).toEqual({
            allowed: false,
            reason: MULTI_NODE_NO_GATE_REASON,
            admitted: 0,
            refused: 2,
            capped: false,
        });
    });

    it('honors a denying gate with reason', () => {
        registerMultiNodeGate({ allowMultiNode: () => ({ allowed: false, reason: 'unlicensed' }) });
        expect(checkMultiNodeAllowed()).toEqual({
            allowed: false,
            reason: 'unlicensed',
            admitted: 0,
            refused: 0,
            capped: false,
        });
    });

    it('honors an allowing gate', () => {
        registerMultiNodeGate({ allowMultiNode: () => ({ allowed: true }) });
        expect(checkMultiNodeAllowed().allowed).toBe(true);
    });

    it('last registration wins', () => {
        registerMultiNodeGate({ allowMultiNode: () => ({ allowed: false }) });
        registerMultiNodeGate({ allowMultiNode: () => ({ allowed: true }) });
        expect(checkMultiNodeAllowed().allowed).toBe(true);
    });

    it('reset restores the unregistered default', () => {
        registerMultiNodeGate({ allowMultiNode: () => ({ allowed: false }) });
        __resetMultiNodeGate();
        expect(checkMultiNodeAllowed()).toEqual({ allowed: true, refused: 0, capped: false });
        expect(checkMultiNodeAllowed(3).allowed).toBe(false);
    });

    it('reports whether a gate is registered on this module instance', () => {
        expect(hasMultiNodeGate()).toBe(false);
        registerMultiNodeGate({ allowMultiNode: () => ({ allowed: true }) });
        expect(hasMultiNodeGate()).toBe(true);
        __resetMultiNodeGate();
        expect(hasMultiNodeGate()).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Count-carrying admission (#8367)
//
// The maintainer ruled (2026-08-13, recorded on cloud#1275) that a licensed
// `max_nodes` overflow refuses the EXCESS replicas and runs up to the paid
// limit -- explicitly NOT whole-cluster degrade. These pins fix the seam
// semantics that make such a verdict expressible.
//
// VACUITY NOTE: an assertion that only reads `allowed`/`reason`, or one whose
// requested count never exceeds the cap, passes verbatim against a completely
// UNWIDENED gate -- `refused` would be 0 either way. Every pin below therefore
// requests strictly more than the cap and asserts `refused`/`capped`, and the
// partial-cap pins assert `allowed === true` in the SAME expectation: a gate
// that denied the whole cluster would also produce `refused > 0`, so the
// `allowed` half is what distinguishes the ruled behaviour from the rejected
// one.
// ---------------------------------------------------------------------------
describe('multi-node gate: count-carrying admission', () => {
    it('forwards the requested node count to the gate', () => {
        const seen: Array<number | undefined> = [];
        registerMultiNodeGate({
            allowMultiNode: (requested) => {
                seen.push(requested);
                return { allowed: true };
            },
        });
        checkMultiNodeAllowed(5);
        expect(seen).toEqual([5]);
    });

    it('admits up to the cap and refuses only the excess, staying allowed', () => {
        registerMultiNodeGate({
            allowMultiNode: () => ({ allowed: true, reason: 'licensed', admitted: 3 }),
        });
        // The ruled behaviour: run 3, refuse 2, do NOT deny the cluster.
        expect(checkMultiNodeAllowed(5)).toEqual({
            allowed: true,
            reason: 'licensed',
            admitted: 3,
            refused: 2,
            capped: true,
        });
    });

    it('does not report a cap when the request fits inside it', () => {
        registerMultiNodeGate({
            allowMultiNode: () => ({ allowed: true, admitted: 5 }),
        });
        const verdict = checkMultiNodeAllowed(3);
        expect(verdict).toEqual({ allowed: true, admitted: 3, refused: 0, capped: false });
    });

    it('reports an outright denial as refusing everything, but never as a partial cap', () => {
        registerMultiNodeGate({
            allowMultiNode: () => ({ allowed: false, reason: 'unlicensed' }),
        });
        expect(checkMultiNodeAllowed(4)).toEqual({
            allowed: false,
            reason: 'unlicensed',
            admitted: 0,
            refused: 4,
            capped: false,
        });
    });

    it('treats an allowing gate that declares no count as uncapped', () => {
        registerMultiNodeGate({ allowMultiNode: () => ({ allowed: true, reason: 'licensed' }) });
        expect(checkMultiNodeAllowed(9)).toEqual({
            allowed: true,
            reason: 'licensed',
            refused: 0,
            capped: false,
        });
    });

    it('refuses every declared count above one when no gate is registered', () => {
        // #13537 flipped this pin's direction: this exact call used to be the
        // "open framework is uncapped for any count" default-ALLOW pin. An
        // unregistered gate now refuses the whole declared topology, and the
        // refusal carries the counts (`admitted: 0`, everything refused) so
        // the operator surfaces stay coherent.
        expect(checkMultiNodeAllowed(9)).toEqual({
            allowed: false,
            reason: MULTI_NODE_NO_GATE_REASON,
            admitted: 0,
            refused: 9,
            capped: false,
        });
    });

    it('keeps meaningless declared counts on the allow path with no gate', () => {
        // `OS_CLUSTER_REPLICAS` unset (`Number(undefined)` = NaN), zero or
        // negative all normalize to "not declared" — none states a multi-node
        // topology, so none may trip the fail-closed default (#13537).
        for (const requested of [Number.NaN, 0, -1]) {
            expect(checkMultiNodeAllowed(requested)).toEqual({
                allowed: true,
                refused: 0,
                capped: false,
            });
        }
    });

    it('never blocks a properly-entitled deployment: the new default engages only with NO gate', () => {
        // The entitled negative (#13537): a registered gate whose cap covers
        // the declared count answers exactly as before — the fail-closed
        // branch is unreachable the moment a gate is registered.
        registerMultiNodeGate({
            allowMultiNode: () => ({ allowed: true, reason: 'licensed', admitted: 5 }),
        });
        expect(checkMultiNodeAllowed(3)).toEqual({
            allowed: true,
            reason: 'licensed',
            admitted: 3,
            refused: 0,
            capped: false,
        });
    });

    it('normalizes a degenerate admitted count from a third-party gate', () => {
        // Contract-first: the seam normalizes, so no consumer writes `?? 0`.
        registerMultiNodeGate({ allowMultiNode: () => ({ allowed: true, admitted: -2 }) });
        expect(checkMultiNodeAllowed(3)).toMatchObject({ admitted: 0, refused: 3 });

        registerMultiNodeGate({ allowMultiNode: () => ({ allowed: true, admitted: 2.7 }) });
        expect(checkMultiNodeAllowed(4)).toMatchObject({ admitted: 2, refused: 2 });

        registerMultiNodeGate({ allowMultiNode: () => ({ allowed: true, admitted: Number.NaN }) });
        expect(checkMultiNodeAllowed(4)).toMatchObject({ refused: 0, capped: false });
    });

    it('ignores a meaningless requested count', () => {
        registerMultiNodeGate({ allowMultiNode: () => ({ allowed: true, admitted: 2 }) });
        expect(checkMultiNodeAllowed(-1)).toMatchObject({ admitted: 2, refused: 0, capped: false });
        expect(checkMultiNodeAllowed(Number.NaN)).toMatchObject({ admitted: 2, refused: 0 });
    });
});

// ---------------------------------------------------------------------------
// Backward compatibility with the published seam (#8367)
//
// `allowMultiNode` is consumed by @objectstack/security-enterprise in the cloud
// repo, which registers a ZERO-ARG arrow returning a bare `{ allowed, reason }`
// (cloud: apps/objectos-ee/objectstack.config.ts). Widening the seam must leave
// that provider working -- this block pins the exact shape it registers today,
// so a later signature change cannot strand the EE distribution silently.
// ---------------------------------------------------------------------------
describe('multi-node gate: existing boolean-shaped provider', () => {
    /** Byte-for-byte the shape the EE distribution registers today. */
    const eeShapedProvider = {
        allowMultiNode: () => ({ allowed: true, reason: 'offline license' }),
    };

    it('accepts a zero-arg boolean provider and honors its verdict uncounted', () => {
        registerMultiNodeGate(eeShapedProvider);
        expect(checkMultiNodeAllowed()).toMatchObject({
            allowed: true,
            reason: 'offline license',
        });
    });

    it('keeps a zero-arg boolean provider correct under a COUNTED call', () => {
        registerMultiNodeGate(eeShapedProvider);
        // It declares no cap, so it must admit everything asked for -- the
        // widening must not invent a refusal the provider never expressed.
        expect(checkMultiNodeAllowed(12)).toEqual({
            allowed: true,
            reason: 'offline license',
            refused: 0,
            capped: false,
        });
    });

    it('keeps a zero-arg DENYING boolean provider denying', () => {
        registerMultiNodeGate({
            allowMultiNode: () => ({ allowed: false, reason: 'license does not include clustering' }),
        });
        const verdict = checkMultiNodeAllowed(3);
        expect(verdict.allowed).toBe(false);
        expect(verdict.reason).toBe('license does not include clustering');
    });
});
