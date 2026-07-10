import { useId, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label: string;
  options: SelectOption[];
}

export function Select({ label, options, className, id, ...props }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={selectId} className="text-sm font-medium text-ink-dim">
        {label}
      </label>
      <select
        id={selectId}
        className={cn(
          'h-11 w-full min-w-0 cursor-pointer rounded-xl border border-line bg-surface-raised px-3 text-[15px] text-ink',
          'transition-colors duration-150 focus:border-accent focus:outline-none',
          className,
        )}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
