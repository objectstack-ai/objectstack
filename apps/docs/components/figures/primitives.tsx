import type { ReactNode } from 'react';

/*
 * The drawing kit for the blog's hand-drawn figures.
 *
 * Inline SVG from a server component, never an image file: the site switches
 * theme with a `dark` class on the html element (next-themes, through
 * fumadocs' RootProvider), and an SVG loaded as an image is a separate
 * document that cannot see that class. It could follow only the OS
 * preference, which is not the page's theme. Inline SVG is part of the page,
 * so every colour here is a Tailwind class pair, a light value and its
 * `dark:` value, and a figure flips with the toggle: no client script, no
 * flash, no second request.
 *
 * Text inherits the page's font stack. No font-family is set anywhere in a
 * figure, and no font file is requested.
 *
 * Each figure draws its content twice: a wide drawing shown from the `lg`
 * breakpoint, where the prose column is about 860 px, and a stacked drawing
 * below it, capped at 440 px, so text stays at reading size on a phone rather
 * than being scaled down to a few pixels. The drawing not shown is
 * `display: none`, which also takes it out of the accessibility tree, so a
 * screen reader meets each figure once, through its title and description.
 */

/** A box's colour role. Each names its text colours for both themes. */
export type Tone = 'plain' | 'ink' | 'raised' | 'accent' | 'warm' | 'dashed' | 'paper';

const BOX: Record<Tone, { rect: string; title: string; body: string; eyebrow: string }> = {
  plain: {
    rect: 'fill-white stroke-neutral-300 dark:fill-neutral-800 dark:stroke-neutral-600',
    title: 'fill-neutral-900 dark:fill-neutral-50',
    body: 'fill-neutral-600 dark:fill-neutral-300',
    eyebrow: 'fill-indigo-700 dark:fill-indigo-300',
  },
  // The emphasised box: near-black on the light page, deep indigo with a
  // bright edge on the dark one, where a near-black box would vanish.
  ink: {
    rect: 'fill-neutral-900 stroke-neutral-900 dark:fill-indigo-950 dark:stroke-indigo-400',
    title: 'fill-neutral-50',
    body: 'fill-indigo-200',
    eyebrow: 'fill-indigo-300',
  },
  // A box drawn ON an ink shape: one step lighter, with an accent edge.
  raised: {
    rect: 'fill-neutral-800 stroke-indigo-500 dark:fill-indigo-900 dark:stroke-indigo-400',
    title: 'fill-indigo-100',
    body: 'fill-indigo-100',
    eyebrow: 'fill-indigo-300',
  },
  accent: {
    rect: 'fill-indigo-600 stroke-indigo-600 dark:stroke-indigo-400',
    title: 'fill-white',
    body: 'fill-indigo-100',
    eyebrow: 'fill-indigo-100',
  },
  warm: {
    rect: 'fill-orange-50 stroke-orange-300 dark:fill-orange-950 dark:stroke-orange-700',
    title: 'fill-amber-800 dark:fill-orange-300',
    body: 'fill-neutral-700 dark:fill-orange-100',
    eyebrow: 'fill-amber-800 dark:fill-orange-300',
  },
  dashed: {
    rect: 'fill-none stroke-neutral-500 dark:stroke-neutral-400',
    title: 'fill-neutral-600 dark:fill-neutral-300',
    body: 'fill-neutral-600 dark:fill-neutral-300',
    eyebrow: 'fill-neutral-600 dark:fill-neutral-300',
  },
  // A light shape that stays light in both themes: drawn on an ink panel.
  paper: {
    rect: 'fill-neutral-50 stroke-neutral-50 dark:fill-neutral-100 dark:stroke-neutral-100',
    title: 'fill-neutral-900',
    body: 'fill-neutral-600',
    eyebrow: 'fill-indigo-700',
  },
};

/** A connector's colour role, with the colour of a label written beside it. */
export type Ink = 'gray' | 'accent' | 'warm' | 'onInk';

