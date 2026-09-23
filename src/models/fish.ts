import * as THREE from 'three';
import { deform, merge, part, smoothstep } from '../render/geo';
import type { SpeciesId } from '../game/fishSpecies';

/** 魚のモデル。鼻先が +z。泳ぎのパラメータは頂点シェーダで使う */
export interface FishModel {
  geometry: THREE.BufferGeometry;
  swayAmp: number;
  swayFreq: number;
  flapAmp: number;
  flapFreq: number;
  metalness: number;
  roughness: number;
}

type Pattern = (p: THREE.Vector3, out: THREE.Color) => void;

interface BodySpec {
  length: number;
  height: number;
  width: number;
  /** 尾(0)〜鼻先(1)の断面半径倍率 */
  profile?: (t: number) => number;
  back: string;
  belly: string;
  /** 背と腹の境目の高さ（-1〜1、高さに対する比率） */
  split?: number;
  /** 背と腹の境目のぼかし幅 */
  soft?: number;
  pattern?: Pattern;
  seg?: [number, number];
}

const defaultProfile = (t: number) => 0.14 + 0.86 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.75);

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 単位球を魚の胴体に変形し、背と腹の塗り分け + 模様を頂点カラーで付ける */
function body(spec: BodySpec): THREE.BufferGeometry {
  const { length: L, height: H, width: W } = spec;
  const profile = spec.profile ?? defaultProfile;
  const [ws, hs] = spec.seg ?? [18, 14];
  // z 軸方向に分割が並ぶよう、極を z 方向に向けた球を使う
  const g = new THREE.SphereGeometry(1, ws, hs).rotateX(Math.PI / 2);
  deform(g, (v) => {
    const r = Math.sqrt(Math.max(0, 1 - v.z * v.z));
    const t = (v.z + 1) / 2;
    const f = profile(t);
    const k = r > 1e-4 ? f / r : 0;
    v.set(v.x * k * W * 0.5, v.y * k * H * 0.5, v.z * L * 0.5);
  });
  const back = new THREE.Color(spec.back);
  const belly = new THREE.Color(spec.belly);
  const split = spec.split ?? 0;
  const soft = spec.soft ?? 0.35;
  return part(g, (p, _n, out) => {
    const yy = p.y / (H * 0.5);
    out.copy(belly).lerp(back, smoothstep(split - soft, split + soft, yy));
    spec.pattern?.(p, out);
  });
}

/** 胴体の位置 (z) での断面の半幅・半高 */
function sectionAt(spec: BodySpec, z: number): [number, number] {
  const t = z / spec.length + 0.5;
  const f = (spec.profile ?? defaultProfile)(Math.min(1, Math.max(0, t)));
  return [f * spec.width * 0.5, f * spec.height * 0.5];
}

/**
 * 平たいひれ。points は (後方への距離, 上方向) の組。
 * 厚みのある押し出しで両面を持たせ、縦に立てた状態で返す。
 */
function fin(points: [number, number][], color: string | Pattern, at: [number, number, number], opts: { flat?: boolean; roll?: number; yaw?: number; glow?: number } = {}): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false });
  g.translate(0, 0, -0.0125);
  // 形状の x → -z（後方）、押し出し方向 → x（左右の厚み）
  g.rotateY(Math.PI / 2);
  if (opts.flat) g.rotateZ(Math.PI / 2);
  if (opts.roll) g.rotateZ(opts.roll);
  if (opts.yaw) g.rotateY(opts.yaw);
  const colorArg = typeof color === 'string' ? color : (p: THREE.Vector3, _n: THREE.Vector3, out: THREE.Color) => color(p, out);
  return part(g, colorArg, { p: at, glow: opts.glow });
}

function eyes(spec: BodySpec, z: number, yRatio: number, size: number, white = '#f4f4f0'): THREE.BufferGeometry[] {
  const [hw, hh] = sectionAt(spec, z);
  const y = hh * yRatio;
  const x = hw * Math.sqrt(Math.max(0.05, 1 - yRatio * yRatio)) * 0.92;
  const out: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    out.push(part(new THREE.SphereGeometry(size, 10, 8), white, { p: [x * sx, y, z], s: [0.55, 1, 1] }));
    out.push(part(new THREE.SphereGeometry(size * 0.62, 10, 8), '#0b0b0f', { p: [(x + size * 0.28) * sx, y, z + size * 0.1], s: [0.55, 1, 1] }));
  }
  return out;
}

