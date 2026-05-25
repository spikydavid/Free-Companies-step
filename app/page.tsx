import { loadContractsFromSheet1Csv } from "@/lib/field-of-honour/contracts";

import { StartGameClient } from "./start-game-client";

export default function Home() {
  const contracts = loadContractsFromSheet1Csv("data/contracts-sheet1.csv");
  return <StartGameClient contracts={contracts} />;
}
