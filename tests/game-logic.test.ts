import { describe, expect, it } from 'vitest';
import { Inventory, displayName, fusionYield } from '../src/game/inventory';
import { ALL_ITEM_IDS, MAX_ITEM_LEVEL } from '../src/game/items';
import { isFusionLevel, rollOffers, xpToNext } from '../src/game/progression';
import { computePlayerStats, computeWeaponStats } from '../src/game/stats';
import { MAX_TRAIT_STRENGTH, traitMath } from '../src/game/traits';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('progression', () => {
  it('xp requirement grows with level', () => {
    for (let l = 1; l < 60; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
    expect(xpToNext(1)).toBe(5);
  });

  it('fusion bonus happens every 5 levels', () => {
    expect([4, 5, 6, 10, 15, 16].map(isFusionLevel)).toEqual([false, true, false, true, true, false]);
  });

  it('offers three distinct choices and never offers a maxed item', () => {
    const inv = new Inventory();
    inv.acquire('punch');
    for (let i = 1; i < MAX_ITEM_LEVEL; i++) inv.acquire('punch');
    const rng = seeded(42);
    for (let n = 0; n < 200; n++) {
      const offers = rollOffers(inv, rng);
      expect(offers).toHaveLength(3);
      const ids = offers.map((o) => ('itemId' in o ? o.itemId : o.type));
      expect(new Set(ids).size).toBe(3);
      expect(ids).not.toContain('punch');
    }
  });

  it('fills with fallback rewards when almost everything is maxed', () => {
    const inv = new Inventory();
    for (const id of ALL_ITEM_IDS) for (let i = 0; i < MAX_ITEM_LEVEL; i++) inv.acquire(id);
    inv.items.pop();
    inv.acquire('jersey');
    const offers = rollOffers(inv, seeded(1));
    expect(offers.map((o) => o.type)).toEqual(['upgrade', 'heal', 'score']);
  });
});

describe('fusion', () => {
  it('transfers the partner trait at partner level and consumes the partner', () => {
    const inv = new Inventory();
    inv.acquire('punch');
    inv.acquire('rocket');
    inv.acquire('rocket');
    const r = inv.fuse('punch', 'rocket');
    expect(r.gained).toEqual({ blaze: 2 });
    expect(inv.get('punch')?.traits).toEqual({ blaze: 2 });
    expect(inv.get('punch')?.fusions).toBe(1);
    expect(inv.has('rocket')).toBe(false);
    expect(displayName(inv.get('punch')!)).toBe('炎・ペリカンパンチ');
  });

  it('allows any kind of partner: weapon <- accessory and accessory <- weapon', () => {
    const inv = new Inventory();
    inv.acquire('bell');
    inv.acquire('mirror');
    inv.acquire('magnet');
    inv.acquire('thunder');
    inv.fuse('bell', 'mirror');
    inv.fuse('magnet', 'thunder');
    expect(inv.get('bell')?.traits).toEqual({ multi: 1 });
    expect(inv.get('magnet')?.traits).toEqual({ thunder: 1 });
  });

  it('inherits traits the partner had gained and caps strength', () => {
    const inv = new Inventory();
    for (let i = 0; i < 4; i++) inv.acquire('aqua');
    for (let i = 0; i < 4; i++) inv.acquire('cyclone');
    inv.fuse('cyclone', 'aqua');
    expect(fusionYield(inv.get('cyclone')!)).toEqual({ gale: 4, aqua: 4 });
    inv.acquire('punch');
    inv.get('punch')!.traits.aqua = 6;
    inv.fuse('punch', 'cyclone');
    expect(inv.get('punch')?.traits).toEqual({ aqua: MAX_TRAIT_STRENGTH, gale: 4 });
  });

  it('rejects self fusion and unowned items', () => {
    const inv = new Inventory();
    inv.acquire('punch');
    expect(() => inv.fuse('punch', 'punch')).toThrow();
    expect(() => inv.fuse('punch', 'rocket')).toThrow();
  });
});

describe('stats', () => {
  it('applies accessory effects and fusion bonus', () => {
    const inv = new Inventory();
    inv.acquire('hachimaki');
    inv.acquire('hachimaki');
    expect(computePlayerStats(inv).stats.might).toBeCloseTo(1.2);
    inv.acquire('gear');
    inv.fuse('hachimaki', 'gear');
    const { stats, global } = computePlayerStats(inv);
    expect(stats.might).toBeCloseTo(1 + 0.2 * 1.2);
    expect(global.statTraits.haste).toBeCloseTo(0.5);
  });

  it('weapon traits change weapon stats; innate element uses weapon level', () => {
    const inv = new Inventory();
    inv.acquire('punch');
    inv.acquire('mirror');
    inv.acquire('mirror');
    inv.acquire('gear');
    inv.acquire('gear');
    inv.acquire('gear');
    inv.fuse('punch', 'mirror');
    inv.fuse('punch', 'gear');
    const { stats, global } = computePlayerStats(inv);
    const ws = computeWeaponStats(inv.get('punch')!, stats, global);
    expect(ws.amount).toBe(1 + traitMath.multiAmount(2));
    expect(ws.cooldown).toBeCloseTo(0.85 * (1 - traitMath.hasteCooldown(3)));
    expect(ws.elements).toEqual({ impact: 1 });
    expect(ws.damage).toBeCloseTo(12 * 1.2);
  });

  it('accessory element traits become global procs', () => {
    const inv = new Inventory();
    inv.acquire('jersey');
    inv.acquire('bell');
    inv.acquire('bell');
    inv.fuse('jersey', 'bell');
    const { global } = computePlayerStats(inv);
    expect(global.procs).toEqual([{ trait: 'frost', strength: 2, chance: traitMath.procChance(2) }]);
  });
});
