// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Generates the react-tier component contract from packages/spec/src/ui/
// react-blocks.ts: the `data` (config) props are read from each block's SPEC
// zod schema via z.toJSONSchema (single source — no re-authoring); the
// binding/controlled/callback props come from the hand-authored interaction
// overlay. Emits:
//   - skills/objectstack-ui/contracts/react-blocks.contract.json  (machine)
//   - skills/objectstack-ui/references/react-blocks.md            (AI-facing)
//
// Run:
//   pnpm --filter @objectstack/spec gen:react-blocks            # write
//   pnpm --filter @objectstack/spec check:react-blocks          # verify in sync (CI)

process.env.OS_EAGER_SCHEMAS = '1';

import path from 'path';
import { z } from 'zod';
import { REACT_BLOCKS, type ReactInteractionProp } from '../src/ui/react-blocks';
import { createSink } from './lib/generated-output';

const REPO = path.resolve(__dirname, '../../..');
const OUT_JSON = path.join(REPO, 'skills/objectstack-ui/contracts/react-blocks.contract.json');
const OUT_MD = path.join(REPO, 'skills/objectstack-ui/references/react-blocks.md');

const CHECK = process.argv.includes('--check');
const { emit, flush } = createSink({ check: CHECK, repoRoot: REPO });

// ---- JSON-schema prop extraction -----------------------------------------
function resolveRoot(js: any): any {
  // zod v4 may wrap the root in { $ref: '#/$defs/X', $defs: { X: {...} } }.
  if (js && js.$ref && js.$defs) {
    const key = String(js.$ref).split('/').pop()!;
    return js.$defs[key] ?? js;
  }
  return js;
}

function renderType(node: any): string {
  if (!node || typeof node !== 'object') return 'any';
  if (Array.isArray(node.enum)) return node.enum.map((v: any) => (typeof v === 'string' ? `'${v}'` : String(v))).join(' | ');
  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
    const alts = (node.anyOf ?? node.oneOf).map(renderType).filter((t: string) => t && t !== 'any');
    return [...new Set(alts)].join(' | ') || 'any';
  }
  if (node.type === 'array') return `${renderType(node.items)}[]`;
  if (node.$ref) return String(node.$ref).split('/').pop() ?? 'object';
  if (node.type) return Array.isArray(node.type) ? node.type.join(' | ') : String(node.type);
  if (node.properties) return 'object';
  return 'any';
}

const clip = (s: unknown, n = 160): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

interface Prop {
  name: string;
  type: string;
  kind: string;
  required: boolean;
  description: string;
  /** #11284 deprecate-first: canonical replacement + authoring note, passed through from the overlay. */
  deprecated?: { replacedBy: string; note: string };
}

function dataProps(schema: any, allow?: string[]): Prop[] {
  let js: any;
  try {
    js = resolveRoot(z.toJSONSchema(schema, { unrepresentable: 'any' } as any));
  } catch {
    return [];
  }
  const props = js?.properties ?? {};
  const required: string[] = Array.isArray(js?.required) ? js.required : [];
  // Envelope/plumbing props that are never part of an author contract. `type`
  // is the awkward one: for most blocks it IS the SDUI component discriminator,
  // but `ChartConfig.type` is the chart family and a real author prop — so an
  // explicit `dataProps` allow-list wins over the skip (#3729).
  const SKIP = new Set(['aria', 'id', 'className', 'style']);
  const allowed = new Set(allow ?? []);
  let entries = Object.entries(props).filter(
    ([name]) => !(SKIP.has(name) || (name === 'type' && !allowed.has('type'))),
  );
  if (allow && allow.length) {
    const order = new Map(allow.map((n, i) => [n, i]));
    entries = entries.filter(([n]) => order.has(n)).sort((a, b) => order.get(a[0])! - order.get(b[0])!);
  }
  return entries
    .map(([name, node]: [string, any]) => ({
      name,
      type: renderType(node),
      kind: 'data',
      // z.toJSONSchema emits output-io semantics, where a `.default()`-carrying
      // prop is always present — so it lands in `required` even though an author
      // may omit it. A prop with a default is optional to WRITE, which is what
      // this contract documents; only default-less required props stay required.
      required: required.includes(name) && node?.default === undefined,
      description: clip(node?.description),
    }));
}

function mergeProps(dataPs: Prop[], overlay: ReactInteractionProp[]): Prop[] {
  const out: Prop[] = overlay.map((o) => ({
    name: o.name,
    type: o.type,
    kind: o.kind,
    required: !!o.required,
    description: o.description,
    // #11284 deprecate-first: machine consumers see the canonical replacement;
    // the human-facing "[DEPRECATED → …]" marker rides the description text.
    ...(o.deprecated ? { deprecated: o.deprecated } : {}),
  }));
  const seen = new Set(out.map((p) => p.name));
  for (const d of dataPs) if (!seen.has(d.name)) out.push(d);
  return out;
}

