// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { printHeader, printSuccess, printError, printInfo, printStep, createTimer, CLI_ALIAS } from '../utils/format.js';

// ─── Metadata Type Templates ────────────────────────────────────────

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
    generate: (name: string) => `import * as Automation from '@objectstack/spec/automation';

/**
 * ${toTitleCase(name)} Flow
 */
const ${toCamelCase(name)}Flow: Automation.Flow = {
  name: '${toSnakeCase(name)}_flow',
  label: '${toTitleCase(name)} Flow',
  type: 'autolaunched',
  status: 'draft',
  trigger: {
    type: 'record_change',
    object: '${toSnakeCase(name)}',
    events: ['after_insert', 'after_update'],
  },
  nodes: [
    {
      id: 'start',
      type: 'start',
      name: 'Start',
      next: 'end',
    },
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
};

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
      'There is no `os g skill` scaffolder yet. Write the file by hand:',
      '',
      '    src/skills/<name>.skill.ts',
      "    import { defineSkill } from '@objectstack/spec/ai';",
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
    const fileName = `${toSnakeCase(name)}.ts`;
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
        const exportLine = `export { default as ${toCamelCase(name)} } from './${toSnakeCase(name)}';`;
        
        if (!indexContent.includes(toCamelCase(name))) {
          fs.appendFileSync(indexPath, exportLine + '\n');
          printSuccess(`Updated ${dir}/index.ts with export`);
        }
      } else {
        // Create barrel index
        const exportLine = `export { default as ${toCamelCase(name)} } from './${toSnakeCase(name)}';\n`;
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
