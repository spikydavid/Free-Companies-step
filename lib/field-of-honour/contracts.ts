import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Contract, ContractType, ContractTier, Region } from "./types";

const REQUIRED_CONTRACT_TYPES: ContractType[] = [
  "DEVASTATE",
  "ELIMINATE",
  "GUARD",
  "HUNT",
  "PLUNDER",
  "SUPPLY",
];

const REQUIRED_REGIONS: Region[] = ["East", "North", "South", "West", "Any"];

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  cells.push(current);
  return cells.map((value) => value.trim());
}

function toInt(value: string, fallback = 0): number {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseContractType(value: string): ContractType {
  if (REQUIRED_CONTRACT_TYPES.includes(value as ContractType)) {
    return value as ContractType;
  }

  throw new Error(`Unsupported contract type: ${value}`);
}

function parseRegion(value: string): Region {
  if (REQUIRED_REGIONS.includes(value as Region)) {
    return value as Region;
  }

  throw new Error(`Unsupported region: ${value}`);
}

function parseTier(value: string): ContractTier {
  if (["A", "B", "C", "R"].includes(value)) {
    return value as ContractTier;
  }

  throw new Error(`Unsupported tier: ${value}`);
}

function parseRowToContract(row: string[], headerMap: Record<string, number>): Contract {
  const copies = toInt(row[headerMap.Copies]);
  const cardNumber = toInt(row[headerMap.txtCardNumber]);
  const title = row[headerMap.txtTitle];
  const rewardCrowns = toInt(row[headerMap.txtMoney]);
  const rewardRenown = toInt(row[headerMap.txtRenown]);

  return {
    id: `C${cardNumber}`,
    cardNumber,
    title,
    type: parseContractType(row[headerMap.txtType]),
    region: parseRegion(row[headerMap.txtRegion]),
    tier: parseTier(row[headerMap.txtTier]),
    rewardCrowns,
    rewardRenown,
    requirements: {
      melee: toInt(row[headerMap.txtMelee]),
      ranged: toInt(row[headerMap.txtRanged]),
      mounted: toInt(row[headerMap.txtMounted]),
    },
    copies,
    musterText: row[headerMap.txtMuster] || undefined,
  };
}

export function parseContractsCsv(csvText: string): Contract[] {
  const rows = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => parseCsvLine(line));

  if (rows.length < 2) {
    throw new Error("Contracts CSV must include a header and at least one data row");
  }

  const header = rows[0];
  const headerMap = Object.fromEntries(header.map((name, idx) => [name, idx]));

  const required = [
    "Copies",
    "txtTitle",
    "txtMoney",
    "txtRenown",
    "txtRegion",
    "txtType",
    "txtCardNumber",
    "txtMuster",
    "txtMelee",
    "txtRanged",
    "txtMounted",
    "txtTier",
  ];

  for (const key of required) {
    if (headerMap[key] === undefined) {
      throw new Error(`Missing required contracts CSV column: ${key}`);
    }
  }

  const contracts: Contract[] = [];

  for (const row of rows.slice(1)) {
    if (!row[headerMap.txtCardNumber]) {
      continue;
    }

    const contract = parseRowToContract(row, headerMap);
    if (contract.copies <= 0) {
      continue;
    }

    contracts.push(contract);
  }

  return contracts;
}

export function loadContractsFromSheet1Csv(csvPath = "data/contracts-sheet1.csv"): Contract[] {
  const absolutePath = resolve(csvPath);
  const csvText = readFileSync(absolutePath, "utf8");
  return parseContractsCsv(csvText);
}