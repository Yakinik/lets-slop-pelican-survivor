const KEYMAP: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

const STICK_RADIUS = 56;

/**
 * 移動入力。x は画面右、y は画面下（= ワールドの +z）方向。
 * キーボードと、画面をドラッグする仮想スティック（タッチ・マウス両対応）を合成する。
 */
export class Input {
  readonly move = { x: 0, y: 0 };
  /** ゲームプレイ中だけスティック操作を受け付ける */
  stickEnabled = false;
  onPause: (() => void) | null = null;

  private keys = new Set<string>();
  private pointerId: number | null = null;
  private ox = 0;
  private oy = 0;
  private sx = 0;
  private sy = 0;
  private readonly stick: HTMLDivElement;
  private readonly knob: HTMLDivElement;

  constructor(surface: HTMLElement, overlay: HTMLElement) {
    this.stick = document.createElement('div');
    this.stick.className = 'stick';
    this.knob = document.createElement('div');
    this.knob.className = 'stick-knob';
    this.stick.appendChild(this.knob);
    overlay.appendChild(this.stick);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        this.onPause?.();
        return;
      }
      if (KEYMAP[e.code]) {
        this.keys.add(e.code);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.release();
    });

    surface.addEventListener('pointerdown', (e) => {
      if (!this.stickEnabled || this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      this.ox = e.clientX;
      this.oy = e.clientY;
      this.sx = 0;
      this.sy = 0;
      surface.setPointerCapture(e.pointerId);
      this.stick.style.transform = `translate(${this.ox - STICK_RADIUS}px, ${this.oy - STICK_RADIUS}px)`;
      this.stick.classList.add('active');
      this.drawKnob();
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      let dx = e.clientX - this.ox;
      let dy = e.clientY - this.oy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx *= STICK_RADIUS / len;
        dy *= STICK_RADIUS / len;
      }
      this.sx = dx / STICK_RADIUS;
      this.sy = dy / STICK_RADIUS;
      this.drawKnob();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.pointerId) this.release();
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
  }

  private drawKnob(): void {
    this.knob.style.transform = `translate(${this.sx * STICK_RADIUS}px, ${this.sy * STICK_RADIUS}px)`;
  }

  release(): void {
    this.pointerId = null;
    this.sx = 0;
    this.sy = 0;
    this.stick.classList.remove('active');
  }

  update(): void {
    let x = 0;
    let y = 0;
    for (const k of this.keys) {
      const d = KEYMAP[k];
      x += d[0];
      y += d[1];
    }
    const kl = Math.hypot(x, y);
    if (kl > 0) {
      x /= kl;
      y /= kl;
    }
    // 小さな遊びを除いたスティック量を足す
    const sl = Math.hypot(this.sx, this.sy);
    if (sl > 0.15) {
      const k = Math.min(1, (sl - 0.15) / 0.75) / sl;
      x += this.sx * k;
      y += this.sy * k;
    }
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    this.move.x = x;
    this.move.y = y;
  }
}
