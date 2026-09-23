import * as THREE from 'three';
import { SpatialGrid } from '../core/SpatialGrid';
import { FishRenderer } from '../render/FishRenderer';
import { SPECIES, type MoveKind, type SpeciesDef, type SpeciesId } from './fishSpecies';
import type { GameContext } from './context';

export type BossId = 'kingKajiki' | 'nushiFugu' | 'megalodon';

export interface BossDef {
  id: BossId;
  name: string;
  species: SpeciesId;
  hp: number;
  scale: number;
  radius: number;
  damage: number;
  speed: number;
  xp: number;
}

export const BOSSES: Record<BossId, BossDef> = {
  kingKajiki: { id: 'kingKajiki', name: 'キングカジキ', species: 'kajiki', hp: 1400, scale: 4.2, radius: 3.4, damage: 24, speed: 10, xp: 140 },
  nushiFugu: { id: 'nushiFugu', name: 'ヌシフグ', species: 'fugu', hp: 3200, scale: 5, radius: 4.1, damage: 28, speed: 5, xp: 300 },
  megalodon: { id: 'megalodon', name: 'メガロドン', species: 'same', hp: 6500, scale: 4.4, radius: 5, damage: 34, speed: 10, xp: 600 },
};

export const MAX_FISH = 720;
/** 同じ武器が同じ魚に連続で当たれる間隔を管理するスロット数 */
export const HIT_SLOTS = 8;

export interface Fish {
  readonly index: number;
  uid: number;
  alive: boolean;
  sp: SpeciesDef;
  boss: BossDef | null;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  kbx: number;
  kbz: number;
  heading: number;
  yaw: number;
  bank: number;
  tilt: number;
  pitch: number;
  speed: number;
  hp: number;
  maxHp: number;
  radius: number;
  scale: number;
  damage: number;
  move: MoveKind;
  t: number;
  phase: number;
  state: number;
  timer: number;
  count: number;
  /** 突進のサブ状態（0 接近, 1 予兆, 2 突進, 3 減速）とそのタイマー */
  sub: number;
  subT: number;
  dirx: number;
  dirz: number;
  cx: number;
  cz: number;
  a: number;
  b: number;
  lifetime: number;
  slowT: number;
  slowAmt: number;
  freezeT: number;
  stunT: number;
  burnT: number;
  burnDps: number;
  burnTick: number;
  flash: number;
  puff: number;
  gem: boolean;
  readonly hitAt: Float32Array;
}

export interface SpawnOpts {
  move?: MoveKind;
  dirx?: number;
  dirz?: number;
  speed?: number;
  lifetime?: number;
  cx?: number;
  cz?: number;
  a?: number;
  b?: number;
  hpMul?: number;
  gem?: boolean;
}

const RED = new THREE.Color('#ff3b30');
const WARN = new THREE.Color('#ff2d55');

function turnToward(cur: number, target: number, maxStep: number): number {
  let d = target - cur;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}

export class FishSystem {
  readonly renderer = new FishRenderer({ iwashi: 320, sanma: 200, aji: 200, tobiuo: 160, tai: 160, fugu: 100, kajiki: 60, ei: 40, ankou: 60, same: 40 });
  readonly list: Fish[] = [];
  readonly bosses: Fish[] = [];
  readonly grid = new SpatialGrid(4, MAX_FISH);
  private readonly pool: Fish[] = [];
  private readonly free: number[] = [];
  private uidSeq = 1;

  constructor(private readonly ctx: GameContext) {
    for (let i = MAX_FISH - 1; i >= 0; i--) {
      this.pool[i] = this.blank(i);
      this.free.push(i);
    }
  }

