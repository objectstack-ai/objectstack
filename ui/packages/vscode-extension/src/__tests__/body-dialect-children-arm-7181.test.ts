/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7181 — the two extension-host readers honour `children`, the
 * spelling the rest of the platform declares.
 *
 * ⚠️ INVERTED BY objectui#6771, AND THE INVERSION IS THE POINT — read this before
 * reading a red in this file as a regression.
 *
 * objectui#7181 added the `children` arm and deliberately KEPT `body`, so this
 * file is TWO-SIDED: every case below pins the live spelling AND the retired one.
 * objectui#6771's ruling then ordered the second arm dropped — verbatim, "the
 * wider `children || body` readers drop the `body` arm in the same change" — and
 * the two sources this file pins deferred that drop TO THAT CARD BY NUMBER, in
 * their own words: `SchemaValidator.ts` "The `body` arm is deliberately KEPT:
 * dropping it is objectui#6771 step 2, not this change", and `PreviewProvider.ts`
 * "The body arm stays; removing it is objectui#6771 step 2, not this change."
 * ⇒ the `body` legs were recording a PRE-RETIREMENT state, not guarding a live
 * contract, so they are inverted rather than deleted.
 *
 * ⭐ AND THE REFUSAL MUST NOT GO QUIET — which took two goes to get right, so the
 * correction is recorded rather than smoothed over.
 *
 * The first answer to that objection cited the BUILT CLI: same document both
 * spellings, `body` exits 1 with `Unrecognized key(s) on this node: body. Did you
 * mean body → children?` at `Path: body`, `children` exits 0. That reading is
 * TRUE and it is about the WRONG TIER. It measures `@object-ui/types`' zod mirror
 * through `@object-ui/cli`. ⛔ This file pins neither: the extension host imports
 * no zod, builds no manifest, and its own JSON schema sets
 * `additionalProperties: true` (`schemas/objectui-schema.json`). ⇒ dropping the
 * `body` arm here, on its own, took a document that drew one diagnostic down to
 * ZERO — a refusal genuinely going quiet, in the one tool whose job is teaching
 * the format.
 *
 * So the arm did not just drop. `SchemaValidator` answers the retired key BY
 * NAME, and the leg below is a POSITIVE assertion about that answer rather than
 * an assertion that nothing happens. ⚠️ A measurement taken on one tier is not
 * evidence about another, however true it is — that is the whole of the lesson
 * here, and it is why the leg names the message it expects.
 *
 * ⛔ Every inverted leg keeps its ABSOLUTE numbers rather than comparing the two
 * spellings to each other. ⚠️ That is NOT the same as "a reader that broke
 * ENTIRELY satisfies neither half", which this header claimed until ablation
 * falsified it. What the legs do and do not catch is set out under "What these
 * pins actually catch" below, measured in both directions — and that reading,
 * not the symmetry, is why the numbers are spelled out.
 *
 * ## The defect these pins were built for
 *
 * `children` is declared on four faces: the TypeScript declaration and the zod
 * mirror in `@object-ui/types`, `validateSchema` in `@object-ui/core` (which
 * READ `schema.children || schema.body`, children FIRST, until objectui#6771
 * dropped that second arm — the past tense is load-bearing, because a reader
 * replaying this sentence against `@object-ui/core` today finds one spelling),
 * and the manifest
 * tier's `BASE_PROPS` in `@object-ui/sdui-parser` (which carries `children` and
 * does NOT carry `body`). Both readers in this package guarded their child-list
 * recursion on `schema.body` ALONE.
 *
 * So an author who wrote the declared spelling got, from the tool that is
 * supposed to be teaching them the format:
 *
 *   - a VS Code preview that rendered the node EMPTY — no error, no diagnostic,
 *     just a blank card or container; and
 *   - every child silently skipped by the validator, so a child missing its
 *     required `type` drew no warning at all.
 *
 * Both failures are SILENT, which is the worst direction for a metadata tool:
 * the author's file is fine, the platform blesses it, and the tooling reports
 * nothing while showing them nothing.
 *
 * ## Why these run the SHIPPED source instead of importing the modules
 *
 * Two different reasons, one per reader, and both are the same reason the
 * sibling `export-to-react-*` pins give:
 *
 *   - `PreviewProvider`'s renderer is not a module at all. It lives as JS text
 *     inside a TEMPLATE LITERAL that becomes the webview's inline script, so
 *     this package's `tsc --noEmit` sees one string and nothing type-checks or
 *     executes it. Extracting and running that text is the only way to observe
 *     the code the user's preview actually runs — and it means the pin is on
 *     the SHIPPED text, not on a copy of it that can drift.
 *   - `SchemaValidator` imports `vscode`, which has no runtime module outside
 *     the extension host and no alias in this repo's vitest config. It is
 *     transpiled here and executed against a stub of the seven `vscode` members
 *     it touches, so the pin exercises the real recursion rather than asserting
 *     on source text.
 *
 * ⚠️ Source-text assertions were deliberately NOT used for either. An assertion
 * that the string `schema.children` appears would pass against a `children` arm
 * that is present but unreachable, which is precisely the failure being pinned.
 *
 * ## The `body` arm is GONE — and each pin's second half now says so
 *
 * ⚠️ INVERTED, and the old text is quoted rather than dropped so the reversal is
 * legible: this section read "the `body` arm is expected to keep working …
 * Removing the `body` arm is objectui#6771 step 2, not this change". This IS
 * that change. The sentence is therefore reversed, not deleted — a
 * `body`-spelled document that renders or validates as it did before is now the
 * regression, and these pins are what catch it.
 *
 * ## ⭐ What these pins actually catch — MEASURED, in both directions
 *
 * ⚠️ This section replaces three sentences that were WRONG. They said that each
 * pin still asserts BOTH spellings, that the `body` leg carries zero beside its
 * twin, and that a reader which broke entirely satisfies neither half. The first
 * two are contradicted by this file's own contents; the third by ablation. ⛔ The
 * pins were NOT widened to rescue the prose — the prose was re-derived from what
 * the pins already do.
 *
 * ⭐ Not every pin is two-sided. Of the EIGHT behavioural pins, THREE assert both
 * spellings — `card`, the generic container (`div`) and the bare-node arity.
 * THREE assert `children` alone: nested descent, the validator's `children`
 * recursion, and the well-formed-tree pin, whose `body` half objectui#6771
 * DELETED as non-discriminating (its own comment says so). TWO assert `body`
 * alone: the diagnostic-by-name pin and the `record:alert` carve-out.
 *
 * ⭐ Nor do the `body` legs carry the same number. `card`'s asserts ONE, not
 * zero, because the title element survives when the child list does not. `div`'s
 * and the bare node's assert zero. That difference turns out to be the whole of
 * what follows.
 *
 * Two ablations on `PreviewProvider.ts`, each mutated ON DISK and restored to the
 * HEAD blob:
 *
 *   COLLAPSE — an early `return element;` after `document.createElement`, so
 *   nothing is appended under EITHER spelling. Every `children` leg reds, and so
 *   does `card`'s `body` leg, because 0 is not the 1 it asserts. ⚠️ But `div`'s
 *   and the bare node's `body` legs are SATISFIED: a reader that renders nothing
 *   produces exactly the zero they demand.
 *
 *   RESURRECTION — `schema.children || schema.body` restored in both branches.
 *   Every `children` leg holds, and EXACTLY the three `body` legs red.
 *
 * ⇒ THE READING: a zero-valued `body` leg catches the retired arm COMING BACK,
 * ⛔ not the reader falling over. What catches a collapse is the `children` leg
 * beside it — which is why the pair is kept together even though the two halves
 * answer different questions. ⭐ And `card`'s `body` leg, alone among the three,
 * reds in BOTH directions, because it asserts a NON-ZERO absolute. Where the
 * shape affords a non-zero number, that is the leg worth having.
 *
 * ⭐ For the validator the `body` leg is POSITIVE rather than silent — it asserts
 * the diagnostic that NAMES `children` — because dropping the arm without that
 * assertion took this host from one diagnostic to zero, the correction recorded
 * at the top of this header. That too is measured, on `SchemaValidator.ts`:
 *
 *   SILENCE — the retirement push gated off. The diagnostic-by-name pin reds,
 *   AND so does the carve-out pin's twin leg, which exists to prove the carve-out
 *   is a carve-out rather than a validator that stopped working.
 *
 *   RESURRECTION — the recursion given its `body` arm back. The "does not descend
 *   it" leg reds, on the skipped child's own diagnostic surfacing.
 *
 * ⇒ the validator's two `body` legs DO catch the refusal going quiet, which the
 * preview's zero-valued legs cannot do for the preview. ⛔ Do not carry either
 * reading over to the other reader: they were measured separately and they
 * differ.
 *
 * ⛔ One exception, and it has its own leg: a node type that declares its own
 * `body` input is not writing the retired spelling. `record:alert` is the single
 * such registration in the tree, it is carved out of the diagnostic, and the leg
 * that pins the carve-out asserts both points — `record:alert` silent, `card`
 * still warned.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

