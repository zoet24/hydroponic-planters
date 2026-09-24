import { useState } from 'react';
import { niceDomain, PLOT, ticksFor, timeLabel, xAt, yAt, type Point } from '@planter/shared';

/**
 * Small-multiple line chart. Water temperature and light level get one chart
 * each rather than sharing a dual axis — two measures on two y-scales is the
 * single most misread chart there is, and the artboard already splits them.
 *
 * Hover gives a crosshair and a value readout. Not drawn on the artboard, but a
 * line chart people can't interrogate is a picture of data rather than data.
 */
export function LineChart({
  points,
  from,
  to,
  colour,
  format,
  zeroFloor = false,
  loading = false,
  title,
}: {
  points: Point[];
  from: number;
  to: number;
  colour: string;
  format: (value: number) => string;
  zeroFloor?: boolean;
  loading?: boolean;
  title: string;
}) {
  const [hover, setHover] = useState<Point | null>(null);
  const domain = niceDomain(points.map((p) => p.value), zeroFloor);

  const path = points.map((p) => `${xAt(p.ts, from, to)},${yAt(p.value, domain)}`).join(' ');
  const hoverX = hover ? xAt(hover.ts, from, to) : 0;

  function track(event: React.PointerEvent<SVGSVGElement>) {
    if (points.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const ts = from + ratio * (to - from);
    let nearest = points[0]!;
    for (const p of points) {
      if (Math.abs(p.ts - ts) < Math.abs(nearest.ts - ts)) nearest = p;
    }
    setHover(nearest);
  }

  return (
    <svg
      viewBox={`0 0 700 130`}
      width="100%"
      role="img"
      aria-label={title}
      className="chart"
      onPointerMove={track}
      onPointerLeave={() => setHover(null)}
    >
      <g stroke="var(--border)" strokeWidth="1">
        {[PLOT.y0, (PLOT.y0 + PLOT.y1) / 2, PLOT.y1].map((y) => (
          <line key={y} x1={PLOT.x0} y1={y} x2={PLOT.x1} y2={y} />
        ))}
      </g>

      {/* No axis labels without data: an empty series otherwise renders a
          plausible-looking 0-to-1 scale, which reads as real measurements. */}
      {points.length > 0 && (
        <g fontSize="12" fill="var(--muted)" fontFamily="Figtree, sans-serif">
          {ticksFor(domain).map((value, i) => (
            <text key={value} x="0" y={[24, 64, 104][i]}>
              {format(value)}
            </text>
          ))}
        </g>
      )}

      {points.length > 0 ? (
        <polyline
          points={path}
          fill="none"
          stroke={colour}
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : (
        <text x={PLOT.x0 + 8} y="64" fontSize="13" fill="var(--muted)" fontFamily="Figtree, sans-serif">
          {loading ? 'Loading…' : 'No readings yet'}
        </text>
      )}

      {hover && (
        <g pointerEvents="none">
          <line x1={hoverX} y1={PLOT.y0} x2={hoverX} y2={PLOT.y1} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx={hoverX} cy={yAt(hover.value, domain)} r="5" fill={colour} stroke="var(--card)" strokeWidth="2" />
          <text
            x={Math.min(hoverX + 8, PLOT.x1 - 110)}
            y="14"
            fontSize="13"
            fontWeight="600"
            fill="var(--ink)"
            fontFamily="Figtree, sans-serif"
          >
            {format(hover.value)} at {timeLabel(hover.ts)}
          </text>
        </g>
      )}
    </svg>
  );
}

/** Discrete events on the same time axis as the charts above it. */
export function PumpStrip({ runs, from, to }: { runs: number[]; from: number; to: number }) {
  const ticks = [0, 0.25, 0.5, 0.75].map((f) => from + f * (to - from));

  return (
    <svg viewBox="0 0 700 50" width="100%" role="img" aria-label={pumpLabel(runs)} className="chart">
      <text x="0" y="20" fontSize="12" fill="var(--muted)" fontFamily="Figtree, sans-serif">Pump</text>
      <line x1={PLOT.x0} y1="28" x2={PLOT.x1} y2="28" stroke="var(--border)" strokeWidth="1" />

      <g fill="var(--green)">
        {runs.map((ts) => (
          <rect key={ts} x={xAt(ts, from, to) - 3.5} y="10" width="7" height="18" rx="2" />
        ))}
      </g>

      <g fontSize="12" fill="var(--muted)" fontFamily="Figtree, sans-serif">
        {ticks.map((ts) => (
          <text key={ts} x={xAt(ts, from, to)} y="46">
            {timeLabel(ts)}
          </text>
        ))}
        <text x={PLOT.x1} y="46" textAnchor="end">Now</text>
      </g>
    </svg>
  );
}

const pumpLabel = (runs: number[]): string =>
  runs.length === 0
    ? 'No pump runs in this period'
    : `${runs.length} pump run${runs.length === 1 ? '' : 's'} in this period`;
