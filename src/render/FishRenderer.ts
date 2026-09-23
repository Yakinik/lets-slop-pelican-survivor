import * as THREE from 'three';
import { FISH_MODELS, type FishModel } from '../models/fish';
import { SPECIES_IDS, type SpeciesId } from '../game/fishSpecies';

const FISH_VERT_HEAD = /* glsl */ `
attribute float aGlow;
attribute float aSway;
attribute float aFlap;
attribute vec4 aFx;
uniform float uTime;
uniform vec4 uSway;
varying float vGlow;
varying vec4 vFx;
`;

const FISH_VERT_BODY = /* glsl */ `
float live = 1.0 - aFx.z;
transformed.x += sin(uTime * uSway.y + aFx.x - position.z * 3.0) * uSway.x * aSway * live;
transformed.y += sin(uTime * uSway.w + aFx.x) * uSway.z * aFlap * live;
vGlow = aGlow;
vFx = aFx;
`;

const FISH_FRAG_HEAD = /* glsl */ `
uniform float uTime;
varying float vGlow;
varying vec4 vFx;
`;

/** aFx = (泳ぎの位相, 被弾フラッシュ, 凍結, 炎上) */
function fishMaterial(model: FishModel): { mat: THREE.MeshStandardMaterial; time: { value: number } } {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: model.roughness,
    metalness: model.metalness,
    envMapIntensity: 1.3,
  });
  const time = { value: 0 };
  const sway = { value: new THREE.Vector4(model.swayAmp, model.swayFreq, model.flapAmp, model.flapFreq) };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uSway = sway;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FISH_VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FISH_VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FISH_FRAG_HEAD}`)
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.85, 1.0), vFx.z * 0.75);',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vColor.rgb * vGlow * 3.0;
totalEmissiveRadiance += vec3(1.0) * vFx.y * 1.4;
totalEmissiveRadiance += vec3(1.0, 0.38, 0.06) * vFx.w * (0.55 + 0.45 * sin(uTime * 24.0 + vFx.x * 7.0));
totalEmissiveRadiance += vec3(0.15, 0.45, 0.7) * vFx.z * 0.35;`,
      );
  };
  mat.customProgramCacheKey = () => 'fish-v1';
  return { mat, time };
}

interface Batch {
  mesh: THREE.InstancedMesh;
  fx: THREE.InstancedBufferAttribute;
  time: { value: number };
  count: number;
  capacity: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** 魚を種ごとに 1 ドローコールで描く。毎フレーム begin → push → end の順に呼ぶ */
export class FishRenderer {
  readonly group = new THREE.Group();
  private batches = {} as Record<SpeciesId, Batch>;

  constructor(capacity: Partial<Record<SpeciesId, number>> = {}) {
    for (const id of SPECIES_IDS) {
      const model = FISH_MODELS[id]();
      const cap = capacity[id] ?? 160;
      const { mat, time } = fishMaterial(model);
      const fx = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      fx.setUsage(THREE.DynamicDrawUsage);
      model.geometry.setAttribute('aFx', fx);
      const mesh = new THREE.InstancedMesh(model.geometry, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
      this.batches[id] = { mesh, fx, time, count: 0, capacity: cap };
    }
  }

  begin(): void {
    for (const id of SPECIES_IDS) this.batches[id].count = 0;
  }

  push(
    id: SpeciesId, x: number, y: number, z: number, yaw: number, scale: number,
    phase: number, flash: number, frozen: number, burn: number, bank = 0, pitch = 0,
  ): void {
    const b = this.batches[id];
    if (b.count >= b.capacity) return;
    const i = b.count++;
    _q.setFromEuler(_e.set(pitch, yaw, bank));
    _m.compose(_p.set(x, y, z), _q, _s.setScalar(scale));
    _m.toArray(b.mesh.instanceMatrix.array, i * 16);
    const a = b.fx.array as Float32Array;
    a[i * 4] = phase;
    a[i * 4 + 1] = flash;
    a[i * 4 + 2] = frozen;
    a[i * 4 + 3] = burn;
  }

  end(time: number): void {
    for (const id of SPECIES_IDS) {
      const b = this.batches[id];
      b.mesh.count = b.count;
      b.time.value = time;
      if (b.count > 0) {
        b.mesh.instanceMatrix.clearUpdateRanges();
        b.mesh.instanceMatrix.addUpdateRange(0, b.count * 16);
        b.mesh.instanceMatrix.needsUpdate = true;
        b.fx.clearUpdateRanges();
        b.fx.addUpdateRange(0, b.count * 4);
        b.fx.needsUpdate = true;
      }
    }
  }
}
