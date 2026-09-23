import * as THREE from 'three';
import { deform, merge, part, smoothstep, type Vec3 } from '../render/geo';
import { vertexColorMaterial } from '../render/materials';

/** モデルの原点から車輪の接地面までの距離。原点はペリカンの胴のあたり */
export const PELICAN_GROUND_OFFSET = 1.45;
const G = -PELICAN_GROUND_OFFSET;

const WHEEL_R = 0.55;
const BB: Vec3 = [0, G + 0.5, -0.05];
const CRANK_R = 0.17;
const HIP_Y = G + 1.32;
const HIP_Z = -0.34;
const THIGH = 0.52;
const SHIN = 0.5;

const C = {
  frame: '#d8342f',
  frameDark: '#9c1f1c',
  chrome: '#d9dee4',
  tire: '#1f2226',
  seat: '#2b2b30',
  feather: '#f6f3ec',
  featherShade: '#dcd6c8',
  primaries: '#1c1e24',
  beak: '#f2b53d',
  pouch: '#f39443',
  hook: '#d9523a',
  skin: '#f4a99c',
  leg: '#f09a52',
  glove: '#e2322b',
  cuff: '#fbfbf7',
  bell: '#f1c74a',
  basket: '#b98a4e',
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

function tube(a: Vec3, b: Vec3, r: number, color: THREE.ColorRepresentation, radial = 8): THREE.BufferGeometry {
  _a.set(...a);
  _b.set(...b);
  const len = _a.distanceTo(_b);
  const g = new THREE.CylinderGeometry(r, r, len, radial, 1);
  _q.setFromUnitVectors(_up, _b.clone().sub(_a).normalize());
  g.applyQuaternion(_q);
  const mid = _a.clone().add(_b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return part(g, color);
}

function buildFrame(): THREE.BufferGeometry {
  const rear: Vec3 = [0, G + WHEEL_R, -0.9];
  const front: Vec3 = [0, G + WHEEL_R, 0.9];
  const seatTop: Vec3 = [0, G + 1.08, -0.42];
  const headTop: Vec3 = [0, G + 1.2, 0.62];
  const headBot: Vec3 = [0, G + 0.95, 0.66];
  const parts = [
    tube(BB, seatTop, 0.045, C.frame),
    tube([0, G + 1.0, -0.38], headTop, 0.042, C.frame),
    tube(BB, headBot, 0.05, C.frame),
    tube(headBot, headTop, 0.055, C.frameDark),
  ];
  for (const x of [-0.07, 0.07]) {
    parts.push(tube([x, BB[1], BB[2]], [x, rear[1], rear[2]], 0.03, C.frame));
    parts.push(tube([x, G + 1.0, -0.38], [x, rear[1], rear[2]], 0.028, C.frame));
    parts.push(tube([x * 0.8, G + 0.98, 0.66], [x, front[1], front[2]], 0.03, C.chrome));
  }
  // ハンドル
  parts.push(tube(headTop, [0, G + 1.34, 0.7], 0.035, C.chrome));
  parts.push(tube([-0.36, G + 1.36, 0.74], [0.36, G + 1.36, 0.74], 0.03, C.chrome));
  for (const x of [-0.36, 0.36]) parts.push(tube([x, G + 1.36, 0.74], [x * 1.1, G + 1.36, 0.84], 0.04, C.seat));
  // サドル
  parts.push(part(deform(new THREE.SphereGeometry(1, 16, 8), (v) => {
    v.x *= 1 - smoothstep(-0.2, 1, v.z) * 0.6;
  }), C.seat, { p: [0, G + 1.12, -0.44], s: [0.14, 0.05, 0.22] }));
  // ベルとカゴ（カゴの中には魚）
  parts.push(part(new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), C.bell, { p: [0.24, G + 1.39, 0.74] }));
  parts.push(part(new THREE.CylinderGeometry(0.24, 0.2, 0.26, 12, 1, true), C.basket, { p: [0, G + 1.1, 1.0] }));
  parts.push(part(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 12), C.basket, { p: [0, G + 0.98, 1.0] }));
  parts.push(part(new THREE.ConeGeometry(0.09, 0.2, 6), '#5d8fb3', { p: [0.05, G + 1.3, 1.02], r: [0.3, 0, 0.4], s: [1, 1, 0.3] }));
  // 泥よけ
  parts.push(part(new THREE.TorusGeometry(WHEEL_R + 0.07, 0.025, 4, 16, Math.PI * 0.55), C.frame, {
    p: [0, rear[1], rear[2]], r: [0, Math.PI / 2, Math.PI * 0.35],
  }));
  return merge(parts);
}

