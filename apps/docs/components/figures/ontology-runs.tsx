import { Arrow, Box, Drawing, EdgeLabel, Figure, TYPE } from './primitives';

/*
 * Figure for "Why code recedes": the architecture in which the ontology is
 * run directly. Every label is the essay's or the talk deck's own wording.
 */

const TITLE = 'The ontology runs';
const DESC =
  'A large model writes the ontology from a sentence of business language, and what is written wrong does not ship. ' +
  'People define it, approve it, and verify it in the UI. The ontology is what the enterprise is: what we have, how it ' +
  'relates, what can be done, who may do it, and what happens when. The runtime runs the definition directly, and every ' +
  'call is permission-checked and audited. An agent, any agent from any vendor, calls the runtime. The database, the ' +
  'API, the UI and the tools agents call are all derived from it.';

const MODEL = { title: 'Large model', body: ['Writes it from a sentence', 'of business language.', 'Wrong, it does not ship.'] };
const PEOPLE = { title: 'People', body: ['Define it, approve it,', 'verify it in the UI.'] };
const ONTOLOGY = {
  title: 'Ontology',
  body: ['what the enterprise is:', 'what we have · how it relates', 'what can be done · who may do it', 'what happens when'],
};
const RUNTIME = { title: 'Runtime', body: ['Runs the definition directly; every call', 'is permission-checked and audited'] };
const AGENT = { title: 'Agent', body: 'Any agent, any vendor' };
const DERIVED = ['Database', 'API', 'UI', 'Tools agents call'] as const;

function Wide() {
  const sideW = 190;
  const centreX = 276;
  const centreW = 288;
  const rightX = 650;
  const centreMid = centreX + centreW / 2; // 420
  const row1H = 120;
  const row2Y = 164;
  const row2H = 76;
  const busY = row2Y + row2H + 28;
  const childY = busY + 20;
  const childH = 48;
  const childW = 180;
  const childGap = 20;
  const childX0 = (840 - (4 * childW + 3 * childGap)) / 2;
  const childMid = (i: number) => childX0 + i * (childW + childGap) + childW / 2;
  const arrowY = row1H / 2;
  const row2Mid = row2Y + row2H / 2;
  return (
    <Drawing id="fig-ontology-runs-wide" width={840} height={childY + childH} title={TITLE} desc={DESC}>
      <Box x={0} y={0} w={sideW} h={row1H} title={MODEL.title} body={MODEL.body} bodySize={TYPE.small} />
      <Box x={centreX} y={0} w={centreW} h={row1H} tone="ink" title={ONTOLOGY.title} body={ONTOLOGY.body} bodySize={TYPE.small} />
      <Box x={rightX} y={0} w={sideW} h={row1H} tone="warm" title={PEOPLE.title} body={PEOPLE.body} bodySize={TYPE.small} />
      <Arrow points={[[sideW + 2, arrowY], [centreX - 2, arrowY]]} ink="accent" />
      <EdgeLabel x={(sideW + centreX) / 2} y={arrowY - 13} ink="accent">
        writes it
      </EdgeLabel>
      <Arrow points={[[rightX - 2, arrowY], [centreX + centreW + 2, arrowY]]} ink="warm" />
      <EdgeLabel x={(rightX + centreX + centreW) / 2} y={arrowY - 13} ink="warm">
        defines it
      </EdgeLabel>
      <Arrow points={[[centreMid, row1H + 2], [centreMid, row2Y - 2]]} ink="accent" width={2.5} />
      <EdgeLabel x={centreMid + 10} y={(row1H + row2Y) / 2} ink="accent" anchor="start">
        runs directly
      </EdgeLabel>
      <Box x={centreX} y={row2Y} w={centreW} h={row2H} tone="accent" title={RUNTIME.title} body={RUNTIME.body} bodySize={TYPE.small} />
      <Box x={rightX} y={row2Y} w={sideW} h={row2H} title={AGENT.title} body={AGENT.body} bodySize={TYPE.small} />
      <Arrow points={[[rightX - 2, row2Mid], [centreX + centreW + 2, row2Mid]]} />
      <EdgeLabel x={(rightX + centreX + centreW) / 2} y={row2Mid - 13}>
        calls it
      </EdgeLabel>
      <Arrow points={[[centreMid, row2Y + row2H + 1], [centreMid, busY]]} heads="none" />
      <EdgeLabel x={centreMid + 10} y={row2Y + row2H + 14} anchor="start" weight={400}>
        derived from it
      </EdgeLabel>
      <Arrow points={[[childMid(0), busY], [childMid(3), busY]]} heads="none" />
      {DERIVED.map((label, i) => (
        <g key={label}>
          <Arrow points={[[childMid(i), busY], [childMid(i), childY - 1]]} />
          <Box
            x={childX0 + i * (childW + childGap)}
            y={childY}
            w={childW}
            h={childH}
            title={[label]}
            titleSize={14}
            align="middle"
          />
        </g>
      ))}
    </Drawing>
  );
}

