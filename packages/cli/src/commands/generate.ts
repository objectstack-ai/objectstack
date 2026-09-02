// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { printHeader, printSuccess, printError, printInfo, printStep, createTimer, CLI_ALIAS } from '../utils/format.js';
import { metadataFileName } from '../utils/metadata-file-name.js';

// ─── Metadata Type Templates ────────────────────────────────────────

/**
 * The scaffold templates, keyed by metadata type.
 *
 * A generator declares WHAT to write. It does not declare what the file is
 * called: every filename comes from {@link metadataFileName}, which reads the
 * type's own `filePatterns` out of `DEFAULT_METADATA_TYPE_REGISTRY`. The
 * harness wrote `NAME.ts` for years, which matches no pattern the registry
 * declares for any type; #11025 closed that for `skill` alone through a
 * per-generator override, and #11071 replaced the override with the derived
 * default so a type added here cannot arrive misnamed by omission.
 *
 * A type registered here that the registry gives no TypeScript pattern is
 * refused at generation time rather than written to a name nothing globs, and
 * `generate-file-name-registry-parity.test.ts` turns that runtime refusal into
 * a CI failure so nobody meets it as a user.
 */
const GENERATORS: Record<string, {
  description: string;
  defaultDir: string;
  generate: (name: string) => string;
}> = {
  object: {
    description: 'Business data object',
    defaultDir: 'src/objects',
    generate: (name: string) => `import * as Data from '@objectstack/spec/data';

/**
 * ${toTitleCase(name)} Object
 */
const ${toCamelCase(name)}: Data.Object = {
  name: '${toSnakeCase(name)}',
  label: '${toTitleCase(name)}',
  pluralLabel: '${toTitleCase(name)}s',
  fields: {
    name: {
      type: 'text',
      label: 'Name',
      required: true,
      maxLength: 255,
    },
    description: {
      type: 'textarea',
      label: 'Description',
    },
  },
};

export default ${toCamelCase(name)};
`,
  },

  view: {
    description: 'List or form view',
    defaultDir: 'src/views',
    generate: (name: string) => `import * as UI from '@objectstack/spec/ui';

/**
 * ${toTitleCase(name)} List View
 */
const ${toCamelCase(name)}ListView: UI.View = {
  name: '${toSnakeCase(name)}_list',
  label: '${toTitleCase(name)} List',
  type: 'list',
  objectName: '${toSnakeCase(name)}',
  list: {
    type: 'grid',
    columns: [
      { field: 'name', width: 200 },
    ],
    sort: [{ field: 'name', order: 'asc' }],
    pageSize: 25,
  },
};

export default ${toCamelCase(name)}ListView;
`,
  },

  action: {
    description: 'Button or batch action',
    defaultDir: 'src/actions',
    generate: (name: string) => `import * as UI from '@objectstack/spec/ui';

/**
 * ${toTitleCase(name)} Action
 */
const ${toCamelCase(name)}Action: UI.Action = {
  name: '${toSnakeCase(name)}',
  label: '${toTitleCase(name)}',
  type: 'custom',
  objectName: '${toSnakeCase(name)}',
  handler: {
    type: 'flow',
    target: '${toSnakeCase(name)}_flow',
  },
};

export default ${toCamelCase(name)}Action;
`,
  },

  flow: {
    description: 'Automation flow',
    defaultDir: 'src/flows',
    /**
     * A record-change flow in the shape `FlowSchema` accepts (#14087).
     *
     * What this template used to write refused to load: a top-level `trigger:
     * { type, object, events }` block, nodes carrying `name`/`next`, and no
     * `edges`. `FlowSchema` is `.strict()` and declares none of that, so the
     * FIRST flow anybody scaffolded was a file their own `os validate`
     * rejected — with an error enumerating what is allowed rather than saying
     * where the trigger had moved to.
     *
     * The binding lives on the START node's `config`, which is where
     * `AutomationEngine.resolveTriggerBinding` reads it from: `objectName`,
     * one `record-*` `triggerType` token, and an optional bare-CEL
     * `condition`. `triggerType` is NOT judged by the schema — a node `config`
     * is an open slot (ADR-0018) — so the token's grammar is held by
     * `validate-flow-trigger-readiness`, an author-time rule `os validate`
     * gates on. `generate-scaffold-validates.test.ts` puts this output through
     * both layers, which is the drift this template is not allowed to repeat.
     *
     * `status` stays `'draft'`: the scaffold fixes the SHAPE and leaves the
     * arming decision to the author (`os validate` says so — draft flows do
     * fire, so declare `'active'` to arm deliberately).
     */
    generate: (name: string) => `import * as Automation from '@objectstack/spec/automation';

/**
 * ${toTitleCase(name)} Flow
 */
const ${toCamelCase(name)}Flow: Automation.Flow = {
  name: '${toSnakeCase(name)}_flow',
  label: '${toTitleCase(name)} Flow',
  type: 'record_change',
  status: 'draft',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'Start',
      // A record-change flow binds its trigger HERE, on the START node's
      // config — there is no top-level \`trigger\` key.
      //   objectName  the object whose writes fire this flow
      //   triggerType one record-{before,after}-{create,update,delete,write}
      //               token ('write' is create OR update, in one flow)
      //   condition   optional bare-CEL gate, e.g. 'record.amount >= 500'
      config: {
        objectName: '${toSnakeCase(name)}',
        triggerType: 'record-after-write',
      },
    },
    {
      id: 'end',
      type: 'end',
      label: 'End',
    },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'end', type: 'default' },
  ],
};

export default ${toCamelCase(name)}Flow;
`,
  },

  dashboard: {
    description: 'Analytics dashboard',
    defaultDir: 'src/dashboards',
    generate: (name: string) => `import * as UI from '@objectstack/spec/ui';

/**
 * ${toTitleCase(name)} Dashboard
 */
const ${toCamelCase(name)}Dashboard: UI.Dashboard = {
  name: '${toSnakeCase(name)}_dashboard',
  label: '${toTitleCase(name)} Dashboard',
  widgets: [],
};

export default ${toCamelCase(name)}Dashboard;
`,
  },

  app: {
    description: 'Application navigation',
    defaultDir: 'src/apps',
    generate: (name: string) => `import * as UI from '@objectstack/spec/ui';

/**
 * ${toTitleCase(name)} App
 */
const ${toCamelCase(name)}App: UI.App = {
  name: '${toSnakeCase(name)}_app',
  label: '${toTitleCase(name)}',
  navigation: {
    type: 'sidebar',
    items: [],
  },
};

export default ${toCamelCase(name)}App;
`,
  },

  skill: {
    description: 'AI skill (ADR-0063 extension primitive)',
    defaultDir: 'src/skills',
    /**
     * Written as `NAME.skill.ts` — from the registry's own pattern now, not
     * from a per-generator override.
     *
     * `skill` is where the consequence of getting this wrong was first
     * measured (#11025). It is `allowRuntimeCreate: true`, a type the platform
     * expects to DISCOVER rather than one wired in by hand, so a scaffold
     * named `lead_qualification.ts` matches neither `*.skill.ts` nor
     * `*.skill.yml`, and then type-checks, passes `os validate` and publishes
     * with nothing anywhere saying it was skipped — the silent-strip shape
     * ADR-0063's retirement of `os g agent` closed (#10359), re-entering
     * through the scaffolder that replaced it.
     *
     * That reasoning was scoped to `skill` on the belief that the other six
     * types were not filesystem-discovered. #11071 measured the loader
     * instead — the mechanism, and the precondition that keeps it from
     * firing in this repo today, are stated once in `metadata-file-name.ts`
     * (#12075), not restated here. The override is gone and the rule is the
     * harness default.
     */
    generate: (name: string) => `import { defineSkill } from '@objectstack/spec/ai';

/**
 * ${toTitleCase(name)} Skill
 *
 * Skills are the third-party AI extension primitive (ADR-0063 §2) — agents are
 * platform-internal, so a skill, plus the declarative actions your app already
 * ships, is how you give the assistant a new capability.
 *
 * Authored through \`defineSkill\` rather than as a bare typed literal so the
 * object is parsed the moment this module loads: an unknown or retired key is
 * a startup error naming the key, not a field that goes missing later.
 */
const ${toCamelCase(name)}Skill = defineSkill({
  name: '${toSnakeCase(name)}',
  label: '${toTitleCase(name)}',
  description: 'One line on what this skill is for — the model routes on it.',

  // ADR-0063 §3 — the kernel agent surface this skill binds to, enforced at
  // load time: 'ask' (the data console), 'build' (the authoring surface), or
  // 'both' for a genuinely shared read-only capability. A skill only binds to
  // an agent whose surface it matches. 'ask' is also the schema default, so
  // writing it changes nothing at runtime; it is here because a default taken
  // in silence is a decision the next author cannot see they are inheriting.
  surface: 'ask',

  // Injected into the active agent's system prompt, and projected onto the MCP
  // \`prompts\` primitive by @objectstack/mcp — the half of a skill that runs in
  // every distribution. This is the text the model actually reads.
  instructions: 'Explain when this skill applies and how to use its tools.',

  // Empty on purpose, and a complete skill as it stands: it contributes its
  // instructions and no tools. Under ADR-0064 an agent's tool set is the union
  // of its surface-compatible skills' tools with NO global fall-through, so an
  // empty list grants nothing rather than everything.
  //
  // Fill it with names that resolve — a platform-registered tool, or
  // \`action_NAME\` materialised from one of your own declarative actions that
  // opts in with \`ai: { exposed: true, description: '…' }\` (ADR-0011/0109).
  // A made-up placeholder would be worse than nothing: \`os validate\` reports
  // it (\`ai-skill-tool-unresolved\`), and at runtime the reference is dropped
  // while the instructions keep promising the capability.
  //
  //   tools: ['action_${toSnakeCase(name)}', 'query_records'],
  tools: [],
});

export default ${toCamelCase(name)}Skill;
`,
  },
};

