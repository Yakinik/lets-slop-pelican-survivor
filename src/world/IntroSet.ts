import * as THREE from 'three';
import { deform, hash3, merge, part, smoothstep } from '../render/geo';
import { vertexColorMaterial } from '../render/materials';
import { SEA_Y } from './World';

/** ペリカンが走り出す桟橋。-z 方向へ伸び、先端 (z = endZ) から飛び立つ */
export const PIER = {
  startZ: 66,
  endZ: 0,
  deckY: SEA_Y + 2.2,
  width: 4.2,
} as const;

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function buildIntroSet(): THREE.Mesh {
  const rnd = rng(1234);
  const parts: THREE.BufferGeometry[] = [];
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
  const woods = ['#a8743f', '#94643a', '#b98449', '#8a5b31'];
  const { startZ, endZ, deckY, width } = PIER;

  // 桟橋の板
  for (let z = endZ + 0.3; z < startZ + 6; z += 0.62) {
    parts.push(part(box, woods[Math.floor(rnd() * woods.length)], { p: [0, deckY - 0.1, z], s: [width, 0.2, 0.56] }));
  }
  for (const x of [-1.7, 1.7]) {
    parts.push(part(box, '#5d3b20', { p: [x, deckY - 0.45, (startZ + endZ) / 2 + 3], s: [0.35, 0.5, startZ - endZ + 6] }));
  }
  // 杭と手すり
  for (let z = endZ + 0.4; z < startZ + 6; z += 4) {
    for (const x of [-width / 2 - 0.1, width / 2 + 0.1]) {
      const h = deckY + 0.95 - (SEA_Y - 3);
      parts.push(part(cyl, '#5a3a21', { p: [x, SEA_Y - 3 + h / 2, z], s: [0.2, h, 0.2] }));
    }
  }
  for (const x of [-width / 2 - 0.1, width / 2 + 0.1]) {
    parts.push(part(box, '#7a4f2b', { p: [x, deckY + 0.85, (startZ + endZ) / 2 + 3], s: [0.14, 0.14, startZ - endZ + 6] }));
    parts.push(part(box, '#7a4f2b', { p: [x, deckY + 0.45, (startZ + endZ) / 2 + 3], s: [0.1, 0.1, startZ - endZ + 6] }));
  }
  // 街灯
  for (let i = 0, z = endZ + 6; z < startZ; z += 15, i++) {
    const x = (i % 2 === 0 ? -1 : 1) * (width / 2 + 0.1);
    parts.push(part(cyl, '#2d3843', { p: [x, deckY + 1.6, z], s: [0.08, 3.2, 0.08] }));
    parts.push(part(new THREE.SphereGeometry(0.28, 12, 8), '#ffd27a', { p: [x, deckY + 3.3, z], glow: 1 }));
  }

  // ヤシの木の島
  const sand = new THREE.Color('#ecd9a6');
  const grass = new THREE.Color('#6aad4a');
  const grassDark = new THREE.Color('#3f8a3a');
  const islandZ = startZ + 34;
  parts.push(
    part(new THREE.SphereGeometry(1, 48, 20), (p, _n, out) => {
      const h = p.y - SEA_Y;
      out.copy(sand).lerp(grass, smoothstep(1.0, 2.2, h)).lerp(grassDark, smoothstep(3.5, 6, h));
    }, { p: [0, SEA_Y - 5, islandZ], s: [62, 12, 40] }),
  );
  const palm = (x: number, z: number, lean: number, h: number) => {
    const base = SEA_Y + 4 + (1 - Math.min(1, Math.hypot(x / 62, (z - islandZ) / 40))) * 2;
    const seg = 6;
    let px = x;
    let py = base;
    for (let i = 0; i < seg; i++) {
      const t = i / seg;
      const nx = x + Math.sin(lean) * h * (t + 1 / seg) ** 1.6 * 0.5;
      const ny = base + h * (t + 1 / seg);
      parts.push(part(cyl, i % 2 ? '#8b6a43' : '#7a5b37', {
        p: [(px + nx) / 2, (py + ny) / 2, z],
        r: [0, 0, -Math.atan2(nx - px, ny - py)],
        s: [0.32 - t * 0.12, Math.hypot(nx - px, ny - py) + 0.05, 0.32 - t * 0.12],
      }));
      px = nx;
      py = ny;
    }
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rnd();
      const leaf = deform(new THREE.SphereGeometry(1, 10, 6), (v) => {
        v.y -= (v.x + 1) ** 2 * 0.18;
      });
      parts.push(part(leaf, k % 2 ? '#3f9a45' : '#58b04d', {
        p: [px + Math.cos(a) * 1.4, py - 0.3, z + Math.sin(a) * 1.4],
        r: [0, -a, -0.35],
        s: [1.8, 0.18, 0.5],
      }));
    }
  };
  palm(-12, islandZ - 14, 0.5, 7);
  palm(-18, islandZ - 6, -0.3, 8.5);
  palm(14, islandZ - 12, -0.4, 7.5);
  palm(22, islandZ - 2, 0.3, 9);
  palm(6, islandZ + 4, 0.1, 8);

  // 灯台の岩場
  const lx = -32;
  const lz = 26;
  parts.push(part(deform(new THREE.DodecahedronGeometry(1, 1), (v) => v.multiplyScalar(0.85 + hash3(v) * 0.3)), '#7c8187', {
    p: [lx, SEA_Y + 0.5, lz], s: [9, 5, 8],
  }));
  parts.push(part(new THREE.DodecahedronGeometry(1, 0), '#6d7278', { p: [lx + 8, SEA_Y, lz - 5], s: [3, 2.2, 3] }));
  const towerBase = SEA_Y + 4.5;
  parts.push(part(new THREE.CylinderGeometry(1.3, 1.9, 13, 20, 8), (p, _n, out) => {
    out.set(Math.floor((p.y - towerBase) / 2.6) % 2 === 0 ? '#f4f1ea' : '#d4402f');
  }, { p: [lx, towerBase + 6.5, lz] }));
  parts.push(part(new THREE.CylinderGeometry(2.1, 2.1, 0.35, 20), '#2c3238', { p: [lx, towerBase + 13.2, lz] }));
  parts.push(part(new THREE.CylinderGeometry(1.1, 1.1, 1.5, 16), '#ffe79a', { p: [lx, towerBase + 14.1, lz], glow: 1.2 }));
  parts.push(part(new THREE.ConeGeometry(1.5, 1.5, 16), '#c63a2b', { p: [lx, towerBase + 15.6, lz] }));

  // 遠景の島々（霧に溶ける）
  const mountains: [number, number, number, number][] = [
    [-320, -520, 90, 38], [260, -600, 120, 52], [40, -760, 160, 44], [-520, -220, 80, 30], [480, -260, 70, 26],
  ];
  for (const [x, z, r, h] of mountains) {
    const g = deform(new THREE.ConeGeometry(1, 1, 14, 4), (v) => {
      const k = 0.8 + hash3(v) * 0.4;
      v.x *= k;
      v.z *= k;
    });
    parts.push(part(g, (p, _n, out) => {
      out.set('#4f7f5c').lerp(new THREE.Color('#8fb39a'), smoothstep(SEA_Y, SEA_Y + h, p.y));
    }, { p: [x, SEA_Y + h / 2 - 2, z], s: [r, h, r * 0.7] }));
  }

  const mesh = new THREE.Mesh(merge(parts), vertexColorMaterial({ roughness: 0.85, glow: 3 }));
  mesh.name = 'intro-set';
  return mesh;
}