const LINE: Record<Ink, { stroke: string; fill: string; label: string }> = {
  gray: {
    stroke: 'stroke-neutral-500 dark:stroke-neutral-400',
    fill: 'fill-neutral-500 dark:fill-neutral-400',
    label: 'fill-neutral-600 dark:fill-neutral-300',
  },
  accent: {
    stroke: 'stroke-indigo-600 dark:stroke-indigo-400',
    fill: 'fill-indigo-600 dark:fill-indigo-400',
    label: 'fill-indigo-700 dark:fill-indigo-300',
  },
  warm: {
    stroke: 'stroke-amber-700 dark:stroke-orange-400',
    fill: 'fill-amber-700 dark:fill-orange-400',
    label: 'fill-amber-800 dark:fill-orange-300',
  },
  onInk: {
    stroke: 'stroke-indigo-300',
    fill: 'fill-indigo-300',
    label: 'fill-indigo-300',
  },
};

/** Text written straight on the figure's plate, outside any box. */
export const PLATE_TEXT = {
  strong: 'fill-neutral-900 dark:fill-neutral-50',
  muted: 'fill-neutral-600 dark:fill-neutral-300',
  eyebrow: 'fill-indigo-700 dark:fill-indigo-300',
} as const;

/** The type scale, in user units; a wide drawing renders at about 0.97 px per unit. */
export const TYPE = {
  eyebrow: 11.5,
  title: 15,
  body: 13,
  small: 12.5,
  label: 12.5,
} as const;

const BOLD_EM = 0.62;
const REGULAR_EM = 0.55;

/**
 * Greedy word wrap by an estimated character width. The estimate is set from
 * DejaVu Sans, the widest of the common fallback faces, so a line that fits
 * here fits under the narrower system faces too. An array is taken as
 * already broken by hand.
 */
export function wrap(text: string | string[], width: number, size: number, bold = false): string[] {
  if (Array.isArray(text)) return text;
  const max = Math.max(1, Math.floor(width / (size * (bold ? BOLD_EM : REGULAR_EM))));
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

type TextProps = {
  x: number;
  y: number;
  size?: number;
  weight?: 400 | 600 | 700;
  anchor?: 'start' | 'middle' | 'end';
  spacing?: number;
  className: string;
  children: ReactNode;
};

/** One line of text, vertically centred on `y`. */
export function Text({ x, y, size = TYPE.body, weight = 400, anchor = 'start', spacing, className, children }: TextProps) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fontWeight={weight}
      textAnchor={anchor}
      dominantBaseline="central"
      letterSpacing={spacing}
      className={className}
    >
      {children}
    </text>
  );
}

/** A small uppercase heading, the deck's eyebrow line. */
export function Eyebrow({ x, y, anchor = 'start', className = PLATE_TEXT.eyebrow, children }: {
  x: number;
  y: number;
  anchor?: 'start' | 'middle' | 'end';
  className?: string;
  children: string;
}) {
  return (
    <Text x={x} y={y} size={TYPE.eyebrow} weight={600} anchor={anchor} spacing={1} className={className}>
      {children.toUpperCase()}
    </Text>
  );
}

type BoxProps = {
  x: number;
  y: number;
  w: number;
  h: number;
  tone?: Tone;
  eyebrow?: string;
  title?: string | string[];
  body?: string | string[];
  titleSize?: number;
  bodySize?: number;
  align?: 'start' | 'middle';
  pad?: number;
  radius?: number;
};

/**
 * A rounded box with an optional eyebrow, a bold title and body lines, the
 * whole stack centred vertically. The rect is the group's first child, so a
 * check can read each group as "these texts belong inside this shape".
 */
