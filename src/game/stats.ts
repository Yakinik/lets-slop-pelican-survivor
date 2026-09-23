import { ACCESSORIES, WEAPONS, isWeaponId, type AccessoryEffect, type AccessoryId, type WeaponId } from './items';
import type { Inventory, OwnedItem } from './inventory';
import {
  ELEMENT_TRAITS, isElement, traitMath as m,
  type ElementTrait, type StatTrait, type TraitMap,
} from './traits';

export interface PlayerStats {
  might: number;
  cooldown: number;
  area: number;
  amount: number;
  projSpeed: number;
  magnet: number;
  growth: number;
  maxHp: number;
  regen: number;
  moveSpeed: number;
}

export interface ElementProc {
  trait: ElementTrait;
  strength: number;
  chance: number;
}

/** アクセサリーに付与された属性・特性。全武器に掛かる */
export interface GlobalMods {
  /** 半分の強度に換算済み */
  statTraits: Partial<Record<StatTrait, number>>;
  procs: ElementProc[];
}

export interface WeaponStats {
  id: WeaponId;
  damage: number;
  cooldown: number;
  amount: number;
  area: number;
  speed: number;
  pierce: number;
  duration: number;
  knockback: number;
  /** 0 なら追尾しない。値は旋回速度 rad/s */
  homing: number;
  /** 射程倍率（追尾特性） */
  range: number;
  vamp: number;
  elements: Partial<Record<ElementTrait, number>>;
}

export const BASE_PLAYER_STATS: Readonly<PlayerStats> = {
  might: 1, cooldown: 1, area: 1, amount: 0, projSpeed: 1,
  magnet: 1, growth: 1, maxHp: 100, regen: 0, moveSpeed: 1,
};

/** 合成 1 回ごとのボーナス */
export const FUSION_WEAPON_DAMAGE_BONUS = 0.1;
export const FUSION_ACCESSORY_EFFECT_BONUS = 0.2;

export function computePlayerStats(inv: Inventory): { stats: PlayerStats; global: GlobalMods } {
  const stats: PlayerStats = { ...BASE_PLAYER_STATS };
  const statTraits: Partial<Record<StatTrait, number>> = {};
  const procs: ElementProc[] = [];
  let cooldownReduction = 0;

  for (const item of inv.accessories) {
    const def = ACCESSORIES[item.id as AccessoryId];
    const eff: AccessoryEffect = def.levels[item.level - 1];
    const mul = 1 + FUSION_ACCESSORY_EFFECT_BONUS * item.fusions;
    stats.might += (eff.might ?? 0) * mul;
    cooldownReduction += (eff.cooldown ?? 0) * mul;
    stats.area += (eff.area ?? 0) * mul;
    stats.amount += Math.floor((eff.amount ?? 0) * mul);
    stats.projSpeed += (eff.projSpeed ?? 0) * mul;
    stats.magnet += (eff.magnet ?? 0) * mul;
    stats.growth += (eff.growth ?? 0) * mul;
    stats.maxHp += (eff.maxHp ?? 0) * mul;
    stats.regen += (eff.regen ?? 0) * mul;
    stats.moveSpeed += (eff.moveSpeed ?? 0) * mul;

    for (const [t, s] of Object.entries(item.traits) as [keyof TraitMap, number][]) {
      if (!s) continue;
      if (isElement(t)) procs.push({ trait: t, strength: s, chance: m.procChance(s) });
      else statTraits[t] = (statTraits[t] ?? 0) + s / 2;
    }
  }
  stats.cooldown = Math.max(0.4, 1 - cooldownReduction);
  stats.maxHp = Math.round(stats.maxHp);
  return { stats, global: { statTraits, procs } };
}

/** 武器 1 つの最終性能。固有属性はその武器のレベルと同じ強度で常に乗る */
export function computeWeaponStats(item: OwnedItem, ps: PlayerStats, global: GlobalMods): WeaponStats {
  if (!isWeaponId(item.id)) throw new Error(`${item.id} is not a weapon`);
  const def = WEAPONS[item.id];
  const base = def.levels[item.level - 1];

  const stat = (t: StatTrait) => (item.traits[t] ?? 0) + (global.statTraits[t] ?? 0);
  const elements: Partial<Record<ElementTrait, number>> = {};
  for (const t of ELEMENT_TRAITS) {
    const s = (item.traits[t] ?? 0) + (t === def.trait ? item.level : 0);
    if (s > 0) elements[t] = s;
  }
  const gale = elements.gale ?? 0;
  const impact = elements.impact ?? 0;
  const homing = stat('homing');

  return {
    id: def.id,
    damage: base.damage * ps.might * (1 + FUSION_WEAPON_DAMAGE_BONUS * item.fusions) * (1 + m.mightDamage(stat('might'))),
    cooldown: base.cooldown * ps.cooldown * (1 - m.hasteCooldown(stat('haste'))),
    amount: base.amount + ps.amount + m.multiAmount(stat('multi')),
    area: base.area * ps.area * (1 + m.giantArea(stat('giant')) + m.galeArea(gale)),
    speed: base.speed * ps.projSpeed * (1 + m.homingSpeed(homing)),
    pierce: base.pierce + m.galePierce(gale),
    duration: base.duration,
    knockback: base.knockback * (1 + 0.5 * gale) + m.impactKnockback(impact),
    homing: m.homingTurn(homing),
    range: 1 + m.homingSpeed(homing),
    vamp: stat('vamp'),
    elements,
  };
}
