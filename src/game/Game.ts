import * as THREE from 'three';
import { Engine, type QualitySetting } from '../core/Engine';
import { Input } from '../core/Input';
import { World } from '../world/World';
import { buildIntroSet } from '../world/IntroSet';
import { Effects } from '../fx/Effects';
import { Particles } from '../fx/Particles';
import { DamageText } from '../fx/DamageText';
import { Sfx } from '../audio/Sfx';
import { UI, fmtTime as fmt } from '../ui/UI';
import { Player } from './Player';
import { FishSystem, type Fish } from './FishSystem';
import { BulletSystem } from './BulletSystem';
import { GemSystem } from './GemSystem';
import { WeaponSystem } from './WeaponSystem';
import { Combat } from './Combat';
import { Director } from './Director';
import { Intro, PLAY_CAM_LOOK, PLAY_CAM_OFFSET } from './Intro';
import { Inventory, displayName } from './inventory';
import { itemDef, type ItemId } from './items';
import { isFusionLevel, rollOffers, xpToNext, type Offer } from './progression';
import type { GameContext } from './context';
import type { SpeciesId } from './fishSpecies';

type State = 'title' | 'intro' | 'play' | 'levelup' | 'fusion' | 'paused' | 'dying' | 'over';
type Pending = 'level' | 'fusion';

const WHITE = new THREE.Color('#ffffff');
const GOLD = new THREE.Color('#ffd86b');
const VIOLET = new THREE.Color('#b98cff');

export class Game {
  readonly engine: Engine;
  readonly ctx: GameContext;
  state: State = 'title';
  inv = new Inventory();
  level = 1;
  xp = 0;
  kills = 0;
  score = 0;

  private readonly world: World;
  private readonly introSet: THREE.Mesh;
  private readonly player = new Player();
  private readonly fish: FishSystem;
  private readonly bullets: BulletSystem;
  private readonly gems: GemSystem;
  private readonly weapons: WeaponSystem;
  private readonly combat: Combat;
  private readonly director: Director;
  private readonly fx = new Effects();
  private readonly sparks = new Particles(3000, THREE.AdditiveBlending);
  private readonly puffs = new Particles(1500, THREE.NormalBlending);
  private readonly dmgText: DamageText;
  private readonly sfx = new Sfx();
  private readonly ui: UI;
  private readonly input: Input;
  private readonly intro: Intro;
  private readonly clock = new THREE.Clock();
  private readonly pending: Pending[] = [];
  private readonly camLook = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private worldTime = 0;
  private shakeAmt = 0;
  private secondAcc = 0;
  private stateTimer = 0;
  private stopPad: () => void = () => {};
  private victory = false;
  private pausedFrom: State = 'play';
  /** デバッグ用の自動操縦（魚の少ない方へ逃げる） */
  private autopilot = false;

