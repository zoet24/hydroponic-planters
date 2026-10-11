import { useState } from 'react';
import { axisLabel, niceDomain, PLOT, ticksFor, timeLabel, xAt, yAt, type Point } from '@planter/shared';

/**
 * Line chart for a single measure. Kept general rather than collapsed into a
 * temperature chart: if a second series ever arrives it gets its own chart, not
 * a second y-axis — two measures on two scales is the most misread chart there
 * is.
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
  dots = false,
  selectedTs = null,
  band = null,
}: {
  points: Point[];
  from: number;
  to: number;
  colour: string;
  format: (value: number) => string;
  zeroFloor?: boolean;
  loading?: boolean;
  title: string;
  /** Mark each reading. Worth it for hand-entered series like pH, where the
      points are few and far apart and a bare line implies readings between. */
  dots?: boolean;
  /** Draws a vertical rule, so selecting a log entry shows where it happened. */
  selectedTs?: number | null;
  /** A target range to shade, e.g. the preset's pH or temperature band. */
  band?: { min: number; max: number } | null;
}) {
  const [hover, setHover] = useState<Point | null>(null);
  // The band is part of what the chart is for, so it belongs in the domain.
  // Without this a single pH reading of 6.0 produced a 6.0-8.5 axis and the
  // 5.5-6.2 target sat off the bottom of the plot entirely.
  const domain = niceDomain(
    [...points.map((p) => p.value), ...(band ? [band.min, band.max] : [])],
    zeroFloor,
  );

  const path = points.map((p) => `${xAt(p.ts, from, to)},${yAt(p.value, domain)}`).join(' ');
  const hoverX = hover ? xAt(hover.ts, from, to) : 0;
  const inView = selectedTs !== null && selectedTs >= from && selectedTs <= to;

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
    <div className="lane">
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

      {band && points.length > 0 && (
        <rect
          x={PLOT.x0}
          y={yAt(Math.min(band.max, domain[1]), domain)}
          width={PLOT.x1 - PLOT.x0}
          height={Math.max(0, yAt(Math.max(band.min, domain[0]), domain) - yAt(Math.min(band.max, domain[1]), domain))}
          fill="var(--green)"
          opacity="0.08"
        />
      )}

      {dots &&
        points.map((pt) => (
          <circle key={pt.ts} cx={xAt(pt.ts, from, to)} cy={yAt(pt.value, domain)} r="4" fill={colour} />
        ))}

      {inView && (
        <line
          x1={xAt(selectedTs, from, to)}
          y1={PLOT.y0 - 6}
          x2={xAt(selectedTs, from, to)}
          y2={PLOT.y1 + 6}
          stroke="var(--ink)"
          strokeWidth="2"
          pointerEvents="none"
        />
      )}

      {hover && (
        <g pointerEvents="none">
          <line x1={hoverX} y1={PLOT.y0} x2={hoverX} y2={PLOT.y1} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx={hoverX} cy={yAt(hover.value, domain)} r="5" fill={colour} stroke="var(--card)" strokeWidth="2" />
        </g>
      )}
    </svg>

      {hover && (
        <Tip x={hoverX} heading={`${format(hover.value)} at ${timeLabel(hover.ts)}`} note={hover.note} />
      )}
    </div>
  );
}

/**
 * The hover readout, as HTML over the chart rather than SVG text.
 *
 * SVG has no line wrapping, so a note of any length would run off the plot or
 * need splitting into tspans by hand. Positioned as a percentage of the
 * viewBox width, which is what keeps it aligned as the chart scales.
 */
function Tip({ x, heading, note }: { x: number; heading: string; note?: string | null }) {
  const left = (x / 700) * 100;
  return (
    <div
      className="lane__tip"
      style={{
        left: `${left}%`,
        // Flip the anchor near the right edge so the tip stays on the chart.
        transform: left > 70 ? 'translateX(-100%)' : left < 12 ? 'none' : 'translateX(-50%)',
      }}
      role="status"
    >
      <span className="lane__tip-head">{heading}</span>
      {note && <span className="lane__tip-note">{note}</span>}
    </div>
  );
}

