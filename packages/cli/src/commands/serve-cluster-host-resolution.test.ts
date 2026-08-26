// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os serve` loads the cluster gate and its driver AS THE HOST APP DECLARES
 * THEM, not from the CLI's own `node_modules`.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * Measured on a published EE image: with `OS_CLUSTER_DRIVER=redis` set, boot
 * died with
 *
 *     Cannot find package '@objectstack/service-cluster' imported from
 *     /repo/objectstack/packages/cli/dist/commands/serve.js
 *
 * The CLI's own `node_modules/@objectstack/` held 48 packages and NEITHER
 * cluster package; both were installed only under the app, which declares them.
 * `serve.ts` reached them through a bare dynamic `import()`, and Node ESM
 * resolves a bare specifier against the IMPORTER's realpath — the CLI's, inside
 * the framework workspace. So the one hop that could not work was CLI to app,
 * while app-side code loaded the very same packages fine.
 *
 * ── Why this is not fixed by declaring the packages ──────────────────────
 *
 * Adding `@objectstack/service-cluster*` to `packages/cli`'s dependencies would
 * silence this driver and leave the class open: the next app-declared optional
 * package the CLI advertises it will load breaks identically, a third-party
 * cluster driver can never work, and the open-core CLI would take a static
 * dependency on packages that ship with a distribution — the exact coupling the
 * non-literal specifier in `serve.ts` exists to avoid. The fix is to resolve
 * from the host app, which is what `createHostImporter` already does for the
 * organizations / capability loads further down `serve`.
 *
 * ── What is pinned here ──────────────────────────────────────────────────
 *
 * 1. The BOUNDARY, behaviourally and hermetically: a package that exists only
 *    in a host app's `node_modules` is invisible to a bare import from this
 *    file (which sits in `packages/cli`, the same resolution base as the
 *    shipped `dist/commands/serve.js`) and IS loadable through the host
 *    importer. The fixture package is synthetic on purpose — the contract is
 *    "any app-declared optional package", not "these two cluster packages", and
 *    a synthetic one needs nothing built.
 *
 * 2. The REACHABILITY of the helper, by source scan. This is the half that
 *    actually regressed, twice: `importFromHost` used to be a `const` bound
 *    partway down one very long boot function, so it existed only BELOW its own
 *    binding. A load placed above it is not a compile error — the author writes
 *    a bare `import()`, which resolves from the CLI and is green in any dev
 *    checkout where everything is hoisted into one `node_modules`. The first
 *    time it cost the enterprise organizations load (cloud#1013); the second
 *    time it cost EE multi-node boot outright (#10645).
 *
 *    #10769 closed the class rather than hoisting a third time: the helper is
 *    now a module-scope FUNCTION DECLARATION, hoisted over the entire module, so
 *    "above the definition" is not a state this file can be in. The scan below
 *    pins that shape — a `const`, or a declaration nested inside a function,
 *    fails — which is strictly stronger than the ordering check it replaced.
 *
 * 3. EVERY app-declarable optional load, by source scan (#10769). The cluster
 *    pair was only the instance that happened to ship. A package is treated as
 *    app-declarable exactly when `packages/cli`'s own manifest does not declare
 *    it — mechanically, so a newly added optional package is covered without
 *    anyone remembering this file. Bare `import()` of such a package fails.
 *
 * 4. The DIRECTION of the scan's own ignorance (#12162). A specifier the scan
 *    cannot resolve carries no package name, so it falls OUT of the judged
 *    population rather than into it: the sweep does not report the load as
 *    unknowable, it reports nothing at all and keeps passing over the
 *    remainder. That is how the `@objectstack/organizations` load left this
 *    sweep during #11614, and teaching the resolver one more spelling each time
 *    only moves the boundary — it never makes crossing it audible.
 *
 *    So an unresolved specifier is a FAILURE naming the file, the line, the
 *    callee and the specifier text, for every callee, unless the site is
 *    DECLARED out of the sweep with its reason — and a declaration that matches
 *    no live site fails too. The declarations are kept per callee: a bare
 *    `import()` may never inherit the reason written for a host-anchored load.
 *
 * The source scan reads `serve.ts` and `package.json` from THIS package, so no
 * cross-package test input is declared or needed.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHostImporter } from '@objectstack/types/node';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `packages/cli/src/commands/serve.ts` — same package, no escaping read. */
const SERVE_SOURCE = readFileSync(resolve(HERE, 'serve.ts'), 'utf8');

/** `packages/cli/package.json` — the CLI's OWN declared dependency surface. */
const CLI_MANIFEST = JSON.parse(
  readFileSync(resolve(HERE, '..', '..', 'package.json'), 'utf8'),
) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

/**
 * What the CLI itself declares, and therefore what a bare `import()` from
 * `dist/commands/serve.js` can actually resolve. `devDependencies` are
 * deliberately excluded: they are not installed beside a published CLI.
 */
const CLI_DECLARES = new Set([
  ...Object.keys(CLI_MANIFEST.dependencies ?? {}),
  ...Object.keys(CLI_MANIFEST.peerDependencies ?? {}),
  ...Object.keys(CLI_MANIFEST.optionalDependencies ?? {}),
]);

/**
 * Blank out comments, preserving every byte offset and every newline, so the
 * sweep below reads CODE only.
 *
 * This matters more than it looks: `serve.ts` discusses `import()` in prose all
 * over its comments (including the note that describes this very defect), and a
 * naive scan matches those and reports hazards that do not exist. Strings and
 * template literals are tracked so a `'http://…'` literal is not mistaken for a
 * line comment.
 */
function stripComments(src: string): string {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  let prevCode = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++; prevCode = c; continue;
    }
    if (c === '`') {
      i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          let depth = 1; i += 2;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
          }
          continue;
        }
        i++;
      }
      i++; prevCode = '`'; continue;
    }
    if (c === '/' && /[=(,:[!&|?+\-*%^~{;]/.test(prevCode)) { // regex literal
      i++;
      while (i < n && src[i] !== '/') {
        if (src[i] === '\\') i++;
        else if (src[i] === '[') { while (i < n && src[i] !== ']') { if (src[i] === '\\') i++; i++; } }
        i++;
      }
      i++; prevCode = '/'; continue;
    }
    if (!/\s/.test(c)) prevCode = c;
    i++;
  }
  return out.join('');
}

/** `serve.ts` with comments blanked — offsets and line numbers preserved. */
const SERVE_CODE = stripComments(SERVE_SOURCE);

type LoadSite = {
  /** 1-based line in `serve.ts`. */
  line: number;
  callee: 'import' | 'importFromHost';
  /** The argument source text, whitespace-collapsed. */
  argument: string;
  /** The literal specifier, when the scan can determine one statically. */
  specifier?: string;
  /** Bare package name of `specifier` (`@scope/name`), when it names a package. */
  packageName?: string;
};

/**
 * Read the FIRST argument of the call whose `(` is at `open` — the specifier.
 *
 * Reading the WHOLE argument list is a way to lose a load: the two-argument
 * `importFromHost(pluginSpecifier, root)` came out as the argument text
 * `pluginSpecifier, root`, which matches no specifier shape, so the site
 * classified as unresolvable for a reason that has nothing to do with its
 * specifier. Brackets and string/template literals are tracked so a comma inside
 * either does not end the argument.
 */
function firstArgumentAt(code: string, open: number): string {
  let depth = 0;
  let out = '';
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      if (depth === 1 && c === '(') continue;
      out += c;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) break;
      out += c;
      continue;
    }
    if (depth === 1 && c === ',') break;      // end of the first argument
    if (c === '"' || c === "'" || c === '`') { // copy a literal whole
      const quote = c;
      out += c;
      i++;
      while (i < code.length && code[i] !== quote) {
        if (code[i] === '\\') { out += code[i]; i++; }
        if (i < code.length) { out += code[i]; i++; }
      }
      if (i < code.length) out += code[i];
      continue;
    }
    out += c;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** `@scope/name/sub` → `@scope/name`. Paths, URLs and `node:` builtins → undefined. */
