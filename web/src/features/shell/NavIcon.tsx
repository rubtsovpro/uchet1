type IconProps = { name: string };

export function NavIcon({ name }: IconProps) {
  const common = {
    className: 'sec-svg',
    viewBox: '0 0 18 18',
    width: 18,
    height: 18,
    'aria-hidden': true as const,
  };

  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M3 8.5L9 3l6 5.5V15H11v-4H7v4H3z" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case 'crm':
      return (
        <svg {...common}>
          <circle cx="9" cy="6" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M4 14c1-3 9-3 10 0" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case 'sales':
      return (
        <svg {...common}>
          <path d="M3 5h12v9H3zM6 5V4h6v1" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case 'company':
      return (
        <svg {...common}>
          <path d="M4 15V5l5-2 5 2v10H4zM7 15v-4h4v4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case 'money':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M9 5v8M7 7.5c.5-1 4-1 4 1s-3.5 1.5-4 2.5c-.4.8 2.5 1.5 4 .8" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="3" y="3" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
  }
}
