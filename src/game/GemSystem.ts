import * as THREE from 'three';
import { SPECIES, SPECIES_IDS, type SpeciesId } from './fishSpecies';
import type { GameContext } from './context';

const MAX_GEMS = 600;
const BASE_MAGNET = 4.5;
/** ボスの宝玉は魚種の後ろの番号 */
export const BOSS_GEM = SPECIES_IDS.length;

interface GemType {
  color: THREE.Color;
  tier: number;
  scale: number;
}

const TYPES: GemType[] = [
  ...SPECIES_IDS.map((id) => ({ color: new THREE.Color(SPECIES[id].gem.color), tier: SPECIES[id].gem.tier, scale: 1 })),
  { color: new THREE.Color('#ffffff'), tier: 3, scale: 2.2 },
];

function gemMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 0.25, flatShading: true, envMapIntensity: 1.5 });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vColor.rgb * 0.9;',
    );
  };
  mat.customProgramCacheKey = () => 'gem-v2';
  return mat;
}

export class GemSystem {
  readonly group = new THREE.Group();
  /** 回収したときに呼ばれる（経験値, 種類） */
  onCollect: ((xp: number, type: number) => void) | null = null;
  private n = 0;
  private readonly x = new Float32Array(MAX_GEMS);
  private readonly z = new Float32Array(MAX_GEMS);
  private readonly vx = new Float32Array(MAX_GEMS);
  private readonly vz = new Float32Array(MAX_GEMS);
  private readonly age = new Float32Array(MAX_GEMS);
  private readonly value = new Float32Array(MAX_GEMS);
  private readonly type = new Uint8Array(MAX_GEMS);
  private readonly pulled = new Uint8Array(MAX_GEMS);
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(private readonly ctx: GameContext) {
    const geos = [
      new THREE.OctahedronGeometry(0.38, 0).scale(1, 1.45, 1),
      new THREE.OctahedronGeometry(0.48, 0).scale(1, 1.5, 1),
      new THREE.IcosahedronGeometry(0.55, 0),
      new THREE.DodecahedronGeometry(0.72, 0),
    ];
    const mat = gemMaterial();
    for (const g of geos) {
      const mesh = new THREE.InstancedMesh(g, mat, MAX_GEMS);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GEMS * 3), 3);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  get count(): number {
    return this.n;
  }

  drop(species: SpeciesId | 'boss', x: number, z: number, xp?: number): void {
    const t = species === 'boss' ? BOSS_GEM : SPECIES_IDS.indexOf(species);
    const value = xp ?? SPECIES[species as SpeciesId].gem.xp;
    if (this.n >= MAX_GEMS) {
      // 上限に達したら同じ種類の既存ジェムに価値を合算する
      for (let i = 0; i < this.n; i++) {
        if (this.type[i] === t) {
          this.value[i] += value;
          return;
        }
      }
      this.value[0] += value;
      return;
    }
    const i = this.n++;
    const a = Math.random() * Math.PI * 2;
    const sp = 2 + Math.random() * 3;
    this.x[i] = x;
    this.z[i] = z;
    this.vx[i] = Math.cos(a) * sp;
    this.vz[i] = Math.sin(a) * sp;
    this.age[i] = 0;
    this.value[i] = value;
    this.type[i] = t;
    this.pulled[i] = 0;
  }

  /** 最も近いジェムの位置（なければ null） */
  nearest(x: number, z: number, out: { x: number; z: number }): boolean {
    let bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < bd) {
        bd = d;
        out.x = this.x[i];
        out.z = this.z[i];
      }
    }
    return bd < Infinity;
  }

  /** すべてのジェムを吸い寄せる */
  vacuum(): void {
    this.pulled.fill(1, 0, this.n);
  }

  clear(): void {
    this.n = 0;
    for (const m of this.meshes) m.count = 0;
  }

  update(dt: number): void {
    const p = this.ctx.player;
    const magnet = BASE_MAGNET * p.stats.magnet;
    const m2 = magnet * magnet;
    for (let i = this.n - 1; i >= 0; i--) {
      this.age[i] += dt;
      const dx = p.x - this.x[i];
      const dz = p.z - this.z[i];
      const d2 = dx * dx + dz * dz;
      if (!this.pulled[i] && d2 < m2 && this.age[i] > 0.25) this.pulled[i] = 1;
      if (this.pulled[i]) {
        // 加速しながらまっすぐプレイヤーへ向かう
        const d = Math.sqrt(d2) || 1;
        const sp = Math.min(34, Math.hypot(this.vx[i], this.vz[i]) + 60 * dt);
        this.vx[i] = (dx / d) * sp;
        this.vz[i] = (dz / d) * sp;
        if (d < 1.0) {
          this.onCollect?.(this.value[i], this.type[i]);
          this.remove(i);
          continue;
        }
      } else {
        const k = Math.exp(-4 * dt);
        this.vx[i] *= k;
        this.vz[i] *= k;
      }
      this.x[i] += this.vx[i] * dt;
      this.z[i] += this.vz[i] * dt;
    }
  }

  private remove(i: number): void {
    const l = --this.n;
    this.x[i] = this.x[l];
    this.z[i] = this.z[l];
    this.vx[i] = this.vx[l];
    this.vz[i] = this.vz[l];
    this.age[i] = this.age[l];
    this.value[i] = this.value[l];
    this.type[i] = this.type[l];
    this.pulled[i] = this.pulled[l];
  }

  render(time: number): void {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < this.n; i++) {
      const ty = TYPES[this.type[i]];
      const mesh = this.meshes[ty.tier];
      const k = counts[ty.tier]++;
      const grow = Math.min(1, this.age[i] * 5);
      const merged = Math.min(1.8, 1 + Math.log10(Math.max(1, this.value[i] / (SPECIES[SPECIES_IDS[this.type[i]]]?.gem.xp ?? this.value[i]))) * 0.4);
      const s = ty.scale * grow * merged;
      this.e.set(0.3, time * 2.2 + i * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(this.x[i], 0.5 + Math.sin(time * 3 + i) * 0.18, this.z[i]), this.q, this.s.set(s, s, s));
      mesh.setMatrixAt(k, this.m);
      if (this.type[i] === BOSS_GEM) this.c.setHSL((time * 0.3 + i * 0.1) % 1, 0.9, 0.62);
      else this.c.copy(ty.color);
      mesh.setColorAt(k, this.c);
    }
    this.meshes.forEach((m, t) => {
      m.count = counts[t];
      if (counts[t] > 0) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    });
  }
}
