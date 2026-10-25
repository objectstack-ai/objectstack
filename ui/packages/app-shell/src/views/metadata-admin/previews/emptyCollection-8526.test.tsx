// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The empty-COLLECTION sentences under `metadata-admin/previews/` render the
 * shared `EmptyDescription` — used alone, outside any `Empty` container — in
 * place of a hand-rolled muted `div` (objectui#8526). Two of those files used
 * to declare a file-local component literally named `Empty`, which shadowed
 * the shared family in the one place a maintainer would reach for it.
 *
 * What each pin proves, per site:
 *
 *   1. the empty branch renders the family's block-level text slot
 *      (`data-slot="empty-description"`) carrying the site's own sentence, and
 *      not `EmptyValue` (a field-VALUE placeholder whose `aria-label` says
 *      "No value" — false about a collection);
 *   2. the populated branch renders its rows and NO `empty-description` at
 *      all — the assertion that refuses the caricature "EmptyDescription
 *      rendered unconditionally, populated collections included".
 *
 * ⚠️ Navigation vs. assertion. Every harness reaches the CONTAINER that owns
 * a site — by a title that container renders (a `Section` heading, a rail
 * label, a panel header) — never anything the empty state renders, and never
 * a child position. A pin that navigated by `data-slot="empty-description"`
 * would die on any caricature that erases the description and read as a
 * strong refusal while measuring nothing (objectui#8504, objectui#8520); a
 * pin that navigated by `children[1]` died the same way when the caricature
 * was first run against this file — the inserted sibling shifted the rows one
 * slot over, and eight populated cases failed on their marker lookup before
 * the refusing assertion ran. Assertions are descendant queries on the
 * container: the empty state can never BE the container, because the
 * container is what holds the title. The harness-kill leg — rename a title
 * the harness navigates by — fails with "Unable to find an element",
 * textually distinct from the assertion failures the other legs produce.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';

// `ScreenPreview` reads both providers at its top level (`useAdapter()` /
// `useMetadata()`), exactly as `ScreenPreview.test.tsx` mocks them.
vi.mock('../../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ fake: 'adapter' }),
}));
vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ objects: [] }),
}));
// `DatasourcePreview` mounts the live external panel next to the rail; stubbed
// the same way `DatasourcePreview.test.tsx` stubs it.
vi.mock('../external/ExternalDatasourcePanel', () => ({
  ExternalDatasourcePanel: () => <div data-testid="mock-external-panel" />,
}));

import { AgentPreview } from './AgentPreview';
import { ToolPreview } from './ToolPreview';
import { SkillPreview } from './SkillPreview';
import { DatasourcePreview } from './DatasourcePreview';
import { ActionPreview } from './ActionPreview';
import { EmailTemplatePreview } from './EmailTemplatePreview';
import { FlowPreview } from './FlowPreview';
import { FlowRunsPanel } from './FlowRunsPanel';
import { FlowSimulatorPanel } from './FlowSimulatorPanel';
import { JobPreview } from './JobPreview';
import { TranslationPreview } from './TranslationPreview';
import { ScreenPreview } from './ScreenPreview';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ED = '[data-slot="empty-description"]';
const EV = '[data-slot="empty-value"]';

/**
 * The `Section` / `RailBlock` / rail-header block that owns a site, reached by
 * the block's TITLE. Every such block in this directory renders
 * `<div><div.header>…{title}…</div>{children}</div>`: the title is either the
 * header's own text (a `div`) or a `span` inside it. The block is returned,
 * not a child slot — see the docblock above for why.
 */
function blockByTitle(title: string | RegExp, root: HTMLElement = document.body): HTMLElement {
  const titleEl = within(root).getByText(title);
  const header = titleEl.tagName === 'SPAN' ? titleEl.parentElement! : titleEl;
  const block = header.parentElement as HTMLElement | null;
  expect(block, `the block titled "${String(title)}"`).toBeTruthy();
  return block!;
}

/** The empty branch: the family's text slot, with this site's sentence, and no EmptyValue. */
function expectEmptyState(block: HTMLElement, sentence: string) {
  const slot = block.querySelector(ED);
  expect(slot, 'the shared EmptyDescription slot').toBeTruthy();
  expect((slot!.textContent ?? '').trim()).toBe(sentence);
  expect(block.querySelector(EV)).toBeNull();
}

