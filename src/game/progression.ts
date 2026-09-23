import { ALL_ITEM_IDS, MAX_ITEM_LEVEL, isWeaponId, type ItemId } from './items';
import type { Inventory } from './inventory';

export const FUSION_INTERVAL = 5;
export const OFFER_COUNT = 3;

/** レベル L から L+1 に必要な経験値 */
export function xpToNext(level: number): number {
  const l = level - 1;
  return Math.round(5 + l * 4.2 + l * l * 0.3);
}

export function isFusionLevel(level: number): boolean {
  return level > 1 && level % FUSION_INTERVAL === 0;
}

export type Offer =
  | { type: 'new'; itemId: ItemId }
  | { type: 'upgrade'; itemId: ItemId; toLevel: number }
  | { type: 'heal' }
  | { type: 'score' };

/** レベルアップ時の 3 択。未所持アイテムの新規入手と所持アイテムの強化から重み付きで重複なく選ぶ */
export function rollOffers(inv: Inventory, rng: () => number = Math.random, count = OFFER_COUNT): Offer[] {
  const pool: { offer: Offer; weight: number }[] = [];
  const weaponCount = inv.weapons.length;
  for (const id of ALL_ITEM_IDS) {
    const owned = inv.get(id);
    if (owned) {
      if (owned.level < MAX_ITEM_LEVEL) pool.push({ offer: { type: 'upgrade', itemId: id, toLevel: owned.level + 1 }, weight: 1.3 });
    } else {
      // 序盤は攻撃手段が増えるよう新しい武器を出やすくする
      const weight = isWeaponId(id) && weaponCount < 3 ? 1.4 : 1;
      pool.push({ offer: { type: 'new', itemId: id }, weight });
    }
  }

  const picked: Offer[] = [];
  while (picked.length < count && pool.length > 0) {
    const total = pool.reduce((s, p) => s + p.weight, 0);
    let r = rng() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r < 0) {
        idx = i;
        break;
      }
    }
    picked.push(pool[idx].offer);
    pool.splice(idx, 1);
  }
  const fillers: Offer[] = [{ type: 'heal' }, { type: 'score' }];
  while (picked.length < count && fillers.length > 0) picked.push(fillers.shift() as Offer);
  return picked;
}
