import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { PropsWithChildren, ReactNode } from 'react';
import clsx from 'clsx';

export function cn(...args: Array<string | false | null | undefined>): string {
  return clsx(args);
}

export function Button(
  props: PropsWithChildren<{
    onClick?: () => void;
    className?: string;
    variant?: 'default' | 'primary' | 'ghost';
    title?: string;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
  }>,
) {
  return (
    <button
      type={props.type ?? 'button'}
      onClick={props.onClick}
      className={cn('wb-button', props.className, props.disabled && 'opacity-50 cursor-not-allowed')}
      data-variant={props.variant === 'default' ? undefined : props.variant}
      title={props.title}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

export function Panel(props: PropsWithChildren<{ className?: string; title?: ReactNode; headerRight?: ReactNode }>) {
  return (
    <section className={cn('wb-panel rounded-2xl', props.className)}>
      {(props.title || props.headerRight) && (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--wb-border-muted)] px-4 py-3">
          <div className="text-sm font-semibold tracking-wide text-[var(--wb-text)]">{props.title}</div>
          {props.headerRight ? <div className="flex items-center gap-2">{props.headerRight}</div> : null}
        </div>
      )}
      <div className="min-h-0">{props.children}</div>
    </section>
  );
}

export function FieldLabel(props: PropsWithChildren<{ className?: string }>) {
  return <label className={cn('mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--wb-muted)]', props.className)}>{props.children}</label>;
}

export function ChipButton(
  props: PropsWithChildren<{
    active?: boolean;
    disabled?: boolean;
    onClick?: () => void;
    className?: string;
    title?: string;
  }>,
) {
  return (
    <button
      type="button"
      className={cn('wb-chip', props.className, props.disabled && 'opacity-50 cursor-not-allowed')}
      data-active={props.active ? 'true' : 'false'}
      onClick={props.disabled ? undefined : props.onClick}
      title={props.title}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

export function KpiTile(props: { label: string; value: string | number; delta?: number | null; className?: string; valueClassName?: string }) {
  const delta = props.delta;
  const deltaClass =
    delta == null ? '' : delta > 0 ? 'wb-text-success' : delta < 0 ? 'wb-text-danger' : 'text-[var(--wb-muted)]';
  return (
    <div className={cn('wb-card p-3', props.className)}>
      <div className="text-[11px] uppercase tracking-wide text-[var(--wb-muted)]">{props.label}</div>
      <div className={cn('mt-1 text-lg font-semibold', props.valueClassName)}>{props.value}</div>
      {delta != null ? (
        <div className={cn('mt-1 text-xs', deltaClass)}>
          {delta > 0 ? '+' : ''}
          {Math.round(delta)}
        </div>
      ) : null}
    </div>
  );
}

export function ScrollArea(props: PropsWithChildren<{ className?: string }>) {
  return <div className={cn('wb-scrollbar min-h-0 overflow-auto', props.className)}>{props.children}</div>;
}

export function Modal(props: PropsWithChildren<{ open: boolean; onOpenChange(open: boolean): void; title: string; description?: string; footer?: ReactNode; className?: string }>) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 backdrop-blur-sm" style={{ background: 'var(--wb-overlay)' }} />
        <Dialog.Content
          className={cn(
            'wb-panel fixed left-1/2 top-1/2 z-50 w-[min(95vw,1100px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl shadow-2xl',
            props.className,
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--wb-border-muted)] px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold">{props.title}</Dialog.Title>
              {props.description ? (
                <Dialog.Description className="mt-1 text-sm text-[var(--wb-muted)]">
                  {props.description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <button className="wb-icon-button" aria-label="Close">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          <div className="max-h-[70vh] overflow-auto px-5 py-4">{props.children}</div>
          {props.footer ? <div className="border-t border-[var(--wb-border-muted)] px-5 py-4">{props.footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function NumberField(props: {
  label: string;
  value: number | null | undefined;
  onChange(value: number | null): void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}) {
  return (
    <div>
      <FieldLabel>{props.label}</FieldLabel>
      <input
        className="wb-input"
        type="number"
        value={props.value ?? ''}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        placeholder={props.placeholder}
        onChange={(e) => {
          const raw = e.target.value.trim();
          props.onChange(raw === '' ? null : Number(raw));
        }}
      />
    </div>
  );
}
