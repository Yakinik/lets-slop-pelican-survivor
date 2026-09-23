import * as THREE from 'three';
import { deform, merge, part, smoothstep } from '../render/geo';
import { vertexColorMaterial } from '../render/materials';

/** 海面の高さ。ゲーム中のペリカンは y = 0 を飛ぶ */
export const SEA_Y = -45;
/** 太陽の方向（太陽へ向かうベクトル） */
export const SUN_DIR = new THREE.Vector3(0.35, 0.42, -1).normalize();

const COLORS = {
  zenith: new THREE.Color('#2f6fd0'),
  horizon: new THREE.Color('#cfe6f7'),
  haze: new THREE.Color('#a9cfe8'),
  sun: new THREE.Color('#fff1d6'),
  deep: new THREE.Color('#0b4a78'),
  shallow: new THREE.Color('#1fa3b8'),
};

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uSun;
uniform vec3 uSunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.5));
  col = mix(col, uHaze, smoothstep(0.02, -0.2, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSun * (pow(sd, 900.0) * 24.0 + pow(sd, 48.0) * 0.5 + pow(sd, 5.0) * 0.16);
  col += vec3(1.0, 0.86, 0.72) * pow(1.0 - abs(h), 14.0) * 0.12;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const OCEAN_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const OCEAN_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSun;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
varying vec3 vWorld;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// 複数方向の正弦波の勾配を合成して法線を作る（頂点変位なしで軽い）
vec2 waveGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  vec2 d; float ph;
  d = normalize(vec2(1.0, 0.3));   ph = dot(d, p) * 0.11 + t * 1.0;  g += d * 0.11 * 0.9 * cos(ph);
  d = normalize(vec2(-0.4, 1.0));  ph = dot(d, p) * 0.19 + t * 1.3;  g += d * 0.19 * 0.5 * cos(ph);
  d = normalize(vec2(0.7, -0.8));  ph = dot(d, p) * 0.33 + t * 1.8;  g += d * 0.33 * 0.28 * cos(ph);
  d = normalize(vec2(-0.9, -0.2)); ph = dot(d, p) * 0.57 + t * 2.4;  g += d * 0.57 * 0.16 * cos(ph);
  d = normalize(vec2(0.2, 0.9));   ph = dot(d, p) * 0.93 + t * 3.1;  g += d * 0.93 * 0.09 * cos(ph);
  d = normalize(vec2(-0.6, 0.5));  ph = dot(d, p) * 1.55 + t * 4.0;  g += d * 1.55 * 0.05 * cos(ph);
  return g;
}

void main() {
  vec2 p = vWorld.xz;
  vec2 g = waveGrad(p, uTime);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n, v), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 r = reflect(-v, n);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(r.y, 0.0, 1.0), 0.5));

  // ゆっくり流れる雲の影と色むら
  float shade = noise(p * 0.008 + vec2(uTime * 0.01, 0.0)) * 0.6 + noise(p * 0.021 - uTime * 0.013) * 0.4;
  vec3 water = mix(uDeep, uShallow, 0.25 + 0.45 * shade + 0.25 * (n.x + n.z));
  water *= mix(0.72, 1.0, smoothstep(0.25, 0.6, shade));

  vec3 col = mix(water, sky, fres);
  float sd = max(dot(r, uSunDir), 0.0);
  col += uSun * (pow(sd, 500.0) * 8.0 + pow(sd, 40.0) * 0.18);
  // 波頭のきらめき
  float glint = step(0.985, noise(p * 1.7 + uTime * 0.7)) * smoothstep(0.2, 0.9, sd);
  col += uSun * glint * 1.5;

  float dist = length(vWorld.xz - cameraPosition.xz);
  col = mix(col, uHaze, smoothstep(220.0, 1100.0, dist));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const CLOUD_COUNT = 72;
const CLOUD_TILE = 420;

class Clouds {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private data: { x: number; y: number; z: number; s: number; rot: number; variant: number; speed: number }[] = [];
  private dummy = new THREE.Object3D();

  constructor() {
    const mat = vertexColorMaterial({ roughness: 1, envMapIntensity: 0.6 });
    const variants = [0, 1, 2].map((seed) => buildCloudGeometry(seed));
    const perVariant = Math.ceil(CLOUD_COUNT / variants.length);
    this.meshes = variants.map((g) => {
      const m = new THREE.InstancedMesh(g, mat, perVariant);
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    });
    for (let i = 0; i < CLOUD_COUNT; i++) {
      this.data.push({
        x: (Math.random() - 0.5) * CLOUD_TILE,
        y: -12 - Math.random() * 26,
        z: (Math.random() - 0.5) * CLOUD_TILE,
        s: 5 + Math.random() * 10,
        rot: Math.random() * Math.PI * 2,
        variant: i % variants.length,
        speed: 0.6 + Math.random() * 0.8,
      });
    }
  }

