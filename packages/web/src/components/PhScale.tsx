import { PH_SCALE, phScaleX } from '@planter/shared';

/** The pH bar: track, target band, and your reading. */
export function PhScale({ ph, min, max }: { ph: number; min: number; max: number }) {
  const bandX = phScaleX(min);
  const bandWidth = phScaleX(max) - bandX;
  const markerX = phScaleX(ph);
  // Keep the value label off the ends, where it would otherwise be clipped.
  const labelX = Math.min(PH_SCALE.width - 12, Math.max(12, markerX));

  return (
    <svg
      viewBox={`0 0 ${PH_SCALE.width} 70`}
      width="100%"
      role="img"
      aria-label={`pH scale from ${PH_SCALE.min} to ${PH_SCALE.max}, target band ${min} to ${max}, your reading ${ph}`}
    >
      <rect x="0" y="26" width={PH_SCALE.width} height="14" rx="7" fill="var(--hairline)" />
      <rect x={bandX} y="26" width={bandWidth} height="14" fill="var(--green)" />
      <path d={`M${markerX} 24l-7-11h14z`} fill="var(--ink)" />

      <g fontSize="12" fill="var(--muted)" fontFamily="Figtree, sans-serif">
        <text x="0" y="60">{PH_SCALE.min}</text>
        <text x={PH_SCALE.width} y="60" textAnchor="end">{PH_SCALE.max.toFixed(1)}</text>
        <text x={bandX + bandWidth / 2} y="60" textAnchor="middle">Target</text>
      </g>

      <text
        x={labelX}
        y="9"
        fontSize="13"
        fontWeight="600"
        fill="var(--ink)"
        textAnchor="middle"
        fontFamily="Figtree, sans-serif"
      >
        {ph.toFixed(1)}
      </text>
    </svg>
  );
}