/**
 * Every metadata type `os generate` can scaffold — the directory it scaffolds
 * into, and the source it writes — derived from `GENERATORS` rather than
 * restated.
 *
 * Exported for `generate-file-name-registry-parity.test.ts` (which reads
 * `type` / `defaultDir`) and `generate-scaffold-validates.test.ts` (which
 * reads `generate` to materialize each scaffold and put it through the schema
 * `os validate` parses it with). Derived on purpose: each pin's job is to hold
 * for the NEXT generator somebody adds, and a hand-kept list would leave that
 * one unmeasured while still reading green.
 */
export const GENERATOR_SCAFFOLD_TARGETS: readonly {
  type: string;
  defaultDir: string;
  generate: (name: string) => string;
}[] =
  Object.entries(GENERATORS).map(([type, gen]) => ({
    type,
    defaultDir: gen.defaultDir,
    generate: gen.generate,
  }));

// ─── Retired Generators ─────────────────────────────────────────────

/**
 * Scaffolder types that were withdrawn, and what this command says when one
 * of them is run.
 *
 * A retired type is NOT an unknown type, and deliberately does not fall
 * through to the `Unknown type:` branch in {@link runMetadataGeneration}.
 * That branch prints the surviving roster and nothing else, so an author
 * arriving from a doc page, a tutorial or a CI script that still names the
 * retired type would learn only that their spelling is not on the list —
 * and the natural next move is to hunt for the right spelling of something
 * that no longer exists.
 *
 * `agent` (ADR-0063 §2, which reversed ADR-0040 §3): the kernel ships exactly
 * two agents, `ask` and `build`, bound by surface and never picked from a
 * roster. Tenant / app-package agents were withdrawn, and the runtime catalog
 * filters out every non-platform agent record. The file this generator wrote
 * into `src/agents/` therefore passed `os validate`, published without
 * complaint, and was then dropped on the floor: no error at any step, the
 * agent simply never appeared. Retiring the command silently would have moved
 * that silence one step earlier instead of ending it, which is why each entry
 * owes both halves — the decision that withdrew the surface, and the surface
 * to author instead.
 */
