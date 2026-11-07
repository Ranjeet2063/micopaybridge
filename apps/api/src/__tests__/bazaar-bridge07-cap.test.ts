import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";

/**
 * [BRIDGE-07] Explicit Escrow Cap Protocol Test Suite
 *
 * Verifies that POST /api/v1/bazaar/accept explicitly distinguishes
 * between requested_amount_usdc and locked_amount_usdc, and sets capped: true
 * whenever demo cap applies.
 */

const INTENT_ID = "int-test-bridge07";

const activeIntent = {
  id: INTENT_ID,
  agent_address: "GTESTAGENT",
  status: "active" as const,
  wanted_symbol: "USDC",
  wanted_amount: "100",
  offered_symbol: "XRP",
  offered_amount: "200",
  secret_hash: null,
  selected_quote_id: null,
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
};

vi.mock("../services/stellar.service.js", () => ({
  lockAtomicSwap: vi.fn(),
}));

vi.mock("../db/bazaar.js", () => ({
  initBazaarTables: vi.fn(async () => {}),
  seedAgentHistories: vi.fn(async () => {}),
  seedIntents: vi.fn(async () => {}),
  createIntent: vi.fn(async (i: unknown) => i),
  getIntent: vi.fn(async () => ({ ...activeIntent })),
  getActiveIntents: vi.fn(async () => []),
  updateIntent: vi.fn(async () => {}),
  createQuote: vi.fn(async (q: unknown) => q),
  getQuote: vi.fn(async () => ({
    id: "qut-fixture",
    intent_id: INTENT_ID,
    from_agent: "GMAKER",
    rate: 1,
    valid_until: new Date(Date.now() + 300_000).toISOString(),
    created_at: new Date().toISOString(),
  })),
  getQuotesForIntent: vi.fn(async () => [
    {
      id: "qut-fixture",
      intent_id: INTENT_ID,
      from_agent: "GMAKER",
      rate: 1,
      valid_until: new Date(Date.now() + 300_000).toISOString(),
      created_at: new Date().toISOString(),
    },
  ]),
  getAgentHistory: vi.fn(async () => null),
  upsertAgentHistory: vi.fn(async () => {}),
  intentRowToObject: (row: unknown) => row,
  getBazaarStats: vi.fn(async () => ({})),
}));

import { bazaarRoutes } from "../routes/bazaar.js";
import { lockAtomicSwap } from "../services/stellar.service.js";

const PAGO = { "x-payment": "mock:GTESTBAZAAR:0.005", "content-type": "application/json" };

describe("[BRIDGE-07] Explicit Escrow Cap Protocol", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.X402_MOCK_MODE = "true";
    process.env.DEMO_LOCK_CAP_USDC = "0.01";
    app = Fastify();
    await app.register(bazaarRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.X402_MOCK_MODE;
    delete process.env.DEMO_LOCK_CAP_USDC;
  });

  beforeEach(() => {
    vi.mocked(lockAtomicSwap).mockClear();
  });

  it("response distinguishes requested amount from locked amount when capped", async () => {
    vi.mocked(lockAtomicSwap).mockResolvedValueOnce({
      txHash: "tx-cap-100",
      swapId: "swap-cap-100",
      explorerUrl: "https://stellar.expert/explorer/testnet/tx/tx-cap-100",
      lockedAmountUsdc: 0.01,
      requestedAmountUsdc: 100,
      capped: true,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/bazaar/accept",
      headers: PAGO,
      payload: {
        intent_id: INTENT_ID,
        secret_hash: "c".repeat(64),
        amount_usdc: 100,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.handshake.requested_amount_usdc).toBe(100);
    expect(body.handshake.locked_amount_usdc).toBe(0.01);
    expect(body.handshake.capped).toBe(true);
  });

  it("leaves requests below the cap unaffected with capped=false", async () => {
    vi.mocked(lockAtomicSwap).mockResolvedValueOnce({
      txHash: "tx-nocap-005",
      swapId: "swap-nocap-005",
      explorerUrl: "https://stellar.expert/explorer/testnet/tx/tx-nocap-005",
      lockedAmountUsdc: 0.005,
      requestedAmountUsdc: 0.005,
      capped: false,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/bazaar/accept",
      headers: PAGO,
      payload: {
        intent_id: INTENT_ID,
        secret_hash: "d".repeat(64),
        amount_usdc: 0.005,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.handshake.requested_amount_usdc).toBe(0.005);
    expect(body.handshake.locked_amount_usdc).toBe(0.005);
    expect(body.handshake.capped).toBe(false);
  });
});
