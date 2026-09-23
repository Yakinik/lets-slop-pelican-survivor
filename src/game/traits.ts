// 属性（武器由来）と特性（アクセサリー由来）の定義と数式。
// 強度 s は「素材にしたアイテムのレベル」の合計。アクセサリー経由で全体に掛かる場合は小数になり得る。

export type ElementTrait = 'impact' | 'blaze' | 'thunder' | 'frost' | 'gale' | 'aqua';
export type StatTrait = 'might' | 'haste' | 'giant' | 'multi' | 'homing' | 'vamp';
export type TraitId = ElementTrait | StatTrait;
export type TraitMap = Partial<Record<TraitId, number>>;

export const MAX_TRAIT_STRENGTH = 8;

export const ELEMENT_TRAITS: readonly ElementTrait[] = ['impact', 'blaze', 'thunder', 'frost', 'gale', 'aqua'];
export const STAT_TRAITS: readonly StatTrait[] = ['might', 'haste', 'giant', 'multi', 'homing', 'vamp'];
export const TRAIT_ORDER: readonly TraitId[] = [...ELEMENT_TRAITS, ...STAT_TRAITS];

export const isElement = (t: TraitId): t is ElementTrait => (ELEMENT_TRAITS as readonly string[]).includes(t);

const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (v: number) => (Number.isInteger(v) ? `${v}` : v.toFixed(1));

/** 強度から効果量を求める式。戦闘処理と説明文の両方がここを参照する。 */
export const traitMath = {
  impactKnockback: (s: number) => 3 * s,
  impactStunChance: (s: number) => Math.min(0.08 * s, 0.6),
  blazeDpsRatio: (s: number) => 0.12 * s,
  thunderChains: (s: number) => 1 + Math.floor(s / 2),
  thunderRatio: (s: number) => 0.3 + 0.1 * s,
  frostSlow: (s: number) => Math.min(0.2 + 0.08 * s, 0.7),
  frostFreezeChance: (s: number) => Math.min(0.05 * s, 0.4),
  galePierce: (s: number) => Math.floor(s),
  galeArea: (s: number) => 0.08 * s,
  aquaChance: (s: number) => Math.min(0.35 + 0.1 * s, 1),
  aquaDroplets: (s: number) => 2 + Math.floor(s / 3),
  aquaRatio: (s: number) => 0.25 + 0.05 * s,
  mightDamage: (s: number) => 0.2 * s,
  hasteCooldown: (s: number) => Math.min(0.08 * s, 0.6),
  giantArea: (s: number) => 0.15 * s,
  multiAmount: (s: number) => Math.floor((s + 1) / 2),
  homingTurn: (s: number) => (s > 0 ? 3 + 1.5 * s : 0),
  homingSpeed: (s: number) => 0.1 * s,
  vampRatio: (s: number) => 0.008 * s,
  vampCapPerSec: (s: number) => 1.5 * s,
  /** アクセサリーに付与された属性が、全武器の命中時に発動する確率 */
  procChance: (s: number) => Math.min(0.12 * s, 0.6),
} as const;

export interface TraitDef {
  id: TraitId;
  name: string;
  /** 合成装備の名前の頭に付く一文字 */
  tag: string;
  color: string;
  /** 武器に付いたときの効果 */
  describe: (s: number) => string;
}

const m = traitMath;

export const TRAITS: Record<TraitId, TraitDef> = {
  impact: {
    id: 'impact', name: '衝撃', tag: '衝', color: '#ffb347',
    describe: (s) => `ノックバック +${num(m.impactKnockback(s))}、${pct(m.impactStunChance(s))}でスタン`,
  },
  blaze: {
    id: 'blaze', name: '爆炎', tag: '炎', color: '#ff5a36',
    describe: (s) => `3秒間 毎秒${pct(m.blazeDpsRatio(s))}の炎上。炎上中に倒すと爆発`,
  },
  thunder: {
    id: 'thunder', name: '雷撃', tag: '雷', color: '#ffe14d',
    describe: (s) => `周囲の${m.thunderChains(s)}体へ${pct(m.thunderRatio(s))}の連鎖雷`,
  },
  frost: {
    id: 'frost', name: '氷結', tag: '氷', color: '#7fe3ff',
    describe: (s) => `${pct(m.frostSlow(s))}減速、${pct(m.frostFreezeChance(s))}で凍結（被ダメ+25%）`,
  },
  gale: {
    id: 'gale', name: '旋風', tag: '風', color: '#b8ffcf',
    describe: (s) => `貫通 +${m.galePierce(s)}、範囲 +${pct(m.galeArea(s))}、吹き飛ばし強化`,
  },
  aqua: {
    id: 'aqua', name: '水泡', tag: '水', color: '#4da6ff',
    describe: (s) => `${pct(m.aquaChance(s))}で追尾する水滴${m.aquaDroplets(s)}個に分裂（${pct(m.aquaRatio(s))}）`,
  },
  might: {
    id: 'might', name: '剛力', tag: '剛', color: '#ff6b8b',
    describe: (s) => `ダメージ +${pct(m.mightDamage(s))}`,
  },
  haste: {
    id: 'haste', name: '迅速', tag: '速', color: '#9dff6b',
    describe: (s) => `クールダウン -${pct(m.hasteCooldown(s))}`,
  },
  giant: {
    id: 'giant', name: '巨大', tag: '巨', color: '#c69cff',
    describe: (s) => `範囲・サイズ +${pct(m.giantArea(s))}`,
  },
  multi: {
    id: 'multi', name: '多重', tag: '双', color: '#ffd1f0',
    describe: (s) => `発射数 +${m.multiAmount(s)}`,
  },
  homing: {
    id: 'homing', name: '追尾', tag: '追', color: '#8fe8ff',
    describe: (s) => `弾が敵を追尾、弾速・射程 +${pct(m.homingSpeed(s))}`,
  },
  vamp: {
    id: 'vamp', name: '吸収', tag: '吸', color: '#ff4d6d',
    describe: (s) => `与ダメージの${pct(m.vampRatio(s))}を回復（毎秒最大${num(m.vampCapPerSec(s))}）`,
  },
};

/** アクセサリーに付いたときの効果の説明 */
export function describeOnAccessory(t: TraitId, s: number): string {
  if (isElement(t)) return `全武器の命中時 ${pct(traitMath.procChance(s))}で【${TRAITS[t].name}】発動: ${TRAITS[t].describe(s)}`;
  return `全武器に半分の強度で付与: ${TRAITS[t].describe(s / 2)}`;
}

export function addTraits(into: TraitMap, from: TraitMap): TraitMap {
  for (const t of TRAIT_ORDER) {
    const v = from[t];
    if (!v) continue;
    into[t] = Math.min(MAX_TRAIT_STRENGTH, (into[t] ?? 0) + v);
  }
  return into;
}

/** 強い順（同値なら定義順）に並べた [trait, strength] の一覧 */
export function sortedTraits(map: TraitMap): [TraitId, number][] {
  return TRAIT_ORDER.filter((t) => (map[t] ?? 0) > 0)
    .map((t) => [t, map[t] as number] as [TraitId, number])
    .sort((a, b) => b[1] - a[1]);
}
