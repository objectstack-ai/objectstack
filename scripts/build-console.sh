#!/usr/bin/env bash
# Build @object-ui/console at the SHA pinned in .objectui-sha and copy
# its dist/ into packages/console/ so @objectstack/console can publish
# a version-matched, prebuilt Console SPA alongside the framework. The
# tracked repo-root sdui.manifest.json ships in that dist too (see the
# block near the end).
#
# Resolution order for the objectui source tree:
#   1. $OBJECTUI_ROOT (if set and a git repo)         — explicit override
#   2. ../objectui sibling checkout                   — local dev layout
#   3. Shallow clone into .cache/objectui at the SHA  — CI / fresh machines
#
# In modes 1 and 2 the script does NOT mutate the developer's checkout —
# it creates a git worktree at the pinned SHA so the dev tree is left alone.
# Mode 3 fetches just the pinned commit.
#
# Always rebuilds the dist (no `if exists, skip` shortcut) so a stale
# tree can't mask a bad SHA in CI.
#
# Usage:
#   scripts/build-console.sh
#   scripts/build-console.sh --check-single-zod <assets-dir>
#                           run ONLY the single-zod canary (below) over an
#                           existing dist's assets/ and exit with its verdict;
#                           builds nothing, writes nothing
#
# Env:
#   OBJECTUI_ROOT           override path to objectui checkout
#   OBJECTUI_REPO_URL       override clone URL (default: https://github.com/objectstack-ai/objectui.git)
#   OBJECTUI_DEPS_BUILD_CMD override deps build (default: pnpm exec turbo run build --filter=@object-ui/console^...)
#   OBJECTUI_BUILD_CMD      override console build (default: pnpm --filter @object-ui/console run build)
#   CONSOLE_BUNDLE_CANARY   literal asserted in the built assets (default: import/jobs)

set -euo pipefail

# ── Single-zod canary (objectstack#21108) ────────────────────────────
# The console bundle must carry exactly ONE zod instance. Two copies split
# zod's internals: a spec schema built by one instance and walked by the other
# (`z.toJSONSchema`) throws, so every spec-derived Studio form lost its fields —
# the New Package dialog could not create a package and the dashboard/report
# inspectors read "Spec schema unavailable". The pin `db11afd4967c` shipped that
# split: objectui's zod 4.4.3 in `vendor-zod` beside the injected spec's 4.6.1
# in `vendor-objectstack`, each carrying its own version literal.
#
# objectui#11353 (objectui#11327) fixed it at the source: inside the console's
# Vite build it pins every `zod` import to the console's copy, asserts the
# console's zod satisfies the injected spec's declared range, and fails the
# build on more than one zod package directory in the emitted chunks. This is
# the belt to that brace, measured on what this script SHIPS rather than on how
# the pinned objectui build is configured, so it still holds for a future pin
# that drops or weakens that guard.
#
# What it counts: zod 4 stamps every instance with a version object literal
# (`version` in `zod/v4/core/versions`, read back as `_zod.version`), which the
# minifier emits as `{major:4,minor:6,patch:5}`. One instance = one literal, so
# the canary requires EXACTLY ONE occurrence across assets/*.js:
#   - two DIFFERENT literals: two zod versions, the shipped defect;
#   - one literal found twice: two instances of the same version — still two
#     instances, which is what the crash keys on;
#   - none at all: the matcher has gone blind (the console always bundles zod),
#     and a negative check that cannot see its subject would pass forever.
ZOD_VERSION_LITERAL='\{[[:space:]]*major:[[:space:]]*[0-9]+,[[:space:]]*minor:[[:space:]]*[0-9]+,[[:space:]]*patch:[[:space:]]*[0-9]+[[:space:]]*,?[[:space:]]*\}'