function packageNameOf(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes(':')) {
    return undefined;
  }
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Resolve `const X = '<literal>'` — the idiom `serve.ts` uses everywhere to keep
 * `tsc` from statically resolving an optional package
 * (`const i18nPkg = '@objectstack/service-i18n'`) — and one further hop,
 * `const X = Serve.MEMBER`, where `MEMBER` is a `static readonly` string on the
 * command class in this same file.
 *
 * The second hop is not a convenience. #11614 single-sourced the
 * `@objectstack/organizations` spelling onto `Serve.ORGANIZATIONS_RUNTIME_PKG`
 * so the spec-owned provenance roster could pin it, and a resolver that stopped
 * one hop short turned that load from "app-declarable, host-anchored, checked"
 * into "unknowable".
 *
 * ── `before`: the resolver may only look BACKWARDS ───────────────────────────
 *
 * The search is confined to the source ABOVE the call and takes the NEAREST
 * preceding binding, because a `const` only exists below itself — the same
 * temporal-dead-zone fact #10769 pinned for `importFromHost`. Unconfined, the
 * match is a whole-file FIRST-HIT search for `const <name> =`, and in a
 * 5000-line file that is a coin toss: `importFromHost(pkg)` inside
 * `loadOptionalServicePlugin`, whose `pkg` is a PARAMETER, resolved against a
 * `const pkg = Serve.ORGANIZATIONS_RUNTIME_PKG` in an unrelated string helper
 * 1160 lines FURTHER DOWN. The sweep then reported an organizations load that
 * does not exist at that line — worse than reporting nothing, because the named
 * vacuity list below is satisfied by the phantom.
 *
 * Resolving may only ever WIDEN what the sweep judges. When it cannot resolve,
 * it says so and the site is reported; it never excuses a load.
 */
function resolveIdentifier(code: string, name: string, before: number): string | undefined {
  const region = code.slice(0, before);
  const candidates: Array<{ index: number; literal?: string; member?: string }> = [];

  for (const m of region.matchAll(
    new RegExp(`\\bconst\\s+${name}\\s*(?::\\s*string\\s*)?=\\s*(['"\`])([^'"\`]*)\\1`, 'g'),
  )) {
    candidates.push({ index: m.index ?? 0, literal: m[2] });
  }

  // `const organizationsPkg = Serve.ORGANIZATIONS_RUNTIME_PKG;` (#11614)
  for (const m of region.matchAll(
    new RegExp(`\\bconst\\s+${name}\\s*(?::\\s*string\\s*)?=\\s*Serve\\.([A-Za-z_$][\\w$]*)\\s*;`, 'g'),
  )) {
    candidates.push({ index: m.index ?? 0, member: m[1] });
  }

  candidates.sort((a, b) => a.index - b.index);
  const nearest = candidates.at(-1);
  if (!nearest) return undefined;
  if (nearest.literal !== undefined) return nearest.literal;

  // A `static readonly` is a property of the class object rather than a binding,
  // so its position relative to the call carries no meaning: this hop reads the
  // whole file, and the anchor that keeps it honest is the `Serve.` prefix.
  const member = code.match(
    new RegExp(`\\bstatic\\s+readonly\\s+${nearest.member}\\s*(?::\\s*string\\s*)?=\\s*(['"\`])([^'"\`]*)\\1`),
  );
  return member?.[2];
}

