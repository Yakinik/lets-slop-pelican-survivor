import type { SpeciesId } from './fishSpecies';
import { BOSSES, type BossDef } from './FishSystem';
import type { GameContext } from './context';

export type PatternId =
  | 'ring' | 'ringGap' | 'doubleRing' | 'spiral' | 'stream' | 'wall' | 'fan' | 'cross'
  | 'school' | 'marlins' | 'rays' | 'anglers' | 'puffers' | 'sharks';

interface Phase {
  at: number;
  /** 追跡してくる魚の出現数（毎秒） */
  rate: number;
  mix: [SpeciesId, number][];
  /** 弾幕パターンの間隔（秒） */
  every: number;
  patterns: [PatternId, number][];
}

/** 時間表。at 秒以降はその段階の設定で出現する */
const PHASES: Phase[] = [
  { at: 0, rate: 1.1, mix: [['iwashi', 1]], every: 9, patterns: [['ring', 1]] },
  { at: 40, rate: 1.5, mix: [['iwashi', 3], ['aji', 1]], every: 8, patterns: [['ring', 2], ['stream', 1], ['fan', 1]] },
  { at: 90, rate: 1.9, mix: [['iwashi', 3], ['aji', 2], ['tobiuo', 1]], every: 7.5, patterns: [['ringGap', 2], ['stream', 1], ['wall', 1], ['school', 1]] },
  { at: 150, rate: 2.3, mix: [['iwashi', 2], ['aji', 2], ['tobiuo', 1], ['tai', 1]], every: 7, patterns: [['ringGap', 1], ['spiral', 2], ['wall', 1], ['fan', 1], ['puffers', 1]] },
  { at: 220, rate: 2.7, mix: [['aji', 2], ['tobiuo', 1], ['tai', 2], ['fugu', 0.5]], every: 6.5, patterns: [['spiral', 1], ['marlins', 1], ['doubleRing', 1], ['cross', 1], ['school', 1]] },
  { at: 330, rate: 3.1, mix: [['aji', 1], ['tobiuo', 1], ['tai', 2], ['fugu', 1]], every: 6, patterns: [['rays', 1], ['anglers', 1], ['marlins', 1], ['spiral', 1], ['wall', 1]] },
  { at: 420, rate: 3.5, mix: [['tai', 2], ['fugu', 1], ['tobiuo', 1], ['aji', 1], ['same', 0.15]], every: 5.5, patterns: [['rays', 1], ['anglers', 1], ['doubleRing', 1], ['cross', 1], ['sharks', 0.5]] },
  { at: 510, rate: 3.9, mix: [['tai', 2], ['fugu', 1], ['tobiuo', 1], ['same', 0.25]], every: 5, patterns: [['spiral', 1], ['marlins', 1], ['rays', 1], ['anglers', 1], ['cross', 1], ['sharks', 0.6]] },
  { at: 630, rate: 4.4, mix: [['tai', 2], ['fugu', 1.2], ['tobiuo', 1], ['same', 0.35], ['aji', 1]], every: 4.5, patterns: [['doubleRing', 1], ['spiral', 1], ['marlins', 1], ['rays', 1], ['anglers', 1], ['sharks', 1], ['cross', 1]] },
  { at: 780, rate: 5.0, mix: [['tai', 2], ['fugu', 1.5], ['same', 0.5], ['tobiuo', 1]], every: 4, patterns: [['doubleRing', 1], ['spiral', 1], ['marlins', 1], ['rays', 1], ['anglers', 1], ['sharks', 1], ['cross', 1], ['wall', 1]] },
];

const BOSS_TIMES: [number, BossDef][] = [
  [300, BOSSES.kingKajiki],
  [600, BOSSES.nushiFugu],
  [900, BOSSES.megalodon],
];

/** 時間差で 1 匹ずつ出す照準ストリーム */
interface Emitter {
  x: number;
  z: number;
  species: SpeciesId;
  left: number;
  interval: number;
  timer: number;
  speed: number;
}

function pick<T>(list: [T, number][]): T {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of list) {
    r -= w;
    if (r < 0) return v;
  }
  return list[list.length - 1][0];
}

export class Director {
  /** 最後に出現させたボス（UI 表示用） */
  onBoss: ((def: BossDef) => void) | null = null;
  private chaseAcc = 0;
  private patternTimer = 4;
  private bossIdx = 0;
  private readonly emitters: Emitter[] = [];

  constructor(private readonly ctx: GameContext) {}

  reset(): void {
    this.chaseAcc = 0;
    this.patternTimer = 4;
    this.bossIdx = 0;
    this.emitters.length = 0;
  }

