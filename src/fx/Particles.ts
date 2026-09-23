import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / -mv.z;
  vColor = aColor;
}`;

const FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.35, r) * vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface EmitOpts {
  x: number;
  y: number;
  z: number;
  count: number;
  color: THREE.Color;
  /** 初速の大きさ */
  speed: number;
  size: number;
  life: number;
  gravity?: number;
  drag?: number;
  /** 上向きの偏り（0 = 全方向） */
  up?: number;
  spread?: number;
  /** 色の明るさ（HDR）。1 を超えるとブルームで光る */
  intensity?: number;
}

/** CPU で更新する軽量パーティクル。上限を超えたら古いものから上書きする */
export class Particles {
  readonly points: THREE.Points;
  private readonly max: number;
  private n = 0;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly physics: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly uniforms = { uScale: { value: 400 } };

  constructor(max: number, blending: THREE.Blending) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.physics = new Float32Array(max * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending,
      premultipliedAlpha: true,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setViewportHeight(h: number, fovDeg: number): void {
    this.uniforms.uScale.value = h / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(o: EmitOpts): void {
    const inten = o.intensity ?? 1;
    for (let k = 0; k < o.count; k++) {
      const i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const up = o.up ?? 0;
      let vx = s * Math.cos(th);
      let vy = u * (1 - up) + up;
      let vz = s * Math.sin(th);
      const sp = o.speed * (0.4 + Math.random() * 0.6);
      const spread = o.spread ?? 0.3;
      vx *= sp;
      vy *= sp;
      vz *= sp;
      this.pos[i * 3] = o.x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = o.y + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 2] = o.z + (Math.random() - 0.5) * spread;
      this.vel[i * 3] = vx;
      this.vel[i * 3 + 1] = vy;
      this.vel[i * 3 + 2] = vz;
      const l = o.life * (0.6 + Math.random() * 0.4);
      this.life[i] = l;
      this.maxLife[i] = l;
      this.baseSize[i] = o.size * (0.6 + Math.random() * 0.6);
      this.col[i * 4] = o.color.r * inten;
      this.col[i * 4 + 1] = o.color.g * inten;
      this.col[i * 4 + 2] = o.color.b * inten;
      this.col[i * 4 + 3] = 1;
      this.physics[i * 2] = o.gravity ?? 0;
      this.physics[i * 2 + 1] = o.drag ?? 2;
    }
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.n--;
        this.copy(this.n, i);
        continue;
      }
      const drag = Math.exp(-this.physics[i * 2 + 1] * dt);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - this.physics[i * 2] * dt;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * t);
      this.col[i * 4 + 3] = Math.min(1, t * 1.6);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const name of ['position', 'aColor', 'aSize']) {
      const a = this.geo.attributes[name] as THREE.BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  clear(): void {
    this.n = 0;
    this.geo.setDrawRange(0, 0);
  }

  private copy(from: number, to: number): void {
    if (from === to) return;
    for (let k = 0; k < 3; k++) {
      this.pos[to * 3 + k] = this.pos[from * 3 + k];
      this.vel[to * 3 + k] = this.vel[from * 3 + k];
    }
    for (let k = 0; k < 4; k++) this.col[to * 4 + k] = this.col[from * 4 + k];
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.baseSize[to] = this.baseSize[from];
    this.size[to] = this.size[from];
    this.physics[to * 2] = this.physics[from * 2];
    this.physics[to * 2 + 1] = this.physics[from * 2 + 1];
  }
}