/** The populated branch: no empty-description anywhere under this block — the caricature refuser. */
function expectPopulated(block: HTMLElement, sentence: string) {
  expect(block.querySelector(ED)).toBeNull();
  // queryAllByText, not queryByText: the latter throws on MULTIPLE matches.
  expect(within(block).queryAllByText(sentence)).toHaveLength(0);
}

// ───────────────────────────── AgentPreview ─────────────────────────────

const AGENT = {
  name: 'sales_copilot',
  label: 'Sales Copilot',
  model: { provider: 'openai', model: 'gpt-4o' },
  instructions: 'Be kind.',
  skills: ['summarize_account'],
  planning: { maxIterations: 8 },
};

function renderAgent(draft: Record<string, unknown>) {
  return render(<AgentPreview type="agent" name="sales_copilot" draft={draft} />);
}

describe('AgentPreview — the three hand-rolled empties and the local `Empty` they went through', () => {
  const NO_PROMPT = 'No system prompt set yet.';
  const NO_SKILLS = 'No skills attached — this agent can reach no tools.';
  const DEFAULTS = 'Defaults in use.';

  /** The side rail has no heading of its own: reached as the grid column next to the one holding "Instructions". */
  function rail(): HTMLElement {
    const instructions = blockByTitle('Instructions');
    const grid = instructions.closest('.grid') as HTMLElement | null;
    expect(grid, 'the preview grid').toBeTruthy();
    return grid!.children[1] as HTMLElement;
  }

  it('Instructions: an empty prompt is the shared empty-description slot', () => {
    renderAgent({ ...AGENT, instructions: '' });
    expectEmptyState(blockByTitle('Instructions'), NO_PROMPT);
  });

  it('Instructions: a set prompt renders the pre and no empty-description', () => {
    renderAgent(AGENT);
    const body = blockByTitle('Instructions');
    expect(within(body).getByText('Be kind.')).toBeTruthy();
    expectPopulated(body, NO_PROMPT);
  });

  it('Skills: an empty chip list is the shared empty-description slot', () => {
    renderAgent({ ...AGENT, skills: [] });
    expectEmptyState(blockByTitle('Skills'), NO_SKILLS);
  });

  it('Skills: an attached skill renders its chip and no empty-description', () => {
    renderAgent(AGENT);
    const body = blockByTitle('Skills');
    expect(within(body).getByText('summarize_account')).toBeTruthy();
    expectPopulated(body, NO_SKILLS);
  });

  it('side rail: no planning / memory / guardrails / permissions is the shared empty-description slot', () => {
    renderAgent({ ...AGENT, planning: undefined });
    expectEmptyState(rail(), DEFAULTS);
  });

  it('side rail: a planning block renders its rows and no empty-description', () => {
    renderAgent(AGENT);
    const body = rail();
    expect(within(body).getByText('Planning')).toBeTruthy();
    expect(within(body).getByText('maxIterations')).toBeTruthy();
    expectPopulated(body, DEFAULTS);
  });

  it('a fully populated agent renders no empty-description anywhere', () => {
    const { container } = renderAgent(AGENT);
    expect(container.querySelectorAll(ED)).toHaveLength(0);
  });
});

// ───────────────────────────── ToolPreview ─────────────────────────────

describe('ToolPreview — the empty parameter set and the local `Empty` it went through', () => {
  const SENTENCE = 'This tool takes no input parameters.';
  const TOOL = { name: 'ping', description: 'Pings.', parameters: { type: 'object', properties: {} } };

  it('no parameters is the shared empty-description slot', () => {
    render(<ToolPreview type="tool" name="ping" draft={TOOL} />);
    expectEmptyState(blockByTitle('Input Parameters'), SENTENCE);
  });

  it('a declared parameter renders the table and no empty-description', () => {
    render(
      <ToolPreview
        type="tool"
        name="ping"
        draft={{ ...TOOL, parameters: { type: 'object', properties: { host: { type: 'string' } }, required: ['host'] } }}
      />,
    );
    const body = blockByTitle('Input Parameters');
    expect(within(body).getByText('host')).toBeTruthy();
    expectPopulated(body, SENTENCE);
  });
});