function pectorals(spec: BodySpec, z: number, len: number, color: string): THREE.BufferGeometry[] {
  const [hw, hh] = sectionAt(spec, z);
  return [-1, 1].map((sx) =>
    part(new THREE.SphereGeometry(1, 10, 6), color, {
      p: [(hw + len * 0.35) * sx, -hh * 0.35, z - len * 0.4],
      r: [0, 0.6 * sx, -0.5 * sx],
      s: [len * 0.5, 0.02, len * 0.28],
    }),
  );
}

function forkedTail(spec: BodySpec, len: number, spread: number, color: string, lowerBias = 1): THREE.BufferGeometry {
  const z0 = -spec.length / 2 + len * 0.12;
  return fin([
    [0, 0.06], [len, spread], [len * 0.62, 0], [len * lowerBias, -spread * lowerBias], [0, -0.06],
  ], color, [0, 0, z0]);
}

/** 尾ほど大きく振れる重み（aSway）と、ひれの羽ばたき重み（aFlap）を付ける */
function finish(g: THREE.BufferGeometry, spec: BodySpec, tailLen: number, flap?: (p: THREE.Vector3) => number): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const sway = new Float32Array(pos.count);
  const flapW = new Float32Array(pos.count);
  const zp = spec.length * 0.12;
  const zt = -spec.length / 2 - tailLen;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    sway[i] = Math.pow(Math.min(1, Math.max(0, (zp - v.z) / (zp - zt))), 1.6);
    flapW[i] = flap ? flap(v) : 0;
  }
  g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
  g.setAttribute('aFlap', new THREE.BufferAttribute(flapW, 1));
  g.computeBoundingSphere();
  return g;
}

const C = (hex: string) => new THREE.Color(hex);

function iwashi(): FishModel {
  const spec: BodySpec = {
    length: 1.0, height: 0.24, width: 0.17, back: '#2b7394', belly: '#e8f0f4', split: 0.1,
    pattern: (p, out) => {
      // 体側の黒い斑点列
      const k = (p.z + 0.1) / 0.11;
      if (p.z < 0.3 && p.z > -0.35 && Math.abs(p.y - 0.01) < 0.025 && Math.abs(k - Math.round(k)) < 0.22) out.set('#16242e');
    },
  };
  const g = merge([
    body(spec), forkedTail(spec, 0.26, 0.15, '#3a7f9c'),
    fin([[0, 0], [0.1, 0.1], [0.2, 0]], '#3a7f9c', [0, 0.1, 0.06]),
    ...eyes(spec, 0.36, 0.15, 0.035), ...pectorals(spec, 0.25, 0.14, '#9fc0cc'),
  ]);
  return { geometry: finish(g, spec, 0.26), swayAmp: 0.08, swayFreq: 14, flapAmp: 0, flapFreq: 0, metalness: 0.55, roughness: 0.28 };
}

function sanma(): FishModel {
  const spec: BodySpec = {
    length: 1.5, height: 0.15, width: 0.1, back: '#1f3560', belly: '#e6ebf1', split: 0.05, soft: 0.2,
    profile: (t) => 0.1 + 0.9 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.9)), 0.55) * (t > 0.85 ? 1 - (t - 0.85) * 3.5 : 1),
    pattern: (p, out) => {
      if (p.z > 0.62) out.set('#f2c84b');
    },
  };
  const g = merge([
    body(spec), forkedTail(spec, 0.2, 0.12, '#2a3f68'),
    fin([[0, 0], [0.06, 0.07], [0.14, 0]], '#2a3f68', [0, 0.06, -0.38]),
    fin([[0, 0], [0.06, -0.07], [0.14, 0]], '#2a3f68', [0, -0.06, -0.38]),
    ...eyes(spec, 0.52, 0.2, 0.028),
  ]);
  return { geometry: finish(g, spec, 0.2), swayAmp: 0.06, swayFreq: 18, flapAmp: 0, flapFreq: 0, metalness: 0.6, roughness: 0.25 };
}