  get phase(): Phase {
    let ph = PHASES[0];
    for (const p of PHASES) if (this.ctx.time >= p.at) ph = p;
    return ph;
  }

  /** 次のボスまでの秒数（いなければ null） */
  get nextBossIn(): number | null {
    const b = BOSS_TIMES[this.bossIdx];
    return b ? b[0] - this.ctx.time : null;
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const ph = this.phase;
    const bossAlive = ctx.fish.bosses.length > 0;
    const busy = bossAlive ? 0.45 : 1;
    const cap = 560;

    // 追跡してくる魚
    this.chaseAcc += ph.rate * busy * dt;
    while (this.chaseAcc >= 1) {
      this.chaseAcc -= 1;
      if (ctx.fish.count < cap) this.spawnChaser(pick(ph.mix));
    }

    // 弾幕パターン
    this.patternTimer -= dt;
    if (this.patternTimer <= 0) {
      this.patternTimer = ph.every * (bossAlive ? 1.8 : 1) * (0.85 + Math.random() * 0.3);
      if (ctx.fish.count < cap) this.runPattern(pick(ph.patterns));
    }

    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.timer -= dt;
      while (e.timer <= 0 && e.left > 0) {
        e.timer += e.interval;
        e.left--;
        const p = ctx.player;
        const l = Math.hypot(p.x - e.x, p.z - e.z) || 1;
        ctx.fish.spawn(e.species, e.x, e.z, { move: 'straight', dirx: (p.x - e.x) / l, dirz: (p.z - e.z) / l, speed: e.speed, lifetime: 9 });
      }
      if (e.left <= 0) this.emitters.splice(i, 1);
    }

