#!/usr/bin/env node
/**
 * Validates how `.changeset/config.json` classifies every workspace package for
 * release. Three rules, all decided from the config file plus the manifests:
 *
 *   1. every workspace package under `packages/` and `apps/` is either in the
 *      `fixed` group or matched by `ignore`;
 *   2. `privatePackages` is declared explicitly;
 *   3. no PRIVATE package sits in the `fixed` group while
 *      `privatePackages.version` is false.
 *
 * Rule 1 is the original one and is version-agnostic. Rules 2 and 3 exist
 * because `@changesets/cli@3` changed what an ABSENT `privatePackages` means,
 * and this repo has a private package inside the `fixed` group — `object-ui`
 * (`packages/vscode-extension`), private because it ships to the VS Code
 * marketplace rather than npm, but versioned in lockstep with the 39
 * publishable packages so its version keeps matching the runtime it embeds.
 *
 * What changed, measured against `@changesets/config@4.0.0` rather than
 * recalled: an omitted `privatePackages` used to default to
 * `{ version: true, tag: false }` and now defaults to
 * `{ version: false, tag: false }`, and `version: false` does not merely skip
 * the version bump — it feeds `allowPrivatePackages: false` into the release
 * assembler, i.e. the package is treated as IGNORED. A changeset that names one
 * ignored and one non-ignored package is then a "mixed changeset", which
 * `assembleReleasePlan` refuses outright:
 *
 *     Error: Found mixed changeset no-console-lint-rule
 *     Found ignored packages: object-ui
 *     Found not ignored packages: @object-ui/app-shell @object-ui/fields …
 *     Mixed changesets that contain both ignored and not ignored packages are
 *     not allowed
 *
 * That is not a hypothetical: `.changeset/no-console-lint-rule.md` in the stock
 * pending at the time of the v3 migration named exactly that combination, so
 * bumping the CLI without declaring the key exited 1 on `changeset status` AND
 * on `changeset version` — the release lane stops, and nothing in PR CI would
 * have said so, because no PR workflow runs either command (the only invocation
 * is inside `.github/workflows/changeset-release.yml`). Since objectstack#10850
 * that invocation is later still: `changeset version` runs on that workflow's
 * REFRESH lane — the 6-hourly cron or a manual `refresh_version_pr` dispatch —
 * not on push to `main`, so a mixed changeset that would stop the release lane
 * now surfaces at the next refresh rather than at the next landing. Which only
 * sharpens the point: this gate is still the only thing that can say so on a
 * pull request.
 *
 * Hence rule 2: silence about `privatePackages` is no longer a safe default,
 * because its meaning inverted. And hence rule 3: `fixed` membership and
 * `version: false` are a contradiction — one says "version this in lockstep",
 * the other says "this is ignored" — and changesets does not diagnose the
 * contradiction at config-read time, only later as the mixed-changeset error,
 * from whichever changeset happens to trip it.
 *
 * Runs on a bare checkout with no `pnpm install` (`.github/workflows/ci.yml`,
 * job `changeset-check`, is a checkout plus one `node` call), so this file may
 * not import `@changesets/*` or any other dependency. Keep it that way.
 *
 * Run:  node scripts/check-changeset-fixed.mjs
 * Exit: 0 = OK, 1 = a package is misclassified or the config is under-declared
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { isEntrypoint } from "./invoked-as.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The workspace roots this gate classifies, shared with `check-changeset-presence.mjs`. */
const PACKAGE_ROOTS = ["packages", "apps"];

/**
 * Turns a changesets `ignore` entry (`@object-ui/example-*`) into a matcher.
 * Kept identical to `ignoreMatcher` in `scripts/check-changeset-presence.mjs`:
 * changesets glob-expands `ignore` and `fixed` when it reads the config, so a
 * gate that compared literal strings would call a glob-ignored package
 * unclassified and fail on a config changesets is perfectly happy with.
 *
 * @param {string[]} patterns
 * @returns {(name: string) => boolean}
 */
export function globMatcher(patterns) {
  const expressions = patterns.map(
    (pattern) =>
      new RegExp(
        `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "*" ? ".*" : `\\${c}`))}$`
      )
  );
  return (name) => expressions.some((expression) => expression.test(name));
}

/**
 * Normalizes the written `privatePackages` value the way `@changesets/config@4`
 * does: a boolean is shorthand for both fields, an object defaults each missing
 * field to `false`, and an absent key is reported as absent rather than
 * defaulted — rule 2 is about the declaration, not about the value.
 *
 * @param {unknown} written
 * @returns {{ version: boolean, tag: boolean } | null} null when undeclared
 */
export function normalizePrivatePackages(written) {
  if (written === undefined || written === null) return null;
  if (typeof written !== "object") return { version: Boolean(written), tag: Boolean(written) };
  const value = /** @type {{ version?: unknown, tag?: unknown }} */ (written);
  return { version: Boolean(value.version), tag: Boolean(value.tag) };
}

