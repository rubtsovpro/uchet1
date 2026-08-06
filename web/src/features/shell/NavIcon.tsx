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
    case 'documents':
      return (
        <svg {...common}>
          <path d="M5 2.5h5l3 3V15.5H5z" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M10 2.5V5.5h3M7 9h4M7 11.5h4M7 14h2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'purchases':
      return (
        <svg {...common}>
          <path d="M3 4h12l-1 8H4L3 4zm2 11a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case 'warehouse':
      return (
        <svg {...common}>
          <path d="M2 7l7-4 7 4v7H2V7zM2 7h14M9 3v11" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case 'works':
      return (
        <svg {...common}>
          <path d="M4 14l4-4 2 2 4-5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="14" cy="5" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'production':
      return (
        <svg {...common}>
          <path d="M3 14V8l3-2 3 2 3-2 3 2v6H3z" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case 'money':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M9 5v8M7 7.5c.5-1 4-1 4 1s-3.5 1.5-4 2.5c-.4.8 2.5 1.5 4 .8" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case 'kassa':
      return (
        <svg {...common}>
          <path d="M3.5 6.5h11v8.5h-11zM5.5 6.5V4.8h7v1.7M6.5 9.5h5M6.5 12h3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M7.5 3.2h3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case 'staff':
      return (
        <svg {...common}>
          <circle cx="7" cy="6" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M3 14c.5-2.5 7-2.5 7.5 0M12 7.5a1.8 1.8 0 110-3.5M13.5 14c.3-1.5 3-1.8 3.5 0" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case 'chats':
      return (
        <svg {...common}>
          <path
            d="M3.5 4.5h11v8H8l-2.5 2v-2H3.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path d="M6.5 8h5M6.5 10h3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case 'company':
      return (
        <svg {...common}>
          <path d="M4 15V5l5-2 5 2v10H4zM7 15v-4h4v4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M9 2.5v2M9 13.5v2M2.5 9h2M13.5 9h2M4.2 4.2l1.4 1.4M12.4 12.4l1.4 1.4M4.2 13.8l1.4-1.4M12.4 5.6l1.4-1.4" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case 'ideas':
      return (
        <svg {...common}>
          <path d="M9 2.5a4 4 0 014 4c0 1.6-.8 2.6-1.6 3.5-.5.5-.9 1.1-1 1.8H7.6c-.1-.7-.5-1.3-1-1.8C5.8 9.1 5 8.1 5 6.5a4 4 0 014-4zM7.5 13.5h3M7.8 15h2.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case 'help':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M7 7a2 2 0 013.5 1.2c0 1.3-1.5 1.5-1.5 2.8M9 13h.01" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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
