import { z } from 'zod';
import { getMetadataTypeSchema } from './src/kernel/metadata-type-schemas.js';
import { DEFAULT_METADATA_TYPE_REGISTRY } from './src/kernel/metadata-plugin.zod.js';

const SIX = ['seed', 'mapping', 'api', 'doc', 'book', 'capability'];

function collectEnums(node: any, out: Set<string>, seen = new Set<any>()): void {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node.enum)) for (const v of node.enum) if (typeof v === 'string') out.add(v);
  if (typeof node.const === 'string') out.add(node.const);
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') collectEnums(v, out, seen);
  }
}

for (const t of SIX) {
  const schema = getMetadataTypeSchema(t);
  const entry = (DEFAULT_METADATA_TYPE_REGISTRY as any[]).find((e) => e.type === t);
  const prose = `${entry.label} ${entry.description}`;
  let values = new Set<string>();
  let err = '';
  try {
    const js = z.toJSONSchema(schema as any, { io: 'input', unrepresentable: 'any', cycles: 'ref' } as any);
    collectEnums(js, values);
  } catch (e: any) { err = e?.message ?? String(e); }
  const words = (prose.match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => w.toLowerCase());
  const hits = [...values].filter((v) => words.includes(v.toLowerCase()));
  console.log(`--- ${t}: schema=${schema ? 'yes' : 'NO'} enumValues=${values.size} err=${err.slice(0,80)}`);
  console.log(`    values: ${[...values].sort().join(', ').slice(0, 400)}`);
  console.log(`    PROSE HITS: ${JSON.stringify(hits)}`);
}
