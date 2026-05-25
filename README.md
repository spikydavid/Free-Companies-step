This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Field of Honour Engine

This repository now includes a TypeScript implementation of the Field of Honour rules engine.

- Engine entrypoint: `lib/field-of-honour/index.ts`
- Core rules implementation: `lib/field-of-honour/engine.ts`
- Contract CSV parser/loader: `lib/field-of-honour/contracts.ts`
- Sheet1 data source used by loader: `data/contracts-sheet1.csv`

### Quick Usage

```ts
import { FieldOfHonourEngine, loadContractsFromSheet1Csv } from "@/lib/field-of-honour";

const contracts = loadContractsFromSheet1Csv("data/contracts-sheet1.csv");

const engine = new FieldOfHonourEngine({
	playerIds: ["P1", "P2", "P3"],
	contracts,
});

const state = engine.getState();
// Build round choices from UI/AI/player input.
// engine.playRound(roundChoices)
// engine.scoreGame() once end condition is reached.
```

### Rules Covered

- Setup (bag, initial contracts, awards, starting depots)
- Round phases: role selection, muster, contract add/draft, campaign, payday
- Campaign costs, region-change costs, eligibility checks
- Battle resolution (deaths, wounds, 4/5 typed success, 6 wild success, sacrifice)
- Role effects: Negotiator, Surgeon, Armourer, Forager, Paymaster, Recruiter, Battle Master, Return All Roles
- Awards at threshold, loans/debt handling, debt repayment
- End-game renown scoring including mixed-type set scoring and tie-breaks

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