  private blank(index: number): Fish {
    return {
      index, uid: 0, alive: false, sp: SPECIES.iwashi, boss: null,
      x: 0, y: 0, z: 0, vx: 0, vz: 0, kbx: 0, kbz: 0, heading: 0, yaw: 0, bank: 0, tilt: 0, pitch: 0,
      speed: 0, hp: 0, maxHp: 0, radius: 0, scale: 1, damage: 0, move: 'straight',
      t: 0, phase: 0, state: 0, timer: 0, count: 0, sub: 0, subT: 0, dirx: 0, dirz: 0, cx: 0, cz: 0, a: 0, b: 0, lifetime: 0,
      slowT: 0, slowAmt: 0, freezeT: 0, stunT: 0, burnT: 0, burnDps: 0, burnTick: 0, flash: 0, puff: 0, gem: true,
      hitAt: new Float32Array(HIT_SLOTS).fill(-99),
    };
  }

  get count(): number {
    return this.list.length;
  }

  spawn(id: SpeciesId, x: number, z: number, o: SpawnOpts = {}): Fish | null {
    const idx = this.free.pop();
    if (idx === undefined) return null;
    const f = this.pool[idx];
    const sp = SPECIES[id];
    const p = this.ctx.player;
    f.uid = this.uidSeq++;
    f.alive = true;
    f.sp = sp;
    f.boss = null;
    f.x = x;
    f.z = z;
    f.y = 0;
    f.kbx = f.kbz = 0;
    f.move = o.move ?? sp.move;
    f.speed = o.speed ?? sp.speed * (0.9 + Math.random() * 0.2);
    f.dirx = o.dirx ?? 0;
    f.dirz = o.dirz ?? 0;
    if (f.dirx === 0 && f.dirz === 0) {
      const l = Math.hypot(p.x - x, p.z - z) || 1;
      f.dirx = (p.x - x) / l;
      f.dirz = (p.z - z) / l;
    }
    f.heading = Math.atan2(f.dirx, f.dirz);
    f.yaw = f.heading;
    f.vx = f.dirx * f.speed;
    f.vz = f.dirz * f.speed;
    f.hp = f.maxHp = sp.hp * this.ctx.hpMul * (o.hpMul ?? 1);
    f.scale = sp.scale;
    f.radius = sp.radius;
    f.damage = sp.damage;
    f.t = 0;
    f.phase = Math.random() * Math.PI * 2;
    f.state = 0;
    f.timer = 0;
    f.count = 0;
    f.sub = 0;
    f.subT = 0;
    f.cx = o.cx ?? p.x;
    f.cz = o.cz ?? p.z;
    f.a = o.a ?? 0;
    f.b = o.b ?? 0;
    f.lifetime = o.lifetime ?? 0;
    f.slowT = f.slowAmt = f.freezeT = f.stunT = f.burnT = f.burnDps = f.burnTick = f.flash = f.puff = 0;
    f.gem = o.gem ?? true;
    f.bank = 0;
    // 真上からだと平たい魚は細い線に見えるので、少し傾けて体側の模様を見せる
    f.tilt = (f.uid % 2 === 0 ? 1 : -1) * (id === 'ei' || id === 'fugu' ? 0.15 : 0.6);
    f.pitch = 0;
    f.hitAt.fill(-99);
    if (f.move === 'spiral') {
      f.a = o.a ?? 8;
      f.b = o.b ?? 6;
      // a: 接線速度、b: 中心へ向かう速度。cx/cz を中心に、timer に角度、count に半径を持つ
      f.timer = Math.atan2(z - f.cz, x - f.cx);
      f.count = Math.hypot(x - f.cx, z - f.cz);
    }
    this.list.push(f);
    return f;
  }

  spawnBoss(def: BossDef, x: number, z: number): Fish | null {
    const f = this.spawn(def.species, x, z, { move: 'homing', gem: false });
    if (!f) return null;
    f.boss = def;
    f.hp = f.maxHp = def.hp * (1 + (this.ctx.hpMul - 1) * 0.2);
    f.scale = def.scale;
    f.radius = def.radius;
    f.damage = def.damage;
    f.speed = def.speed;
    f.tilt = 0.25;
    this.bosses.push(f);
    return f;
  }

  remove(f: Fish): void {
    if (!f.alive) return;
    f.alive = false;
    const i = this.list.indexOf(f);
    if (i >= 0) {
      this.list[i] = this.list[this.list.length - 1];
      this.list.pop();
    }
    if (f.boss) this.bosses.splice(this.bosses.indexOf(f), 1);
    this.free.push(f.index);
  }