function buildWheel(): THREE.BufferGeometry {
  const parts = [
    part(new THREE.TorusGeometry(WHEEL_R - 0.04, 0.055, 8, 36), C.tire, { r: [0, Math.PI / 2, 0] }),
    part(new THREE.TorusGeometry(WHEEL_R - 0.1, 0.02, 6, 36), C.chrome, { r: [0, Math.PI / 2, 0] }),
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 10), C.chrome, { r: [0, 0, Math.PI / 2] }),
  ];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    parts.push(tube([0, 0, 0], [0, Math.cos(a) * (WHEEL_R - 0.1), Math.sin(a) * (WHEEL_R - 0.1)], 0.008, C.chrome, 4));
  }
  return merge(parts);
}

function buildCrank(): THREE.BufferGeometry {
  const parts = [part(new THREE.TorusGeometry(0.12, 0.018, 6, 20), C.chrome, { p: [0.09, 0, 0], r: [0, Math.PI / 2, 0] })];
  for (const [x, s] of [[0.13, 1], [-0.13, -1]] as const) {
    parts.push(tube([x, 0, 0], [x, CRANK_R * s, 0], 0.02, C.chrome));
    parts.push(part(new THREE.BoxGeometry(0.14, 0.03, 0.08), C.seat, { p: [x * 1.45, CRANK_R * s, 0] }));
  }
  return merge(parts);
}

function buildBody(): THREE.BufferGeometry {
  const feather = new THREE.Color(C.feather);
  const shade = new THREE.Color(C.featherShade);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(part(new THREE.SphereGeometry(1, 24, 16), (p, _n, out) => {
    out.copy(shade).lerp(feather, smoothstep(G + 1.2, G + 1.7, p.y));
  }, { p: [0, G + 1.62, -0.28], r: [-0.55, 0, 0], s: [0.5, 0.55, 0.82] }));
  // 尾羽
  parts.push(part(new THREE.ConeGeometry(0.22, 0.55, 8), C.featherShade, { p: [0, G + 1.25, -0.98], r: [-2.2, 0, 0], s: [1.4, 1, 0.5] }));
  // S 字の首
  const neck = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, G + 1.95, 0.02),
    new THREE.Vector3(0, G + 2.3, -0.1),
    new THREE.Vector3(0, G + 2.55, 0.05),
    new THREE.Vector3(0, G + 2.68, 0.28),
  ]);
  parts.push(part(new THREE.TubeGeometry(neck, 12, 0.14, 10), C.feather));
  return merge(parts);
}

function buildHead(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(part(new THREE.SphereGeometry(0.2, 18, 12), C.feather, { s: [0.85, 0.9, 1.15] }));
  parts.push(part(new THREE.SphereGeometry(0.12, 10, 8), '#f7e7a8', { p: [0, 0.12, -0.12], s: [0.7, 0.6, 1.4] }));
  for (const x of [-0.12, 0.12]) {
    parts.push(part(new THREE.SphereGeometry(0.06, 10, 8), C.skin, { p: [x, 0.04, 0.08], s: [0.5, 1, 1] }));
    parts.push(part(new THREE.SphereGeometry(0.035, 10, 8), '#fff4c4', { p: [x * 1.12, 0.045, 0.09] }));
    parts.push(part(new THREE.SphereGeometry(0.018, 8, 6), '#111111', { p: [x * 1.25, 0.05, 0.1] }));
  }
  // 上くちばし（先端にかぎ）と喉袋
  const beak = deform(new THREE.CylinderGeometry(0.035, 0.07, 1.1, 10, 6), (v) => {
    v.z *= 0.45;
  });
  parts.push(part(beak, C.beak, { p: [0, -0.02, 0.68], r: [Math.PI / 2, 0, 0] }));
  parts.push(part(new THREE.SphereGeometry(0.05, 8, 6), C.hook, { p: [0, -0.04, 1.23], s: [0.8, 0.9, 1.2] }));
  const pouch = deform(new THREE.SphereGeometry(1, 16, 10), (v) => {
    if (v.y < 0) v.y *= 1 + 0.6 * Math.max(0, 1 - Math.abs(v.z - 0.1) * 1.3);
  });
  parts.push(part(pouch, C.pouch, { p: [0, -0.1, 0.6], s: [0.075, 0.1, 0.5] }));
  return merge(parts);
}

