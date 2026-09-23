import { itemDef, isWeaponId, MAX_ITEM_LEVEL, type ItemId } from '../game/items';
import { displayName, fusionYield, type Inventory, type OwnedItem } from '../game/inventory';
import { TRAITS, addTraits, describeOnAccessory, sortedTraits, type TraitMap } from '../game/traits';
import type { Offer } from '../game/progression';
import type { QualitySetting } from '../core/Engine';
import { POEM } from '../game/Intro';

export interface HudState {
  level: number;
  xp: number;
  xpNext: number;
  time: number;
  kills: number;
  hp: number;
  maxHp: number;
  hpX: number;
  hpY: number;
  boss: { name: string; hp: number; maxHp: number } | null;
  fps: number;
  quality: string;
}

export interface ResultState {
  victory: boolean;
  time: number;
  level: number;
  kills: number;
  damage: number;
  inventory: Inventory;
}

export interface UICallbacks {
  start(): void;
  resume(): void;
  retire(): void;
  retry(): void;
  toTitle(): void;
  quality(q: QualitySetting): void;
  volume(v: number): void;
  mute(m: boolean): void;
  damageNumbers(on: boolean): void;
  skipIntro(): void;
  click(): void;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export const fmtTime = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function traitChips(traits: TraitMap, extraClass = ''): string {
  return sortedTraits(traits)
    .map(([t, s]) => `<span class="chip ${extraClass}" style="--c:${TRAITS[t].color}">${TRAITS[t].name}<b>${Number.isInteger(s) ? s : s.toFixed(1)}</b></span>`)
    .join('');
}

function pips(level: number): string {
  let out = '';
  for (let i = 1; i <= MAX_ITEM_LEVEL; i++) out += `<i class="${i <= level ? 'on' : ''}"></i>`;
  return `<span class="pips">${out}</span>`;
}

export class UI {
  readonly root = h('div', 'ui');
  private readonly hud = h('div', 'hud hidden');
  private readonly xpFill = h('div', 'xp-fill');
  private readonly lvText = h('div', 'lv');
  private readonly timer = h('div', 'timer');
  private readonly kills = h('div', 'kills');
  private readonly hpWrap = h('div', 'hp-float');
  private readonly hpFill = h('div', 'hp-fill');
  private readonly hpText = h('div', 'hp-text');
  private readonly slots = h('div', 'slots');
  private readonly bossBar = h('div', 'boss-bar hidden');
  private readonly bossFill = h('div', 'boss-fill');
  private readonly bossName = h('div', 'boss-name');
  private readonly perf = h('div', 'perf');
  private readonly banner = h('div', 'banner');
  private readonly poem = h('div', 'poem');
  private readonly cine = h('div', 'cine');
  private readonly skipHint = h('div', 'skip-hint', 'クリック / Space でスキップ');
  private readonly title = h('div', 'screen title');
  private readonly levelup = h('div', 'screen modal hidden');
  private readonly fusion = h('div', 'screen modal hidden');
  private readonly pause = h('div', 'screen modal hidden');
  private readonly result = h('div', 'screen modal hidden');
  private bannerTimer = 0;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private lastSlotsKey = '';

  constructor(parent: HTMLElement, private readonly cb: UICallbacks) {
    parent.appendChild(this.root);

    // HUD
    const xp = h('div', 'xp');
    xp.append(this.xpFill, this.lvText);
    const top = h('div', 'topline');
    top.append(this.timer, this.kills);
    const pauseBtn = h('button', 'pause-btn', '<span></span><span></span>');
    pauseBtn.setAttribute('aria-label', '一時停止');
    pauseBtn.addEventListener('click', () => this.onPause?.());
    const bossTrack = h('div', 'boss-track');
    bossTrack.append(this.bossFill);
    this.bossBar.append(this.bossName, bossTrack);
    const hpTrack = h('div', 'hp-track');
    hpTrack.append(this.hpFill);
    this.hpWrap.append(hpTrack, this.hpText);
    this.hud.append(xp, top, this.slots, this.bossBar, pauseBtn, this.perf, this.hpWrap);

    // 演出用レイヤー（黒帯・光漏れ・詩）
    this.cine.innerHTML = '<div class="bar top"></div><div class="bar bottom"></div><div class="leak"></div><div class="vignette"></div>';
    this.poem.innerHTML = POEM.map((l) => `<p>${esc(l)}</p>`).join('');

    this.skipHint.addEventListener('click', () => this.cb.skipIntro());
    this.buildTitle();
    this.root.append(this.cine, this.hud, this.poem, this.banner, this.skipHint, this.title, this.levelup, this.fusion, this.pause, this.result);
  }

