// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// The blank template's companies and contacts ARE the platform's Starter app
// (`examples/app-starter`), as source a new project owns. The two must never
// drift: a project scaffolded today and an environment that installed the
// Starter hold the same objects, the same views and the same menu entries.
//
// ## Why a pin, and not a copy at build time
//
// The template is PAYLOAD: `src/templates/blank/` is what other tests in this
// package read, what tsup copies into `dist/`, and what `npm create` users get.
// A copy step from the example would leave the source tree without the files
// every one of those readers expects, and it would still need the namespace
// change below spelled a second time. So each file is committed in the
// template, and this test holds it equal to the Starter's.
//
// ## What "equal" means: the code, modulo the namespace, blind to comments
//
// The Starter names its objects under its own namespace (`starter_company`);
// the template names them under the template's (`blank_company`), and the
// scaffolder moves every such literal onto the project's namespace
// (`rewriteObjectNamePrefix`, which rewrites every quoted `blank_…` literal,
// references included — see `rewrite-identity.test.ts`). So the Starter's
// source is compared with `starter_` literals spelled `blank_`, and nothing
// else changed.
//
// Comments are NOT compared. The template's comments are written for a
// newcomer reading their own project (what the org-wide default means, how to
// remove the objects); the Starter's for a package author. Both files are
// parsed with the TypeScript compiler and the definition (the argument of
// `ObjectSchema.create` / `defineView`, each menu entry) is printed without
// comments, so formatting and commentary are free and every key and value is
// held.
//
// The template's menu is the Starter's object entries — companies, contacts,
// and the platform's tasks and notes — without the Starter's dashboard entry:
// the template ships no dashboard.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BLANK = path.join(HERE, 'templates', 'blank');
const BLANK_SRC = path.join(BLANK, 'src');
// The two places this test reads outside its package, each declared for
// `create-objectstack` in scripts/cross-package-test-inputs.mjs.
const STARTER_SRC = path.resolve(HERE, '../../../examples/app-starter/src');
const STARTER_CONFIG = path.resolve(HERE, '../../../examples/app-starter/objectstack.config.ts');

/** The template's namespace, from its config: what every `starter_` literal is spelled as here. */
const BLANK_NAMESPACE = /\bnamespace:\s*'([a-z0-9_]+)'/.exec(
  fs.readFileSync(path.join(BLANK, 'objectstack.config.ts'), 'utf8'),
)?.[1];
const STARTER_NAMESPACE = /\bnamespace:\s*'([a-z0-9_]+)'/.exec(fs.readFileSync(STARTER_CONFIG, 'utf8'))?.[1];

const printer = ts.createPrinter({ removeComments: true });

