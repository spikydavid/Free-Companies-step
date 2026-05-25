import type { TroopType } from "./types";

export interface TroopDie {
  troopType: TroopType;
  sides: 6;
}

export interface TroopDiceBagConfig {
  melee?: number;
  ranged?: number;
  mounted?: number;
}

const DEFAULT_TROOP_DICE_BAG_CONFIG: Required<TroopDiceBagConfig> = {
  melee: 36,
  ranged: 18,
  mounted: 12,
};

function createDice(type: TroopType, count: number): TroopDie[] {
  return Array.from({ length: count }, () => ({
    troopType: type,
    sides: 6,
  }));
}

export function buildTroopDiceBag(config: TroopDiceBagConfig = {}): TroopDie[] {
  const counts = {
    ...DEFAULT_TROOP_DICE_BAG_CONFIG,
    ...config,
  };

  return [
    ...createDice("melee", counts.melee),
    ...createDice("ranged", counts.ranged),
    ...createDice("mounted", counts.mounted),
  ];
}
