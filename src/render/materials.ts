import * as THREE from 'three';

export interface VertexColorMaterialOpts {
  roughness?: number;
  metalness?: number;
  /** aGlow = 1 の頂点の発光倍率（HDR。1 を超えるとブルームが掛かる） */
  glow?: number;
  envMapIntensity?: number;
  side?: THREE.Side;
}

/** 頂点カラー + aGlow 属性による発光に対応した MeshStandardMaterial */
export function vertexColorMaterial(opts: VertexColorMaterialOpts = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: opts.roughness ?? 0.6,
    metalness: opts.metalness ?? 0,
    envMapIntensity: opts.envMapIntensity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  });
  const glow = (opts.glow ?? 2).toFixed(2);
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * ${glow};`,
      );
  };
  mat.customProgramCacheKey = () => `vcm-${glow}`;
  return mat;
}
