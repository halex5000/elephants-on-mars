# Rehearsing the shared market

Run `MARKET_REPORT=market.json npm run test:load -- --market` to write one record per team per mission. Without the environment variable the command prints the records. All connections go to a temporary loopback server. No host passcode, live room or deployment is needed. The existing `npm run test:load` capacity check remains available with its original settings and side games.

The market rehearsal runs three trials each at 2, 25 and 50 four-person teams, one room at a time. Each trial plays the first two missions through the server's own four-minute deadline. Income is $10 and wallets, stock and role rotation follow the game rules. A shared 8× clock makes the run take about nine minutes. All reported waits use game time. Three trials vary seating and animal demand. Local scheduling and WebSocket delivery can still vary between runs.

## How crews play

Four separate WebSocket clients see their own role consoles. A scripted team conversation shares the Vet's target size and the Pilot's purchased rocket requirement. The Captain gives ten individual dollars ($4 Vet, $4 Pilot, $2 Engineer). Crews rotate through ten target animals. The Vet waits for the target to become affordable. The Pilot chooses the most fuel-efficient **currently affordable** rocket that fits. The Engineer loads existing stock first, then looks for a pool large enough to cover the remaining requirement in one purchase. After a lost race, the buyer checks current prices or fuel before retrying. The host lets the deadline expire even when some crews cannot launch.

These are deliberate strategy choices. A crew might switch animals, give the Pilot more money, buy partial fuel sooner, or communicate more slowly in a real session. Automated price checking and a local connection can make races tighter than on phones. This experiment measures the market experienced by this strategy.

## Reading each row

Times ending in `Ms` are game milliseconds. `readyMs`, `attemptMs` and `firstFuelMs` are relative to mission start. They mark when a funded Engineer first knows they need to buy, when they first submit a fuel purchase, and when their role view first confirms a purchase. The two wait columns measure elapsed time from those first two events to confirmation. Timing the first attempt separately distinguishes losing purchase races from waiting for the pool to fill.

If the team still has no purchase at the deadline, its wait is a **lower bound** ending at four minutes. If it never reached a starting event, that wait is null. A team can launch using carried stock without any purchase. Keep those crews in the denominator and distinguish them from teams stranded before getting a rocket.

Rocket failures count server-rejected Pilot purchase requests. Watching an unaffordable listing generates no request. Compare failures with attempts and with the number of crews that never secured a rocket. The runner checks each team's attempts against successful purchases plus rejections, and checks observed fuel purchases against the server's grab count. A failed landing is a measured outcome. An unexpected protocol error, missing measurement or stalled mission fails the rehearsal.

## November 19 rehearsal

[Per-team measurements](market-results.csv) from the local Mac, Node 26.13.0, on the game at `39c8d53`. Each row below pools three independent rooms of that size. Waits are game seconds from first submitted fuel request to first observed purchase among teams that attempted. All attempted purchases eventually yielded a first buy in this sample. Rocket rejections count individual requests, including retries by the same Pilot.

| Teams | Mission | Landings | Teams attempting fuel | Fuel wait, 90th percentile / longest | Rocket rejections / attempts | Teams without rocket |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 1 | 6/6 | 6 | 0.3 / 0.3 s | 0/6 | 0 |
| 2 | 2 | 6/6 | 6 | 0.3 / 0.3 s | 0/6 | 0 |
| 25 | 1 | 75/75 | 75 | 8.7 / 29.0 s | 25/100 | 0 |
| 25 | 2 | 75/75 | 62 | 4.4 / 17.2 s | 29/104 | 0 |
| 50 | 1 | 132/150 | 141 | 16.0 / 32.8 s | 105/249 | 6 |
| 50 | 2 | 130/150 | 104 | 11.1 / 28.8 s | 128/271 | 7 |

At 50 teams, zero of the 245 team-missions with a first fuel attempt crossed the proposed one-minute threshold. Counting from when the Engineer was funded and needed fuel, the longest wait was 43.3 seconds. Some teams bought their first fuel late in the mission after securing a rocket late. Of the 55 team-missions without a fuel attempt, 37 landed using carried stock and 18 missed launch.

The 38 missed launches at 50 teams break down as 13 without a rocket, another 17 with a rocket but no animal, and eight with both purchases and insufficient fuel loaded. This measures the state at timeout. It does not establish that any particular rejected purchase caused a missed launch.

**Recommendation:** keep the global fuel market for the playtest. In this bot strategy the one-minute trigger for fuel sectors was never reached across three full-size rooms. The more promising comparison is the current fixed targets and budgets against crews that change animals or move an extra dollar to the Pilot. Then compare rocket availability if teams still struggle to buy. Use human play to check whether retries and late purchases feel tense or frustrating.