  constructor(app: HTMLElement) {
    this.engine = new Engine(app);
    const scene = this.engine.scene;
    this.world = new World(scene, this.engine.renderer);
    this.introSet = buildIntroSet();
    scene.add(this.introSet);
    this.dmgText = new DamageText(app);

    // 各システムが参照し合うための共有コンテキスト（中身は下で埋める）
    const ctx = {
      time: 0, hpMul: 1, bulletMul: 1, spawnRadius: 44,
      player: this.player, fx: this.fx, sparks: this.sparks, puffs: this.puffs, dmgText: this.dmgText, sfx: this.sfx,
      shake: (a: number) => {
        this.shakeAmt = Math.min(1.6, this.shakeAmt + a);
      },
      onFishKilled: (f: Fish) => this.onFishKilled(f),
      summonRing: (id: SpeciesId, n: number, r: number, speed: number) => this.director.summonRing(id, n, r, speed),
    } as unknown as GameContext;
    this.ctx = ctx;
    this.fish = new FishSystem(ctx);
    this.bullets = new BulletSystem(ctx);
    this.gems = new GemSystem(ctx);
    this.weapons = new WeaponSystem(ctx);
    this.combat = new Combat(ctx);
    this.director = new Director(ctx);
    Object.assign(ctx, { fish: this.fish, bullets: this.bullets, gems: this.gems, weapons: this.weapons, combat: this.combat });

    scene.add(
      this.player.pelican.root, this.fish.renderer.group, this.bullets.mesh, this.gems.group, this.weapons.group,
      this.fx.group, this.sparks.points, this.puffs.points,
    );

    this.gems.onCollect = (xp) => this.gainXp(xp);
    this.director.onBoss = (def) => {
      this.ui.showBanner(`WARNING<small>${def.name} 接近中</small>`, 'warn', 3);
      this.sfx.play('warning');
    };

    this.ui = new UI(app, {
      start: () => this.startRun(),
      resume: () => this.togglePause(false),
      retire: () => {
        this.ui.showPause(false);
        this.endRun(false);
      },
      retry: () => {
        this.ui.showResult(null);
        this.startRun();
      },
      toTitle: () => {
        this.ui.showResult(null);
        this.toTitle();
      },
      quality: (q: QualitySetting) => this.engine.setQualitySetting(q),
      volume: (v) => this.sfx.setVolume(v),
      mute: (m) => this.sfx.setMuted(m),
      damageNumbers: (on) => {
        this.dmgText.enabled = on;
      },
      skipIntro: () => this.skipIntro(),
      click: () => {
        this.sfx.unlock();
        this.sfx.play('select');
      },
    });
    this.ui.onPause = () => this.togglePause(this.state !== 'paused');

    this.input = new Input(this.engine.renderer.domElement, app);
    this.input.onPause = () => {
      if (this.state === 'play' || this.state === 'paused') this.togglePause(this.state === 'play');
    };
    window.addEventListener('keydown', (e) => {
      if (this.state === 'intro' && (e.code === 'Space' || e.code === 'Enter')) this.skipIntro();
    });
    this.engine.renderer.domElement.addEventListener('pointerdown', () => {
      if (this.state === 'intro') this.skipIntro();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'play') this.togglePause(true);
    });