// ───────────────────────────── SkillPreview ─────────────────────────────

describe('SkillPreview — the empty tool whitelist', () => {
  const SENTENCE = 'No tools whitelisted.';
  const SKILL = { name: 'draft_email', instructions: 'Draft it.', tools: [] as string[] };

  it('no tools is the shared empty-description slot', () => {
    render(<SkillPreview type="skill" name="draft_email" draft={SKILL} />);
    expectEmptyState(blockByTitle('Tools (0)'), SENTENCE);
  });

  it('a whitelisted tool renders its chip and no empty-description', () => {
    render(<SkillPreview type="skill" name="draft_email" draft={{ ...SKILL, tools: ['send_email'] }} />);
    const body = blockByTitle('Tools (1)');
    expect(within(body).getByText('send_email')).toBeTruthy();
    expectPopulated(body, SENTENCE);
  });
});

// ───────────────────────────── DatasourcePreview ─────────────────────────────

describe('DatasourcePreview — the empty connection config', () => {
  const SENTENCE = 'No config keys set.';
  const DS = { name: 'warehouse', driver: 'postgres', config: {} };

  it('no config keys is the shared empty-description slot', () => {
    render(<DatasourcePreview type="datasource" name="warehouse" draft={DS} />);
    expectEmptyState(blockByTitle('Connection'), SENTENCE);
  });

  it('a config key renders the table and no empty-description', () => {
    render(<DatasourcePreview type="datasource" name="warehouse" draft={{ ...DS, config: { host: 'db.local' } }} />);
    const body = blockByTitle('Connection');
    expect(within(body).getByText('host')).toBeTruthy();
    expectPopulated(body, SENTENCE);
  });
});

// ───────────────────────────── ActionPreview ─────────────────────────────

describe('ActionPreview — a result dialog with no fields', () => {
  const SENTENCE = 'Renders full JSON response.';
  const ACTION = { name: 'rotate_secret', label: 'Rotate secret', resultDialog: { title: 'Rotated', fields: [] } };

  it('no result fields is the shared empty-description slot', () => {
    render(<ActionPreview type="action" name="rotate_secret" draft={ACTION} />);
    expectEmptyState(blockByTitle('Result Dialog'), SENTENCE);
  });

  it('a result field renders its row and no empty-description', () => {
    render(
      <ActionPreview
        type="action"
        name="rotate_secret"
        draft={{ ...ACTION, resultDialog: { title: 'Rotated', fields: [{ path: 'secret', label: 'New secret' }] } }}
      />,
    );
    const body = blockByTitle('Result Dialog');
    expect(within(body).getByText('New secret')).toBeTruthy();
    expectPopulated(body, SENTENCE);
  });
});

// ───────────────────────────── EmailTemplatePreview ─────────────────────────────

describe('EmailTemplatePreview — a template with no placeholders', () => {
  // The sentence carries a <code> child, so it is matched on the slot's text.
  const SENTENCE = 'No {{var}} placeholders found.';

  it('no placeholders is the shared empty-description slot', () => {
    render(<EmailTemplatePreview type="email_template" name="welcome" draft={{ subject: 'Welcome', bodyText: 'Hello there.' }} />);
    expectEmptyState(blockByTitle('Variables'), SENTENCE);
  });

  it('a detected placeholder renders its input and no empty-description', () => {
    render(<EmailTemplatePreview type="email_template" name="welcome" draft={{ subject: 'Welcome {{name}}', bodyText: 'Hello there.' }} />);
    const body = blockByTitle('Variables');
    expect(within(body).getByText('name')).toBeTruthy();
    expectPopulated(body, SENTENCE);
  });
});

// ───────────────────────────── FlowPreview ─────────────────────────────

