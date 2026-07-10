import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className, id, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-ink-dim">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={hint || error ? hintId : undefined}
        className={cn(
          'h-11 w-full min-w-0 rounded-xl border bg-surface-raised px-3.5 text-[15px] text-ink placeholder:text-ink-faint',
          'transition-colors duration-150 focus:border-accent focus:outline-none',
          error ? 'border-danger' : 'border-line',
          className,
        )}
        {...props}
      />
      {(error || hint) && (
        <p id={hintId} className={cn('text-xs', error ? 'text-danger' : 'text-ink-faint')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
});
