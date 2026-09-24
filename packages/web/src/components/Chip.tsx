export type ChipTone = 'green' | 'amber' | 'red' | 'grey';

export function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  return (
    <span className={`chip chip--${tone}`}>
      {/* Colour is never the only signal — every chip carries a text label. */}
      <span className="chip__dot" aria-hidden="true" />
      {children}
    </span>
  );
}
