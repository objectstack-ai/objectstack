#!/usr/bin/env bash
# `os create` scaffold smoke — prove the emitted project installs and builds
# OUTSIDE this monorepo (#14824).
#
# ## What this gate is for
#
# `os create` is documented on four public pages as a user-facing scaffolder,
# and until #14824 every project it emitted was monorepo-shaped: `workspace:*`
# dependency specs, a `tsconfig.json` extending `'../../tsconfig.json'`, and a
# default output directory inside this repository. A reader who followed the
# docs got a project that `pnpm install` refuses. The maintainer's ruling is
# that a documented developer-facing command must work for the developer who
# follows the docs, and the executable criterion attached to it is this script:
#
#   scaffold each template into a temporary directory OUTSIDE the repository,
#   install it with the registry, and boot / typecheck it — green outside the
#   monorepo, on CI, not on a developer box.
#
# ## Why packed tarballs are the honest stand-in for "the registry"
#
# The scaffold pins `@objectstack/*` to `^<the running CLI's version>`, and on
# a pull request that version is by definition NOT published yet — a literal
# registry install could only ever test the PREVIOUS release, i.e. not the
# change under review. `pnpm pack` applies the same manifest rewrites as
# `pnpm publish`, so a tarball is what npm would hand a downstream installer.
# The tarballs are wired in through the PROJECT'S OWN pnpm overrides, which
# redirect resolution while leaving the emitted dependency SPECS untouched —
# the specs are the thing under test and must not be rewritten to make the
# install work. ⛔ Never substitute a `file:` or `link:` dependency for them:
# that would pin exactly the monorepo-shaped success this gate exists to end.
#
# Anything NOT in the override map (zod, typescript, vitest, every transitive)
# resolves from the real registry, exactly as it would for a user.
#
# ## Why the pack step is shared and the glue is not
#
# `scripts/publish-smoke-pack.mjs` is called rather than reimplemented: it owns
# the publishable population (`private !== true`, re-asserted every run) and a
# curated closure would rot. The ~30 lines of override-append and leak-check
# glue below are deliberately NOT shared with `scripts/publish-smoke.sh`:
# factoring them out would mean editing a release gate to serve a PR gate, and
# the two have different projects, different assertions and different failure
# vocabularies. The duplication is the cheaper risk, and it is stated here so a
# future reader does not "discover" it as an oversight.
#
# ## Usage
#   bash scripts/create-scaffold-smoke.sh
# Env:
#   SMOKE_ROOT  work dir                   (default: mktemp -d)
#   SMOKE_KEEP  1 = keep the work dir      (default: 0, auto-clean)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_KEEP="${SMOKE_KEEP:-0}"
SMOKE_ROOT="${SMOKE_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/objectstack-create-smoke.XXXXXX")}"
CLI_BIN="$REPO_ROOT/packages/cli/bin/run.js"

log()  { printf '\n== %s\n' "$*"; }
fail() { printf '::error::%s\n' "$*" >&2; exit 1; }

