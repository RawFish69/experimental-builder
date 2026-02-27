import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Lock, Pin, Plus } from 'lucide-react';
import type { NormalizedItem } from '@/domain/items/types';
import { formatNumericIdLabel } from '@/domain/items/numeric-id-labels';
import { Button, cn } from '@/components/ui';

export type DragSourceKind = 'search' | 'bin' | 'slot';

export interface DragItemData {
  kind: DragSourceKind;
  itemId: number;
  sourceCategory?: string;
  sourceSlot?: string;
}

const ITEM_SPRITE_POSITIONS: Record<string, string> = {
  bow: '0 0',
  spear: '9.090909090909088% 0',
  wand: '18.181818181818183% 0',
  dagger: '27.27272727272727% 0',
  relik: '36.36363636363637% 0',
  helmet: '45.45454545454546% 0',
  chestplate: '54.54545454545454% 0',
  leggings: '63.63636363636363% 0',
  boots: '72.72727272727272% 0',
  ring: '81.81818181818181% 0',
  bracelet: '90.90909090909092% 0',
  necklace: '100% 0',
};

function itemSpriteKey(item: NormalizedItem): string {
  if (item.category === 'weapon') return item.type;
  return item.category;
}

function ItemTypeIcon(props: { item: NormalizedItem }) {
  const key = itemSpriteKey(props.item);
  const backgroundPosition = ITEM_SPRITE_POSITIONS[key];
  const spriteUrl = `${import.meta.env.BASE_URL}media/items/new.png`;

  if (!backgroundPosition) {
    return (
      <div className="wb-surface-strong flex h-9 w-9 items-center justify-center rounded-lg text-xs text-[var(--wb-muted)]">
        ?
      </div>
    );
  }

  return (
    <div
      className="wb-surface-strong relative h-9 w-9 shrink-0 overflow-hidden rounded-lg"
      title={`${props.item.type} icon`}
    >
      <div
        aria-hidden
        className="absolute inset-[3px] rounded-[6px]"
        style={{
          backgroundImage: `url(${spriteUrl})`,
          backgroundPosition,
          backgroundSize: '1200% 100%',
          backgroundRepeat: 'no-repeat',
          imageRendering: 'pixelated',
        }}
      />
    </div>
  );
}

function tierColor(tier: string): string {
  switch (tier) {
    case 'Mythic':
      return 'wb-tier-mythic';
    case 'Fabled':
      return 'wb-tier-fabled';
    case 'Legendary':
      return 'wb-tier-legendary';
    case 'Rare':
      return 'wb-tier-rare';
    case 'Unique':
      return 'wb-tier-unique';
    case 'Set':
      return 'wb-tier-set';
    default:
      return 'wb-tier-normal';
  }
}

function formatReqSummary(item: NormalizedItem): string | null {
  const reqs = [
    { label: 'Strength', value: item.numeric.reqStr },
    { label: 'Dexterity', value: item.numeric.reqDex },
    { label: 'Intelligence', value: item.numeric.reqInt },
    { label: 'Defense', value: item.numeric.reqDef },
    { label: 'Agility', value: item.numeric.reqAgi },
  ].filter((entry) => entry.value > 0);
  if (reqs.length === 0) return null;
  return reqs.map((entry) => `${entry.label} ${entry.value}`).join(', ');
}

function formatBonusSummary(item: NormalizedItem): string | null {
  const bonuses = [
    { label: 'Strength', value: item.numeric.spStr },
    { label: 'Dexterity', value: item.numeric.spDex },
    { label: 'Intelligence', value: item.numeric.spInt },
    { label: 'Defense', value: item.numeric.spDef },
    { label: 'Agility', value: item.numeric.spAgi },
  ].filter((entry) => entry.value !== 0);
  if (bonuses.length === 0) return null;
  return bonuses.map((entry) => `${entry.label} ${entry.value > 0 ? '+' : ''}${entry.value}`).join(', ');
}