function aji(): FishModel {
  const gold = C('#e2c56a');
  const spec: BodySpec = {
    length: 1.1, height: 0.34, width: 0.17, back: '#6f8a57', belly: '#f2efe2', split: 0.05,
    pattern: (p, out) => {
      const yy = p.y / 0.17;
      if (Math.abs(yy + 0.05) < 0.28) out.lerp(gold, 0.55);
      // ぜいご（側線のうろこ）
      if (p.z < 0.1 && Math.abs(yy - (p.z < -0.15 ? 0 : (p.z + 0.15) * 0.6)) < 0.08) out.set('#8c8f7a');
    },
  };
  const g = merge([
    body(spec), forkedTail(spec, 0.28, 0.18, '#c9b25c'),
    fin([[0, 0], [0.08, 0.14], [0.3, 0.05], [0.34, 0]], '#7d9361', [0, 0.14, 0.12]),
    ...eyes(spec, 0.4, 0.18, 0.05), ...pectorals(spec, 0.26, 0.18, '#d8cf9f'),
  ]);
  return { geometry: finish(g, spec, 0.28), swayAmp: 0.09, swayFreq: 11, flapAmp: 0, flapFreq: 0, metalness: 0.5, roughness: 0.3 };
}

function tobiuo(): FishModel {
  const spec: BodySpec = { length: 1.1, height: 0.22, width: 0.19, back: '#23468a', belly: '#eef2f7', split: 0.05 };
  const wing = (sx: number) =>
    fin([[0, 0], [0.1, 0.72], [0.35, 0.8], [0.62, 0.55], [0.5, 0.25], [0.45, 0]], (p, out) => {
      out.set('#6cc2f2').lerp(C('#1b5e9e'), smoothstep(0.1, 0.5, Math.abs(p.x) - 0.1));
    }, [0.08 * sx, 0.02, 0.28], { flat: true, roll: sx > 0 ? Math.PI : 0 });
  const g = merge([
    body(spec), forkedTail(spec, 0.32, 0.16, '#2c5aa0', 1.35),
    wing(1), wing(-1),
    ...eyes(spec, 0.38, 0.2, 0.045),
  ]);
  return {
    geometry: finish(g, spec, 0.32, (p) => smoothstep(0.1, 0.8, Math.abs(p.x))),
    swayAmp: 0.07, swayFreq: 12, flapAmp: 0.22, flapFreq: 9, metalness: 0.45, roughness: 0.3,
  };
}

function tai(): FishModel {
  const blue = C('#7fe0ff');
  const spec: BodySpec = {
    length: 1.3, height: 0.66, width: 0.22, back: '#e9506c', belly: '#f8cdd3', split: -0.2, soft: 0.5,
    profile: (t) => 0.12 + 0.88 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.6),
    pattern: (p, out) => {
      if (p.y > 0 && hash(Math.round(p.z * 16), Math.round(p.y * 16)) > 0.86) out.lerp(blue, 0.85);
    },
  };
  const spines: [number, number][] = [[0, 0]];
  for (let i = 0; i <= 8; i++) spines.push([i * 0.07 + 0.02, i % 2 ? 0.14 : 0.22 - i * 0.012]);
  spines.push([0.64, 0]);
  const g = merge([
    body(spec), forkedTail(spec, 0.36, 0.26, '#d9435f'),
    fin(spines, '#e04a67', [0, 0.27, 0.34]),
    fin([[0, 0], [0.18, -0.12], [0.3, 0]], '#e76a82', [0, -0.26, -0.12]),
    ...eyes(spec, 0.42, 0.25, 0.065, '#f7e3a1'), ...pectorals(spec, 0.26, 0.26, '#f08aa0'),
  ]);
  return { geometry: finish(g, spec, 0.36), swayAmp: 0.08, swayFreq: 9, flapAmp: 0, flapFreq: 0, metalness: 0.35, roughness: 0.35 };
}

function fugu(): FishModel {
  const spec: BodySpec = {
    length: 0.95, height: 0.78, width: 0.8, back: '#c9a54b', belly: '#f6f2e6', split: -0.1, soft: 0.3,
    profile: (t) => 0.2 + 0.8 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.9)), 0.45),
    pattern: (p, out) => {
      if (p.y > 0.05 && hash(Math.round(p.x * 11), Math.round(p.z * 11)) > 0.78) out.set('#4a3a22');
    },
  };
  const parts = [
    body(spec),
    fin([[0, 0.04], [0.2, 0.16], [0.24, 0], [0.2, -0.16], [0, -0.04]], '#b8913d', [0, 0, -0.43]),
    ...eyes(spec, 0.22, 0.42, 0.08),
    ...pectorals(spec, 0.12, 0.2, '#e3c878'),
  ];
  // トゲ
  const spike = new THREE.ConeGeometry(0.03, 0.14, 4);
  for (let i = 0; i < 26; i++) {
    const u = hash(i, 3.1) * 2 - 1;
    const a = hash(i, 7.7) * Math.PI * 2;
    const z = u * 0.34;
    const [hw, hh] = sectionAt(spec, z);
    const n = new THREE.Vector3(Math.cos(a) / hw, Math.sin(a) / hh, 0).normalize();
    const pos: [number, number, number] = [Math.cos(a) * hw, Math.sin(a) * hh, z];
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const e = new THREE.Euler().setFromQuaternion(q);
    parts.push(part(spike, '#efe1b5', { p: pos, r: [e.x, e.y, e.z] }));
  }
  const g = merge(parts);
  return { geometry: finish(g, spec, 0.24), swayAmp: 0.05, swayFreq: 8, flapAmp: 0, flapFreq: 0, metalness: 0.15, roughness: 0.5 };
}

