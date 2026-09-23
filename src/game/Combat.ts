import * as THREE from 'three';
import { traitMath as m, type ElementTrait } from './traits';
import type { WeaponStats } from './stats';
import type { Fish } from './FishSystem';
import type { GameContext } from './context';

export interface HitSource {
  ws: WeaponStats | null;
  /** 武器ごとの番号（連続ヒット間隔や水泡の内部クールダウンに使う） */
  slot: number;
  /** 連鎖・爆発・水滴などの二次ダメージ。属性は発動しない */
  secondary: boolean;
  /** ノックバック方向（0 ならプレイヤーから遠ざかる向き） */
  dirx: number;
  dirz: number;
}

const COLORS = {
  fire: new THREE.Color('#ff7a1a'),
  ice: new THREE.Color('#9eeaff'),
  bolt: new THREE.Color('#ffe45c'),
  impact: new THREE.Color('#fff2c4'),
  splash: new THREE.Color('#bfe9ff'),
};

const SPLASH_SOURCE: HitSource = { ws: null, slot: -1, secondary: true, dirx: 0, dirz: 0 };

export class Combat {
  private readonly bufs: Fish[][] = [];
  private depth = 0;
  private readonly chainHit: number[] = [];
  private readonly aquaCd = new Float32Array(16);
  private readonly tmpColor = new THREE.Color();
  /** 与えたダメージの合計（リザルト表示用） */
  totalDamage = 0;

  constructor(private readonly ctx: GameContext) {}

  update(dt: number): void {
    for (let i = 0; i < this.aquaCd.length; i++) this.aquaCd[i] = Math.max(0, this.aquaCd[i] - dt);
  }

  hit(f: Fish, dmg: number, src: HitSource): void {
    if (!f.alive) return;
    const ctx = this.ctx;
    let d = dmg;
    if (f.freezeT > 0) d *= 1.25;
    f.hp -= d;
    f.flash = 1;
    this.totalDamage += d;
    ctx.dmgText.add(f.x, f.y + 1.2, f.z, d, src.secondary ? 1 : 0);

    const ws = src.ws;
    if (ws) {
      const res = f.boss ? 0.97 : f.sp.knockbackResist;
      let kx = src.dirx;
      let kz = src.dirz;
      if (kx === 0 && kz === 0) {
        kx = f.x - ctx.player.x;
        kz = f.z - ctx.player.z;
        const l = Math.hypot(kx, kz) || 1;
        kx /= l;
        kz /= l;
      }
      const kb = ws.knockback * (1 - res) * (src.secondary ? 0.3 : 1);
      f.kbx += kx * kb;
      f.kbz += kz * kb;
      if (ws.vamp > 0) ctx.player.lifesteal(d * m.vampRatio(ws.vamp), m.vampCapPerSec(ws.vamp));
      if (!src.secondary) {
        for (const t in ws.elements) {
          const s = ws.elements[t as ElementTrait] as number;
          this.applyElement(f, t as ElementTrait, s, d, src, false);
          if (!f.alive) return;
        }
        for (const proc of ctx.weapons.global.procs) {
          if (Math.random() < proc.chance) this.applyElement(f, proc.trait, proc.strength, d, src, true);
          if (!f.alive) return;
        }
      }
    }
    if (f.hp <= 0) this.kill(f);
  }

  /** 炎上などの継続ダメージ */
  dot(f: Fish, dmg: number): void {
    if (!f.alive) return;
    f.hp -= dmg;
    this.totalDamage += dmg;
    this.ctx.dmgText.add(f.x, f.y + 1.2, f.z, dmg, 2);
    if (f.hp <= 0) this.kill(f);
  }

  /** 範囲ダメージ（二次ダメージ扱い） */
  explode(x: number, z: number, radius: number, dmg: number, color: THREE.Color, src: HitSource = SPLASH_SOURCE): void {
    const ctx = this.ctx;
    ctx.fx.spawnRing(x, z, radius * 0.3, radius, 0.35, color, 1.6, 0.35);
    ctx.sparks.emit({ x, y: 0.5, z, count: 18, color, speed: radius * 4, size: 1.3, life: 0.45, intensity: 2.2 });
    const buf = (this.bufs[this.depth] ??= []);
    this.depth++;
    ctx.fish.near(x, z, radius, buf);
    for (const f of buf) {
      const l = Math.hypot(f.x - x, f.z - z) || 1;
      this.hit(f, dmg, { ...src, dirx: (f.x - x) / l, dirz: (f.z - z) / l });
    }
    this.depth--;
  }

