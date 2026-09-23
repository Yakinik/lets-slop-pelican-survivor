import * as THREE from 'three';

/**
 * 毎フレーム描き直す「即時モード」のエフェクト。各システムが ring / beam / tornado を呼び、
 * flush() でまとめて 1 ドローコールずつ描く。時間で消えるエフェクトは spawn* で登録する。
 */

const RING_VERT = /* glsl */ `
attribute vec4 aRing;
attribute vec4 aColor;
attribute vec2 aShape;
varying vec2 vUv;
varying vec4 vColor;
varying vec2 vShape;
void main() {
  vUv = position.xy;
  vColor = aColor;
  vShape = aShape;
  vec3 p = aRing.xyz + vec3(position.x * aRing.w, 0.0, position.y * aRing.w);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const RING_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying vec2 vShape;
void main() {
  float d = length(vUv);
  float th = vShape.x;
  float soft = vShape.y;
  float outer = 1.0 - smoothstep(1.0 - soft, 1.0, d);
  float inner = smoothstep(1.0 - th - soft, 1.0 - th, d);
  float a = outer * inner * vColor.a;
  // 内側にうっすら塗り
  a += outer * (1.0 - inner) * vColor.a * 0.12 * step(0.3, th);
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const BEAM_VERT = /* glsl */ `
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aColor;
varying vec2 vUv;
varying vec4 vColor;
varying float vSeed;
varying float vLen;
void main() {
  vec3 a = aA.xyz;
  vec3 b = vec3(aB.x, aA.y, aB.z);
  vec3 d = b - a;
  float len = max(length(d), 0.0001);
  vec3 dir = d / len;
  vec3 perp = vec3(-dir.z, 0.0, dir.x);
  float along = position.x * 0.5 + 0.5;
  vec3 p = a + dir * (along * len) + perp * (position.y * aA.w * 0.5);
  vUv = vec2(along, position.y);
  vColor = aColor;
  vSeed = aB.w;
  vLen = len;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const BEAM_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec4 vColor;
varying float vSeed;
varying float vLen;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float y = vUv.y;
  // seed > 0 なら稲妻のようにジグザグさせる
  if (vSeed > 0.0) {
    float k = vUv.x * vLen * 1.3 + floor(uTime * 24.0) * 7.0 + vSeed * 13.0;
    float n = mix(hash(floor(k)), hash(floor(k) + 1.0), fract(k)) - 0.5;
    y -= n * 0.9;
  }
  float core = exp(-y * y * 18.0);
  float glow = exp(-y * y * 3.0) * 0.45;
  float ends = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x);
  float a = (core + glow) * ends * vColor.a;
  if (a < 0.003) discard;
  vec3 c = mix(vColor.rgb, vec3(1.0) * max(vColor.r, max(vColor.g, vColor.b)), core * 0.6);
  gl_FragColor = vec4(c * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const TORNADO_VERT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vUv = uv;
  vColor = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
  vColor = instanceColor;
  #endif
  vec3 p = position;
  float sw = sin(uTime * 9.0 + p.y * 3.0) * 0.08 * p.y;
  p.x += sw;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
}`;

const TORNADO_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float stripes = 0.5 + 0.5 * sin((vUv.x * 6.2831 * 3.0) + vUv.y * 10.0 - uTime * 16.0);
  float fade = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
  float a = (0.25 + 0.75 * stripes) * fade * 0.8;
  gl_FragColor = vec4(vColor * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface TimedRing {
  x: number; y: number; z: number;
  r0: number; r1: number;
  t: number; dur: number;
  color: THREE.Color; alpha: number; thickness: number;
}

interface TimedBeam {
  x1: number; z1: number; x2: number; z2: number; y: number;
  width: number; t: number; dur: number;
  color: THREE.Color; alpha: number; zigzag: boolean;
}

class InstancedQuads {
  readonly mesh: THREE.Mesh;
  readonly attrs: Record<string, THREE.InstancedBufferAttribute> = {};
  readonly geo: THREE.InstancedBufferGeometry;
  count = 0;

  constructor(readonly capacity: number, layout: Record<string, number>, mat: THREE.ShaderMaterial) {
    const base = new THREE.PlaneGeometry(2, 2);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.attributes.position);
    for (const [name, size] of Object.entries(layout)) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      this.attrs[name] = a;
      this.geo.setAttribute(name, a);
    }
    this.geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  next(): number {
    return this.count < this.capacity ? this.count++ : -1;
  }

  flush(): void {
    this.geo.instanceCount = this.count;
    for (const a of Object.values(this.attrs)) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
    this.count = 0;
  }
}

const additive = (vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform> = {}) =>
  new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: true,
    side: THREE.DoubleSide,
  });

export class Effects {
  readonly group = new THREE.Group();
  private readonly rings: InstancedQuads;
  private readonly beams: InstancedQuads;
  private readonly tornadoMesh: THREE.InstancedMesh;
  private tornadoCount = 0;
  private readonly timeU = { value: 0 };
  private readonly timedRings: TimedRing[] = [];
  private readonly timedBeams: TimedBeam[] = [];
  private readonly _m = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();
  private readonly _p = new THREE.Vector3();
  private readonly _s = new THREE.Vector3();
  private readonly _c = new THREE.Color();
  private readonly _up = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.rings = new InstancedQuads(256, { aRing: 4, aColor: 4, aShape: 2 }, additive(RING_VERT, RING_FRAG));
    this.beams = new InstancedQuads(256, { aA: 4, aB: 4, aColor: 4 }, additive(BEAM_VERT, BEAM_FRAG, { uTime: this.timeU }));
    this.rings.mesh.renderOrder = 4;
    this.beams.mesh.renderOrder = 6;

    const funnel: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      funnel.push(new THREE.Vector2(0.12 + Math.pow(t, 1.6) * 0.95, t * 2.4 - 0.6));
    }
    const tornadoGeo = new THREE.LatheGeometry(funnel, 16);
    const tornadoMat = additive(TORNADO_VERT, TORNADO_FRAG, { uTime: this.timeU });
    this.tornadoMesh = new THREE.InstancedMesh(tornadoGeo, tornadoMat, 24);
    this.tornadoMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(24 * 3), 3);
    this.tornadoMesh.frustumCulled = false;
    this.tornadoMesh.count = 0;
    this.tornadoMesh.renderOrder = 6;

    this.group.add(this.rings.mesh, this.beams.mesh, this.tornadoMesh);
  }

  /** 水平なリング。thickness は半径に対する帯の太さ（1 で円盤） */
  ring(x: number, y: number, z: number, radius: number, color: THREE.Color, alpha: number, thickness = 0.12, soft = 0.06): void {
    const i = this.rings.next();
    if (i < 0) return;
    const { aRing, aColor, aShape } = this.rings.attrs;
    aRing.setXYZW(i, x, y, z, radius);
    aColor.setXYZW(i, color.r, color.g, color.b, alpha);
    aShape.setXY(i, thickness, soft);
  }

  beam(x1: number, z1: number, x2: number, z2: number, y: number, width: number, color: THREE.Color, alpha: number, zigzag = false): void {
    const i = this.beams.next();
    if (i < 0) return;
    const { aA, aB, aColor } = this.beams.attrs;
    aA.setXYZW(i, x1, y, z1, width);
    aB.setXYZW(i, x2, 0, z2, zigzag ? 1 + Math.random() * 10 : 0);
    aColor.setXYZW(i, color.r, color.g, color.b, alpha);
  }

  tornado(x: number, y: number, z: number, scale: number, spin: number, color: THREE.Color): void {
    if (this.tornadoCount >= 24) return;
    const i = this.tornadoCount++;
    this._q.setFromAxisAngle(this._up, spin);
    this._m.compose(this._p.set(x, y, z), this._q, this._s.set(scale, scale, scale));
    this.tornadoMesh.setMatrixAt(i, this._m);
    this.tornadoMesh.setColorAt(i, color);
  }

  spawnRing(x: number, z: number, r0: number, r1: number, dur: number, color: THREE.ColorRepresentation, alpha = 1, thickness = 0.15, y = 0.1): void {
    this.timedRings.push({ x, y, z, r0, r1, t: 0, dur, color: new THREE.Color(color), alpha, thickness });
  }

  spawnBeam(x1: number, z1: number, x2: number, z2: number, width: number, dur: number, color: THREE.ColorRepresentation, alpha = 1, zigzag = false, y = 0.3): void {
    this.timedBeams.push({ x1, z1, x2, z2, y, width, t: 0, dur, color: new THREE.Color(color), alpha, zigzag });
  }

  update(dt: number, time: number): void {
    this.timeU.value = time;
    for (let i = this.timedRings.length - 1; i >= 0; i--) {
      const r = this.timedRings[i];
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        this.timedRings.splice(i, 1);
        continue;
      }
      const ease = 1 - Math.pow(1 - k, 3);
      this.ring(r.x, r.y, r.z, r.r0 + (r.r1 - r.r0) * ease, r.color, r.alpha * (1 - k), r.thickness);
    }
    for (let i = this.timedBeams.length - 1; i >= 0; i--) {
      const b = this.timedBeams[i];
      b.t += dt;
      const k = b.t / b.dur;
      if (k >= 1) {
        this.timedBeams.splice(i, 1);
        continue;
      }
      this.beam(b.x1, b.z1, b.x2, b.z2, b.y, b.width * (1 - k * 0.5), b.color, b.alpha * (1 - k), b.zigzag);
    }
  }

  /** 描画直前に呼ぶ。今フレームに積まれた分を GPU へ送り、次のフレームに備えて空にする */
  flush(): void {
    this.rings.flush();
    this.beams.flush();
    this.tornadoMesh.count = this.tornadoCount;
    if (this.tornadoCount > 0) {
      this.tornadoMesh.instanceMatrix.needsUpdate = true;
      if (this.tornadoMesh.instanceColor) this.tornadoMesh.instanceColor.needsUpdate = true;
    }
    this.tornadoCount = 0;
  }

  clear(): void {
    this.timedRings.length = 0;
    this.timedBeams.length = 0;
  }

  get tmpColor(): THREE.Color {
    return this._c;
  }
}
