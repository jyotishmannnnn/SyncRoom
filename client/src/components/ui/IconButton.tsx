import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  danger?: boolean;
}

/** Circular control-bar button (mic, camera, share…). Always ≥44px hit area. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active = false, danger = false, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full',
        'transition-all duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50',
        danger
          ? 'bg-danger text-white hover:bg-danger/85'
          : active
            ? 'bg-accent text-onaccent hover:bg-accent-hover'
            : 'bg-surface-overlay text-ink hover:bg-line/70 border border-line',
        className,
      )}
      {...props}
    />
  );
});
