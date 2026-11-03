// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E1] Pins `host-split.mjs`: the closed rewrite set, the check that a
 * moved body is the member's own body under exactly that set, and the
 * refusals that keep everything outside the set from moving.
 *
 * Every positive pin here has a negative control beside it: a moved body
 * changed by one thing the set does not allow must fail the check, by name.
 */

import { describe, expect, it } from 'vitest';
import {
    HOST_OF,
    checkMove,
    classOf,
    insertHostEntries,
    memberTable,
    parse,
    planMove,
    survey,
} from './host-split.mjs';

const C = 'ObjectStackProtocolImplementation';

// One class that exercises all three rewrites, a comment, a template literal
// whose second line starts at column 0, an operator and a declaration keyword.
const BASE = `class Base { protected hook(): void {} }
export class ${C} extends Base {
    private cache = new Map<string, number>();
    private count = 0;
    private static helper(x: number): number { return x + 1; }
    private static readonly LIMIT = 3;
    static shared(x: number): number { return x * 2; }
    private read(k: string) { return this.cache.get(k); }

    /** The contract of \`target\`. */
    async target(k: string, n: number): Promise<number> {
        // a comment the move carries
        const v = this.read(k) ?? 0;
        this.count += n;
        const msg = \`line one
line two \${k}\`;
        const same = v === n;
        const later = [1, 2].map((x) => this.read(String(x)));
        const nested = function (this: unknown) { return this; };
        return ${C}.helper(v) + this.constructor.shared(n) + msg.length + (same ? 1 : 0) + later.length + (nested ? 0 : 1);
    }

    bareThis() { return [this]; }
    elementThis(k: string) { return this[k]; }
    usesSuper() { return super.hook(); }
    usesArguments(a: number) { return arguments.length + a; }
    namedHost() { const host = 1; return host; }
    staticField() { return ${C}.LIMIT; }
    staticAsValue() { const f = ${C}.helper; return f(1); }
    bareConstructor() { return this.constructor; }
    undeclared() { return this.nope; }
    *generator() { yield this.count; }
    destructured({ a }: { a: number }) { return a + this.count; }
    hostAsPropertyName() { return { host: this.count }.host; }
    stubbed(k: string) { const self = { count: this.count }; return stubbedBody.call(self, k); }
    private plainStub(k: string, n: number) { return plainStub(k, n); }
    stubbedGeneric<R>(k: R) { const host = { count: this.count }; return (stubbedGenericBody<R>).call(host, k); }
}
`;

const HOST_SOURCE = `export interface ProtocolHost {
}
`;
const PROTOCOL_FACTORY = `
        installProtocolHost((protocol) => ({
        }));
`;

/** Perform the move the tool performs, in memory: the stubbed protocol source and the module source. */
function move(member = 'target') {
    const plan = planMove(BASE, member, 'protocol-target.ts');
    expect(plan.refusals).toEqual([]);
    const head = BASE.slice(0, plan.stub.start) + plan.stub.text + BASE.slice(plan.stub.end);
    const moduleSource = `import type { ProtocolHost } from './protocol-host.js';\n\n${plan.fnText}`;
    return { plan, head, moduleSource };
}

const check = (headSource, moduleSource) => checkMove({
    baseSource: BASE,
    headSource,
    moduleSource,
    moduleFile: 'protocol-target.ts',
    member: 'target',
});

