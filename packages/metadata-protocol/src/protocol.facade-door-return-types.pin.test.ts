// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #30054 — the eight public doors that stayed whole on the
 * `ObjectStackProtocolImplementation` facade because their return type was
 * inferred now spell it.
 *
 * The protocol.ts codemod keeps a non-private method with an inferred return
 * type on the class (`inferred-return-type` in
 * `scripts/codemod-split-protocol.mjs`): the published `.d.ts` prints that
 * type, and once the body moved the compiler would infer it through the moved
 * function instead. Each door below now carries its type on the signature,
 * copied from the `.d.ts` it was inferred into (the PR proves the built
 * `.d.ts` byte-equal before and after), so the type no longer depends on where
 * the body lives. An edit that drops one of these annotations turns this red,
 * before a later move could re-infer it.
 *
 * The bodies are still on the class: each door keeps its row in
 * `scripts/facade-delegation-registry.json` until a facade pass moves it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const FILE = fileURLToPath(new URL('./protocol.ts', import.meta.url));
const CLASS_NAME = 'ObjectStackProtocolImplementation';

/** The doors, each with the head of the type it spells (the outer type of its `.d.ts` line). */
const DOORS: Readonly<Record<string, string>> = {
    getDiscovery: 'Promise<{',
    findData: 'Promise<{',
    getData: 'Promise<{',
    cloneData: 'Promise<{',
    saveMetaItem: 'Promise<{',
    publishMetaItem: 'Promise<{',
    rollbackMetaItem: 'Promise<{',
    deleteMetaItem: 'Promise<{',
};

function classMethods(): Map<string, ts.MethodDeclaration[]> {
    const text = readFileSync(FILE, 'utf8');
    const sf = ts.createSourceFile(FILE, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const cls = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === CLASS_NAME);
    const out = new Map<string, ts.MethodDeclaration[]>();
    for (const m of cls?.members ?? []) {
        if (!ts.isMethodDeclaration(m) || !m.body || !m.name || !ts.isIdentifier(m.name)) continue;
        out.set(m.name.text, [...(out.get(m.name.text) ?? []), m]);
    }
    return out;
}

describe('protocol.ts facade doors spell their return type (#30054)', () => {
    const methods = classMethods();

    it('finds the class and every door, once each', () => {
        expect(methods.size).toBeGreaterThan(0);
        for (const name of Object.keys(DOORS)) expect(methods.get(name)?.length, name).toBe(1);
    });

    for (const [name, head] of Object.entries(DOORS)) {
        it(`${name} declares its return type on the signature`, () => {
            const m = methods.get(name)?.[0];
            expect(m, name).toBeDefined();
            const type = m!.type;
            expect(type, `${name} has an inferred return type`).toBeDefined();
            expect(type!.getText().startsWith(head), `${name}: ${type!.getText().slice(0, 40)}`).toBe(true);
        });
    }
});
