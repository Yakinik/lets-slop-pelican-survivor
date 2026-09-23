/**
 * XZ 平面の一様グリッド。毎フレーム clear → insert で作り直し、半径検索に使う。
 * バケットはハッシュで共有されるため、同じ要素を二度返さないよう検索ごとにスタンプを付ける。
 */
export class SpatialGrid {
  private readonly head: Int32Array;
  private readonly next: Int32Array;
  private readonly xs: Float32Array;
  private readonly zs: Float32Array;
  private readonly stamp: Int32Array;
  private readonly mask: number;
  private query = 0;
  readonly results: Int32Array;

  constructor(private readonly cellSize: number, maxItems: number, tableBits = 12) {
    this.head = new Int32Array(1 << tableBits).fill(-1);
    this.mask = (1 << tableBits) - 1;
    this.next = new Int32Array(maxItems);
    this.xs = new Float32Array(maxItems);
    this.zs = new Float32Array(maxItems);
    this.stamp = new Int32Array(maxItems);
    this.results = new Int32Array(maxItems);
  }

  private bucket(cx: number, cz: number): number {
    return (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) & this.mask;
  }

  clear(): void {
    this.head.fill(-1);
  }

  insert(id: number, x: number, z: number): void {
    const b = this.bucket(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize));
    this.xs[id] = x;
    this.zs[id] = z;
    this.next[id] = this.head[b];
    this.head[b] = id;
  }

  /** (x, z) から r 以内のセルにいる要素の id を results に詰めて個数を返す（距離判定は呼び出し側） */
  queryCells(x: number, z: number, r: number): number {
    const q = ++this.query;
    const cs = this.cellSize;
    const x0 = Math.floor((x - r) / cs);
    const x1 = Math.floor((x + r) / cs);
    const z0 = Math.floor((z - r) / cs);
    const z1 = Math.floor((z + r) / cs);
    let n = 0;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        let id = this.head[this.bucket(cx, cz)];
        while (id !== -1) {
          if (this.stamp[id] !== q) {
            this.stamp[id] = q;
            this.results[n++] = id;
          }
          id = this.next[id];
        }
      }
    }
    return n;
  }
}
