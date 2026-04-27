import type { HTMLAttributes } from 'react';

interface TruncatedTextProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  value: string;
  fallback?: string;
}

export function TruncatedText({ value, fallback = '—', title, ...rest }: TruncatedTextProps) {
  const normalized = value.trim();
  const text = normalized || fallback;
  return <span {...rest} title={title ?? text}>{text}</span>;
}