    this.intro = new Intro(this.player.pelican, this.engine.camera, {
      poemLine: (i) => this.ui.poemLine(i),
      poemHide: () => this.ui.poemHide(),
      cinematic: (on) => {
        this.ui.cinematic(on);
        this.engine.renderer.toneMappingExposure = on ? 1.04 : 1;
      },
      takeoff: () => {
        this.sfx.play('whoosh');
        const p = this.player.pelican.root.position;
        this.puffs.emit({ x: p.x, y: p.y, z: p.z, count: 40, color: WHITE, speed: 5, size: 0.9, life: 2.4, gravity: 0.6, drag: 1.2, spread: 2 });
      },
      padStart: () => {
        this.stopPad = this.sfx.pad();
      },
      padStop: () => this.stopPad(),
    });

    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    this.resetRun();
    this.ui.renderSlots(this.inv);
    this.loop();
  }

  private onResize(): void {
    this.sparks.setViewportHeight(this.engine.viewportHeight * this.engine.renderer.getPixelRatio(), this.engine.camera.fov);
    this.puffs.setViewportHeight(this.engine.viewportHeight * this.engine.renderer.getPixelRatio(), this.engine.camera.fov);
    this.ctx.spawnRadius = this.computeSpawnRadius();
  }

  /** ゲーム中のカメラから見える範囲の外周より少し外を出現半径にする */
  private computeSpawnRadius(): number {
    const cam = this.engine.camera.clone();
    cam.position.copy(PLAY_CAM_OFFSET);
    cam.lookAt(PLAY_CAM_LOOK);
    cam.updateMatrixWorld();
    let far = 0;
    const ray = new THREE.Ray();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const d = new THREE.Vector3(x, y, 0.5).unproject(cam).sub(cam.position).normalize();
      ray.set(cam.position, d);
      const r = ray.intersectPlane(plane, hit);
      far = Math.max(far, r ? Math.hypot(hit.x, hit.z) : 80);
    }
    return Math.min(80, Math.max(30, far + 5));
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    this.frame(Math.min(this.clock.getDelta(), 0.1));
  };

  /** 1 フレーム進める。render = false ならシミュレーションだけ（デバッグ用の早送り） */
  frame(realDt: number, render = true): void {
    const dt = Math.min(realDt, 1 / 20);
    this.engine.sampleFrame(realDt);
    const cam = this.engine.camera;
    let simulated = false;
    let focus = this.player.pelican.root.position;

    switch (this.state) {
      case 'title':
        this.worldTime += dt;
        this.intro.idle(dt, this.worldTime);
        break;
      case 'intro':
        this.worldTime += dt * this.intro.timeScale;
        this.intro.update(dt);
        this.puffs.update(dt * this.intro.timeScale);
        if (this.intro.done) this.beginPlay();
        break;
      case 'play':
      case 'dying':
        this.worldTime += dt;
        this.step(dt);
        simulated = true;
        focus = this.tmp.set(this.player.x, 0, this.player.z);
        break;
      default:
        focus = this.tmp.set(this.player.x, 0, this.player.z);
        break;
    }

    this.world.update(this.state === 'paused' ? 0 : dt, this.worldTime, focus, cam);
    // 遠く離れたら桟橋のセットは描かない
    this.introSet.visible = Math.hypot(cam.position.x, cam.position.z) < 700;

    if (simulated) {
      this.fish.render(this.ctx.time);
      this.bullets.render(this.ctx.time);
      this.gems.render(this.ctx.time);
      this.weapons.render();
      this.fx.flush();
    }
    if (this.state !== 'title' && this.state !== 'intro') this.updateHud();
    this.dmgText.update(simulated ? dt : 0, cam);
    if (render) this.engine.render();
  }

  private step(dt: number): void {
    const ctx = this.ctx;
    ctx.time += dt;
    const m = ctx.time / 60;
    ctx.hpMul = 1 + m * 0.18 + m * m * 0.008;
    ctx.bulletMul = 1 + m * 0.06;

    this.input.update();
    if (this.autopilot) this.autoSteer();
    const dying = this.state === 'dying';
    if (!dying) this.player.update(dt, this.input.move.x, this.input.move.y);
    else this.animateDeath(dt);

    this.director.update(dt);
    this.fish.update(dt);
    if (!dying) this.weapons.update(dt);
    this.combat.update(dt);
    this.bullets.update(dt);
    this.gems.update(dt);
    this.fx.update(dt, ctx.time);
    this.sparks.update(dt);
    this.puffs.update(dt);

    this.secondAcc += dt;
    if (this.secondAcc >= 1) {
      this.secondAcc -= 1;
      this.player.tickSecond();
    }

    this.followCamera(dt);

    if (this.state === 'play') {
      if (this.player.hp <= 0) {
        this.state = 'dying';
        this.stateTimer = 0;
        this.input.stickEnabled = false;
        this.input.release();
        this.sfx.play('gameover');
      } else if (this.victory) {
        this.stateTimer += dt;
        if (this.stateTimer > 3) this.endRun(true);
      } else if (this.pending.length > 0) {
        this.nextPending();
      }
    }
  }

  private animateDeath(dt: number): void {
    this.stateTimer += dt;
    const root = this.player.pelican.root;
    root.rotation.z += dt * 6;
    root.rotation.x += dt * 2;
    root.position.y -= dt * (4 + this.stateTimer * 18);
    this.player.pelican.update(dt, 2);
    if (this.stateTimer > 1.8) this.endRun(false);
  }

  private followCamera(dt: number): void {
    const cam = this.engine.camera;
    const p = this.player;
    const k = 1 - Math.exp(-7 * dt);
    this.tmp.set(p.x, 0, p.z).add(PLAY_CAM_OFFSET);
    cam.position.lerp(this.tmp, k);
    this.camLook.lerp(this.tmp.set(p.x, 0, p.z).add(PLAY_CAM_LOOK), k);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 3);
    const s = this.shakeAmt * this.shakeAmt;
    cam.position.x += (Math.random() - 0.5) * s;
    cam.position.y += (Math.random() - 0.5) * s;
    cam.lookAt(this.camLook);
  }

  private updateHud(): void {
    const p = this.player;
    const v = this.tmp.set(p.x, -2.1, p.z).project(this.engine.camera);
    const boss = this.fish.bosses[0];
    this.ui.updateHud({
      level: this.level,
      xp: this.xp,
      xpNext: xpToNext(this.level),
      time: this.ctx.time,
      kills: this.kills,
      hp: p.hp,
      maxHp: p.maxHp,
      hpX: (v.x * 0.5 + 0.5) * this.engine.viewportWidth,
      hpY: (-v.y * 0.5 + 0.5) * this.engine.viewportHeight,
      boss: boss ? { name: boss.boss!.name, hp: boss.hp, maxHp: boss.maxHp } : null,
      fps: this.engine.fps,
      quality: `${this.engine.setting === 'auto' ? '自動:' : ''}${{ high: '高', medium: '中', low: '低' }[this.engine.quality]}`,
    });
  }

  // ---------- 進行 ----------

  private resetRun(): void {
    this.inv = new Inventory();
    this.inv.acquire('punch');
    this.player.reset();
    this.fish.clear();
    this.bullets.clear();
    this.gems.clear();
    this.weapons.clear();
    this.weapons.sync(this.inv);
    this.sparks.clear();
    this.puffs.clear();
    this.fx.clear();
    this.dmgText.clear();
    this.director.reset();
    this.combat.totalDamage = 0;
    this.ctx.time = 0;
    this.ctx.hpMul = 1;
    this.level = 1;
    this.xp = 0;
    this.kills = 0;
    this.score = 0;
    this.pending.length = 0;
    this.victory = false;
    this.shakeAmt = 0;
    const root = this.player.pelican.root;
    root.rotation.set(0, Math.PI, 0, 'YXZ');
    root.visible = true;
    this.fish.render(0);
    this.bullets.render(0);
    this.gems.render(0);
    this.weapons.render();
    this.fx.flush();
    this.ui.renderSlots(this.inv);
  }

  private startRun(): void {
    this.sfx.unlock();
    this.resetRun();
    this.ui.showTitle(false);
    this.ui.showHud(false);
    this.ui.showSkipHint(true);
    this.intro.reset();
    this.state = 'intro';
  }

  private skipIntro(): void {
    if (this.state !== 'intro') return;
    this.intro.skip();
    this.beginPlay();
  }

  private beginPlay(): void {
    this.state = 'play';
    this.ui.showSkipHint(false);
    this.ui.cinematic(false);
    this.engine.renderer.toneMappingExposure = 1;
    this.ui.showHud(true);
    const root = this.player.pelican.root;
    this.player.x = root.position.x;
    this.player.z = root.position.z;
    this.player.yaw = Math.PI;
    this.camLook.set(this.player.x, 0, this.player.z).add(PLAY_CAM_LOOK);
    this.input.stickEnabled = true;
    this.ui.showBanner('SURVIVE!<small>飛んでくる魚をパンチで撃ち落とせ</small>', 'level', 2.4);
  }

  private toTitle(): void {
    this.resetRun();
    this.state = 'title';
    this.ui.showHud(false);
    this.ui.showTitle(true);
    this.input.stickEnabled = false;
  }

  private endRun(victory: boolean): void {
    this.state = 'over';
    this.input.stickEnabled = false;
    this.input.release();
    if (victory) this.sfx.play('victory');
    this.ui.showResult({
      victory, time: this.ctx.time, level: this.level, kills: this.kills, damage: this.combat.totalDamage, inventory: this.inv,
    });
  }

  private togglePause(pause: boolean): void {
    if (pause && this.state === 'play') {
      this.pausedFrom = this.state;
      this.state = 'paused';
      this.input.release();
      this.ui.showPause(true, { quality: this.engine.setting, volume: this.sfx.volume, muted: this.sfx.muted, dmg: this.dmgText.enabled });
    } else if (!pause && this.state === 'paused') {
      this.ui.showPause(false);
      this.state = this.pausedFrom;
      this.clock.getDelta();
    }
  }

  private gainXp(xp: number): void {
    this.sfx.play('gem');
    this.xp += xp * this.player.stats.growth;
    while (this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      this.level++;
      this.pending.push('level');
      if (isFusionLevel(this.level)) this.pending.push('fusion');
    }
  }

  private nextPending(): void {
    const next = this.pending.shift();
    if (!next) return;
    this.input.release();
    const p = this.player;
    if (next === 'level') {
      this.state = 'levelup';
      this.sfx.play('levelup');
      this.fx.spawnRing(p.x, p.z, 0.5, 7, 0.5, GOLD, 2, 0.2);
      this.fx.flush();
      const offers = rollOffers(this.inv);
      this.ui.showLevelUp(this.level, offers, this.inv, (o) => this.applyOffer(o));
      return;
    }
    if (!this.inv.canFuse()) {
      this.player.heal(this.player.maxHp * 0.5);
      this.ui.showBanner('合成ボーナス<small>素材が足りないので HP を回復した</small>', 'fusion', 2);
      return;
    }
    this.state = 'fusion';
    this.sfx.play('fusion');
    this.ui.showFusion(this.inv, (r) => {
      if (r) this.applyFusion(r.base, r.partner);
      else {
        this.player.heal(this.player.maxHp * 0.5);
        this.ui.showBanner('HP 回復', 'level', 1.2);
      }
      this.state = 'play';
      this.clock.getDelta();
    });
  }

  private applyOffer(o: Offer): void {
    switch (o.type) {
      case 'new':
      case 'upgrade': {
        const item = this.inv.acquire(o.itemId);
        this.weapons.sync(this.inv);
        this.ui.renderSlots(this.inv);
        if (o.type === 'new') this.ui.showBanner(`${itemDef(o.itemId).icon} ${displayName(item)}<small>を手に入れた！</small>`, 'level', 1.6);
        break;
      }
      case 'heal':
        this.player.heal(this.player.maxHp * 0.4);
        break;
      case 'score':
        this.score += 500;
        this.gems.vacuum();
        break;
    }
    this.state = 'play';
    this.clock.getDelta();
  }

  applyFusion(base: ItemId, partner: ItemId): void {
    const r = this.inv.fuse(base, partner);
    this.weapons.sync(this.inv);
    this.ui.renderSlots(this.inv);
    const p = this.player;
    this.fx.spawnRing(p.x, p.z, 0.5, 9, 0.8, VIOLET, 2.4, 0.25);
    this.fx.spawnRing(p.x, p.z, 0.5, 6, 0.6, GOLD, 2, 0.15);
    this.sparks.emit({ x: p.x, y: 1, z: p.z, count: 60, color: GOLD, speed: 12, size: 1.4, life: 0.9, intensity: 2.5 });
    this.sfx.play('fusion');
    this.ui.showBanner(`合成成功！<small>${displayName(r.base)}</small>`, 'fusion', 2.4);
  }

  private onFishKilled(f: Fish): void {
    this.kills++;
    this.score += f.sp.gem.xp * 10;
    this.sfx.play('pop');
    if (f.boss) {
      const b = f.boss;
      this.gems.drop('boss', f.x, f.z, b.xp);
      for (let i = 0; i < 10; i++) this.gems.drop(f.sp.id, f.x + (Math.random() - 0.5) * 6, f.z + (Math.random() - 0.5) * 6);
      this.bullets.clearCircle(f.x, f.z, 999);
      this.player.heal(this.player.maxHp * 0.3);
      this.ctx.shake(1.5);
      this.sfx.play('boom');
      this.fx.spawnRing(f.x, f.z, 1, 18, 1.2, GOLD, 2.4, 0.2);
      this.gems.vacuum();
      if (b.id === 'megalodon') {
        this.victory = true;
        this.stateTimer = 0;
        this.player.god = true;
        this.ui.showBanner('CLEAR!<small>メガロドンを撃破した！</small>', 'fusion', 3);
      } else {
        this.ui.showBanner(`${b.name} 撃破！`, 'level', 2.2);
      }
      return;
    }
    if (f.gem) this.gems.drop(f.sp.id, f.x, f.z);
  }

  // ---------- デバッグ ----------

  private autoSteer(): void {
    const p = this.player;
    let ax = 0;
    let az = 0;
    for (const f of this.fish.list) {
      const dx = p.x - f.x;
      const dz = p.z - f.z;
      const d2 = Math.max(1, dx * dx + dz * dz);
      if (d2 > 400) continue;
      ax += dx / d2;
      az += dz / d2;
    }
    // 危険が少なければ近くのジェムを拾いに行く
    const g = { x: 0, z: 0 };
    if (this.gems.nearest(p.x, p.z, g)) {
      const dx = g.x - p.x;
      const dz = g.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      ax += (dx / d) * 0.12;
      az += (dz / d) * 0.12;
    }
    const l = Math.hypot(ax, az) || 1;
    this.input.move.x = ax / l;
    this.input.move.y = az / l;
  }

  /** 自動操縦で seconds 秒遊ぶ。レベルアップは 1 枚目、合成は先頭の武器に別のアイテムを合成する */
  private autoPlay(seconds: number, fuse: boolean): string[] {
    this.autopilot = true;
    const log: string[] = [];
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
      if (this.state === 'levelup') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
      } else if (this.state === 'fusion') {
        const pick = (sel: string) => document.querySelector<HTMLElement>(sel)?.click();
        if (fuse && this.inv.items.length >= 2) {
          pick('.fgrid .fcard');
          pick('.fgrid .fcard:last-child');
          pick('.do-fuse');
          log.push(`${fmt(this.ctx.time)} fuse -> ${this.inv.items.map((it) => displayName(it)).join(', ')}`);
        } else {
          pick('.factions .skip');
        }
      } else if (this.state === 'over' || this.state === 'title') {
        break;
      }
      this.frame(1 / 60, i === n - 1);
      if (i % 1800 === 0) {
        const s = this.snapshot();
        log.push(`${fmt(this.ctx.time)} Lv${s.level} hp${s.hp} fish${s.fish} bullets${s.bullets} kills${s.kills} ${s.bosses.join(' ')}`);
      }
    }
    this.autopilot = false;
    return log;
  }

  /** ?debug のときだけ window.__game から使う */
  debugApi() {
    return {
      game: this,
      /** 指定秒数だけ 1/60 秒刻みで進め、最後の 1 フレームだけ描画する */
      step: (seconds: number) => {
        const n = Math.max(1, Math.round(seconds * 60));
        for (let i = 0; i < n; i++) this.frame(1 / 60, i === n - 1);
        return this.snapshot();
      },
      start: () => this.startRun(),
      skip: () => this.skipIntro(),
      xp: (amount: number) => this.gainXp(amount),
      give: (id: ItemId, times = 1) => {
        for (let i = 0; i < times; i++) this.inv.acquire(id);
        this.weapons.sync(this.inv);
        this.ui.renderSlots(this.inv);
      },
      god: (on = true) => {
        this.player.god = on;
      },
      setTime: (t: number) => {
        this.ctx.time = t;
      },
      move: (x: number, z: number) => {
        this.input.move.x = x;
        this.input.move.y = z;
      },
      snapshot: () => this.snapshot(),
      auto: (seconds: number, fuse = true) => this.autoPlay(seconds, fuse),
    };
  }

  snapshot() {
    return {
      state: this.state,
      time: Math.round(this.ctx.time * 10) / 10,
      level: this.level,
      xp: Math.round(this.xp),
      kills: this.kills,
      hp: Math.round(this.player.hp),
      fish: this.fish.count,
      bosses: this.fish.bosses.map((b) => `${b.boss!.name} ${Math.round(b.hp)}/${Math.round(b.maxHp)}`),
      bullets: this.bullets.count,
      gems: this.gems.count,
      items: this.inv.items.map((i) => `${displayName(i)} Lv${i.level}`),
      pending: [...this.pending],
      fps: Math.round(this.engine.fps),
      quality: this.engine.quality,
      drawCalls: this.engine.renderer.info.render.calls,
      triangles: this.engine.renderer.info.render.triangles,
    };
  }
}
