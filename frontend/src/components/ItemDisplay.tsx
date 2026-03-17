import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Lock, Pin, Plus } from 'lucide-react';
import type { NormalizedItem } from '@/domain/items/types';
import { formatNumericIdLabel } from '@/domain/items/numeric-id-labels';
import { getMajorIdDescription } from '@/domain/items/major-id-descriptions';
import { applyWeaponPowders, getArmorPowderDefenseDeltas, type PowderedDamages, type PowderedDefenses } from '@/domain/build/powder-data';
import { Button, cn } from '@/components/ui';

/* ─── Types shared across display modes ─── */

export type DragSourceKind = 'search' | 'bin' | 'slot';

export interface DragItemData {
  kind: DragSourceKind;
  itemId: number;
  sourceCategory?: string;
  sourceSlot?: string;
}

/* ─── Sprite icon ─── */

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

function spriteKey(item: NormalizedItem): string {
  return item.category === 'weapon' ? item.type : item.category;
}

export function ItemTypeIcon(props: { item: NormalizedItem; size?: number }) {
  const key = spriteKey(props.item);
  const bgPos = ITEM_SPRITE_POSITIONS[key];
  const s = props.size ?? 28;
  const spriteUrl = `${import.meta.env.BASE_URL}media/items/new.png`;

  if (!bgPos) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded bg-[var(--wb-layer-2)] text-[10px] text-[var(--wb-text-quaternary)]"
        style={{ width: s, height: s }}
      >
        ?
      </div>
    );
  }

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded bg-[var(--wb-layer-2)]"
      style={{ width: s, height: s }}
      title={`${props.item.type} icon`}
    >
      <div
        aria-hidden
        className="absolute inset-[2px] rounded-[3px]"
        style={{
          backgroundImage: `url(${spriteUrl})`,
          backgroundPosition: bgPos,
          backgroundSize: '1200% 100%',
          backgroundRepeat: 'no-repeat',
          imageRendering: 'pixelated',
        }}
      />
    </div>
  );
}

/* ─── Helpers ─── */

function tierClass(tier: string): string {
  switch (tier) {
    case 'Mythic': return 'wb-tier-mythic';
    case 'Fabled': return 'wb-tier-fabled';
    case 'Legendary': return 'wb-tier-legendary';
    case 'Rare': return 'wb-tier-rare';
    case 'Unique': return 'wb-tier-unique';
    case 'Set': return 'wb-tier-set';
    case 'Crafted': return 'wb-tier-crafted';
    default: return 'wb-tier-normal';
  }
}

function elemColorVar(element: string): string {
  switch (element.toLowerCase()) {
    case 'neutral': return 'var(--wb-elem-neutral)';
    case 'earth': return 'var(--wb-elem-earth)';
    case 'thunder': return 'var(--wb-elem-thunder)';
    case 'water': return 'var(--wb-elem-water)';
    case 'fire': return 'var(--wb-elem-fire)';
    case 'air': return 'var(--wb-elem-air)';
    default: return 'var(--wb-text-secondary)';
  }
}

function elemBgVar(element: string): string {
  switch (element.toLowerCase()) {
    case 'neutral': return 'var(--wb-elem-neutral-muted)';
    case 'earth': return 'var(--wb-elem-earth-muted)';
    case 'thunder': return 'var(--wb-elem-thunder-muted)';
    case 'water': return 'var(--wb-elem-water-muted)';
    case 'fire': return 'var(--wb-elem-fire-muted)';
    case 'air': return 'var(--wb-elem-air-muted)';
    default: return 'transparent';
  }
}

/* ─── Stat extraction ─── */

interface DamageLine {
  element: string;
  range: string;
}

