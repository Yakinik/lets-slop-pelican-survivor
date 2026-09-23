import * as THREE from 'three';
import { PIER } from '../world/IntroSet';
import { PELICAN_GROUND_OFFSET, type Pelican } from '../models/pelican';
import { smoothstep } from '../render/geo';

/** ゲーム中のカメラ位置（ペリカンからの相対）と注視点のずれ */
export const PLAY_CAM_OFFSET = new THREE.Vector3(0, 27, 16);
export const PLAY_CAM_LOOK = new THREE.Vector3(0, 0, -1);

/** ゲーム中のペリカンの表示倍率（見やすさのため少し大きくする） */
export const PELICAN_PLAY_SCALE = 1.35;

export const POEM = ['夏の日差し', '優しく迎えてくれるのは', '空飛ぶ魚だけなのか？'];

/** 詩の一行が浮かび上がりきるまでの秒数（style.css の .poem p の transition と合わせる） */
const POEM_LINE_FADE_IN = 2.4;
/** 全行がそろってから表示し続ける秒数 */
const POEM_HOLD = 1.5;
/** 詩が消えるまでの秒数（style.css の .poem.out の transition と合わせる） */
const POEM_FADE_OUT = 1.4;

const POEM_AT = [3.9, 5.6, 7.3] as const;
const POEM_OUT = POEM_AT[2] + POEM_LINE_FADE_IN + POEM_HOLD;

/** 実時間でのタイムライン（秒）。詩が消えきると同時にゲームが始まる */
const T = {
  takeoff: 3.4,
  slowIn: [3.3, 3.9],
  poem: POEM_AT,
  slowOut: [9.6, 10.3],
  poemOut: POEM_OUT,
  end: POEM_OUT + POEM_FADE_OUT,
} as const;

const SLOW = 0.3;
const RIDE_START_Z = 50;
const RIDE_ACCEL = 7.4;

interface CamKey {
  t: number;
  off: [number, number, number];
  look: [number, number, number];
}

/** カメラのキーフレーム（ペリカンからの相対位置） */
const CAM_KEYS: CamKey[] = [
  { t: 0, off: [3.4, 0.7, -5.2], look: [0, 0.6, 0] },
  { t: 1.8, off: [7.2, 1.6, 0.5], look: [0, 0.8, -2] },
  { t: 3.3, off: [4.6, 1.0, 6.5], look: [0, 1.0, -5] },
  { t: 4.6, off: [2.0, -1.3, 7.5], look: [0, 2.2, -9] },
  { t: 9.4, off: [-3.2, 0.2, 9.5], look: [0, 3.0, -11] },
  { t: T.end, off: [PLAY_CAM_OFFSET.x, PLAY_CAM_OFFSET.y, PLAY_CAM_OFFSET.z], look: [PLAY_CAM_LOOK.x, PLAY_CAM_LOOK.y, PLAY_CAM_LOOK.z] },
];

export interface IntroHooks {
  poemLine(i: number): void;
  poemHide(): void;
  cinematic(on: boolean): void;
  takeoff(): void;
  padStart(): void;
  padStop(): void;
}

/**
 * 自転車のペリカンが桟橋を走り出し、飛び立ってゲーム開始位置（y = 0）に着くまでの演出。
 * 離陸の瞬間からスローモーションになり、詩を一行ずつ表示する。
 */
export class Intro {
  /** 実時間の経過 */
  t = 0;
  /** スローモーションを掛けたワールド時間 */
  private w = 0;
  private fired = new Set<string>();
  private yAtAscent = 0;
  private readonly deckY = PIER.deckY + PELICAN_GROUND_OFFSET;
  private readonly offA = new THREE.Vector3();
  private readonly offB = new THREE.Vector3();
  private readonly lookA = new THREE.Vector3();
  private readonly lookB = new THREE.Vector3();

  constructor(private readonly pelican: Pelican, private readonly camera: THREE.PerspectiveCamera, private readonly hooks: IntroHooks) {}

  get done(): boolean {
    return this.t >= T.end;
  }

  /** 世界の時間の進み方（スローモーション倍率） */
  get timeScale(): number {
    if (this.t < T.slowIn[0]) return 1;
    if (this.t < T.slowIn[1]) return 1 + (SLOW - 1) * smoothstep(T.slowIn[0], T.slowIn[1], this.t);
    if (this.t < T.slowOut[0]) return SLOW;
    if (this.t < T.slowOut[1]) return SLOW + (1 - SLOW) * smoothstep(T.slowOut[0], T.slowOut[1], this.t);
    return 1;
  }

  reset(): void {
    this.t = 0;
    this.w = 0;
    this.fired.clear();
    this.pelican.root.scale.setScalar(1);
    this.pose(0);
  }

  skip(): void {
    this.once('cinematicOff', () => this.hooks.cinematic(false));
    this.hooks.poemHide();
    this.hooks.padStop();
    this.t = T.end;
    this.pose(this.w);
    this.finalPose();
  }

  private once(key: string, fn: () => void): void {
    if (this.fired.has(key)) return;
    this.fired.add(key);
    fn();
  }

