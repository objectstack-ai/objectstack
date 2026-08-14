// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.

/**
 * The scaffolder's template catalog and the lookup that resolves a `-t` value
 * against it.
 *
 * Lives beside index.ts rather than inside it so tests can import it: index.ts
 * calls `program.parse()` at module scope, so importing *that* runs the CLI.
 * The registry is what the help text, the refusal path and the README ratchet
 * all read, so it is the one piece that has to be assertable directly.
 */

/** Where a template's files come from. Bundled is the only source today. */
export type TemplateSource = { kind: 'bundled'; dir: string };

export interface TemplateInfo {
  description: string;
  source: TemplateSource;
}

/**
 * Every template `create-objectstack` can scaffold — and therefore everything
 * `--help` offers and the README documents (pinned by template-consistency.test.ts).
 */
export const TEMPLATES: Record<string, TemplateInfo> = {
  blank: {
    description: 'Minimal starter — one object, REST API, ready to extend',
    source: { kind: 'bundled', dir: 'blank' },
  },
};

/**
 * Templates this scaffolder used to offer and no longer does.
 *
 * The five remote content templates were delisted from the official
 * marketplace and are no longer maintained, so they are gone from TEMPLATES
 * above — neither advertised in `--help` nor scaffoldable. They are still
 * named here because a returning user has `-t todo` in a script, a bookmark or
 * an old tutorial, and the generic "Unknown template" error would tell them
 * nothing about what happened to it. A named refusal costs five strings and
 * turns a dead end into an explanation.
 *
 * Deliberately a closed historical list, not a registry that grows: nothing
 * should ever be *added* here without the same delisting behind it.
 */
export const RETIRED_TEMPLATES: readonly string[] = [
  'todo',
  'compliance',
  'content',
  'contracts',
  'procurement',
];

/** The outcome of resolving a user-supplied `-t` value. */
export type TemplateLookup =
  | { kind: 'found'; name: string; template: TemplateInfo }
  | { kind: 'retired'; name: string }
  | { kind: 'unknown'; name: string };

/**
 * Resolve a template name. Three outcomes rather than two: a retired name is
 * not the same answer as a name that never existed, and the CLI says so.
 */
export function lookupTemplate(name: string): TemplateLookup {
  const template = TEMPLATES[name];
  if (template) return { kind: 'found', name, template };
  if (RETIRED_TEMPLATES.includes(name)) return { kind: 'retired', name };
  return { kind: 'unknown', name };
}

/** The catalog's names, in registry order — what `--help` lists. */
export function templateNames(): string[] {
  return Object.keys(TEMPLATES);
}