function getDamageLines(item: NormalizedItem, powderedDmg?: PowderedDamages | null): DamageLine[] {
  if (powderedDmg) {
    const pairs: [string, { min: number; max: number }][] = [
      ['Neutral', powderedDmg.neutral],
      ['Earth', powderedDmg.earth],
      ['Thunder', powderedDmg.thunder],
      ['Water', powderedDmg.water],
      ['Fire', powderedDmg.fire],
      ['Air', powderedDmg.air],
    ];
    return pairs
      .filter(([, v]) => v.max > 0)
      .map(([element, v]) => ({ element, range: `${v.min}-${v.max}` }));
  }
  const raw = item.legacyRaw;
  const pairs: [string, string][] = [
    ['Neutral', typeof raw.nDam === 'string' ? raw.nDam : ''],
    ['Earth', typeof raw.eDam === 'string' ? raw.eDam : ''],
    ['Thunder', typeof raw.tDam === 'string' ? raw.tDam : ''],
    ['Water', typeof raw.wDam === 'string' ? raw.wDam : ''],
    ['Fire', typeof raw.fDam === 'string' ? raw.fDam : ''],
    ['Air', typeof raw.aDam === 'string' ? raw.aDam : ''],
  ];
  return pairs
    .filter(([, v]) => v && v !== '0-0')
    .map(([element, range]) => ({ element, range }));
}

function computePowderedDamages(item: NormalizedItem, powderIds: number[]): PowderedDamages | null {
  if (powderIds.length === 0) return null;
  const isWeapon = ['wand', 'spear', 'bow', 'dagger', 'relik'].includes(item.type.toLowerCase());
  if (!isWeapon) return null;
  return applyWeaponPowders(item.legacyRaw, powderIds);
}

function computePowderedDefenses(item: NormalizedItem, powderIds: number[]): PowderedDefenses | null {
  if (powderIds.length === 0) return null;
  const isWeapon = ['wand', 'spear', 'bow', 'dagger', 'relik'].includes(item.type.toLowerCase());
  if (isWeapon) return null;
  return getArmorPowderDefenseDeltas(powderIds);
}

interface ReqEntry { label: string; short: string; value: number }

function getRequirements(item: NormalizedItem): ReqEntry[] {
  return [
    { label: 'Strength', short: 'Str', value: item.numeric.reqStr },
    { label: 'Dexterity', short: 'Dex', value: item.numeric.reqDex },
    { label: 'Intelligence', short: 'Int', value: item.numeric.reqInt },
    { label: 'Defense', short: 'Def', value: item.numeric.reqDef },
    { label: 'Agility', short: 'Agi', value: item.numeric.reqAgi },
  ].filter((e) => e.value > 0);
}

interface SpBonus { label: string; short: string; value: number }

function getSpBonuses(item: NormalizedItem): SpBonus[] {
  return [
    { label: 'Strength', short: 'Str', value: item.numeric.spStr },
    { label: 'Dexterity', short: 'Dex', value: item.numeric.spDex },
    { label: 'Intelligence', short: 'Int', value: item.numeric.spInt },
    { label: 'Defense', short: 'Def', value: item.numeric.spDef },
    { label: 'Agility', short: 'Agi', value: item.numeric.spAgi },
  ].filter((e) => e.value !== 0);
}

const EXCLUDED_ID_KEYS = new Set([
  'reqTotal', 'skillPointTotal', 'offenseScore', 'ehpProxy', 'utilityScore', 'sumSpPct', 'sumSpRaw',
  'strReq', 'dexReq', 'intReq', 'defReq', 'agiReq',
  'str', 'dex', 'int', 'def', 'agi',
  'lvl', 'slots', 'averageDps',
]);

interface IdEntry { key: string; value: number; label: string }

function getIdentifications(item: NormalizedItem): IdEntry[] {
  const entries: IdEntry[] = [];
  for (const [key, value] of Object.entries(item.numericIndex)) {
    if (EXCLUDED_ID_KEYS.has(key)) continue;
    const num = typeof value === 'number' ? value : 0;
    if (num !== 0) entries.push({ key, value: num, label: formatNumericIdLabel(key) });
  }
  entries.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return entries;
}

const DEF_KEY_MAP: Record<string, keyof PowderedDefenses> = {
  eDef: 'earth', tDef: 'thunder', wDef: 'water', fDef: 'fire', aDef: 'air',
};

