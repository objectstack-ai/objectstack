import { TraceSamplingConfigSchema } from '../packages/spec/src/system/tracing.zod';
import { projectPublishedJsonSchema } from '../packages/spec/scripts/lib/refinement-projection';
import { collectDroppedRefinements } from '../packages/spec/scripts/lib/dropped-refinements';

for (const io of ['output', 'input'] as const) {
  try {
    const n = projectPublishedJsonSchema(TraceSamplingConfigSchema, { io }) as any;
    console.log(io, 'OK ->', JSON.stringify(n.properties.composite.items.properties.condition.allOf));
  } catch (e) { console.log(io, 'THREW', (e as Error).message.slice(0, 60)); }
}
const parses = (condition: unknown): boolean =>
  TraceSamplingConfigSchema.safeParse({ type: 'composite', composite: [{ strategy: 'always_on', condition }] }).success;
for (const doc of [{}, { amount: { $gt: 10 } }, { dialect: 'cel' }, { dialect: null }, { dialect: 'cel', source: 'record.amount > 10' }, 'record.amount > 10']) {
  console.log(JSON.stringify(doc), 'runtime=', parses(doc));
}
const c = collectDroppedRefinements('system/TraceSamplingConfig', TraceSamplingConfigSchema as never);
console.log('dropped', JSON.stringify(c.dropped.map((s) => s.path)));
console.log('projected', c.projected.map((s) => s.path + ' ' + JSON.stringify(s.declaredPatterns)).join(' | '));
console.log('undecidable', JSON.stringify(c.undecidable.map((s) => s.path)));