  update(dt: number, focus: THREE.Vector3): void {
    const counts = [0, 0, 0];
    const half = CLOUD_TILE / 2;
    for (const c of this.data) {
      c.x += c.speed * dt;
      // 注視点の周りのタイル内に巻き戻して無限に続いて見せる
      if (c.x - focus.x > half) c.x -= CLOUD_TILE;
      else if (c.x - focus.x < -half) c.x += CLOUD_TILE;
      if (c.z - focus.z > half) c.z -= CLOUD_TILE;
      else if (c.z - focus.z < -half) c.z += CLOUD_TILE;
      const d = this.dummy;
      d.position.set(c.x, c.y, c.z);
      d.rotation.set(0, c.rot, 0);
      d.scale.set(c.s, c.s * 0.8, c.s);
      d.updateMatrix();
      const mesh = this.meshes[c.variant];
      mesh.setMatrixAt(counts[c.variant]++, d.matrix);
    }
    this.meshes.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
    });
  }
}

function buildCloudGeometry(seed: number): THREE.BufferGeometry {
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const top = new THREE.Color('#ffffff');
  const bottom = new THREE.Color('#b9c9dc');
  const parts: THREE.BufferGeometry[] = [];
  const puffs = 7 + Math.floor(rnd() * 4);
  for (let i = 0; i < puffs; i++) {
    const a = (i / puffs) * Math.PI * 2 + rnd() * 0.6;
    const rad = i === 0 ? 0 : 0.5 + rnd() * 0.7;
    const r = i === 0 ? 1 : 0.45 + rnd() * 0.45;
    const geo = new THREE.IcosahedronGeometry(1, 2);
    parts.push(
      part(geo, (p, _n, out) => out.copy(bottom).lerp(top, smoothstep(-0.3, 0.7, p.y)), {
        p: [Math.cos(a) * rad, (1 - rad) * 0.35 + rnd() * 0.2, Math.sin(a) * rad * 0.7],
        s: r,
      }),
    );
  }
  // 雲底を平らにして積雲らしくする
  return deform(merge(parts), (v) => {
    if (v.y < -0.1) v.y = -0.1 + (v.y + 0.1) * 0.25;
  });
}

export class World {
  readonly sky: THREE.Mesh;
  readonly ocean: THREE.Mesh;
  readonly clouds = new Clouds();
  private oceanMat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uZenith: { value: COLORS.zenith },
        uHorizon: { value: COLORS.horizon },
        uHaze: { value: COLORS.haze },
        uSun: { value: COLORS.sun },
        uSunDir: { value: SUN_DIR },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;

    this.oceanMat = new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: SUN_DIR },
        uSun: { value: COLORS.sun },
        uDeep: { value: COLORS.deep },
        uShallow: { value: COLORS.shallow },
        uZenith: { value: COLORS.zenith },
        uHorizon: { value: COLORS.horizon },
        uHaze: { value: COLORS.haze },
      },
    });
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), this.oceanMat);
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = SEA_Y;
    this.ocean.frustumCulled = false;

    scene.add(this.sky, this.ocean, this.clouds.group);
    scene.fog = new THREE.Fog(COLORS.haze, 140, 700);
    scene.background = COLORS.haze;

    const hemi = new THREE.HemisphereLight('#d6ecff', '#2c6f8f', 1.25);
    const sun = new THREE.DirectionalLight('#fff0d8', 2.4);
    sun.position.copy(SUN_DIR).multiplyScalar(100);
    const rim = new THREE.DirectionalLight('#9fd4ff', 0.7);
    rim.position.set(-0.6, 0.3, 1).multiplyScalar(100);
    scene.add(hemi, sun, rim);

    // 空だけを描いた環境マップ。金属的な魚の鱗や自転車のフレームに映り込む
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(this.sky.geometry, skyMat));
    const env = pmrem.fromScene(envScene, 0.02, 0.1, 2000);
    scene.environment = env.texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();
  }

  update(dt: number, time: number, focus: THREE.Vector3, camera: THREE.Camera): void {
    this.oceanMat.uniforms.uTime.value = time;
    this.sky.position.copy(camera.position);
    this.ocean.position.x = camera.position.x;
    this.ocean.position.z = camera.position.z;
    this.clouds.update(dt, focus);
  }
}
