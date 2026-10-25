/**
 * Side-by-side comparison: the same stats-card dashboard written in
 * traditional React + Shadcn versus the ObjectUI JSON equivalent.
 *
 * The section contrasts two authoring models side by side — keep both
 * snippets honest (no cheating by omitting imports, no padding the
 * React side with formatting).
 *
 * The JSON side must stay COPY-RUNNABLE, because "an AI agent can author this"
 * is the claim the panel makes (objectui#4786). Two ways it stopped being true
 * before, both measured through a real SchemaRenderer:
 *
 *  - `"type": "stats-card"` is registered by nothing in the repo, so every one
 *    of the four children painted the registry's OBJUI-001 "Unknown component
 *    type" panel. It is now `statistic`, which `@object-ui/components`
 *    registers and which reads `label` / `value` / `description` / `icon`.
 *  - the keys were wrapped in a `props` envelope. `SchemaRenderer` spreads
 *    `schema.props` as React props instead of merging it into the node, and the
 *    renderers read `schema.*` — so the envelope rendered an empty card and
 *    leaked into the DOM as `props="[object Object]"` (same defect class as the
 *    `cols` fix in objectui#4011 / PR #4785).
 *
 * Copy-runnability is the whole constraint on this snippet, and now the only
 * one: the panel renders no line counts and no percentage, so a correctness
 * fix here is free to change its length (objectui#8948 — the homepage stopped
 * leaning on counts, so there is no number left for an edit to move).
 */

const REACT_CODE = `import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  DollarSign, Users, CreditCard, Activity,
} from "lucide-react";

const stats = [
  { title: "Total Revenue", value: "$45,231.89",
    change: "+20.1% from last month", Icon: DollarSign },
  { title: "Subscriptions", value: "+2,350",
    change: "+180.1% from last month", Icon: Users },
  { title: "Sales", value: "+12,234",
    change: "+19% from last month", Icon: CreditCard },
  { title: "Active Now", value: "+573",
    change: "+201 since last hour", Icon: Activity },
];

export function StatsCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map(({ title, value, change, Icon }) => (
        <Card key={title}>
          <CardHeader
            className="flex flex-row items-center
              justify-between space-y-0 pb-2"
          >
            <CardTitle className="text-sm font-medium">
              {title}
            </CardTitle>
            <Icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{value}</div>
            <p className="text-xs text-muted-foreground">
              {change}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}`;

const OBJECTUI_CODE = `{
  "type": "grid",
  "columns": { "xs": 1, "md": 2, "lg": 4 }, "gap": 4,
  "children": [
    { "type": "statistic", "label": "Total Revenue",
      "value": "$45,231.89", "description": "+20.1% from last month",
      "icon": "dollar-sign" },
    { "type": "statistic", "label": "Subscriptions",
      "value": "+2,350", "description": "+180.1% from last month",
      "icon": "users" },
    { "type": "statistic", "label": "Sales",
      "value": "+12,234", "description": "+19% from last month",
      "icon": "credit-card" },
    { "type": "statistic", "label": "Active Now",
      "value": "+573", "description": "+201 since last hour",
      "icon": "activity" }
  ]
}`;

function CodePanel({
  label,
  badge,
  badgeTone,
  code,
}: {
  label: string;
  badge: string;
  badgeTone: 'muted' | 'primary';
  code: string;
}) {
  const lineNumbers = code.split('\n').map((_, i) => i + 1);
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-sm">
      <div className="flex items-center border-b border-fd-border bg-fd-muted/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fd-foreground">{label}</span>
          <span
            className={
              badgeTone === 'primary'
                ? 'rounded-full bg-fd-primary/15 px-2 py-0.5 text-[11px] font-medium text-fd-primary'
                : 'rounded-full bg-fd-muted px-2 py-0.5 text-[11px] font-medium text-fd-muted-foreground'
            }
          >
            {badge}
          </span>
        </div>
      </div>
      <div className="flex max-h-[460px] overflow-auto text-[12.5px] leading-[1.55]">
        <pre
          aria-hidden="true"
          className="select-none border-r border-fd-border bg-fd-muted/20 px-3 py-4 text-right font-mono text-fd-muted-foreground/70"
        >
          {lineNumbers.join('\n')}
        </pre>
        <pre className="flex-1 overflow-x-auto px-4 py-4 font-mono text-fd-foreground">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}

export function ReactVsObjectUI() {
  return (
    <section className="border-y border-fd-border bg-fd-background py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-4 inline-flex items-center rounded-full border border-fd-border bg-fd-muted/40 px-3 py-1 text-xs font-medium text-fd-muted-foreground">
            Side by side
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-fd-foreground sm:text-4xl">
            Same UI.{' '}
            <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-violet-400">
              Written as JSON.
            </span>
          </h2>
          <p className="mt-4 text-lg text-fd-muted-foreground">
            Here&apos;s a stats-card dashboard written two ways. Both render the
            same pixels &mdash; one is a React component, the other is plain JSON
            an AI agent can author, edit, or generate in a single tool call.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-2">
          <CodePanel
            label="React + Shadcn"
            badge="StatsCards.tsx"
            badgeTone="muted"
            code={REACT_CODE}
          />
          <CodePanel
            label="ObjectUI"
            badge="stats-cards.schema.json"
            badgeTone="primary"
            code={OBJECTUI_CODE}
          />
        </div>

        <div className="mx-auto mt-10 grid max-w-5xl grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-fd-border bg-fd-card p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
              What you maintain
            </div>
            <div className="mt-1 text-2xl font-bold text-fd-foreground">
              One JSON file
            </div>
            <p className="mt-1 text-sm text-fd-muted-foreground">
              No component code, no build step.
            </p>
          </div>
          <div className="rounded-xl border border-fd-border bg-fd-card p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
              Editable by AI agents
            </div>
            <div className="mt-1 text-2xl font-bold text-fd-foreground">
              One tool call
            </div>
            <p className="mt-1 text-sm text-fd-muted-foreground">
              JSON patches, no AST surgery or codegen pipelines.
            </p>
          </div>
          <div className="rounded-xl border border-fd-border bg-fd-card p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
              Pixel parity
            </div>
            <div className="mt-1 text-2xl font-bold text-fd-foreground">
              Same Shadcn
            </div>
            <p className="mt-1 text-sm text-fd-muted-foreground">
              Identical components &mdash; just authored declaratively.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