const RETIRED_GENERATORS: Record<string, {
  /** Reason clause completing "`os g <type>` was retired — …". */
  reason: string;
  /** Body lines, printed in order; an empty string prints a blank line. */
  detail: string[];
}> = {
  agent: {
    reason: 'agents are platform-internal (ADR-0063 §2).',
    detail: [
      'The kernel ships exactly two agents, `ask` and `build`, bound by surface.',
      'An agent you author still parses and still publishes — and the runtime',
      'catalog then filters it out, so it never appears and nothing tells you.',
      'This command scaffolded exactly that file, so it is retired, not repaired.',
      '',
      'Author a SKILL instead. Skills (plus tools / MCP) are the third-party',
      'extension primitive ADR-0063 names — the live surface this one was not.',
      '',
      'Scaffold one — the file lands where the loader looks for it:',
      '',
      '    os g skill <name>    ->  src/skills/<name>.skill.ts',
      '',
      "It writes a `defineSkill` template with `surface` and `tools` filled in",
      'and explained, ready to edit.',
      '',
      'Docs: https://objectstack.ai/docs/ai/agents',
    ],
  },
};

// ─── Helpers ────────────────────────────────────────────────────────

function toCamelCase(str: string): string {
  return str.replace(/[-_]([a-z])/g, (_, c) => c.toUpperCase());
}

function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function toSnakeCase(str: string): string {
  return str.replace(/[-]/g, '_').replace(/[A-Z]/g, c => `_${c.toLowerCase()}`).replace(/^_/, '');
}

// ─── Field Type Mapping ─────────────────────────────────────────────

const FIELD_TYPE_MAP: Record<string, string> = {
  text: 'string',
  textarea: 'string',
  richtext: 'string',
  html: 'string',
  markdown: 'string',
  number: 'number',
  integer: 'number',
  currency: 'number',
  percent: 'number',
  boolean: 'boolean',
  date: 'string',
  datetime: 'string',
  time: 'string',
  email: 'string',
  phone: 'string',
  url: 'string',
  select: 'string',
  multiselect: 'string[]',
  lookup: 'string',
  master_detail: 'string',
  formula: 'unknown',
  autonumber: 'string',
  json: 'Record<string, unknown>',
  file: 'string',
  image: 'string',
  password: 'string',
  slug: 'string',
  uuid: 'string',
  ip_address: 'string',
  color: 'string',
  rating: 'number',
  geo_point: '{ lat: number; lng: number }',
  vector: 'number[]',
  encrypted: 'string',
};

