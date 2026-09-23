import type { Effects } from '../fx/Effects';
import type { Particles } from '../fx/Particles';
import type { DamageText } from '../fx/DamageText';
import type { Sfx } from '../audio/Sfx';
import type { Player } from './Player';
import type { FishSystem, Fish } from './FishSystem';
import type { BulletSystem } from './BulletSystem';
import type { GemSystem } from './GemSystem';
import type { WeaponSystem } from './WeaponSystem';
import type { Combat } from './Combat';
import type { SpeciesId } from './fishSpecies';

/** 戦闘中の各システムが共有する参照。Game が 1 つだけ作って配る */
export interface GameContext {
  /** ゲーム内の経過秒（ポーズ中は進まない） */
  time: number;
  /** 経過時間に応じた魚の HP 倍率 */
  hpMul: number;
  /** 敵弾のダメージ倍率 */
  bulletMul: number;
  /** 画面外で魚が出現する半径（プレイヤー中心） */
  spawnRadius: number;
  player: Player;
  fish: FishSystem;
  bullets: BulletSystem;
  gems: GemSystem;
  weapons: WeaponSystem;
  combat: Combat;
  fx: Effects;
  sparks: Particles;
  puffs: Particles;
  dmgText: DamageText;
  sfx: Sfx;
  shake(amount: number): void;
  onFishKilled(f: Fish): void;
  summonRing(id: SpeciesId, count: number, radius: number, speed: number): void;
}
