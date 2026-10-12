import { Arrow, Box, Drawing, EdgeLabel, Figure } from './primitives';

/*
 * Figure for "What an enterprise actually wants to say": the four places a
 * business definition lives today, joined into the one place it can be
 * written down. Every label is the essay's or the talk deck's own wording.
 */

const TITLE = 'Four places to one definition';
const DESC =
  'Four boxes on the left show where an enterprise definition lives today: in veterans’ heads (“Ask Maria ' +
  'first”), in policy documents (written, not followed), in spreadsheets (one version per department), and in a few ' +
  'hundred thousand lines of code (one change, four places). A bus joins them into one dark box on the right, written ' +
  'down once: one definition, with five parts: what we have, how it relates, what can be done, who may do it, and what ' +
  'happens when.';

const SOURCES = [
  { title: 'In veterans’ heads', body: '“Ask Maria first”' },
  { title: 'In policy documents', body: 'Written, not followed' },
  { title: 'In spreadsheets', body: 'One version per department' },
  { title: 'In a few hundred thousand lines of code', body: 'One change, four places' },
] as const;

const DEFINITION = {
  title: 'One definition',
  parts: ['what we have', 'how it relates', 'what can be done', 'who may do it', 'what happens when'],
};

const JOIN = 'Written down, once';

function Wide() {
  const srcW = 360;
  const srcH = 58;
  const srcGap = 12;
  const height = 4 * srcH + 3 * srcGap; // 268
  const busX = 420;
  const defX = 600;
  const mid = height / 2;
  return (
    <Drawing id="fig-one-definition-wide" width={840} height={height} title={TITLE} desc={DESC}>
      {SOURCES.map((s, i) => {
        const y = i * (srcH + srcGap);
        return (
          <g key={s.title}>
            <Box x={0} y={y} w={srcW} h={srcH} title={[s.title]} titleSize={14} body={s.body} />
            <Arrow points={[[srcW, y + srcH / 2], [busX, y + srcH / 2]]} heads="none" />
          </g>
        );
      })}
      <Arrow points={[[busX, srcH / 2], [busX, height - srcH / 2]]} heads="none" />
      <Arrow points={[[busX, mid], [defX - 2, mid]]} ink="accent" width={2.5} />
      <EdgeLabel x={(busX + defX) / 2} y={mid - 14} ink="accent">
        {JOIN}
      </EdgeLabel>
      <Box
        x={defX}
        y={0}
        w={840 - defX}
        h={height}
        tone="ink"
        pad={24}
        radius={14}
        title={DEFINITION.title}
        titleSize={19}
        body={['', ...DEFINITION.parts]}
        bodySize={14.5}
      />
    </Drawing>
  );
}

function Narrow() {
  const srcW = 316;
  const heights = [52, 52, 52, 70];
  const srcGap = 10;
  const tops = heights.map((_, i) => heights.slice(0, i).reduce((a, h) => a + h + srcGap, 0));
  const centres = tops.map((t, i) => t + heights[i] / 2);
  const srcEnd = tops[3] + heights[3];
  const busX = 340;
  const defY = srcEnd + 46;
  const defH = 176;
  return (
    <Drawing id="fig-one-definition-narrow" width={360} height={defY + defH} title={TITLE} desc={DESC}>
      {SOURCES.map((s, i) => (
        <g key={s.title}>
          <Box
            x={0}
            y={tops[i]}
            w={srcW}
            h={heights[i]}
            title={i === 3 ? ['In a few hundred thousand', 'lines of code'] : s.title}
            titleSize={13.5}
            body={s.body}
            bodySize={12.5}
            pad={12}
          />
          <Arrow points={[[srcW, centres[i]], [busX, centres[i]]]} heads="none" />
        </g>
      ))}
      <Arrow points={[[busX, centres[0]], [busX, centres[3]]]} heads="none" />
      <Arrow points={[[busX, centres[3]], [busX, defY - 2]]} ink="accent" width={2.5} />
      <EdgeLabel x={busX - 10} y={(srcEnd + defY) / 2} ink="accent" anchor="end">
        {JOIN}
      </EdgeLabel>
      <Box
        x={0}
        y={defY}
        w={360}
        h={defH}
        tone="ink"
        pad={20}
        radius={14}
        title={DEFINITION.title}
        titleSize={18}
        body={DEFINITION.parts}
        bodySize={14}
      />
    </Drawing>
  );
}

export function OneDefinitionFigure({ caption }: { caption: string }) {
  return <Figure caption={caption} wide={<Wide />} narrow={<Narrow />} />;
}