/**
 * Every dynamic load in `serve.ts`, bare or host-anchored.
 *
 * `function importFromHost(` is deliberately NOT a load site: the regex below
 * matches the helper's own DECLARATION as readily as a call to it, and that
 * phantom site can never have a specifier — so it sat in the population forever
 * as a permanently unresolvable entry, inflating the vacuity floors by one and
 * guaranteeing at least one member of any "cannot resolve" report is noise.
 */
function collectLoadSites(code: string): LoadSite[] {
  const sites: LoadSite[] = [];
  const re = /\b(?:await\s+)?(importFromHost|import)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    // `function importFromHost(...)` — the definition, not a load.
    if (/\bfunction\s+$/.test(code.slice(Math.max(0, m.index - 16), m.index))) continue;

    const callee = m[1] as LoadSite['callee'];
    const open = m.index + m[0].length - 1;
    const argument = firstArgumentAt(code, open);
    const line = code.slice(0, m.index).split('\n').length;

    let specifier: string | undefined;
    const literal = argument.match(/^(['"])([^'"]*)\1$/);
    const plainTemplate = argument.match(/^`([^`$]*)`$/);
    const prefixTemplate = argument.match(/^`([^`$]*)\$\{/);
    const identifier = argument.match(/^([A-Za-z_$][\w$]*)$/);
    if (literal) specifier = literal[2];
    else if (plainTemplate) specifier = plainTemplate[1];
    else if (prefixTemplate) specifier = prefixTemplate[1];        // `@objectstack/service-cluster-${driver}`
    else if (identifier) specifier = resolveIdentifier(code, identifier[1], m.index);

    // A BLANK specifier is not a specifier. `import(`${base}/plugin`)` yields the
    // empty prefix, which is falsy everywhere downstream: `packageNameOf` is
    // never called, `packageName` is `undefined`, and the site leaves the
    // population WITHOUT ever being counted as unresolvable. That is the same
    // silent drop this file exists to stop, so it is folded into the loud path.
    if (specifier !== undefined && specifier.trim() === '') specifier = undefined;

    sites.push({
      line,
      callee,
      argument,
      specifier,
      packageName: specifier ? packageNameOf(specifier) : undefined,
    });
  }
  return sites;
}

/** How a site is named when the sweep reports it. */
function formatSite(file: string, site: LoadSite): string {
  return `${file}:${site.line}  ${site.callee}(${site.argument})`;
}

/** The swept file, as it is named in a failure. */
const SERVE_PATH = 'packages/cli/src/commands/serve.ts';

const LOAD_SITES = collectLoadSites(SERVE_CODE);

/**
 * The class this file exists for: a package `serve` loads that the CLI does NOT
 * declare. A bare `import()` from the CLI cannot resolve it except by accident
 * of workspace hoisting — which is precisely why the two shipped instances
 * passed every dev checkout and died on a distribution image.
 */
const APP_DECLARABLE_LOADS = LOAD_SITES.filter(
  (site) => site.packageName?.startsWith('@objectstack/') && !CLI_DECLARES.has(site.packageName),
);

/**
 * ── The DECLARED boundary of the sweep ───────────────────────────────────────
 *
 * A load whose specifier no source scan can resolve — a parameter, a loop
 * variable, a member expression, a computed path. The dangerous thing about
 * this set is its DIRECTION: an unresolved specifier has no `packageName`, so it
 * falls out of `APP_DECLARABLE_LOADS` rather than into it, and every assertion
 * below then passes over a smaller population without a word. Silence is this
 * guard's own failure mode, and silence is the mode that does not announce
 * itself.
 *
 * So membership here is DECLARED, never inferred. Each site is listed by its
 * argument text (stable across line moves) with the reason it cannot name an
 * app-declarable package, and anything unresolved and NOT listed fails the sweep
 * naming its file, line, callee and specifier text. A stale entry fails too — an
 * exclusion that matches no live site is silence with a reason attached.
 *
 * ⛔ These are not allowlists in the sense of "make the sweep pass". They are
 * the two halves of one question — *what does this specifier name?* — and the
 * halves are kept apart ON PURPOSE, keyed per callee. A bare `import()` may
 * never borrow a host load's excuse: the excuses are different in kind, and one
 * shared table would let `import(pkg)` inherit the reason written for
 * `importFromHost(pkg)`, which is exactly the load this file must catch.
 *
 * ── The census, measured rather than counted ────────────────────────────────
 *
 * The premise "nothing in the swept region is legitimately unresolvable" was
 * measured against `origin/main` at `3dafd8c9c` and is FALSE. Eight of the 43
 * load sites are unresolvable, and every one of them legitimately so — which is
 * why the expression of "fail loudly" is a DECLARED boundary rather than an
 * absent one. A bare hard failure would have been eight false positives.
 *
 * Lines drift; the argument text is the key. This is the census the next reader
 * should inherit instead of the number 8:
 *
 *   bare `import()` — the strong excuse, "can only ever name a CLI-declared
 *   package or a non-package":
 *     :431   fallbackSpecifier   the host importer's own caller base (#11157)
 *     :754   pluginSpecifier     the app's config-plugin, non-package branch (#10908)
 *     :1653  absolutePath ? …    a path to the served artifact, never a package
 *     :2778  appPkg              loops @objectstack/setup + /account, both CLI-declared
 *     :3346  spec.pkg            Serve.CAPABILITY_PROVIDERS, all CLI-declared
 *     :3411  ex.pkg              the same table's `extras`, all CLI-declared
 *
 *   `importFromHost()` — the structural excuse, "host-anchored by construction,
 *   which is the property this sweep asks for":
 *     :756   pluginSpecifier     the same app config-plugin, taking the host path
 *     :3217  pkg                 loadOptionalServicePlugin's PARAMETER. ⚠️ Its
 *                                callers pass '@objectstack/service-ai' and
 *                                '@objectstack/service-ai-studio' as literals one
 *                                frame above, and both are app-declarable — so two
 *                                app-declarable loads sit outside the swept
 *                                population. Declared here on purpose; a scan that
 *                                reads the call cannot read the caller.
 */
const UNRESOLVABLE_BARE_IMPORTS: Record<string, string> = {
  // A filesystem path to the app's own compiled config/artifact, never a package.
  // `createHostImporter` passes non-package specifiers through untouched anyway.
  "absolutePath.startsWith('/') ? `file://${absolutePath}` : absolutePath":
    'a path to the served artifact, not a package name',
  // Loop over a literal pair: '@objectstack/setup', '@objectstack/account'.
  // Both are declared by packages/cli, so bare resolution finds them.
  appPkg: 'iterates @objectstack/setup + @objectstack/account, both CLI-declared',
  // Serve.CAPABILITY_PROVIDERS — every `pkg` in that table is CLI-declared.
  'spec.pkg': 'Serve.CAPABILITY_PROVIDERS entries are all CLI-declared',
  'ex.pkg': 'CAPABILITY_PROVIDERS `extras` entries are all CLI-declared',
  // The app's own `plugins: [...]` config entries, routed through
  // `Serve.importConfigPlugin` (#10908). ONE bare `import()` site remains there,
  // and it is the reason this list exists rather than a hole in it: the
  // specifier is not a package name at all (an absolute path, a `file://` URL, a
  // `node:` builtin), so nothing a package.json can declare, and every one of
  // those spellings means the same module from every base.
  //
  // It used to be TWO. The second was the UNDECLARED branch, which kept a local
  // `import()` because the host importer's fallback resolved from
  // `@objectstack/types` rather than from this CLI. #11157 threaded the base
  // (`fallbackImport`), which made that branch identical to the helper's own
  // fallback, and it was collapsed into `importFromHost`. Pinned behaviourally,
  // not by this comment, in `serve-config-plugin-host-resolution.test.ts` and
  // `serve-host-fallback-base.test.ts`.
  pluginSpecifier: 'the non-package branch: an absolute path, a file:// URL or a node: builtin (#10908)',
  // `importFromHost`'s own `fallbackImport` (#11157) — the caller base
  // `createHostImporter` resolves everything the served app does NOT declare
  // from. It is a bare `import()` on purpose and it MUST be written in this
  // file: ESM resolves a bare specifier against the module containing the call,
  // so moving it anywhere else moves the base, which is the whole defect. Its
  // parameter is the helper's argument, so no scan can know the specifier —
  // and no scan needs to: this site is not a load of any particular package,
  // it is the resolution base every other undeclared load is handed.
  fallbackSpecifier:
    "importFromHost's caller base — the CLI's own resolver, handed to createHostImporter (#11157)",
};

/**
 * The same declaration, for `importFromHost(...)` sites.
 *
 * This half did not exist, and its absence is the gap #11614 fell through. An
 * unresolvable specifier handed to the HOST importer left the population in
 * total silence: the load is host-anchored, so no assertion about bare imports
 * had anything to say, and the count floor below absorbed the loss. What was
 * lost was the sweep's knowledge that the load exists at all — and a load the
 * sweep cannot see is a load nobody notices being rewritten.
 *
 * Listing these makes the next one RED on the day it appears. Replaying #11614
 * on today's tree — `const organizationsPkg` written as `let organizationsPkg` —
 * is reported here by file, line and specifier text instead of vanishing.
 */
const UNRESOLVABLE_HOST_LOADS: Record<string, string> = {
  // `Serve.importConfigPlugin`'s package branch (#10908): the same app-config
  // specifier as the bare entry above, taking the host-anchored path. It is a
  // runtime value from the served app's own `plugins: [...]`, so no scan can
  // know it — and it needs no scan, because reaching it through the host
  // importer is precisely what the sweep demands of an app-declarable load.
  pluginSpecifier: "the served app's own plugin specifier, host-anchored by construction (#10908)",
  // `loadOptionalServicePlugin(pkg, …)`'s parameter. Its callers pass
  // '@objectstack/service-ai' and '@objectstack/service-ai-studio' as literals
  // AT THE CALL SITE, so the specifier is app-declarable but lives one frame
  // above this load — out of reach of a scan that reads the call, not the
  // caller. Host-anchored by construction, which is what this sweep asks; the
  // packages themselves are therefore outside the swept population, and that is
  // an EXCLUSION DECLARED HERE rather than an accident of the resolver.
  pkg: 'loadOptionalServicePlugin(pkg) — a generic helper parameter; host-anchored by construction',
};

/** Which declaration covers which callee. Deliberately not one shared table. */
const DECLARED_UNRESOLVABLE: Record<LoadSite['callee'], Record<string, string>> = {
  import: UNRESOLVABLE_BARE_IMPORTS,
  importFromHost: UNRESOLVABLE_HOST_LOADS,
};

/** Every load the scan could not pin to a specifier, whatever the callee. */
const UNRESOLVED_LOADS = LOAD_SITES.filter((site) => site.specifier === undefined);


/**
 * A host app that DECLARES an optional package and carries it in its own
 * `node_modules` — the shape of every EE app that declares
 * `@objectstack/service-cluster`. Nothing here is built or installed: the
 * package is three files written to a temp dir.
 */
function makeHostApp(pkgName: string, declare: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'os-host-app-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture-host-app',
      version: '1.0.0',
      type: 'module',
      ...(declare ? { dependencies: { [pkgName]: '1.0.0' } } : {}),
    }),
  );
  const pkgDir = join(root, 'node_modules', ...pkgName.split('/'));
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name: pkgName, version: '1.0.0', type: 'module', main: 'index.js' }),
  );
  // The marker export stands in for `checkMultiNodeAllowed`: proof the module
  // that loaded is the app's copy, not something the CLI happened to resolve.
  writeFileSync(join(pkgDir, 'index.js'), 'export const loadedFrom = "host-app";\n');
  return root;
}

