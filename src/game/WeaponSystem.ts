import * as THREE from 'three';
import { vertexColorMaterial } from '../render/materials';
import { bombGeometry, dropletGeometry, gloveGeometry, rocketGeometry } from '../models/projectiles';
import { WEAPON_IDS, type WeaponId } from './items';
import type { Inventory, OwnedItem } from './inventory';
import { computePlayerStats, computeWeaponStats, type GlobalMods, type WeaponStats } from './stats';
import { TRAITS, sortedTraits, type TraitId } from './traits';
import type { Fish } from './FishSystem';
import type { HitSource } from './Combat';
import type { GameContext } from './context';

type ProjKind = 'glove' | 'rocket' | 'bomb' | 'drop';
const PROJ_KINDS: ProjKind[] = ['glove', 'rocket', 'bomb', 'drop'];
const MAX_PROJ = 400;
const MAX_HITS = 12;
const DROPLET_SLOT = 6;

interface Proj {
  alive: boolean;
  kind: ProjKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  speed: number;
  life: number;
  radius: number;
  dmg: number;
  pierce: number;
  homing: number;
  target: Fish | null;
  targetUid: number;
  ws: WeaponStats | null;
  slot: number;
  secondary: boolean;
  hits: Int32Array;
  nh: number;
  scale: number;
  tint: THREE.Color;
  sx: number;
  sz: number;
  tx: number;
  tz: number;
  t: number;
  dur: number;
  splash: number;
}

interface Ring {
  x: number;
  z: number;
  r: number;
  maxR: number;
  speed: number;
  delay: number;
  ws: WeaponStats;
  hit: Set<number>;
  tint: THREE.Color;
}

export interface WeaponRuntime {
  id: WeaponId;
  item: OwnedItem;
  stats: WeaponStats;
  timer: number;
  slot: number;
  angle: number;
  tint: THREE.Color;
}

const WHITE = new THREE.Color(1, 1, 1);
const BEAM_COLOR = new THREE.Color('#ffe45c').multiplyScalar(2.4);
const FROST_COLOR = new THREE.Color('#8ff0ff').multiplyScalar(1.8);
const WATER = new THREE.Color('#6fd0ff');
const SMOKE = new THREE.Color('#ffd9a8');
const TORNADO = new THREE.Color('#dff8ff');

/** 合成で付いた属性の色を混ぜて、弾の色味にする */
function tintFor(item: OwnedItem): THREE.Color {
  const traits = sortedTraits(item.traits);
  if (traits.length === 0) return WHITE.clone();
  const c = new THREE.Color(0, 0, 0);
  for (const [t] of traits.slice(0, 2)) c.add(new THREE.Color(TRAITS[t as TraitId].color));
  c.multiplyScalar(1 / Math.min(2, traits.length));
  return WHITE.clone().lerp(c, 0.7);
}