function formatDamageLines(item: NormalizedItem): string | null {
  const raw = item.legacyRaw;
  const pairs = [
    ['Neutral', typeof raw.nDam === 'string' ? raw.nDam : ''],
    ['Earth', typeof raw.eDam === 'string' ? raw.eDam : ''],
    ['Thunder', typeof raw.tDam === 'string' ? raw.tDam : ''],
    ['Water', typeof raw.wDam === 'string' ? raw.wDam : ''],
    ['Fire', typeof raw.fDam === 'string' ? raw.fDam : ''],
    ['Air', typeof raw.aDam === 'string' ? raw.aDam : ''],
  ].filter(([, value]) => value && value !== '0-0');
  if (pairs.length === 0) return null;
  return pairs.map(([label, value]) => `${label}: ${value}`).join('  ');
}

/** IDs to exclude from chips (shown once at top: Req + SP) or derived/aggregate */
const EXCLUDED_ID_CHIPS = new Set([
  'reqTotal', 'skillPointTotal', 'offenseScore', 'ehpProxy', 'utilityScore', 'sumSpPct', 'sumSpRaw',
  'strReq', 'dexReq', 'intReq', 'defReq', 'agiReq',  // Req shown at top
  'str', 'dex', 'int', 'def', 'agi',                  // SP bonus shown at top
]);

/** All identifications with non-zero values, sorted by label. */
function allIdentifications(item: NormalizedItem): Array<{ key: string; value: number }> {
  const entries: Array<{ key: string; value: number }> = [];
  for (const [key, value] of Object.entries(item.numericIndex)) {
    if (EXCLUDED_ID_CHIPS.has(key)) continue;
    const num = typeof value === 'number' ? value : 0;
    if (num !== 0) entries.push({ key, value: num });
  }
  if (item.powderSlots > 0 && !entries.some((e) => e.key === 'slots')) {
    entries.push({ key: 'slots', value: item.powderSlots });
  }
  entries.sort((a, b) => formatNumericIdLabel(a.key).localeCompare(formatNumericIdLabel(b.key)));
  return entries;
}

function formatIdValue(_key: string, value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, '');
}

function idChipTone(value: number): 'positive' | 'negative' | 'neutral' {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}