  clear(): void {
    for (const f of [...this.list]) this.remove(f);
  }

  /**
   * (x, z) から r 以内に体が掛かっている魚を out に詰めて返す。
   * 命中処理の中から再帰的に呼ばれることがあるので、呼び出し側ごとに別の配列を渡すこと。
   */
  near(x: number, z: number, r: number, out: Fish[]): Fish[] {
    out.length = 0;
    const n = this.grid.queryCells(x, z, r + 2);
    for (let i = 0; i < n; i++) {
      const f = this.pool[this.grid.results[i]];
      if (!f.alive || f.boss) continue;
      const rr = r + f.radius;
      const dx = f.x - x;
      const dz = f.z - z;
      if (dx * dx + dz * dz <= rr * rr) out.push(f);
    }
    for (const f of this.bosses) {
      const rr = r + f.radius;
      const dx = f.x - x;
      const dz = f.z - z;
      if (dx * dx + dz * dz <= rr * rr) out.push(f);
    }
    return out;
  }

  nearest(x: number, z: number, maxR: number, excludeUid = -1): Fish | null {
    let best: Fish | null = null;
    let bd = maxR * maxR;
    for (const f of this.list) {
      if (f.uid === excludeUid) continue;
      const dx = f.x - x;
      const dz = f.z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  /** 近い順に k 体（重複なし）。射程内にボスがいれば先頭に入れる */
  nearestK(x: number, z: number, maxR: number, k: number, out: Fish[]): Fish[] {
    out.length = 0;
    const r2 = maxR * maxR;
    for (const b of this.bosses) {
      if (out.length < k && (b.x - x) ** 2 + (b.z - z) ** 2 <= (maxR + b.radius) ** 2) out.push(b);
    }
    const pinned = out.length;
    for (const f of this.list) {
      if (f.boss) continue;
      const dx = f.x - x;
      const dz = f.z - z;
      const d = dx * dx + dz * dz;
      if (d > r2) continue;
      if (out.length < k) {
        out.push(f);
      } else {
        if (pinned >= k) break;
        const lx = out[k - 1].x - x;
        const lz = out[k - 1].z - z;
        if (d >= lx * lx + lz * lz) continue;
        out[k - 1] = f;
      }
      // ボス以外を距離順に並べる（件数は小さいので挿入ソートで十分）
      for (let i = out.length - 1; i > pinned; i--) {
        const a = out[i - 1];
        const b = out[i];
        if ((a.x - x) ** 2 + (a.z - z) ** 2 <= (b.x - x) ** 2 + (b.z - z) ** 2) break;
        out[i - 1] = b;
        out[i] = a;
      }
    }
    return out;
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    const despawnR = ctx.spawnRadius + 40;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.t += dt;
      f.flash = Math.max(0, f.flash - dt * 7);

      // 状態異常
      if (f.slowT > 0) f.slowT -= dt;
      if (f.freezeT > 0) f.freezeT -= dt;
      if (f.stunT > 0) f.stunT -= dt;
      if (f.burnT > 0) {
        f.burnT -= dt;
        f.burnTick -= dt;
        if (f.burnTick <= 0) {
          f.burnTick = 0.33;
          ctx.combat.dot(f, f.burnDps * 0.33);
          if (!f.alive) continue;
        }
        if (Math.random() < dt * 10) {
          ctx.sparks.emit({ x: f.x, y: f.y + 0.4, z: f.z, count: 1, color: FIRE, speed: 2, size: 0.9, life: 0.5, up: 0.8, intensity: 2.5 });
        }
      }
      const held = f.freezeT > 0 || f.stunT > 0;
      const mul = held ? 0 : f.slowT > 0 ? 1 - f.slowAmt * (f.boss ? 0.5 : 1) : 1;

      if (f.boss) this.bossBehavior(f, dt, mul);
      else this.behavior(f, dt, mul);
      if (!f.alive) continue;

      const kd = Math.exp(-7 * dt);
      f.x += f.vx * mul * dt + f.kbx * dt;
      f.z += f.vz * mul * dt + f.kbz * dt;
      f.kbx *= kd;
      f.kbz *= kd;

      // 見た目の向き: 移動方向へ滑らかに回し、旋回に応じて傾ける
      if (!held) {
        const vs = Math.hypot(f.vx, f.vz);
        if (vs > 0.3) {
          const target = Math.atan2(f.vx, f.vz);
          const before = f.yaw;
          f.yaw = turnToward(f.yaw, target, dt * 6);
          const turn = Math.atan2(Math.sin(f.yaw - before), Math.cos(f.yaw - before)) / Math.max(dt, 1e-4);
          f.bank += (Math.max(-0.7, Math.min(0.7, -turn * 0.25)) - f.bank) * Math.min(1, dt * 5);
        }
      }

      const dx = f.x - p.x;
      const dz = f.z - p.z;
      const d2 = dx * dx + dz * dz;
      // プレイヤーとの接触
      const rr = f.radius + p.hitRadius;
      if (d2 < rr * rr && f.freezeT <= 0) {
        if (p.hurt(f.damage)) {
          ctx.shake(0.5);
          ctx.sfx.play('hurt');
          ctx.sparks.emit({ x: p.x, y: 0.5, z: p.z, count: 14, color: RED, speed: 9, size: 1.2, life: 0.45, intensity: 2 });
        }
        const d = Math.sqrt(d2) || 1;
        const push = f.boss ? 4 : 14;
        f.kbx += (dx / d) * push;
        f.kbz += (dz / d) * push;
      }
      if (!f.boss && (d2 > despawnR * despawnR || (f.lifetime > 0 && f.t > f.lifetime))) {
        this.remove(f);
      }
    }

    this.grid.clear();
    for (const f of this.list) if (!f.boss) this.grid.insert(f.index, f.x, f.z);
  }

  private behavior(f: Fish, dt: number, mul: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    const dx = p.x - f.x;
    const dz = p.z - f.z;
    const dist = Math.hypot(dx, dz) || 1;
    const toP = Math.atan2(dx, dz);
    const sp = f.speed;
    f.y = Math.sin(f.t * 2.2 + f.phase) * 0.25;
    switch (f.move) {
      case 'straight':
        f.vx = f.dirx * sp;
        f.vz = f.dirz * sp;
        break;
      case 'spiral': {
        // 中心の周りを回りながら内側へ
        f.count -= f.b * dt * mul;
        const r = Math.max(f.count, 0.5);
        f.timer += (f.a / r) * dt * mul;
        const nx = f.cx + Math.cos(f.timer) * f.count;
        const nz = f.cz + Math.sin(f.timer) * f.count;
        f.vx = (nx - f.x) / Math.max(dt, 1e-4) / Math.max(mul, 1e-3);
        f.vz = (nz - f.z) / Math.max(dt, 1e-4) / Math.max(mul, 1e-3);
        if (f.count < 1) {
          const l = Math.hypot(f.vx, f.vz) || 1;
          f.dirx = f.vx / l;
          f.dirz = f.vz / l;
          f.speed = Math.max(6, l);
          f.move = 'straight';
        }
        break;
      }
      case 'homing':
        f.heading = turnToward(f.heading, toP, f.sp.turnRate * dt * mul);
        f.vx = Math.sin(f.heading) * sp;
        f.vz = Math.cos(f.heading) * sp;
        break;
      case 'sine': {
        f.heading = turnToward(f.heading, toP, f.sp.turnRate * dt * mul);
        const lat = Math.cos(f.t * 3 + f.phase) * 7;
        f.vx = Math.sin(f.heading) * sp + Math.cos(f.heading) * lat;
        f.vz = Math.cos(f.heading) * sp - Math.sin(f.heading) * lat;
        break;
      }
      case 'hop': {
        // 1.4 秒周期で跳ねるように加速し、跳ねるたびに狙い直す
        const cycle = 1.4;
        const tau = (f.t + f.phase) % cycle;
        if (tau < f.timer) f.heading = toP + (Math.random() - 0.5) * 0.5;
        f.timer = tau;
        const v = sp * (0.45 + 1.9 * Math.exp(-3 * tau));
        f.vx = Math.sin(f.heading) * v;
        f.vz = Math.cos(f.heading) * v;
        f.y = Math.sin((Math.PI * tau) / cycle) * 2.2 - 0.6;
        f.pitch = -Math.cos((Math.PI * tau) / cycle) * 0.5;
        break;
      }
      case 'dash':
        this.dashBehavior(f, dt, toP, dist, 38, 0.9);
        break;
      case 'orbit': {
        const R = f.a || 15;
        const rx = -dx / dist;
        const rz = -dz / dist;
        const dir = f.uid % 2 === 0 ? 1 : -1;
        const radial = Math.max(-sp, Math.min(sp, (dist - R) * 1.5));
        f.vx = -rx * radial + -rz * dir * sp * 0.75;
        f.vz = -rz * radial + rx * dir * sp * 0.75;
        f.timer += dt * mul;
        if (f.timer > 2.8 && dist < 32) {
          f.timer = 0;
          for (let k = -2; k <= 2; k++) ctx.bullets.fire(f.x, f.z, toP + k * 0.12, 9, 'orb');
          ctx.sfx.play('shoot');
        }
        break;
      }
      case 'drift':
        f.vx = f.dirx * sp;
        f.vz = f.dirz * sp;
        f.timer += dt * mul;
        if (f.timer > 3.2 && dist < 34) {
          f.timer = 0;
          for (let k = -2; k <= 2; k++) ctx.bullets.fire(f.x, f.z, toP + k * 0.22, 7.5, 'bubble');
          ctx.sfx.play('shoot');
        }
        if (f.lifetime === 0) f.lifetime = 40;
        break;
      case 'puff':
        if (f.state === 0) {
          f.heading = turnToward(f.heading, toP, f.sp.turnRate * dt * mul);
          f.vx = Math.sin(f.heading) * sp;
          f.vz = Math.cos(f.heading) * sp;
          f.puff = Math.max(0, f.puff - dt);
          if (dist < 9) {
            f.state = 1;
            f.timer = 0;
          }
        } else if (f.state === 1) {
          // 膨らんでからトゲを全方位に撃つ
          f.vx *= 0.9;
          f.vz *= 0.9;
          f.timer += dt * mul;
          f.puff = Math.min(1, f.timer / 0.8);
          if (f.timer >= 0.8) {
            const n = 10;
            for (let k = 0; k < n; k++) ctx.bullets.fire(f.x, f.z, (k / n) * Math.PI * 2 + f.phase, 8, 'spine');
            ctx.sfx.play('shoot');
            f.state = 2;
            f.timer = 0;
          }
        } else {
          f.timer += dt;
          f.puff = Math.max(0, 1 - f.timer);
          f.heading = turnToward(f.heading, toP, f.sp.turnRate * dt * mul);
          f.vx = Math.sin(f.heading) * sp * 0.5;
          f.vz = Math.cos(f.heading) * sp * 0.5;
          if (f.timer > 2.6) f.state = 0;
        }
        break;
    }
  }

  /** 接近 → 予兆線を出して静止 → 突進 → 減速。1 サイクル終えたら true */
  private dashBehavior(f: Fish, dt: number, toP: number, dist: number, dashSpeed: number, aimTime: number): boolean {
    const ctx = this.ctx;
    f.subT += dt;
    switch (f.sub) {
      case 0:
        f.heading = turnToward(f.heading, toP, f.sp.turnRate * dt);
        f.vx = Math.sin(f.heading) * f.speed;
        f.vz = Math.cos(f.heading) * f.speed;
        if (dist < 24 && f.t > 1) this.setSub(f, 1);
        return false;
      case 1: {
        f.heading = turnToward(f.heading, toP, 4 * dt);
        f.vx *= 0.85;
        f.vz *= 0.85;
        const pulse = 0.35 + 0.35 * Math.sin(f.subT * 30);
        const len = dashSpeed;
        ctx.fx.beam(f.x, f.z, f.x + Math.sin(f.heading) * len, f.z + Math.cos(f.heading) * len, -0.2, f.boss ? 3 : 1.4, WARN, pulse);
        if (f.subT >= aimTime) {
          this.setSub(f, 2);
          ctx.sfx.play('dash');
        }
        return false;
      }
      case 2:
        f.vx = Math.sin(f.heading) * dashSpeed;
        f.vz = Math.cos(f.heading) * dashSpeed;
        if (Math.random() < dt * 30) ctx.puffs.emit({ x: f.x, y: f.y, z: f.z, count: 1, color: FOAM, speed: 1, size: 1.4 * f.scale, life: 0.5 });
        if (f.subT > 1.0) this.setSub(f, 3);
        return false;
      default:
        f.vx *= 0.94;
        f.vz *= 0.94;
        if (f.subT > 0.9) {
          this.setSub(f, 0);
          return true;
        }
        return false;
    }
  }

  private setSub(f: Fish, sub: number): void {
    f.sub = sub;
    f.subT = 0;
  }

  private bossBehavior(f: Fish, dt: number, mul: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    const b = f.boss as BossDef;
    const dx = p.x - f.x;
    const dz = p.z - f.z;
    const dist = Math.hypot(dx, dz) || 1;
    const toP = Math.atan2(dx, dz);
    const rage = f.hp < f.maxHp * 0.5 ? 1 : 0;
    f.y = Math.sin(f.t * 1.4) * 0.4;
    // 引き離されたら行動を中断して一気に追いつく（ボス戦が成立しなくなるのを防ぐ）
    if (dist > 26) {
      f.heading = toP;
      f.vx = Math.sin(toP) * 20;
      f.vz = Math.cos(toP) * 20;
      return;
    }
    f.timer += dt * mul;

    // count: 行動の回数、a: 弾幕の回転角、b: 発射タイマー
    if (b.id === 'kingKajiki') {
      if (f.state === 0) {
        // 周回しながら 3 方向弾
        const R = 12;
        const rx = -dx / dist;
        const rz = -dz / dist;
        const radial = Math.max(-f.speed, Math.min(f.speed, (dist - R) * 1.5));
        f.vx = -rx * radial - rz * f.speed;
        f.vz = -rz * radial + rx * f.speed;
        f.b += dt;
        if (f.b > 0.9 - rage * 0.3) {
          f.b = 0;
          for (let k = -1; k <= 1; k++) ctx.bullets.fire(f.x, f.z, toP + k * 0.2, 10, 'orb');
        }
        if (f.timer > 4) this.nextBossState(f, 1);
      } else if (f.state === 1) {
        // 予兆 → 突進を 3 回
        if (this.dashBehavior(f, dt, toP, dist, 46 + rage * 8, 0.8 - rage * 0.2)) {
          f.count++;
          if (f.count >= 3) this.nextBossState(f, 2);
          else this.setSub(f, 1);
        }
      } else {
        // 4 本腕の渦巻き弾
        f.vx *= 0.95;
        f.vz *= 0.95;
        f.b += dt;
        if (f.b > 0.09) {
          f.b = 0;
          f.a += 0.23;
          const arms = 4 + rage;
          for (let k = 0; k < arms; k++) ctx.bullets.fire(f.x, f.z, f.a + (k / arms) * Math.PI * 2, 8, 'orb');
        }
        if (f.timer > 3) this.nextBossState(f, 0);
      }
    } else if (b.id === 'nushiFugu') {
      if (f.state === 0) {
        f.heading = turnToward(f.heading, toP, 1.2 * dt);
        f.vx = Math.sin(f.heading) * f.speed;
        f.vz = Math.cos(f.heading) * f.speed;
        f.puff = Math.max(0, f.puff - dt);
        if (f.timer > 3) this.nextBossState(f, 1);
      } else if (f.state === 1) {
        f.vx *= 0.9;
        f.vz *= 0.9;
        f.puff = Math.min(1, f.timer);
        if (f.timer > 1) this.nextBossState(f, 2);
      } else if (f.state === 2) {
        // 時間差で 3 重のトゲリング
        const marks = [0, 0.35, 0.7, 1.05];
        const n = 22 + rage * 8;
        while (f.count < marks.length - 1 + rage && f.timer >= marks[Math.min(f.count, marks.length - 1)]) {
          const off = (f.count * Math.PI) / n;
          for (let k = 0; k < n; k++) ctx.bullets.fire(f.x, f.z, (k / n) * Math.PI * 2 + off, 7 - f.count * 0.6, 'spine');
          ctx.sfx.play('shoot');
          f.count++;
        }
        if (f.timer > 1.5) this.nextBossState(f, 3);
      } else {
        f.puff = Math.max(0, f.puff - dt);
        f.heading = turnToward(f.heading, toP, 0.8 * dt);
        f.vx = Math.sin(f.heading) * f.speed * 0.6;
        f.vz = Math.cos(f.heading) * f.speed * 0.6;
        f.b += dt;
        if (f.b > 0.1) {
          f.b = 0;
          f.a += 0.19;
          for (let k = 0; k < 2 + rage; k++) ctx.bullets.fire(f.x, f.z, f.a + (k / (2 + rage)) * Math.PI * 2, 7.5, 'spine');
        }
        if (f.timer > 3.5) this.nextBossState(f, 0);
      }
    } else {
      // メガロドン
      const speed = f.speed + rage * 2.5;
      if (f.state === 0) {
        f.heading = turnToward(f.heading, toP, 1.4 * dt);
        f.vx = Math.sin(f.heading) * speed;
        f.vz = Math.cos(f.heading) * speed;
        f.b += dt;
        if (f.b > 1.2 - rage * 0.4) {
          f.b = 0;
          for (let k = -3; k <= 3; k++) ctx.bullets.fire(f.x, f.z, toP + k * 0.14, 11, 'tooth');
          ctx.sfx.play('shoot');
        }
        if (f.timer > 3) this.nextBossState(f, 1);
      } else if (f.state === 1) {
        // 突進を 2 回
        if (this.dashBehavior(f, dt, toP, dist, 34 + rage * 6, 0.7)) {
          f.count++;
          if (f.count >= 2) this.nextBossState(f, 2);
          else this.setSub(f, 1);
        }
      } else {
        f.vx *= 0.9;
        f.vz *= 0.9;
        if (f.count === 0) {
          ctx.summonRing('iwashi', 18 + rage * 8, ctx.spawnRadius * 0.8, 9);
          const n = 28 + rage * 8;
          for (let k = 0; k < n; k++) ctx.bullets.fire(f.x, f.z, (k / n) * Math.PI * 2, 7, 'tooth');
          ctx.sfx.play('shoot');
          f.count = 1;
        }
        if (rage && f.timer < 2) {
          f.b += dt;
          if (f.b > 0.08) {
            f.b = 0;
            f.a += 0.31;
            for (let k = 0; k < 3; k++) ctx.bullets.fire(f.x, f.z, f.a + (k / 3) * Math.PI * 2, 8, 'orb');
          }
        }
        if (f.timer > 2.2) this.nextBossState(f, 0);
      }
    }
  }

  private nextBossState(f: Fish, s: number): void {
    f.state = s;
    f.timer = 0;
    f.count = 0;
    f.b = 0;
    // 突進系の状態は予兆から始める
    this.setSub(f, 1);
  }

  render(time: number): void {
    const r = this.renderer;
    r.begin();
    for (const f of this.list) {
      const puffScale = 1 + f.puff * 0.7;
      r.push(
        f.sp.id, f.x, f.y, f.z, f.yaw, f.scale * puffScale, f.phase + f.t * 0.2,
        f.flash, f.freezeT > 0 ? 1 : 0, f.burnT > 0 ? 1 : 0, f.bank + f.tilt, f.pitch,
      );
    }
    r.end(time);
  }
}

const FIRE = new THREE.Color('#ff7a1a');
const FOAM = new THREE.Color('#e8f6ff');