// ---- build ----------------------------------------------------------------
const KIND_ORDER: Record<string, number> = { binding: 0, controlled: 1, callback: 2, data: 3 };
const blocks = REACT_BLOCKS.map((b) => {
  const props = mergeProps(b.schema ? dataProps(b.schema, b.dataProps) : [], b.interactions).sort(
    (a, z2) => (KIND_ORDER[a.kind] - KIND_ORDER[z2.kind]) || (Number(z2.required) - Number(a.required)),
  );
  return { tag: b.tag, schemaType: b.schemaType, summary: b.summary, specSchema: b.schema ? true : false, props };
});

const contract = {
  version: 2,
  adr: 'ADR-0081',
  source: "GENERATED from the REACT_BLOCKS definition in the '@objectstack/spec/ui' module — data props from the spec zod schemas, binding/controlled/callback from the React overlay.",
  note: "Props each component accepts in kind:'react' page source. Reference blocks by their PascalCase tag. kind: data=declarative config (from the spec schema) · binding=connects to data · controlled=React state · callback=React function. These blocks are for DATA. Live data: const adapter = useAdapter(); adapter.find/findOne/create/update. STYLING (ADR-0065) — a page's source is runtime metadata, so the console's build-time Tailwind NEVER scans it: utility classNAMES silently produce no CSS. Do NOT use Tailwind className in page source. (a) Layout/chrome: inline style={} with hsl(var(--token)) theme colors — e.g. color:'hsl(var(--foreground))', background:'hsl(var(--card))', border:'1px solid hsl(var(--border))', and px/flex for layout. (b) Overlays: render <ObjectForm formType='drawer'|'modal' open onOpenChange> (a pre-styled Sheet/Dialog) — never hand-roll a fixed inset-0 backdrop.",
  blocks,
};
emit(OUT_JSON, JSON.stringify(contract, null, 2) + '\n');

// markdown
const esc = (s: string) => String(s).replace(/\|/g, '\\|');
const L: string[] = [];
L.push('---');
L.push('title: React-tier component contract');
L.push("description: Props each injected component accepts in kind:'react' page source (ADR-0081). GENERATED from the REACT_BLOCKS definition in the '@objectstack/spec/ui' module — do not edit by hand.");
L.push('---');
L.push('');
L.push('{/* GENERATED by packages/spec/scripts/build-react-blocks-contract.ts — do not edit. */}');
L.push('');
L.push(`# React-tier component contract (${contract.adr})`);
L.push('');
L.push(contract.note);
L.push('');
L.push('**kind**: `data` = declarative config (from the spec schema — the authoritative source) · `binding` = connects the block to data · `controlled` = drive from React state · `callback` = a React function the block calls.');
L.push('');
for (const b of blocks) {
  L.push(`## \`<${b.tag}>\` — \`${b.schemaType}\`${b.specSchema ? '' : ' *(no spec schema — overlay only)*'}`);
  L.push('');
  L.push(b.summary);
  L.push('');
  L.push('| prop | type | kind | required | description |');
  L.push('|------|------|------|:--------:|-------------|');
  for (const p of b.props) {
    L.push(`| \`${p.name}\` | \`${esc(p.type)}\` | ${p.kind} | ${p.required ? '✓' : ''} | ${esc(p.description)} |`);
  }
  L.push('');
}
L.push('## Injected scope (closure variables, reference directly — not props)');
L.push('');
L.push('`React` · `useAdapter` · `data` · `variables` · `page`. Kanban/calendar/gantt/timeline/map of an object = `<ListView navigation={…} />` with the matching visualization, or `<Block type="object-kanban" …/>`.');
L.push('');
emit(OUT_MD, L.join('\n'));

console.log(`react-blocks contract: ${blocks.length} blocks → ${path.relative(REPO, OUT_JSON)} + ${path.relative(REPO, OUT_MD)}`);
for (const b of blocks) console.log(`   <${b.tag}> ${b.props.length} props`);

flush({
  surface: 'skills/objectstack-ui/ react-blocks contract',
  regenerate: '  pnpm --filter @objectstack/spec gen:react-blocks\n  git add skills/objectstack-ui',
  guard: () => {
    // Guard the two ways this generator can emit a plausible-but-empty contract
    // and have --check compare it against nothing meaningful.
    if (blocks.length === 0) return 'REACT_BLOCKS is empty — nothing to generate from packages/spec/src/ui/react-blocks.ts.';
    // `dataProps()` swallows a z.toJSONSchema failure and returns [], so schemas
    // that fail to load degrade to a contract carrying only the hand-authored
    // overlay props rather than crashing. Checking `props.length` would miss it
    // (the overlay is still there) — the data props are what vanish.
    const specBacked = blocks.filter((b) => b.specSchema);
    const withData = specBacked.filter((b) => b.props.some((p) => p.kind === 'data'));
    if (specBacked.length > 0 && withData.length === 0) {
      return (
        `All ${specBacked.length} spec-backed blocks resolved 0 data props — the spec schemas failed to load\n` +
        `  (z.toJSONSchema errors are swallowed in dataProps()), so this is the overlay alone, not a real contract.`
      );
    }
    return null;
  },
});