describe('host-split: the move', () => {
    it('rewrites exactly the three kinds and names exactly the members the body reads', () => {
        const { plan } = move();
        const kinds = plan.sites.map((s) => `${s.kind}:${s.member}`);
        expect(kinds).toEqual([
            'member:read',
            'member:count',
            'member:read',
            'privateStatic:helper',
            'constructor:shared',
        ]);
        expect(plan.names).toEqual(['count', 'helper', 'read', 'shared']);
        // `this` inside a nested `function` is not the method's: it does not move.
        expect(plan.fnText).toContain('function (this: unknown) { return this; }');
        // The column-0 line inside the template literal keeps its bytes.
        expect(plan.fnText).toContain('\nline two ${k}`;');
        expect(plan.fnText).toContain('    // a comment the move carries\n');
        expect(plan.fnText).toContain(
            "export async function target(host: Pick<ProtocolHost, 'count' | 'helper' | 'read' | 'shared'>, k: string, n: number): Promise<number> {",
        );
        expect(plan.stub.text).toContain(`return target(${HOST_OF}(this), k, n);`);
    });

    it('builds host entries by kind: a method closure, a field accessor pair when written, a static closure', () => {
        const { plan } = move();
        const e = Object.fromEntries([...plan.hostEntries].map(([k, v]) => [k, v]));
        expect(e.read.iface).toBe(`    readonly read: ${C}['read'];`);
        expect(e.read.factory).toBe('            read: (...a) => protocol.read(...a),');
        expect(e.count.iface).toBe(`    count: ${C}['count'];`);
        expect(e.count.factory).toBe('            get count() { return protocol.count; },\n            set count(value) { protocol.count = value; },');
        expect(e.helper.iface).toBe(`    readonly helper: (typeof ${C})['helper'];`);
        expect(e.helper.factory).toBe(`            helper: (...a) => ${C}.helper(...a),`);
        expect(e.shared.iface).toBe(`    readonly shared: (typeof ${C})['shared'];`);

        const { host, protocol } = insertHostEntries(HOST_SOURCE, PROTOCOL_FACTORY, plan.hostEntries);
        expect(host.split('\n').filter((l) => l.startsWith('    ')).map((l) => l.trim().split(':')[0])).toEqual([
            'count', 'readonly helper', 'readonly read', 'readonly shared',
        ]);
        expect(protocol).toContain('            get count() { return protocol.count; },\n            set count(value) { protocol.count = value; },\n            helper:');
        // Inserting again adds nothing.
        const again = insertHostEntries(host, protocol, plan.hostEntries);
        expect(again).toEqual({ host, protocol });
    });

    it.each([
        ['bareThis', 'a bare `this`'],
        ['elementThis', '`this[…]`'],
        ['usesSuper', '`super`'],
        ['usesArguments', '`arguments` of the method'],
        ['namedHost', 'already named `host`'],
        ['staticField', 'private static `LIMIT` (field) read'],
        ['staticAsValue', 'private static `helper` (method) read as a value'],
        ['bareConstructor', '`this.constructor` not followed by `.<static>`'],
        ['undeclared', '`this.nope` names no declared instance member'],
        ['generator', 'a generator method'],
        ['destructured', 'a destructured parameter'],
    ])('refuses %s: %s', (member, reason) => {
        const plan = planMove(BASE, member, 'protocol-target.ts');
        expect(plan.refusals.map((r) => r.reason).join(' | ')).toContain(reason);
        expect(plan.fnText).toBeUndefined();
    });

    it.each(['stubbed', 'stubbedGeneric', 'plainStub'])('refuses to move %s again: it is already a stub', (member) => {
        const plan = planMove(BASE, member, 'protocol-target.ts');
        expect(plan.refusals.map((r) => r.reason).join(' | ')).toContain('already a stub');
    });

    it('does not refuse `host` as a property name', () => {
        expect(planMove(BASE, 'hostAsPropertyName', 'protocol-target.ts').refusals).toEqual([]);
    });

    it('survey: tells stubs from movable and refused members', () => {
        const { rows, clashes } = survey(BASE);
        const by = Object.fromEntries(rows.map((r) => [r.name, r]));
        expect(clashes).toEqual([]);
        expect(by.stubbed.stub).toBe('call');
        // The per-member series' generic spelling `(fn<R>).call(host, …)` is a stub too,
        // not a body that binds `host`.
        expect(by.stubbedGeneric.stub).toBe('call');
        // A body that read no member and moved as a plain function: `return fn(<params>)`.
        expect(by.plainStub.stub).toBe('plain');
        expect(by.target.refusals).toEqual([]);
        expect(by.bareThis.refusals).toHaveLength(1);
        const { head } = move();
        expect(Object.fromEntries(survey(head).rows.map((r) => [r.name, r.stub])).target).toBe('host');
    });

    it('reports a name declared both as an instance and a static member', () => {
        const table = memberTable(classOf(parse('x.ts', `class ${C} { x() {} static x() {} }`)));
        expect(table.clashes).toEqual(['x']);
    });
});