function fieldTypeToTs(fieldType: string, multiple?: boolean): string {
  const base = FIELD_TYPE_MAP[fieldType] || 'unknown';
  return multiple ? `${base}[]` : base;
}

function generateTypesFromConfig(config: Record<string, unknown>): string {
  const lines: string[] = [
    '// Auto-generated by ObjectStack CLI — do not edit manually',
    `// Generated at ${new Date().toISOString()}`,
    '',
    "import type * as Data from '@objectstack/spec/data';",
    '',
  ];

  // Extract objects from config (supports both top-level and nested)
  const objects: Record<string, unknown>[] = [];
  const rawObjects = (config as any).objects ?? (config as any).data?.objects ?? {};

  if (Array.isArray(rawObjects)) {
    objects.push(...rawObjects);
  } else if (typeof rawObjects === 'object') {
    for (const val of Object.values(rawObjects)) {
      if (val && typeof val === 'object') objects.push(val as Record<string, unknown>);
    }
  }

  if (objects.length === 0) {
    lines.push('// No objects found in configuration');
    return lines.join('\n') + '\n';
  }

  for (const obj of objects) {
    const name = String(obj.name || 'unknown');
    const typeName = name
      .split('_')
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
    const fields = (obj.fields ?? {}) as Record<string, Record<string, unknown>>;

    lines.push(`/** ${String(obj.label || typeName)} record type */`);
    lines.push(`export interface ${typeName}Record {`);
    lines.push('  id: string;');

    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      const fType = String(fieldDef.type || 'text');
      const tsType = fieldTypeToTs(fType, !!fieldDef.multiple);
      const required = fieldDef.required ? '' : '?';
      if (fieldDef.label) {
        lines.push(`  /** ${fieldDef.label} */`);
      }
      lines.push(`  ${fieldName}${required}: ${tsType};`);
    }

    lines.push('}');
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

// ─── Command ────────────────────────────────────────────────────────

async function runMetadataGeneration(type: string, name: string, flags: { dir?: string; dryRun?: boolean }): Promise<void> {
    printHeader('Generate');

    // A withdrawn type answers for itself, ahead of the roster lookup — see
    // RETIRED_GENERATORS for why "unknown type" is the wrong answer here.
    const retired = RETIRED_GENERATORS[type];
    if (retired) {
      printError(`\`${CLI_ALIAS} g ${type}\` was retired — ${retired.reason}`);
      console.log('');
      for (const line of retired.detail) {
        console.log(line ? chalk.dim(`  ${line}`) : '');
      }
      console.log('');
      process.exit(1);
    }

    const generator = GENERATORS[type];
    if (!generator) {
      printError(`Unknown type: ${type}`);
      console.log('');
      console.log(chalk.bold('  Available types:'));
      for (const [key, gen] of Object.entries(GENERATORS)) {
        console.log(`    ${chalk.cyan(key.padEnd(12))} ${chalk.dim(gen.description)}`);
      }
      console.log('');
      console.log(chalk.dim('  Usage: objectstack generate <type> <name>'));
      console.log(chalk.dim('  Example: objectstack generate object project'));
      console.log(chalk.dim('  Alias: os g object project'));
      process.exit(1);
    }

    const dir = flags.dir || generator.defaultDir;
    // The written name comes from the registry's `filePatterns` for this type
    // — see `metadataFileName`, which carries why it is derived rather than
    // tabulated.
    const fileName = metadataFileName(type, toSnakeCase(name));
    if (fileName === null) {
      // Unreachable for every registered generator, and pinned that way by
      // `generate-file-name-registry-parity.test.ts`. Reached only if someone
      // adds a generator for a type the registry gives no TypeScript pattern,
      // and refusing is the point: the alternative is a file that type-checks,
      // validates, publishes and is never loaded, with no diagnostic at any
      // step.
      printError(`No file naming convention is declared for type: ${type}`);
      console.log('');
      console.log(chalk.dim(
        `  DEFAULT_METADATA_TYPE_REGISTRY has no recursive TypeScript file pattern`,
      ));
      console.log(chalk.dim(
        `  for \`${type}\`, so there is no name this scaffold could be written to`,
      ));
      console.log(chalk.dim(
        '  that the metadata loader would ever glob. Declare one there first.',
      ));
      console.log('');
      process.exit(1);
    }
    // The barrel re-export has to name the file that was actually written, so
    // it is derived from `fileName` rather than rebuilt from `name` — the
    // infix is part of the module specifier, and a barrel rebuilt from the
    // metadata name alone would resolve to nothing.
    const moduleSpecifier = `./${fileName.replace(/\.ts$/, '')}`;
    const filePath = path.join(process.cwd(), dir, fileName);

    console.log(`  ${chalk.dim('Type:')}  ${chalk.cyan(type)} — ${generator.description}`);
    console.log(`  ${chalk.dim('Name:')}  ${chalk.white(name)}`);
    console.log(`  ${chalk.dim('File:')}  ${chalk.white(path.join(dir, fileName))}`);
    console.log('');

    if (flags.dryRun) {
      printInfo('Dry run — no files written');
      console.log('');
      console.log(chalk.dim('  Content:'));
      console.log(chalk.dim('  ' + '-'.repeat(38)));
      const content = generator.generate(name);
      for (const line of content.split('\n')) {
        console.log(chalk.dim(`  ${line}`));
      }
      console.log('');
      return;
    }

    // Check if file exists
    if (fs.existsSync(filePath)) {
      printError(`File already exists: ${filePath}`);
      process.exit(1);
    }

    try {
      // Create directory
      const fullDir = path.dirname(filePath);
      if (!fs.existsSync(fullDir)) {
        fs.mkdirSync(fullDir, { recursive: true });
      }

      // Write file
      const content = generator.generate(name);
      fs.writeFileSync(filePath, content);
      printSuccess(`Created ${path.join(dir, fileName)}`);

      // Check for barrel index
      const indexPath = path.join(process.cwd(), dir, 'index.ts');
      if (fs.existsSync(indexPath)) {
        const indexContent = fs.readFileSync(indexPath, 'utf-8');
        const exportLine = `export { default as ${toCamelCase(name)} } from '${moduleSpecifier}';`;

        if (!indexContent.includes(toCamelCase(name))) {
          fs.appendFileSync(indexPath, exportLine + '\n');
          printSuccess(`Updated ${dir}/index.ts with export`);
        }
      } else {
        // Create barrel index
        const exportLine = `export { default as ${toCamelCase(name)} } from '${moduleSpecifier}';\n`;
        fs.writeFileSync(indexPath, exportLine);
        printSuccess(`Created ${dir}/index.ts`);
      }

      console.log('');
      console.log(chalk.dim(`  Tip: Run \`objectstack validate\` to check your config`));
      console.log('');

    } catch (error: any) {
      printError(error.message || String(error));
      process.exit(1);
    }
}

async function runTypesGeneration(configPath: string | undefined, flags: { output: string; dryRun?: boolean }): Promise<void> {
    printHeader('Generate Types');

    try {
      const { loadConfig } = await import('../utils/config.js');
      printInfo('Loading configuration...');
      const { config, absolutePath } = await loadConfig(configPath);

      console.log(`  ${chalk.dim('Config:')} ${chalk.white(absolutePath)}`);
      console.log(`  ${chalk.dim('Output:')} ${chalk.white(flags.output)}`);
      console.log('');

      const content = generateTypesFromConfig(config as Record<string, unknown>);

      if (flags.dryRun) {
        printInfo('Dry run — no files written');
        console.log('');
        for (const line of content.split('\n')) {
          console.log(chalk.dim(`  ${line}`));
        }
        console.log('');
        return;
      }

      const outPath = path.resolve(process.cwd(), flags.output);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, content);
      printSuccess(`Generated types at ${flags.output}`);
      console.log('');

    } catch (error: any) {
      printError(error.message || String(error));
      process.exit(1);
    }
}

