# Pump.fun Paper Sprint — Momentum Sniper Bot

[![make.fun bounty](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/upinhuy/pump-fun-paper-sprint/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/upinhuy/pump-fun-paper-sprint/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

A paper-trading bot for the [Pump.fun Paper Sprint: Any Bot Can Win](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) bounty on [make.fun](https://make.fun/r/hv9zk8y5). The house replays the bot on 6 hours of real pump.fun market data; the highest net PnL wins. No real money, no entry fee — paper trading only.

## Strategy

Momentum sniper, built from the dev window (24 h, 1,222 mints): most new coins bleed slowly, but ~20% spike to 2x+ and ~6% to 5x+. So the bot:

- **Enters** only after a coin proves early traction: price ≥ 1.5x its creation price (and ≤ 4x), at least 3 trades, ≥ 2 SOL of real reserve, within ~1.5 h of creation. One ticket per mint, 0.1 SOL target size (never below 0.012 SOL, so every round trip clears the competition's 0.01 SOL bar), at most 5 open positions.
- **Exits** on a hard stop (−40% vs breakeven), a hard take-profit (3x breakeven), a trailing stop once the trade is 60% in profit (sells on a 25% retreat from the peak), or a ~45-minute time-out.

Every decision is deterministic — no clock, no randomness — so the two grading runs produce byte-identical action logs.

## Layout

- `main.ts` — the whole strategy (Node 22, TypeScript run as-is, no build, no install).
- `vendor/makefun-bot.ts` — the kit's `agent-fun/replay/v2` bot shim, copied unchanged from the competition kit.

## Run it

Grade locally against the kit's dev window (from the unpacked kit directory):

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/pump-fun-paper-sprint --driver process
```

## License

MIT — see [LICENSE](LICENSE).
