import * as THREE from 'three';
import type { GameContext } from './context';

export type BulletKind = 'spine' | 'bubble' | 'orb' | 'tooth';

interface BulletStyle {
  color: THREE.Color;
  radius: number;
  damage: number;
  /** 進行方向への伸び */
  stretch: number;
}

const STYLES: Record<BulletKind, BulletStyle> = {
  spine: { color: new THREE.Color('#ffd23f').multiplyScalar(2.2), radius: 0.32, damage: 8, stretch: 2.4 },
  bubble: { color: new THREE.Color('#5fe6ff').multiplyScalar(2.2), radius: 0.45, damage: 9, stretch: 1 },
  orb: { color: new THREE.Color('#ff5bd1').multiplyScalar(2.4), radius: 0.38, damage: 9, stretch: 1 },
  tooth: { color: new THREE.Color('#ff4d4d').multiplyScalar(2.3), radius: 0.36, damage: 11, stretch: 1.8 },
};

const MAX_BULLETS = 1000;
const LIFE = 9;

const VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vColor;
void main() {
  vColor = instanceColor;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vColor;
void main() {
  float f = 1.0 - max(dot(normalize(vN), normalize(vV)), 0.0);
  vec3 core = vec3(2.2);
  vec3 c = mix(core, vColor, smoothstep(0.05, 0.55, f));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** 構造体の配列（SoA）で持つ敵弾 */
export class BulletSystem {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly x = new Float32Array(MAX_BULLETS);
  private readonly z = new Float32Array(MAX_BULLETS);
  private readonly vx = new Float32Array(MAX_BULLETS);
  private readonly vz = new Float32Array(MAX_BULLETS);
  private readonly life = new Float32Array(MAX_BULLETS);
  private readonly kind = new Uint8Array(MAX_BULLETS);
  private readonly kinds = Object.keys(STYLES) as BulletKind[];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(private readonly ctx: GameContext) {
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat, MAX_BULLETS);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BULLETS * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  get count(): number {
    return this.n;
  }

  fire(x: number, z: number, angle: number, speed: number, kind: BulletKind): void {
    if (this.n >= MAX_BULLETS) return;
    const i = this.n++;
    this.x[i] = x;
    this.z[i] = z;
    this.vx[i] = Math.sin(angle) * speed;
    this.vz[i] = Math.cos(angle) * speed;
    this.life[i] = LIFE;
    this.kind[i] = this.kinds.indexOf(kind);
  }

  private kill(i: number): void {
    const last = --this.n;
    this.x[i] = this.x[last];
    this.z[i] = this.z[last];
    this.vx[i] = this.vx[last];
    this.vz[i] = this.vz[last];
    this.life[i] = this.life[last];
    this.kind[i] = this.kind[last];
  }

  /** 中心から半径 r 以内の弾を消す（フロストベルやボス撃破時）。消した数を返す */
  clearCircle(cx: number, cz: number, r: number, onClear?: (x: number, z: number) => void): number {
    let cleared = 0;
    const r2 = r * r;
    for (let i = this.n - 1; i >= 0; i--) {
      const dx = this.x[i] - cx;
      const dz = this.z[i] - cz;
      if (dx * dx + dz * dz <= r2) {
        onClear?.(this.x[i], this.z[i]);
        this.kill(i);
        cleared++;
      }
    }
    return cleared;
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
  }

  update(dt: number): void {
    const p = this.ctx.player;
    const far = this.ctx.spawnRadius + 30;
    for (let i = this.n - 1; i >= 0; i--) {
      this.life[i] -= dt;
      this.x[i] += this.vx[i] * dt;
      this.z[i] += this.vz[i] * dt;
      const dx = this.x[i] - p.x;
      const dz = this.z[i] - p.z;
      const st = STYLES[this.kinds[this.kind[i]]];
      const rr = st.radius + p.hitRadius * 0.8;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        if (p.hurt(st.damage * this.ctx.bulletMul)) {
          this.ctx.shake(0.35);
          this.ctx.sfx.play('hurt');
        }
        this.ctx.sparks.emit({ x: this.x[i], y: 0.3, z: this.z[i], count: 6, color: st.color, speed: 5, size: 0.8, life: 0.3 });
        this.kill(i);
        continue;
      }
      if (this.life[i] <= 0 || d2 > far * far) this.kill(i);
    }
  }

  render(time: number): void {
    const arr = this.mesh.instanceMatrix.array as Float32Array;
    const col = this.mesh.instanceColor!.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      const st = STYLES[this.kinds[this.kind[i]]];
      const pulse = 1 + Math.sin(time * 12 + i) * 0.08;
      const r = st.radius * pulse;
      this.e.set(0, Math.atan2(this.vx[i], this.vz[i]), 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(this.x[i], 0.3, this.z[i]), this.q, this.s.set(r, r, r * st.stretch));
      this.m.toArray(arr, i * 16);
      col[i * 3] = st.color.r;
      col[i * 3 + 1] = st.color.g;
      col[i * 3 + 2] = st.color.b;
    }
    this.mesh.count = this.n;
    if (this.n > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, this.n * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor!.clearUpdateRanges();
      this.mesh.instanceColor!.addUpdateRange(0, this.n * 3);
      this.mesh.instanceColor!.needsUpdate = true;
    }
  }
}