/**
 * Discrete events on the same time axis as the charts above it.
 *
 * One lane per kind rather than one lane of mixed markers: the whole point is
 * to see at a glance whether feeding lines up with the pH drifting, and mixed
 * glyphs on a shared row make that harder, not easier.
 */
export function EventStrip({
  label,
  items,
  from,
  to,
  colour = 'var(--green)',
  axis = false,
  selectedTs = null,
}: {
  label: string;
  items: Mark[];
  from: number;
  to: number;
  colour?: string;
  /** Only the bottom lane draws the shared time axis. */
  axis?: boolean;
  selectedTs?: number | null;
}) {
  const [hover, setHover] = useState<Mark | null>(null);
  const ticks = [0, 0.25, 0.5, 0.75].map((f) => from + f * (to - from));
  const span = to - from;
  const inView = selectedTs !== null && selectedTs >= from && selectedTs <= to;

  // Markers thin out as they crowd. Three weeks of a six-times-a-day pump is
  // 126 runs across 656 units, so fixed 7-unit bars overlapped into one solid
  // block -- the lane said "a pump exists" rather than showing the rhythm.
  // Half the available pitch leaves a gap the same width as the mark.
  const pitch = (PLOT.x1 - PLOT.x0) / Math.max(1, items.length);
  const markW = Math.max(1.5, Math.min(7, pitch * 0.5));

  return (
    <div className="lane">
      <svg
        viewBox={`0 0 700 ${axis ? 50 : 32}`}
        width="100%"
        role="img"
        aria-label={stripLabel(label, items)}
        className="chart"
        onPointerLeave={() => setHover(null)}
      >
        <text x="0" y="20" fontSize="12" fill="var(--muted)" fontFamily="Figtree, sans-serif">
          {label}
        </text>
        <line x1={PLOT.x0} y1="28" x2={PLOT.x1} y2="28" stroke="var(--border)" strokeWidth="1" />

        <g fill={colour}>
          {items.map((m) => (
            <rect
              key={m.ts}
              x={xAt(m.ts, from, to) - markW / 2}
              y="10"
              width={markW}
              height="18"
              rx={Math.min(2, markW / 2)}
              opacity={hover && hover.ts !== m.ts ? 0.45 : 1}
            />
          ))}
        </g>

        {/* Wider invisible targets: a 7px marker is a hard thing to hit. */}
        <g fill="transparent">
          {items.map((m) => (
            <rect
              key={m.ts}
              x={xAt(m.ts, from, to) - 9}
              y="4"
              width="18"
              height="26"
              onPointerEnter={() => setHover(m)}
            />
          ))}
        </g>

        {inView && (
          <line
            x1={xAt(selectedTs, from, to)}
            y1="4"
            x2={xAt(selectedTs, from, to)}
            y2="30"
            stroke="var(--ink)"
            strokeWidth="2"
            pointerEvents="none"
          />
        )}

        {axis && (
          <g fontSize="12" fill="var(--muted)" fontFamily="Figtree, sans-serif">
            {ticks.map((ts) => (
              <text key={ts} x={xAt(ts, from, to)} y="46">
                {axisLabel(ts, span)}
              </text>
            ))}
            <text x={PLOT.x1} y="46" textAnchor="end">
              {axisLabel(to, span)}
            </text>
          </g>
        )}
      </svg>

      {hover && (
        <Tip
          x={xAt(hover.ts, from, to)}
          heading={`${label} · ${timeLabel(hover.ts)}`}
          note={hover.note}
        />
      )}
    </div>
  );
}

export interface Mark {
  ts: number;
  note?: string | null;
}

const stripLabel = (label: string, items: Mark[]): string =>
  items.length === 0
    ? `No ${label.toLowerCase()} in this period`
    : `${items.length} ${label.toLowerCase()} in this period`;
