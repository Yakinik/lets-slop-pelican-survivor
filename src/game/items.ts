import type { ElementTrait, StatTrait, TraitId } from './traits';

export type WeaponId = 'punch' | 'rocket' | 'thunder' | 'bell' | 'cyclone' | 'aqua';
export type AccessoryId = 'hachimaki' | 'gear' | 'pouch' | 'mirror' | 'magnet' | 'jersey';
export type ItemId = WeaponId | AccessoryId;
export type ItemKind = 'weapon' | 'accessory';

export const MAX_ITEM_LEVEL = 4;

/**
 * 武器の各レベルの基礎値。意味は武器ごとに少し異なる:
 * - cooldown: 発射間隔（サイクロンは同じ魚への再ヒット間隔）
 * - area: サイズ倍率（実寸は武器ごとの基準値 × area）
 * - speed: 弾速（サイクロンは角速度、アクアは飛行時間の逆数倍率）
 * - duration: 弾の寿命やビームの持続
 */
export interface WeaponLevelStats {
  damage: number;
  cooldown: number;
  amount: number;
  area: number;
  speed: number;
  pierce: number;
  duration: number;
  knockback: number;
}

export interface AccessoryEffect {
  might?: number;
  cooldown?: number;
  area?: number;
  amount?: number;
  projSpeed?: number;
  magnet?: number;
  growth?: number;
  maxHp?: number;
  regen?: number;
  moveSpeed?: number;
}

interface ItemDefBase {
  name: string;
  icon: string;
  /** 攻撃方法や効果の概要 */
  summary: string;
  /** levelText[i] はレベル i+1 になったときの内容 */
  levelText: [string, string, string, string];
}

export interface WeaponDef extends ItemDefBase {
  id: WeaponId;
  kind: 'weapon';
  trait: ElementTrait;
  levels: [WeaponLevelStats, WeaponLevelStats, WeaponLevelStats, WeaponLevelStats];
}

export interface AccessoryDef extends ItemDefBase {
  id: AccessoryId;
  kind: 'accessory';
  trait: StatTrait;
  /** 各レベルでの累計効果 */
  levels: [AccessoryEffect, AccessoryEffect, AccessoryEffect, AccessoryEffect];
}

export type ItemDef = WeaponDef | AccessoryDef;

const w = (
  damage: number, cooldown: number, amount: number, area: number,
  speed: number, pierce: number, duration: number, knockback: number,
): WeaponLevelStats => ({ damage, cooldown, amount, area, speed, pierce, duration, knockback });

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  punch: {
    id: 'punch', kind: 'weapon', name: 'ペリカンパンチ', icon: '🥊', trait: 'impact',
    summary: '最寄りの魚へボクシンググローブを撃ち出す。魚を貫通する',
    levels: [
      w(12, 0.85, 1, 1.0, 28, 1, 0.6, 6),
      w(17, 0.85, 1, 1.0, 28, 1, 0.6, 6),
      w(17, 0.72, 2, 1.0, 30, 1, 0.6, 7),
      w(24, 0.66, 2, 1.25, 32, 2, 0.65, 8),
    ],
    levelText: ['最寄りの魚へグローブを放つ（1体貫通）', 'ダメージ +5', '発射数 +1、クールダウン短縮', 'ダメージ +7、貫通 +1、サイズ +25%'],
  },
  rocket: {
    id: 'rocket', kind: 'weapon', name: 'ロケットフィスト', icon: '🚀', trait: 'blaze',
    summary: '魚を追尾する拳のミサイル。着弾すると爆発する',
    levels: [
      w(16, 2.4, 1, 1.0, 15, 0, 3, 5),
      w(16, 2.4, 2, 1.0, 15, 0, 3, 5),
      w(24, 2.4, 2, 1.25, 16, 0, 3, 6),
      w(24, 2.0, 3, 1.25, 17, 0, 3, 6),
    ],
    levelText: ['追尾ミサイル拳。着弾地点で爆発', '発射数 +1', 'ダメージ +8、爆発範囲 +25%', '発射数 +1、クールダウン短縮'],
  },
  thunder: {
    id: 'thunder', kind: 'weapon', name: 'サンダービーク', icon: '⚡', trait: 'thunder',
    summary: 'くちばしから雷のビームを放ち、直線上の魚をすべて貫く',
    levels: [
      w(22, 2.6, 1, 1.0, 1, 999, 0.35, 2),
      w(30, 2.6, 1, 1.15, 1, 999, 0.35, 2),
      w(30, 2.4, 2, 1.15, 1, 999, 0.35, 2),
      w(40, 2.1, 2, 1.3, 1, 999, 0.4, 3),
    ],
    levelText: ['直線上を貫く雷ビーム', 'ダメージ +8、太さ・長さ +15%', 'ビーム +1、クールダウン短縮', 'ダメージ +10、太さ・長さ +15%'],
  },
  bell: {
    id: 'bell', kind: 'weapon', name: 'フロストベル', icon: '🔔', trait: 'frost',
    summary: '自転車のベルを鳴らし、氷のリングを広げる。敵の弾も消す',
    levels: [
      w(14, 3.2, 1, 1.0, 16, 999, 0, 8),
      w(18, 3.2, 1, 1.15, 16, 999, 0, 8),
      w(22, 2.6, 1, 1.15, 18, 999, 0, 9),
      w(28, 2.6, 2, 1.3, 18, 999, 0, 10),
    ],
    levelText: ['周囲に広がる氷のリング。敵弾を消す', 'ダメージ +4、半径 +15%', 'ダメージ +4、クールダウン短縮', 'ダメージ +6、半径 +15%、追いリング'],
  },
  cyclone: {
    id: 'cyclone', kind: 'weapon', name: 'サイクロンウィング', icon: '🌪️', trait: 'gale',
    summary: '羽ばたきで起こした竜巻がペリカンの周りを回り続ける',
    levels: [
      w(9, 0.5, 2, 1.0, 2.8, 999, 0, 5),
      w(9, 0.5, 3, 1.0, 2.8, 999, 0, 5),
      w(13, 0.45, 3, 1.15, 3.0, 999, 0, 6),
      w(17, 0.45, 4, 1.25, 3.4, 999, 0, 6),
    ],
    levelText: ['周回する竜巻 2 本', '竜巻 +1', 'ダメージ +4、範囲 +15%', '竜巻 +1、ダメージ +4、回転速度上昇'],
  },
  aqua: {
    id: 'aqua', kind: 'weapon', name: 'アクアポーチ', icon: '💧', trait: 'aqua',
    summary: '喉袋から水爆弾を投げ、落下地点の周囲を攻撃する',
    levels: [
      w(18, 2.1, 1, 1.0, 1, 0, 0, 4),
      w(18, 2.1, 2, 1.0, 1, 0, 0, 4),
      w(25, 2.1, 2, 1.2, 1.1, 0, 0, 5),
      w(25, 1.7, 3, 1.2, 1.2, 0, 0, 5),
    ],
    levelText: ['水爆弾を投げて範囲攻撃', '発射数 +1', 'ダメージ +7、範囲 +20%', '発射数 +1、クールダウン短縮'],
  },
};

