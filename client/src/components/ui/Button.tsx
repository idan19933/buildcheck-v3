import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  iconPosition?: 'start' | 'end';
}

const variants: Record<Variant, string> = {
  primary:   'bg-brand text-white hover:bg-brand-dark shadow-sm',
  secondary: 'bg-surface-muted text-text hover:bg-border',
  ghost:     'text-text hover:bg-surface-muted',
  danger:    'bg-danger text-white hover:opacity-90',
  outline:   'border border-border-strong text-text hover:bg-surface-muted',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-base gap-2',
  lg: 'h-12 px-6 text-lg gap-2',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', loading, icon, iconPosition = 'start',
    className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-medium rounded-md',
        'transition-colors duration-fast focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
        'disabled:opacity-50 disabled:pointer-events-none',
        variants[variant], sizes[size], className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {!loading && icon && iconPosition === 'start' && icon}
      {children}
      {!loading && icon && iconPosition === 'end' && icon}
    </button>
  );
});
