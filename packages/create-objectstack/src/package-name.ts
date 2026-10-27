// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// The project name is checked against npm's package-name rules BEFORE the
// scaffolder writes anything. Kept out of index.ts because that module calls
// `program.parse()` on import — anything a test needs must be importable
// without running the CLI (same reason as pkg-utils.ts).
//
// WHY A REFUSAL, AND NEVER A REWRITE
// ----------------------------------
// The resolved project name — the `[name]` argument, or the current
// directory's basename when there is none — is written verbatim into
// `package.json` `name` and `objectstack.manifest.json` `name`. A display-style
// name (`My App!`, `MyApp`) used to land there unchecked: `validate` and
// `build` pass on such a project, and the first refusal came from npm itself,
// at `npm publish`, far from its cause.
//
// The name is the user's choice, so the scaffolder does not normalise it
// behind their back: it refuses, states the rule, and names the slug it would
// suggest instead. The user re-runs with the name they accept, and that is the
// value written.
//
// WHY npm's OWN PREDICATE
// -----------------------
// The verdict is `validate-npm-package-name`'s `validForNewPackages` — the
// module npm itself consults — rather than a restated rule set. "Valid for NEW
// packages" is the bar a freshly scaffolded project has to meet: names npm
// still accepts only for packages that already exist (capital letters, a core
// module name such as `http`) are refused here too.

import validateNpmPackageName from 'validate-npm-package-name';

/** npm's ceiling on a package name, the scope included. */
const NPM_NAME_MAX_LENGTH = 214;

/** The rule, stated once, in the refusal every invalid name gets. */
export const NPM_NAME_RULE =
  'An npm package name is lowercase, at most 214 characters, made of URL-safe ' +
  'characters (letters, digits, "-", ".", "_"), does not start with ".", "_" or "-", ' +
  'and may carry a scope (@scope/name).';

export type ProjectNameVerdict =
  | { valid: true }
  | {
      valid: false;
      /** npm's own reasons, verbatim from `validate-npm-package-name`. */
      reasons: string[];
      /** A legal name derived from the input, or undefined when none derives cleanly. */
      suggestion: string | undefined;
    };

/** Whether `name` may be written to a new project's `package.json` as-is. */
export function checkProjectName(name: string): ProjectNameVerdict {
  const result = validateNpmPackageName(name);
  if (result.validForNewPackages) return { valid: true };
  return {
    valid: false,
    reasons: [...(result.errors ?? []), ...(result.warnings ?? [])],
    suggestion: suggestPackageName(name),
  };
}

/** One name segment → lowercase, hyphen-separated, npm-safe characters only. */
function slugSegment(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2') // MyApp -> My-App
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
}

/**
 * The slug a refusal suggests for `name`: `My App!` → `my-app`, `MyApp` →
 * `my-app`, `@Acme/My App` → `@acme/my-app`.
 *
 * Only a SUGGESTION — it is printed, never written. Returns undefined when the
 * slug is empty or is itself refused by npm (`HTTP` slugs to the core module
 * name `http`), so the refusal never recommends a name it would refuse next.
 */
export function suggestPackageName(name: string): string | undefined {
  const scoped = /^@([^/]*)\/(.*)$/.exec(name.trim());
  const scope = scoped ? slugSegment(scoped[1]) : '';
  const prefix = scope ? `@${scope}/` : '';
  const budget = NPM_NAME_MAX_LENGTH - prefix.length;
  const base = slugSegment(scoped ? scoped[2] : name)
    .slice(0, budget)
    .replace(/[-._]+$/, '');
  if (!base) return undefined;
  const slug = `${prefix}${base}`;
  return validateNpmPackageName(slug).validForNewPackages ? slug : undefined;
}

/**
 * The lines of the refusal, without colour, the first one being the headline.
 *
 * `fromDirectory` is the no-argument path: the name was not typed, it is the
 * current directory's basename, so the remedy is to rename the directory or
 * to scaffold into a new one under a name passed explicitly.
 */
export function describeInvalidProjectName(
  name: string,
  verdict: Extract<ProjectNameVerdict, { valid: false }>,
  { fromDirectory }: { fromDirectory: boolean },
): string[] {
  const subject = fromDirectory
    ? `The current directory's name "${name}" is the project name, and it`
    : `The project name "${name}"`;
  const lines = [
    `${subject} is not a valid npm package name, so it cannot be written to package.json. Nothing was written.`,
    `npm refuses it: ${verdict.reasons.join('; ')}.`,
    NPM_NAME_RULE,
  ];
  const example = verdict.suggestion ?? 'my-app';
  const rerun = `create-objectstack ${example}`;
  if (fromDirectory) {
    lines.push(
      verdict.suggestion
        ? `Rename this directory to "${verdict.suggestion}" and re-run, or scaffold into a new directory: ${rerun}`
        : `Rename this directory to a valid name and re-run, or scaffold into a new directory, e.g.: ${rerun}`,
    );
  } else {
    lines.push(
      verdict.suggestion ? `Suggested name: ${rerun}` : `Choose a valid name, e.g.: ${rerun}`,
    );
  }
  return lines;
}