/**
 * @typedef {{ name: string, path: string, private: boolean }} Manifest
 * @typedef {{ unclassified: Manifest[], privateInFixed: Manifest[],
 *             privatePackages: { version: boolean, tag: boolean } | null }} Analysis
 */

/**
 * The whole judgement, as a pure function of the config and the manifests —
 * `scripts/__tests__/check-changeset-fixed.test.ts` drives it directly.
 *
 * @param {{ fixed?: string[][], ignore?: string[], privatePackages?: unknown }} config
 * @param {Manifest[]} manifests
 * @returns {Analysis}
 */
export function analyze(config, manifests) {
  const isFixed = globMatcher((config.fixed ?? []).flat());
  const isIgnored = globMatcher(config.ignore ?? []);
  const privatePackages = normalizePrivatePackages(config.privatePackages);

  const unclassified = manifests.filter((pkg) => !isFixed(pkg.name) && !isIgnored(pkg.name));
  const privateInFixed =
    privatePackages?.version === true
      ? []
      : manifests.filter((pkg) => pkg.private && isFixed(pkg.name));

  return { unclassified, privateInFixed, privatePackages };
}

// ── Collect all workspace package names ──────────────────────────────────────
/**
 * @param {string[]} dirs
 * @returns {Manifest[]}
 */
function readManifests(dirs) {
  /** @type {Manifest[]} */
  const results = [];
  for (const dir of dirs) {
    const abs = resolve(root, dir);
    let entries;
    try {
      entries = readdirSync(abs);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const rel = join(dir, entry, "package.json");
      try {
        statSync(join(abs, entry, "package.json"));
      } catch {
        continue; // not a package directory
      }
      const pkg = JSON.parse(readFileSync(resolve(root, rel), "utf8"));
      if (!pkg.name) continue;
      results.push({ name: pkg.name, path: rel, private: pkg.private === true });
    }
  }
  return results;
}

function main() {
  const config = JSON.parse(readFileSync(resolve(root, ".changeset/config.json"), "utf8"));
  const { unclassified, privateInFixed, privatePackages } = analyze(
    config,
    readManifests(PACKAGE_ROOTS)
  );

  let failed = false;

  if (unclassified.length > 0) {
    failed = true;
    console.error(
      "❌  The following packages are missing from the changeset fixed group in .changeset/config.json:\n"
    );
    for (const { name, path } of unclassified) {
      console.error(`    • ${name}  (${path})`);
    }
    console.error(
      "\nAdd them to the `fixed` array in .changeset/config.json to keep versions in sync."
    );
  }

  if (privatePackages === null) {
    failed = true;
    console.error(
      "\n❌  .changeset/config.json does not declare `privatePackages`.\n" +
        "\nOmitting it is not neutral: @changesets/cli@2 defaulted to\n" +
        '`{ "version": true, "tag": false }` and @changesets/cli@3 defaults to\n' +
        '`{ "version": false, "tag": false }`, and `version: false` makes every private\n' +
        "package IGNORED — after which any changeset naming a private package next to a\n" +
        'published one is a "mixed changeset" and `changeset status` / `changeset version`\n' +
        "exit 1. No PR workflow runs either command, so the first symptom would be the\n" +
        "release lane failing on `main`.\n" +
        '\nDeclare it: `"privatePackages": { "version": true, "tag": false }` keeps this\n' +
        "repo's behaviour (private packages versioned in lockstep, never git-tagged)."
    );
  } else if (privateInFixed.length > 0) {
    failed = true;
    console.error(
      "\n❌  These private packages are in the `fixed` group while " +
        "`privatePackages.version` is false:\n"
    );
    for (const { name, path } of privateInFixed) {
      console.error(`    • ${name}  (${path})`);
    }
    console.error(
      "\nThat is a contradiction changesets does not diagnose when it reads the config:\n" +
        "`fixed` says version this in lockstep, `version: false` says treat it as ignored.\n" +
        "It surfaces later, as `Mixed changesets that contain both ignored and not ignored\n" +
        "packages are not allowed`, from whichever changeset happens to name one of these\n" +
        "alongside a published package — and that error stops the release lane.\n" +
        '\nFix: set `"privatePackages": { "version": true, "tag": false }`, or move the\n' +
        "package out of `fixed` and into `ignore`."
    );
  }

  if (failed) return 1;

  console.log("✅  All workspace packages are in the changeset fixed group.");
  console.log(
    `✅  privatePackages declared: version=${privatePackages.version}, tag=${privatePackages.tag}.`
  );
  return 0;
}

// Only run when invoked as a script — the tests import the helpers above.
if (isEntrypoint(import.meta.url)) {
  process.exit(main());
}