  private applyElement(f: Fish, t: ElementTrait, s: number, d: number, src: HitSource, fromProc: boolean): void {
    const ctx = this.ctx;
    switch (t) {
      case 'impact':
        if (!f.boss && Math.random() < m.impactStunChance(s)) {
          f.stunT = 0.6;
          ctx.fx.spawnRing(f.x, f.z, 0.2, 1.6, 0.25, COLORS.impact, 1.2, 0.3);
        }
        if (fromProc) {
          const l = Math.hypot(f.x - ctx.player.x, f.z - ctx.player.z) || 1;
          f.kbx += ((f.x - ctx.player.x) / l) * m.impactKnockback(s);
          f.kbz += ((f.z - ctx.player.z) / l) * m.impactKnockback(s);
        }
        break;
      case 'blaze':
        f.burnT = 3;
        f.burnDps = Math.max(f.burnDps, d * m.blazeDpsRatio(s));
        break;
      case 'thunder': {
        const chains = m.thunderChains(s);
        this.chainHit.length = 0;
        this.chainHit.push(f.uid);
        let prev = f;
        for (let k = 0; k < chains; k++) {
          let best: Fish | null = null;
          let bd = 7 * 7;
          for (const g of ctx.fish.list) {
            if (this.chainHit.includes(g.uid)) continue;
            const dx = g.x - prev.x;
            const dz = g.z - prev.z;
            const dd = dx * dx + dz * dz;
            if (dd < bd) {
              bd = dd;
              best = g;
            }
          }
          if (!best) break;
          this.chainHit.push(best.uid);
          ctx.fx.spawnBeam(prev.x, prev.z, best.x, best.z, 0.9, 0.22, COLORS.bolt, 2.2, true);
          const target = best;
          this.hit(target, d * m.thunderRatio(s), { ...src, secondary: true });
          prev = target;
        }
        break;
      }
      case 'frost':
        f.slowAmt = Math.max(f.slowT > 0 ? f.slowAmt : 0, m.frostSlow(s));
        f.slowT = 2;
        if (!f.boss && Math.random() < m.frostFreezeChance(s)) {
          f.freezeT = 1.2;
          ctx.sparks.emit({ x: f.x, y: 0.6, z: f.z, count: 8, color: COLORS.ice, speed: 4, size: 1, life: 0.5, intensity: 2 });
        }
        break;
      case 'gale':
        if (fromProc) {
          const l = Math.hypot(f.x - ctx.player.x, f.z - ctx.player.z) || 1;
          f.kbx += ((f.x - ctx.player.x) / l) * 3 * s;
          f.kbz += ((f.z - ctx.player.z) / l) * 3 * s;
        }
        break;
      case 'aqua': {
        const slot = Math.max(0, src.slot);
        if (this.aquaCd[slot] > 0 || Math.random() > m.aquaChance(s)) break;
        this.aquaCd[slot] = 0.15;
        ctx.weapons.spawnDroplets(f.x, f.z, m.aquaDroplets(s), d * m.aquaRatio(s), src.ws, f.uid);
        break;
      }
    }
  }

  kill(f: Fish): void {
    if (!f.alive) return;
    const ctx = this.ctx;
    const burning = f.burnT > 0;
    const burnDmg = f.burnDps * 1.6;
    this.tmpColor.set(f.sp.gem.color);
    ctx.sparks.emit({ x: f.x, y: f.y + 0.4, z: f.z, count: f.boss ? 80 : 10, color: this.tmpColor, speed: f.boss ? 18 : 7, size: f.boss ? 2.2 : 1.1, life: f.boss ? 1.1 : 0.5, intensity: 2 });
    ctx.puffs.emit({ x: f.x, y: f.y, z: f.z, count: f.boss ? 40 : 5, color: COLORS.splash, speed: f.boss ? 10 : 4, size: f.boss ? 2.5 : 1.2, life: 0.6, gravity: 6 });
    if (f.sp.id === 'fugu' && !f.boss) {
      for (let k = 0; k < 6; k++) ctx.bullets.fire(f.x, f.z, (k / 6) * Math.PI * 2 + f.phase, 6, 'spine');
    }
    ctx.onFishKilled(f);
    ctx.fish.remove(f);
    if (burning) this.explode(f.x, f.z, 2.4 + f.radius, burnDmg, COLORS.fire);
  }
}