  onPause: (() => void) | null = null;

  private buildTitle(): void {
    this.title.innerHTML = `
      <div class="title-card">
        <div class="logo"><span class="logo-sub">PELICAN</span><span class="logo-main">SURVIVOR</span></div>
        <div class="tagline">自転車ペリカン、空へ。飛んでくる魚をパンチで撃ち落とせ！</div>
        <button class="btn primary start">はじめる</button>
        <div class="howto">
          <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / 矢印 / 画面ドラッグ で移動</div>
          <div>攻撃は自動。魚が落とすジェムを集めてレベルアップ</div>
          <div>レベル 5 ごとに<b>合成ボーナス</b>。アイテムを合成して強化しよう</div>
          <div><kbd>Esc</kbd> で一時停止</div>
        </div>
      </div>`;
    this.title.querySelector('.start')!.addEventListener('click', () => {
      this.cb.click();
      this.cb.start();
    });
  }

  showTitle(show: boolean): void {
    this.title.classList.toggle('hidden', !show);
  }

  showHud(show: boolean): void {
    this.hud.classList.toggle('hidden', !show);
  }

  showSkipHint(show: boolean): void {
    this.skipHint.classList.toggle('show', show);
  }

  poemLine(i: number): void {
    this.poem.children[i]?.classList.add('show');
  }

  poemHide(): void {
    this.poem.classList.add('out');
    window.setTimeout(() => {
      this.poem.classList.remove('out');
      for (const p of Array.from(this.poem.children)) p.classList.remove('show');
    }, 1600);
  }

  cinematic(on: boolean): void {
    this.cine.classList.toggle('on', on);
  }

