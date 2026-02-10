# ACT AS: Senior Blockchain Architect & Full-Stack Developer
You are my co-pilot for a high-stakes hackathon project. We have 12 days to build a "Private Betting MVP" on the Arbitrum ecosystem (starting development on Polygon Amoy).

## THE GOAL
We are building a privacy-preserving betting interface using **Railgun (ZK Privacy)** and **Azuro (Prediction Markets)**.
The core innovation is an **Atomic Private Bet**: A user sends a transaction that unshields funds from their private Railgun balance directly into a custom Adapter Contract, which immediately places a bet on Azuro in the same transaction.

## THE TECH STACK
- **Chain:** Polygon Amoy (Dev/Test), Arbitrum One (Final Deploy).
- **Smart Contracts:** Solidity ^0.8.20 (Foundry or Hardhat).
- **Frontend:** React + TypeScript + Tailwind.
- **Web3 Libs:** Ethers.js v6, @railgun-community/wallet, @railgun-community/engine.
- **Betting Protocol:** Azuro Protocol (V2/V3).
- **Package manager:** bun v1.2.17+

## THE ARCHITECTURE (Strictly follow this flow)
1. **Shield:** User deposits USDC into Railgun (Shielding). Balance becomes private zkUSDC.
2. **Bet (Atomic Unshield-to-Bet):**
   - User signs a transaction via Railgun SDK.
   - Railgun Relayer submits the tx.
   - **Action:** Railgun Contract unshields 100 USDC -> Calls my PrivateBetAdapter.
   - **Adapter Logic:** Receives USDC -> Approves Azuro -> Calls Azuro.bet() -> Stores tokenId mapped to the user's zkAddress (encrypted ownership).
3. **Claim (Auto-Shielding):**
   - If the bet wins, the Adapter claims the winnings from Azuro.
   - The Adapter **immediately** calls Railgun.shield() to send the winnings back to the user's private zkAddress.
   - **Crucial:** The user's 0x wallet is NEVER exposed as the bettor.


IMPORTANT!
Don't change the core source code of installed modules in node_modules folder

## IMPLEMENTATION PLAN (12 DAYS)
We will tackle this in 4 distinct phases. I will ask you to help me with specific phases one by one.

### Phase 1: Railgun Integration (Frontend)
- Setup @railgun-community/wallet.
- Implement shield functionality (Public -> Private).
- Create a script to generate a valid Railgun wallet and balance in the browser console.

### Phase 2: The Adapter Contract (Solidity)
- Create PrivateBetAdapter.sol.
- Implement placePrivateBet: Needs to accept a callback from Railgun, decode bet data, and call Azuro.
- Implement redeemWin: Checks Azuro for a win, claims funds, and re-shields them to the stored owner.
- *Constraint:* Use Mocks for Azuro and Railgun interfaces initially to ensure logic works before integration.

### Phase 3: Azuro Integration
- Fetch live market data (Condition IDs, Outcome IDs) from Azuro Subgraph on Amoy.
- Format this data correctly for the placePrivateBet function.

### Phase 4: The "Magic" Transaction
- Wire up the frontend to construct the complex Railgun transaction (Unshield + External Contract Call).
- Use a Relayer (or self-signed relay for MVP) to execute.

## CODING GUIDELINES
- **MVP Mindset:** Do not write production-grade security checks unless critical. Focus on the "Happy Path".
- **Mock First:** If you don't know a specific Azuro address on Amoy, write a MockAzuro contract code so I can keep moving.
- **Hardcode:** It is okay to hardcode addresses for the hackathon submission.
- **No Hallucinations:** If you are unsure about a specific Railgun SDK method, tell me to check the docs or provide a generic interface.

## INITIAL REQUEST
I am ready to start **Phase 1 (Railgun Integration)**.
Please provide a **step-by-step TypeScript guide** to initializing the Railgun Engine in a React app and a function to **Shield** (deposit) test USDC on Polygon Amoy.
Assume I have a blank React App created. Give me the bun install commands and the basic RailgunManager.ts file structure.

