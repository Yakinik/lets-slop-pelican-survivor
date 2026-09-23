import { Pelican } from '../models/pelican';
import { BASE_PLAYER_STATS, type PlayerStats } from './stats';
import { PELICAN_PLAY_SCALE } from './Intro';

const BASE_SPEED = 10.5;
const ACCEL = 10;
const INVULN_TIME = 0.75;

export class Player {
  readonly pelican = new Pelican();
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  /** 進行方向。前方ベクトルは (sin yaw, cos yaw) */
  yaw = Math.PI;
  /** 最後に動いた方向（照準の既定値） */
  faceX = 0;
  faceZ = -1;
  hp = BASE_PLAYER_STATS.maxHp;
  maxHp = BASE_PLAYER_STATS.maxHp;
  invuln = 0;
  readonly hitRadius = 0.75;
  stats: PlayerStats = { ...BASE_PLAYER_STATS };
  /** デバッグ用の無敵 */
  god = false;
  private bank = 0;
  private vampBudget = 0;
  private bobT = 0;

  reset(): void {
    this.x = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.yaw = Math.PI;
    this.faceX = 0;
    this.faceZ = -1;
    this.stats = { ...BASE_PLAYER_STATS };
    this.maxHp = this.stats.maxHp;
    this.hp = this.maxHp;
    this.invuln = 0;
    this.bank = 0;
  }

  applyStats(stats: PlayerStats): void {
    const gained = stats.maxHp - this.maxHp;
    this.stats = stats;
    this.maxHp = stats.maxHp;
    if (gained > 0) this.hp += gained;
    this.hp = Math.min(this.hp, this.maxHp);
  }

  /** ダメージを受けたら true */
  hurt(amount: number): boolean {
    if (this.invuln > 0 || this.god || this.hp <= 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.invuln = INVULN_TIME;
    this.pelican.hurt();
    return true;
  }

  heal(amount: number): number {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  /** 吸収による回復。1 秒あたりの上限 cap を超えないようにする */
  lifesteal(amount: number, cap: number): void {
    const allowed = Math.max(0, cap - this.vampBudget);
    const v = Math.min(amount, allowed);
    if (v <= 0) return;
    this.vampBudget += v;
    this.heal(v);
  }

  update(dt: number, moveX: number, moveZ: number): void {
    const speed = BASE_SPEED * this.stats.moveSpeed;
    const k = 1 - Math.exp(-ACCEL * dt);
    this.vx += (moveX * speed - this.vx) * k;
    this.vz += (moveZ * speed - this.vz) * k;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    const sp = Math.hypot(this.vx, this.vz);
    if (Math.hypot(moveX, moveZ) > 0.1) {
      this.faceX = moveX;
      this.faceZ = moveZ;
      const l = Math.hypot(this.faceX, this.faceZ);
      this.faceX /= l;
      this.faceZ /= l;
    }
    let turn = 0;
    if (sp > 0.8) {
      const target = Math.atan2(this.vx, this.vz);
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      turn = d;
      this.yaw += d * Math.min(1, dt * 8);
    }
    this.bank += (Math.max(-0.6, Math.min(0.6, -turn * 1.2)) - this.bank) * Math.min(1, dt * 6);

    this.invuln = Math.max(0, this.invuln - dt);
    if (this.stats.regen > 0) this.heal(this.stats.regen * dt);

    const p = this.pelican;
    this.bobT += dt;
    p.root.position.set(this.x, Math.sin(this.bobT * 2) * 0.15, this.z);
    p.root.rotation.set(0, this.yaw, this.bank, 'YXZ');
    p.root.scale.setScalar(PELICAN_PLAY_SCALE);
    p.root.visible = this.invuln <= 0 || Math.floor(this.invuln * 16) % 2 === 0;
    p.spread = 1;
    p.flapRate = 6 + sp * 0.3;
    p.pedalRate = 7;
    p.update(dt, 3 + sp * 0.4);
  }

  /** 1 秒ごとに吸収の上限をリセットする */
  tickSecond(): void {
    this.vampBudget = 0;
  }
}
