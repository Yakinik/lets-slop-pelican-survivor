import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export type QualityLevel = 'high' | 'medium' | 'low';
export type QualitySetting = 'auto' | QualityLevel;

interface QualityPreset {
  pixelRatioCap: number;
  bloom: boolean;
  /** ブルームの内部解像度倍率 */
  bloomScale: number;
  msaa: number;
}

const PRESETS: Record<QualityLevel, QualityPreset> = {
  high: { pixelRatioCap: 1.75, bloom: true, bloomScale: 0.5, msaa: 4 },
  medium: { pixelRatioCap: 1.25, bloom: true, bloomScale: 0.35, msaa: 0 },
  low: { pixelRatioCap: 0.85, bloom: false, bloomScale: 0, msaa: 0 },
};

const LOWER: Record<QualityLevel, QualityLevel | null> = { high: 'medium', medium: 'low', low: null };

/** 平均フレーム時間がこれを超え続けたら品質を一段下げる（ms） */
const SLOW_FRAME_MS = 22;
const SLOW_WINDOW_S = 2.5;
const CHANGE_COOLDOWN_S = 4;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  quality: QualityLevel;
  setting: QualitySetting = 'auto';
  fps = 60;

  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private width = 1;
  private height = 1;
  private avgFrameMs = 16.7;
  private slowTime = 0;
  private sinceChange = 0;
  private onQualityChange: ((q: QualityLevel) => void) | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add('game-canvas');

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2500);
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.quality = coarse ? 'medium' : 'high';

    this.resize();
    this.buildPipeline();
    window.addEventListener('resize', () => this.resize());
  }

  onQuality(cb: (q: QualityLevel) => void): void {
    this.onQualityChange = cb;
  }

  setQualitySetting(setting: QualitySetting): void {
    this.setting = setting;
    if (setting !== 'auto') this.applyQuality(setting);
    this.slowTime = 0;
  }

  private applyQuality(q: QualityLevel): void {
    this.quality = q;
    this.sinceChange = 0;
    this.buildPipeline();
    this.onQualityChange?.(q);
  }

  private buildPipeline(): void {
    const preset = PRESETS[this.quality];
    this.bloom?.dispose();
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    const pr = Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
    if (!preset.bloom) return;

    const target = new THREE.WebGLRenderTarget(this.width * pr, this.height * pr, {
      type: THREE.HalfFloatType,
      samples: preset.msaa,
    });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(pr);
    composer.setSize(this.width, this.height);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.55, 0.45, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.bloom = bloom;
    this.resizeBloom();
  }

  private resizeBloom(): void {
    if (!this.bloom) return;
    const s = PRESETS[this.quality].bloomScale * this.renderer.getPixelRatio();
    this.bloom.setSize(Math.max(64, Math.round(this.width * s)), Math.max(64, Math.round(this.height * s)));
  }

  resize(): void {
    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    this.camera.aspect = this.width / this.height;
    // 縦長画面でも左右の視野が狭くなりすぎないよう FOV を広げる
    this.camera.fov = this.camera.aspect < 1 ? 45 + (1 - this.camera.aspect) * 30 : 45;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    if (this.composer) {
      this.composer.setSize(this.width, this.height);
      this.resizeBloom();
    }
  }

  get viewportWidth(): number {
    return this.width;
  }

  get viewportHeight(): number {
    return this.height;
  }

  /** 実時間のフレーム間隔を記録し、必要なら品質を自動で下げる */
  sampleFrame(realDt: number): void {
    const ms = realDt * 1000;
    this.avgFrameMs += (ms - this.avgFrameMs) * 0.05;
    this.fps = 1000 / this.avgFrameMs;
    this.sinceChange += realDt;
    if (this.setting !== 'auto' || this.sinceChange < CHANGE_COOLDOWN_S) return;
    if (this.avgFrameMs > SLOW_FRAME_MS) this.slowTime += realDt;
    else this.slowTime = Math.max(0, this.slowTime - realDt * 0.5);
    const lower = LOWER[this.quality];
    if (this.slowTime > SLOW_WINDOW_S && lower) {
      this.slowTime = 0;
      this.avgFrameMs = 16.7;
      this.applyQuality(lower);
    }
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