describe('FlowPreview — the variables rail with no declared variables', () => {
  const SENTENCE = 'No variables declared.';
  const FLOW = {
    name: 'ping_flow',
    nodes: [
      { id: 's', type: 'start' },
      { id: 'e', type: 'end' },
    ],
    edges: [{ source: 's', target: 'e' }],
    variables: [] as Array<Record<string, unknown>>,
  };

  /** The canvas palette fetches the action catalogue; a 404 is its normal offline answer. */
  function stubCatalogue() {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
  }

  /** The rail block whose header is a `div` reading "Variables"; the toggle button reads the same word. */
  function railBlock(): HTMLElement {
    fireEvent.click(screen.getByTitle('Show variables panel'));
    const header = screen.getAllByText('Variables').find((el) => el.tagName === 'DIV');
    expect(header, 'the variables rail header').toBeTruthy();
    return header!.parentElement as HTMLElement;
  }

  it('no variables is the shared empty-description slot', () => {
    stubCatalogue();
    render(<FlowPreview type="flow" name="ping_flow" draft={FLOW} />);
    expectEmptyState(railBlock(), SENTENCE);
  });

  it('a declared variable renders its row and no empty-description', () => {
    stubCatalogue();
    render(<FlowPreview type="flow" name="ping_flow" draft={{ ...FLOW, variables: [{ name: 'amount', type: 'number' }] }} />);
    const body = railBlock();
    expect(within(body).getByText('amount')).toBeTruthy();
    expectPopulated(body, SENTENCE);
  });
});

// ───────────────────────────── FlowRunsPanel ─────────────────────────────

describe('FlowRunsPanel — no runs, and a run with no step log', () => {
  const NO_RUNS = 'No runs yet.';
  const NO_STEPS = 'No step log recorded.';
  const RUN = {
    id: 'run_8526',
    status: 'completed',
    startedAt: '2026-09-08T10:00:00.000Z',
    durationMs: 12,
    trigger: { type: 'manual' },
    steps: [] as Array<Record<string, unknown>>,
  };

  function stubRuns(runs: unknown[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true, data: { runs } }), { status: 200 })),
    );
  }

  it('an empty run list is the shared empty-description slot', async () => {
    stubRuns([]);
    render(<FlowRunsPanel flowName="ping_flow" />);
    await screen.findByText(NO_RUNS);
    expectEmptyState(blockByTitle('Runs'), NO_RUNS);
  });

  it('a listed run renders its row and no empty-description at the list level', async () => {
    stubRuns([RUN]);
    render(<FlowRunsPanel flowName="ping_flow" />);
    await screen.findByRole('button', { expanded: false });
    expectPopulated(blockByTitle('Runs'), NO_RUNS);
  });

  /** The expanded run body, reached by the run-id line it opens with. */
  async function expandedRunBody(): Promise<HTMLElement> {
    fireEvent.click(await screen.findByRole('button', { expanded: false }));
    const idLine = await screen.findByText(/^run run_8526/);
    return idLine.parentElement as HTMLElement;
  }

  it('a run with no step log is the shared empty-description slot', async () => {
    stubRuns([RUN]);
    render(<FlowRunsPanel flowName="ping_flow" />);
    expectEmptyState(await expandedRunBody(), NO_STEPS);
  });

  it('a run with steps renders them and no empty-description', async () => {
    // A node id distinct from its type label: `start`/`start` renders the same word twice.
    stubRuns([{ ...RUN, steps: [{ nodeId: 'fetch_orders', nodeType: 'http', status: 'success' }] }]);
    render(<FlowRunsPanel flowName="ping_flow" />);
    const body = await expandedRunBody();
    expect(within(body).getByText('fetch_orders')).toBeTruthy();
    expectPopulated(body, NO_STEPS);
  });
});

// ───────────────────────────── FlowSimulatorPanel ─────────────────────────────