cleanup() {
  local code=$?
  if [ "$SMOKE_KEEP" = "1" ]; then
    printf '\nSMOKE_KEEP=1 — work dir preserved: %s\n' "$SMOKE_ROOT"
  else
    rm -rf "$SMOKE_ROOT"
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

# The work dir must not be inside the repository, or the project would inherit
# this workspace's pnpm settings and the whole measurement would be void.
case "$SMOKE_ROOT/" in
  "$REPO_ROOT"/*) fail "SMOKE_ROOT ($SMOKE_ROOT) is inside the repository — that is the one place this gate must not test" ;;
esac

[ -d "$REPO_ROOT/packages/cli/dist" ] || fail "packages/cli/dist missing — run 'pnpm build' first"
[ -f "$CLI_BIN" ] || fail "$CLI_BIN missing — run 'pnpm build' first"

# ── 0. the templates, DERIVED from the shipped command ──────────────────────
# Never a hand list: a template added later is smoked the day it is added.
log "Enumerating templates from the built CLI"
TEMPLATE_KEYS="$(node --input-type=module -e "
  const m = await import('file://$REPO_ROOT/packages/cli/dist/commands/create.js');
  const keys = Object.keys(m.templates ?? {});
  if (keys.length === 0) throw new Error('the built CLI exports no create templates');
  console.log(keys.join(' '));
")"
echo "  templates: $TEMPLATE_KEYS"

# ── 1. pack the publishable population ──────────────────────────────────────
log "Packing publishable packages (pnpm pack == publish-time manifests)"
node "$REPO_ROOT/scripts/publish-smoke-pack.mjs" "$SMOKE_ROOT/tarballs"

# ── 2. scaffold, install, build, typecheck — one template at a time ─────────
for KEY in $TEMPLATE_KEYS; do
  WORK="$SMOKE_ROOT/scaffold-$KEY"
  mkdir -p "$WORK"
  NAME="smoke-$KEY"

  # No `--dir`: the DEFAULT output location is part of what is under test. A
  # scaffold that still wrote into `packages/plugins/` or `examples/` would
  # land two levels down and be caught by the depth assertion below.
  log "os create $KEY $NAME  (from $WORK, default location)"
  (cd "$WORK" && node "$CLI_BIN" create "$KEY" "$NAME")

  mapfile -t ENTRIES < <(cd "$WORK" && ls -A)
  [ "${#ENTRIES[@]}" -eq 1 ] || fail "os create $KEY wrote ${#ENTRIES[@]} top-level entries (${ENTRIES[*]}), expected exactly one project directory"
  APP_DIR="$WORK/${ENTRIES[0]}"
  [ -d "$APP_DIR" ] || fail "os create $KEY did not create a directory (${ENTRIES[0]})"
  [ -f "$APP_DIR/package.json" ] || fail "os create $KEY wrote no package.json into $APP_DIR — the default location is still not the developer's directory"
  echo "  scaffolded → $APP_DIR"

  # ── 2a. the emitted BYTES, before anything installs ──────────────────────
  # Asserted on what landed on disk rather than on the renderer, because this
  # is the only place the two can be compared. The unit pin in
  # packages/cli/test/create.test.ts reads the renderer.
  log "Asserting the emitted manifest is registry-shaped ($KEY)"
  node - "$APP_DIR" <<'EOF'
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const appDir = process.argv[2];
const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const workspace = Object.entries(deps).filter(([, spec]) => String(spec).startsWith('workspace:'));
if (workspace.length > 0) {
  console.error('::error::the scaffold declares workspace-protocol dependencies, which resolve nowhere outside this monorepo:');
  for (const [n, s] of workspace) console.error(`  ${n}: ${s}`);
  process.exit(1);
}
const os = Object.entries(deps).filter(([n]) => n.startsWith('@objectstack/'));
if (os.length === 0) {
  console.error('::error::the scaffold declares no @objectstack/* dependency at all — nothing to resolve, so this smoke would prove nothing');
  process.exit(1);
}
for (const [n, s] of os) {
  if (!/^\^?\d+\.\d+\.\d+/.test(String(s))) {
    console.error(`::error::${n} is declared as "${s}", which is not a published semver range`);
    process.exit(1);
  }
}
const tsconfigPath = join(appDir, 'tsconfig.json');
if (existsSync(tsconfigPath)) {
  // JSON5-ish: the scaffold writes plain JSON, so a plain parse is right.
  const ts = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
  if (ts.extends) {
    console.error(`::error::the scaffold's tsconfig.json extends ${JSON.stringify(ts.extends)} — a path that exists only inside this monorepo`);
    process.exit(1);
  }
}
console.log(`  ok — ${os.length} @objectstack dependency spec(s), all published ranges; tsconfig extends nothing`);
EOF

  # ── 2b. pin every publishable package to its tarball ─────────────────────
  # Appended to the file the TEMPLATE ships, never written from scratch: the
  # build-approval block is part of what a user gets, so it has to be part of
  # what this gate tests.
  log "Pinning @objectstack/* to local tarballs via the project's own overrides ($KEY)"
  node - "$SMOKE_ROOT/tarballs/overrides.json" "$APP_DIR/pnpm-workspace.yaml" <<'EOF'
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const [overridesPath, wsPath] = process.argv.slice(2);
const overrides = JSON.parse(readFileSync(overridesPath, 'utf8'));
if (!existsSync(wsPath)) {
  console.error(
    '::error::the scaffold wrote no pnpm-workspace.yaml. Without it a fresh ' +
      '`pnpm install` exits 1 on pnpm 11 (ERR_PNPM_IGNORED_BUILDS) for every ' +
      'user. Fix the `os create` template — not this script.',
  );
  process.exit(1);
}
const base = readFileSync(wsPath, 'utf8').replace(/\s*$/, '');
if (!/^\s*(allowBuilds|onlyBuiltDependencies)\s*:/m.test(base)) {
  console.error(
    '::error::the scaffolded project declares no pnpm build approvals ' +
      '(allowBuilds / onlyBuiltDependencies). A fresh `pnpm install` will exit 1 ' +
      'on pnpm 11. Fix the `os create` template — not this script.',
  );
  process.exit(1);
}
const lines = [
  base,
  '',
  '# ── appended by scripts/create-scaffold-smoke.sh ─────────────────────────',
  '# every publishable package redirected to its about-to-publish tarball. The',
  '# dependency SPECS in package.json are untouched — they are what is on trial.',
  'overrides:',
  ...Object.entries(overrides).map(([name, spec]) => `  '${name}': '${spec}'`),
];
writeFileSync(wsPath, lines.join('\n') + '\n');
console.log(`  wrote ${wsPath} (${Object.keys(overrides).length} overrides, template settings preserved)`);
EOF

  log "Installing outside the monorepo ($KEY)"
  (cd "$APP_DIR" && pnpm install --no-frozen-lockfile)

  log "Asserting no pinned package leaked to the registry ($KEY)"
  node - "$SMOKE_ROOT/tarballs/overrides.json" "$APP_DIR/pnpm-lock.yaml" <<'EOF'
const { readFileSync } = require('node:fs');
const [overridesPath, lockPath] = process.argv.slice(2);
const names = Object.keys(JSON.parse(readFileSync(overridesPath, 'utf8')));
const lock = readFileSync(lockPath, 'utf8').split(/\r?\n/);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const leaked = new Set();
const pinned = new Set();
for (const name of names) {
  const key = new RegExp(`^\\s*'?${esc(name)}@([^']+?)'?:\\s*$`);
  for (const line of lock) {
    const m = key.exec(line);
    if (!m) continue;
    if (m[1].startsWith('file:')) pinned.add(name);
    else if (/^[0-9]/.test(m[1])) leaked.add(`${name}@${m[1]}`);
  }
}
if (leaked.size > 0) {
  console.error('::error::these PINNED packages resolved from the npm registry:');
  for (const l of [...leaked].sort()) console.error(`  ${l}`);
  console.error('The smoke tested PUBLISHED code instead of the change under review.');
  process.exit(1);
}
console.log(`  ok — ${pinned.size} pinned package(s) resolved from tarballs, 0 registry leaks`);
EOF

  # ── 2c. build and typecheck — the "boot / typecheck it" half ─────────────
  # `build` is the command the scaffolder's own output tells the user to run.
  # For a template whose build is `objectstack compile`, running it IS the boot:
  # the config is loaded through the real runtime and its manifest parsed by
  # `ManifestSchema`, outside this monorepo, from published-shaped packages.
  log "Building the scaffolded project ($KEY)"
  (cd "$APP_DIR" && pnpm run build)

  log "Type-checking the scaffolded project ($KEY)"
  (cd "$APP_DIR" && pnpm run typecheck)

  BUILD_SCRIPT="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).scripts?.build ?? '')" "$APP_DIR/package.json")"
  case "$BUILD_SCRIPT" in
    *"objectstack compile"*)
      [ -f "$APP_DIR/dist/objectstack.json" ] \
        || fail "$KEY: 'objectstack compile' exited 0 but wrote no dist/objectstack.json — the stack never loaded"
      echo "  ok — dist/objectstack.json written: the stack loaded and its manifest parsed outside this monorepo"
      ;;
    *)
      [ -d "$APP_DIR/dist" ] && [ -n "$(ls -A "$APP_DIR/dist")" ] \
        || fail "$KEY: 'pnpm run build' exited 0 but produced no dist/ output"
      echo "  ok — dist/ populated by '$BUILD_SCRIPT'"
      ;;
  esac
done

log "os create scaffold smoke passed for: $TEMPLATE_KEYS"
