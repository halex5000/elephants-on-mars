# Playing with 50 teams

**Proposal for playtesting.** Keep one authoritative server and a shared planet. Use the existing global market as the control. Trial sector fuel pools only if repeated measurements show a long wait for the last few teams. Keep both modes comparable for the facilitator.

## What the current rehearsal measured

On November 19, 2026, `npm run test:load` passed on a local Mac with Node 26.13.0 at commit `79788bf`. There was one 200-player room and five simultaneous 12-player rooms. Bots and server shared one process. Each team played two missions.

| Measurement                           | 50-team room | Five 3-team rooms |
| ------------------------------------- | -----------: | ----------------: |
| Time to join                          |       292 ms |     40–41 ms each |
| Time until last launch, mission 1     |     16.574 s |     2.824–2.828 s |
| Time until last launch, mission 2     |      1.224 s |     2.847–2.849 s |
| Successful landings                   |    100 / 100 |           30 / 30 |
| Market collisions                     |        1,225 |          10 total |
| Unexpected errors reported by harness |            0 |                 0 |

The run took 18.388 seconds and used 335 MB RSS including bots. The clock ran at 20× with ten game minutes and $40 income per mission. The last first-round launch came at roughly 5:31 on the game clock. The normal clock allows 4:00 and the normal budget is $10. Bots poll in real time and fund roles assuming the larger budget. A default-rules rehearsal needs a bot that budgets $10 across all three buyers. The collision count combines auction price jumps and failed fuel purchases. It gives no per-team wait distribution. This run establishes a baseline for comparison. It cannot establish Fly machine capacity, human success rates, or which resource caused each wait.

## Market choices

| Trial               | What players experience                                                                                                                                                                                                               | Trade-off to measure                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One shared market   | Any team can reset a listing or take the fuel everyone is watching. Today's rules and shared-screen narrative carry over.                                                                                                             | A few fast crews may repeatedly win. Measure the longest waits and failed attempts per crew.                                                                                  |
| Sectors of 6–8      | At 50 teams, make seven stable groups (one of eight and six of seven). In the first trial only fuel is local. Generate fuel using each sector's team count. Show the sector on the Engineer console. Animals and rockets stay global. | Fewer rivals per pool, but a sector's Engineers can still compete. Compare distributions by sector. Keep memberships stable when roles rotate or late players join teams.     |
| Listings that scale | Keep one bazaar. Trial multiple independent offers for a popular rocket size, with separate price-reset clocks. Add a second offer only when the team-count threshold under test is reached.                                          | More purchasing opportunities and more choices to scan on phones. This addresses rocket contention directly and leaves fuel scarcity intact. Measure rocket waits separately. |

Use a fixed assignment and the same scripted demand across trials. Compare 2, 25 and 50 teams over repeated runs, then play two rounds with people. Record first affordable fuel attempt to first successful buy per team, including teams still waiting at timeout. Record rocket retries, landed teams at four minutes, and action-to-view latency separately. Proposed trigger for a sector trial: at least 10% of teams wait over one minute for their first fuel purchase in repeated 50-team runs. Prefer a variant that reduces that tail while crews still report making meaningful buy-or-wait decisions. Confirm thresholds with the host before using them as release criteria.

## What players and the host see

During play, anchor the projected screen on the mission clock and Mars. Show one large “32 of 50 launched” count, a short launch feed and seven compact progress rows if sectors are active (for example, “Aurora · 5 of 7 launched”). In global mode show room totals. Keep per-role prices, fuel requirements and other private information off the shared screen.

Give the facilitator a separate roster grouped by waiting, preparing and launched. Show counts and time in each state. Let the host expand a group to find the teams that may need help. Keep roster order stable during updates so the host can follow a particular crew.

Between missions, show the group's terraforming gain and newly landed species first, then the top ten teams with shared ranks for tied scores. Offer the full standings on demand. Every crew's own result should appear on its phone even if it falls outside the top ten. At the final debrief, show cumulative scores and a browsable full ranking. Check the projector from the back of a room and check a narrow phone viewport with long team names before accepting either layout.