export const ACCESSORIES: Record<AccessoryId, AccessoryDef> = {
  hachimaki: {
    id: 'hachimaki', kind: 'accessory', name: '闘魂ハチマキ', icon: '💪', trait: 'might',
    summary: '攻撃力が上がる',
    levels: [{ might: 0.1 }, { might: 0.2 }, { might: 0.3 }, { might: 0.4 }],
    levelText: ['攻撃力 +10%', '攻撃力 +10%', '攻撃力 +10%', '攻撃力 +10%'],
  },
  gear: {
    id: 'gear', kind: 'accessory', name: 'クロノギア', icon: '⚙️', trait: 'haste',
    summary: '自転車のギア。クールダウンが縮み、移動も速くなる',
    levels: [
      { cooldown: 0.06, moveSpeed: 0.05 },
      { cooldown: 0.12, moveSpeed: 0.1 },
      { cooldown: 0.18, moveSpeed: 0.15 },
      { cooldown: 0.24, moveSpeed: 0.2 },
    ],
    levelText: ['クールダウン -6%、移動速度 +5%', 'クールダウン -6%、移動速度 +5%', 'クールダウン -6%、移動速度 +5%', 'クールダウン -6%、移動速度 +5%'],
  },
  pouch: {
    id: 'pouch', kind: 'accessory', name: 'ビッグポーチ', icon: '👝', trait: 'giant',
    summary: '大きな喉袋。攻撃範囲が広がる',
    levels: [{ area: 0.1 }, { area: 0.2 }, { area: 0.3 }, { area: 0.4 }],
    levelText: ['範囲 +10%', '範囲 +10%', '範囲 +10%', '範囲 +10%'],
  },
  mirror: {
    id: 'mirror', kind: 'accessory', name: 'ツインミラー', icon: '🪞', trait: 'multi',
    summary: 'バックミラー。発射数と弾速が上がる',
    levels: [
      { amount: 1 },
      { amount: 1, projSpeed: 0.15 },
      { amount: 2, projSpeed: 0.15 },
      { amount: 2, projSpeed: 0.3 },
    ],
    levelText: ['発射数 +1', '弾速 +15%', '発射数 +1', '弾速 +15%'],
  },
  magnet: {
    id: 'magnet', kind: 'accessory', name: 'マグネットヘルメット', icon: '🧲', trait: 'homing',
    summary: 'ジェムの回収範囲と経験値が増える',
    levels: [
      { magnet: 0.3, growth: 0.05 },
      { magnet: 0.6, growth: 0.1 },
      { magnet: 0.9, growth: 0.15 },
      { magnet: 1.2, growth: 0.2 },
    ],
    levelText: ['回収範囲 +30%、経験値 +5%', '回収範囲 +30%、経験値 +5%', '回収範囲 +30%、経験値 +5%', '回収範囲 +30%、経験値 +5%'],
  },
  jersey: {
    id: 'jersey', kind: 'accessory', name: 'ハートジャージ', icon: '❤️', trait: 'vamp',
    summary: 'サイクルジャージ。最大 HP と自然回復が増える',
    levels: [
      { maxHp: 20, regen: 0.3 },
      { maxHp: 40, regen: 0.6 },
      { maxHp: 60, regen: 0.9 },
      { maxHp: 80, regen: 1.2 },
    ],
    levelText: ['最大 HP +20、毎秒 0.3 回復', '最大 HP +20、毎秒 0.3 回復', '最大 HP +20、毎秒 0.3 回復', '最大 HP +20、毎秒 0.3 回復'],
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
export const ACCESSORY_IDS = Object.keys(ACCESSORIES) as AccessoryId[];
export const ALL_ITEM_IDS: ItemId[] = [...WEAPON_IDS, ...ACCESSORY_IDS];

export function itemDef(id: ItemId): ItemDef {
  return (WEAPONS as Record<string, ItemDef>)[id] ?? (ACCESSORIES as Record<string, ItemDef>)[id];
}

export function isWeaponId(id: ItemId): id is WeaponId {
  return id in WEAPONS;
}

export function itemTrait(id: ItemId): TraitId {
  return itemDef(id).trait;
}
