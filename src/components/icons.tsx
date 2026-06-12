interface IconProps {
  size?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const PanelIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <line x1="9.5" y1="4" x2="9.5" y2="20" />
  </svg>
);

export const SearchIcon = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <line x1="16.5" y1="16.5" x2="21" y2="21" />
  </svg>
);

export const PlusIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const LayersIcon = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <polygon points="12 3 21 8 12 13 3 8 12 3" />
    <polyline points="3 13 12 18 21 13" />
  </svg>
);

export const ServerIcon = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="4" width="18" height="7" rx="1.5" />
    <rect x="3" y="13" width="18" height="7" rx="1.5" />
    <line x1="7" y1="7.5" x2="7" y2="7.5" strokeWidth="2.4" />
    <line x1="7" y1="16.5" x2="7" y2="16.5" strokeWidth="2.4" />
  </svg>
);

export const ShieldIcon = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 3l7.5 3v5.5c0 4.5-3 8-7.5 9.5-4.5-1.5-7.5-5-7.5-9.5V6L12 3z" />
  </svg>
);

export const UserIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="8.5" r="3.8" />
    <path d="M4.5 20c1.5-3.4 4.2-5 7.5-5s6 1.6 7.5 5" />
  </svg>
);

export const MoonIcon = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5z" />
  </svg>
);

export const SunIcon = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3L19 19M19 5l-1.7 1.7M6.7 17.3L5 19" />
  </svg>
);

export const ChevronDownIcon = ({ size = 12 }: IconProps) => (
  <svg {...base(size)}>
    <polyline points="5 9 12 16 19 9" />
  </svg>
);

export const ComposeIcon = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
    <path d="M17.3 3.7a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 8.3-8.3z" />
  </svg>
);

export const ChevronIcon = ({ size = 13, open = true }: IconProps & { open?: boolean }) => (
  <svg {...base(size)} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}>
    <polyline points="9 5 16 12 9 19" />
  </svg>
);
