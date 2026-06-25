import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'default' | 'secondary' | 'destructive' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
}

export default function Button({
  variant = 'default',
  size = 'md',
  leadingIcon,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps): ReactNode {
  const classes = [
    'ik-btn',
    `ik-btn-${variant}`,
    `ik-btn-size-${size}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <button type={type} className={classes} {...props}>
      {leadingIcon && <span className="ik-btn-leading-icon" aria-hidden="true">{leadingIcon}</span>}
      {children}
    </button>
  );
}