const PREVIEW_SOURCE = readFileSync(
  resolve(HERE, '../providers/PreviewProvider.ts'),
  'utf8'
);
const VALIDATOR_SOURCE = readFileSync(
  resolve(HERE, '../providers/SchemaValidator.ts'),
  'utf8'
);

/* ------------------------------------------------------------------ *
 * Reader 1 — the preview's shipped inline renderer
 * ------------------------------------------------------------------ */

interface StubElement {
  tag: string;
  className: string;
  textContent: string;
  rows: number;
  type: string;
  placeholder: string;
  children: StubElement[];
  appendChild(child: StubElement): void;
}

function createStubElement(tag: string): StubElement {
  return {
    tag,
    className: '',
    textContent: '',
    rows: 0,
    type: '',
    placeholder: '',
    children: [],
    appendChild(child: StubElement) {
      this.children.push(child);
    },
  };
}

/** Every element below the one returned, at any depth. */
function countDescendants(element: StubElement): number {
  return element.children.reduce(
    (total, child) => total + 1 + countDescendants(child),
    0
  );
}

type RendererFn = (schema: unknown) => StubElement;

/**
 * Lift `createElementFromSchema` out of the webview HTML template and make it
 * callable. The anchors are asserted rather than assumed: if either moves, this
 * fails loudly instead of silently pinning nothing.
 */