    const next = BOSS_TIMES[this.bossIdx];
    if (next && ctx.time >= next[0]) {
      this.bossIdx++;
      const a = Math.random() * Math.PI * 2;
      const r = ctx.spawnRadius * 0.9;
      const f = ctx.fish.spawnBoss(next[1], ctx.player.x + Math.cos(a) * r, ctx.player.z + Math.sin(a) * r);
      if (f) this.onBoss?.(next[1]);
    }
  }

  private edgePoint(angle: number, r = this.ctx.spawnRadius): [number, number] {
    const p = this.ctx.player;
    return [p.x + Math.cos(angle) * r, p.z + Math.sin(angle) * r];
  }

  private spawnChaser(id: SpeciesId): void {
    const a = Math.random() * Math.PI * 2;
    const [x, z] = this.edgePoint(a);
    if (id === 'ei') {
      this.rays(1);
      return;
    }
    this.ctx.fish.spawn(id, x, z);
  }

  /** ボスが呼ぶ: プレイヤーを囲むリング */
  summonRing(id: SpeciesId, n: number, r: number, speed: number): void {
    this.ring(id, n, r, speed, false);
  }

  runPattern(id: PatternId): void {
    const p = this.ctx.player;
    const minutes = this.ctx.time / 60;
    const dens = 1 + Math.min(1.2, minutes * 0.1);
    const R = this.ctx.spawnRadius;
    switch (id) {
      case 'ring':
        this.ring('iwashi', Math.round(16 * dens), R, 8, false);
        break;
      case 'ringGap':
        this.ring(minutes > 3 ? 'aji' : 'iwashi', Math.round(20 * dens), R, 8.5, true);
        break;
      case 'doubleRing':
        this.ring('iwashi', Math.round(18 * dens), R, 8, true);
        this.ring('sanma', Math.round(14 * dens), R + 10, 10, true);
        break;
      case 'spiral': {
        const arms = 3 + Math.floor(Math.random() * 2);
        const per = Math.round(7 * dens);
        const dir = Math.random() < 0.5 ? 1 : -1;
        const base = Math.random() * Math.PI * 2;
        for (let a = 0; a < arms; a++) {
          for (let k = 0; k < per; k++) {
            const ang = base + (a / arms) * Math.PI * 2 + k * 0.28 * dir;
            const r = R + k * 3.2;
            this.ctx.fish.spawn('iwashi', p.x + Math.cos(ang) * r, p.z + Math.sin(ang) * r, {
              move: 'spiral', cx: p.x, cz: p.z, a: 9 * dir, b: 5.5, lifetime: 14,
            });
          }
        }
        break;
      }
      case 'stream': {
        const [x, z] = this.edgePoint(Math.random() * Math.PI * 2);
        this.emitters.push({ x, z, species: 'sanma', left: Math.round(10 * dens), interval: 0.14, timer: 0, speed: 17 });
        break;
      }
      case 'cross': {
        const base = Math.random() * Math.PI * 2;
        for (let k = 0; k < 4; k++) {
          const [x, z] = this.edgePoint(base + (k / 4) * Math.PI * 2);
          this.emitters.push({ x, z, species: 'sanma', left: Math.round(7 * dens), interval: 0.18, timer: k * 0.25, speed: 15 });
        }
        break;
      }
      case 'wall': {
        // 画面の端から平行に進む壁。1 か所だけ抜け道がある
        const a = Math.random() * Math.PI * 2;
        const dx = -Math.cos(a);
        const dz = -Math.sin(a);
        const px = -dz;
        const pz = dx;
        const n = Math.round(22 * dens);
        const gap = Math.floor(n * (0.3 + Math.random() * 0.4));
        const spacing = 2.4;
        for (let k = 0; k < n; k++) {
          if (Math.abs(k - gap) <= 1) continue;
          const off = (k - n / 2) * spacing;
          this.ctx.fish.spawn('sanma', p.x - dx * R + px * off, p.z - dz * R + pz * off, {
            move: 'straight', dirx: dx, dirz: dz, speed: 11, lifetime: (R * 2.4) / 11,
          });
        }
        break;
      }
      case 'fan': {
        const a = Math.random() * Math.PI * 2;
        const [x, z] = this.edgePoint(a);
        const toP = Math.atan2(p.x - x, p.z - z);
        const n = Math.round(7 * dens);
        for (let k = 0; k < n; k++) {
          const ang = toP + (k - (n - 1) / 2) * 0.13;
          this.ctx.fish.spawn('aji', x, z, { move: 'straight', dirx: Math.sin(ang), dirz: Math.cos(ang), speed: 10, lifetime: 10 });
        }
        break;
      }
      case 'school': {
        const a = Math.random() * Math.PI * 2;
        const n = Math.round(6 * dens);
        for (let k = 0; k < n; k++) {
          const [x, z] = this.edgePoint(a + (k - n / 2) * 0.09, R + (k % 2) * 3);
          this.ctx.fish.spawn('tobiuo', x, z);
        }
        break;
      }
      case 'marlins': {
        const n = 2 + Math.floor(minutes / 5);
        const base = Math.random() * Math.PI * 2;
        for (let k = 0; k < n; k++) {
          const [x, z] = this.edgePoint(base + (k / n) * Math.PI * 2);
          this.ctx.fish.spawn('kajiki', x, z);
        }
        break;
      }
      case 'rays':
        this.rays(1 + Math.floor(minutes / 7));
        break;
      case 'anglers': {
        const n = 2 + Math.floor(minutes / 8);
        for (let k = 0; k < n; k++) {
          const [x, z] = this.edgePoint(Math.random() * Math.PI * 2);
          this.ctx.fish.spawn('ankou', x, z, { a: 13 + Math.random() * 5 });
        }
        break;
      }
      case 'puffers': {
        const n = 2 + Math.floor(minutes / 6);
        for (let k = 0; k < n; k++) {
          const [x, z] = this.edgePoint(Math.random() * Math.PI * 2);
          this.ctx.fish.spawn('fugu', x, z);
        }
        break;
      }
      case 'sharks': {
        const n = 1 + Math.floor(minutes / 10);
        for (let k = 0; k < n; k++) {
          const [x, z] = this.edgePoint(Math.random() * Math.PI * 2);
          this.ctx.fish.spawn('same', x, z);
        }
        break;
      }
    }
  }

  /** プレイヤーを取り囲み、中心へ一斉に向かうリング。gap なら抜け道を 1 か所空ける */
  private ring(id: SpeciesId, n: number, r: number, speed: number, gap: boolean): void {
    const p = this.ctx.player;
    const base = Math.random() * Math.PI * 2;
    const gapAt = Math.floor(Math.random() * n);
    for (let k = 0; k < n; k++) {
      if (gap && (k === gapAt || k === (gapAt + 1) % n)) continue;
      const a = base + (k / n) * Math.PI * 2;
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      this.ctx.fish.spawn(id, x, z, { move: 'straight', dirx: -Math.cos(a), dirz: -Math.sin(a), speed, lifetime: (r * 2.2) / speed });
    }
  }

  /** 画面を横切りながら泡の扇弾を撃つエイ */
  private rays(n: number): void {
    const p = this.ctx.player;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const [x, z] = this.edgePoint(a);
      // プレイヤーの近くを通り過ぎる向き
      const off = (Math.random() - 0.5) * 16;
      const tx = p.x + Math.cos(a + Math.PI / 2) * off;
      const tz = p.z + Math.sin(a + Math.PI / 2) * off;
      const l = Math.hypot(tx - x, tz - z) || 1;
      this.ctx.fish.spawn('ei', x, z, { move: 'drift', dirx: (tx - x) / l, dirz: (tz - z) / l, lifetime: 40 });
    }
  }
}
