import * as THREE from 'three';
import { deform, merge, part } from '../render/geo';

/** 撃ち出すボクシンググローブ。拳が +z を向く */
export function gloveGeometry(): THREE.BufferGeometry {
  return merge([
    part(new THREE.SphereGeometry(0.5, 18, 14), '#e3302a', { s: [1, 0.9, 1.05] }),
    part(new THREE.SphereGeometry(0.2, 12, 10), '#e3302a', { p: [0.38, 0.1, 0.12] }),
    part(new THREE.CylinderGeometry(0.34, 0.36, 0.34, 16), '#fbfbf7', { p: [0, 0, -0.52], r: [Math.PI / 2, 0, 0] }),
    part(new THREE.TorusGeometry(0.2, 0.03, 6, 16, Math.PI), '#ffe38a', { p: [0, 0.4, 0.05], r: [0, Math.PI / 2, 0] }),
  ]);
}

/** ロケットフィスト: 金属の拳と尾部の噴射炎 */
export function rocketGeometry(): THREE.BufferGeometry {
  const flame = deform(new THREE.ConeGeometry(0.28, 1.1, 10, 3), (v) => {
    v.x *= 1 + Math.sin(v.y * 9) * 0.08;
  });
  return merge([
    part(new THREE.SphereGeometry(0.42, 16, 12), '#cfd6de', { s: [1, 0.9, 1.1] }),
    part(new THREE.CylinderGeometry(0.26, 0.32, 0.6, 12), '#8b939c', { p: [0, 0, -0.5], r: [Math.PI / 2, 0, 0] }),
    part(new THREE.BoxGeometry(0.9, 0.05, 0.3), '#d8342f', { p: [0, 0, -0.62] }),
    part(new THREE.BoxGeometry(0.05, 0.7, 0.3), '#d8342f', { p: [0, 0, -0.62] }),
    part(flame, '#ffb347', { p: [0, 0, -1.25], r: [-Math.PI / 2, 0, 0], glow: 1 }),
  ]);
}

export function dropletGeometry(): THREE.BufferGeometry {
  return merge([
    part(deform(new THREE.SphereGeometry(0.28, 12, 10), (v) => {
      if (v.z < 0) v.z *= 1.8;
    }), '#7fd6ff', { glow: 0.6 }),
  ]);
}

export function bombGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(0.55, 20, 16);
}
