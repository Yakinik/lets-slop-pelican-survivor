import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type Vec3 = [number, number, number];
export type ColorFn = (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void;

export interface PartOpts {
  p?: Vec3;
  /** Euler XYZ（ラジアン） */
  r?: Vec3;
  s?: Vec3 | number;
  /** 1 で頂点カラーがそのまま発光する */
  glow?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * 結合用の部品を作る。すべて非インデックス化し、position / normal / color / aGlow の
 * 同じ属性セットに揃えるので、どの部品同士でも mergeGeometries できる。
 */
export function part(src: THREE.BufferGeometry, color: THREE.ColorRepresentation | ColorFn, opts: PartOpts = {}): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  const s = opts.s ?? 1;
  _pos.set(...(opts.p ?? [0, 0, 0]));
  _q.setFromEuler(_e.set(...(opts.r ?? [0, 0, 0])));
  if (typeof s === 'number') _scl.setScalar(s);
  else _scl.set(...s);
  g.applyMatrix4(_m.compose(_pos, _q, _scl));

  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  if (typeof color === 'function') {
    for (let i = 0; i < n; i++) {
      _v.fromBufferAttribute(pos, i);
      _n.fromBufferAttribute(nor, i);
      color(_v, _n, _c);
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
  } else {
    _c.set(color);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(opts.glow ?? 0), 1));
  return g;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('mergeGeometries failed: attribute sets differ');
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

/** 頂点位置を関数で変形する（法線は滑らかに再計算） */
export function deform(g: THREE.BufferGeometry, fn: (v: THREE.Vector3) => void): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    fn(_v);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  if (!g.index) smoothNormals(g);
  return g;
}

/**
 * 非インデックスのジオメトリは computeVertexNormals が面法線になるため、
 * 同じ位置にある頂点の法線を平均してスムーズシェーディングにする。
 */
export function smoothNormals(g: THREE.BufferGeometry): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const sums = new Map<string, THREE.Vector3>();
  const key = (i: number) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    let s = sums.get(k);
    if (!s) sums.set(k, (s = new THREE.Vector3()));
    s.x += nor.getX(i);
    s.y += nor.getY(i);
    s.z += nor.getZ(i);
  }
  for (const s of sums.values()) s.normalize();
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(key(i))!;
    nor.setXYZ(i, s.x, s.y, s.z);
  }
  nor.needsUpdate = true;
}

/** 位置から決まる 0〜1 の擬似乱数。重複した頂点が同じ値になるので変形しても面が割れない */
export function hash3(v: THREE.Vector3): number {
  const s = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

export const lerpColor = (a: THREE.Color, b: THREE.Color, t: number, out: THREE.Color) =>
  out.copy(a).lerp(b, Math.min(1, Math.max(0, t)));

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