function Narrow() {
  const sideW = 172;
  const rightX = 360 - sideW;
  const row1H = 116;
  const ontY = row1H + 44;
  const ontH = 112;
  const rtY = ontY + ontH + 40;
  const rtH = 76;
  const rtEnd = rtY + rtH;
  const agentX = 196;
  const agentY = rtEnd + 36;
  const agentH = 70;
  const busY = agentY + agentH + 16;
  const childY = busY + 18;
  const childW = 84;
  const childGap = 8;
  const childH = 52;
  const childMid = (i: number) => i * (childW + childGap) + childW / 2;
  const trunkX = childMid(1);
  const agentMid = agentX + (360 - agentX) / 2;
  return (
    <Drawing id="fig-ontology-runs-narrow" width={360} height={childY + childH} title={TITLE} desc={DESC}>
      <Box
        x={0}
        y={0}
        w={sideW}
        h={row1H}
        pad={12}
        title={MODEL.title}
        body={['Writes it from a', 'sentence of business', 'language. Wrong, it', 'does not ship.']}
        bodySize={12.5}
      />
      <Box x={rightX} y={0} w={sideW} h={row1H} pad={12} tone="warm" title={PEOPLE.title} body={['Define it,', 'approve it,', 'verify it in the UI.']} bodySize={12.5} />
      <Arrow points={[[sideW / 2, row1H + 2], [sideW / 2, ontY - 2]]} ink="accent" />
      <EdgeLabel x={sideW / 2 + 8} y={(row1H + ontY) / 2} ink="accent" anchor="start">
        writes it
      </EdgeLabel>
      <Arrow points={[[rightX + sideW / 2, row1H + 2], [rightX + sideW / 2, ontY - 2]]} ink="warm" />
      <EdgeLabel x={rightX + sideW / 2 + 8} y={(row1H + ontY) / 2} ink="warm" anchor="start">
        defines it
      </EdgeLabel>
      <Box x={0} y={ontY} w={360} h={ontH} tone="ink" title={ONTOLOGY.title} body={ONTOLOGY.body} bodySize={TYPE.small} />
      <Arrow points={[[180, ontY + ontH + 2], [180, rtY - 2]]} ink="accent" width={2.5} />
      <EdgeLabel x={190} y={(ontY + ontH + rtY) / 2} ink="accent" anchor="start">
        runs directly
      </EdgeLabel>
      <Box x={0} y={rtY} w={360} h={rtH} tone="accent" title={RUNTIME.title} body={RUNTIME.body} bodySize={TYPE.small} />
      <Box x={agentX} y={agentY} w={360 - agentX} h={agentH} pad={12} title={AGENT.title} body={['Any agent,', 'any vendor']} bodySize={TYPE.small} />
      <Arrow points={[[agentMid, agentY - 2], [agentMid, rtEnd + 2]]} />
      <EdgeLabel x={agentMid + 8} y={(rtEnd + agentY) / 2} anchor="start">
        calls it
      </EdgeLabel>
      <Arrow points={[[trunkX, rtEnd + 1], [trunkX, busY]]} heads="none" />
      <EdgeLabel x={trunkX - 8} y={(rtEnd + busY) / 2} anchor="end" weight={400}>
        derived from it
      </EdgeLabel>
      <Arrow points={[[childMid(0), busY], [childMid(3), busY]]} heads="none" />
      {DERIVED.map((label, i) => (
        <g key={label}>
          <Arrow points={[[childMid(i), busY], [childMid(i), childY - 1]]} />
          <Box
            x={i * (childW + childGap)}
            y={childY}
            w={childW}
            h={childH}
            pad={6}
            title={i === 3 ? ['Tools', 'agents call'] : [label]}
            titleSize={12}
            align="middle"
          />
        </g>
      ))}
    </Drawing>
  );
}

export function OntologyRunsFigure({ caption }: { caption: string }) {
  return <Figure caption={caption} wide={<Wide />} narrow={<Narrow />} />;
}
