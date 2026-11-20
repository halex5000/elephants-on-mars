# Headless simulation

Deterministic, token-free simulation of whole games on the **real engine** (`src/server/engine.ts`). No sockets, timers, wall clock, network or LLM. Simulated time advances in fixed ticks and every random choice derives from the seed, so the same seed and scenario give the same trace, metrics and `traceHash`.

> **Simulation informs, but does not replace, the human playtest** (#32). Bots are not people: use these numbers to find broken or lopsided mechanics, not to decide product questions like economy tuning (#36) or large-market contention (#37).

## Run it

```bash
node --import tsx scripts/sim.ts --scenario room --seeds 1-20 --out results.jsonl
node --import tsx scripts/sim.ts --scenario shootout --seeds 1-5 --trace   # add every action
node --import tsx scripts/sim.ts --help
node --import tsx --test tests/unit/sim.test.ts                             # reproducibility tests
```

Scenarios (`tests/sim/sim.ts`): `small` (4 teams), `room` (12), `large` (50, second listing copy at 26+ teams; roughly 30 s per game), `shootout` (12 teams, all strategies). Teams get strategies round-robin. Defaults mirror the game's (4 min missions, $10 income, 6 missions). Seed, scenario and clock (`startMs`, `tickMs`, `gapMs`) are explicit fields; nothing reads real time.

## Strategies

| id | Information | Behaviour |
| --- | --- | --- |
| `baseline` | role-filtered `playerView` only | The practice bot (`src/server/market-bot.ts`, unchanged) |
| `adaptive` | role-filtered `playerView` only | Practice bot that downsizes its animal late and tops up the pilot |
| `oracle` | **OMNISCIENT** (reads the whole game) | Upper-bound reference: plans the best payload from hidden data, buys at floor prices, avoids listings other teams took. Always labelled in output. |

Role-limited strategies act through `TeamPlay.view(playerId)`, the same slice the server sends that player. A teammate "radio" is the shared `Crew` object, as in the practice bots. Add a strategy by implementing `Strategy` and registering it in `STRATEGIES`.

## Output (JSONL)

- `kind: "mission"`, one per team per mission: `seed, scenario, strategy, round, team, status (landed|failed|scrubbed), points, spend, animal/animalPaid, rocket/rocketPaid, fuelSent, fuelNeeded, fuelGrabs, animalAtMs, rocketAtMs, firstFuelAtMs, launchAtMs` (ms into the mission), `rejected` (engine refusals).
- `kind: "game"`, one per seed: outcome counts, `groupPoints` vs `terraformTarget`, species, spend, `pointsByStrategy`, `standings`, `traceHash`.
- `kind: "trace"` (with `--trace`): every action with simulated time, role, argument, and price or refusal text.

A summary by strategy is printed to stderr.

## Notes

- Game rules are never reimplemented or changed; actions call the engine, and its `GameError` refusals are recorded as `rejected`.
- The bots are not tuned to be good. Zero failures and scrubs for the practice bots mostly shows they are conservative.