function buildWing(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.18);
  s.bezierCurveTo(0.5, 0.3, 1.1, 0.26, 1.6, 0.1);
  s.lineTo(1.7, -0.02);
  s.lineTo(1.5, -0.12);
  s.lineTo(1.58, -0.2);
  s.lineTo(1.3, -0.26);
  s.lineTo(1.36, -0.34);
  s.lineTo(1.0, -0.36);
  s.lineTo(0.9, -0.44);
  s.lineTo(0.6, -0.4);
  s.lineTo(0.45, -0.46);
  s.bezierCurveTo(0.2, -0.4, 0.05, -0.3, 0, -0.2);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
  const white = new THREE.Color(C.feather);
  const black = new THREE.Color(C.primaries);
  const parts = [
    part(g, (p, _n, out) => {
      // 形状の y は翼弦方向（z）になる。外側と後縁の風切羽を黒くする
      const outer = smoothstep(1.0, 1.15, p.x);
      const trailing = smoothstep(-0.26, -0.34, p.z) * smoothstep(0.35, 0.5, p.x);
      out.copy(white).lerp(black, Math.max(outer, trailing));
    }, { r: [Math.PI / 2, 0, 0], p: [0, 0.02, 0] }),
    // 翼の先のボクシンググローブ
    part(new THREE.SphereGeometry(0.2, 16, 12), C.glove, { p: [1.78, 0, 0.02], s: [1.1, 0.95, 1] }),
    part(new THREE.SphereGeometry(0.09, 10, 8), C.glove, { p: [1.72, 0.02, 0.18] }),
    part(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 12), C.cuff, { p: [1.55, 0, 0.02], r: [0, 0, Math.PI / 2] }),
  ];
  return merge(parts);
}

/** 2 ボーン IK: 腰から足先までを太ももとすねで結ぶ膝の位置（膝は前方に曲がる） */
function solveKnee(hy: number, hz: number, fy: number, fz: number, out: { y: number; z: number }): void {
  let dy = fy - hy;
  let dz = fz - hz;
  let d = Math.hypot(dy, dz);
  const max = THIGH + SHIN - 0.001;
  if (d > max) {
    dy *= max / d;
    dz *= max / d;
    d = max;
  }
  const a = (THIGH * THIGH - SHIN * SHIN + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, THIGH * THIGH - a * a));
  const uy = dy / d;
  const uz = dz / d;
  // 進行方向（+z）側へ曲げる: 腰→足先の単位ベクトル (uy, uz) に垂直な (uz, -uy) 方向へ膝を出す
  out.y = hy + uy * a + uz * h;
  out.z = hz + uz * a - uy * h;
}

export class Pelican {
  readonly root = new THREE.Group();
  /** 翼の広がり。0 = ハンドルを握る、1 = 大きく広げて羽ばたく */
  spread = 0;
  pedalRate = 0;
  flapRate = 0;
  flapAmp = 0.55;

  private readonly body = new THREE.Group();
  private readonly head: THREE.Mesh;
  private readonly wheels: THREE.Mesh[] = [];
  private readonly crank: THREE.Mesh;
  private readonly wings: THREE.Group[] = [];
  private readonly legs: { thigh: THREE.Mesh; shin: THREE.Mesh; foot: THREE.Mesh; side: number }[] = [];
  private readonly mats: THREE.MeshStandardMaterial[];
  private crankAngle = 0;
  private flapPhase = 0;
  private punchT = [1, 1];
  private bellT = 1;
  private hurtT = 0;
  private readonly knee = { y: 0, z: 0 };