function kajiki(): FishModel {
  const stripe = C('#9fd0ff');
  const spec: BodySpec = {
    length: 2.6, height: 0.55, width: 0.34, back: '#1c3c8c', belly: '#eaeff6', split: -0.1, soft: 0.25,
    pattern: (p, out) => {
      const yy = p.y / 0.27;
      if (yy > -0.3 && yy < 0.6 && Math.abs(Math.sin(p.z * 9)) > 0.86) out.lerp(stripe, 0.8);
    },
  };
  const sail: [number, number][] = [[0, 0], [-0.05, 0.62], [0.2, 0.7], [0.6, 0.48], [1.0, 0.24], [1.4, 0.1], [1.5, 0]];
  const g = merge([
    body(spec),
    // 吻（剣）
    part(new THREE.ConeGeometry(0.05, 1.1, 8), '#1a2d5e', { p: [0, 0.03, 1.72], r: [Math.PI / 2, 0, 0] }),
    // 帆のような背びれ
    fin(sail, (p, out) => out.set('#3a5bd6').lerp(C('#7d5cff'), smoothstep(0.3, 0.9, p.y)), [0, 0.2, 0.9]),
    // 三日月形の尾
    fin([[0, 0.05], [0.25, 0.62], [0.36, 0.6], [0.22, 0], [0.36, -0.6], [0.25, -0.62], [0, -0.05]], '#1f3f8f', [0, 0, -1.22]),
    ...eyes(spec, 0.95, 0.2, 0.07),
    ...pectorals(spec, 0.7, 0.4, '#33509c'),
  ]);
  return { geometry: finish(g, spec, 0.36), swayAmp: 0.1, swayFreq: 7, flapAmp: 0, flapFreq: 0, metalness: 0.5, roughness: 0.25 };
}

function ei(): FishModel {
  const top = C('#3a2e62');
  const spot = C('#eef0ff');
  const belly = C('#f3f1f6');
  const g0 = new THREE.SphereGeometry(1, 28, 12).rotateX(Math.PI / 2);
  deform(g0, (v) => {
    const ax = Math.abs(v.x);
    // ひし形の翼。翼端を後方へ流す
    v.set(v.x * 1.6 * (1 - 0.25 * Math.abs(v.z)), v.y * 0.13 * (1 - ax * 0.6), v.z * 1.05 - Math.pow(ax, 1.6) * 0.55);
  });
  const bodyGeo = part(g0, (p, n, out) => {
    if (n.y < -0.1) {
      out.copy(belly);
      return;
    }
    out.copy(top);
    if (hash(Math.round(p.x * 7), Math.round(p.z * 7)) > 0.8 && Math.abs(p.x) > 0.15) out.lerp(spot, 0.9);
  });
  const parts = [
    bodyGeo,
    // 細長い尾
    part(new THREE.CylinderGeometry(0.045, 0.012, 2.4, 6), '#2a2146', { p: [0, 0, -2.0], r: [Math.PI / 2, 0, 0] }),
    // 頭びれ
    part(new THREE.SphereGeometry(1, 8, 6), '#2e244f', { p: [0.2, 0.02, 1.02], r: [0, -0.3, 0], s: [0.06, 0.05, 0.22] }),
    part(new THREE.SphereGeometry(1, 8, 6), '#2e244f', { p: [-0.2, 0.02, 1.02], r: [0, 0.3, 0], s: [0.06, 0.05, 0.22] }),
  ];
  for (const sx of [-1, 1]) {
    parts.push(part(new THREE.SphereGeometry(0.06, 8, 6), '#0b0b10', { p: [0.3 * sx, 0.1, 0.72] }));
  }
  const g = merge(parts);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const sway = new Float32Array(pos.count);
  const flapW = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    flapW[i] = Math.pow(Math.min(1, Math.abs(x) / 1.6), 1.5);
    sway[i] = z < -0.8 ? Math.min(1, (-0.8 - z) / 2.4) : 0;
  }
  g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
  g.setAttribute('aFlap', new THREE.BufferAttribute(flapW, 1));
  return { geometry: g, swayAmp: 0.2, swayFreq: 4, flapAmp: 0.38, flapFreq: 3.2, metalness: 0.1, roughness: 0.55 };
}

