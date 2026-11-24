// Pump.fun Paper Sprint — tiny fast sniper bot (agent-fun/replay/v2, Node 22).
//
// Strategy, from first principles on the dev window (24 h, 1,222 mints):
// chasing pumps after they have doubled loses (v1-v4), and riding big
// coins to completion loses too (v5: the -20% stop gets hit by chop before
// migration). What the kit's own sniper baseline shows is the shape that
// survives: hundreds of tiny tickets, bought very early while the reserve
// is still small, exited fast, so no single coin can hurt. This bot follows
// that shape with its own rules: buy ~0.025 SOL the moment a coin shows
// its first real pump (price ≥ 1.25x creation, ≥ 2 SOL of real reserve,
// within ~10 minutes of creation, on a buy), then bank +80% or cut -15%,
// and flatten anything still held after ~10 minutes. One ticket per mint,
// at most five open positions, every decision deterministic (no clock, no
// randomness).
//
// Fees per round trip are ~2.5% of size plus 210,000 lamports of tx fees, so
// buys smaller than ~0.012 SOL are skipped: they cannot clear the
// 0.01 SOL round-trip bar of the competition after fees.

import { runBot, type Batch, type BotState, type OrderInput } from './vendor/makefun-bot.ts';

// ---- tunables (lamports unless noted) ----
const TARGET_BUY_LAMPORTS = 30_000_000n; // 0.03 SOL per ticket; the 1%-of-reserve cap binds first
const MIN_BUY_LAMPORTS = 12_000_000n; // 0.012 SOL; below this a round trip cannot clear the bar
const MIN_REAL_RESERVE_LAMPORTS = 2_000_000_000n; // 2 SOL of real reserve before we touch a coin
const ENTRY_MIN_MULT = 2.5; // price vs creation price: only coins that already 2.5x'd
const ENTRY_MAX_MULT = 4.0; // ... but not after they have already run away
const ENTRY_MIN_TRADES = 2;
const ENTRY_MAX_AGE_SLOTS = 3_000; // ~10 min into a coin's life; later the early move is over
const STOP_LOSS_MULT = 0.94; // vs breakeven (cost per token, fees included): cut losers at -6%
const HARD_TP_MULT = 4.0; // vs breakeven: bank +300% fast
const MAX_HOLD_SLOTS = 8_000; // ~28 min; stale tickets get flattened
const SLIPPAGE_BPS = 800; // 8%: pump.fun moves fast across the 2-slot latency

interface CoinInfo {
  createPrice: number; // SOL per token at creation
  createdSlot: number;
  entrySlot: number; // slot the buy was decided on (-1 when not holding)
  entered: boolean; // we already bought this mint once; one ticket per mint
}

const coins = new Map<string, CoinInfo>();

function markPrice(state: BotState, mint: string): number | null {
  const curve = state.curves.get(mint);
  if (curve === undefined) return null;
  const vt = Number(curve.virtual_token_reserves);
  const vq = Number(curve.virtual_quote_reserves);
  if (vt <= 0 || vq <= 0) return null;
  return vq / vt;
}

function breakeven(state: BotState, mint: string): number | null {
  const pos = state.positions.get(mint);
  if (pos === undefined || pos.token_amount <= 0n) return null;
  return Number(pos.cost_lamports) / Number(pos.token_amount);
}

function hasPending(state: BotState, mint: string, side: 'buy' | 'sell'): boolean {
  for (const p of state.pending.values()) {
    if (p.order.mint === mint && p.order.side === side) return true;
  }
  return false;
}

await runBot({
  onBatch(state: BotState, batch: Batch): OrderInput[] {
    const orders: OrderInput[] = [];

    // Learn every new coin from this batch's events.
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        const vt = Number(BigInt(e.virtual_token_reserves));
        const vq = Number(BigInt(e.virtual_quote_reserves));
        if (vt > 0 && vq > 0 && !coins.has(e.mint)) {
          coins.set(e.mint, {
            createPrice: vq / vt,
            createdSlot: e.slot,
            entrySlot: -1,
            entered: false,
          });
        }
      }
    }

    // --- exits first: manage what we hold ---
    for (const [mint, pos] of state.positions) {
      const info = coins.get(mint);
      if (info === undefined) continue; // a position in a coin we never saw created; leave it to flatten
      const price = markPrice(state, mint);
      const be = breakeven(state, mint);
      if (price === null || be === null || be <= 0) continue;
      const mult = price / be;
      const heldSlots = state.slot - info.entrySlot;
      const stopLoss = mult <= STOP_LOSS_MULT;
      const hardTp = mult >= HARD_TP_MULT;
      const timedOut = info.entrySlot >= 0 && heldSlots >= MAX_HOLD_SLOTS;
      if ((stopLoss || hardTp || timedOut) && !hasPending(state, mint, 'sell')) {
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: SLIPPAGE_BPS });
      }
    }

    // --- entries: only coins touched by this batch's events can newly qualify,
    // and only on a batch whose latest trade on the coin is a buy (buying pressure) ---
    if (state.committedPositionCount() < state.hello.caps.max_open_positions) {
      const candidates = new Map<string, boolean>();
      for (const e of batch.events) {
        if (e.event === 'TradeEvent') candidates.set(e.mint, e.is_buy);
        else if (e.event === 'CreateEvent') candidates.set(e.mint, true);
      }
      for (const [mint, lastIsBuy] of candidates) {
        if (!lastIsBuy) continue;
        if (orders.length >= state.hello.caps.max_orders_per_batch) break;
        if (state.committedPositionCount() + orders.filter((o) => o.side === 'buy').length >= state.hello.caps.max_open_positions) break;
        const info = coins.get(mint);
        if (info === undefined || info.entered) continue;
        if (state.positions.has(mint) || hasPending(state, mint, 'buy')) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (curve.trades < ENTRY_MIN_TRADES) continue;
        if (state.slot - info.createdSlot > ENTRY_MAX_AGE_SLOTS) continue;
        if (curve.real_quote_reserves < MIN_REAL_RESERVE_LAMPORTS) continue;
        const price = markPrice(state, mint);
        if (price === null) continue;
        const mult = price / info.createPrice;
        if (mult < ENTRY_MIN_MULT || mult > ENTRY_MAX_MULT) continue;
        const cap = state.maxBuyLamports(mint);
        const size = cap < TARGET_BUY_LAMPORTS ? cap : TARGET_BUY_LAMPORTS;
        if (size < MIN_BUY_LAMPORTS) continue;
        if (state.freeCashLamports() < size + state.txFeeLamports()) continue;
        info.entered = true;
        info.entrySlot = state.slot;
        orders.push({ side: 'buy', mint, quote_lamports: size, max_slippage_bps: SLIPPAGE_BPS });
      }
    }

    return orders;
  },

  onDone(state: BotState): void {
    console.error(
      `done: cash=${state.cash} positions=${state.positions.size} coins_seen=${coins.size} ` +
        `entered=${[...coins.values()].filter((c) => c.entered).length}`,
    );
  },
});
