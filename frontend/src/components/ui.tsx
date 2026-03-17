import * as Dialog from '@radix-ui/react-dialog';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import type { PropsWithChildren, ReactNode } from 'react';
import clsx from 'clsx';

export function cn(...args: Array<string | false | null | undefined>): string {
  return clsx(args);
}

/* ─── Button ─── */

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

/* ─── Panel ─── */

export function Panel(props: PropsWithChildren<{ className?: string; title?: ReactNode; headerRight?: ReactNode }>) {
  return (
    <section className={cn('wb-panel rounded-lg', props.className)}>
      {(props.title || props.headerRight) && (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--wb-border-muted)] px-3 py-2">
          <div className="text-[13px] font-semibold text-[var(--wb-text)]">{props.title}</div>
          {props.headerRight ? <div className="flex items-center gap-1.5">{props.headerRight}</div> : null}
        </div>
      )}
      <div className="min-h-0">{props.children}</div>
    </section>
  );
}

/* ─── FieldLabel ─── */

export function FieldLabel(props: PropsWithChildren<{ className?: string }>) {
  return (
    <label className={cn('mb-0.5 block text-[11px] font-medium uppercase tracking-wider text-[var(--wb-text-quaternary)]', props.className)}>
      {props.children}
    </label>
  );
}

/* ─── ChipButton ─── */

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
      className={cn('wb-chip', props.disabled && 'wb-chip-disabled', props.className)}
      data-active={props.active ? 'true' : 'false'}
      onClick={props.disabled ? undefined : props.onClick}
      title={props.title}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

/* ─── KpiTile ─── */

export function KpiTile(props: { label: string; value: string | number; delta?: number | null; className?: string; valueClassName?: string }) {
  const delta = props.delta;
  const deltaClass =
    delta == null ? '' : delta > 0 ? 'wb-text-success' : delta < 0 ? 'wb-text-danger' : 'text-[var(--wb-text-tertiary)]';
  return (
    <div className={cn('wb-card px-2.5 py-2', props.className)}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--wb-text-quaternary)]">{props.label}</div>
      <div className={cn('mt-0.5 text-base font-semibold', props.valueClassName)} style={{ fontFamily: 'var(--font-mono)' }}>
        {props.value}
      </div>
      {delta != null ? (
        <div className={cn('mt-0.5 text-[11px]', deltaClass)} style={{ fontFamily: 'var(--font-mono)' }}>
          {delta > 0 ? '+' : ''}
          {Math.round(delta)}
        </div>
      ) : null}
    </div>
  );
}

/* ─── ScrollArea ─── */

export function ScrollArea(props: PropsWithChildren<{ className?: string }>) {
  return <div className={cn('wb-scrollbar min-h-0 overflow-auto', props.className)}>{props.children}</div>;
}

/* ─── Modal ─── */

export function Modal(props: PropsWithChildren<{ open: boolean; onOpenChange(open: boolean): void; title: string; description?: string; footer?: ReactNode; className?: string }>) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 backdrop-blur-sm" style={{ background: 'var(--wb-overlay)' }} />
        <Dialog.Content
          className={cn(
            'wb-panel fixed left-1/2 top-1/2 z-50 w-[min(95vw,1100px)] -translate-x-1/2 -translate-y-1/2 rounded-lg shadow-2xl',
            props.className,
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--wb-border-muted)] px-4 py-3">
            <div>
              <Dialog.Title className="text-sm font-semibold">{props.title}</Dialog.Title>
              {props.description ? (
                <Dialog.Description className="mt-0.5 text-[13px] text-[var(--wb-text-secondary)]">
                  {props.description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <button className="wb-icon-button" aria-label="Close">
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div className="max-h-[70vh] overflow-auto px-4 py-3">{props.children}</div>
          {props.footer ? <div className="border-t border-[var(--wb-border-muted)] px-4 py-3">{props.footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ─── NumberField ─── */

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

/* ─── Separator ─── */

export function Separator(props: { className?: string }) {
  return <div className={cn('h-px bg-[var(--wb-border-muted)]', props.className)} />;
}

/* ─── Kbd (keyboard shortcut hint) ─── */

export function Kbd(props: PropsWithChildren<{ className?: string }>) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center rounded border border-[var(--wb-border)] bg-[var(--wb-layer-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--wb-text-tertiary)]',
        props.className,
      )}
    >
      {props.children}
    </kbd>
  );
}

/* ─── Sidebar collapse toggle ─── */

export function SidebarToggle(props: { collapsed: boolean; onToggle: () => void; side: 'left' | 'right' }) {
  const Icon = props.side === 'left'
    ? (props.collapsed ? PanelLeftOpen : PanelLeftClose)
    : (props.collapsed ? PanelRightOpen : PanelRightClose);

  return (
    <button
      type="button"
      className="wb-icon-button"
      onClick={props.onToggle}
      title={props.collapsed ? 'Expand panel' : 'Collapse panel'}
    >
      <Icon size={14} />
    </button>
  );
}

/* ─── StatRow (label-value row for stats panels) ─── */

export function StatRow(props: {
  label: string;
  value: string | number;
  valueClassName?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-1 text-xs">
      <span className="text-[var(--wb-text-tertiary)]">{props.label}</span>
      <span
        className={cn('font-medium', props.valueClassName)}
        style={props.mono !== false ? { fontFamily: 'var(--font-mono)' } : undefined}
      >
        {props.value}
      </span>
    </div>
  );
}
