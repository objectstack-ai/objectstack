import { Arrow, Box, Circle, Drawing, EdgeLabel, Eyebrow, Figure, PLATE_TEXT, Text, TYPE, wrap } from './primitives';

/*
 * Figure for "What it is not": three routes for enterprise knowledge. The
 * circle is the model; the question is where the knowledge sits. Every label
 * is the essay's or the talk deck's own wording.
 */

const TITLE = 'Three routes for enterprise knowledge';
const DESC =
  'Route one, train it in: the knowledge goes into the model’s weights. Change one rule, retrain; nothing to ' +
  'inspect, nothing to audit; change the model, lose it all. Route two, outside, as a manual: a knowledge graph or a ' +
  'semantic layer the model reads. The model reads a description; to act it needs a link to the business systems, ' +
  'and permissions are yet another system. The third route, outside, and it runs: the ontology and the runtime are ' +
  'one machine. The model reads and writes it, the system runs it, and agents act through it.';

const ROUTES = [
  {
    eyebrow: 'Route one',
    title: 'Train it in',
    text: 'Change one rule, retrain. Nothing to inspect, nothing to audit. Change the model, lose it all.',
  },
  {
    eyebrow: 'Route two',
    title: 'Outside, as a manual',
    text: 'The model can read it, but reads a description. Acting needs another system; permissions are yet another.',
  },
  {
    eyebrow: 'Third route',
    title: 'Outside, and it runs',
    text: 'Written precisely enough, the ontology is not a manual. The model reads and writes it, the system runs it, agents act through it.',
  },
] as const;

/** The panel's inner drawing is 264 x 200 in both layouts; `x`, `y` place it. */
const PANEL_W = 264;
const PANEL_H = 200;

function TrainedIn({ x, y }: { x: number; y: number }) {
  return (
    <Circle cx={x + PANEL_W / 2} cy={y + PANEL_H / 2} r={74} title="Model" titleSize={17} body={['knowledge in', 'the weights']} />
  );
}

function Manual({ x, y }: { x: number; y: number }) {
  const cx = x + 48;
  const cy = y + 84;
  const r = 40;
  const boxX = x + 128;
  const boxW = PANEL_W - 128 - 8;
  return (
    <g>
      <Circle cx={cx} cy={cy} r={r} title="Model" titleSize={15} />
      <Box x={boxX} y={y + 46} w={boxW} h={76} pad={10} title="Manual" titleSize={14} body={['knowledge graph', 'semantic layer']} bodySize={12} />
      <Arrow points={[[boxX - 2, cy], [cx + r + 2, cy]]} ink="accent" />
      <EdgeLabel x={(boxX + cx + r) / 2} y={cy - 13} ink="accent">
        read
      </EdgeLabel>
      <Box x={boxX} y={y + 140} w={boxW} h={44} pad={8} tone="dashed" title={['Business systems']} titleSize={11.5} align="middle" />
      <Arrow points={[[cx, cy + r + 2], [cx, y + 162], [boxX - 2, y + 162]]} dashed />
      <EdgeLabel x={x + 8} y={y + 184} anchor="start" weight={400}>
        to act, add a link
      </EdgeLabel>
    </g>
  );
}

function Runs({ x, y }: { x: number; y: number }) {
  const cx = x + 50;
  const cy = y + 92;
  const r = 40;
  const boxX = x + 132;
  const boxW = PANEL_W - 132 - 12;
  return (
    <g>
      <Circle cx={cx} cy={cy} r={r} tone="paper" title="Model" titleSize={15} />
      <Box x={boxX} y={y + 40} w={boxW} h={104} tone="accent" align="middle" title={['Ontology', '+', 'Runtime']} titleSize={15} />
      <Arrow points={[[cx + r + 2, cy], [boxX - 2, cy]]} ink="onInk" heads="both" />
      <EdgeLabel x={(cx + boxX) / 2 + 6} y={y + 22} ink="onInk">
        reads · writes
      </EdgeLabel>
      <Arrow points={[[boxX + boxW / 2, y + 166], [boxX + boxW / 2, y + 146]]} ink="onInk" />
      <Box x={boxX} y={y + 166} w={boxW} h={26} pad={6} tone="raised" align="middle" title={['Agents call it']} titleSize={12.5} radius={8} />
    </g>
  );
}

const DIAGRAMS = [TrainedIn, Manual, Runs];

function Route({ i, x, y, w, captionWidth }: { i: number; x: number; y: number; w: number; captionWidth: number }) {
  const route = ROUTES[i];
  const Diagram = DIAGRAMS[i];
  const panelY = y + 44;
  const lines = wrap(route.text, captionWidth, TYPE.small);
  return (
    <g>
      <Eyebrow x={x} y={y + 8}>
        {route.eyebrow}
      </Eyebrow>
      <Text x={x} y={y + 28} size={TYPE.title} weight={700} className={PLATE_TEXT.strong}>
        {route.title}
      </Text>
      <g>
        <rect
          x={x}
          y={panelY}
          width={w}
          height={PANEL_H}
          rx={14}
          strokeWidth={1}
          className={
            i === 2
              ? 'fill-neutral-900 stroke-neutral-900 dark:fill-indigo-950 dark:stroke-indigo-400'
              : 'fill-white stroke-neutral-300 dark:fill-neutral-800 dark:stroke-neutral-600'
          }
        />
      </g>
      <Diagram x={x + (w - PANEL_W) / 2} y={panelY} />
      {lines.map((line, k) => (
        <Text key={k} x={x} y={panelY + PANEL_H + 16 + k * 18} size={TYPE.small} className={PLATE_TEXT.muted}>
          {line}
        </Text>
      ))}
    </g>
  );
}

function Wide() {
  const gap = 24;
  return (
    <Drawing id="fig-three-routes-wide" width={840} height={44 + PANEL_H + 16 + 4 * 18} title={TITLE} desc={DESC}>
      {ROUTES.map((route, i) => (
        <Route key={route.title} i={i} x={i * (PANEL_W + gap)} y={0} w={PANEL_W} captionWidth={PANEL_W} />
      ))}
    </Drawing>
  );
}

function Narrow() {
  const step = 44 + PANEL_H + 16 + 3 * 18 + 20;
  return (
    <Drawing id="fig-three-routes-narrow" width={360} height={3 * step - 20} title={TITLE} desc={DESC}>
      {ROUTES.map((route, i) => (
        <Route key={route.title} i={i} x={0} y={i * step} w={360} captionWidth={372} />
      ))}
    </Drawing>
  );
}

export function ThreeRoutesFigure({ caption }: { caption: string }) {
  return <Figure caption={caption} wide={<Wide />} narrow={<Narrow />} />;
}
