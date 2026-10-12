import { Arrow, Box, Dot, Drawing, Eyebrow, Figure, TYPE } from './primitives';

/*
 * Figure for "Why now": three interfaces, one user. Every label is the
 * essay's or the talk deck's own wording.
 */

const TITLE = 'Three interfaces, one user';
const DESC =
  'Enterprise software changed its interface three times: terminals and forms, where people adapted to the software; ' +
  'web and mobile, where the software adapted to people; a conversation box, where the software disappears into language. ' +
  'Beneath all three runs one band, the one thing that never changed: the user was a person. The API was written for a ' +
  'programmer, the documentation for a reader, the audit log for an auditor. A fourth, highlighted column is the new ' +
  'user: an agent, the first new user in forty years. It is not a person.';

const ERAS = [
  { title: 'Terminals and forms', wide: ['People adapted', 'to the software'], narrow: 'People adapted to the software' },
  { title: 'Web and mobile', wide: ['The software', 'adapted to people'], narrow: 'The software adapted to people' },
  {
    title: 'A conversation box',
    wide: ['The software disappears', 'into language'],
    narrow: 'The software disappears into language',
  },
] as const;

const BAND = {
  eyebrow: 'The one thing that never changed',
  title: 'The user was a person.',
  wide: ['The API was written for a programmer, the documentation for a reader,', 'the audit log for an auditor.'],
  narrow: ['The API was written for a programmer,', 'the documentation for a reader,', 'the audit log for an auditor.'],
};

const AGENT = { eyebrow: 'A new user', title: 'An agent' };

function Wide() {
  const eraW = 200;
  const eraGap = 14;
  const erasEnd = 3 * eraW + 2 * eraGap; // 628
  const agentX = erasEnd + 24;
  const top = 40;
  const eraH = 90;
  const bandY = top + eraH + 14;
  const bandH = 108;
  const bottom = bandY + bandH;
  return (
    <Drawing id="fig-three-interfaces-wide" width={840} height={bottom} title={TITLE} desc={DESC}>
      <Eyebrow x={0} y={8}>
        Three interfaces
      </Eyebrow>
      <Arrow points={[[0, 26], [erasEnd, 26]]} ink="accent" />
      {ERAS.map((era, i) => {
        const x = i * (eraW + eraGap);
        return (
          <g key={era.title}>
            <Dot cx={x + eraW / 2} cy={26} />
            <Box x={x} y={top} w={eraW} h={eraH} title={era.title} titleSize={14.5} body={[...era.wide]} />
          </g>
        );
      })}
      <Box
        x={0}
        y={bandY}
        w={erasEnd}
        h={bandH}
        tone="ink"
        pad={18}
        eyebrow={BAND.eyebrow}
        title={BAND.title}
        body={BAND.wide}
      />
      <Arrow points={[[erasEnd + 2, bandY + bandH / 2], [agentX - 2, bandY + bandH / 2]]} ink="accent" />
      <Box
        x={agentX}
        y={top}
        w={840 - agentX}
        h={bottom - top}
        tone="accent"
        pad={18}
        eyebrow={AGENT.eyebrow}
        title={AGENT.title}
        titleSize={17}
        body={['The first new user', 'in forty years.', '', 'It is not a person.']}
      />
    </Drawing>
  );
}

function Narrow() {
  const cardX = 24;
  const cardH = 56;
  const cardGap = 8;
  const top = 24;
  const erasEnd = top + 3 * cardH + 2 * cardGap; // 208
  const bandY = erasEnd + 14;
  const bandH = 128;
  const agentY = bandY + bandH + 22;
  const agentH = 104;
  return (
    <Drawing
      id="fig-three-interfaces-narrow"
      width={360}
      height={agentY + agentH}
      title={TITLE}
      desc={DESC}
    >
      <Eyebrow x={0} y={8}>
        Three interfaces
      </Eyebrow>
      <Arrow points={[[8, top], [8, erasEnd]]} ink="accent" />
      {ERAS.map((era, i) => {
        const y = top + i * (cardH + cardGap);
        return (
          <g key={era.title}>
            <Dot cx={8} cy={y + cardH / 2} />
            <Box x={cardX} y={y} w={360 - cardX} h={cardH} title={era.title} titleSize={14.5} body={era.narrow} />
          </g>
        );
      })}
      <Box x={0} y={bandY} w={360} h={bandH} tone="ink" eyebrow={BAND.eyebrow} title={BAND.title} body={BAND.narrow} />
      <Arrow points={[[180, bandY + bandH + 2], [180, agentY - 2]]} ink="accent" />
      <Box
        x={0}
        y={agentY}
        w={360}
        h={agentH}
        tone="accent"
        eyebrow={AGENT.eyebrow}
        title={AGENT.title}
        titleSize={17}
        body={['The first new user in forty years.', 'It is not a person.']}
        bodySize={TYPE.body}
      />
    </Drawing>
  );
}

export function ThreeInterfacesFigure({ caption }: { caption: string }) {
  return <Figure caption={caption} wide={<Wide />} narrow={<Narrow />} />;
}
