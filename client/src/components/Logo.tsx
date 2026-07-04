interface LogoProps {
  /** Pixel size for both width and height. Omit to size via className. */
  size?: number;
  className?: string;
  /** Accessible label; set to '' to mark decorative when paired with text. */
  title?: string;
}

/**
 * The Havnn brand mark: an open ring with a centered dot. Drawn with
 * `currentColor`, so it takes the surrounding text color (white on the accent
 * chip, ink elsewhere).
 */
export function Logo({ size, className, title = 'Havnn' }: LogoProps) {
  return (
    <svg
      viewBox="0 0 240 240"
      width={size}
      height={size}
      className={className}
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    >
      <path
        d="M164 196.2A88 88 0 1 1 196.2 164"
        fill="none"
        stroke="currentColor"
        strokeWidth={14}
        strokeLinecap="round"
      />
      <circle cx="120" cy="115" r="24" fill="currentColor" />
    </svg>
  );
}
