export type SpeciesId = 'iwashi' | 'sanma' | 'aji' | 'tobiuo' | 'tai' | 'fugu' | 'kajiki' | 'ei' | 'ankou' | 'same';

/**
 * 移動の型。弾幕パターンで出現した魚は straight / spiral で飛来し、
 * 単体で出現した魚は種ごとの既定の動きをする。
 */
export type MoveKind = 'straight' | 'spiral' | 'sine' | 'homing' | 'hop' | 'dash' | 'orbit' | 'drift' | 'puff';

export interface SpeciesDef {
  id: SpeciesId;
  name: string;
  hp: number;
  speed: number;
  /** 当たり判定の半径（描画スケール 1 のとき） */
  radius: number;
  damage: number;
  /** 描画スケール */
  scale: number;
  move: MoveKind;
  turnRate: number;
  /** ドロップする経験値ジェム */
  gem: { color: string; xp: number; tier: 0 | 1 | 2 | 3 };
  knockbackResist: number;
}

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  iwashi: {
    id: 'iwashi', name: 'イワシ', hp: 7, speed: 9, radius: 0.8, damage: 5, scale: 1.9,
    move: 'homing', turnRate: 1.2, gem: { color: '#9fd8ff', xp: 1, tier: 0 }, knockbackResist: 0,
  },
  sanma: {
    id: 'sanma', name: 'サンマ', hp: 6, speed: 17, radius: 0.75, damage: 6, scale: 1.7,
    move: 'straight', turnRate: 0, gem: { color: '#8b8dff', xp: 1, tier: 0 }, knockbackResist: 0,
  },
  aji: {
    id: 'aji', name: 'アジ', hp: 13, speed: 7.5, radius: 0.95, damage: 7, scale: 1.8,
    move: 'sine', turnRate: 1.6, gem: { color: '#b8f25a', xp: 2, tier: 1 }, knockbackResist: 0.1,
  },
  tobiuo: {
    id: 'tobiuo', name: 'トビウオ', hp: 11, speed: 10, radius: 0.95, damage: 7, scale: 1.8,
    move: 'hop', turnRate: 2.5, gem: { color: '#4ff0e0', xp: 2, tier: 1 }, knockbackResist: 0.1,
  },
  tai: {
    id: 'tai', name: 'マダイ', hp: 30, speed: 6.2, radius: 1.1, damage: 10, scale: 1.7,
    move: 'homing', turnRate: 2.2, gem: { color: '#ff5f7e', xp: 4, tier: 1 }, knockbackResist: 0.3,
  },
  fugu: {
    id: 'fugu', name: 'フグ', hp: 40, speed: 4.2, radius: 1.05, damage: 12, scale: 1.6,
    move: 'puff', turnRate: 1.5, gem: { color: '#ffd23f', xp: 5, tier: 2 }, knockbackResist: 0.4,
  },
  kajiki: {
    id: 'kajiki', name: 'カジキ', hp: 48, speed: 7, radius: 1.3, damage: 16, scale: 1.35,
    move: 'dash', turnRate: 2.5, gem: { color: '#3d7bff', xp: 7, tier: 2 }, knockbackResist: 0.6,
  },
  ei: {
    id: 'ei', name: 'エイ', hp: 95, speed: 4.5, radius: 2.0, damage: 14, scale: 1.3,
    move: 'drift', turnRate: 0.4, gem: { color: '#b36bff', xp: 10, tier: 2 }, knockbackResist: 0.8,
  },
  ankou: {
    id: 'ankou', name: 'アンコウ', hp: 75, speed: 5.5, radius: 1.3, damage: 12, scale: 1.5,
    move: 'orbit', turnRate: 2, gem: { color: '#ff9a3c', xp: 9, tier: 2 }, knockbackResist: 0.6,
  },
  same: {
    id: 'same', name: 'サメ', hp: 240, speed: 8.2, radius: 1.9, damage: 22, scale: 1.3,
    move: 'homing', turnRate: 1.8, gem: { color: '#3dffb5', xp: 25, tier: 3 }, knockbackResist: 0.85,
  },
};

export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];
