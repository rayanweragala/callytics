import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styles from './SearchableSelect.module.css';

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function SearchableSelect({ options, value, onChange, placeholder = 'select…', disabled = false }: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalized));
  }, [options, query]);

  const selectedOption = options.find((option) => option.value === value) || null;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, open]);

  useLayoutEffect(() => {
    if (!open || disabled) return;
    const trigger = triggerRef.current;
    if (!trigger) return;

    const updatePosition = () => {
      const rect = trigger.getBoundingClientRect();
      setDropdownStyle({
        top: rect.bottom + 8,
        left: rect.left,
        minWidth: rect.width,
      });
    };
    updatePosition();

    const observer = new ResizeObserver(updatePosition);
    observer.observe(trigger);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, disabled]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === ' ') {
        event.preventDefault();
        if (!disabled) setOpen(true);
      }
      return;
    }

    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((current) => Math.min(current + 1, Math.max(filteredOptions.length - 1, 0)));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const option = filteredOptions[highlightedIndex];
      if (option) {
        onChange(option.value);
        setOpen(false);
      }
    }
  };

  return (
    <div className={styles.container} onKeyDown={handleKeyDown} ref={containerRef}>
      <button
        className={`${styles.trigger} ${disabled ? styles.disabled : ''}`}
        onClick={() => {
          if (!disabled) setOpen((current) => !current);
        }}
        ref={triggerRef}
        type="button"
      >
        <span className={styles.triggerText}>{selectedOption?.label || placeholder}</span>
      </button>
      {open && !disabled ? (
        <div
          className={styles.dropdown}
          style={dropdownStyle ? { top: `${dropdownStyle.top}px`, left: `${dropdownStyle.left}px`, minWidth: `${dropdownStyle.minWidth}px` } : undefined}
        >
          <input
            className={styles.searchInput}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="search…"
            ref={inputRef}
            value={query}
          />
          <div className={styles.options}>
            <button className={styles.option} onClick={() => { onChange(null); setOpen(false); }} type="button">
              {placeholder}
            </button>
            {filteredOptions.map((option, index) => (
              <button
                className={`${styles.option} ${index == highlightedIndex ? styles.highlighted : ''} ${option.value === value ? styles.selected : ''}`}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                onMouseEnter={() => setHighlightedIndex(index)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