describe('os serve → app-declared optional package resolution', () => {
  // A name no workspace package can satisfy, so a pass cannot come from the
  // CLI's own node_modules by accident.
  const PKG = '@os-fixture/cluster-driver-probe';

  it('reproduces the asymmetry: an app-only package is invisible to a bare import', async () => {
    // This file resolves from `packages/cli`, exactly as `dist/commands/serve.js`
    // does — the failing hop the EE image measured.
    const bare: string = PKG;
    await expect(import(bare)).rejects.toMatchObject({
      code: expect.stringMatching(/MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/),
    });
  });

  it('crosses the boundary: the host importer loads what the app declares', async () => {
    const hostRoot = makeHostApp(PKG, true);
    const mod = await createHostImporter(hostRoot)(PKG);
    expect(mod.loadedFrom).toBe('host-app');
  });

  it('still refuses a package the app does not declare (the gate is unchanged)', async () => {
    // Present in the app's node_modules but absent from its package.json.
    // Reachability must not substitute for declaration (#4719) — this fix moves
    // where a module is resolved FROM, it does not widen what serve accepts.
    const hostRoot = makeHostApp(PKG, false);
    await expect(createHostImporter(hostRoot)(PKG)).rejects.toMatchObject({
      code: 'MODULE_NOT_FOUND',
    });
  });
});