export function Box({
  x,
  y,
  w,
  h,
  tone = 'plain',
  eyebrow,
  title,
  body,
  titleSize = TYPE.title,
  bodySize = TYPE.body,
  align = 'start',
  pad = 14,
  radius = 10,
}: BoxProps) {
  const t = BOX[tone];
  const inner = w - 2 * pad;
  const titleLines = title === undefined ? [] : wrap(title, inner, titleSize, true);
  const bodyLines = body === undefined ? [] : wrap(body, inner, bodySize);
  const eyebrowLh = TYPE.eyebrow * 1.5;
  const titleLh = titleSize * 1.3;
  const bodyLh = bodySize * 1.4;
  const gap = 5;
  const height =
    (eyebrow ? eyebrowLh + gap : 0) +
    titleLines.length * titleLh +
    (titleLines.length && bodyLines.length ? gap : 0) +
    bodyLines.length * bodyLh;
  const tx = align === 'middle' ? x + w / 2 : x + pad;
  const anchor = align === 'middle' ? 'middle' : 'start';
  let cursor = y + (h - height) / 2;
  const parts: ReactNode[] = [];
  if (eyebrow) {
    parts.push(
      <Eyebrow key="e" x={tx} y={cursor + eyebrowLh / 2} anchor={anchor} className={t.eyebrow}>
        {eyebrow}
      </Eyebrow>,
    );
    cursor += eyebrowLh + gap;
  }
  titleLines.forEach((line, i) => {
    parts.push(
      <Text key={`t${i}`} x={tx} y={cursor + titleLh / 2} size={titleSize} weight={700} anchor={anchor} className={t.title}>
        {line}
      </Text>,
    );
    cursor += titleLh;
  });
  if (titleLines.length && bodyLines.length) cursor += gap;
  bodyLines.forEach((line, i) => {
    // An empty line is a spacer: it takes its height and draws nothing.
    if (line) {
      parts.push(
        <Text key={`b${i}`} x={tx} y={cursor + bodyLh / 2} size={bodySize} anchor={anchor} className={t.body}>
          {line}
        </Text>,
      );
    }
    cursor += bodyLh;
  });
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={radius}
        strokeWidth={tone === 'dashed' ? 1.5 : 1}
        strokeDasharray={tone === 'dashed' ? '6 4' : undefined}
        className={t.rect}
      />
      {parts}
    </g>
  );
}

/** A circle with centred text lines: the deck's picture of a model. */
export function Circle({ cx, cy, r, tone = 'ink', title, body, titleSize = 16, bodySize = TYPE.small }: {
  cx: number;
  cy: number;
  r: number;
  tone?: Tone;
  title: string;
  body?: string[];
  titleSize?: number;
  bodySize?: number;
}) {
  const t = BOX[tone];
  const titleLh = titleSize * 1.3;
  const bodyLh = bodySize * 1.35;
  const lines = body ?? [];
  const height = titleLh + (lines.length ? 4 + lines.length * bodyLh : 0);
  let cursor = cy - height / 2;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} className={t.rect} strokeWidth={1} />
      <Text x={cx} y={cursor + titleLh / 2} size={titleSize} weight={700} anchor="middle" className={t.title}>
        {title}
      </Text>
      {lines.map((line, i) => {
        if (i === 0) cursor += titleLh + 4;
        const y = cursor + bodyLh / 2;
        cursor += bodyLh;
        return (
          <Text key={i} x={cx} y={y} size={bodySize} anchor="middle" className={t.body}>
            {line}
          </Text>
        );
      })}
    </g>
  );
}

type Point = readonly [number, number];

const HEAD_LENGTH = 8;
const HEAD_HALF_WIDTH = 4.5;

function head([x1, y1]: Point, [x2, y2]: Point, className: string) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const bx = x2 - ux * HEAD_LENGTH;
  const by = y2 - uy * HEAD_LENGTH;
  const points = [
    [x2, y2],
    [bx - uy * HEAD_HALF_WIDTH, by + ux * HEAD_HALF_WIDTH],
    [bx + uy * HEAD_HALF_WIDTH, by - ux * HEAD_HALF_WIDTH],
  ]
    .map(([px, py]) => `${round(px)},${round(py)}`)
    .join(' ');
  return <polygon points={points} className={className} />;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