function ankou(): FishModel {
  const light = C('#8e735a');
  const spec: BodySpec = {
    length: 1.4, height: 0.8, width: 1.0, back: '#5a4535', belly: '#c9b49a', split: -0.3, soft: 0.4,
    profile: (t) => 0.16 + 0.84 * Math.pow(Math.sin(Math.PI * Math.pow(t, 1.35)), 0.55),
    pattern: (p, out) => {
      if (hash(Math.round(p.x * 9), Math.round(p.z * 9)) > 0.7) out.lerp(light, 0.6);
      // 大きな口
      if (p.z > 0.46 && Math.abs(p.y + 0.05) < 0.07) out.set('#2a1414');
    },
  };
  const parts = [
    body(spec),
    fin([[0, 0.05], [0.3, 0.3], [0.36, 0], [0.3, -0.3], [0, -0.05]], '#4a372a', [0, 0, -0.62]),
    ...eyes(spec, 0.4, 0.62, 0.07, '#e8e1a6'),
    ...pectorals(spec, 0.05, 0.4, '#6b5240'),
  ];
  // 歯
  for (let i = 0; i < 9; i++) {
    const x = (i / 8 - 0.5) * 0.7;
    parts.push(part(new THREE.ConeGeometry(0.025, 0.09, 4), '#f5f2e6', { p: [x, -0.02, 0.62 - Math.abs(x) * 0.25], r: [Math.PI, 0, 0] }));
  }
  // 誘引突起（ちょうちん）
  const stalk = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.32, 0.3), new THREE.Vector3(0, 0.75, 0.45), new THREE.Vector3(0, 0.85, 0.8), new THREE.Vector3(0, 0.7, 1.0),
  ]);
  parts.push(part(new THREE.TubeGeometry(stalk, 10, 0.02, 5), '#6b5240'));
  parts.push(part(new THREE.SphereGeometry(0.11, 12, 10), '#ffe36b', { p: [0, 0.66, 1.03], glow: 1 }));
  const g = merge(parts);
  return { geometry: finish(g, spec, 0.36), swayAmp: 0.08, swayFreq: 5, flapAmp: 0, flapFreq: 0, metalness: 0.05, roughness: 0.6 };
}

function same(): FishModel {
  const spec: BodySpec = {
    length: 3.0, height: 0.62, width: 0.58, back: '#667f95', belly: '#f1f4f6', split: -0.15, soft: 0.12,
    profile: (t) => 0.1 + 0.9 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.78)), 0.62),
    pattern: (p, out) => {
      // えら
      if (p.z > 0.55 && p.z < 0.85 && p.y > -0.1 && p.y < 0.16 && Math.abs(Math.sin(p.z * 60)) > 0.9) out.set('#35495a');
    },
  };
  const g = merge([
    body(spec),
    fin([[0, 0], [0.12, 0.62], [0.3, 0.58], [0.58, 0]], '#5d7589', [0, 0.25, 0.35]),
    fin([[0, 0], [0.08, 0.2], [0.2, 0]], '#5d7589', [0, 0.15, -0.8]),
    // 上葉の長い尾
    fin([[0, 0.06], [0.5, 0.78], [0.62, 0.72], [0.34, 0.02], [0.4, -0.38], [0.3, -0.4], [0, -0.06]], '#5d7589', [0, 0.02, -1.38]),
    ...eyes(spec, 1.05, 0.3, 0.055, '#101418'),
    ...[-1, 1].map((sx) => part(new THREE.SphereGeometry(1, 10, 6), '#5d7589', {
      p: [0.42 * sx, -0.16, 0.25], r: [0, 0.5 * sx, -0.35 * sx], s: [0.55, 0.025, 0.24],
    })),
  ]);
  return { geometry: finish(g, spec, 0.6), swayAmp: 0.14, swayFreq: 5.5, flapAmp: 0, flapFreq: 0, metalness: 0.25, roughness: 0.4 };
}

export const FISH_MODELS: Record<SpeciesId, () => FishModel> = {
  iwashi, sanma, aji, tobiuo, tai, fugu, kajiki, ei, ankou, same,
};