describe('os serve → cluster block source shape', () => {
  it('loads the cluster gate and driver through the host importer', () => {
    expect(SERVE_SOURCE).toMatch(/await importFromHost\(__clusterPkg\)/);
    expect(SERVE_SOURCE).toMatch(
      /await importFromHost\(`@objectstack\/service-cluster-\$\{__clusterDriver\}`\)/,
    );
  });

  it('never reaches the cluster packages through a bare dynamic import', () => {
    // The exact regression, in both spellings the block used.
    expect(SERVE_SOURCE).not.toMatch(/await import\(__clusterPkg\)/);
    expect(SERVE_SOURCE).not.toMatch(/await import\(`@objectstack\/service-cluster-/);
  });

  // ── Replaces the former "definition is ABOVE the cluster block" assertion ──
  //
  // That assertion pinned an ORDERING inside one long boot method, which is the
  // shape #10769 removed: `importFromHost` is now a module-scope FUNCTION
  // DECLARATION, hoisted over the entire module. The ordering it used to check
  // is not merely satisfied, it is unrepresentable — so the check below is the
  // strictly stronger one it must be read as. Ordering can only regress again if
  // the helper is moved back INSIDE a function, which is exactly what fails here.
  it('defines importFromHost at MODULE scope, so no load can sit above it', () => {
    const moduleScopeDefinitions = [...SERVE_CODE.matchAll(/^function importFromHost\s*\(/gm)];

    expect(
      moduleScopeDefinitions.length,
      'No module-scope `function importFromHost(...)` in serve.ts. A function '
      + 'DECLARATION at column 0 is hoisted over the whole module, which is what '
      + 'makes "a load written above the helper" impossible. If this was moved back '
      + 'inside the boot method — or turned into a `const`/arrow — the ordering '
      + 'hazard is back: a load placed above it is not a compile error, the author '
      + 'writes a bare `import()`, and it resolves from the CLI. That shipped twice '
      + '(cloud#1013, #10645).',
    ).toBe(1);

    // A nested (indented) declaration is scoped to its enclosing function again.
    expect(
      SERVE_CODE,
      'importFromHost is declared INSIDE a function — module scope is the point.',
    ).not.toMatch(/^[ \t]+function importFromHost\s*\(/m);

    // No binding form can re-introduce a temporal dead zone.
    expect(
      SERVE_CODE,
      'importFromHost is bound with const/let. A binding only exists BELOW itself; '
      + 'that is the defect. Keep it a hoisted function declaration.',
    ).not.toMatch(/\b(?:const|let|var)\s+importFromHost\b/);
  });

  it('keeps exactly one host importer, so the helper cannot fork', () => {
    // One definition, and one place that builds the underlying importer.
    expect([...SERVE_CODE.matchAll(/^function importFromHost\s*\(/gm)]).toHaveLength(1);
    expect([...SERVE_CODE.matchAll(/createHostImporter\s*\(/g)]).toHaveLength(1);
  });
});

/**
 * The detection backstop, widened from the cluster pair to EVERY app-declarable
 * optional load in `serve.ts` (#10769).
 *
 * The structural half of that card makes the ordering hazard unrepresentable
 * (`importFromHost` is a hoisted module-scope declaration). This sweep is what
 * catches the remaining way in: a load written as a bare `import()` even though
 * the helper was reachable. It classifies mechanically rather than from a
 * hand-kept list — a package is app-declarable exactly when `packages/cli`'s own
 * manifest does not declare it — so a NEW optional package is covered the moment
 * it is added, with nobody having to remember this file exists.
 */
describe('os serve → every app-declarable optional load is host-anchored', () => {
  it('the sweep actually reads serve.ts (vacuity guard)', () => {
    // A sweep that asserts "nothing is wrong" passes trivially when it matches
    // nothing. These floors fail loudly instead, so a broken scanner can never
    // read as a clean bill of health.
    expect(LOAD_SITES.length, 'no dynamic loads found in serve.ts at all').toBeGreaterThan(25);

    // ── Does a COUNTING floor still earn its place? (#12162) ────────────────
    //
    // Yes — but NOT for the job it used to be given, and it must never again be
    // read as the guard of last resort.
    //
    // The card that asked this is right that a count cannot detect one member
    // leaving a population: the >20 floor absorbed the #11614 organizations loss
    // without a word. It is no longer asked to. A specifier that stops resolving
    // is now REPORTED by name, per site, by the failing check further down.
    //
    // What is left is resolution to a WRONG but PRESENT value — nothing is
    // unresolved, the values simply are not the file's — which per-site
    // reporting cannot see. Three ablations measured who catches what, and the
    // two halves turn out to be split between two different guards:
    //
    //   • specifier becomes unresolvable (`const x` written as `let x`)
    //       → the loud check below, naming serve.ts:2841 importFromHost(...).
    //         The floor here does not fire, and never could.
    //   • the IDENTIFIER path resolves wrongly (`const <name> =` capture group)
    //       → the named list below fires; THIS FLOOR STAYS GREEN (31 → 23,
    //         still over 20). Measured, not assumed.
    //   • the LITERAL path resolves wrongly (`import('…')` capture group)
    //       → THIS FLOOR IS THE ONLY ONE THAT FIRES (31 → 9). The named list
    //         stays green, because all four packages it names reach the sweep
    //         through the identifier and template paths, not the literal one.
    //
    // So it covers the literal half of "wrong but present" and the named list
    // covers the identifier half. Keep both. ⛔ Read neither as "no load went
    // missing" — that is the check below, and only the check below.
    const resolvedPackages = LOAD_SITES.filter((s) => s.packageName?.startsWith('@objectstack/'));
    expect(
      resolvedPackages.length,
      "the specifier resolver is no longer returning serve.ts's own package strings — "
      + 'most likely the LITERAL path, which is the half the named list below cannot '
      + 'see. This floor does NOT guard against a load going missing: an unresolvable '
      + 'specifier is reported by name further down.',
    ).toBeGreaterThan(20);

    expect(
      CLI_DECLARES.size,
      "packages/cli's manifest read as empty — every package would look app-declarable",
    ).toBeGreaterThan(20);

    // Named, not just counted: this proves the resolver still handles every
    // spelling serve.ts uses — a `const` binding, a template prefix, and a
    // `const` bound to a class static — plus the manifest cross-check that
    // decides app-declarable at all.
    //
    // ⚠️ Naming them caught #11614, and this list must not be trusted to do it
    // again. It is satisfied by ANY site resolving to the package, including one
    // that resolves there wrongly: while `resolveIdentifier` searched the whole
    // file for `const <name> =`, the parameter `pkg` in `loadOptionalServicePlugin`
    // matched a `const pkg = Serve.ORGANIZATIONS_RUNTIME_PKG` 1160 lines below it,
    // and that phantom kept '@objectstack/organizations' in this set on a tree
    // where the REAL organizations load had already dropped out. A hand-kept list
    // of four packages is a smoke alarm, not the fire door; the fire door is the
    // failing check below.
    const found = new Set(APP_DECLARABLE_LOADS.map((s) => s.packageName));
    for (const pkg of [
      '@objectstack/service-cluster',    // const binding   (#10645)
      '@objectstack/service-cluster-',   // template prefix (#10645, the driver)
      '@objectstack/organizations',      // const <- static (cloud#1013, #11614)
      '@objectstack/service-i18n',       // const binding   (#10769)
    ]) {
      expect(found, `the sweep no longer sees the ${pkg} load`).toContain(pkg);
    }
    expect(APP_DECLARABLE_LOADS.length).toBeGreaterThanOrEqual(4);
  });

  it('reads code, not the prose that discusses `import()` (stripper guard)', () => {
    // serve.ts explains this very defect in its comments. If the stripper broke
    // OPEN, prose matches would be scanned as loads; if it broke CLOSED it could
    // blank real code and empty the sweep. Pin both directions.
    expect(SERVE_CODE.length).toBe(SERVE_SOURCE.length);
    expect(SERVE_CODE.split('\n').length).toBe(SERVE_SOURCE.split('\n').length);
    // A phrase that exists ONLY inside a comment in serve.ts.
    expect(SERVE_SOURCE).toContain('Node ESM resolves a bare');
    expect(SERVE_CODE).not.toContain('Node ESM resolves a bare');
    // …and real code either side of the comments survives untouched.
    // Markers deliberately unrelated to the shape the tests above pin, so this
    // guard reports on the STRIPPER and never doubles as a second shape check.
    expect(SERVE_CODE).toContain("const __clusterPkg: string = '@objectstack/service-cluster'");
    expect(SERVE_CODE).toContain('export default class Serve extends Command {');
  });

  it('never loads an app-declarable optional package through a bare import()', () => {
    const bare = APP_DECLARABLE_LOADS.filter((site) => site.callee === 'import');

    expect(
      bare.map((site) => `serve.ts:${site.line}  import(${site.argument})  → ${site.packageName}`),
      'These packages are NOT declared by packages/cli, so a bare `import()` resolves '
      + "against the CLI's own realpath and can only find them by accident of workspace "
      + 'hoisting — green in a dev checkout, dead at boot on a real distribution layout. '
      + 'That is the exact failure that shipped as cloud#1013 and #10645. Load them with '
      + '`importFromHost(...)`, which is a module-scope declaration reachable from every '
      + 'line of serve.ts. An app that does not declare the package still falls back to '
      + "the CLI's own resolution, so no quiet-skip path changes.",
    ).toEqual([]);
  });

  it('FAILS on any load whose specifier it cannot resolve — it never drops one', () => {
    // ── The direction, which is the whole defect ─────────────────────────────
    //
    // A specifier this scan cannot resolve carries no `packageName`, so it falls
    // OUT of APP_DECLARABLE_LOADS rather than into it: the sweep does not report
    // the load as unknowable, it reports nothing at all and keeps asserting over
    // the remainder. Widening the resolver one spelling at a time cannot close
    // that — it moves the boundary, it does not make crossing it audible.
    //
    // So: unresolved and undeclared is a FAILURE, for EVERY callee, naming the
    // file, the line, the callee and the specifier text.

    // Non-vacuity: these sites exist, so an empty list means the scan broke.
    expect(
      UNRESOLVED_LOADS.length,
      'no unresolvable load sites at all — serve.ts has several, so the scan broke',
    ).toBeGreaterThan(0);

    const undeclared = UNRESOLVED_LOADS
      .filter((site) => !(site.argument in DECLARED_UNRESOLVABLE[site.callee]))
      .map((site) => formatSite(SERVE_PATH, site));

    expect(
      undeclared,
      'A load whose specifier this scan cannot resolve, and which is not declared '
      + 'as out of the sweep. It CANNOT pass silently: an unresolved specifier drops '
      + 'the load out of the judged population, so the sweep would go on reporting '
      + 'green over a set that no longer contains it. That is how the '
      + '@objectstack/organizations load left this sweep during #11614.\n'
      + '  • A bare `import()`: load it through `importFromHost(...)` — the right '
      + 'answer whenever the specifier can come from the served app — or add it to '
      + 'UNRESOLVABLE_BARE_IMPORTS with the reason it can only ever name a '
      + 'CLI-declared package or a filesystem path.\n'
      + '  • An `importFromHost(...)`: the load is host-anchored, which is what this '
      + 'sweep asks — but the sweep must still KNOW it is here. Give the specifier a '
      + '`const` binding above the call, or add it to UNRESOLVABLE_HOST_LOADS with '
      + 'the reason no scan can name it.\n'
      + '⛔ Neither table is a way to make the sweep pass. An entry states, in the '
      + 'open, that a site is outside the swept population; a site that is inside it '
      + 'and merely spelled unusually belongs in the sweep, not in a table.',
    ).toEqual([]);
  });

  it('keeps every declared exclusion LIVE (a stale one is silence with a reason)', () => {
    // The tables above are the only place this sweep is allowed to be quiet, so
    // they are the only place a lie can survive: an entry whose site was deleted,
    // renamed, or has since become resolvable goes on excusing an argument text
    // that no longer means what the reason says. The next site to be spelled that
    // way inherits an excuse written for something else — the silence back, with
    // an audit trail pointing the wrong way.
    const live = new Set(UNRESOLVED_LOADS.map((site) => `${site.callee} :: ${site.argument}`));

    const stale: string[] = [];
    for (const [callee, table] of Object.entries(DECLARED_UNRESOLVABLE)) {
      for (const argument of Object.keys(table)) {
        if (!live.has(`${callee} :: ${argument}`)) stale.push(`${callee}(${argument})`);
      }
    }

    expect(
      stale,
      'A declared exclusion matching no live load site in serve.ts. Either the site '
      + 'is gone (delete the entry) or its specifier now resolves (delete the entry — '
      + 'the sweep judges it properly). Keeping it leaves an excuse lying around for '
      + 'whatever is spelled that way next.',
    ).toEqual([]);
  });

  it('keeps the cluster and organizations loads host-anchored (the shipped instances)', () => {
    // The two regressions, pinned by package rather than by line number.
    const byPackage = (pkg: string) => APP_DECLARABLE_LOADS.filter((s) => s.packageName === pkg);
    for (const pkg of [
      '@objectstack/service-cluster',
      '@objectstack/service-cluster-',
      '@objectstack/organizations',
      '@objectstack/service-i18n',
    ]) {
      const sites = byPackage(pkg);
      expect(sites.length, `no load site found for ${pkg}`).toBeGreaterThan(0);
      for (const site of sites) {
        expect(site.callee, `serve.ts:${site.line} loads ${pkg} bare`).toBe('importFromHost');
      }
    }
  });
});

/**
 * The sweep's OWN failure path, run rather than assumed.
 *
 * This file's subject is a guard whose failure mode is silence. A guard whose
 * RED path has never been observed is the same silence one layer up, so the
 * classifier is exercised here over small synthetic sources: every spelling the
 * card listed as "vanishes quietly" is asserted to come back as UNRESOLVED, by
 * line and by argument text, on every CI run and not only on the day this was
 * written.
 */
describe('os serve → the sweep reports what it cannot resolve (failure path)', () => {
  const scan = (src: string) => collectLoadSites(stripComments(src));
  const shape = (src: string) =>
    scan(src).map((s) => `${s.line} ${s.callee}(${s.argument}) → ${s.specifier ?? 'UNRESOLVED'}`);

  it('reports an unknown spelling instead of dropping the load', () => {
    // A `let`, and a member of something that is not `Serve.` — the two
    // spellings the resolver does not know. The known load beside it proves the
    // scan is working, so UNRESOLVED here means "said so", not "saw nothing".
    expect(
      shape([
        "const known = '@objectstack/service-i18n';",
        'await importFromHost(known);',
        'let unknown = Other.SOME_MEMBER;',
        'await importFromHost(unknown);',
      ].join('\n')),
    ).toEqual([
      '2 importFromHost(known) → @objectstack/service-i18n',
      '4 importFromHost(unknown) → UNRESOLVED',
    ]);
  });

  it('names the file, the line and the specifier text when it reports', () => {
    expect(formatSite(SERVE_PATH, scan('await import(mystery);')[0])).toBe(
      'packages/cli/src/commands/serve.ts:1  import(mystery)',
    );
  });

  it('refuses a binding BELOW the call — a const only exists below itself', () => {
    expect(
      shape([
        'await importFromHost(later);',
        "const later = '@objectstack/organizations';",
      ].join('\n')),
    ).toEqual(['1 importFromHost(later) → UNRESOLVED']);
  });

  it('takes the NEAREST preceding binding, never a same-named one elsewhere', () => {
    // The `pkg` hazard in miniature: two scopes, one name. Reading the file for
    // the FIRST `const pkg =` anywhere is how a parameter got resolved against a
    // binding 1160 lines away.
    expect(
      shape([
        '{',
        "  const dup = '@objectstack/service-cluster';",
        '}',
        '{',
        "  const dup = '@objectstack/service-i18n';",
        '  await importFromHost(dup);',
        '}',
      ].join('\n')),
    ).toEqual(['6 importFromHost(dup) → @objectstack/service-i18n']);
  });

  it('treats a blank specifier as no specifier', () => {
    // `import(`${base}/plugin`)` yields the empty prefix — falsy, so it would
    // leave the population without ever counting as unresolvable.
    expect(shape('await import(`${base}/plugin`);')).toEqual([
      '1 import(`${base}/plugin`) → UNRESOLVED',
    ]);
  });

  it('does not read `function importFromHost(...)` as a load site', () => {
    expect(
      shape([
        'function importFromHost(specifier: string, hostRoot: string = servedAppRootOrCwd()) {}',
        "const pkg = '@objectstack/organizations';",
        'await importFromHost(pkg);',
      ].join('\n')),
    ).toEqual(['3 importFromHost(pkg) → @objectstack/organizations']);
  });

  it('classifies a two-argument host load by its FIRST argument', () => {
    expect(
      shape([
        "const i18nPkg = '@objectstack/service-i18n';",
        'await importFromHost(i18nPkg, root);',
      ].join('\n')),
    ).toEqual(['2 importFromHost(i18nPkg) → @objectstack/service-i18n']);
  });

  it('does not end the first argument at a comma inside a literal', () => {
    expect(shape("await import('@objectstack/a,b');")).toEqual([
      "1 import('@objectstack/a,b') → @objectstack/a,b",
    ]);
  });

  it('keeps the declarations per callee: a bare import cannot borrow a host excuse', () => {
    // `importFromHost(pkg)` is declared out of the sweep because the callee makes
    // it host-anchored. Rewritten as `import(pkg)` that reason evaporates — and
    // with one shared table it would inherit the excuse anyway. Two tables is
    // what makes the rewrite go red.
    expect(Object.keys(UNRESOLVABLE_HOST_LOADS)).toContain('pkg');
    expect('pkg' in UNRESOLVABLE_BARE_IMPORTS).toBe(false);
    expect('pkg' in DECLARED_UNRESOLVABLE.import).toBe(false);
    expect('pkg' in DECLARED_UNRESOLVABLE.importFromHost).toBe(true);
  });
});