export class WeaponSystem {
  readonly group = new THREE.Group();
  readonly runtimes: WeaponRuntime[] = [];
  global: GlobalMods = { statTraits: {}, procs: [] };
  private readonly projs: Proj[] = [];
  private readonly rings: Ring[] = [];
  private readonly meshes: Record<ProjKind, THREE.InstancedMesh>;
  private readonly buf: Fish[] = [];
  private readonly targets: Fish[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private punchSide = 0;

  constructor(private readonly ctx: GameContext) {
    for (let i = 0; i < MAX_PROJ; i++) {
      this.projs.push({
        alive: false, kind: 'glove', x: 0, y: 0, z: 0, vx: 0, vz: 0, speed: 0, life: 0, radius: 0, dmg: 0, pierce: 0,
        homing: 0, target: null, targetUid: 0, ws: null, slot: 0, secondary: false, hits: new Int32Array(MAX_HITS), nh: 0,
        scale: 1, tint: new THREE.Color(), sx: 0, sz: 0, tx: 0, tz: 0, t: 0, dur: 0, splash: 0,
      });
    }
    const solid = vertexColorMaterial({ roughness: 0.35, metalness: 0.2, glow: 3 });
    const water = new THREE.MeshStandardMaterial({
      color: '#5fc8ff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.78, envMapIntensity: 2,
      emissive: '#1b6fa8', emissiveIntensity: 0.4,
    });
    const geos: Record<ProjKind, THREE.BufferGeometry> = {
      glove: gloveGeometry(), rocket: rocketGeometry(), bomb: bombGeometry(), drop: dropletGeometry(),
    };
    this.meshes = {} as Record<ProjKind, THREE.InstancedMesh>;
    for (const k of PROJ_KINDS) {
      const mesh = new THREE.InstancedMesh(geos[k], k === 'bomb' ? water : solid, MAX_PROJ);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PROJ * 3), 3);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.meshes[k] = mesh;
      this.group.add(mesh);
    }
  }

  /** 所持品が変わったら呼ぶ。プレイヤーのステータスと各武器の性能を計算し直す */
  sync(inv: Inventory): void {
    const { stats, global } = computePlayerStats(inv);
    this.ctx.player.applyStats(stats);
    this.global = global;
    const next: WeaponRuntime[] = [];
    for (const item of inv.weapons) {
      const id = item.id as WeaponId;
      const prev = this.runtimes.find((r) => r.id === id);
      next.push({
        id,
        item,
        stats: computeWeaponStats(item, stats, global),
        timer: prev?.timer ?? 0.3,
        slot: WEAPON_IDS.indexOf(id),
        angle: prev?.angle ?? 0,
        tint: tintFor(item),
      });
    }
    this.runtimes.length = 0;
    this.runtimes.push(...next);
  }

  clear(): void {
    for (const p of this.projs) p.alive = false;
    this.rings.length = 0;
    this.runtimes.length = 0;
    for (const k of PROJ_KINDS) this.meshes[k].count = 0;
  }

  update(dt: number): void {
    const time = this.ctx.time;
    for (const w of this.runtimes) {
      if (w.id === 'cyclone') {
        this.updateCyclone(w, dt, time);
        continue;
      }
      w.timer -= dt;
      if (w.timer <= 0) {
        if (this.fire(w)) w.timer += Math.max(0.12, w.stats.cooldown);
        else w.timer = 0.15;
      }
    }
    this.updateProjectiles(dt);
    this.updateRings(dt);
  }

  private src(w: { stats: WeaponStats; slot: number }, dirx = 0, dirz = 0): HitSource {
    return { ws: w.stats, slot: w.slot, secondary: false, dirx, dirz };
  }

  /** 撃てたら true（標的がいなくて空撃ちしない武器もある） */
  private fire(w: WeaponRuntime): boolean {
    const ctx = this.ctx;
    const pl = ctx.player;
    const ws = w.stats;
    switch (w.id) {
      case 'punch': {
        const range = 17 * ws.range;
        const targets = ctx.fish.nearestK(pl.x, pl.z, range, Math.max(1, ws.amount), this.targets);
        for (let i = 0; i < ws.amount; i++) {
          const t = targets.length ? targets[i % targets.length] : null;
          let dx = t ? t.x - pl.x : pl.faceX;
          let dz = t ? t.z - pl.z : pl.faceZ;
          const l = Math.hypot(dx, dz) || 1;
          dx /= l;
          dz /= l;
          // 同じ標的を狙う 2 発目以降は少し散らす
          const spread = t && i >= targets.length ? (i % 2 ? 1 : -1) * 0.18 * Math.ceil(i / 2) : 0;
          const ang = Math.atan2(dx, dz) + spread;
          const pr = this.spawn('glove', pl.x + Math.sin(ang) * 1.3, pl.z + Math.cos(ang) * 1.3, ang, ws.speed, w);
          if (!pr) break;
          pr.life = ws.duration * ws.range;
          pr.radius = 0.9 * ws.area;
          pr.scale = 1.45 * ws.area;
          pr.pierce = ws.pierce;
          pr.homing = ws.homing;
          pr.target = t;
        }
        ctx.player.pelican.punch(this.punchSide);
        this.punchSide ^= 1;
        ctx.sfx.play('punch');
        return true;
      }
      case 'rocket': {
        const targets = ctx.fish.nearestK(pl.x, pl.z, 30 * ws.range, 8, this.targets);
        if (targets.length === 0) return false;
        for (let i = 0; i < ws.amount; i++) {
          const t = targets[Math.floor(Math.random() * targets.length)];
          const base = Math.atan2(t.x - pl.x, t.z - pl.z);
          const ang = base + (i - (ws.amount - 1) / 2) * 0.7 + (Math.random() - 0.5) * 0.4;
          const pr = this.spawn('rocket', pl.x, pl.z, ang, ws.speed, w);
          if (!pr) break;
          pr.life = ws.duration;
          pr.radius = 0.6;
          pr.scale = 1.2;
          pr.pierce = ws.pierce;
          pr.homing = Math.max(4.5, ws.homing);
          pr.target = t;
          pr.targetUid = t.uid;
          pr.splash = 2.6 * ws.area;
        }
        ctx.sfx.play('rocket');
        return true;
      }
      case 'thunder': {
        const len = 24 * ws.area * ws.range;
        const targets = ctx.fish.nearestK(pl.x, pl.z, len, ws.amount, this.targets);
        const width = 1.3 * ws.area;
        for (let i = 0; i < ws.amount; i++) {
          let ang: number;
          if (targets.length) {
            const t = targets[i % targets.length];
            ang = Math.atan2(t.x - pl.x, t.z - pl.z) + (i >= targets.length ? (i % 2 ? 0.35 : -0.35) : 0);
          } else {
            ang = Math.atan2(pl.faceX, pl.faceZ) + i * ((Math.PI * 2) / ws.amount);
          }
          this.castBeam(w, pl.x, pl.z, ang, len, width);
        }
        ctx.sfx.play('zap');
        return true;
      }
      case 'bell': {
        for (let i = 0; i < ws.amount; i++) {
          this.rings.push({
            x: pl.x, z: pl.z, r: 0, maxR: 7.5 * ws.area, speed: ws.speed, delay: i * 0.3,
            ws, hit: new Set(), tint: w.tint,
          });
        }
        ctx.player.pelican.ringBell();
        ctx.sfx.play('bell');
        return true;
      }
      case 'aqua': {
        const cands = ctx.fish.nearestK(pl.x, pl.z, 20 * ws.range, 12, this.targets);
        for (let i = 0; i < ws.amount; i++) {
          let tx: number;
          let tz: number;
          if (cands.length) {
            const t = cands[Math.floor(Math.random() * cands.length)];
            // 着弾までの移動を少し先読みする
            tx = t.x + t.vx * 0.35;
            tz = t.z + t.vz * 0.35;
          } else {
            const a = Math.random() * Math.PI * 2;
            tx = pl.x + Math.cos(a) * 8;
            tz = pl.z + Math.sin(a) * 8;
          }
          const pr = this.spawn('bomb', pl.x, pl.z, 0, 0, w);
          if (!pr) break;
          pr.sx = pl.x;
          pr.sz = pl.z;
          pr.tx = tx;
          pr.tz = tz;
          pr.t = 0;
          pr.dur = 0.75 / ws.speed + i * 0.08;
          pr.splash = 3 * ws.area;
          pr.scale = 1 + 0.2 * (ws.area - 1);
        }
        ctx.sfx.play('lob');
        return true;
      }
      default:
        return false;
    }
  }

  private castBeam(w: WeaponRuntime, x: number, z: number, ang: number, len: number, width: number): void {
    const ctx = this.ctx;
    const dx = Math.sin(ang);
    const dz = Math.cos(ang);
    const x2 = x + dx * len;
    const z2 = z + dz * len;
    const color = w.tint === WHITE || w.tint.equals(WHITE) ? BEAM_COLOR : w.tint.clone().multiplyScalar(2.2);
    ctx.fx.spawnBeam(x, z, x2, z2, width * 2.2, w.stats.duration, color, 1.4, false, 0.6);
    ctx.fx.spawnBeam(x, z, x2, z2, width * 1.2, w.stats.duration, WHITE.clone().multiplyScalar(2), 1.2, true, 0.7);
    // 線分との距離で当たり判定（一度きり）
    const hits: Fish[] = [];
    for (const f of ctx.fish.list) {
      const px = f.x - x;
      const pz = f.z - z;
      const along = px * dx + pz * dz;
      if (along < -f.radius || along > len + f.radius) continue;
      const perp = Math.abs(px * dz - pz * dx);
      if (perp <= width / 2 + f.radius) hits.push(f);
    }
    for (const f of hits) this.ctx.combat.hit(f, w.stats.damage, this.src(w, dx, dz));
    for (let k = 0; k < 6; k++) {
      const t = Math.random() * len;
      ctx.sparks.emit({ x: x + dx * t, y: 0.6, z: z + dz * t, count: 2, color: BEAM_COLOR, speed: 5, size: 0.9, life: 0.35 });
    }
  }

  private updateCyclone(w: WeaponRuntime, dt: number, time: number): void {
    const ctx = this.ctx;
    const pl = ctx.player;
    const ws = w.stats;
    const n = Math.max(1, ws.amount);
    const rot = ws.speed * Math.sqrt(0.5 / Math.max(0.1, ws.cooldown));
    w.angle += rot * dt;
    const R = 4.5 * ws.area;
    const tr = 1.15 * ws.area;
    for (let k = 0; k < n; k++) {
      const a = w.angle + (k / n) * Math.PI * 2;
      const x = pl.x + Math.cos(a) * R;
      const z = pl.z + Math.sin(a) * R;
      ctx.fx.tornado(x, -0.4, z, ws.area * 0.95, time * 14 + k, w.tint.equals(WHITE) ? TORNADO : w.tint);
      for (const f of ctx.fish.near(x, z, tr, this.buf)) {
        if (time - f.hitAt[w.slot] < ws.cooldown) continue;
        f.hitAt[w.slot] = time;
        // 接線方向へ弾き飛ばす
        const tx = -Math.sin(a);
        const tz = Math.cos(a);
        ctx.combat.hit(f, ws.damage, this.src(w, (f.x - pl.x) * 0.05 + tx, (f.z - pl.z) * 0.05 + tz));
      }
    }
  }

  spawnDroplets(x: number, z: number, count: number, dmg: number, ws: WeaponStats | null, excludeUid: number): void {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const pr = this.spawn('drop', x, z, ang, 16, { stats: ws as WeaponStats, slot: DROPLET_SLOT, tint: WATER });
      if (!pr) return;
      pr.ws = ws;
      pr.dmg = dmg;
      pr.secondary = true;
      pr.life = 1.2;
      pr.radius = 0.4;
      pr.scale = 1;
      pr.homing = 9;
      pr.target = this.ctx.fish.nearest(x, z, 10, excludeUid);
      pr.targetUid = pr.target?.uid ?? 0;
    }
  }

  private spawn(kind: ProjKind, x: number, z: number, ang: number, speed: number, w: { stats: WeaponStats; slot: number; tint: THREE.Color }): Proj | null {
    const pr = this.projs.find((p) => !p.alive);
    if (!pr) return null;
    pr.alive = true;
    pr.kind = kind;
    pr.x = x;
    pr.z = z;
    pr.y = 0.4;
    pr.speed = speed;
    pr.vx = Math.sin(ang) * speed;
    pr.vz = Math.cos(ang) * speed;
    pr.ws = w.stats;
    pr.slot = w.slot;
    pr.dmg = w.stats?.damage ?? 0;
    pr.secondary = false;
    pr.nh = 0;
    pr.pierce = 0;
    pr.homing = 0;
    pr.target = null;
    pr.targetUid = 0;
    pr.tint.copy(w.tint);
    pr.splash = 0;
    return pr;
  }

  private updateProjectiles(dt: number): void {
    const ctx = this.ctx;
    for (const pr of this.projs) {
      if (!pr.alive) continue;
      if (pr.kind === 'bomb') {
        pr.t += dt;
        const k = Math.min(1, pr.t / pr.dur);
        pr.x = pr.sx + (pr.tx - pr.sx) * k;
        pr.z = pr.sz + (pr.tz - pr.sz) * k;
        pr.y = 1 + Math.sin(Math.PI * k) * 6 - k * 1.2;
        if (k >= 1) {
          this.splash(pr);
          pr.alive = false;
        }
        continue;
      }
      pr.life -= dt;
      if (pr.homing > 0) {
        if (!pr.target || !pr.target.alive || pr.target.uid !== pr.targetUid) {
          pr.target = ctx.fish.nearest(pr.x, pr.z, 22);
          pr.targetUid = pr.target?.uid ?? 0;
        }
        if (pr.target) {
          const want = Math.atan2(pr.target.x - pr.x, pr.target.z - pr.z);
          const cur = Math.atan2(pr.vx, pr.vz);
          let d = want - cur;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          const na = cur + Math.max(-pr.homing * dt, Math.min(pr.homing * dt, d));
          pr.vx = Math.sin(na) * pr.speed;
          pr.vz = Math.cos(na) * pr.speed;
        }
      }
      pr.x += pr.vx * dt;
      pr.z += pr.vz * dt;
      if (pr.kind === 'rocket' && Math.random() < dt * 40) {
        ctx.puffs.emit({ x: pr.x - pr.vx * 0.05, y: pr.y, z: pr.z - pr.vz * 0.05, count: 1, color: SMOKE, speed: 0.6, size: 1.3, life: 0.45 });
      }
      const hitList = ctx.fish.near(pr.x, pr.z, pr.radius, this.buf);
      let consumed = false;
      for (const f of hitList) {
        if (this.alreadyHit(pr, f.uid)) continue;
        this.markHit(pr, f.uid);
        const l = Math.hypot(pr.vx, pr.vz) || 1;
        const src: HitSource = { ws: pr.ws, slot: pr.slot, secondary: pr.secondary, dirx: pr.vx / l, dirz: pr.vz / l };
        if (pr.kind === 'rocket') {
          ctx.combat.explode(pr.x, pr.z, pr.splash, pr.dmg, SMOKE, { ...src, secondary: false });
          ctx.sfx.play('boom');
        } else {
          ctx.combat.hit(f, pr.dmg, src);
          ctx.sparks.emit({ x: pr.x, y: 0.5, z: pr.z, count: 4, color: pr.kind === 'drop' ? WATER : SMOKE, speed: 6, size: 0.8, life: 0.25, intensity: 1.6 });
        }
        if (pr.pierce <= 0) {
          consumed = true;
          break;
        }
        pr.pierce--;
      }
      if (consumed || pr.life <= 0) {
        if (!consumed && pr.kind === 'rocket') {
          ctx.combat.explode(pr.x, pr.z, pr.splash, pr.dmg, SMOKE, { ws: pr.ws, slot: pr.slot, secondary: false, dirx: 0, dirz: 0 });
          ctx.sfx.play('boom');
        }
        pr.alive = false;
      }
    }
  }

  private splash(pr: Proj): void {
    const ctx = this.ctx;
    ctx.fx.spawnRing(pr.tx, pr.tz, pr.splash * 0.2, pr.splash, 0.45, WATER, 1.6, 0.25);
    ctx.fx.spawnRing(pr.tx, pr.tz, 0.1, pr.splash * 0.7, 0.35, WHITE, 0.8, 0.12);
    ctx.puffs.emit({ x: pr.tx, y: 0.4, z: pr.tz, count: 22, color: WATER, speed: pr.splash * 3.2, size: 1.2, life: 0.7, gravity: 14, up: 0.6 });
    for (const f of ctx.fish.near(pr.tx, pr.tz, pr.splash, this.buf).slice()) {
      const l = Math.hypot(f.x - pr.tx, f.z - pr.tz) || 1;
      ctx.combat.hit(f, pr.dmg, { ws: pr.ws, slot: pr.slot, secondary: false, dirx: (f.x - pr.tx) / l, dirz: (f.z - pr.tz) / l });
    }
    ctx.sfx.play('splash');
  }

  private updateRings(dt: number): void {
    const ctx = this.ctx;
    const pl = ctx.player;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      if (r.delay > 0) {
        r.delay -= dt;
        continue;
      }
      // リングはペリカンについていく
      r.x = pl.x;
      r.z = pl.z;
      const prev = r.r;
      r.r = Math.min(r.maxR, r.r + r.speed * dt);
      const k = r.r / r.maxR;
      const col = r.tint.equals(WHITE) ? FROST_COLOR : r.tint.clone().multiplyScalar(1.8);
      ctx.fx.ring(r.x, 0.2, r.z, r.r, col, 1.2 * (1 - k * 0.7), 0.16);
      ctx.fx.ring(r.x, 0.15, r.z, r.r, col, 0.25 * (1 - k), 1.0, 0.3);
      // 撃破で魚のリストが入れ替わるので、先に命中対象を集めてから処理する
      const hits = this.targets;
      hits.length = 0;
      for (const f of ctx.fish.list) {
        if (r.hit.has(f.uid)) continue;
        const d = Math.hypot(f.x - r.x, f.z - r.z);
        if (d <= r.r + f.radius && d >= prev - f.radius - 1) {
          r.hit.add(f.uid);
          hits.push(f);
        }
      }
      for (const f of hits) {
        const l = Math.hypot(f.x - r.x, f.z - r.z) || 1;
        ctx.combat.hit(f, r.ws.damage, { ws: r.ws, slot: WEAPON_IDS.indexOf('bell'), secondary: false, dirx: (f.x - r.x) / l, dirz: (f.z - r.z) / l });
      }
      ctx.bullets.clearCircle(r.x, r.z, r.r, (x, z) => {
        if (Math.random() < 0.5) ctx.sparks.emit({ x, y: 0.3, z, count: 2, color: FROST_COLOR, speed: 3, size: 0.8, life: 0.3 });
      });
      if (r.r >= r.maxR) this.rings.splice(i, 1);
    }
  }

  private alreadyHit(pr: Proj, uid: number): boolean {
    for (let i = 0; i < pr.nh; i++) if (pr.hits[i] === uid) return true;
    return false;
  }

  private markHit(pr: Proj, uid: number): void {
    pr.hits[pr.nh % MAX_HITS] = uid;
    pr.nh = Math.min(pr.nh + 1, MAX_HITS);
  }

  render(): void {
    const counts: Record<ProjKind, number> = { glove: 0, rocket: 0, bomb: 0, drop: 0 };
    for (const pr of this.projs) {
      if (!pr.alive) continue;
      const mesh = this.meshes[pr.kind];
      const i = counts[pr.kind]++;
      const yaw = pr.kind === 'bomb' ? this.ctx.time * 3 : Math.atan2(pr.vx, pr.vz);
      this.e.set(0, yaw, pr.kind === 'rocket' ? this.ctx.time * 12 : 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(pr.x, pr.y, pr.z), this.q, this.s.setScalar(pr.scale));
      mesh.setMatrixAt(i, this.m);
      mesh.setColorAt(i, pr.tint);
    }
    for (const k of PROJ_KINDS) {
      const mesh = this.meshes[k];
      mesh.count = counts[k];
      if (counts[k] > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}
