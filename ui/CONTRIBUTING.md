# Contributing to Object UI

Thank you for your interest in contributing to Object UI! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Development Workflow](#development-workflow)
- [Architecture Overview](#architecture-overview)
- [Writing Tests](#writing-tests)
- [Code Style](#code-style)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Documentation](#documentation)
- [Adding Components](#adding-components)
- [Questions & Support](#questions--support)

## Getting Started

### Prerequisites

- **Node.js** 22.13 or higher (the floor root `package.json` declares in `engines.node`)
- **pnpm** 10 or higher (the required package manager — the workspace pins `pnpm@10.31.0` via `packageManager`)
- **Git** for version control
- Basic knowledge of React, TypeScript, and Tailwind CSS

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/objectui.git
   cd objectui
   ```
3. Add upstream remote:
   ```bash
   git remote add upstream https://github.com/objectstack-ai/objectui.git
   ```

## Development Setup

### Install Dependencies

```bash
# Install pnpm if you haven't
npm install -g pnpm

# Build @objectstack/* at the commit .objectstack-sha pins, then install
# (`pnpm run setup` -- not `pnpm setup`, which is pnpm's own built-in command)
pnpm run setup
```

objectui resolves every `@objectstack/*` package from a build of the objectstack
commit that `.objectstack-sha` names, not from npm. `scripts/bump-objectstack.sh`
moves that pin; the dependency and lockfile section of `AGENTS.md` has the whole procedure.
The build is kept once per machine, in `$OBJECTSTACK_PIN_STORE` (default `~/.cache/objectstack-pin`,
or `$XDG_CACHE_HOME/objectstack-pin`), and copied into each new checkout; `pnpm objectstack:status` names it.

### Configure Git Merge Driver for pnpm-lock.yaml

To prevent merge conflicts in `pnpm-lock.yaml`, configure the custom merge driver:

```bash
# Set the merge driver name
git config merge.pnpm-merge.name "pnpm-lock.yaml merge driver"

# Set the merge driver command
git config merge.pnpm-merge.driver "pnpm install"
```

This configuration allows Git to automatically resolve conflicts in `pnpm-lock.yaml` by regenerating the lockfile using `pnpm install` instead of attempting a manual merge.

**This step is not optional bookkeeping — it is the only place the driver is defined.**
`.gitattributes` routes `pnpm-lock.yaml` through a driver named `pnpm-merge`, but naming a
driver does not define one, and no CI workflow defines it either (none of them performs a
merge git carries out on the runner; see the "Lockfile Merge Driver" section of
`content/docs/guide/ci-cd-pipeline.md`). Skip this and the `git merge upstream/main` below
leaves conflict markers inside `pnpm-lock.yaml` instead of regenerating it.

### Create a Branch

```bash
# Sync with upstream
git fetch upstream
git checkout main
git merge upstream/main

# Create a feature branch
git checkout -b feature/your-feature-name
```

## Development Workflow

### Running Development Servers

```bash
# Run the console app — the main dev playground (app shell + the full plugin set,
# including the visual designer, which mounts here rather than in a demo of its own)
pnpm dev

# Run an example app (console-starter and byo-backend-console are the two that ship
# a dev server; hello-world has none, and schema-catalog is a data package)
pnpm --filter @object-ui/example-console-starter dev

# Run the documentation site
pnpm site:dev
```

### Building

```bash
# Build all packages
pnpm build

# Build specific package
cd packages/core && pnpm build
```

### Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with UI (interactive)
pnpm test:ui

# Generate coverage report
pnpm test:coverage
```

### Linting

```bash
# Lint all packages
pnpm lint

# Lint specific package
cd packages/react && pnpm lint
```

## Architecture Overview

Object UI follows a modular monorepo architecture:

```
packages/
├── types/          # TypeScript type definitions (Zero dependencies)
├── core/           # Core logic, validation, registry (Zero React)
├── react/          # React bindings and SchemaRenderer
├── components/     # UI components (Tailwind + Shadcn)
├── designer/       # Visual schema editor
├── plugin-charts/  # Chart components plugin
└── plugin-editor/  # Rich text editor plugin
```

### Key Principles

1. **Protocol Agnostic**: Core never depends on specific backends
2. **Tailwind Native**: All styling via Tailwind utility classes
3. **Type Safety**: Strict TypeScript everywhere
4. **Tree Shakable**: Modular imports, no monolithic bundles
5. **Zero React in Core**: Core package has no React dependencies

See the [Architecture Overview](./content/docs/guide/architecture.md) guide for details.

## Writing Tests

### Test Structure

All tests should be placed in `__tests__` directories within the source code. We use **Vitest** and **React Testing Library**.

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MyComponent } from './MyComponent'

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />)
    expect(screen.getByText('Expected Text')).toBeInTheDocument()
  })
  
  it('should handle user interaction', async () => {
    const { user } = render(<MyComponent />)
    await user.click(screen.getByRole('button'))
    expect(screen.getByText('Clicked')).toBeInTheDocument()
  })
})
```

### Testing Best Practices

- Write tests for all new features
- Test user interactions, not implementation details
- Use meaningful test descriptions
- Maintain or improve code coverage (current thresholds: 63% lines, 43% functions, 40% branches, 62% statements)
- Aim to gradually increase coverage toward the long-term goal of 80%+ across all metrics
- Test edge cases and error states

## Code Style

### TypeScript Guidelines

```typescript
// ✅ Good: Explicit types, clear naming
interface UserData {
  id: string
  name: string
  email: string
}

function getUserById(id: string): UserData | null {
  // implementation
}

// ❌ Bad: Implicit any, unclear naming
function get(x) {
  // implementation
}
```

### React Component Guidelines

```tsx
// ✅ Good: TypeScript, named exports, clear props
interface ButtonProps {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary'
}

export function Button({ label, onClick, variant = 'primary' }: ButtonProps) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        'px-4 py-2 rounded',
        variant === 'primary' ? 'bg-blue-500' : 'bg-gray-500'
      )}
    >
      {label}
    </button>
  )
}

// ❌ Bad: No types, default export, inline styles
export default function Button(props) {
  return <button style={{ color: 'blue' }}>{props.label}</button>
}
```

### Styling Guidelines

- **Always use Tailwind**: Never use inline styles or CSS modules
- **Use `cn()` utility**: For conditional classes
- **Extract repeated classes**: Create reusable class combinations
- **Follow Shadcn patterns**: Match the style of existing components

```tsx
// ✅ Good
<div className={cn(
  'flex items-center gap-2 p-4',
  isActive && 'bg-blue-50',
  className
)}>
  {children}
</div>

// ❌ Bad
<div style={{ display: 'flex', padding: '16px' }}>
  {children}
</div>
```

### General Guidelines

- Use meaningful variable and function names
- Keep functions small and focused (< 50 lines)
- Add JSDoc comments for public APIs
- Avoid deep nesting (max 3 levels)
- Use early returns to reduce complexity

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

### Commit Types

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks (deps, config)
- `refactor:` - Code refactoring (no behavior change)
- `perf:` - Performance improvements
- `style:` - Code style changes (formatting)

### Examples

```bash
feat: add date picker component
fix: resolve schema validation error
docs: update installation guide
test: add tests for SchemaRenderer
chore: update dependencies
refactor: simplify expression evaluator
```

### Commit Message Format

```
<type>: <subject>

<body (optional)>

<footer (optional)>
```

## Pull Request Process

### Before Submitting

1. **Update from upstream**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Create a changeset** (for package changes):
   ```bash
   pnpm changeset
   ```
   
   This will prompt you to:
   - Select which packages have changed
   - Choose the version bump type (major, minor, patch)
   - Write a summary of the changes
   
   Learn more about changesets in the [Versioning and Releases](#versioning-and-releases) section.

3. **Ensure tests pass**:
   ```bash
   pnpm test
   ```

4. **Ensure build succeeds**:
   ```bash
   pnpm build
   ```

5. **Update documentation** if needed

6. **Add tests** for new features

### Creating the PR

1. Push your branch:
   ```bash
   git push origin feature/your-feature-name
   ```

2. Go to GitHub and create a Pull Request

3. Fill in the PR template:
   - Clear description of changes
   - Link to related issues
   - Screenshots for UI changes
   - Breaking changes (if any)

### PR Guidelines

- Keep PRs focused (one feature/fix per PR)
- Write clear, descriptive PR titles
- Include before/after screenshots for UI changes
- Respond to review comments promptly
- Keep commits clean and meaningful

### Automated Workflows

Our repository includes several automated GitHub workflows that will run when you create a PR:

#### CI Pipeline
- **Linting**: Checks code style and quality
- **Type Checking**: Validates TypeScript types
- **Tests**: Runs unit and integration tests
- **Build**: Ensures all packages build successfully
- **Sharded Testing**: Tests run across 4 shards, all on Node.js 22.x — the only Node version any workflow declares
- **Coverage Thresholds**: Enforces minimum test coverage (see below)

##### Test Coverage Requirements
The project enforces minimum test coverage thresholds to maintain code quality:
- **Lines**: 63% (target: gradually increase to 80%)
- **Functions**: 43% (target: gradually increase to 80%)
- **Branches**: 40% (target: gradually increase to 75%)
- **Statements**: 62% (target: gradually increase to 80%)

These thresholds are intentionally set just below current coverage levels to prevent CI failures from minor fluctuations while we improve test coverage. New code should aim for higher coverage than these minimums.

#### Security Scans
- **Dependabot**: Opens weekly dependency-update PRs for npm and GitHub Actions (configured in `.github/dependabot.yml`), and GitHub's Dependabot alerts report known vulnerabilities in dependencies. Unlike the checks above, this runs on a schedule against the default branch rather than on your PR.

This repository does **not** run static-analysis security scanning of its own source code (CodeQL or equivalent) -- do not assume code you push is scanned for vulnerabilities beyond its dependencies.

#### PR Automation
- **Auto-labeling**: Automatically labels PRs based on changed files
- **Bundle Size**: Reports bundle size changes in PR comments
- **PR Checks**: Validates PR requirements and posts status

#### What to Expect
1. All checks must pass before merging
2. Failed checks will show detailed error messages
3. Some workflows (like auto-labeling) run automatically
4. Review the check results and fix any issues

#### Tips for Passing Checks
- Run `pnpm lint` before committing
- Run `pnpm test` to catch test failures early
- Run `pnpm build` to ensure successful builds
- Keep dependencies up to date
- Follow TypeScript strict mode requirements

## Documentation

### Writing Documentation

We use fumadocs for documentation. The published pages live in `content/docs/**` — that root is declared once, in `apps/site/source.config.ts` (`dir: '../../content/docs'`) — and a file's path below it becomes its route under `/docs`. New and updated documentation pages go there.

The repository root also has a `docs/` directory, and it is **not** part of the site: it holds internal engineering material (ADRs, audits, architecture notes) that the fumadocs collection never reads, so none of it is rendered or reachable at a `/docs/...` route. A page filed there never reaches the site.

**A code block inside one of those records is a SPECIMEN, not an example to copy.** An ADR states what was decided on a date and a dated audit states what was measured on one, so a snippet inside either is part of the record — edited until it compiles, it makes the record say something it never said. Fence such a block `plaintext` (an unhighlighted spelling `scripts/check-doc-fence-languages.mjs` already lists, and one `scripts/check-doc-snippet-types.mjs` does not compile), never `ts` / `tsx` / `typescript`. Code a reader may copy belongs in `content/docs/**` or `skills/objectui/**`, where a gate compiles it and a wrong line can be fixed without falsifying a record. Maintainer ruling 2026-09-08 (objectui#8363); the four records that predate it are not edited — they are named, with their measured counts, in that gate's `UNGATED_DOCS` ledger.

**A `json` fence is what a reader copies into a metadata file, so its body must pass a strict `JSON.parse`.** A block that annotates JSON with `//` or `/* … */` comments or trailing commas is fenced `jsonc` instead, and it must still be one JSON document once those are removed. The tag is how a reader tells a deliberate annotation from a mistake, and a `json` fence that does not parse is always the mistake. The other non-parsing shapes are admitted by no JSON dialect, so rewrite them rather than retag them. A `${…}` expression goes on one line inside its string, because a raw newline in a string is invalid under both tags. A bad/good comparison becomes one fence per document, with its label on the line above. An elision (`...`, `[...]`, a `"..."` member) is removed, which leaves an empty list or the bare node. A counter-example still parses: what is wrong with it belongs in its content, not its syntax. This is the contract `parseJsonFence` in `scripts/check-skill-examples.mjs` enforces on the skills tree's marked fences. `scripts/check-doc-expression-carriage.mjs` imports that same function for every `json` fence on the surface `check:doc-types` walks (objectui#10943). A `json` fence that does not parse lands on that census's unparsed list, and the pin 'has no blind spot on the corpus it ships against' in `scripts/__tests__/check-doc-expression-carriage.test.ts`, which keeps that list empty, fails the pull request that adds it. The census's comment, raw-newline, trailing-comma and elision tolerances apply to `jsonc` only.

```bash
# Start the documentation site dev server
pnpm site:dev

# Build the documentation site
pnpm site:build
```

### Documentation Guidelines

- Use clear, concise language
- Provide code examples for all concepts
- Include both JSON schemas and React code
- Use TypeScript for code examples
- Add practical, real-world examples
- Link to related documentation

### Documentation Link Conventions

**IMPORTANT**: When adding internal links in documentation, follow these conventions to avoid 404 errors:

#### ✅ Correct Link Patterns

```markdown
<!-- Correct - internal documentation links MUST include /docs/ prefix -->
[Quick Start](/docs/guide/quick-start)
[Components](/docs/components)
[API Reference](/docs/api/schema-reference)
[App Schema](/docs/core/app-schema)
[Architecture](/docs/guide/architecture)
```

#### ❌ Incorrect Link Patterns

```markdown
<!-- Wrong - missing /docs/ prefix -->
[Quick Start](/guide/quick-start)          <!-- ❌ Should be /docs/guide/quick-start -->
[Components](/components)                  <!-- ❌ Should be /docs/components -->

<!-- Wrong - top-level section that does not exist under content/docs/ -->
[API Reference](/reference/api/core)       <!-- ❌ No /reference/ section - use /docs/api/schema-reference -->
[Architecture](/architecture/component)    <!-- ❌ No /architecture/ section - use /docs/guide/architecture -->
[Spec](/spec/app)                          <!-- ❌ No /spec/ section - use /docs/core/app-schema -->
```

The example links in the two fenced blocks above are invisible to the link gate — `check-doc-links.mjs` blanks fenced code and inline code spans before it scans (it has to: markdown link syntax quoted inside code is not a link), so whenever you edit these examples, verify each route by hand against the pages actually present in `content/docs/`.

#### Why?

Fumadocs is configured with `baseUrl: '/docs'`, which means all documentation pages are served under the `/docs` route in Next.js. Internal links must include the `/docs/` prefix to match the actual URL structure where the pages are accessible.

#### Validating Links

Two separate checks with two different jobs — knowing which is which saves a wasted debugging round:

- **Internal links are the PR gate.** `scripts/check-doc-links.mjs`, run by `.github/workflows/repo-gates.yml` (its Internal Docs Link Check step) on every pull request to `main` / `develop` (and on pushes to them). It resolves each `/docs/...` route and each relative path against the files in the checkout — reading the tree and nothing else, no network — so it is deterministic, and a failure blocks the merge. The workflow deliberately carries no `paths` filter, so a docs-only PR is checked too. Run the same script locally before you push:

  ```bash
  pnpm docs:check-links
  ```

- **External URLs are swept out of band, and gate nothing.** lychee, run by `.github/workflows/check-links.yml`, makes real network requests and is wired to a weekly cron plus manual `workflow_dispatch` only — never to `pull_request`. That is a deliberate tradeoff (#3213): one third-party 502, rate-limit or anti-scraping response would otherwise turn an unrelated PR red with nothing its author could do about it. The job does fail its own scheduled run on a broken external link; it just never fails yours.

Which files each check reads is declared in the tools themselves — the `SCAN_ROOTS` table at the top of `scripts/check-doc-links.mjs`, and the `args` list in `check-links.yml`. Both surfaces get extended over time, so read them there instead of trusting a list copied into prose.

## Versioning and Releases

We use [Changesets](https://github.com/changesets/changesets) for version management and automated releases.

### Understanding Changesets

Changesets is a tool that helps us:
- **Track changes**: Each PR includes a changeset file describing what changed
- **Automate versioning**: Automatically determine version bumps based on changesets
- **Generate changelogs**: Create comprehensive changelogs from changeset descriptions
- **Coordinate releases**: Release multiple packages together in our monorepo

### When to Create a Changeset

**If your PR changes the `src/` of a package the release covers, it must add a `.changeset/*.md` —
this is enforced by CI** (`changeset-presence.yml`, objectui#3387). "The release covers it" means
the package is named in the `fixed` group of `.changeset/config.json`, which includes
`@object-ui/console` at `apps/console` as well as everything under `packages/`; `@object-ui/site`
and the examples are in `ignore` and are not gated.

What the gate asks for is a **declaration**, not a release:

- ✅ **Score a bump** (`patch` / `minor` — never `major`, see below) for:
  - New features
  - Bug fixes
  - Breaking changes (scored `minor`, with the break described in the body)
  - Performance improvements
  - API changes

- ✅ **Declare that it releases nothing** — a changeset with an **empty frontmatter** — for:
  - Internal refactoring with no user-facing change
  - Test-only changes under a package's `src/`
  - Dead-code removal

  ```md
  ---
  ---

  Removed the orphaned SystemObjectViewPage; no published behaviour changes.
  ```

  This is a first-class pass, not a workaround. It costs one line and it puts the reason in the
  repository, where the next reader finds it — which is the whole point: three user-visible fixes
  shipped with no changeset and therefore appear in no CHANGELOG, version number or release note
  anywhere (objectui#3387).

- ❌ **No changeset is needed at all for** changes that touch no released package's `src/`:
  documentation, CI configuration, repo-level scripts, the examples, `apps/site`.

Run `node scripts/check-changeset-presence.mjs` locally to get the same answer CI will give,
including for a changeset you have written but not yet committed.

### How to Create a Changeset

1. **Run the changeset command**:
   ```bash
   pnpm changeset
   ```

2. **Select packages**: Use arrow keys and spacebar to select which packages changed
   ```
   🦋  Which packages would you like to include?
   ◯ @object-ui/core
   ◉ @object-ui/react
   ◯ @object-ui/components
   ```

3. **Choose version bump type**:
   - **Major** (x.0.0): Breaking changes
   - **Minor** (0.x.0): New features (backwards compatible)
   - **Patch** (0.0.x): Bug fixes and minor updates

4. **Write a summary**: Describe what changed
   ```
   Summary: Add support for custom validation rules in forms
   ```

5. **Commit the changeset file**:
   ```bash
   git add .changeset/*.md
   git commit -m "chore: add changeset"
   ```

### Changeset Message Guidelines

Write clear, user-facing descriptions:

```markdown
✅ Good:
- Add support for custom date formats in DatePicker
- Fix validation error in nested form fields
- Improve performance of large data grids by 50%

❌ Bad:
- Updated code
- Fixed bug
- Changes to validation
```

**A count over the repository is a reading of one tree.** "N files", "N call sites" or "N
occurrences" publishes verbatim, is never re-checked, and the next file added can falsify it —
a sibling release note quoting the same token included. State it in the past tense, as a reading
at a named commit, or leave it out ("this branch" means nothing once it is in the CHANGELOG).
Commandment #9 of [AGENTS.md](./AGENTS.md) is the general rule.

```markdown
✅ Good:
- Measured on this branch's base (`abc1234`): 14 call sites used the retired prop; all 14 are rewritten.

❌ Bad:
- 14 call sites in the repository use the retired prop.
```

### Release Process

The release process is automated:

1. **Create PR with changes** → Include a changeset file
2. **PR is merged** → The Changesets bot opens or refreshes the **release PR**
3. **The release PR is merged** → Packages are automatically published to npm

**The release PR is identified by its head branch, `changeset-release/main`, never
by its title.** The [Changesets action](https://github.com/changesets/action)
derives that branch from the base branch, so it is a stable convention that holds
across repositories. The title is not: it is the `title:` input this repository
passes to the action in
[`.github/workflows/changeset-release.yml`](.github/workflows/changeset-release.yml),
it is repository-local configuration, and it differs from repository to
repository. To locate the current release PR — its number and its title included
— search the head branch:

```text
is:pr is:open head:changeset-release
```

You don't need to manually:
- Update version numbers
- Update CHANGELOGs
- Create Git tags
- Publish to npm

Everything is handled by the changeset automation!

### Example Workflow

```bash
# 1. Create a feature branch
git checkout -b feat/add-date-picker

# 2. Make your changes
# ... edit files ...

# 3. Create a changeset
pnpm changeset
# Select @object-ui/components
# Choose "minor" (new feature)
# Summary: "Add DatePicker component with calendar popup"

# 4. Commit everything
git add .
git commit -m "feat: add DatePicker component"

# 5. Push and create PR
git push origin feat/add-date-picker
```

## Adding Components

### Creating a New Component

1. **Define the schema** in `packages/types/`:
   ```typescript
   export interface MyComponentSchema extends BaseSchema {
     type: 'my-component'
     title: string
     content: string
   }
   ```

2. **Implement the component** in `packages/components/`:
   ```tsx
   export function MyComponent(props: { schema: MyComponentSchema }) {
     return (
       <div className={cn('p-4', props.schema.className)}>
         <h3>{props.schema.title}</h3>
         <p>{props.schema.content}</p>
       </div>
     )
   }
   ```

3. **Register the component**:
   ```typescript
   registry.register('my-component', MyComponent)
   ```

4. **Add tests**:
   ```typescript
   describe('MyComponent', () => {
     it('should render title and content', () => {
       const schema = {
         type: 'my-component',
         title: 'Test',
         content: 'Content'
       }
       render(<SchemaRenderer schema={schema} />)
       expect(screen.getByText('Test')).toBeInTheDocument()
     })
   })
   ```

5. **Add documentation** in `docs/components/my-component.md`

## Questions & Support

### Where to Ask Questions

- **GitHub Discussions** - General questions and ideas
- **GitHub Issues** - Bug reports and feature requests
- **Email** - hello@objectui.org

### How to Report Bugs

1. Check if the bug is already reported
2. Create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Code examples (minimal reproduction)
   - Environment details (OS, Node version, etc.)

### Feature Requests

1. Check if it's already requested
2. Open a discussion to gather feedback
3. If approved, create an issue with detailed spec

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Object UI! 🎉