function parse(file: string, rename: boolean): ts.SourceFile {
  let text = fs.readFileSync(file, 'utf8');
  if (rename) {
    text = text.replace(new RegExp(`(['"\`])${STARTER_NAMESPACE}_`, 'g'), `$1${BLANK_NAMESPACE}_`);
  }
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function print(node: ts.Node, sf: ts.SourceFile): string {
  return printer.printNode(ts.EmitHint.Unspecified, node, sf);
}

/** Every node in `sf` that `match` accepts, in source order. */
function findAll<T extends ts.Node>(sf: ts.SourceFile, match: (n: ts.Node) => n is T): T[] {
  const out: T[] = [];
  const visit = (n: ts.Node) => {
    if (match(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The printed first argument of every `<callee>(…)` call in the file. */
function definitions(file: string, callee: string, rename: boolean): string[] {
  const sf = parse(file, rename);
  return findAll(sf, (n): n is ts.CallExpression => ts.isCallExpression(n) && n.expression.getText(sf) === callee).map(
    (call) => print(call.arguments[0], sf),
  );
}

/** The printed entries of the file's `navigation: [...]`, with each entry's `type`. */
function navigation(file: string, rename: boolean): { type: string | undefined; text: string }[] {
  const sf = parse(file, rename);
  const navs = findAll(
    sf,
    (n): n is ts.PropertyAssignment =>
      ts.isPropertyAssignment(n) && n.name.getText(sf) === 'navigation' && ts.isArrayLiteralExpression(n.initializer),
  );
  expect(navs, `${file} declares one navigation list`).toHaveLength(1);
  return (navs[0].initializer as ts.ArrayLiteralExpression).elements.map((entry) => {
    const typeProp = ts.isObjectLiteralExpression(entry)
      ? entry.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'type')
      : undefined;
    const type = typeProp && ts.isStringLiteral(typeProp.initializer) ? typeProp.initializer.text : undefined;
    return { type, text: print(entry, sf) };
  });
}

const PAIRS = [
  { what: 'company object', file: 'objects/company.object.ts', callee: 'ObjectSchema.create' },
  { what: 'contact object', file: 'objects/contact.object.ts', callee: 'ObjectSchema.create' },
  { what: 'company views', file: 'views/company.view.ts', callee: 'defineView' },
  { what: 'contact views', file: 'views/contact.view.ts', callee: 'defineView' },
];

describe('blank template — the Starter app\'s companies and contacts, as source', () => {
  it('reads two real namespaces (vacuity guard)', () => {
    expect(BLANK_NAMESPACE).toBe('blank');
    expect(STARTER_NAMESPACE).toBe('starter');
  });

  it.each(PAIRS)('the $what is the Starter\'s definition, modulo the namespace', ({ file, callee }) => {
    const starter = definitions(path.join(STARTER_SRC, file), callee, true);
    const template = definitions(path.join(BLANK_SRC, file), callee, false);
    // Vacuity guard: the definition really was found on both sides.
    expect(starter).toHaveLength(1);
    expect(template).toEqual(starter);
  });

  it('CONTROL: a one-value change in the template is caught', () => {
    const file = path.join(BLANK_SRC, 'objects', 'contact.object.ts');
    const sf = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8').replace('maxLength: 120', 'maxLength: 121'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const mutated = findAll(sf, (n): n is ts.CallExpression => ts.isCallExpression(n) && n.expression.getText(sf) === 'ObjectSchema.create')
      .map((call) => print(call.arguments[0], sf));
    expect(mutated).not.toEqual(definitions(path.join(STARTER_SRC, 'objects', 'contact.object.ts'), 'ObjectSchema.create', true));
  });

  it('the template declares exactly the Starter\'s objects', () => {
    const objectFiles = (src: string) =>
      fs.readdirSync(path.join(src, 'objects')).filter((f) => f.endsWith('.object.ts')).sort();
    expect(objectFiles(BLANK_SRC)).toEqual(objectFiles(STARTER_SRC));
    expect(objectFiles(BLANK_SRC)).toEqual(PAIRS.filter((p) => p.callee === 'ObjectSchema.create').map((p) => path.basename(p.file)));
  });

  it('the menu is the Starter\'s four object entries: companies, contacts, and the platform\'s tasks and notes', () => {
    const starter = navigation(path.join(STARTER_SRC, 'apps', 'starter.app.ts'), true);
    const template = navigation(path.join(BLANK_SRC, 'apps', 'main.app.ts'), false);
    const starterObjects = starter.filter((e) => e.type === 'object');
    // The Starter also carries a dashboard entry, which the template does not ship.
    expect(starter.length).toBeGreaterThan(starterObjects.length);
    expect(starterObjects).toHaveLength(4);
    expect(template.map((e) => e.text)).toEqual(starterObjects.map((e) => e.text));
    // The last two are the platform's own objects, gated as such.
    expect(template[2].text).toMatch(/objectName: 'sys_task', requiresObject: 'sys_task'/);
    expect(template[3].text).toMatch(/objectName: 'sys_note', requiresObject: 'sys_note'/);
  });

  it('the scaffolder\'s closing summary names what the project starts with', () => {
    // index.ts prints these lines after "Environment created!"; they must
    // describe the tree this template ships.
    const index = fs.readFileSync(path.join(HERE, 'index.ts'), 'utf8');
    expect(index).toMatch(/Your project starts with:/);
    expect(index).toMatch(/Companies and Contacts\s+src\/objects\//);
    expect(index).toMatch(/Tasks and Notes\s+the platform's own, in the menu of src\/apps\/main\.app\.ts/);
    expect(fs.existsSync(path.join(BLANK, 'src', 'apps', 'main.app.ts'))).toBe(true);
  });
});
