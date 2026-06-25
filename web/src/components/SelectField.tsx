import * as Select from '@radix-ui/react-select';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  value?: string;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  ariaLabel?: string;
  onChange: (value: string) => void;
}

export default function SelectField({
  value,
  options,
  placeholder = '选择',
  disabled = false,
  title,
  className,
  ariaLabel,
  onChange,
}: Props) {
  return (
    <Select.Root value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <Select.Trigger
        className={`ik-select-trigger ${className ?? ''}`}
        title={title}
        aria-label={ariaLabel ?? title ?? placeholder}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="ik-select-icon">⌄</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="ik-select-content"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
        >
          <Select.ScrollUpButton className="ik-select-scroll">⌃</Select.ScrollUpButton>
          <Select.Viewport className="ik-select-viewport">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="ik-select-item"
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="ik-select-check">✓</Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="ik-select-scroll">⌄</Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
