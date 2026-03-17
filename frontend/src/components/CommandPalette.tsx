import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { Hammer, Link2, Search, TreePine, Utensils } from 'lucide-react';

interface CommandPaletteProps {
  onSearch: (text: string) => void;
  onOpenAutoBuilder: () => void;
  onOpenAbilityTree: () => void;
  onOpenRecipeSolver: () => void;
  onShare: () => void;
}

export function CommandPalette(props: CommandPaletteProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const runAction = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
      <div className="fixed inset-0 bg-[var(--wb-overlay)]" />
      <div className="fixed left-1/2 top-[15%] z-50 w-[min(90vw,520px)] -translate-x-1/2" onClick={(e) => e.stopPropagation()}>
        <Command
          className="overflow-hidden rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] shadow-2xl"
          label="Command palette"
        >
          <div className="flex items-center gap-2 border-b border-[var(--wb-border-muted)] px-3 py-2">
            <Search size={14} className="shrink-0 text-[var(--wb-text-tertiary)]" />
            <Command.Input
              className="flex-1 bg-transparent text-sm text-[var(--wb-text)] outline-none placeholder:text-[var(--wb-text-quaternary)]"
              placeholder="Search items, actions..."
              autoFocus
            />
            <kbd className="rounded border border-[var(--wb-border)] bg-[var(--wb-layer-2)] px-1.5 py-0.5 text-[10px] text-[var(--wb-text-quaternary)]">
              Esc
            </kbd>
          </div>
          <Command.List className="max-h-[300px] overflow-auto p-1.5 wb-scrollbar">
            <Command.Empty className="px-3 py-6 text-center text-[13px] text-[var(--wb-text-tertiary)]">
              No results found.
            </Command.Empty>

            <Command.Group heading={<span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--wb-text-quaternary)]">Actions</span>}>
              <CommandItem
                icon={<Hammer size={14} />}
                label="Open Build Solver"
                shortcut="auto-build"
                onSelect={() => runAction(props.onOpenAutoBuilder)}
              />
              <CommandItem
                icon={<TreePine size={14} />}
                label="Open Ability Tree"
                shortcut="atree"
                onSelect={() => runAction(props.onOpenAbilityTree)}
              />
              <CommandItem
                icon={<Utensils size={14} />}
                label="Open Recipe Solver"
                shortcut="craft"
                onSelect={() => runAction(props.onOpenRecipeSolver)}
              />
              <CommandItem
                icon={<Link2 size={14} />}
                label="Share Build Link"
                shortcut="share"
                onSelect={() => runAction(props.onShare)}
              />
            </Command.Group>

            <Command.Group heading={<span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--wb-text-quaternary)]">Quick search</span>}>
              <CommandItem
                icon={<Search size={14} />}
                label="Search items..."
                shortcut="type to search"
                onSelect={() => {
                  setOpen(false);
                }}
              />
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function CommandItem(props: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-[var(--wb-text-secondary)] transition-colors data-[selected=true]:bg-[var(--wb-layer-1-hover)] data-[selected=true]:text-[var(--wb-text)]"
      onSelect={props.onSelect}
    >
      <span className="shrink-0 text-[var(--wb-text-tertiary)]">{props.icon}</span>
      <span className="flex-1">{props.label}</span>
      {props.shortcut && (
        <span className="text-[10px] text-[var(--wb-text-quaternary)]">{props.shortcut}</span>
      )}
    </Command.Item>
  );
}
