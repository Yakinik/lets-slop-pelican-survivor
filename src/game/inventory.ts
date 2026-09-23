import { MAX_ITEM_LEVEL, itemDef, isWeaponId, type ItemId } from './items';
import { TRAITS, addTraits, sortedTraits, type TraitMap } from './traits';

export interface OwnedItem {
  id: ItemId;
  level: number;
  /** 合成で得た属性・特性（武器固有の属性はここに含めない） */
  traits: TraitMap;
  /** 合成した回数 */
  fusions: number;
}

export interface FusionResult {
  base: OwnedItem;
  consumed: OwnedItem;
  gained: TraitMap;
}

/** 素材にしたとき付与される属性・特性: 素材自身の属性（強度 = 素材レベル）+ 素材が合成で得ていたもの */
export function fusionYield(partner: OwnedItem): TraitMap {
  const gained: TraitMap = { [itemDef(partner.id).trait]: partner.level };
  return addTraits(gained, partner.traits);
}

export function displayName(item: OwnedItem): string {
  const def = itemDef(item.id);
  const tags = sortedTraits(item.traits)
    .slice(0, 4)
    .map(([t]) => TRAITS[t].tag)
    .join('');
  return tags ? `${tags}・${def.name}` : def.name;
}

export class Inventory {
  readonly items: OwnedItem[] = [];

  get weapons(): OwnedItem[] {
    return this.items.filter((i) => isWeaponId(i.id));
  }

  get accessories(): OwnedItem[] {
    return this.items.filter((i) => !isWeaponId(i.id));
  }

  get(id: ItemId): OwnedItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  has(id: ItemId): boolean {
    return this.get(id) !== undefined;
  }

  /** 未所持なら Lv1 で追加し、所持済みならレベルを上げる */
  acquire(id: ItemId): OwnedItem {
    const owned = this.get(id);
    if (owned) {
      if (owned.level >= MAX_ITEM_LEVEL) throw new Error(`${id} is already max level`);
      owned.level++;
      return owned;
    }
    const item: OwnedItem = { id, level: 1, traits: {}, fusions: 0 };
    this.items.push(item);
    return item;
  }

  canFuse(): boolean {
    return this.items.length >= 2;
  }

  /** base に partner の属性・特性を移し、partner を消費する */
  fuse(baseId: ItemId, partnerId: ItemId): FusionResult {
    if (baseId === partnerId) throw new Error('cannot fuse an item with itself');
    const base = this.get(baseId);
    const partner = this.get(partnerId);
    if (!base || !partner) throw new Error('both items must be owned');
    const gained = fusionYield(partner);
    addTraits(base.traits, gained);
    base.fusions++;
    this.items.splice(this.items.indexOf(partner), 1);
    return { base, consumed: partner, gained };
  }
}