assert_single_zod() {
  local assets="$1"
  if [[ ! -d "$assets" ]]; then
    echo "✗ Single-zod canary: ${assets} is not a directory."
    return 1
  fi
  local files=()
  local f
  for f in "$assets"/*.js; do
    [[ -f "$f" ]] && files+=("$f")
  done
  if (( ${#files[@]} == 0 )); then
    echo "✗ Single-zod canary: no .js files under ${assets} — nothing was measured."
    return 1
  fi
  local hits="" rc=0
  hits="$(grep -oHE "$ZOD_VERSION_LITERAL" "${files[@]}")" || rc=$?
  if (( rc > 1 )); then
    echo "✗ Single-zod canary: grep failed (exit ${rc}) reading ${assets}/*.js."
    return 1
  fi
  # One line per occurrence: <file>:<literal>, the literal's whitespace and any
  # trailing comma dropped so a re-formatted bundle reads the same version.
  local occurrences
  occurrences="$(printf '%s\n' "$hits" | sed -e '/^$/d' -e 's/[[:space:]]//g' -e 's/,}$/}/')"
  local count=0 distinct=0
  if [[ -n "$occurrences" ]]; then
    count="$(printf '%s\n' "$occurrences" | wc -l | tr -d ' ')"
    distinct="$(printf '%s\n' "$occurrences" | sed 's/^.*:{/{/' | sort -u | wc -l | tr -d ' ')"
  fi
  if (( count == 0 )); then
    echo "✗ Single-zod canary: none of the ${#files[@]} assets/*.js files carries a zod version"
    echo "  literal ({major:N,minor:N,patch:N}). The console always bundles zod, so zero means"
    echo "  this matcher can no longer see it — and a check that cannot see its subject cannot"
    echo "  fail. Fix the matcher (ZOD_VERSION_LITERAL in scripts/build-console.sh) before"
    echo "  trusting this bundle."
    return 1
  fi
  if (( count > 1 )); then
    if (( distinct > 1 )); then
      echo "✗ Single-zod canary: the console bundle carries ${distinct} different zod versions"
      echo "  (${count} version literals) and must carry exactly one:"
    else
      echo "✗ Single-zod canary: the console bundle carries ${count} copies of ONE zod version"
      echo "  literal — two instances of the same version are still two instances:"
    fi
    printf '%s\n' "$occurrences" | sed "s|^${assets%/}/|    |"
    echo "  A schema built by one zod instance and walked by another breaks every spec-derived"
    echo "  Studio form. If OBJECTSTACK_SPEC_DIST was injected, the pinned objectui build did not"
    echo "  pin the spec's zod imports to the console's copy; otherwise objectui's own lockfile"
    echo "  resolves zod twice. Move .objectui-sha to an objectui commit whose console build"
    echo "  holds zod to one copy."
    return 1
  fi
  echo "✓ Single-zod canary: exactly one zod version literal $(printf '%s' "$occurrences" | sed 's/^.*:{/{/') in ${occurrences%%:*}."
  echo "  (${#files[@]} assets/*.js files read)"
  return 0
}

if [[ "${1:-}" == "--check-single-zod" ]]; then
  if [[ -z "${2:-}" ]]; then
    echo "usage: scripts/build-console.sh --check-single-zod <assets-dir>"
    exit 2
  fi
  if assert_single_zod "$2"; then exit 0; fi
  exit 1
fi

FRAMEWORK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHA_FILE="${FRAMEWORK_ROOT}/.objectui-sha"

if [[ ! -f "$SHA_FILE" ]]; then
  echo "✗ ${SHA_FILE} is missing — cannot determine which objectui commit to build."
  exit 1
fi

PINNED_SHA="$(tr -d '[:space:]' < "$SHA_FILE")"
if [[ -z "$PINNED_SHA" ]]; then
  echo "✗ ${SHA_FILE} is empty."
  exit 1
fi

REPO_URL="${OBJECTUI_REPO_URL:-https://github.com/objectstack-ai/objectui.git}"
# The console app itself must NOT build through turbo: turbo v2 runs tasks in
# strict env mode and strips undeclared vars, so OBJECTSTACK_CLIENT_DIST and
# OBJECTSTACK_SPEC_DIST (both exported below) never reach vite unless the pinned
# objectui SHA happens to declare them in turbo.json. Build the workspace deps
# through turbo (cacheable, env-independent), then invoke the console's own build
# script directly so the env survives.
DEPS_BUILD_CMD="${OBJECTUI_DEPS_BUILD_CMD:-pnpm exec turbo run build --filter=@object-ui/console^...}"
BUILD_CMD="${OBJECTUI_BUILD_CMD:-pnpm --filter @object-ui/console run build}"
# Post-build canary: a literal that only exists in an up-to-date bundled
# client. Guards against any future mechanism (turbo env stripping, a removed
# vite hook, chunking changes) silently shipping a stale client again.
BUNDLE_CANARY="${CONSOLE_BUNDLE_CANARY:-import/jobs}"

# Resolve a source checkout of objectui.
SOURCE_ROOT=""
if [[ -n "${OBJECTUI_ROOT:-}" && -d "${OBJECTUI_ROOT}/.git" ]]; then
  SOURCE_ROOT="$OBJECTUI_ROOT"
elif [[ -d "${FRAMEWORK_ROOT}/../objectui/.git" ]]; then
  SOURCE_ROOT="$(cd "${FRAMEWORK_ROOT}/../objectui" && pwd)"
fi

# Worktree path we'll build from. Always under framework so cleanup is local.
BUILD_ROOT="${FRAMEWORK_ROOT}/.cache/objectui-${PINNED_SHA:0:12}"
mkdir -p "${FRAMEWORK_ROOT}/.cache"

if [[ -n "$SOURCE_ROOT" ]]; then
  echo "→ Using objectui source at ${SOURCE_ROOT}"
  # Fetch the pinned commit if missing locally, so dev laptops with a
  # stale checkout still work.
  if ! git -C "$SOURCE_ROOT" cat-file -e "${PINNED_SHA}^{commit}" 2>/dev/null; then
    echo "→ Pinned commit ${PINNED_SHA:0:12} not present locally — fetching from origin..."
    git -C "$SOURCE_ROOT" fetch --no-tags origin "$PINNED_SHA" || \
      git -C "$SOURCE_ROOT" fetch --no-tags origin
  fi

  # Reuse worktree if it already points at the right commit; otherwise
  # remove and recreate so we always build the pinned tree.
  if [[ -d "$BUILD_ROOT" ]]; then
    CURRENT="$(git -C "$BUILD_ROOT" rev-parse HEAD 2>/dev/null || echo '')"
    if [[ "$CURRENT" != "$PINNED_SHA" ]]; then
      git -C "$SOURCE_ROOT" worktree remove --force "$BUILD_ROOT" 2>/dev/null || rm -rf "$BUILD_ROOT"
    fi
  fi
  if [[ ! -d "$BUILD_ROOT" ]]; then
    # Prune stale worktree registrations before adding. Registrations live in
    # the SHARED objectui/.git — nothing on the framework side touches them,
    # so if a previous run's directory was removed without going through
    # `worktree remove` (the force-remove fallback above hitting `rm -rf`, or
    # an external `rm -rf .cache/objectui-*` cleanup), the registration
    # survives as `prunable` and the next `worktree add` at this same path
    # dies with exit 128 "already registered worktree". `prune` only drops
    # registrations whose directory is already gone, so it's safe here
    # unconditionally.
    git -C "$SOURCE_ROOT" worktree prune
    git -C "$SOURCE_ROOT" worktree add --detach "$BUILD_ROOT" "$PINNED_SHA"
  fi
else
  echo "→ No local objectui checkout — shallow-cloning ${REPO_URL} at ${PINNED_SHA:0:12}"
  if [[ -d "$BUILD_ROOT/.git" ]]; then
    CURRENT="$(git -C "$BUILD_ROOT" rev-parse HEAD 2>/dev/null || echo '')"
    if [[ "$CURRENT" != "$PINNED_SHA" ]]; then
      rm -rf "$BUILD_ROOT"
    fi
  fi
  if [[ ! -d "$BUILD_ROOT/.git" ]]; then
    rm -rf "$BUILD_ROOT"
    mkdir -p "$BUILD_ROOT"
    git -C "$BUILD_ROOT" init -q
    git -C "$BUILD_ROOT" remote add origin "$REPO_URL"
    git -C "$BUILD_ROOT" fetch --depth=1 origin "$PINNED_SHA"
    git -C "$BUILD_ROOT" checkout --detach FETCH_HEAD
  fi
fi

# Verify HEAD matches the pin.
ACTUAL="$(git -C "$BUILD_ROOT" rev-parse HEAD)"
if [[ "$ACTUAL" != "$PINNED_SHA" ]]; then
  echo "✗ Worktree HEAD ${ACTUAL:0:12} does not match pin ${PINNED_SHA:0:12}"
  exit 1
fi

echo "→ Building @object-ui/console at ${PINNED_SHA:0:12}..."

# ── Bundle THIS framework's client ───────────────────────────────────
# The console SPA inlines @objectstack/client. Left to itself, the objectui
# build resolves the client from objectui's own lockfile — which lags the
# framework whenever a release adds new client APIs (the lockfile can't point
# at a client that isn't published yet). That shipped 11.5.0 with the new
# import UI bundled against client 11.2.0, so the console threw "does not
# support async import jobs" at runtime. Alias the build to the client in
# THIS tree instead: the bundled client then always matches the framework
# release being published, with no objectui pin-bump round-trip.
# objectui honors OBJECTSTACK_CLIENT_DIST in apps/console/vite.config.ts;
# fail hard if the pinned SHA predates that hook rather than silently drift.
CLIENT_PKG="${FRAMEWORK_ROOT}/packages/client"
if ! grep -q "OBJECTSTACK_CLIENT_DIST" "${BUILD_ROOT}/apps/console/vite.config.ts"; then
  echo "✗ objectui@${PINNED_SHA:0:12} has no OBJECTSTACK_CLIENT_DIST hook in apps/console/vite.config.ts —"
  echo "  the bundled client would come from objectui's lockfile, not this framework."
  echo "  Bump .objectui-sha to a commit that includes the hook."
  exit 1
fi
# Build the client THROUGH TURBO, not by shelling into the package. turbo.json
# declares "build": { "dependsOn": ["^build"] }, and `cd packages/client && pnpm
# build` bypasses exactly that guarantee. On a cold tree packages/spec/dist and
# packages/core/dist do not exist yet, so the client's subpath imports
# (@objectstack/spec/data, @objectstack/core/logger, ...) resolve to nothing and
# the tsup DTS pass dies. `--filter=@objectstack/client` alone is enough — the
# dependency closure comes from ^build, not from a `...` filter suffix (measured:
# 32 build tasks in scope).
#
# Guard on the DECLARATION, not on dist/index.mjs: tsup writes the CJS/ESM
# bundles BEFORE the DTS pass, so a client build that died in DTS still leaves
# dist/index.mjs on disk. Keying the guard on it made a half-built client look
# complete, so the next run skipped the build and carried on with a client dist
# whose declarations were never generated. dist/index.d.ts is this package's
# declared type entrypoint (package.json "types" and exports["."].types) and
# only appears once the DTS pass has succeeded.
#
# Under OS_SKIP_DTS (see tsup.config.ts) there is legitimately no declaration,
# so this guard re-fires on every run — harmless, because the turbo build it
# guards is cached.
CLIENT_DTS="${CLIENT_PKG}/dist/index.d.ts"
if [[ ! -f "$CLIENT_DTS" ]]; then
  echo "→ @objectstack/client dist absent or incomplete (no dist/index.d.ts) — building it and its deps first..."
  (cd "$FRAMEWORK_ROOT" && pnpm exec turbo run build --filter=@objectstack/client)
fi
export OBJECTSTACK_CLIENT_DIST="$CLIENT_PKG"
echo "→ Console will bundle @objectstack/client from ${CLIENT_PKG}"

# ── Bundle THIS framework's spec ─────────────────────────────────────
# The same class of skew as the client above, one level quieter. The console SPA
# inlines @objectstack/spec, and left to itself the objectui build resolves it
# from objectui's own lockfile under --frozen-lockfile — the last PUBLISHED spec,
# never this workspace. So an authorable key added to packages/spec after that
# publish is accepted and round-tripped by the server while the Studio designer
# rejects it as an unrecognized key and refuses to auto-save, and the
# framework-side card closes green because packages/spec's own pins all pass.
# Reaching the key took three ordered cross-repo steps: spec publishes, objectui
# refreshes its lockfile, this pin moves. Injecting this tree's spec collapses
# all three (objectstack#8134, hook added in objectui#4854).
#
# objectui honors OBJECTSTACK_SPEC_DIST in apps/console/vite.config.ts; fail hard
# if the pinned SHA predates that hook rather than silently drift — an unguarded
# injection would quietly rebuild the exact silent skew it exists to end.
SPEC_PKG="${FRAMEWORK_ROOT}/packages/spec"
if ! grep -q "OBJECTSTACK_SPEC_DIST" "${BUILD_ROOT}/apps/console/vite.config.ts"; then
  echo "✗ objectui@${PINNED_SHA:0:12} has no OBJECTSTACK_SPEC_DIST hook in apps/console/vite.config.ts —"
  echo "  the bundled spec would come from objectui's lockfile, not this framework, so"
  echo "  any key this tree declares since the last spec publish would be unreachable"
  echo "  in the Studio designer."
  echo "  Bump .objectui-sha to a commit that includes the hook."
  exit 1
fi
# The hook resolves EVERY entry of the spec's exports map and refuses any whose
# target is missing, so the package must be built before it is injected. Two
# sentinels, because two different generators produce those targets:
# dist/index.mjs is tsup's, and json-schema/openapi.json is `gen:openapi`'s — the
# one export entry that does not live under dist/, is not committed, and is wiped
# by a later `gen:schema` run. A guard keyed on dist/ alone sails past a tree
# where that happened, and the hook then throws in the middle of the console build.
#
# Unlike the client's guard this deliberately does NOT key on a declaration file:
# the hook resolves the `import` condition only, so a spec whose DTS pass never
# ran (OS_SKIP_DTS, or a DTS crash) is still complete for the injection.
SPEC_ESM="${SPEC_PKG}/dist/index.mjs"
SPEC_OPENAPI="${SPEC_PKG}/json-schema/openapi.json"
if [[ ! -f "$SPEC_ESM" || ! -f "$SPEC_OPENAPI" ]]; then
  echo "→ @objectstack/spec dist absent or incomplete — building it and its deps first..."
  (cd "$FRAMEWORK_ROOT" && pnpm exec turbo run build --filter=@objectstack/spec)
fi
export OBJECTSTACK_SPEC_DIST="$SPEC_PKG"
echo "→ Console will bundle @objectstack/spec from ${SPEC_PKG}"

# ── Install THIS framework's @objectstack/* too (objectui consumes it by commit) ──
# The two injections above answer "which spec and client does the BUNDLE carry".
# Ruling B on objectui#12955 (objectui#12957) moved the INSTALL off npm as well: a
# pinned objectui that carries `.objectstack-sha` overrides every @objectstack/*
# package it resolves to `file:node_modules/.cache/objectstack/<name>` in its root
# package.json, and its `scripts/objectstack-pin.mjs build` fills those directories
# from a build of the objectstack commit `.objectstack-sha` names. Until something
# fills them, the frozen install below dies (measured at objectui 749ed760: exit
# 254, `ENOENT ... scandir node_modules/.cache/objectstack/client`); and the commit
# objectui would fill them from is its own pin, not this tree.
#
# That script's OBJECTSTACK_ROOT input packs the same packages from an installed
# and BUILT objectstack tree instead, with no lockfile change. Pointed at THIS tree,
# every @objectstack/* package objectui installs is this framework's, the same
# answer the injections give for the bundle. The injections stay: a pin without
# `.objectstack-sha` still installs from npm and needs them.
#
# Detected by the FILE, never by the sha: a pin without `.objectstack-sha` builds
# exactly as before. A pin with it but without the hook refuses, like the two
# vite.config.ts guards above, rather than letting objectui build its own pin.
OBJECTSTACK_PIN_SCRIPT="${BUILD_ROOT}/scripts/objectstack-pin.mjs"
if [[ -f "${BUILD_ROOT}/.objectstack-sha" ]]; then
  if [[ ! -f "$OBJECTSTACK_PIN_SCRIPT" ]] || ! grep -q "OBJECTSTACK_ROOT" "$OBJECTSTACK_PIN_SCRIPT"; then
    echo "✗ objectui@${PINNED_SHA:0:12} carries .objectstack-sha but has no OBJECTSTACK_ROOT hook in"
    echo "  scripts/objectstack-pin.mjs — its install would resolve @objectstack/* from objectui's own"
    echo "  build of the objectstack commit it pins, not from this framework."
    echo "  Bump .objectui-sha to a commit that includes the hook."
    exit 1
  fi

  # Build what the pin script packs, through turbo (see the client's note above):
  # the packages objectui overrides, read from its root package.json at the pin
  # (the same list the pin script reads), and their dependencies by `^build`.
  # Unguarded on purpose: the pin script packs whatever dist/ is on disk, so a
  # stale one would install without a word, while turbo judges freshness by
  # content hash. Every workflow that runs this script has just built that
  # closure, so there this is a cache hit; `new-only` keeps a hit from replaying
  # thousands of cached log lines, and still prints every task that really runs.
  #
  # WITH declarations, whatever OS_SKIP_DTS the caller exported. The two guards
  # above accept a typeless client and spec because the vite hooks read only the
  # `import` condition; the pin script packs whole packages as they publish and
  # refuses one whose `types` entry is missing. Measured on this branch with
  # OS_SKIP_DTS=1 and a typeless tree: exit 1, "@objectstack/client is not built
  # ... dist/index.d.ts, which is not there", and the rebuild that refusal
  # prints inherits the same OS_SKIP_DTS (consumer pointer on objectstack#24306).
  # turbo.json lists OS_SKIP_DTS in globalEnv, so this build hashes apart from a
  # typeless one and cannot replay it.
  OBJECTSTACK_PINNED_NAMES="$(node -e '
    const manifest = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const names = Object.keys(manifest.pnpm?.overrides ?? {}).filter((n) => n.startsWith("@objectstack/"));
    process.stdout.write(names.sort().join(" "));
  ' "${BUILD_ROOT}/package.json")"
  OBJECTSTACK_TURBO_FILTERS=()
  for name in $OBJECTSTACK_PINNED_NAMES; do
    OBJECTSTACK_TURBO_FILTERS+=("--filter=${name}")
  done
  if (( ${#OBJECTSTACK_TURBO_FILTERS[@]} > 0 )); then
    echo "→ objectui@${PINNED_SHA:0:12} installs ${OBJECTSTACK_PINNED_NAMES} by commit — building them here..."
    if [[ -n "${OS_SKIP_DTS:-}" ]]; then
      echo "  OS_SKIP_DTS is set; these packages are built WITHOUT it, declarations included,"
      echo "  because objectui packs them as they publish."
    fi
    (cd "$FRAMEWORK_ROOT" && unset OS_SKIP_DTS && pnpm exec turbo run build "${OBJECTSTACK_TURBO_FILTERS[@]}" --output-logs=new-only)
  fi

  # The pin script refuses (exit 1, reason on stderr) on a missing entry point,
  # and on two dependency mismatches between these packages and objectui's pin:
  # a packed manifest whose dependency NAMES differ from what objectui's lockfile
  # records (a frozen install would link the package without them and exit 0),
  # and an @objectstack/* dependency objectui's root package.json does not
  # override. This tree trips either one by itself, the first time it adds or
  # drops a runtime dependency of one of these packages after the objectstack
  # commit objectui's `.objectstack-sha` names, and the fix lives in objectui.
  echo "→ Packing them into objectui's install from ${FRAMEWORK_ROOT} (OBJECTSTACK_ROOT)"
  if ! (cd "$BUILD_ROOT" && OBJECTSTACK_ROOT="$FRAMEWORK_ROOT" node scripts/objectstack-pin.mjs build); then
    echo "✗ objectui@${PINNED_SHA:0:12}'s scripts/objectstack-pin.mjs refused to stand this tree in for"
    echo "  the objectstack commit its .objectstack-sha names (the reason is above)."
    echo "  If the reason names a dependency (pnpm-lock.yaml does not record what the build"
    echo "  declares, or an @objectstack/* package the root package.json does not override): this"
    echo "  tree added or dropped a runtime dependency of a package objectui installs from it, after"
    echo "  the objectstack commit objectui pins. objectui has to learn it first, in objectui: move"
    echo "  its .objectstack-sha to an objectstack commit that carries the change"
    echo "  (scripts/bump-objectstack.sh there), commit the pnpm-lock.yaml (and any override) that"
    echo "  move needs, land it, then move .objectui-sha here to that objectui commit."
    echo "  ⛔ Not here: editing ${BUILD_ROOT}/pnpm-lock.yaml or making the install below non-frozen"
    echo "  builds a console against a dependency set no objectui commit records."
    if [[ -n "${OS_SKIP_DTS:-}" ]]; then
      echo "  OS_SKIP_DTS is set in this environment. The build above ran without it; a rebuild by"
      echo "  hand, such as the one the pin script prints, inherits it and comes out typeless again:"
      echo "  run it as env -u OS_SKIP_DTS <command>."
    fi
    exit 1
  fi
fi

pushd "$BUILD_ROOT" > /dev/null

# objectui's root package.json may pin packages that aren't available on
# every mirror. Fall back to the public registry just for this install.
#
# The console build needs objectui's devDependencies, so production mode is
# forced OFF: an inherited `npm_config_production=true` or an .npmrc
# `production=true` would otherwise skip them (NODE_ENV=production alone does
# not, under pnpm 10). Spelled `--config.production=false`, never
# `--prod=false`: a global pnpm 11+/12 `@pnpm/exe` frontend parses the argv
# itself before handing off to the version objectui pins, rejects a value on its
# boolean `--prod` and exits 2 without installing anything. The pinned pnpm and
# that frontend both accept this spelling.
NPM_CONFIG_REGISTRY_OVERRIDE="${OBJECTUI_NPM_REGISTRY:-https://registry.npmjs.org}"
npm_config_registry="$NPM_CONFIG_REGISTRY_OVERRIDE" \
  pnpm install --frozen-lockfile --prefer-offline --config.production=false

# Build the console's workspace deps via turbo, then the SPA itself directly
# (see DEPS_BUILD_CMD/BUILD_CMD above for why these are split).
eval "$DEPS_BUILD_CMD"
eval "$BUILD_CMD"

popd > /dev/null

CONSOLE_DIST="${BUILD_ROOT}/apps/console/dist"
if [[ ! -f "${CONSOLE_DIST}/index.html" ]]; then
  echo "✗ Build did not produce ${CONSOLE_DIST}/index.html"
  exit 1
fi

TARGET="${FRAMEWORK_ROOT}/packages/console/dist"
echo "→ Copying dist → ${TARGET}"
rm -rf "$TARGET"
mkdir -p "$(dirname "$TARGET")"
cp -R "$CONSOLE_DIST" "$TARGET"

# Provenance stamp: record which objectui SHA this dist was built from, so
# `pnpm check:console-sha` and the CLI serve-time guard can detect drift when
# .objectui-sha later moves ahead of this gitignored, locally-built dist
# (which `turbo run build` does NOT rebuild). Travels inside dist/ so a
# cloud/objectos Docker overlay that replaces dist/ restamps it too.
echo "$PINNED_SHA" > "${TARGET}/.objectui-sha"

# Assert the injected client actually landed in the bundle (see BUNDLE_CANARY).
if ! grep -rq "$BUNDLE_CANARY" "${TARGET}/assets"; then
  echo "✗ Built console dist does not contain '${BUNDLE_CANARY}' — the bundled"
  echo "  @objectstack/client is stale (OBJECTSTACK_CLIENT_DIST injection failed)."
  exit 1
fi
echo "✓ Bundle canary '${BUNDLE_CANARY}' present — framework client is in the bundle."

# Assert ONE zod instance in what ships (see the single-zod canary at the top).
# Placed after the bundle canary and, like it, after the SHA stamp: CI's split
# restore/save saves only when every step passed, so a failure here never
# seeds the dist cache.
if ! assert_single_zod "${TARGET}/assets"; then
  exit 1
fi

# Assert the injected SPEC landed too. Deliberately NOT a frozen literal like
# BUNDLE_CANARY above: "does the bundle carry the surface the framework declares
# now" is a moving target, and any string pinned here would be carried by the
# published spec within one release — after which it passes forever while proving
# nothing, which is the same silent pass this injection exists to remove. The
# script derives its probes from the two specs on disk on every run, and tests
# BOTH directions: the console bundle also holds a second, transitive copy of
# this tree's spec (pulled in through the injected client above), which makes a
# one-sided "is the new text present" probe pass even with no injection at all.
# --objectui is the checkout just built: objectui's own registry mirrors spec
# descriptions, so text its tracked source carries is not evidence of either spec.
# On a pin that installs @objectstack/* from this tree (the OBJECTSTACK_ROOT block
# above), --vendored IS this tree's spec, packed: the script then reports no
# skew, because objectui's install no longer holds a published spec to leak.
node "${FRAMEWORK_ROOT}/scripts/assert-console-spec-injection.mjs" \
  --injected "$SPEC_PKG" \
  --vendored "${BUILD_ROOT}/node_modules/@objectstack/spec" \
  --objectui "$BUILD_ROOT" \
  --assets "${TARGET}/assets"

# ── Ship the TRACKED SDUI manifest (ADR-0080) ────────────────────────
# One producer, one artefact: the repo-root sdui.manifest.json is written by
# scripts/gen-sdui-manifest-node.mjs from THIS built tree at the pin, and held
# against .objectui-sha (plus its sha256 record) by scripts/check-sdui-manifest.mjs
# in the required lint job. The console dist ships that file as-is. Measured
# before the switch: the browser dump this replaces (the retired
# scripts/gen-sdui-manifest.sh, a vite dev server plus Playwright chromium over
# this same tree) and the node output were `cmp`-identical, so the copy loses
# nothing and the console build gains no browser dependency. Nothing here
# regenerates the manifest: a pin that moved without regeneration is reported
# below, and lint is red on it until the regeneration lands.
MANIFEST_SRC="${FRAMEWORK_ROOT}/sdui.manifest.json"
MANIFEST_RECORD="${FRAMEWORK_ROOT}/scripts/sdui-manifest.record.json"
if [[ ! -f "$MANIFEST_SRC" ]]; then
  echo "✗ ${MANIFEST_SRC} is missing — the console dist ships the tracked SDUI manifest."
  echo "  Regenerate it from the tree this run just built: node scripts/gen-sdui-manifest-node.mjs"
  exit 1
fi
cp "$MANIFEST_SRC" "${TARGET}/sdui.manifest.json"
RECORDED_SHA="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).objectuiSha ?? ""))' "$MANIFEST_RECORD" 2>/dev/null || true)"
if [[ "$RECORDED_SHA" == "$PINNED_SHA" ]]; then
  echo "✓ Shipped the tracked sdui.manifest.json (recorded at objectui@${PINNED_SHA:0:12}, this pin)."
else
  echo "⚠ Shipped the tracked sdui.manifest.json, but its record names objectui@${RECORDED_SHA:0:12}, not this pin ${PINNED_SHA:0:12}."
  echo "  Moved the pin? Regenerate from the tree this run just built, then re-run this build to ship it:"
  echo "      node scripts/gen-sdui-manifest-node.mjs"
  echo "  scripts/check-sdui-manifest.mjs keeps the required lint job red until the regeneration lands."
fi

BYTES="$(du -sk "$TARGET" 2>/dev/null | awk '{print $1}')"
echo "✓ @objectstack/console dist ready (${BYTES} KB) from objectui@${PINNED_SHA:0:12}"

# The reminder names the TRIGGER, not just the command (#5960): `pnpm objectui:refresh`
# runs bump-objectui.sh and then this script, so this is the last output an operator
# sees while moving the pin. bump-objectui.sh prints the same step; this repeats it
# because that one has scrolled past a whole console build by now.
echo "ℹ Moved the objectui pin? Regenerate the TRACKED SDUI manifest — the required lint gate:"
echo "      node scripts/gen-sdui-manifest-node.mjs"
echo "  It reads the tree this script just built (.cache/objectui-${PINNED_SHA:0:12}/apps/console) and"
echo "  rewrites sdui.manifest.json + scripts/sdui-manifest.record.json; no browser, no npm install."