describe('FlowSimulatorPanel — no scratch variables, and a run that set none', () => {
  const SCRATCH_HINT = 'Override or inject any variable (wins over inputs and mocks at start).';
  const NO_VARS = 'No variables set.';
  const FLOW = {
    nodes: [
      { id: 's', type: 'start' },
      { id: 'e', type: 'end' },
    ],
    edges: [{ source: 's', target: 'e' }],
  };

  /** The variable-watch section, whose header is a `div` reading "Variables". */
  function watchBlock(): HTMLElement {
    const header = screen.getAllByText('Variables').find((el) => el.tagName === 'DIV');
    expect(header, 'the variable-watch header').toBeTruthy();
    return header!.parentElement as HTMLElement;
  }

  it('no scratch rows is the shared empty-description slot', () => {
    render(<FlowSimulatorPanel nodes={FLOW.nodes} edges={FLOW.edges} variables={[]} />);
    expectEmptyState(blockByTitle('Set variables'), SCRATCH_HINT);
  });

  it('an added scratch row renders its inputs and no empty-description', () => {
    render(<FlowSimulatorPanel nodes={FLOW.nodes} edges={FLOW.edges} variables={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    const body = blockByTitle('Set variables');
    expect(within(body).getAllByRole('textbox').length).toBeGreaterThan(0);
    expectPopulated(body, SCRATCH_HINT);
  });

  it('a run that set no variables is the shared empty-description slot', () => {
    render(<FlowSimulatorPanel nodes={FLOW.nodes} edges={FLOW.edges} variables={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /^run$/i }));
    expectEmptyState(watchBlock(), NO_VARS);
  });

  it('a run seeded from a declared input renders the variable and no empty-description', () => {
    render(
      <FlowSimulatorPanel
        nodes={FLOW.nodes}
        edges={FLOW.edges}
        variables={[{ name: 'amount', type: 'number', isInput: true, defaultValue: 5 }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^run$/i }));
    const body = watchBlock();
    expect(within(body).getByText('amount')).toBeTruthy();
    expectPopulated(body, NO_VARS);
  });
});

// ───────────────────────────── JobPreview ─────────────────────────────

describe('JobPreview — a job with no schedule keys', () => {
  const SENTENCE = 'No schedule set — runs only when triggered manually.';
  const JOB = { name: 'nightly_cleanup', handler: 'jobs.cleanup' };

  it('no schedule is the shared empty-description slot', () => {
    render(<JobPreview type="job" name="nightly_cleanup" draft={JOB} />);
    expectEmptyState(blockByTitle('Schedule'), SENTENCE);
  });

  it('a cron schedule renders its line and no empty-description', () => {
    render(<JobPreview type="job" name="nightly_cleanup" draft={{ ...JOB, schedule: { type: 'cron', expression: '0 0 * * *' } }} />);
    const body = blockByTitle('Schedule');
    expect(within(body).getByText('0 0 * * *')).toBeTruthy();
    expectPopulated(body, SENTENCE);
  });
});

// ───────────────────────────── TranslationPreview ─────────────────────────────

describe('TranslationPreview — a category with no keys', () => {
  const SENTENCE = 'empty';
  const BUNDLE = { locale: 'en', data: { messages: { hello: 'Hello' }, objects: {} } };

  /** The category card, reached by its label. */
  function objectsCard(): HTMLElement {
    const label = screen.getAllByText('Objects').find((el) => el.closest('.rounded.border'));
    expect(label, 'the Objects category card label').toBeTruthy();
    return label!.closest('.rounded.border') as HTMLElement;
  }

  it('an empty category is the shared empty-description slot', () => {
    render(<TranslationPreview type="translation" name="en" draft={BUNDLE} />);
    expectEmptyState(objectsCard(), SENTENCE);
  });

  it('a populated category renders its sample and no empty-description', () => {
    render(
      <TranslationPreview
        type="translation"
        name="en"
        draft={{ ...BUNDLE, data: { ...BUNDLE.data, objects: { account: { label: 'Account' } } } }}
      />,
    );
    const body = objectsCard();
    expect(within(body).getByText('account')).toBeTruthy();
    expectPopulated(body, SENTENCE);
  });
});

// ───────────────────────────── ScreenPreview ─────────────────────────────

describe('ScreenPreview — a screen with nothing configured', () => {
  const SENTENCE = 'Add a title, description, fields, or an object form to preview this screen.';

  it('an unconfigured screen is the shared empty-description slot, at the body scale', () => {
    render(<ScreenPreview node={{ id: 's1', config: {} }} />);
    const body = blockByTitle('Preview');
    expectEmptyState(body, SENTENCE);
    // The deliberate outlier: this sentence stands in for the screen body,
    // whose description renders at text-sm — not for a text-xs rail row.
    expect(body.querySelector(ED)!.className).toContain('text-sm');
  });

  it('a titled screen renders its heading and no empty-description', () => {
    render(<ScreenPreview node={{ id: 's1', config: { title: 'Step one' } }} />);
    const body = blockByTitle('Preview');
    expect(within(body).getByText('Step one')).toBeTruthy();
    expectPopulated(body, SENTENCE);
  });
});
