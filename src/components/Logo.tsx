interface LogoIconProps {
  size?: number;
  className?: string;
}

/**
 * Note67 app icon - document with audio waveform and "67"
 */
export function LogoIcon({ size = 48, className }: LogoIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Orange background */}
      <rect x="2" y="4" width="44" height="40" rx="10" fill="var(--color-accent)" />
      {/* Document */}
      <path
        d="M12 12h18l6 6v18a1.5 1.5 0 01-1.5 1.5h-21A1.5 1.5 0 0112 36V13.5A1.5 1.5 0 0113.5 12z"
        fill="white"
        fillOpacity="0.95"
      />
      {/* Folded corner */}
      <path
        d="M30 12v5a1 1 0 001 1h5l-6-6z"
        fill="white"
        fillOpacity="0.6"
      />
      {/* Audio waveform bars */}
      <rect x="16" y="17" width="2" height="6" rx="1" fill="var(--color-accent)" />
      <rect x="20" y="15" width="2" height="10" rx="1" fill="var(--color-accent)" />
      <rect x="24" y="16" width="2" height="8" rx="1" fill="var(--color-accent)" />
      <rect x="28" y="18" width="2" height="4" rx="1" fill="var(--color-accent)" />
      {/* 67 text */}
      <text
        x="24"
        y="34"
        fontFamily="-apple-system, BlinkMacSystemFont, system-ui, sans-serif"
        fontSize="12"
        fontWeight="700"
        textAnchor="middle"
        fill="var(--color-accent)"
      >
        67
      </text>
    </svg>
  );
}

interface LogoWithWordmarkProps {
  className?: string;
}

/**
 * Note67 logo with "Note67" wordmark
 */
export function LogoWithWordmark({ className }: LogoWithWordmarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 180 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Icon */}
      <rect x="2" y="4" width="40" height="40" rx="10" fill="var(--color-accent)" />
      <path
        d="M12 12h14l6 6v16a1.5 1.5 0 01-1.5 1.5h-17A1.5 1.5 0 0112 34V13.5A1.5 1.5 0 0113.5 12z"
        fill="white"
        fillOpacity="0.95"
      />
      <path
        d="M26 12v5a1 1 0 001 1h5l-6-6z"
        fill="white"
        fillOpacity="0.6"
      />
      {/* Audio waveform bars */}
      <rect x="14" y="16" width="1.5" height="5" rx="0.75" fill="var(--color-accent)" />
      <rect x="17" y="14" width="1.5" height="9" rx="0.75" fill="var(--color-accent)" />
      <rect x="20" y="15" width="1.5" height="7" rx="0.75" fill="var(--color-accent)" />
      <rect x="23" y="16.5" width="1.5" height="4" rx="0.75" fill="var(--color-accent)" />
      {/* 67 text in icon */}
      <text
        x="22"
        y="32"
        fontFamily="-apple-system, BlinkMacSystemFont, system-ui, sans-serif"
        fontSize="14"
        fontWeight="700"
        textAnchor="middle"
        fill="var(--color-accent)"
      >
        67
      </text>

      {/* Wordmark */}
      <text
        x="52"
        y="34"
        fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif"
        fontSize="28"
        fontWeight="600"
        letterSpacing="-0.5"
        fill="var(--color-text)"
      >
        Note
      </text>
      <text
        x="112.5"
        y="34"
        fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif"
        fontSize="28"
        fontWeight="600"
        letterSpacing="-0.5"
        fill="var(--color-accent)"
      >
        67
      </text>
    </svg>
  );
}