/** Pull an endpoint back along its segment, so a line stops where its head begins. */
function retract(from: Point, to: Point, by: number): Point {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  return [to[0] - ((to[0] - from[0]) / len) * by, to[1] - ((to[1] - from[1]) / len) * by];
}

/**
 * A connector through `points`, with an arrowhead at the end, at both ends,
 * or none (a bus). Heads are drawn polygons, not SVG markers, so they take
 * the same colour classes as the line in every browser.
 */
export function Arrow({ points, ink = 'gray', heads = 'end', dashed = false, width = 2 }: {
  points: readonly Point[];
  ink?: Ink;
  heads?: 'end' | 'both' | 'none';
  dashed?: boolean;
  width?: number;
}) {
  const c = LINE[ink];
  const pts = points.map((p) => [p[0], p[1]] as Point);
  const n = pts.length;
  const drawn = [...pts];
  if (heads !== 'none') drawn[n - 1] = retract(pts[n - 2], pts[n - 1], HEAD_LENGTH - 1);
  if (heads === 'both') drawn[0] = retract(pts[1], pts[0], HEAD_LENGTH - 1);
  const d = drawn.map(([px, py], i) => `${i ? 'L' : 'M'}${round(px)} ${round(py)}`).join(' ');
  return (
    <g>
      <path
        d={d}
        fill="none"
        strokeWidth={width}
        strokeLinejoin="round"
        strokeDasharray={dashed ? '5 4' : undefined}
        className={c.stroke}
      />
      {heads !== 'none' && head(pts[n - 2], pts[n - 1], c.fill)}
      {heads === 'both' && head(pts[1], pts[0], c.fill)}
    </g>
  );
}

/** A label written beside a connector, in the connector's colour. */
export function EdgeLabel({ x, y, ink = 'gray', anchor = 'middle', weight = 600, children }: {
  x: number;
  y: number;
  ink?: Ink;
  anchor?: 'start' | 'middle' | 'end';
  weight?: 400 | 600;
  children: string;
}) {
  return (
    <Text x={x} y={y} size={TYPE.label} weight={weight} anchor={anchor} className={LINE[ink].label}>
      {children}
    </Text>
  );
}

/** A dot on a connector, in the connector's colour. */
export function Dot({ cx, cy, r = 4, ink = 'accent' }: { cx: number; cy: number; r?: number; ink?: Ink }) {
  return <circle cx={cx} cy={cy} r={r} className={LINE[ink].fill} />;
}

const MARGIN = 2;

/** One drawing: a responsive SVG named by its title and described by its description. */
export function Drawing({ id, width, height, title, desc, children }: {
  id: string;
  width: number;
  height: number;
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox={`${-MARGIN} ${-MARGIN} ${width + 2 * MARGIN} ${height + 2 * MARGIN}`}
      width="100%"
      role="img"
      aria-labelledby={`${id}-title ${id}-desc`}
      className="h-auto w-full"
    >
      <title id={`${id}-title`}>{title}</title>
      <desc id={`${id}-desc`}>{desc}</desc>
      {children}
    </svg>
  );
}

/**
 * The figure frame: a plate holding the wide and the stacked drawing, and a
 * one-line italic caption under it.
 */
export function Figure({ caption, wide, narrow }: { caption: string; wide: ReactNode; narrow: ReactNode }) {
  return (
    <figure>
      <div className="rounded-xl border border-fd-border bg-fd-card p-3 lg:p-6">
        <div className="hidden lg:block">{wide}</div>
        <div className="mx-auto max-w-[440px] lg:hidden">{narrow}</div>
      </div>
      <figcaption className="text-center italic">{caption}</figcaption>
    </figure>
  );
}
