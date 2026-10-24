#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 ObjectUI Development Environment Setup${NC}"
echo -e "${BLUE}==========================================${NC}\n"

# Check Node.js — the floor is READ from the root package.json's `engines.node`
# rather than repeated here, so this script and the manifest cannot drift apart
# (objectui#5306: this check demanded Node 20 while the manifest said 22).
echo -e "${YELLOW}Checking prerequisites...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    echo -e "${YELLOW}Please install Node.js from https://nodejs.org/ — the required version is the one root package.json declares in engines.node${NC}"
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Assert the root manifest actually DECLARES a script before this file invokes
# it, so a name this file gets wrong is LOUD.
#
# The alternative failed silently for as long as it was wrong: this script used
# to call `pnpm test:root`, a script the root manifest has never declared. pnpm
# exits 254 on an unknown script -- but that call sat inside an `if`, and an
# `if` condition suppresses `set -e`, so the miss took the else branch and
# printed "Some tests failed, but setup is complete". The "run tests" step was
# a no-op that reported it had run (objectui#7987). A step that cannot run
# while reporting that it did is worse than one that fails: the contributor who
# reads the warning believes the suite exists and is partly broken, the one who
# does not believes it passed, and nothing distinguishes the two.
#
# Reading the name back out of the manifest is the same discipline the Node
# floor above follows (objectui#5306): the script and the manifest cannot drift
# apart, because the script asks the manifest.
require_root_script() {
    if ! node -e 'process.exit(require(process.argv[1]).scripts[process.argv[2]] ? 0 : 1)' \
        "$REPO_ROOT/package.json" "$1"; then
        echo -e "${RED}❌ setup.sh bug: root package.json declares no \"$1\" script${NC}"
        echo -e "${YELLOW}That is a defect in this script, not in your environment.${NC}"
        echo -e "${YELLOW}Please report it: https://github.com/objectstack-ai/objectui/issues${NC}"
        exit 1
    fi
}

# `>=22.11` -> `22.11`. A failed read exits the script under `set -e`, so an
# unreadable manifest can never be mistaken for a satisfied floor.
NODE_FLOOR=$(node -p "require('$REPO_ROOT/package.json').engines.node.replace(/^[^0-9]*/, '')")
if [ "$(printf '%s\n%s\n' "$NODE_FLOOR" "$(node -v | cut -d'v' -f2)" | sort -V | head -n1)" != "$NODE_FLOOR" ]; then
    echo -e "${RED}❌ Node.js $NODE_FLOOR or higher is required (current: $(node -v))${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v) detected${NC}"

# Check/Install pnpm
if ! command -v pnpm &> /dev/null; then
    echo -e "${YELLOW}📦 Installing pnpm...${NC}"
    npm install -g pnpm
fi

PNPM_FLOOR=$(node -p "require('$REPO_ROOT/package.json').engines.pnpm.replace(/^[^0-9]*/, '')")
if [ "$(printf '%s\n%s\n' "$PNPM_FLOOR" "$(pnpm -v)" | sort -V | head -n1)" != "$PNPM_FLOOR" ]; then
    echo -e "${YELLOW}📦 Upgrading pnpm to v$PNPM_FLOOR+...${NC}"
    npm install -g pnpm@latest
fi
echo -e "${GREEN}✓ pnpm $(pnpm -v) detected${NC}"

# Install dependencies. Every @objectstack/* package resolves to a build of the
# objectstack commit `.objectstack-sha` pins (objectui#12957), so `setup` builds
# that first and then installs frozen -- a bare `pnpm install` on a clean
# checkout fails on the missing build directory. (`pnpm run setup`, never
# `pnpm setup`: the latter is pnpm's own built-in command.)
echo -e "\n${YELLOW}📦 Building @objectstack/* at the pin, then installing dependencies...${NC}"
require_root_script setup
pnpm run setup

# Build the packages
#
# One `pnpm build` -- which is `turbo run build`, and derives the order from the
# manifests. Do NOT hand-list packages here again. This block used to build six
# of them one at a time in a hand-written order (types, core, react, components,
# fields, layout): a hand-maintained copy of a dependency graph turbo already
# owns, and it had drifted from it. `@object-ui/react` depends on
# `@object-ui/i18n` and `@object-ui/data-objectstack`, neither of which was on
# the list, so on a CLEAN checkout the third step died with
#
#   src/index.ts(99,8): error TS2307: Cannot find module '@object-ui/i18n' ...
#
# and `set -e` took the whole script down before it reached anything else --
# reproduced at exit status 2 on `3f775eeb8` (objectui#7987; the same defect
# class objectui#7292 measured on `packages/components/package.json`'s
# `prebuild`). A hand-written order cannot be kept correct by review, because
# nothing tells the person adding a dependency that this file exists.
echo -e "\n${YELLOW}🔨 Building packages...${NC}"
echo -e "${BLUE}This may take a few minutes on first run...${NC}"

require_root_script build
pnpm build
echo -e "${GREEN}✓ Packages built${NC}"

# Run tests
#
# `pnpm test` -- the script README.md's manual-setup path tells a contributor to
# run, and the one this file's own "Available commands" block advertises below.
# A red suite is still tolerated (setup is complete either way), but that
# tolerance now covers ONLY a genuine test failure: `require_root_script` has
# already refused an undeclared name, so the else branch below can no longer be
# reached by a step that never ran.
echo -e "\n${YELLOW}🧪 Running tests...${NC}"
require_root_script test
if pnpm test; then
    echo -e "${GREEN}✓ All tests passed${NC}"
else
    echo -e "${YELLOW}⚠ Some tests failed, but setup is complete${NC}"
fi

# Success message
echo -e "\n${GREEN}✅ Setup complete!${NC}\n"
echo -e "${BLUE}Available commands:${NC}"
echo -e "  ${GREEN}pnpm dev${NC}              - Start development server"
echo -e "  ${GREEN}pnpm build${NC}            - Build all packages (with Turbo)"
echo -e "  ${GREEN}pnpm test${NC}             - Run all tests"
echo -e "  ${GREEN}pnpm lint${NC}             - Lint all packages"
echo -e "  ${GREEN}pnpm create-plugin${NC}    - Create a new plugin\n"

echo -e "${BLUE}Next steps:${NC}"
echo -e "  1. Read ${GREEN}README.md${NC} for project overview"
echo -e "  2. Read ${GREEN}CONTRIBUTING.md${NC} for contribution guidelines"
echo -e "  3. Read ${GREEN}docs/ARCHITECTURE.md${NC} for architecture insights"
echo -e "  4. Run ${GREEN}pnpm dev${NC} to start coding!\n"

echo -e "${BLUE}Happy coding! 🎉${NC}\n"