  /** ペリカンの位置をワールド時間 w から決める */
  private pose(w: number): { x: number; y: number; z: number; speed: number } {
    const p = this.pelican.root.position;
    if (w < T.takeoff) {
      p.set(0, this.deckY, RIDE_START_Z - 0.5 * RIDE_ACCEL * w * w);
      return { x: 0, y: this.deckY, z: p.z, speed: RIDE_ACCEL * w };
    }
    const s = w - T.takeoff;
    const z1 = RIDE_START_Z - 0.5 * RIDE_ACCEL * T.takeoff * T.takeoff;
    const v1 = RIDE_ACCEL * T.takeoff;
    const y = this.deckY + 7 * (1 - Math.exp(-1.4 * s)) + 2.2 * s;
    p.set(0, y, z1 - v1 * s);
    return { x: 0, y, z: p.z, speed: v1 };
  }

  update(dt: number): void {
    const h = this.hooks;
    this.t += dt;
    const ts = this.timeScale;
    this.w += dt * ts;
    const pel = this.pelican;
    const pos = this.pose(this.w);

    if (this.t >= T.takeoff) this.once('takeoff', () => h.takeoff());
    if (this.t >= T.slowIn[0]) this.once('cinematic', () => h.cinematic(true));
    if (this.t >= T.poem[0] - 0.3) this.once('pad', () => h.padStart());
    T.poem.forEach((at, i) => {
      if (this.t >= at) this.once(`poem${i}`, () => h.poemLine(i));
    });
    if (this.t >= T.poemOut) {
      this.once('poemOut', () => {
        h.poemHide();
        h.padStop();
      });
    }
    // 黒帯と光漏れは詩と一緒に退く
    if (this.t >= T.poemOut) this.once('cinematicOff', () => h.cinematic(false));

    // 最後の上昇: 雲を突き抜けてゲームの高度 y = 0 へ
    if (this.t >= T.slowOut[0]) {
      if (!this.fired.has('ascent')) {
        this.fired.add('ascent');
        this.yAtAscent = pos.y;
      }
      const k = smoothstep(T.slowOut[0], T.end, this.t);
      pel.root.position.y = this.yAtAscent + (0 - this.yAtAscent) * k;
      pel.root.scale.setScalar(1 + (PELICAN_PLAY_SCALE - 1) * k);
    }

    // 姿勢: 離陸で翼を広げ、機首を上げる
    const air = smoothstep(T.takeoff - 0.1, T.takeoff + 0.5, this.t);
    pel.spread = air;
    pel.flapRate = 13 * air;
    pel.flapAmp = 0.55 + 0.25 * air * (1 - smoothstep(T.slowOut[0], T.end, this.t));
    pel.pedalRate = Math.max(6, pos.speed * 1.6);
    const climb = air * (1 - smoothstep(T.slowOut[1], T.end, this.t));
    pel.root.rotation.set(-0.3 * climb, Math.PI, Math.sin(this.t * 0.8) * 0.08 * air, 'YXZ');
    pel.update(dt * ts, pos.speed * (1 - air * 0.6));

    this.placeCamera();
    if (this.done) this.finalPose();
  }

  private placeCamera(): void {
    const t = this.t;
    let i = 0;
    while (i < CAM_KEYS.length - 2 && t >= CAM_KEYS[i + 1].t) i++;
    const a = CAM_KEYS[i];
    const b = CAM_KEYS[i + 1];
    const k = smoothstep(a.t, b.t, t);
    this.offA.set(...a.off).lerp(this.offB.set(...b.off), k);
    this.lookA.set(...a.look).lerp(this.lookB.set(...b.look), k);
    const p = this.pelican.root.position;
    this.camera.position.copy(p).add(this.offA);
    this.camera.lookAt(p.x + this.lookA.x, p.y + this.lookA.y, p.z + this.lookA.z);
  }

  private finalPose(): void {
    const p = this.pelican.root.position;
    p.y = 0;
    this.pelican.root.scale.setScalar(PELICAN_PLAY_SCALE);
    this.pelican.root.rotation.set(0, Math.PI, 0, 'YXZ');
    this.pelican.spread = 1;
    this.camera.position.copy(p).add(PLAY_CAM_OFFSET);
    this.camera.lookAt(p.x + PLAY_CAM_LOOK.x, p.y + PLAY_CAM_LOOK.y, p.z + PLAY_CAM_LOOK.z);
  }

  /** タイトル画面: 桟橋の端で待つペリカンの周りをゆっくり回る */
  idle(dt: number, time: number): void {
    const pel = this.pelican;
    pel.root.position.set(0, this.deckY, RIDE_START_Z);
    pel.root.rotation.set(0, Math.PI, 0, 'YXZ');
    pel.root.scale.setScalar(1);
    pel.spread = 0;
    pel.pedalRate = 0;
    pel.flapRate = 0;
    pel.update(dt, 0);
    const a = time * 0.12 + 0.6;
    const p = pel.root.position;
    this.camera.position.set(p.x + Math.sin(a) * 7.5, p.y + 1.6 + Math.sin(time * 0.3) * 0.3, p.z + Math.cos(a) * 7.5);
    this.camera.lookAt(p.x, p.y + 0.5, p.z - 1);
  }
}