/** Renders full item stats (req, bonus, all IDs, damage, major IDs, rough scores). Use in hover popovers or detail panels. */
export function ItemDetailStats(props: { item: NormalizedItem; dense?: boolean }) {
  const { item } = props;
  const reqSummary = formatReqSummary(item);
  const bonusSummary = formatBonusSummary(item);
  const damageSummary = formatDamageLines(item);
  const ids = allIdentifications(item);
  const dense = props.dense ?? false;

  return (
    <div className={cn('space-y-1.5', dense ? 'text-[11px]' : 'text-xs')}>
      {(reqSummary || bonusSummary) && (
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {reqSummary ? (
            <span className="wb-pill" data-tone="req">
              <span className="font-semibold">Req</span>
              <span className="ml-1">{reqSummary}</span>
            </span>
          ) : null}
          {bonusSummary ? (
            <span className="wb-pill" data-tone="bonus">
              <span className="font-semibold">SP</span>
              <span className="ml-1">{bonusSummary}</span>
            </span>
          ) : null}
        </div>
      )}
      {ids.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {ids.map(({ key, value }) => {
            return (
              <span key={key} className="wb-pill text-[11px]" data-tone={idChipTone(value)}>
                <span className={cn((value > 0 || value < 0) && 'font-semibold')}>{formatIdValue(key, value)}</span>
                <span className="ml-1 opacity-90">{formatNumericIdLabel(key)}</span>
              </span>
            );
          })}
        </div>
      ) : null}
      {damageSummary ? (
        <div className="wb-surface-strong flex flex-wrap gap-1.5 rounded px-2 py-1.5 text-[11px] leading-relaxed text-[var(--wb-muted)]">
          {damageSummary.split(/\s{2,}/).map((part, i) => (
            <span key={i} className="whitespace-nowrap">{part}</span>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="wb-surface-strong rounded px-2 py-1">{formatNumericIdLabel('baseDps')} {Math.round(item.roughScoreFields.baseDps)}</div>
        <div className="wb-surface-strong rounded px-2 py-1">{formatNumericIdLabel('ehpProxy')} {Math.round(item.roughScoreFields.ehpProxy)}</div>
        <div className="wb-surface-strong rounded px-2 py-1">{formatNumericIdLabel('offenseScore')} {Math.round(item.roughScoreFields.offense)}</div>
        <div className="wb-surface-strong rounded px-2 py-1">{formatNumericIdLabel('skillPointTotal')} {Math.round(item.roughScoreFields.skillPointTotal)}</div>
      </div>
      {item.majorIds.length > 0 ? (
        <div className="break-words text-[var(--wb-muted)]">Major IDs: {item.majorIds.join(', ')}</div>
      ) : null}
    </div>
  );
}

export function ItemCard(props: {
  item: NormalizedItem;
  compact?: boolean;
  dense?: boolean;
  showDetails?: boolean;
  dragData?: DragItemData;
  onPin?: () => void;
  onEquip?: () => void;
  onHover?: (hovering: boolean) => void;
  onRemove?: () => void;
  locked?: boolean;
  badge?: string;
}) {
  const draggable = useDraggable({
    id: props.dragData ? `drag:${props.dragData.kind}:${props.item.id}:${props.dragData.sourceSlot ?? props.dragData.sourceCategory ?? ''}` : `item:${props.item.id}`,
    data: props.dragData ? { dragItem: props.dragData } : undefined,
  });

  const style = props.dragData
    ? {
        transform: CSS.Translate.toString(draggable.transform),
        opacity: draggable.isDragging ? 0.45 : 1,
      }
    : undefined;

  const reqSummary = props.showDetails ? formatReqSummary(props.item) : null;
  const bonusSummary = props.showDetails ? formatBonusSummary(props.item) : null;
  const damageSummary = props.showDetails ? formatDamageLines(props.item) : null;
  const ids = props.showDetails ? allIdentifications(props.item) : [];

  return (
    <div
      ref={props.dragData ? draggable.setNodeRef : undefined}
      style={style}
      className={cn('wb-card', props.dense ? 'p-2' : props.compact ? 'p-2.5' : 'p-3', draggable.isDragging && 'ring-2 ring-[var(--wb-success-border)]')}
      onMouseEnter={() => props.onHover?.(true)}
      onMouseLeave={() => props.onHover?.(false)}
    >
      <div className={cn('flex items-start gap-2', props.dense && 'gap-1.5')}>
        {props.dragData ? (
          <button
            type="button"
            {...draggable.listeners}
            {...draggable.attributes}
            className="wb-icon-button mt-0.5"
            aria-label={`Drag ${props.item.displayName}`}
          >
            <GripVertical size={14} />
          </button>
        ) : null}
        <ItemTypeIcon item={props.item} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1">
            <div className={cn('break-words text-sm font-semibold leading-tight', tierColor(props.item.tier))}>{props.item.displayName}</div>
            {props.badge ? <span className="wb-chip">{props.badge}</span> : null}
            {props.locked ? (
              <span className="wb-chip inline-flex items-center gap-1">
                <Lock size={11} /> Locked
              </span>
            ) : null}
          </div>
          <div className={cn('mt-1 flex flex-wrap gap-y-1 text-[var(--wb-muted)]', props.dense ? 'gap-x-2 text-xs' : 'gap-x-3 text-xs')}>
            <span>{props.item.type}</span>
            <span>Lv {props.item.level}</span>
            {!props.dense ? <span>{props.item.tier}</span> : null}
            {!props.dense && props.item.classReq ? <span>{props.item.classReq}</span> : null}
            {!props.dense && props.item.majorIds.length > 0 ? <span>MID {props.item.majorIds.length}</span> : null}
            {props.dense && props.item.majorIds.length > 0 ? <span>M{props.item.majorIds.length}</span> : null}
          </div>
          {props.showDetails ? (
            <div className={cn('mt-2 space-y-1', props.dense ? 'text-[11px]' : 'text-xs')}>
              {(reqSummary || bonusSummary) && (
                <div className="flex flex-wrap gap-1.5">
                  {reqSummary ? (
                    <span className="wb-pill" data-tone="req">
                      <span className="font-semibold">Req</span>
                      <span className="ml-1">{reqSummary}</span>
                    </span>
                  ) : null}
                  {bonusSummary ? (
                    <span className="wb-pill" data-tone="bonus">
                      <span className="font-semibold">SP</span>
                      <span className="ml-1">{bonusSummary}</span>
                    </span>
                  ) : null}
                </div>
              )}
              {ids.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {ids.map(({ key, value }) => {
                    return (
                      <span key={key} className="wb-pill text-[11px]" data-tone={idChipTone(value)}>
                        <span className={cn((value > 0 || value < 0) && 'font-semibold')}>{formatIdValue(key, value)}</span>
                        <span className="ml-1 opacity-90">{formatNumericIdLabel(key)}</span>
                      </span>
                    );
                  })}
                </div>
              ) : null}
              {damageSummary ? (
                <div className="wb-surface-strong flex flex-wrap gap-1.5 rounded px-2 py-1.5 text-[11px] leading-relaxed text-[var(--wb-muted)]">
                  {damageSummary.split(/\s{2,}/).map((part, i) => (
                    <span key={i} className="whitespace-nowrap">{part}</span>
                  ))}
                </div>
              ) : null}
              {props.item.majorIds.length > 0 ? (
                <div className="break-words text-[var(--wb-muted)]">Major IDs: {props.item.majorIds.join(', ')}</div>
              ) : null}
            </div>
          ) : null}
          {!props.compact ? (
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="wb-surface-strong rounded-lg px-2 py-1">
                {formatNumericIdLabel('baseDps')} {Math.round(props.item.roughScoreFields.baseDps)}
              </div>
              <div className="wb-surface-strong rounded-lg px-2 py-1">
                {formatNumericIdLabel('ehpProxy')} {Math.round(props.item.roughScoreFields.ehpProxy)}
              </div>
              <div className="wb-surface-strong rounded-lg px-2 py-1">
                {formatNumericIdLabel('offenseScore')} {Math.round(props.item.roughScoreFields.offense)}
              </div>
              <div className="wb-surface-strong rounded-lg px-2 py-1">
                {formatNumericIdLabel('skillPointTotal')} {Math.round(props.item.roughScoreFields.skillPointTotal)}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {(props.onPin || props.onEquip || props.onRemove) && (
        <div className={cn('mt-2 flex flex-wrap', props.dense ? 'gap-1' : 'gap-2')}>
          {props.onPin ? (
            <Button className={cn('text-xs', props.dense ? 'px-1.5 py-0.5' : 'px-2 py-1')} variant="ghost" onClick={props.onPin}>
              <Pin size={12} className="mr-1 inline" />
              Pin
            </Button>
          ) : null}
          {props.onEquip ? (
            <Button className={cn('text-xs', props.dense ? 'px-1.5 py-0.5' : 'px-2 py-1')} onClick={props.onEquip}>
              <Plus size={12} className="mr-1 inline" />
              Equip
            </Button>
          ) : null}
          {props.onRemove ? (
            <Button className={cn('text-xs', props.dense ? 'px-1.5 py-0.5' : 'px-2 py-1')} variant="ghost" onClick={props.onRemove}>
              Remove
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
