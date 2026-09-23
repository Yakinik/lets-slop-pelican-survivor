import * as THREE from 'three';

const MAX = 90;
const LIFE = 0.7;
/** 0 = 通常, 1 = 二次ダメージ, 2 = 継続ダメージ */
const STYLES = [
  { fill: '#ffffff', size: 17 },
  { fill: '#bfe9ff', size: 13 },
  { fill: '#ffae5c', size: 13 },
];

/** ダメージ数値。DOM を増やさないよう 1 枚の 2D キャンバスにまとめて描く */
export class DamageText {
  enabled = true;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly x = new Float32Array(MAX);
  private readonly y = new Float32Array(MAX);
  private readonly z = new Float32Array(MAX);
  private readonly v = new Float32Array(MAX);
  private readonly t = new Float32Array(MAX);
  private readonly s = new Uint8Array(MAX);
  private n = 0;
  private head = 0;
  private readonly p = new THREE.Vector3();
  private dpr = 1;
  /** 前のフレームで何か描いたか（何もなければ消去も省く） */
  private drewLast = false;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'dmg-canvas';
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  add(x: number, y: number, z: number, value: number, style: number): void {
    if (!this.enabled || value < 0.5) return;
    let i: number;
    if (this.n < MAX) i = this.n++;
    else {
      i = this.head;
      this.head = (this.head + 1) % MAX;
    }
    this.x[i] = x + (Math.random() - 0.5) * 0.8;
    this.y[i] = y;
    this.z[i] = z + (Math.random() - 0.5) * 0.4;
    this.v[i] = Math.round(value);
    this.t[i] = 0;
    this.s[i] = style;
  }

  clear(): void {
    this.n = 0;
    this.head = 0;
    this.drewLast = false;
    this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  update(dt: number, camera: THREE.Camera): void {
    const g = this.g;
    if (this.drewLast) g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drewLast = false;
    if (!this.enabled) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (let i = 0; i < this.n; i++) {
      if (this.t[i] >= LIFE) continue;
      this.t[i] += dt;
      const k = this.t[i] / LIFE;
      this.p.set(this.x[i], this.y[i] + k * 1.6, this.z[i]).project(camera);
      if (this.p.z > 1) continue;
      const sx = (this.p.x * 0.5 + 0.5) * w;
      const sy = (-this.p.y * 0.5 + 0.5) * h;
      const st = STYLES[this.s[i]];
      const pop = k < 0.15 ? 1 + (0.15 - k) * 3 : 1;
      g.globalAlpha = Math.min(1, (1 - k) * 2.2);
      g.font = `800 ${Math.round(st.size * pop * this.dpr)}px system-ui, sans-serif`;
      g.lineWidth = 3.2 * this.dpr;
      g.strokeStyle = 'rgba(10, 30, 60, 0.85)';
      const text = String(this.v[i]);
      this.drewLast = true;
      g.strokeText(text, sx, sy);
      g.fillStyle = st.fill;
      g.fillText(text, sx, sy);
    }
    g.globalAlpha = 1;
  }
}