function loadShippedPreviewRenderer(): RendererFn {
  const start = PREVIEW_SOURCE.indexOf('function createElementFromSchema');
  expect(
    start,
    'anchor "function createElementFromSchema" not found in PreviewProvider.ts — ' +
      'the renderer moved and this pin is measuring nothing'
  ).toBeGreaterThan(-1);

  const end = PREVIEW_SOURCE.indexOf('// Render the schema', start);
  expect(
    end,
    'anchor "// Render the schema" not found after the renderer in PreviewProvider.ts'
  ).toBeGreaterThan(start);

  // The renderer is written inside a template literal, so its backticks and
  // interpolations are escaped in the TypeScript source. Undo exactly that.
  const source = PREVIEW_SOURCE.slice(start, end)
    .replace(/\\`/g, '`')
    .replace(/\\\$\{/g, '${')
    .replace(/\\\\/g, '\\');

  const document = { createElement: createStubElement };
  return new Function(
    'document',
    `${source}\nreturn createElementFromSchema;`
  )(document) as RendererFn;
}

describe('the VS Code preview renders `children` — and, since objectui#6771, only `children`', () => {
  const render = loadShippedPreviewRenderer();
  const child = { type: 'text', content: 'Hello' };

  it('renders a `card` node\'s `children`, and draws nothing for the retired `body`', () => {
    const viaBody = countDescendants(
      render({ type: 'card', title: 'T', body: [child] })
    );
    const viaChildren = countDescendants(
      render({ type: 'card', title: 'T', children: [child] })
    );

    // Both halves ABSOLUTE, exactly as before the inversion: the title element
    // plus the one rendered child under the live spelling, and the title ALONE
    // under the retired one. A renderer that dropped both could satisfy neither,
    // which is why the numbers are spelled out rather than compared.
    //
    // ⭐ AND THIS PIN IS THE EXCEPTION — measured, see "What these pins actually
    // catch". Because the title survives, this `body` leg asserts ONE rather than
    // zero, so it reds under BOTH ablations: the collapse (0, not 1) and the
    // resurrection (2, not 1). ⛔ The sibling `div` and bare-node `body` legs do
    // NOT share that reach — their zero is satisfied by a reader that renders
    // nothing — so this sentence is about THIS pin and ⛔ does not generalise.
    expect(viaChildren).toBe(2);
    expect(viaBody).toBe(1);
  });

  it('renders a generic container node\'s `children`, and nothing for the retired `body`', () => {
    const viaBody = countDescendants(render({ type: 'div', body: [child] }));
    const viaChildren = countDescendants(
      render({ type: 'div', children: [child] })
    );

    // ⚠️ The reach of these two legs is NOT the same, and the difference is
    // measured. `viaChildren` is what catches a renderer that stopped appending:
    // under the collapse ablation it reds. `viaBody` does NOT — a renderer that
    // renders nothing produces the 0 asserted here and the leg passes. What it
    // catches is the retired arm being RESURRECTED, which reds it at 1. ⛔ Read
    // it as a collapse guard and you are reading a guard that is not there.
    expect(viaChildren).toBe(1);
    expect(viaBody).toBe(0);
  });

  it('renders nested `children` all the way down', () => {
    const tree = {
      type: 'div',
      children: [{ type: 'card', title: 'T', children: [child] }],
    };
    // div -> card -> (title, text)
    expect(countDescendants(render(tree))).toBe(3);
  });

  it('still honours a single non-array child node — under the one spelling left', () => {
    // The bare-node ARITY is what this case is about and it is untouched by the
    // retirement; only which key carries it moved.
    //
    // ⚠️ Same asymmetry as the `div` pin above, same measurement: the `children`
    // leg catches a collapse, the `body` leg catches a resurrection and ⛔ not a
    // collapse — its 0 is satisfied by a reader that renders nothing at all.
    expect(countDescendants(render({ type: 'div', children: child }))).toBe(1);
    expect(countDescendants(render({ type: 'div', body: child }))).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Reader 2 — the extension's schema validator
 * ------------------------------------------------------------------ */

interface CapturedDiagnostic {
  message: string;
}

/**
 * Transpile and execute `SchemaValidator.ts` against a stub of the `vscode`
 * members it touches, returning the diagnostics it publishes for `json`.
 */
function validateWithShippedValidator(schema: unknown): CapturedDiagnostic[] {
  const published: CapturedDiagnostic[] = [];

  const vscodeStub = {
    languages: {
      createDiagnosticCollection: () => ({
        set: (_uri: unknown, diagnostics: CapturedDiagnostic[]) => {
          published.splice(0, published.length, ...diagnostics);
        },
        clear: () => undefined,
        dispose: () => undefined,
      }),
    },
    window: {
      setStatusBarMessage: () => undefined,
      showErrorMessage: () => undefined,
      showInformationMessage: () => undefined,
    },
    // `Diagnostic` is captured by message only; the range is not under test.
    Diagnostic: class {
      constructor(
        public range: unknown,
        public message: string,
        public severity?: unknown
      ) {}
    },
    Range: class {
      constructor(...args: unknown[]) {
        this.args = args;
      }
      args: unknown[];
      translate() {
        return this;
      }
    },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  };

  const transpiled = ts.transpileModule(VALIDATOR_SOURCE, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const moduleShim: { exports: Record<string, unknown> } = { exports: {} };
  new Function(
    'require',
    'module',
    'exports',
    transpiled
  )(
    (specifier: string) => {
      if (specifier === 'vscode') return vscodeStub;
      throw new Error(`unexpected require("${specifier}") in SchemaValidator`);
    },
    moduleShim,
    moduleShim.exports
  );

  const SchemaValidatorClass = moduleShim.exports.SchemaValidator as new () => {
    validateDocument(document: unknown): Promise<void>;
  };

  const text = JSON.stringify(schema, null, 2);
  const validator = new SchemaValidatorClass();
  // `validateDocument` is synchronous in everything it does before publishing.
  void validator.validateDocument({
    getText: () => text,
    positionAt: () => ({ translate: () => ({}) }),
    uri: { toString: () => 'stub://doc.objectui.json' },
  });

  return published;
}

describe('the VS Code validator recurses into `children` — and, since objectui#6771, only `children`', () => {
  // A child missing its required `type` is the observable: the validator warns
  // about it ONLY if the recursion actually reached that child.
  const untypedChild = { className: 'p-4' };

  it('reaches a child spelled `children` and reports its missing `type`', () => {
    const diagnostics = validateWithShippedValidator({
      type: 'card',
      children: [untypedChild],
    });

    expect(diagnostics.map((d) => d.message)).toContain(
      'Missing required property "type"'
    );
  });

  it('ANSWERS a child list spelled `body` by name, and does not descend it', () => {
    // ⛔ INVERTED, NOT DELETED, and ⛔ not weakened into a non-assertion. Both
    // halves are positive: the retired key draws a diagnostic that NAMES the
    // replacement, and the recursion does not walk into it (so the child's own
    // problem is not reported at an address the document does not contain).
    //
    // ⚠️ The first half is the one that matters, and it is here because dropping
    // the arm WITHOUT it took this host from one diagnostic to zero — see the
    // header. A `not.toContain` alone would have been satisfied by exactly that
    // silence.
    const diagnostics = validateWithShippedValidator({
      type: 'card',
      body: [untypedChild],
    });

    expect(
      diagnostics.some(
        (d) => d.message.includes('"body"') && d.message.includes('"children"')
      ),
      'the retired spelling drew no diagnostic naming its replacement'
    ).toBe(true);
    expect(diagnostics.map((d) => d.message)).not.toContain(
      'Missing required property "type"'
    );
  });

  it('does NOT warn on a node type that declares its own `body` input', () => {
    // ⭐ THE PIN THE CARVE-OUT DID NOT HAVE. `TYPES_DECLARING_OWN_BODY` was added
    // to close a false positive, published in the changeset as behaviour of a
    // released package, and then nothing could fail on it: emptying the set to
    // `new Set([])` left this file passing every leg. A behaviour a test cannot
    // break is a behaviour nobody is holding.
    //
    // `record:alert` is the real subject — the one registration in the tree that
    // declares an input named `body`, whose value is an inline translation map
    // rather than a child list. Warning about it would be the false diagnostic
    // objectui#6771 exists to remove, reintroduced one host over.
    const carvedOut = validateWithShippedValidator({
      type: 'record:alert',
      body: 'Updated the deal stage to Negotiation.',
    });
    expect(
      carvedOut.some((d) => d.message.includes('"body"')),
      '`record:alert` drew a retirement warning for its own declared `body`'
    ).toBe(false);

    // THE TWIN, and it is what makes the line above a reading rather than a
    // validator that stopped working: the same key on a type that does NOT
    // declare it still draws the warning, naming the replacement.
    const notCarvedOut = validateWithShippedValidator({
      type: 'card',
      body: 'Updated the deal stage to Negotiation.',
    });
    expect(
      notCarvedOut.some(
        (d) => d.message.includes('"body"') && d.message.includes('"children"')
      ),
      'the retirement warning stopped firing for types outside the carve-out'
    ).toBe(true);
  });

  it('reports nothing for a well-formed tree under the live spelling', () => {
    // The `body` half of this pair was never discriminating — a well-formed tree
    // draws no diagnostic whether the recursion walks it or skips it — so it is
    // dropped rather than inverted into an assertion that cannot fail.
    const typedChild = { type: 'text', content: 'Hello' };

    expect(
      validateWithShippedValidator({ type: 'card', children: [typedChild] })
    ).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * The two spellings of one constant                                    *
 * ------------------------------------------------------------------ */

/**
 * `SchemaValidator.ts` says of its local `RETIRED_CHILD_LIST_KEY` that this file
 * "pins the two together" with `sdui-parser`'s export. That sentence was written
 * before the pin existed — a claim about a check that was not there, which is the
 * class this card keeps meeting. This block is the check.
 *
 * ⛔ Read off SOURCE TEXT, not by importing: this package ships to the extension
 * host with no `@object-ui/*` runtime dependency, and importing `sdui-parser`
 * here to satisfy a pin would put a dependency in the tree that the product does
 * not have. Both literals are read from disk instead, rooted at THIS FILE the way
 * `check-test-path-roots.mjs` requires.
 */
describe('the two spellings of the retired key cannot drift (objectui#6771)', () => {
  const literalOf = (source: string, constName: string): string => {
    const m = new RegExp(`${constName}\\s*(?::[^=]*)?=\\s*'([^']+)'`).exec(source);
    expect(m, `\`${constName}\` is not declared as a single-quoted literal any more`).toBeTruthy();
    return m![1];
  };

  it('the extension and `sdui-parser` name the same key', () => {
    const parserSource = readFileSync(
      resolve(HERE, '../../../sdui-parser/src/body-dialect.ts'),
      'utf8'
    );

    const extension = literalOf(VALIDATOR_SOURCE, 'const RETIRED_CHILD_LIST_KEY');
    const parser = literalOf(parserSource, 'export const RETIRED_CHILD_LIST_KEY');

    // Asserted ABSOLUTELY on both sides, not just as equal to each other: two
    // constants that drifted to the same WRONG value would satisfy equality.
    expect(extension).toBe('body');
    expect(parser).toBe('body');
    expect(extension).toBe(parser);
  });

  it('the diagnostic the extension pushes names the replacement', () => {
    // The constant is only half of it — the message is what an author reads.
    expect(VALIDATOR_SOURCE).toContain('"children"');
  });
});
