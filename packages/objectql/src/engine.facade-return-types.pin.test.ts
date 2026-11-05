// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #30054 — the eight `ObjectQL` methods that stayed whole on the engine.ts
 * facade because their return type was inferred now spell it.
 *
 * The engine codemod keeps a public method with an inferred return type on
 * the class: the published `.d.ts` prints that type, and once the body moved
 * the compiler would infer it through the facet instead. Each method below
 * carries its type on the signature, copied from the `.d.ts` it was inferred
 * into (the PR proves the built `.d.ts` byte-equal before and after). Five of
 * them have since moved to their facets with the codemod's `--members` pass;
 * `registerApp`, `registerDriver` and `registerHook` keep their bodies and
 * their rows in `scripts/facade-delegation-registry.json`. An edit that drops
 * one of these annotations turns this red: on a stub, the published type would
 * then be re-inferred through the facet.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const FILE = fileURLToPath(new URL('./engine.ts', import.meta.url));
const CLASS_NAME = 'ObjectQL';

/** Each method with the type it spells (the text of its `.d.ts` line). */
const SPELLED: Readonly<Record<string, string>> = {
    registerApp: 'void',
    registerHook: 'void',
    registerDriver: 'void',
    init: 'Promise<void>',
    triggerHooks: 'Promise<void>',
    destroy: 'Promise<void>',
    setDatasourceMapping: 'void',
    getStatus: '{\n    name: "data";\n    status: string;\n    version: string;\n    features: string[];\n  }',
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

describe('engine.ts ObjectQL methods spell their return type (#30054)', () => {
    const methods = classMethods();

    it('finds the class and every method, once each', () => {
        expect(methods.size).toBeGreaterThan(0);
        for (const name of Object.keys(SPELLED)) expect(methods.get(name)?.length, name).toBe(1);
    });

    for (const [name, spelled] of Object.entries(SPELLED)) {
        it(`${name} declares its return type on the signature`, () => {
            const type = methods.get(name)?.[0]?.type;
            expect(type, `${name} has an inferred return type`).toBeDefined();
            expect(type!.getText()).toBe(spelled);
        });
    }
});
