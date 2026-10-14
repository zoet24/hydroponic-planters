import type { EventIcon as IconName } from '@planter/shared';

/** The timeline glyphs. */
export function EventIcon({ name }: { name: IconName }) {
  if (name === 'ph') return <span className="timeline__ph">pH</span>;

  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'pump':
      return (
        <svg {...common} strokeWidth="2">
          <path d="M3 9c2.5-2 4.5-2 7 0s4.5 2 7 0 3-1.5 4-1M3 15c2.5-2 4.5-2 7 0s4.5 2 7 0 3-1.5 4-1" />
        </svg>
      );
    case 'preset':
      return (
        <svg {...common} strokeWidth="2.4">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case 'nutrients':
      return (
        <svg {...common} strokeWidth="2.4">
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'water':
      return (
        <svg {...common} strokeWidth="2">
          <path d="M12 3s6 6.2 6 10.5a6 6 0 01-12 0C6 9.2 12 3 12 3z" />
        </svg>
      );
    case 'plug':
      return (
        <svg {...common} strokeWidth="2">
          <path d="M9 3v6M15 3v6M6 9h12v3a6 6 0 01-12 0zM12 18v3" />
        </svg>
      );
    case 'note':
      return (
        <svg {...common} strokeWidth="2">
          <path d="M5 4h11l3 3v13H5zM8 10h8M8 14h6" />
        </svg>
      );
    default:
      return (
        <svg {...common} strokeWidth="2.4">
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}