describe('host-split: the check', () => {
    it('passes the move it made: AST identity modulo the set, each kind counted, text identical', () => {
        const { head, moduleSource } = move();
        const r = check(head, moduleSource);
        expect(r.problems).toEqual([]);
        expect(r.ok).toBe(true);
        expect(r.textIdentical).toBe(true);
        expect(r.counts).toEqual({ member: 3, privateStatic: 1, constructor: 1 });
        expect(r.hostMembers).toEqual(['count', 'helper', 'read', 'shared']);
    });

    // Negative controls: one change outside the set each, and the check names it.
    it.each([
        ['an operator', (m) => m.replace('?? 0', '|| 0'), 'where the base has'],
        ['an equality operator', (m) => m.replace('v === n', 'v !== n'), 'where the base has'],
        ['a declaration keyword', (m) => m.replace('const v =', 'let v ='), 'where the base has'],
        ['a literal', (m) => m.replace('[1, 2]', '[1, 3]'), 'where the base has'],
        ['a member rewritten to another member', (m) => m.replace('host.read(k)', 'host.cache(k)'), '`this.read` must read `host.read`'],
        ['a member left unrewritten', (m) => m.replace('host.read(k)', 'this.read(k)'), '`this.read` must read `host.read`'],
        ['a private static left on the class', (m) => m.replace('host.helper(v)', `${C}.helper(v)`), `\`${C}.helper(…)\` must read \`host.helper(…)\``],
        ['`this.constructor.<static>` rewritten wrong', (m) => m.replace('host.shared(n)', 'host.helper(n)'), '`this.constructor.shared` must read `host.shared`'],
        ['an extra statement', (m) => m.replace("    return host.helper", "    void 0;\n    return host.helper"), 'children where the base has'],
        ['a comment changed (AST-equal, text not)', (m) => m.replace('a comment the move carries', 'a comment the move changed'), "body text differs"],
        ['the Pick naming a member the body does not read', (m) => m.replace("'count' | ", "'cache' | 'count' | "), 'host type must be'],
        ['the Pick missing a member the body reads', (m) => m.replace(" | 'shared'", ''), 'host type must be'],
        ['the host parameter renamed', (m) => m.replace('target(host:', 'target(h:'), 'first parameter is not `host`'],
        ['a parameter retyped', (m) => m.replace('n: number)', 'n: unknown)'), "parameters after the host are not the method's own"],
        ['the return type changed', (m) => m.replace('): Promise<number> {', '): Promise<unknown> {'), 'return type'],
    ])('fails %s', (_label, mutate, expected) => {
        const { head, moduleSource } = move();
        const mutated = mutate(moduleSource);
        expect(mutated).not.toBe(moduleSource);
        const r = check(head, mutated);
        expect(r.ok).toBe(false);
        expect(r.problems.join('\n')).toContain(expected);
    });

    it.each([
        ['the stub forwarding its parameters out of order', (h) => h.replace('target(protocolHost(this), k, n)', 'target(protocolHost(this), n, k)'), 'is not the stub'],
        ['the stub handing over anything but the host', (h) => h.replace('target(protocolHost(this), k, n)', 'target(this, k, n)'), 'is not the stub'],
        ["the method's docblock edited", (h) => h.replace('The contract of `target`.', 'The contract.'), 'docblock, modifiers or signature changed'],
    ])('fails %s', (_label, mutate, expected) => {
        const { head, moduleSource } = move();
        const mutated = mutate(head);
        expect(mutated).not.toBe(head);
        const r = check(mutated, moduleSource);
        expect(r.ok).toBe(false);
        expect(r.problems.join('\n')).toContain(expected);
    });
});