// ─── Client SDK Generator ───────────────────────────────────────────

function generateClientFromConfig(config: Record<string, unknown>): string {
  const lines: string[] = [
    '// Auto-generated by ObjectStack CLI — do not edit manually',
    `// Generated at ${new Date().toISOString()}`,
    '',
    "import type * as Data from '@objectstack/spec/data';",
    '',
  ];

  const objects: Record<string, unknown>[] = [];
  const rawObjects = (config as any).objects ?? (config as any).data?.objects ?? {};

  if (Array.isArray(rawObjects)) {
    objects.push(...rawObjects);
  } else if (typeof rawObjects === 'object') {
    for (const val of Object.values(rawObjects)) {
      if (val && typeof val === 'object') objects.push(val as Record<string, unknown>);
    }
  }

  if (objects.length === 0) {
    lines.push('// No objects found in configuration');
    return lines.join('\n') + '\n';
  }

  // Generate type interfaces
  for (const obj of objects) {
    const name = String(obj.name || 'unknown');
    const typeName = name
      .split('_')
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
    const fields = (obj.fields ?? {}) as Record<string, Record<string, unknown>>;

    lines.push(`export interface ${typeName}Record {`);
    lines.push('  id: string;');

    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      const fType = String(fieldDef.type || 'text');
      const tsType = fieldTypeToTs(fType, !!fieldDef.multiple);
      const required = fieldDef.required ? '' : '?';
      lines.push(`  ${fieldName}${required}: ${tsType};`);
    }

    lines.push('}');
    lines.push('');
  }

  // Generate client class
  lines.push('export class ObjectStackClient {');
  lines.push('  constructor(private baseUrl: string, private headers: Record<string, string> = {}) {}');
  lines.push('');
  lines.push('  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {');
  lines.push('    const res = await fetch(`${this.baseUrl}${path}`, {');
  lines.push('      method,');
  lines.push("      headers: { 'Content-Type': 'application/json', ...this.headers },");
  lines.push('      body: body ? JSON.stringify(body) : undefined,');
  lines.push('    });');
  lines.push('    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);');
  lines.push('    return res.json() as Promise<T>;');
  lines.push('  }');

  for (const obj of objects) {
    const name = String(obj.name || 'unknown');
    const typeName = name
      .split('_')
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
    const endpoint = `/api/${name}`;

    lines.push('');
    lines.push(`  async list${typeName}(): Promise<${typeName}Record[]> {`);
    lines.push(`    return this.request<${typeName}Record[]>('GET', '${endpoint}');`);
    lines.push('  }');
    lines.push('');
    lines.push(`  async get${typeName}(id: string): Promise<${typeName}Record> {`);
    lines.push(`    return this.request<${typeName}Record>('GET', '${endpoint}/\${id}');`);
    lines.push('  }');
    lines.push('');
    lines.push(`  async create${typeName}(data: Omit<${typeName}Record, 'id'>): Promise<${typeName}Record> {`);
    lines.push(`    return this.request<${typeName}Record>('POST', '${endpoint}', data);`);
    lines.push('  }');
    lines.push('');
    lines.push(`  async update${typeName}(id: string, data: Partial<${typeName}Record>): Promise<${typeName}Record> {`);
    lines.push(`    return this.request<${typeName}Record>('PATCH', '${endpoint}/\${id}', data);`);
    lines.push('  }');
    lines.push('');
    lines.push(`  async delete${typeName}(id: string): Promise<void> {`);
    lines.push(`    return this.request<void>('DELETE', '${endpoint}/\${id}');`);
    lines.push('  }');
  }

  lines.push('}');
  lines.push('');

  return lines.join('\n') + '\n';
}