  /** 画面中央の告知。style: 'level' | 'warn' | 'fusion' | 'info' */
  showBanner(text: string, style: string, seconds = 2): void {
    this.banner.className = `banner show ${style}`;
    this.banner.innerHTML = text;
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), seconds * 1000);
  }

  updateHud(s: HudState): void {
    this.xpFill.style.transform = `scaleX(${Math.min(1, s.xp / s.xpNext)})`;
    this.lvText.textContent = `Lv ${s.level}`;
    this.timer.textContent = fmtTime(s.time);
    this.kills.textContent = `🐟 ${s.kills}`;
    const hpK = Math.max(0, s.hp / s.maxHp);
    this.hpFill.style.transform = `scaleX(${hpK})`;
    this.hpFill.classList.toggle('low', hpK < 0.3);
    this.hpText.textContent = `${Math.ceil(s.hp)} / ${s.maxHp}`;
    this.hpWrap.style.transform = `translate(${s.hpX}px, ${s.hpY}px)`;
    if (s.boss) {
      this.bossBar.classList.remove('hidden');
      this.bossName.textContent = s.boss.name;
      this.bossFill.style.transform = `scaleX(${Math.max(0, s.boss.hp / s.boss.maxHp)})`;
    } else {
      this.bossBar.classList.add('hidden');
    }
    this.perf.textContent = `${Math.round(s.fps)} fps · ${s.quality}`;
  }

  renderSlots(inv: Inventory): void {
    const key = JSON.stringify(inv.items);
    if (key === this.lastSlotsKey) return;
    this.lastSlotsKey = key;
    const slot = (item: OwnedItem) => {
      const def = itemDef(item.id);
      const fused = sortedTraits(item.traits).length > 0;
      return `<div class="slot ${fused ? 'fused' : ''}" title="${esc(displayName(item))}">
        <span class="icon">${def.icon}</span>${pips(item.level)}
        ${fused ? `<span class="slot-tags">${sortedTraits(item.traits).slice(0, 3).map(([t]) => `<i style="--c:${TRAITS[t].color}">${TRAITS[t].tag}</i>`).join('')}</span>` : ''}
      </div>`;
    };
    const empty = (n: number) => Array.from({ length: n }, () => '<div class="slot empty"></div>').join('');
    this.slots.innerHTML = `
      <div class="row">${inv.weapons.map(slot).join('')}${empty(6 - inv.weapons.length)}</div>
      <div class="row">${inv.accessories.map(slot).join('')}${empty(6 - inv.accessories.length)}</div>`;
  }

  private bindKeys(fn: ((e: KeyboardEvent) => void) | null): void {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = fn;
    if (fn) window.addEventListener('keydown', fn);
  }

  private hideModal(el: HTMLElement): void {
    el.classList.add('hidden');
    this.bindKeys(null);
  }

  /** レベルアップ時の 3 択 */
  showLevelUp(level: number, offers: Offer[], inv: Inventory, onPick: (o: Offer) => void): void {
    const cards = offers.map((o, i) => this.offerCard(o, inv, i)).join('');
    this.levelup.innerHTML = `
      <div class="panel">
        <div class="panel-title">LEVEL UP! <span class="lv-to">Lv ${level}</span></div>
        <div class="panel-sub">報酬を 1 つ選んでください</div>
        <div class="cards">${cards}</div>
      </div>`;
    this.levelup.classList.remove('hidden');
    const pick = (i: number) => {
      if (!offers[i]) return;
      this.cb.click();
      this.hideModal(this.levelup);
      onPick(offers[i]);
    };
    this.levelup.querySelectorAll<HTMLElement>('.card').forEach((el, i) => el.addEventListener('click', () => pick(i)));
    this.bindKeys((e) => {
      const n = Number(e.key);
      if (n >= 1 && n <= offers.length) pick(n - 1);
    });
  }

  private offerCard(o: Offer, inv: Inventory, i: number): string {
    if (o.type === 'heal') {
      return `<button class="card heal"><div class="card-head"><span class="icon">🍱</span><span class="badge">回復</span></div>
        <div class="card-name">焼き魚定食</div><div class="card-desc">HP を 40% 回復する</div><kbd class="num">${i + 1}</kbd></button>`;
    }
    if (o.type === 'score') {
      return `<button class="card score"><div class="card-head"><span class="icon">✨</span><span class="badge">ボーナス</span></div>
        <div class="card-name">金のうろこ</div><div class="card-desc">スコア +500、ジェムをすべて引き寄せる</div><kbd class="num">${i + 1}</kbd></button>`;
    }
    const def = itemDef(o.itemId);
    const owned = inv.get(o.itemId);
    const isNew = o.type === 'new';
    const kind = isWeaponId(o.itemId) ? '武器' : 'アクセ';
    const lvl = isNew ? 1 : o.toLevel;
    const desc = isNew ? `${def.summary}` : def.levelText[lvl - 1];
    const trait = TRAITS[def.trait];
    const name = owned ? displayName(owned) : def.name;
    return `<button class="card ${isWeaponId(o.itemId) ? 'weapon' : 'accessory'}">
      <div class="card-head"><span class="icon">${def.icon}</span>
        <span class="badge ${isNew ? 'new' : ''}">${isNew ? 'NEW!' : `Lv${lvl - 1} → Lv${lvl}`}</span></div>
      <div class="card-kind">${kind}</div>
      <div class="card-name">${esc(name)}</div>
      <div class="card-desc">${esc(desc)}</div>
      ${isNew ? `<div class="card-lv1">Lv1: ${esc(def.levelText[0])}</div>` : ''}
      ${owned && sortedTraits(owned.traits).length ? `<div class="chips">${traitChips(owned.traits)}</div>` : ''}
      <div class="card-trait">素材にすると <span class="chip" style="--c:${trait.color}">${trait.name}</span></div>
      ${pips(lvl)}
      <kbd class="num">${i + 1}</kbd>
    </button>`;
  }

  /**
   * 合成画面。ベース → 合成先（素材）の順に選び、プレビューを確認して合成する。
   * onDone にはベースと素材の ID（スキップ時は null）を返す。
   */
  showFusion(inv: Inventory, onDone: (r: { base: ItemId; partner: ItemId } | null) => void): void {
    let base: OwnedItem | null = null;
    let partner: OwnedItem | null = null;
    const finish = (r: { base: ItemId; partner: ItemId } | null) => {
      this.cb.click();
      this.hideModal(this.fusion);
      onDone(r);
    };

    const itemCard = (item: OwnedItem, extra = '') => {
      const def = itemDef(item.id);
      return `<button class="fcard ${isWeaponId(item.id) ? 'weapon' : 'accessory'}" data-id="${item.id}">
        <span class="icon">${def.icon}</span>
        <span class="fname">${esc(displayName(item))}</span>
        ${pips(item.level)}
        <span class="chips">${traitChips(item.traits)}</span>
        ${extra}
      </button>`;
    };

    const render = () => {
      let body = '';
      if (!base) {
        body = `<div class="panel-sub">① ベースにするアイテムを選んでください（武器もアクセサリーも可）</div>
          <div class="fgrid">${inv.items.map((it) => itemCard(it)).join('')}</div>`;
      } else if (!partner) {
        body = `<div class="panel-sub">② 合成先（素材）を選んでください。素材は消費されます</div>
          <div class="fbase">ベース: ${itemCard(base)}</div>
          <div class="fgrid">${inv.items.filter((it) => it !== base).map((it) => {
            const y = fusionYield(it);
            return itemCard(it, `<span class="gives">付与: ${traitChips(y, 'give')}</span>`);
          }).join('')}</div>`;
      } else {
        const gained = fusionYield(partner);
        const after: TraitMap = addTraits({ ...base.traits }, gained);
        const preview: OwnedItem = { ...base, traits: after, fusions: base.fusions + 1 };
        const weapon = isWeaponId(base.id);
        const lines = Object.keys(gained).map((t) => {
          const k = t as keyof TraitMap;
          const s = after[k] as number;
          const text = weapon ? TRAITS[k].describe(s) : describeOnAccessory(k, s);
          return `<li><span class="chip" style="--c:${TRAITS[k].color}">${TRAITS[k].name}<b>${s}</b></span>${esc(text)}</li>`;
        }).join('');
        const bonus = weapon ? 'この武器のダメージ +10%' : 'このアクセサリーの効果 +20%';
        body = `<div class="panel-sub">③ 合成内容を確認してください</div>
          <div class="fpreview">
            <div class="fformula">${itemCard(base)}<span class="plus">＋</span>${itemCard(partner)}</div>
            <div class="farrow">▼</div>
            <div class="fresult"><span class="icon big">${itemDef(base.id).icon}</span>
              <div><div class="fname big">${esc(displayName(preview))}</div>
              <ul class="flines">${lines}<li><span class="chip" style="--c:#ffffff">合成</span>${bonus}</li></ul>
              <div class="fnote">素材の「${esc(displayName(partner))}」は消費され、あとで再入手できます</div></div>
            </div>
          </div>
          <div class="factions"><button class="btn primary do-fuse">合成する！</button></div>`;
      }
      this.fusion.innerHTML = `<div class="panel wide">
        <div class="panel-title fusion-title">合成ボーナス！</div>
        ${body}
        <div class="factions secondary">
          ${base ? '<button class="btn back">戻る</button>' : ''}
          <button class="btn skip">合成しない（HP 50% 回復）</button>
        </div>
      </div>`;
      this.fusion.querySelectorAll<HTMLElement>('.fgrid .fcard').forEach((el) =>
        el.addEventListener('click', () => {
          this.cb.click();
          const it = inv.get(el.dataset.id as ItemId) ?? null;
          if (!base) base = it;
          else partner = it;
          render();
        }),
      );
      this.fusion.querySelector('.do-fuse')?.addEventListener('click', () => finish({ base: base!.id, partner: partner!.id }));
      this.fusion.querySelector('.back')?.addEventListener('click', () => back());
      this.fusion.querySelector('.skip')!.addEventListener('click', () => finish(null));
    };
    const back = () => {
      this.cb.click();
      if (partner) partner = null;
      else base = null;
      render();
    };
    this.fusion.classList.remove('hidden');
    render();
    this.bindKeys((e) => {
      if (e.key === 'Backspace') back();
      if (e.key === 'Enter' && base && partner) finish({ base: base.id, partner: partner.id });
    });
  }

  showPause(show: boolean, opts?: { quality: QualitySetting; volume: number; muted: boolean; dmg: boolean }): void {
    if (!show) {
      this.hideModal(this.pause);
      return;
    }
    const o = opts!;
    const q = (v: QualitySetting, label: string) => `<option value="${v}" ${o.quality === v ? 'selected' : ''}>${label}</option>`;
    this.pause.innerHTML = `<div class="panel">
      <div class="panel-title">一時停止</div>
      <div class="settings">
        <label>画質 <select class="q">${q('auto', '自動')}${q('high', '高')}${q('medium', '中')}${q('low', '低')}</select></label>
        <label>音量 <input class="vol" type="range" min="0" max="1" step="0.05" value="${o.volume}"></label>
        <label><input class="mute" type="checkbox" ${o.muted ? 'checked' : ''}> ミュート</label>
        <label><input class="dmg" type="checkbox" ${o.dmg ? 'checked' : ''}> ダメージ表示</label>
      </div>
      <div class="factions">
        <button class="btn primary resume">再開</button>
        <button class="btn retire">リタイア</button>
      </div>
      <div class="howto small"><div>移動: WASD / 矢印 / ドラッグ ・ 一時停止: Esc</div></div>
    </div>`;
    this.pause.classList.remove('hidden');
    this.pause.querySelector('.resume')!.addEventListener('click', () => this.cb.resume());
    this.pause.querySelector('.retire')!.addEventListener('click', () => this.cb.retire());
    this.pause.querySelector<HTMLSelectElement>('.q')!.addEventListener('change', (e) => this.cb.quality((e.target as HTMLSelectElement).value as QualitySetting));
    this.pause.querySelector<HTMLInputElement>('.vol')!.addEventListener('input', (e) => this.cb.volume(Number((e.target as HTMLInputElement).value)));
    this.pause.querySelector<HTMLInputElement>('.mute')!.addEventListener('change', (e) => this.cb.mute((e.target as HTMLInputElement).checked));
    this.pause.querySelector<HTMLInputElement>('.dmg')!.addEventListener('change', (e) => this.cb.damageNumbers((e.target as HTMLInputElement).checked));
  }

  showResult(r: ResultState | null): void {
    if (!r) {
      this.hideModal(this.result);
      return;
    }
    const items = r.inventory.items.map((it) => {
      const def = itemDef(it.id);
      return `<div class="ritem"><span class="icon">${def.icon}</span><span>${esc(displayName(it))}</span>${pips(it.level)}</div>`;
    }).join('');
    this.result.innerHTML = `<div class="panel">
      <div class="panel-title ${r.victory ? 'victory' : 'defeat'}">${r.victory ? 'CLEAR!' : '撃ち落とされた…'}</div>
      <div class="panel-sub">${r.victory ? 'メガロドンを倒し、夏の空を守りきった！' : 'ペリカンは海へ落ちていった'}</div>
      <div class="stats">
        <div><span>生存時間</span><b>${fmtTime(r.time)}</b></div>
        <div><span>レベル</span><b>${r.level}</b></div>
        <div><span>撃墜数</span><b>${r.kills}</b></div>
        <div><span>総ダメージ</span><b>${Math.round(r.damage).toLocaleString()}</b></div>
      </div>
      <div class="ritems">${items}</div>
      <div class="factions">
        <button class="btn primary retry">もう一度</button>
        <button class="btn title-btn">タイトルへ</button>
      </div>
    </div>`;
    this.result.classList.remove('hidden');
    this.result.querySelector('.retry')!.addEventListener('click', () => {
      this.cb.click();
      this.cb.retry();
    });
    this.result.querySelector('.title-btn')!.addEventListener('click', () => {
      this.cb.click();
      this.cb.toTitle();
    });
  }
}
