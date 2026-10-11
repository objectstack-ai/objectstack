// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Extract a metadata-only `HookBody` from an inline JS function.
 *
 * The CLI's `lowerCallables` pass already has direct access to every
 * `handler: (ctx) => {...}` value the user wrote in their `defineStack({...})`
 * config. After tsx/esbuild has loaded the config, those callables are real
 * runtime functions whose `.toString()` returns the compiled source — that
 * source is exactly what we want to ship as `body.source` so the runtime can
 * re-evaluate it inside the QuickJS sandbox without needing the .mjs side
 * channel.
 *
 * For v1 we apply a deliberately simple **regex allow-list** over the
 * extracted body — full TypeScript AST analysis is deferred to v2. Anything
 * the regex rejects (top-level `import`, `require(` / esbuild's `__require(`,
 * `fetch(`, `process.*`, `globalThis.*`, `eval`, `new Function`, `.sudo(`,
 * `.create(`, `ctx.dispatch.scope`, `ctx.submitted`) makes extraction **throw**.
 *
 * The last four are one family: a member that is REAL on the host context
 * (`ScopedContext`/`ObjectRepository` for the first two, the engine's
 * `HookContext` for the last two) and absent from what the VM hands a body, so
 * the same handler source passes an in-process test and fails the moment the
 * build lowers it into a body. `.create(` and `dispatch.scope` each carry a
 * wrinkle `.sudo(` does not — see their entries in `FORBIDDEN_PATTERNS`.
 *
 * ⚠️ What that throw costs the BUILD depends on the flag, and the two outcomes
 * are not the same one. This header used to claim only the second (#10678):
 *
 *   default `os build`  {@link lowerCallables} catches the throw, records it in
 *                       `bodyExtractionWarnings`, and ships the callable through
 *                       the back-compat `.mjs` bundle instead. No forbidden body
 *                       is ever emitted as `body.source` — but the build exits
 *                       **0**. `compile.ts` prints the recorded warnings, so
 *                       warn-and-bundle is at least not silent; it was silent
 *                       until #10678, which is the whole defect that card names.
 *   `--strict-body`     the same recorded warnings become a hard failure (exit 1)
 *                       with a per-callable diagnostic, and nothing is bundled.
 *   `os lint`           (commit ada3834ad) reads the REFUSAL KIND, not the exit code, and
 *                       gives the two classes different verdicts: an accidental
 *                       scope leak (`free-identifiers`) is a lint `error`, so a
 *                       gate can fail on it; a structural one (`forbidden-token`)
 *                       stays a warning, because bundling is its designed answer.
 *                       `os lint` calls THIS function, so its verdict cannot
 *                       drift from what `os build` would do to the same handler.
 *
 * So the allow-list gates what may become `body.source`; it does not (yet) gate
 * what may build. Closing the L3 `.mjs` path is `--strict-body`'s job today and
 * Phase 3's later — not this list's. Docs `hook-bodies.mdx` describe the same
 * outcomes; when this header and that page disagree, they are both wrong
 * until one of them is measured over a real `os build`.
 *
 * Capability inference: we scan the body for known `ctx.api.*`, `ctx.log.*`,
 * `ctx.crypto.*` access patterns and add the matching capability tokens to
 * `body.capabilities` automatically.
 *
 * ⛔ RETIRED — the `// @capabilities api.read api.write` hook-body directive was
 * removed in @objectstack/cli 17.1 (commit 7940de5e0, ADR-0049 enforce-or-remove). It was
 * read off `String(fn)`, and `loadConfig` runs every config through
 * `bundle-require` -> esbuild, which strips `//` line comments before the
 * handler is ever a runtime function. Measured on all four ordinary authoring
 * shapes (#10678) — `objectstack.config.ts`, `.js`, `.mjs`, and a handler
 * imported from a local module — the directive reached this code from NONE of
 * them: the build shipped the inferred capabilities alone, at exit 0, with no
 * error and no warning, and the mismatch surfaced far from its cause as a
 * sandbox refusal at runtime. Declare the tokens as DATA instead —
 * `body: { language: 'js', source, capabilities: [...] }` on the hook or action
 * — which is measured to survive the build.
 *
 * ⛔ Do not re-add a comment-borne override. A directive every ordinary
 * authoring path strips cannot be typed wrongly-but-visibly, so it can only
 * teach a wrong convention silently; that is why it was retired rather than
 * re-documented. `test/hook-body-build-reach.e2e.test.ts` pins both halves —
 * the directive contributing nothing, and `body.capabilities` surviving — over
 * a real spawned `os build`.
 *
 * Self-containment (#1876): a handler that references a module-scope identifier
 * (helper, import, top-level const) cannot be shipped body-only — the reference
 * would `ReferenceError` at runtime. {@link detectFreeIdentifiers} finds those;
 * extraction throws so the caller falls back to bundling the real closure.
 *
 * Sandbox-missing HOST globals (#14301) arrive through that same gate and for
 * the same reason, once the ambient allowlist stopped conflating "Node has it"
 * with "the sandbox has it". `Intl` was allowlisted next to `JSON`, so a handler
 * calling `Intl.DateTimeFormat` had no free identifier at all: it lowered, every
 * local gate stayed green, and the body threw `ReferenceError` in production —
 * under a hook's default `onError: 'abort'`, refusing every write to the object.
 * Those names are now REPORTED (`FreeIdentifierResult.nodeOnly`) and refused
 * with prose that names the identifier and the remedy, which is NOT the
 * module-scope one: a host global cannot be inlined.
 *
 * The parameter list (#22837). {@link peelToBlockBody} keeps the handler's
 * statements and drops its header, and the runtime runs a hook body as
 * `(async (ctx) => { SOURCE })` (`packages/runtime/src/sandbox/quickjs-runner.ts`,
 * the L2 wrapper): `ctx` is the ONLY name it binds. So a hook handler that named
 * its parameter anything else — `hookCtx`, or a destructuring `({ input })` —
 * lowered at exit 0, counted its own parameters as bound (the free-identifier
 * pass reads the whole function), and threw `ReferenceError` on its first run:
 * `500` over REST where the in-process handler answered `201`. Unlike a member
 * the VM lacks, a parameter NAME can be supplied, so on the hook face the build
 * re-emits the handler's one parameter as the body's first statement,
 * `var <param> = ctx;` ({@link planHookParameterRebind}), and the author's code
 * runs as written. What cannot be re-emitted faithfully — more than one
 * parameter, a default value, a rest parameter, a handler that declares its own
 * `ctx` — is refused, naming the parameter, the way the family below refuses a
 * member. A handler whose parameter already IS `ctx` (or that takes none)
 * lowers byte-identically to before: nothing is emitted for it.
 *
 * The action face is untouched by this: an action body runs as
 * `(async (input, ctx) => { SOURCE })`, a different binding list, and its
 * lowering is exactly what it was ({@link LoweringFace}).
 */

import { ts } from 'ts-morph';
import { detectFreeIdentifiers, parseFunction } from './detect-free-identifiers.js';

/**
 * Which sandbox wrapper a lowered callable runs in — the binding list the
 * runtime gives its body (`packages/runtime/src/sandbox/quickjs-runner.ts`):
 *
 *   `hook`    `(async (ctx) => { SOURCE })` — and an in-process hook handler is
 *             called with exactly that one argument (`handler(ctx)`,
 *             objectql's `hook-wrappers.ts`), so the handler's one parameter
 *             IS the context and can be rebound to `ctx` faithfully.
 *   `action`  `(async (input, ctx) => { SOURCE })` — two bindings, documented as
 *             the authoring signature `(input, ctx)`. The parameter rebind does
 *             NOT apply here: the action face's lowering is unchanged by it, and
 *             so are the hook-context member refusals, which are measured
 *             against the HOOK context.
 *
 * Internal: `extractHookBody` (the published entry) is the `hook` face.
 */
export type LoweringFace = 'hook' | 'action';

/**
 * WHY a refusal carries a machine-readable kind (commit ada3834ad).
 *
 * Every refusal below already KNOWS which rule refused — the rule is what
 * produced the sentence. Until this type existed, that knowledge was flattened
 * into the message string at the `throw` and never recovered: `lowerCallables`
 * caught the error, kept `err.message`, and every consumer downstream had a
 * paragraph of English where it needed a category. So the two refusals that
 * mean OPPOSITE things to an author shared one undifferentiated fate:
 *
 *   `free-identifiers`   the handler names something the lowered body's world
 *                        does not bind, so the deployment shape silently
 *                        changed from metadata to bundled closure — against
 *                        what the author wrote. Two sub-cases, told apart by
 *                        `nodeOnlyIdentifiers`: a module-scope helper/import/
 *                        const, whose remedy is local and mechanical (inline
 *                        the value), and a global the NODE HOST has that the
 *                        sandbox does not (#14301), which cannot be inlined at
 *                        all — that one keeps the check in a string handler ref
 *                        or moves it to a validation rule.
 *   `forbidden-token`    the handler is NOT expressible as a metadata-only body
 *                        at ALL. `fetch`/`require`/`process`/… are capabilities
 *                        the QuickJS sandbox does not have, so writing one IS
 *                        choosing a bundled closure. Falling back to the bundle
 *                        is the designed answer, not a degradation to report as
 *                        an error. A hook handler whose PARAMETER LIST cannot be
 *                        rebound to the sandbox's one `ctx` binding (#22837:
 *                        two parameters, a default, a rest parameter) is refused
 *                        under this kind too — the same "nothing in the VM can
 *                        supply it" verdict, about a binding instead of a member.
 *   `unparseable`        the extractor could not find a body to peel. An
 *                        instrument limit, not an author verdict.
 *
 * ⛔ The kind is NOT a license to change what `os build` accepts. Both classes
 * still fall back to bundling and still exit 0 — see `lowerCallables`, whose
 * catch is deliberately kept. What the kind buys is that a consumer can now
 * treat the accidental class differently from the structural one; `os lint` is
 * the first to do so.
 */
export type HookBodyRefusalKind = 'unparseable' | 'forbidden-token' | 'free-identifiers';

/**
 * A refusal from {@link extractHookBody}, carrying the classification the
 * refusing rule already had.
 *
 * The `message` is deliberately byte-identical to what this function threw
 * before the class existed: `os build`'s warn-and-bundle line, `--strict-body`'s
 * per-callable diagnostic and `content/docs/automation/hook-bodies.mdx` all
 * quote those sentences, and a refusal that reads differently would be a
 * documentation break wearing a refactor's clothes. The class ADDS structure
 * beside the prose; it does not restate it.
 */
export class HookBodyExtractionError extends Error {
  readonly kind: HookBodyRefusalKind;
  readonly originLabel: string;
  /** Names the handler referenced but does not bind — `free-identifiers` only. */
  readonly freeIdentifiers: readonly string[];
  /**
   * The subset of {@link freeIdentifiers} the NODE HOST provides and the QuickJS
   * sandbox does not (#14301) — `Intl` the reported one.
   *
   * Same discipline as `kind` above, one level finer: the refusing rule already
   * knows which half of the free list it is looking at, and a consumer that has
   * to re-derive it from the message prose is back where it was before commit ada3834ad. The
   * two halves have OPPOSITE remedies — a module-scope name is inlined into the
   * handler, a host-only global cannot be inlined at all — so a consumer that
   * prints one remedy for both prints a wrong one half the time.
   */
  readonly nodeOnlyIdentifiers: readonly string[];

  constructor(
    kind: HookBodyRefusalKind,
    originLabel: string,
    message: string,
    freeIdentifiers: readonly string[] = [],
    nodeOnlyIdentifiers: readonly string[] = [],
  ) {
    super(message);
    this.name = 'HookBodyExtractionError';
    this.kind = kind;
    this.originLabel = originLabel;
    this.freeIdentifiers = freeIdentifiers;
    this.nodeOnlyIdentifiers = nodeOnlyIdentifiers;
  }
}

/**
 * A member read off a ROOT identifier — `ctx` itself, or any local name a
 * handler bound (`const c = ctx`, `const d = ctx.dispatch`) — as opposed to a
 * member reached through another member (`ctx.input.<field>`).
 *
 * The `.sudo(` / `.create(` reach (receiver-loose) restated for a member whose
 * NAME is not distinctive. `sudo` names nothing but the host method, so any
 * receiver may be refused; `scope` and `submitted` are also ordinary field
 * names, and a field read through a record image the body DOES receive
 * (`ctx.input.scope`, `ctx.previous.submitted`) is working, lowerable code —
 * refusing it would be the false refusal `.create(` carves `Object` out for.
 * A root receiver is what both an alias and the context itself look like; a
 * record image never is. What it still over-refuses — a root-bound ROW with a
 * field of that name (`const row = ctx.input; row.submitted`), and the same
 * token inside a string literal — is listed at the two entries below.
 */
const ROOT_RECEIVER = String.raw`(?<![\w$]|\.\s*)[A-Za-z_$][\w$]*`;

/** `ctx.dispatch.scope` in any spelling below — gated on the body naming `dispatch` at all. */
const DISPATCH_SCOPE_RX = new RegExp(
  String.raw`^(?=[\s\S]*\bdispatch\b)[\s\S]*?(?:` +
    [
      // `ctx.dispatch.scope`, `ctx?.dispatch?.scope`, a destructured
      // `dispatch.scope`, and an alias of the marker (`d.scope`).
      String.raw`(?:\bdispatch|${ROOT_RECEIVER})\s*\??\.\s*scope\b`,
      // The same receivers, bracket-spelled: `ctx.dispatch['scope']`.
      String.raw`(?:\bdispatch|${ROOT_RECEIVER})\s*(?:\?\.)?\s*\[\s*(['"\x60])scope\1\s*\]`,
      // Destructured: `const { scope } = ctx.dispatch`, `const { dispatch: { scope } } = ctx`.
      String.raw`\{[^{}]*\bscope\b[^{}]*\}\s*=(?![=>])`,
      String.raw`\bdispatch\s*:\s*\{[^{}]*\bscope\b`,
    ].join('|') +
    ')',
);

/** `ctx.submitted` in any spelling below. */
const SUBMITTED_RX = new RegExp(
  [
    // `ctx.submitted`, `ctx?.submitted`, and a context alias (`c.submitted`).
    String.raw`${ROOT_RECEIVER}\s*\??\.\s*submitted\b`,
    // Bracket-spelled: `ctx['submitted']`.
    String.raw`${ROOT_RECEIVER}\s*(?:\?\.)?\s*\[\s*(['"\x60])submitted\1\s*\]`,
    // Destructured: `const { input, submitted } = ctx`.
    String.raw`\{[^{}]*\bsubmitted\b[^{}]*\}\s*=(?![=>])`,
  ].join('|'),
);

/**
 * A top-level HOOK-context member the body face does not carry, in the
 * spellings {@link SUBMITTED_RX} reads, with the destructured limb anchored to
 * a ROOT right-hand side (#22837).
 *
 * The three members this builds for were surfaced by the family's enumeration
 * pin (`test/lowered-body-face-enumeration.test.ts`), which derives the
 * in-process `HookContextSchema` members and the members `buildSandboxContext`
 * marshals from their sources and fails on any member absent from the body that
 * is neither refused here nor recorded there as a deliberate exception.
 *
 * Anchored where `submitted`'s destructured limb is not: `const { ql } = ctx`
 * and the rebind's `var { input, ql } = ctx;` are refused, while a pattern read
 * off a MEMBER (`const { transaction } = ctx.api`, the body's own transaction
 * route) is not — the right-hand side must be a bare root. A root alias of a
 * member (`const api = ctx.api; const { transaction } = api`) is over-refused,
 * the safe direction the entries below already accept.
 *
 * `exemptCalls` is for a member whose NAME the body face legitimately CALLS
 * through another receiver: `api.transaction(fn)` off a root alias of
 * `ctx.api` is the body's transaction route and is not refused; a READ of
 * `.transaction` off a root is.
 */
function hookContextMemberRx(member: string, { exemptCalls = false }: { exemptCalls?: boolean } = {}): RegExp {
  const notCalled = exemptCalls ? String.raw`(?!\s*(?:\?\.\s*)?\()` : '';
  return new RegExp(
    [
      String.raw`${ROOT_RECEIVER}\s*\??\.\s*${member}\b${notCalled}`,
      String.raw`${ROOT_RECEIVER}\s*(?:\?\.)?\s*\[\s*(['"\x60])${member}\1\s*\]${notCalled}`,
      String.raw`\{[^{}]*\b${member}\b[^{}]*\}\s*=\s*[A-Za-z_$][\w$]*(?![\w$]|\s*(?:\?\.|\.|\[))`,
    ].join('|'),
  );
}

const FORBIDDEN_PATTERNS: Array<{ rx: RegExp; reason: string; face?: LoweringFace }> = [
  { rx: /\bimport\s*[\(\*\{]/, reason: 'dynamic `import()` and ES imports are not allowed in hook/action bodies — declare a Connector recipe instead' },
  // Both spellings, one reason (#10678). A TypeScript config is loaded through
  // `bundle-require` -> esbuild, whose ESM interop shim rewrites a CommonJS
  // `require('node:os')` into `__require("node:os")` BEFORE `String(fn)` ever
  // runs. Matching only the source spelling made this reason UNREACHABLE from
  // the real authoring path: the refusal still fired, but through the #1876
  // free-identifier gate, naming `__require` — an identifier the author never
  // typed and cannot act on. Accept behaviour is unchanged either way (the body
  // was already refused); what changes is that the reason now names what was
  // written. `\b(?:__)?` cannot widen to `myrequire(` — no word boundary there.
  { rx: /\b(?:__)?require\s*\(/, reason: '`require()` is not allowed in hook/action bodies (esbuild rewrites it to `__require()` when the config is TypeScript; both spellings are refused)' },
  { rx: /\bfetch\s*\(/, reason: '`fetch()` is not allowed in hook/action bodies — declare a Connector recipe instead' },
  { rx: /\bprocess\s*\./, reason: '`process` access is not allowed in hook/action bodies' },
  { rx: /\bglobalThis\s*\./, reason: '`globalThis` access is not allowed in hook/action bodies' },
  { rx: /\beval\s*\(/, reason: '`eval()` is not allowed in hook/action bodies' },
  { rx: /\bnew\s+Function\s*\(/, reason: '`new Function()` is not allowed in hook/action bodies' },
  // [#14010] `sudo()` exists on the HOST `ScopedContext` and is NOT marshalled
  // into the VM, so lowering a handler that calls it turns working in-process
  // code into a `TypeError` that only production sees. Refusing here is what
  // makes the two runtimes agree: the callable is still registered in
  // `functions` and still shipped through the `.mjs` bundle by `lowerCallables`,
  // so the handler keeps running in-process where `sudo()` is real — the build
  // just declines to ALSO emit it as a body that cannot run.
  //
  // Same family as the `crypto.hash` retirement three lines into
  // CAPABILITY_PATTERNS below (#4391): a member advertised ahead of its
  // implementation, where the build-time inference was the amplifier rather
  // than the safety net. The difference is the remedy — `crypto.hash` had no
  // working channel to fall back to, this one does.
  //
  // Receiver-loose, like the `.object(...)` / `.title(...)` capability patterns:
  // a local alias (`const api = ctx.api; api.sudo()`) must not slip through,
  // and over-refusal is the SAFE direction here (the handler is bundled and
  // works; it is only `--strict-body`, which demands a body for every callable,
  // that turns this into a hard failure — correctly, since a body needing
  // elevation genuinely cannot be one).
  {
    rx: /\.\s*sudo\s*\(/,
    reason:
      '`sudo()` is not reachable from a sandboxed body — the VM\'s `ctx.api` carries only `object()` '
      + 'and `transaction()`, so the call is a TypeError at run time (and under a hook\'s default '
      + '`onError: \'abort\'` that aborts the triggering write). Stamp the value from the record\'s own '
      + 'before-hook (`ctx.input.<field> = ...`), or leave this handler bundled so it runs in-process '
      + 'where `sudo()` exists',
  },
  // [#16249] Same family as `.sudo(` above, one layer over: the host
  // `ObjectRepository` aliases `create(data)` to `insert(data)`, the spec
  // contract `IScopedObjectRepository` declares `insert` and NOT `create`
  // (packages/spec/src/contracts/scoped-context.ts — `create` is listed there
  // as measured and deliberately excluded), and the VM installs exactly
  // `insert / update / delete / updateMany / deleteMany / upsert` as the
  // `ctx.api.object()` write leaves (`installCtx`,
  // runtime/src/sandbox/quickjs-runner.ts). So a lowered body's `.create()` is
  // `TypeError: not a function` on its FIRST run, and under a hook's default
  // `onError: 'abort'` that aborts the triggering write with a message naming
  // no member — the blind message #14010 measured for `sudo()`.
  //
  // What made this worse than an omission: the extractor ledger
  // (`HOOK_BODY_WRITE_PATTERNS`, packages/lint) ADVERTISED `.create({…})` as
  // legal `api-crud-literal` syntax and graded its payload as a live write, so
  // the one layer that actively told an author how to write it named a spelling
  // that cannot run. That entry is withdrawn in the same change; refusing here
  // is what makes build time say what the contract already said.
  //
  // ⛔ The alternative — installing a `create` leaf in `installCtx` — is
  // rejected on purpose: it would have the SANDBOX ratify a verb the CONTRACT
  // never declared, which is the wrong direction under contract-first.
  //
  // Receiver-loose like `.sudo(` (a local alias `const repo =
  // ctx.api.object('x'); repo.create(…)` must not slip through), with ONE
  // carve-out that `.sudo(` needs no equivalent of: `Object` is a real sandbox
  // global (pinned in `SANDBOX_GLOBALS`), so `Object.create(null)` is working,
  // lowerable code. Refusing it would turn a correct body into a bundled
  // closure — and a hard failure under `--strict-body` — which is a false
  // refusal, not the safe direction. The lookbehind excludes that ONE receiver
  // and nothing else: `myObject.create(` still matches, because `\b` requires a
  // word boundary before `Object`.
  {
    rx: /(?<!\bObject\s*)\.\s*create\s*\(/,
    reason:
      '`create()` is not reachable from a sandboxed body — the VM\'s `ctx.api.object()` installs '
      + '`insert` / `update` / `delete` / `updateMany` / `deleteMany` / `upsert` and no `create` leaf, so '
      + 'the call is a TypeError at run time (and under a hook\'s default `onError: \'abort\'` that aborts '
      + 'the triggering write). Spell the same payload `.insert({ ... })`, which is the member the sandbox '
      + 'actually has and the only insert verb the spec contract declares; `Object.create()` is unaffected. '
      + 'Alternatively leave this handler bundled so it runs in-process, where the host repository\'s '
      + '`create()` alias exists',
  },
  // [#22810] Same family as `.sudo(` / `.create(`, one surface over: not a
  // member of `ctx.api` but of the context itself. The omission is the DECLARED
  // contract — `HookContextSchema.dispatch` (packages/spec/src/data/hook.zod.ts)
  // says the body face carries `{ mode, index }` "and not `scope`", and
  // `buildSandboxContext` (runtime/src/sandbox/body-runner.ts) copies exactly
  // those two: `scope`'s contract is shared object identity across every
  // dispatch of one write, which a JSON copy into the VM heap cannot keep. So a
  // body writing `ctx.dispatch.scope.<key>` is `TypeError: cannot set property
  // … of undefined` on its first run — measured through `bootStack`'s artifact
  // door as a `SandboxError` with no code, and `500 INTERNAL_ERROR` over REST,
  // where the in-process handler stores the row.
  //
  // ⛔ Marshalling `scope` instead is a second published body contract, not a
  // fix (the spec text: "a body needing it is the signal to raise that
  // question, not to add it silently").
  //
  // Reach, and the one wrinkle: `scope` is an ordinary field name (platform
  // objects declare it), so a bare receiver-loose `.scope` would refuse
  // `ctx.input.scope` — working code. Two narrowings keep the alias reach
  // without that: the body must name `dispatch` somewhere, and the member must
  // hang off `dispatch` or a ROOT identifier (see `ROOT_RECEIVER`). Caught:
  // `ctx.dispatch.scope`, `?.`, brackets, `const d = ctx.dispatch; d.scope`,
  // `const { dispatch } = ctx; dispatch.scope`, `const { scope } =
  // ctx.dispatch`, `const { dispatch: { scope } } = ctx`. Over-refused (the
  // safe direction — the handler is bundled and runs): a dispatch-naming body
  // that also reads `.scope` off a root-bound row, or spells `x.scope` inside a
  // string. Knowingly NOT caught: a computed key (`ctx.dispatch[k]`),
  // `Reflect.get(ctx.dispatch, 'scope')`, and a parenthesised or indexed
  // receiver (`(ctx.dispatch).scope`). A handler that destructures `dispatch`
  // in its PARAMETER list IS caught since #22837: the hook face re-emits that
  // pattern as `var { dispatch: { scope } } = ctx;` ahead of the body, and this
  // scan reads the rebound source.
  {
    rx: DISPATCH_SCOPE_RX,
    reason:
      '`ctx.dispatch.scope` is not reachable from a sandboxed body — the VM\'s `ctx.dispatch` carries '
      + 'only `mode` and `index` (`scope` is shared object identity across every dispatch of one write, '
      + 'which a copy into the sandbox cannot keep), so writing through it is a TypeError at run time '
      + '(and under a hook\'s default `onError: \'abort\'` that aborts the triggering write) and a '
      + 'guarded read sees `undefined`. Do the batch-scoped work once, at `ctx.dispatch.index === 0`, '
      + 'or keep cross-dispatch state in the record itself through `ctx.api`; `ctx.dispatch.mode` and '
      + '`ctx.dispatch.index` are unaffected. Alternatively leave this handler bundled so it runs '
      + 'in-process, where the engine\'s shared `scope` exists',
  },
  // [#22810] The sibling: `HookContextSchema.submitted` is "NOT marshalled into
  // the sandboxed `body` face, for the same reason `dispatch.scope` is not",
  // and `buildSandboxContext` assembles the face key by key without it. A
  // lowered body reads `undefined` — measured: `typeof ctx.submitted` is
  // `'object'` in-process on an update and `'undefined'` from the artifact —
  // so a guard written on it evaluates as if nothing were submitted, with no
  // error at all. The silent half of this family, which is why it is refused
  // rather than left to fail at run time.
  //
  // Reach: `ROOT_RECEIVER`, ungated — no `dispatch`-style anchor exists for a
  // top-level context member. `ctx.input.submitted` / `ctx.previous.submitted`
  // (a field of that name, read through a record image) are NOT refused.
  // Over-refused: `.submitted` off a root-bound row (`row.submitted`), a
  // destructured field of that name (`const { submitted } = ctx.input`), and
  // `x.submitted` inside a string. Knowingly NOT caught: computed keys,
  // `Reflect.get`, and a parenthesised receiver. Parameter-list destructuring
  // (`async ({ input, submitted }) => …`) is caught through the rebind, as
  // above.
  {
    rx: SUBMITTED_RX,
    reason:
      '`ctx.submitted` is not reachable from a sandboxed body — the VM\'s `ctx` is assembled key by key '
      + 'and does not carry the caller\'s submission, so it reads `undefined` there: a guard written on it '
      + 'evaluates as if nothing were submitted, and reaching into it is a TypeError at run time. To '
      + 'derive a value from a read-only field, read the stored row on `ctx.previous`, which is the '
      + 'correct source either way. Alternatively leave this handler bundled so it runs in-process, '
      + 'where `ctx.submitted` carries the caller\'s submission on update',
  },
  // [#22837] The rest of the family, found by deriving it rather than by
  // waiting for the next report: the members `HookContextSchema`
  // (packages/spec/src/data/hook.zod.ts) declares, that objectql's engine sets
  // on every hook-context assembly site, and that `buildSandboxContext`
  // (runtime/src/sandbox/body-runner.ts) does not copy. Hook face only — they
  // are measured against the HOOK context; the action face's lowering is
  // unchanged.
  //
  // `provenance` is the silent half, like `submitted`: a guard on
  // `ctx.provenance?.flowRunId` reads `undefined` once lowered and evaluates as
  // if the write had no origin. ⛔ Marshalling it into the VM instead is a body
  // contract decision (the body face is declared key by key), not a fix to make
  // here — the same posture `dispatch.scope` records above.
  {
    rx: hookContextMemberRx('provenance'),
    face: 'hook',
    reason:
      '`ctx.provenance` is not reachable from a sandboxed body — the VM\'s `ctx` is assembled key by key '
      + 'and does not carry the write\'s provenance, so it reads `undefined` there: a guard written on '
      + '`ctx.provenance.flowRunId` or `ctx.provenance.attributedUserId` evaluates as if the write had no '
      + 'origin, and reaching into it is a TypeError at run time. A body has no equivalent today; leave '
      + 'this handler bundled so it runs in-process, where `ctx.provenance` carries the server-stamped marks',
  },
  // `ql` and `transaction` are live host objects — the engine, a driver
  // transaction handle — that a copy into the VM heap cannot carry, the
  // `.sudo(` shape one level up: real in-process, absent from the body.
  {
    rx: hookContextMemberRx('ql'),
    face: 'hook',
    reason:
      '`ctx.ql` is not reachable from a sandboxed body — the VM\'s `ctx` carries no engine handle (a live '
      + 'engine cannot be copied into the sandbox), so a call through it is a TypeError at run time (and '
      + 'under a hook\'s default `onError: \'abort\'` that aborts the triggering write). Reach other '
      + 'objects through `ctx.api.object(name)`, which is the body\'s data channel. Alternatively leave '
      + 'this handler bundled so it runs in-process, where `ctx.ql` exists',
  },
  {
    rx: hookContextMemberRx('transaction', { exemptCalls: true }),
    face: 'hook',
    reason:
      '`ctx.transaction` is not reachable from a sandboxed body — the VM\'s `ctx` carries no transaction '
      + 'handle (a live driver handle cannot be copied into the sandbox), so it reads `undefined` there. '
      + 'A body groups its writes with `ctx.api.transaction(fn)`, which is unaffected. Alternatively leave '
      + 'this handler bundled so it runs in-process, where `ctx.transaction` exists',
  },
];

const CAPABILITY_PATTERNS: Array<{ rx: RegExp; cap: 'api.read' | 'api.write' | 'crypto.uuid' | 'log' }> = [
  // Match `ctx.api.object(...)` directly OR a local alias like
  // `const api = ctx.api;` then `api.object(...)`. We accept any
  // identifier (or chain) ending in `.object(...)` followed by a known
  // read/write method — over-inclusive but safe (false-positive caps
  // get rejected at the runtime by the sandbox if not actually granted).
  { rx: /\.object\s*\([^)]+\)\s*\.\s*(?:find|findOne|count|aggregate|get|list)\b/, cap: 'api.read' },
  { rx: /\.object\s*\([^)]+\)\s*\.\s*(?:insert|update|upsert|delete|patch|remove|create)\b/, cap: 'api.write' },
  { rx: /ctx\.crypto\.randomUUID\b/, cap: 'crypto.uuid' },
  // NO `ctx.crypto.hash` pattern: the `crypto.hash` token was removed in spec 17
  // (#4391) because the sandbox never installed the function. Inferring a
  // capability from a call that always threw is what let `os build` bless a
  // dead body — the inference was the amplifier, not the safety net.
  { rx: /ctx\.log\.(?:info|warn|error|debug)\b/, cap: 'log' },
  // [#11293] `ctx.title(field)` — the RELATED-record form, and only that form.
  // `ctx.title()` resolves this record's title (formula included) from the
  // state the hook is already firing on and performs no read at all, so it
  // needs no capability and inferring one for it would tax the majority case
  // with a grant it never exercises. The argument form costs exactly one
  // `findOne` through the body's own read channel, which is the same read
  // `ctx.api.object(...).findOne()` would do and gets the same token.
  //
  // `[^)\s]` after the paren is what distinguishes the two: `ctx.title()` and
  // `ctx.title( )` do not match, `ctx.title('account_id')` does. Receiver-loose
  // like the `.object(...)` patterns above, for the same reason — a local alias
  // (`const t = ctx.title`) must not silently UNDER-infer, since that failure
  // arrives as a sandbox refusal at run time, far from its cause. Over-inferring
  // grants a token the body may not use, which the sandbox simply never checks.
  { rx: /\.\s*title\s*\(\s*[^)\s]/, cap: 'api.read' },
];

export interface ExtractedBody {
  /** Pure function-body source (without the surrounding `(ctx) => {...}`). */
  source: string;
  /**
   * Capability tokens INFERRED from the body source (see CAPABILITY_PATTERNS).
   * Inference is the only thing that fills this in: the comment-borne override
   * is retired (see this file's header). An author whose needs differ from what
   * inference derives writes `body.capabilities` on the hook instead.
   */
  capabilities: Array<'api.read' | 'api.write' | 'crypto.uuid' | 'log'>;
  /** True when source is a single expression (arrow with implicit return). */
  isExpression: boolean;
}

/**
 * Extract the body source from a HOOK handler. Throws on forbidden patterns.
 *
 * The published entry (`@objectstack/cli/hook-body`) and the `hook` face of
 * {@link extractLoweredBody}: what `os build` does to a `hooks[*].handler`, and
 * what `os lint` judges it by.
 */
export function extractHookBody(fn: (...a: unknown[]) => unknown, originLabel: string): ExtractedBody {
  return extractLoweredBody(fn, originLabel, 'hook');
}

/**
 * Extract the body source from a callable lowered for `face`. Throws on
 * forbidden patterns.
 *
 * `lowerCallables` and `os lint` call this with the face of the slot the
 * callable sits in — `hook` for `hooks[*].handler`, `action` for an action's
 * `target` — so both judge a callable by the wrapper its body will really run
 * in. Internal: the published entry is {@link extractHookBody}.
 */
export function extractLoweredBody(
  fn: (...a: unknown[]) => unknown,
  originLabel: string,
  face: LoweringFace,
): ExtractedBody {
  const raw = String(fn);

  // Strip leading function/arrow header and trailing closing brace so the
  // result is a pure block body suitable for `new Function('ctx', body)`.
  const block = peelToBlockBody(raw);
  if (!block) {
    throw new HookBodyExtractionError(
      'unparseable',
      originLabel,
      `[hook-body-extract] could not parse the body of ${originLabel}; ` +
        `please rewrite the handler as a single arrow function or named function expression`,
    );
  }

  // [#22837] The hook face binds `ctx` and nothing else, so the handler's own
  // parameter is re-emitted as the body's first statement — or the handler is
  // refused, naming the parameter, when that cannot be done faithfully. Every
  // check below reads the REBOUND source, so a member destructured in the
  // parameter list (`({ input, submitted })`) meets the same refusal as one
  // destructured in the body.
  const rebind = face === 'hook' ? planHookParameterRebind(raw, originLabel) : NO_REBIND;
  const source = rebind.prologue === ''
    ? block.source
    : rebind.prologue + (/^\s/.test(block.source) ? '' : ' ') + block.source;

  // Reject any forbidden token before we ship the source as metadata.
  for (const { rx, reason, face: only } of FORBIDDEN_PATTERNS) {
    if (only !== undefined && only !== face) continue;
    if (rx.test(source)) {
      throw new HookBodyExtractionError(
        'forbidden-token',
        originLabel,
        `[hook-body-extract] ${originLabel}: ${reason}\n` +
          `--- offending body source ---\n${source.slice(0, 400)}${source.length > 400 ? '…' : ''}`,
      );
    }
  }

  // #1876 — a handler that references a MODULE-SCOPE identifier (a helper, an
  // imported binding, a top-level const) is NOT self-contained: shipping it as
  // a metadata-only `body` would throw `ReferenceError` at runtime (the
  // reference ships without its definition). Detect those free identifiers and
  // throw — the caller catches this and keeps the handler in the BUNDLED form,
  // where esbuild carries the real closure along. The whole `fn` source (params
  // included) is analyzed so parameters are correctly in scope — which, on the
  // hook face, is now TRUE of the lowered body too: the rebind above binds them.
  const { free, nodeOnly, unparsed } = detectFreeIdentifiers(raw);
  if (!unparsed && free.length > 0) {
    throw new HookBodyExtractionError(
      'free-identifiers',
      originLabel,
      freeIdentifierRefusal(originLabel, free, nodeOnly),
      free,
      nodeOnly,
    );
  }

  // Infer capabilities from API surface usage.
  const inferred = new Set<ExtractedBody['capabilities'][number]>();
  for (const { rx, cap } of CAPABILITY_PATTERNS) {
    if (rx.test(source)) inferred.add(cap);
  }
  // [#22837] The ctx-anchored patterns above spell `ctx.`; a rebound body
  // reaches the same members through the handler's own names.
  for (const cap of reboundCapabilities(source, rebind)) inferred.add(cap);

  return {
    source,
    capabilities: [...inferred].sort(),
    isExpression: block.isExpression,
  };
}

/**
 * The closed set of host names the sandbox answers with a FIRST-CLASS
 * replacement, so the refusal can name it.
 *
 * Deliberately one entry, not a mechanism. `console` is the host-only name an
 * ordinary handler is most likely to reach for, and "keep it in a string
 * handler ref" is poor advice for a log line when the platform's own answer is
 * one capability away. Every other member of `NODE_ONLY_GLOBALS` has no
 * in-sandbox equivalent to point at, and inventing one per name would be a
 * second, unmeasured contract growing beside the measured set.
 */
const SANDBOX_REPLACEMENTS: Readonly<Record<string, string>> = {
  console: 'For logging specifically the sandbox has `ctx.log` — declare the `log` capability and '
    + 'call `ctx.log.info(...)`.',
};

/**
 * The prose for a `free-identifiers` refusal.
 *
 * ⛔ The module-scope-only sentence is BYTE-IDENTICAL to what this function
 * threw before #14301 — `os build`'s warn-and-bundle line, `--strict-body`'s
 * per-callable diagnostic and `content/docs/automation/hook-bodies.mdx` all
 * quote it, and a refusal that reads differently would be a documentation break
 * wearing a refactor's clothes. The host-only branch is ADDITIONAL prose for a
 * case that could not previously arrive here at all (the names were allowlisted
 * away), so it breaks no quotation.
 *
 * The two branches exist because the remedies are opposite and a wrong remedy
 * is worse than none: "inline the helper" is impossible for `Intl`, and an
 * author (or a code-writing model) who tries it lands on a second broken shape.
 */
function freeIdentifierRefusal(
  originLabel: string,
  free: readonly string[],
  nodeOnly: readonly string[],
): string {
  const head =
    `[hook-body-extract] ${originLabel}: handler references identifier(s) not in scope at runtime: ` +
    `${free.join(', ')}. `;

  if (nodeOnly.length === 0) {
    return (
      head +
      `Module-scope helpers/imports aren't shipped with a metadata-only body, so ` +
      `this handler will be BUNDLED instead (no behavior change). To make it body-only, inline the ` +
      `helper(s) into the handler or move the logic behind \`ctx\` (e.g. \`ctx.api\`).`
    );
  }

  const names = nodeOnly.join(', ');
  const isAre = nodeOnly.length === 1 ? 'is' : 'are';
  const itThem = nodeOnly.length === 1 ? 'it' : 'them';
  const moduleScope = free.filter((n) => !nodeOnly.includes(n));
  const tail =
    moduleScope.length > 0
      ? ` The remaining name(s) — ${moduleScope.join(', ')} — are module-scope helpers/imports: ` +
        `inline them into the handler or move the logic behind \`ctx\` (e.g. \`ctx.api\`).`
      : '';
  const hint = nodeOnly.map((n) => SANDBOX_REPLACEMENTS[n]).filter(Boolean).join(' ');

  return (
    head +
    `${names} ${isAre} not available in the hook sandbox — the QuickJS build the runtime evaluates a ` +
    `lowered body in does not provide ${itThem}, so the body would throw ReferenceError in production ` +
    `while validate, typecheck, test and build all stay green (they run the raw function in Node, ` +
    `where ${itThem} exist${nodeOnly.length === 1 ? 's' : ''}). This handler will be BUNDLED instead ` +
    `(no behavior change). To keep it as metadata, keep the check in a string handler ref — put the ` +
    `function in the top-level \`functions:\` map and write \`handler: 'fn_name'\` — or move it to a ` +
    `validation rule.${hint ? ' ' + hint : ''}` +
    tail
  );
}

/**
 * What the hook face prepends to a lowered body, and the names the rebound
 * body reaches the context through (#22837).
 */
interface ParameterRebind {
  /** `var <param> = ctx;` — or `''` when the parameter already is `ctx`, or there is none. */
  prologue: string;
  /** Names bound to the WHOLE context: an identifier parameter, an object-rest element. */
  contextRoots: readonly string[];
  /** Names bound to ONE capability-bearing member: `({ log: l })` binds `l` to `ctx.log`. */
  memberLocals: Readonly<Record<'log' | 'crypto' | 'title', readonly string[]>>;
}

const NO_REBIND: ParameterRebind = { prologue: '', contextRoots: [], memberLocals: { log: [], crypto: [], title: [] } };

/**
 * The context members {@link CAPABILITY_PATTERNS} infers a token from. A
 * destructuring parameter that reaches one of them must bind it to a plain
 * name, which {@link reboundCapabilities} can follow; a nested pattern or a
 * computed key under one of them could not be followed, and a body the build
 * under-grants is refused by the sandbox at run time.
 */
const CAPABILITY_BEARING_MEMBERS: ReadonlySet<string> = new Set(['api', 'log', 'crypto', 'title']);

/**
 * A hook-face refusal that names the PARAMETER, in the family's wording: what
 * the sandbox cannot supply, why that fails at run time, the remedy, and the
 * bundled alternative.
 */
function parameterRefusal(originLabel: string, raw: string, reason: string): HookBodyExtractionError {
  return new HookBodyExtractionError(
    'forbidden-token',
    originLabel,
    `[hook-body-extract] ${originLabel}: ${reason}. Alternatively leave this handler bundled so it runs ` +
      `in-process, where it receives the context under whatever parameter it declares\n` +
      `--- offending handler source ---\n${raw.slice(0, 400)}${raw.length > 400 ? '…' : ''}`,
  );
}

/**
 * Plan the hook face's parameter rebind (#22837), or refuse the handler.
 *
 * The runtime runs a hook body as `(async (ctx) => { SOURCE })`, and objectql
 * calls an in-process hook handler as `handler(ctx)` — one argument, the
 * context. So a handler's ONE parameter is the context under the author's
 * name, and re-emitting it as `var <param> = ctx;` ahead of the body runs the
 * author's code as written. The parameter is read off the TypeScript parse of
 * the handler that {@link detectFreeIdentifiers} already performs (one parse,
 * so the free-identifier verdict and this rebind agree on what the parameter
 * binds), never off the regex peel.
 *
 * `var`, not `const`: a parameter is a mutable, function-scoped binding. A
 * handler may reassign it (`input = { ...input }` off a `({ input })`), which a
 * `const` would turn into a TypeError the in-process handler never throws, and a
 * body may re-declare it with `var`, which a `let`/`const` would turn into a
 * SyntaxError. `var` is the one spelling with a parameter's semantics.
 *
 * Refused, naming the parameter, is what cannot be re-emitted faithfully: more
 * than one parameter (the second has nothing to bind to), a default value and a
 * rest parameter (neither survives as a plain binding of `ctx`), a pattern that
 * binds the name `ctx` itself, a body that declares `ctx` (or the parameter's
 * own names) with `let` / `const` / `class` / `function` where the prologue
 * would read it, and a destructured capability-bearing member the capability
 * inference cannot follow. A handler whose parameter is `ctx`, or that takes
 * none, gets no prologue: it lowers byte-identically to before.
 */
function planHookParameterRebind(raw: string, originLabel: string): ParameterRebind {
  const fn = parseFunction(raw);
  if (!fn) {
    throw new HookBodyExtractionError(
      'unparseable',
      originLabel,
      `[hook-body-extract] could not read the parameter list of ${originLabel}; ` +
        `please rewrite the handler as a single arrow function or named function expression`,
    );
  }
  const params = fn.parameters;
  if (params.length === 0) return NO_REBIND;

  if (params.length > 1) {
    throw parameterRefusal(
      originLabel,
      raw,
      `the handler takes ${params.length} parameters (${params.map((p) => `\`${p.getText()}\``).join(', ')}), and a ` +
        `lowered hook body is run with exactly one binding, \`ctx\` — the context, which is also the only ` +
        `argument an in-process hook handler is called with. The build rebinds the first parameter to it; the ` +
        `others have nothing to bind to, so a body naming them throws a ReferenceError at run time. Take the ` +
        `context as the one parameter (under any name, or as a destructuring pattern)`,
    );
  }

  const [param] = params;
  const text = param.getText();
  if (param.dotDotDotToken) {
    throw parameterRefusal(
      originLabel,
      raw,
      `the rest parameter \`${text}\` cannot be rebound to the one binding a lowered hook body is run with, ` +
        `\`ctx\`, so a body naming it throws a ReferenceError at run time. Take the context as the one ` +
        `parameter (under any name, or as a destructuring pattern)`,
    );
  }
  if (param.initializer) {
    throw parameterRefusal(
      originLabel,
      raw,
      `the parameter \`${text}\` carries a default value, which a lowered hook body cannot reproduce: the ` +
        `build re-emits the parameter as a plain binding of \`ctx\`, the one name the sandbox binds. The ` +
        `context is always passed, so drop the default`,
    );
  }

  const name = param.name;
  if (ts.isIdentifier(name) && name.text === 'ctx') return NO_REBIND;

  const bound = bindingNames(name);
  if (bound.includes('ctx')) {
    throw parameterRefusal(
      originLabel,
      raw,
      `the parameter \`${text}\` binds a name \`ctx\`, which is the name a lowered hook body receives the ` +
        `context under, so the build cannot re-emit it as a binding of that context. Rename that binding`,
    );
  }
  const clash = shadowingDeclarations(fn).find((n) => n === 'ctx' || bound.includes(n));
  if (clash !== undefined) {
    throw parameterRefusal(
      originLabel,
      raw,
      `the handler declares \`${clash}\` in its body with \`let\` / \`const\` / \`class\` / \`function\`, and ` +
        `a lowered hook body re-emits the parameter \`${text}\` as \`var ${text} = ctx;\` in that same scope, ` +
        `which that declaration would shadow or collide with. Rename the declaration`,
    );
  }

  const contextRoots: string[] = [];
  const memberLocals: Record<'log' | 'crypto' | 'title', string[]> = { log: [], crypto: [], title: [] };
  if (ts.isIdentifier(name)) {
    contextRoots.push(name.text);
  } else if (ts.isObjectBindingPattern(name)) {
    for (const el of name.elements) {
      if (el.dotDotDotToken) {
        if (ts.isIdentifier(el.name)) contextRoots.push(el.name.text);
        continue;
      }
      const key = el.propertyName
        ? ts.isIdentifier(el.propertyName) || ts.isStringLiteral(el.propertyName)
          ? el.propertyName.text
          : undefined
        : ts.isIdentifier(el.name)
          ? el.name.text
          : undefined;
      if (key !== undefined && !CAPABILITY_BEARING_MEMBERS.has(key)) continue;
      if (key === undefined || !ts.isIdentifier(el.name)) {
        throw parameterRefusal(
          originLabel,
          raw,
          `the parameter \`${text}\` reaches ${key === undefined ? 'a context member through a computed key' : `\`ctx.${key}\` through a nested pattern`}, ` +
            `which the build's capability inference cannot follow, so the lowered body would be refused the ` +
            `capability it uses at run time. Destructure ${key === undefined ? 'the member' : `\`${key}\``} to a plain name ` +
            `(\`{ ${key ?? 'log'} }\`), or read it as \`ctx.${key ?? 'log'}\``,
        );
      }
      if (key !== 'api') memberLocals[key as 'log' | 'crypto' | 'title'].push(el.name.text);
    }
  }

  return { prologue: `var ${name.getText()} = ctx;`, contextRoots, memberLocals };
}

/** Every name a parameter's binding (an identifier or a pattern) introduces. */
function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const out: string[] = [];
  for (const el of name.elements) {
    if (ts.isBindingElement(el)) out.push(...bindingNames(el.name));
  }
  return out;
}

/**
 * The names a handler's body declares where the rebind prologue would meet
 * them: `let` / `const` / `class` and `function` declarations among the body's
 * own statements (a `let`/`const` of `ctx` collides with the wrapper's
 * parameter; a `function` declaration of it is hoisted over it), and `function`
 * declarations in nested blocks too (sloppy-mode block functions are hoisted
 * onto a `var` of the same name, which the prologue's binding now is). `var` is
 * deliberately absent: it re-declares the same binding the prologue writes.
 * Nested functions and classes are their own scope and are not entered.
 */
function shadowingDeclarations(fn: ts.FunctionLikeDeclarationBase): string[] {
  const out: string[] = [];
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return out;
  const visitBlockFunctions = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) {
      if (node.name) out.push(node.name.text);
      return;
    }
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    ts.forEachChild(node, visitBlockFunctions);
  };
  for (const stmt of body.statements) {
    if (ts.isVariableStatement(stmt) && stmt.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) {
      for (const decl of stmt.declarationList.declarations) out.push(...bindingNames(decl.name));
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      out.push(stmt.name.text);
    } else {
      visitBlockFunctions(stmt);
    }
  }
  return out;
}

/** A name, escaped for use inside a `RegExp` source. */
function escapeRx(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The capability tokens a REBOUND body needs through the handler's own names
 * (#22837). {@link CAPABILITY_PATTERNS} spells `ctx.log.` and
 * `ctx.crypto.randomUUID`; after the rebind the same members are reached as
 * `hookCtx.log.info(…)` or, off `({ log })`, as `log.info(…)`, and a token the
 * build does not infer is a sandbox refusal at run time. Each pattern below is
 * its `ctx`-anchored sibling with the receiver renamed and nothing else, so a
 * renamed handler infers exactly what the same handler named `ctx` infers.
 * `api` needs nothing here: the `.object(…)` patterns are receiver-loose, and a
 * receiver-loose `.title(…)` already covers a context root.
 */
function reboundCapabilities(source: string, rebind: ParameterRebind): Array<ExtractedBody['capabilities'][number]> {
  const out: Array<ExtractedBody['capabilities'][number]> = [];
  const root = (n: string): string => String.raw`(?<![\w$])${escapeRx(n)}`;
  for (const r of rebind.contextRoots) {
    if (new RegExp(String.raw`${root(r)}\.log\.(?:info|warn|error|debug)\b`).test(source)) out.push('log');
    if (new RegExp(String.raw`${root(r)}\.crypto\.randomUUID\b`).test(source)) out.push('crypto.uuid');
  }
  for (const l of rebind.memberLocals.log) {
    if (new RegExp(String.raw`${root(l)}\.(?:info|warn|error|debug)\b`).test(source)) out.push('log');
  }
  for (const l of rebind.memberLocals.crypto) {
    if (new RegExp(String.raw`${root(l)}\.randomUUID\b`).test(source)) out.push('crypto.uuid');
  }
  for (const l of rebind.memberLocals.title) {
    if (new RegExp(String.raw`${root(l)}\s*\(\s*[^)\s]`).test(source)) out.push('api.read');
  }
  return out;
}

interface PeeledBody {
  source: string;
  isExpression: boolean;
}

/**
 * Remove the parameter list and outermost braces from a function string,
 * yielding the bare statements (or expression for shorthand arrows).
 */
function peelToBlockBody(raw: string): PeeledBody | null {
  // Try arrow forms first since they're the dominant authoring style.
  // Match the parameter list followed by `=>` and either `{...}` or expr.
  // We rely on a manual brace scan rather than a single regex so braces
  // inside string/template literals don't confuse us.
  const arrowIdx = findTopLevelArrow(raw);
  if (arrowIdx >= 0) {
    const after = raw.slice(arrowIdx + 2).trimStart();
    if (after.startsWith('{')) {
      const body = sliceBalanced(after, '{', '}');
      if (body) return { source: body.inner, isExpression: false };
    } else {
      // Implicit-return arrow — wrap as `return ...;`
      const expr = after.replace(/[;\s]+$/g, '');
      return { source: `return (${expr});`, isExpression: true };
    }
  }

  // function () { ... } / async function () { ... }
  const fnIdx = raw.search(/\bfunction\b/);
  if (fnIdx >= 0) {
    const braceIdx = raw.indexOf('{', fnIdx);
    if (braceIdx > 0) {
      const body = sliceBalanced(raw.slice(braceIdx), '{', '}');
      if (body) return { source: body.inner, isExpression: false };
    }
  }

  // Method shorthand inside an object literal: `name(ctx) { ... }`.
  const braceIdx = raw.indexOf('{');
  if (braceIdx > 0) {
    const body = sliceBalanced(raw.slice(braceIdx), '{', '}');
    if (body) return { source: body.inner, isExpression: false };
  }
  return null;
}

function findTopLevelArrow(s: string): number {
  // Skip past balanced parameter list `(...)` then expect `=>`.
  // We scan looking for `(` not preceded by an identifier char and
  // immediately matched by a balanced `)` then optional whitespace then `=>`.
  let i = 0;
  const len = s.length;
  while (i < len) {
    if (s[i] === '(') {
      const closing = matchBalancedIndex(s, i, '(', ')');
      if (closing < 0) return -1;
      let j = closing + 1;
      while (j < len && /\s/.test(s[j])) j++;
      if (s[j] === '=' && s[j + 1] === '>') return j;
      i = closing + 1;
      continue;
    }
    i++;
  }
  return -1;
}

function matchBalancedIndex(s: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function sliceBalanced(s: string, open: string, close: string): { inner: string } | null {
  const end = matchBalancedIndex(s, 0, open, close);
  if (end < 0) return null;
  return { inner: s.slice(1, end) };
}