async function runClientGeneration(configPath: string | undefined, flags: { output: string; dryRun?: boolean }): Promise<void> {
    printHeader('Generate Client SDK');

    try {
      const { loadConfig } = await import('../utils/config.js');
      const timer = createTimer();
      printInfo('Loading configuration...');
      const { config, absolutePath } = await loadConfig(configPath);

      console.log(`  ${chalk.dim('Config:')} ${chalk.white(absolutePath)}`);
      console.log(`  ${chalk.dim('Output:')} ${chalk.white(flags.output)}`);
      console.log('');

      printStep('Generating client SDK...');
      const content = generateClientFromConfig(config as Record<string, unknown>);

      if (flags.dryRun) {
        printInfo('Dry run — no files written');
        console.log('');
        for (const line of content.split('\n')) {
          console.log(chalk.dim(`  ${line}`));
        }
        console.log('');
        return;
      }

      const outPath = path.resolve(process.cwd(), flags.output);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, content);
      printSuccess(`Generated client SDK at ${flags.output} (${timer.display()})`);
      console.log('');

    } catch (error: any) {
      printError(error.message || String(error));
      process.exit(1);
    }
}

// ─── Migration Generator ────────────────────────────────────────────

const FIELD_TYPE_SQL_MAP: Record<string, string> = {
  text: 'VARCHAR(255)',
  textarea: 'TEXT',
  richtext: 'TEXT',
  html: 'TEXT',
  markdown: 'TEXT',
  number: 'DECIMAL(18,2)',
  integer: 'INTEGER',
  currency: 'DECIMAL(18,2)',
  percent: 'DECIMAL(5,2)',
  boolean: 'BOOLEAN',
  date: 'DATE',
  datetime: 'TIMESTAMP',
  time: 'TIME',
  email: 'VARCHAR(255)',
  phone: 'VARCHAR(50)',
  url: 'VARCHAR(2048)',
  select: 'VARCHAR(255)',
  multiselect: 'TEXT',
  lookup: 'VARCHAR(36)',
  master_detail: 'VARCHAR(36)',
  formula: 'TEXT',
  autonumber: 'SERIAL',
  json: 'JSONB',
  file: 'VARCHAR(2048)',
  image: 'VARCHAR(2048)',
  password: 'VARCHAR(255)',
  slug: 'VARCHAR(255)',
  uuid: 'UUID',
  ip_address: 'VARCHAR(45)',
  color: 'VARCHAR(7)',
  rating: 'INTEGER',
  geo_point: 'POINT',
  vector: 'VECTOR',
  encrypted: 'TEXT',
};

function fieldTypeToSql(fieldType: string): string {
  return FIELD_TYPE_SQL_MAP[fieldType] || 'TEXT';
}

