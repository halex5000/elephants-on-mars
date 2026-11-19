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
| ----: | ------: | -------: | --------------------: | -----------------------------------: | ---------------------------: | -------------------: |
|     2 |       1 |      6/6 |                     6 |                          0.3 / 0.3 s |                          0/6 |                    0 |
|     2 |       2 |      6/6 |                     6 |                          0.3 / 0.3 s |                          0/6 |                    0 |
|    25 |       1 |    75/75 |                    75 |                         8.7 / 29.0 s |                       25/100 |                    0 |
|    25 |       2 |    75/75 |                    62 |                         4.4 / 17.2 s |                       29/104 |                    0 |
|    50 |       1 |  132/150 |                   141 |                        16.0 / 32.8 s |                      105/249 |                    6 |
|    50 |       2 |  130/150 |                   104 |                        11.1 / 28.8 s |                      128/271 |                    7 |

At 50 teams, zero of the 245 team-missions with a first fuel attempt crossed the proposed one-minute threshold. Counting from when the Engineer was funded and needed fuel, the longest wait was 43.3 seconds. Some teams bought their first fuel late in the mission after securing a rocket late. Of the 55 team-missions without a fuel attempt, 37 landed using carried stock and 18 missed launch.

The 38 missed launches at 50 teams break down as 13 without a rocket, another 17 with a rocket but no animal, and eight with both purchases and insufficient fuel loaded. This measures the state at timeout. It does not establish that any particular rejected purchase caused a missed launch.

**Recommendation:** keep the global fuel market for the playtest. In this bot strategy the one-minute trigger for fuel sectors was never reached across three full-size rooms. The more promising comparison is the current fixed targets and budgets against crews that change animals or move an extra dollar to the Pilot. Then compare rocket availability if teams still struggle to buy. Use human play to check whether retries and late purchases feel tense or frustrating.

## Testing auction supply and adaptive crews

Run `MARKET_REPORT=auctions.json npm run test:load -- --auction-trials` for twelve local 50-team rooms. Each of three seating seeds runs four conditions in rotating order: the original strategy with one listing, adaptive crews only, two copies only, and both changes together. Each room plays two default-budget missions. Across conditions, animal targets, engine rules, clock speed, and seat seed are matched. WebSocket timing varies.

Adaptive Vets stick with their original target for one minute, then can buy the highest-point affordable animal of that size or smaller. The Pilot learns the new size when the Vet confirms the purchase. A Captain sends the tenth dollar to the Pilot when the animal has already been bought and the crew still needs a rocket. Both actions fit the existing web consoles. The optional listing treatment uses `EXTRA_LISTING_MIN_TEAMS=26` in effect (passed as a local server option), preserving single listings through 25 teams. It supplies exactly two independent prices per animal and rocket, serving the lower one on the same button. The fuel pool stays shared.

The JSON includes each crew's points, switch and transfer flags, rocket attempts and failures, first fuel wait, purchases, loaded fuel and landing. Scores help distinguish landing more animals from choosing only low-value payloads.

### 50-team results, November 19

Each row pools 300 team-missions across three 50-team rooms and two rounds per room. The baseline is a fresh run alongside the treatments. [Per-trial, per-round measurements](auction-trials.csv) include purchase failures, missing items and fuel waits.

| Strategy and supply  |  Landed | Total points | Rocket rejections / attempts | Animal switches | Extra dollars to Pilot |
| -------------------- | ------: | -----------: | ---------------------------: | --------------: | ---------------------: |
| Fixed, one copy      | 260/300 |        7,205 |                      242/530 |               0 |                      0 |
| Adaptive, one copy   | 300/300 |        6,990 |                      128/428 |             112 |                      2 |
| Fixed, two copies    | 300/300 |        9,150 |                      112/412 |               0 |                      0 |
| Adaptive, two copies | 300/300 |        7,260 |                       80/380 |              93 |                      2 |

With the original rules and strategy, 26 of the 40 missed launches lacked at least one purchase, 13 had both purchases but insufficient fuel loaded, and one had both purchases and enough fuel but missed launch. No Engineer who submitted a fuel purchase waited more than 41 game seconds for the first confirmation in any condition.

Adaptive crews landed every mission on one copy, although choosing cheaper payloads reduced total points even with 40 extra landings. They changed animals 112 times and redirected the final dollar just twice. This combined treatment cannot isolate the effect of the dollar. With two copies, fixed crews landed their original payloads every time and scored the most. All three trials used scripted crews on a local machine. Human pacing and enjoyment still need a playtest.

For the first human playtest, keep one copy and tell crews that switching to an affordable animal that fits is a legitimate strategy. Ask whether a switch felt like a satisfying team decision or abandoning the mission to beat a queue. Try two copies in a later large-room session if crews want a better chance to deliver their first choice. The tested threshold of 26 is an operator-selected trial setting; these runs did not estimate an optimal cutoff.