  constructor() {
    const bikeMat = vertexColorMaterial({ roughness: 0.32, metalness: 0.55 });
    const birdMat = vertexColorMaterial({ roughness: 0.78 });
    const wingMat = vertexColorMaterial({ roughness: 0.75, side: THREE.DoubleSide });
    this.mats = [bikeMat, birdMat, wingMat];

    const frame = new THREE.Mesh(buildFrame(), bikeMat);
    const wheelGeo = buildWheel();
    for (const z of [-0.9, 0.9]) {
      const w = new THREE.Mesh(wheelGeo, bikeMat);
      w.position.set(0, G + WHEEL_R, z);
      this.wheels.push(w);
    }
    this.crank = new THREE.Mesh(buildCrank(), bikeMat);
    this.crank.position.set(...BB);

    this.body.add(new THREE.Mesh(buildBody(), birdMat));
    this.head = new THREE.Mesh(buildHead(), birdMat);
    this.head.position.set(0, G + 2.72, 0.34);
    this.body.add(this.head);

    const wingGeo = buildWing();
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.38 * side, G + 1.82, 0.02);
      const wing = new THREE.Mesh(wingGeo, wingMat);
      wing.scale.x = side;
      pivot.add(wing);
      this.wings.push(pivot);
      this.body.add(pivot);
    }

    const legGeo = new THREE.CylinderGeometry(0.045, 0.04, 1, 6).translate(0, 0.5, 0);
    const legMat = vertexColorMaterial({ roughness: 0.6 });
    const legPart = merge([part(legGeo, C.leg)]);
    const footGeo = merge([part(new THREE.ConeGeometry(0.1, 0.22, 3), C.leg, { r: [Math.PI / 2, 0, 0], s: [1, 1, 0.35] })]);
    this.mats.push(legMat);
    for (const side of [1, -1]) {
      const thigh = new THREE.Mesh(legPart, legMat);
      const shin = new THREE.Mesh(legPart, legMat);
      const foot = new THREE.Mesh(footGeo, legMat);
      this.legs.push({ thigh, shin, foot, side });
      this.body.add(thigh, shin, foot);
    }

    this.root.add(frame, ...this.wheels, this.crank, this.body);
    this.root.traverse((o) => {
      o.frustumCulled = false;
    });
  }

  /** 翼のパンチ（side: 0 = 右, 1 = 左） */
  punch(side: number): void {
    this.punchT[side] = 0;
  }

  ringBell(): void {
    this.bellT = 0;
  }

  hurt(): void {
    this.hurtT = 1;
  }

  update(dt: number, groundSpeed: number): void {
    this.crankAngle += this.pedalRate * dt;
    for (const w of this.wheels) w.rotation.x += (groundSpeed / WHEEL_R) * dt;
    this.crank.rotation.x = this.crankAngle;
    this.flapPhase += this.flapRate * dt;

    // 翼: 握る姿勢と羽ばたき姿勢をブレンドし、パンチで前へ突き出す
    const flap = Math.sin(this.flapPhase) * this.flapAmp;
    this.wings.forEach((pivot, i) => {
      const side = i === 0 ? 1 : -1;
      this.punchT[i] = Math.min(1, this.punchT[i] + dt / 0.22);
      const jab = Math.sin(Math.PI * this.punchT[i]);
      const s = this.spread;
      const rideY = -1.25 * side;
      const flyY = 0.08 * side;
      pivot.rotation.set(
        0.1 * s,
        THREE.MathUtils.lerp(rideY, flyY, s) + (-1.2 * side - THREE.MathUtils.lerp(rideY, flyY, s)) * jab * 0.8,
        THREE.MathUtils.lerp(-0.55 * side, flap * side, s) * (1 - jab),
      );
      pivot.scale.setScalar(THREE.MathUtils.lerp(0.62, 1, Math.max(s, jab)));
    });

    // 頭: 羽ばたきに合わせて少し揺れる。ベルを鳴らすと首をかしげる
    this.bellT = Math.min(1, this.bellT + dt / 0.5);
    const bellWobble = Math.sin(this.bellT * Math.PI * 4) * (1 - this.bellT) * 0.25;
    this.head.rotation.set(0.18 - Math.sin(this.flapPhase) * 0.05 * this.spread, 0, bellWobble);
    this.body.position.y = Math.sin(this.flapPhase - 0.6) * 0.07 * this.spread + Math.abs(Math.sin(this.crankAngle)) * 0.02;

    // 脚: ペダルに足を置いて漕ぐ
    for (const leg of this.legs) {
      const ang = this.crankAngle + (leg.side > 0 ? 0 : Math.PI);
      const fy = BB[1] + Math.cos(ang) * CRANK_R - this.body.position.y;
      const fz = BB[2] + Math.sin(ang) * CRANK_R;
      const x = 0.19 * leg.side;
      solveKnee(HIP_Y, HIP_Z, fy, fz, this.knee);
      placeSegment(leg.thigh, x, HIP_Y, HIP_Z, this.knee.y, this.knee.z);
      placeSegment(leg.shin, x, this.knee.y, this.knee.z, fy, fz);
      leg.foot.position.set(x * 1.05, fy + 0.02, fz + 0.05);
    }

    this.hurtT = Math.max(0, this.hurtT - dt * 3);
    for (const m of this.mats) m.emissive.setRGB(this.hurtT * 0.9, this.hurtT * 0.1, this.hurtT * 0.1);
  }
}

function placeSegment(m: THREE.Mesh, x: number, y0: number, z0: number, y1: number, z1: number): void {
  _a.set(0, y1 - y0, z1 - z0);
  const len = _a.length();
  m.position.set(x, y0, z0);
  m.quaternion.setFromUnitVectors(_up, _a.divideScalar(len));
  m.scale.set(1, len, 1);
}