function generateMigrationSql(config: Record<string, unknown>): string {
  const lines: string[] = [
    '-- Auto-generated by ObjectStack CLI — do not edit manually',
    `-- Generated at ${new Date().toISOString()}`,
    '',
  ];

  const objects: Record<string, unknown>[] = [];
  const rawObjects = (config as any).objects ?? (config as any).data?.objects ?? {};

  if (Array.isArray(rawObjects)) {
    objects.push(...rawObjects);
  } else if (typeof rawObjects === 'object') {
    for (const val of Object.values(rawObjects)) {
      if (val && typeof val === 'object') objects.push(val as Record<string, unknown>);
    }
  }

  if (objects.length === 0) {
    lines.push('-- No objects found in configuration');
    return lines.join('\n') + '\n';
  }

  for (const obj of objects) {
    const tableName = String(obj.name || 'unknown');
    const fields = (obj.fields ?? {}) as Record<string, Record<string, unknown>>;

    lines.push(`CREATE TABLE IF NOT EXISTS "${tableName}" (`);
    lines.push('  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),');

    const fieldLines: string[] = [];
    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      const sqlType = fieldTypeToSql(String(fieldDef.type || 'text'));
      const notNull = fieldDef.required ? ' NOT NULL' : '';
      fieldLines.push(`  "${fieldName}" ${sqlType}${notNull}`);
    }

    fieldLines.push('  "created_at" TIMESTAMP NOT NULL DEFAULT now()');
    fieldLines.push('  "updated_at" TIMESTAMP NOT NULL DEFAULT now()');
    lines.push(fieldLines.join(',\n'));
    lines.push(');');
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

function generateMigrationTs(config: Record<string, unknown>): string {
  const lines: string[] = [
    '// Auto-generated by ObjectStack CLI — do not edit manually',
    `// Generated at ${new Date().toISOString()}`,
    '',
    'export async function up(db: any): Promise<void> {',
  ];

  const objects: Record<string, unknown>[] = [];
  const rawObjects = (config as any).objects ?? (config as any).data?.objects ?? {};

  if (Array.isArray(rawObjects)) {
    objects.push(...rawObjects);
  } else if (typeof rawObjects === 'object') {
    for (const val of Object.values(rawObjects)) {
      if (val && typeof val === 'object') objects.push(val as Record<string, unknown>);
    }
  }

  if (objects.length === 0) {
    lines.push('  // No objects found in configuration');
    lines.push('}');
    lines.push('');
    lines.push('export async function down(db: any): Promise<void> {');
    lines.push('  // No objects found in configuration');
    lines.push('}');
    return lines.join('\n') + '\n';
  }

  for (const obj of objects) {
    const tableName = String(obj.name || 'unknown');
    const fields = (obj.fields ?? {}) as Record<string, Record<string, unknown>>;

    lines.push(`  await db.schema.createTable('${tableName}', (table: any) => {`);
    lines.push("    table.uuid('id').primary().defaultTo(db.fn.uuid());");

    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      const fType = String(fieldDef.type || 'text');
      const required = fieldDef.required ? '.notNullable()' : '.nullable()';
      let colMethod: string;

      switch (fType) {
        case 'text': case 'email': case 'phone': case 'url': case 'select':
        case 'slug': case 'password': case 'color': case 'ip_address':
          colMethod = `table.string('${fieldName}')`;
          break;
        case 'textarea': case 'richtext': case 'html': case 'markdown':
        case 'formula': case 'encrypted':
          colMethod = `table.text('${fieldName}')`;
          break;
        case 'number': case 'currency': case 'percent':
          colMethod = `table.decimal('${fieldName}')`;
          break;
        case 'integer': case 'rating':
          colMethod = `table.integer('${fieldName}')`;
          break;
        case 'boolean':
          colMethod = `table.boolean('${fieldName}')`;
          break;
        case 'date':
          colMethod = `table.date('${fieldName}')`;
          break;
        case 'datetime':
          colMethod = `table.timestamp('${fieldName}')`;
          break;
        case 'time':
          colMethod = `table.time('${fieldName}')`;
          break;
        case 'json': case 'multiselect':
          colMethod = `table.jsonb('${fieldName}')`;
          break;
        case 'uuid': case 'lookup': case 'master_detail':
          colMethod = `table.uuid('${fieldName}')`;
          break;
        // `user` references sys_user, whose id is a text identifier (not a uuid),
        // so store it as a string column — consistent with the runtime sql-driver.
        case 'user':
          colMethod = `table.string('${fieldName}')`;
          break;
        default:
          colMethod = `table.text('${fieldName}')`;
      }

      lines.push(`    ${colMethod}${required};`);
    }

    lines.push("    table.timestamps(true, true);");
    lines.push('  });');
  }

  lines.push('}');
  lines.push('');
  lines.push('export async function down(db: any): Promise<void> {');

  // Drop tables in reverse order
  const tableNames = objects.map(o => String(o.name || 'unknown')).reverse();
  for (const tableName of tableNames) {
    lines.push(`  await db.schema.dropTableIfExists('${tableName}');`);
  }

  lines.push('}');

  return lines.join('\n') + '\n';
}