function getDefDelta(idKey: string, powderedDef: PowderedDefenses): number {
  const elem = DEF_KEY_MAP[idKey];
  return elem ? powderedDef[elem] : 0;
}

function fmtIdValue(value: number): string {
  const prefix = value > 0 ? '+' : '';
  if (Number.isInteger(value)) return `${prefix}${value}`;
  return `${prefix}${value.toFixed(1).replace(/\.0$/, '')}`;
}

/* ─── ItemRow (compact, for search result lists) ─── */

export function ItemRow(props: {
  item: NormalizedItem;
  dragData?: DragItemData;
  onPin?: () => void;
  onEquip?: () => void;
  onHover?: (hovering: boolean) => void;
  onRemove?: () => void;
  locked?: boolean;
  badge?: string;
}) {
  const draggable = useDraggable({
    id: props.dragData
      ? `drag:${props.dragData.kind}:${props.item.id}:${props.dragData.sourceSlot ?? props.dragData.sourceCategory ?? ''}`
      : `item:${props.item.id}`,
    data: props.dragData ? { dragItem: props.dragData } : undefined,
  });

  const style = props.dragData
    ? { transform: CSS.Translate.toString(draggable.transform), opacity: draggable.isDragging ? 0.45 : 1 }
    : undefined;

  const topIds = getIdentifications(props.item).slice(0, 3);

  return (
    <div
      ref={props.dragData ? draggable.setNodeRef : undefined}
      style={style}
      className={cn(
        'group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-[var(--wb-border)] hover:bg-[var(--wb-layer-1)]',
        draggable.isDragging && 'ring-1 ring-[var(--wb-accent-border)]',
      )}
      onMouseEnter={() => props.onHover?.(true)}
      onMouseLeave={() => props.onHover?.(false)}
    >
      {props.dragData && (
        <button
          type="button"
          {...draggable.listeners}
          {...draggable.attributes}
          className="wb-icon-button shrink-0 border-transparent p-0.5 opacity-0 group-hover:opacity-100"
          aria-label={`Drag ${props.item.displayName}`}
        >
          <GripVertical size={12} />
        </button>
      )}
      <ItemTypeIcon item={props.item} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn('truncate text-sm font-semibold leading-tight', tierClass(props.item.tier))}>
            {props.item.displayName}
          </span>
          {props.badge && <span className="wb-chip text-[10px]">{props.badge}</span>}
          {props.locked && (
            <Lock size={10} className="shrink-0 text-[var(--wb-text-quaternary)]" />
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--wb-text-tertiary)]">
          <span>{props.item.type}</span>
          <span>Lv. {props.item.level}</span>
          {topIds.map((id) => (
            <span
              key={id.key}
              style={{ color: id.value > 0 ? 'var(--wb-id-positive)' : 'var(--wb-id-negative)', fontFamily: 'var(--font-mono)' }}
            >
              {fmtIdValue(id.value)} {id.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {props.onPin && (
          <button type="button" className="wb-inline-button p-0.5" onClick={props.onPin} title="Pin">
            <Pin size={12} />
          </button>
        )}
        {props.onEquip && (
          <button type="button" className="wb-inline-button p-0.5" onClick={props.onEquip} title="Equip">
            <Plus size={12} />
          </button>
        )}
        {props.onRemove && (
          <button type="button" className="wb-inline-button p-0.5 text-[var(--wb-danger)]" onClick={props.onRemove} title="Remove">
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── ItemCard (medium density, for equipped slots and bins) ─── */

export function ItemCard(props: {
  item: NormalizedItem;
  compact?: boolean;
  showDetails?: boolean;
  dragData?: DragItemData;
  onPin?: () => void;
  onEquip?: () => void;
  onHover?: (hovering: boolean) => void;
  onRemove?: () => void;
  locked?: boolean;
  badge?: string;
  powderIds?: number[];
}) {
  const draggable = useDraggable({
    id: props.dragData
      ? `drag:${props.dragData.kind}:${props.item.id}:${props.dragData.sourceSlot ?? props.dragData.sourceCategory ?? ''}`
      : `item:${props.item.id}`,
    data: props.dragData ? { dragItem: props.dragData } : undefined,
  });

  const style = props.dragData
    ? { transform: CSS.Translate.toString(draggable.transform), opacity: draggable.isDragging ? 0.45 : 1 }
    : undefined;

  const powderedDmg = props.powderIds ? computePowderedDamages(props.item, props.powderIds) : null;
  const damages = getDamageLines(props.item, powderedDmg);
  const topIds = getIdentifications(props.item).slice(0, props.compact ? 4 : 6);

  return (
    <div
      ref={props.dragData ? draggable.setNodeRef : undefined}
      style={style}
      className={cn(
        'wb-card p-1.5',
        draggable.isDragging && 'ring-1 ring-[var(--wb-accent-border)]',
      )}
      onMouseEnter={() => props.onHover?.(true)}
      onMouseLeave={() => props.onHover?.(false)}
    >
      <div className="flex items-start gap-1.5">
        {props.dragData && (
          <button
            type="button"
            {...draggable.listeners}
            {...draggable.attributes}
            className="wb-icon-button mt-0.5 shrink-0 border-transparent p-0.5"
            aria-label={`Drag ${props.item.displayName}`}
          >
            <GripVertical size={12} />
          </button>
        )}
        <ItemTypeIcon item={props.item} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1">
            <span className={cn('text-sm font-semibold leading-tight', tierClass(props.item.tier))}>
              {props.item.displayName}
            </span>
            {props.badge && <span className="wb-chip text-[10px]">{props.badge}</span>}
            {props.locked && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--wb-text-quaternary)]">
                <Lock size={10} /> Locked
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0 text-xs text-[var(--wb-text-tertiary)]">
            <span>{props.item.type}</span>
            <span>Lv. {props.item.level}</span>
            {!props.compact && <span>{props.item.tier}</span>}
            {!props.compact && props.item.classReq && <span>{props.item.classReq}</span>}
            {props.item.majorIds.length > 0 && (
              <span
                className="cursor-help text-[var(--wb-tier-legendary)]"
                title={props.item.majorIds.map((mid) => `${mid}: ${getMajorIdDescription(mid) ?? 'Major ID'}`).join('\n')}
              >
                MID
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Damage lines with element colors */}
      {damages.length > 0 && (
        <div className="mt-1.5 grid gap-px">
          {damages.map((d) => (
            <div
              key={d.element}
              className="flex items-center justify-between rounded px-1.5 py-0.5 text-[13px]"
              style={{ background: elemBgVar(d.element), color: elemColorVar(d.element) }}
            >
              <span className="font-medium">{d.element}</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{d.range}</span>
            </div>
          ))}
        </div>
      )}

      {/* Top IDs with polarity */}
      {topIds.length > 0 && (
        <div className="mt-1.5 grid gap-px text-[13px]">
          {topIds.map((id) => (
            <div key={id.key} className="flex items-center justify-between px-1">
              <span className="text-[var(--wb-text-tertiary)]">{id.label}</span>
              <span
                className="font-medium"
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: id.value > 0 ? 'var(--wb-id-positive)' : id.value < 0 ? 'var(--wb-id-negative)' : 'var(--wb-text-secondary)',
                }}
              >
                {fmtIdValue(id.value)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Rough scores (compact grid) */}
      {!props.compact && (
        <div className="mt-1.5 grid grid-cols-2 gap-0.5 text-xs">
          <div className="rounded bg-[var(--wb-layer-2)] px-1.5 py-0.5">
            <span className="text-[var(--wb-text-quaternary)]">DPS </span>
            <span className="wb-text-offense" style={{ fontFamily: 'var(--font-mono)' }}>
              {Math.round(props.item.roughScoreFields.baseDps)}
            </span>
          </div>
          <div className="rounded bg-[var(--wb-layer-2)] px-1.5 py-0.5">
            <span className="text-[var(--wb-text-quaternary)]">EHP </span>
            <span className="wb-text-defense" style={{ fontFamily: 'var(--font-mono)' }}>
              {Math.round(props.item.roughScoreFields.ehpProxy)}
            </span>
          </div>
          <div className="rounded bg-[var(--wb-layer-2)] px-1.5 py-0.5">
            <span className="text-[var(--wb-text-quaternary)]">OFF </span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {Math.round(props.item.roughScoreFields.offense)}
            </span>
          </div>
          <div className="rounded bg-[var(--wb-layer-2)] px-1.5 py-0.5">
            <span className="text-[var(--wb-text-quaternary)]">SP </span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {Math.round(props.item.roughScoreFields.skillPointTotal)}
            </span>
          </div>
        </div>
      )}

      {/* Expanded detail (shown via showDetails prop) */}
      {props.showDetails && <ItemDetailBlock item={props.item} powderIds={props.powderIds} />}

      {/* Actions */}
      {(props.onPin || props.onEquip || props.onRemove) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {props.onPin && (
            <Button className="px-1.5 py-0.5 text-[11px]" variant="ghost" onClick={props.onPin}>
              <Pin size={10} className="mr-0.5" /> Pin
            </Button>
          )}
          {props.onEquip && (
            <Button className="px-1.5 py-0.5 text-[11px]" onClick={props.onEquip}>
              <Plus size={10} className="mr-0.5" /> Equip
            </Button>
          )}
          {props.onRemove && (
            <Button className="px-1.5 py-0.5 text-[11px]" variant="ghost" onClick={props.onRemove}>
              Remove
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── ItemDetail (full WynnBuilder-style stat block) ─── */

function DetailSpacer() {
  return <div className="my-1 h-px bg-[var(--wb-border-muted)]" />;
}

function ItemDetailBlock(props: { item: NormalizedItem; powderIds?: number[] }) {
  const { item } = props;
  const powderedDmg = props.powderIds ? computePowderedDamages(item, props.powderIds) : null;
  const powderedDef = props.powderIds ? computePowderedDefenses(item, props.powderIds) : null;
  const damages = getDamageLines(item, powderedDmg);
  const reqs = getRequirements(item);
  const spBonuses = getSpBonuses(item);
  const ids = getIdentifications(item);
  const atkSpd = item.atkSpd;

  return (
    <div className="mt-2 text-[13px]">
      {/* Attack speed */}
      {atkSpd && (
        <div className="mb-1 text-[var(--wb-text-secondary)]">
          Attack Speed: <span className="font-medium text-[var(--wb-text)]">{atkSpd}</span>
        </div>
      )}

      {/* Damage lines */}
      {damages.length > 0 && (
        <div className="grid gap-0.5">
          {damages.map((d) => (
            <div
              key={d.element}
              className="flex items-center justify-between rounded px-1.5 py-0.5"
              style={{ background: elemBgVar(d.element) }}
            >
              <span className="font-medium" style={{ color: elemColorVar(d.element) }}>{d.element} Damage</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: elemColorVar(d.element) }}>{d.range}</span>
            </div>
          ))}
        </div>
      )}

      {(damages.length > 0 || atkSpd) && <DetailSpacer />}

      {/* Requirements */}
      {reqs.length > 0 && (
        <>
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--wb-text-quaternary)]">
            Requirements
          </div>
          <div className="grid gap-0.5">
            {reqs.map((r) => (
              <div key={r.short} className="flex items-center justify-between px-1">
                <span className="text-[var(--wb-text-tertiary)]">{r.label}</span>
                <span className="text-[var(--wb-warn)]" style={{ fontFamily: 'var(--font-mono)' }}>{r.value}</span>
              </div>
            ))}
          </div>
          <DetailSpacer />
        </>
      )}

      {/* SP Bonuses */}
      {spBonuses.length > 0 && (
        <div className="grid gap-0.5">
          {spBonuses.map((sp) => (
            <div key={sp.short} className="flex items-center justify-between px-1">
              <span className="text-[var(--wb-text-tertiary)]">{sp.label}</span>
              <span
                className="font-medium"
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: sp.value > 0 ? 'var(--wb-id-positive)' : 'var(--wb-id-negative)',
                }}
              >
                {fmtIdValue(sp.value)}
              </span>
            </div>
          ))}
          <DetailSpacer />
        </div>
      )}

      {/* All IDs */}
      {ids.length > 0 && (
        <div className="grid gap-0.5">
          {ids.map((id) => {
            const defDelta = powderedDef ? getDefDelta(id.key, powderedDef) : 0;
            const effective = id.value + defDelta;
            return (
              <div key={id.key} className="flex items-center justify-between px-1">
                <span className="text-[var(--wb-text-tertiary)]">{id.label}</span>
                <span
                  className="font-medium"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    color: effective > 0 ? 'var(--wb-id-positive)' : effective < 0 ? 'var(--wb-id-negative)' : 'var(--wb-text-secondary)',
                  }}
                >
                  {fmtIdValue(effective)}
                  {defDelta !== 0 && (
                    <span className="ml-0.5 text-[10px] opacity-60">
                      ({defDelta > 0 ? '+' : ''}{defDelta})
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Powder Slots */}
      {item.powderSlots > 0 && (
        <>
          <DetailSpacer />
          <div className="flex items-center gap-1.5 px-1">
            <span className="text-[var(--wb-text-tertiary)]">Powder Slots</span>
            <div className="flex gap-0.5">
              {Array.from({ length: item.powderSlots }).map((_, i) => (
                <div key={i} className="h-2 w-2 rounded-sm border border-[var(--wb-border)] bg-[var(--wb-layer-2)]" />
              ))}
            </div>
            <span className="text-[var(--wb-text-quaternary)]" style={{ fontFamily: 'var(--font-mono)' }}>[{item.powderSlots}]</span>
          </div>
        </>
      )}

      {/* Major IDs */}
      {item.majorIds.length > 0 && (
        <>
          <DetailSpacer />
          <div className="grid gap-1 px-1">
            {item.majorIds.map((mid) => {
              const desc = getMajorIdDescription(mid);
              return (
                <div key={mid}>
                  <span className="font-semibold text-[var(--wb-tier-legendary)]">+{mid}</span>
                  {desc && (
                    <div className="mt-0.5 text-[11px] leading-snug text-[var(--wb-text-tertiary)]">{desc}</div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Full detail stats, used for hover popovers and standalone detail panels. */
export function ItemDetailStats(props: { item: NormalizedItem; powderIds?: number[] }) {
  return (
    <div>
      <div className="flex items-center gap-2 pb-1">
        <ItemTypeIcon item={props.item} size={32} />
        <div>
          <div className={cn('text-sm font-semibold', tierClass(props.item.tier))}>
            {props.item.displayName}
          </div>
          <div className="text-xs text-[var(--wb-text-tertiary)]">
            {props.item.type} &middot; Lv. {props.item.level} &middot; {props.item.tier}
            {props.item.classReq && <> &middot; {props.item.classReq}</>}
          </div>
        </div>
      </div>
      <ItemDetailBlock item={props.item} powderIds={props.powderIds} />
      <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
        <div className="rounded bg-[var(--wb-layer-2)] px-1.5 py-0.5">
          <span className="text-[var(--wb-text-quaternary)]">Base DPS </span>
          <span className="wb-text-offense" style={{ fontFamily: 'var(--font-mono)' }}>
            {Math.round(props.item.roughScoreFields.baseDps)}
          </span>
        </div>
        <div className="rounded bg-[var(--wb-layer-2)] px-1.5 py-0.5">
          <span className="text-[var(--wb-text-quaternary)]">EHP Proxy </span>
          <span className="wb-text-defense" style={{ fontFamily: 'var(--font-mono)' }}>
            {Math.round(props.item.roughScoreFields.ehpProxy)}
          </span>
        </div>
      </div>
    </div>
  );
}