async function runMigrationGeneration(configPath: string | undefined, flags: { output?: string; format: string; dryRun?: boolean }): Promise<void> {
    printHeader('Generate Migration');

    try {
      const { loadConfig } = await import('../utils/config.js');
      const timer = createTimer();
      printInfo('Loading configuration...');
      const { config, absolutePath } = await loadConfig(configPath);

      const ext = flags.format === 'sql' ? 'sql' : 'ts';
      // Format: YYYYMMDDHHmmss (e.g. 20250101120000)
      const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const defaultOutput = `migrations/${timestamp}_migration.${ext}`;
      const output = flags.output || defaultOutput;

      console.log(`  ${chalk.dim('Config:')} ${chalk.white(absolutePath)}`);
      console.log(`  ${chalk.dim('Format:')} ${chalk.white(flags.format)}`);
      console.log(`  ${chalk.dim('Output:')} ${chalk.white(output)}`);
      console.log('');

      printStep('Generating migration...');
      const content = flags.format === 'sql'
        ? generateMigrationSql(config as Record<string, unknown>)
        : generateMigrationTs(config as Record<string, unknown>);

      if (flags.dryRun) {
        printInfo('Dry run — no files written');
        console.log('');
        for (const line of content.split('\n')) {
          console.log(chalk.dim(`  ${line}`));
        }
        console.log('');
        return;
      }

      const outPath = path.resolve(process.cwd(), output);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, content);
      printSuccess(`Generated migration at ${output} (${timer.display()})`);
      console.log('');

    } catch (error: any) {
      printError(error.message || String(error));
      process.exit(1);
    }
}

// ─── JSON Schema Generator ──────────────────────────────────────────

async function runSchemaGeneration(flags: { output: string; dryRun?: boolean }): Promise<void> {
    printHeader('Generate Schema');

    try {
      const timer = createTimer();
      printStep('Loading ObjectStackDefinitionSchema...');

      const { z } = await import('zod');
      const { ObjectStackDefinitionSchema } = await import('@objectstack/spec');

      printStep('Converting to JSON Schema...');
      const jsonSchema = z.toJSONSchema(ObjectStackDefinitionSchema, {
        target: 'draft-2020-12',
      });

      // Add metadata
      const schema = {
        ...jsonSchema,
        $id: 'https://schema.objectstack.io/objectstack.config.json',
        title: 'ObjectStack Configuration',
        description: 'JSON Schema for objectstack.config.ts — generated from ObjectStackDefinitionSchema',
      };

      const content = JSON.stringify(schema, null, 2) + '\n';

      if (flags.dryRun) {
        printInfo('Dry run — no files written');
        console.log('');
        console.log(content);
        return;
      }

      const outPath = path.resolve(process.cwd(), flags.output);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, content);
      printSuccess(`Generated JSON Schema at ${flags.output} (${timer.display()})`);
      console.log('');
      console.log(chalk.dim('  Usage: Reference in your IDE or editor for autocomplete'));
      console.log(chalk.dim(`  Path:  ${outPath}`));
      console.log('');

    } catch (error: any) {
      printError(error.message || String(error));
      process.exit(1);
    }
}

// ─── Main Generate Command ──────────────────────────────────────────

export default class Generate extends Command {
  static override description = 'Generate metadata files or TypeScript types';

  static override aliases = ['g'];

  static override args = {
    type: Args.string({ description: 'Metadata type to generate (object, view, action, flow, dashboard, app)', required: true }),
    name: Args.string({ description: 'Name for the metadata (use kebab-case)', required: false }),
  };

  static override flags = {
    dir: Flags.string({ char: 'd', description: 'Target directory (overrides default)' }),
    'dry-run': Flags.boolean({ description: 'Show what would be created without writing files' }),
    output: Flags.string({ char: 'o', description: 'Output file path' }),
    format: Flags.string({ description: 'Output format: sql or typescript', default: 'typescript' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Generate);

    // Route to sub-commands by type name
    switch (args.type) {
      case 'types':
        return runTypesGeneration(args.name, {
          output: flags.output ?? 'src/types/objectstack.d.ts',
          dryRun: flags['dry-run'],
        });
      case 'client':
        return runClientGeneration(args.name, {
          output: flags.output ?? 'src/client/objectstack-client.ts',
          dryRun: flags['dry-run'],
        });
      case 'migration':
        return runMigrationGeneration(args.name, {
          output: flags.output,
          format: flags.format ?? 'typescript',
          dryRun: flags['dry-run'],
        });
      case 'schema':
        return runSchemaGeneration({
          output: flags.output ?? 'objectstack.schema.json',
          dryRun: flags['dry-run'],
        });
    }

    // Metadata generation
    if (!args.name) {
      printError('Missing required argument: <name>');
      console.log(chalk.dim('  Usage: objectstack generate <type> <name>'));
      process.exit(1);
    }

    await runMetadataGeneration(args.type, args.name, {
      dir: flags.dir,
      dryRun: flags['dry-run'],
    });
  }
}
