import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/server/engine.js';
import { ANIMALS, ROCKETS, FUEL_SEND_STEP, animalById, rocketById, fits } from '../../src/server/catalog.js';
import { AUCTION, FUEL, auctionPrice, fuelInPool, fuelRate } from '../../src/shared/market.js';
import { ROLES } from '../../src/shared/protocol.js';
import { setup, started, seeded, holder, tid, fund, mission, gatherFuel, T0, SETTLED } from '../helpers.js';

const throwsGame = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: unknown) => e instanceof E.GameError && re.test(e.message));
const roleOf = (g: E.Game, pid: string) => E.teamOf(g, pid)!.roles.join('+');

describe('lobby and teams', () => {
  test('names are trimmed, capped, and required', () => {
    const g = E.createGame('X', 'h', T0);
    assert.equal(E.addPlayer(g, 'a', 't', '   Alex   the   Great  ', T0).name, 'Alex the Great');
    assert.equal(E.addPlayer(g, 'b', 't', 'x'.repeat(100), T0).name.length, E.LIMITS.nameLength);
    throwsGame(() => E.addPlayer(g, 'c', 't', '   ', T0), /name/);
  });

  test('player cap', () => {
    const g = E.createGame('X', 'h', T0);
    for (let i = 0; i < E.LIMITS.maxPlayers; i++) E.addPlayer(g, `p${i}`, 't', `P${i}`, T0);
    throwsGame(() => E.addPlayer(g, 'over', 't', 'Over', T0), /full/);
  });

  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 50, 200]) {
    test(`${n} players: everyone seated once, every team covers all four roles`, () => {
      const g = setup(n);
      const seated = g.teams.flatMap(t => t.members.map(m => m.playerId));
      assert.equal(seated.length, n);
      assert.equal(new Set(seated).size, n);
      for (const t of g.teams) assert.deepEqual(new Set(t.members.flatMap(m => m.roles)), new Set(ROLES), t.name);
    });
  }

  test('8 players at size 4 → 2 teams, one role each', () => {
    const g = setup(8);
    assert.equal(g.teams.length, 2);
    for (const t of g.teams) assert.ok(t.members.every(m => m.roles.length === 1));
  });

  test('team names stay unique with more teams than names', () => {
    const g = setup(200);
    assert.equal(new Set(g.teams.map(t => t.name)).size, g.teams.length);
  });

  test('cannot make teams with nobody, or mid-game', () => {
    throwsGame(() => E.makeTeams(E.createGame('X', 'h', T0), seeded()), /Nobody/);
    throwsGame(() => E.makeTeams(started(4), seeded()), /before the first mission/);
  });

  test('latecomers land on the smallest team', () => {
    const g = setup(7);
    E.addPlayer(g, 'late', 't', 'Late', T0);
    E.seatLatecomers(g);
    assert.equal(E.teamOf(g, 'late')!.team.members.length, 4);
  });

  test('removing a player re-covers every role', () => {
    const g = setup(4);
    E.removePlayer(g, holder(g, 0, 'engineer'));
    assert.deepEqual(new Set(g.teams[0]!.members.flatMap(m => m.roles)), new Set(ROLES));
  });

  test('settings are clamped', () => {
    assert.deepEqual(E.cleanSettings({ minutes: -5, income: 1e12, teamSize: 99, rounds: 0 }), { minutes: 0.5, income: 10000, teamSize: 8, rounds: 1 });
  });
});

describe('roles reshuffle every mission', () => {
  test('mission 1 keeps the briefing roles', () => {
    const g = setup(8);
    const before = g.players.map(p => roleOf(g, p.id));
    E.startRound(g, T0, seeded(1));
    assert.deepEqual(g.players.map(p => roleOf(g, p.id)), before);
  });

  test('from mission 2, roles change, teams stay the same, every role still covered', () => {
    const g = setup(8, { rounds: 6 });
    const teamOf = new Map(g.players.map(p => [p.id, E.teamOf(g, p.id)!.team.id]));
    E.startRound(g, T0, seeded(1)); E.endRound(g);
    let changed = 0;
    for (let r = 2; r <= 6; r++) {
      const before = new Map(g.players.map(p => [p.id, roleOf(g, p.id)]));
      E.startRound(g, T0, seeded(r)); E.endRound(g);
      for (const p of g.players) {
        assert.equal(E.teamOf(g, p.id)!.team.id, teamOf.get(p.id), 'same team');
        if (roleOf(g, p.id) !== before.get(p.id)) changed++;
      }
      for (const t of g.teams) assert.deepEqual(new Set(t.members.flatMap(m => m.roles)), new Set(ROLES));
    }
    assert.equal(changed, 8 * 5, 'with 4-person teams, nobody keeps the same role twice in a row');
  });

  test('regression: nobody keeps their role, across thousands of reshuffles at every team size', () => {
    // A team of 4 only gets a full reshuffle about 37% of the time at random. The old code
    // gave up after 8 tries and kept the last one, so ~2% of reshuffles left someone in place.
    const rng = seeded(2026);
    for (let k = 2; k <= 8; k++) {
      const team = { id: 't1', name: 'T', members: Array.from({ length: k }, (_, i) => ({ playerId: `p${i}`, roles: [] as string[] })) } as unknown as Parameters<typeof E.reshuffleRoles>[0];
      E.assignRoles(team);
      let repeats = 0;
      for (let n = 0; n < 2000; n++) {
        const before = new Map(team.members.map(m => [m.playerId, m.roles.join()]));
        E.reshuffleRoles(team, rng);
        repeats += team.members.filter(m => before.get(m.playerId) === m.roles.join()).length;
        assert.deepEqual(new Set(team.members.flatMap(m => m.roles)), new Set(ROLES), 'every role covered');
      }
      assert.equal(repeats, 0, `team of ${k}: ${repeats} players kept their role`);
    }
  });

  test('money belongs to the role, not the person: a reshuffle hands the wallet over', () => {
    const g = started(4, { rounds: 2 });
    fund(g, 0, { vet: 100 });
    const oldVet = holder(g, 0, 'vet');
    E.endRound(g); E.startRound(g, T0 + 1, seeded(9));
    const newVet = holder(g, 0, 'vet');
    assert.notEqual(newVet, oldVet);
    assert.equal(E.balance(g, tid(g, 0), 'vet'), 100);
  });
});

describe('round flow', () => {
  test('start → end → … → finish → new game', () => {
    const g = setup(4, { rounds: 2, minutes: 4 });
    E.startRound(g, T0, seeded()); assert.equal(g.phase, 'play'); assert.equal(g.endsAt, T0 + 240_000);
    throwsGame(() => E.startRound(g, T0, seeded()), /already running/);
    throwsGame(() => E.finish(g), /End the current mission/);
    E.endRound(g); E.startRound(g, T0, seeded()); E.endRound(g);
    throwsGame(() => E.startRound(g, T0, seeded()), /All missions are done/);
    E.finish(g); assert.equal(g.phase, 'final');
    E.newGame(g, T0); assert.equal(g.phase, 'lobby'); assert.equal(g.players.length, 4); assert.equal(g.teams.length, 0);
  });

  test('addTime extends from now if already expired, and is capped', () => {
    const g = started(4);
    const end = g.endsAt!;
    E.addTime(g, 60, end + 10_000); assert.equal(g.endsAt, end + 70_000);
    const b = g.endsAt!; E.addTime(g, 99999, T0); assert.equal(g.endsAt, b + E.LIMITS.maxAddSeconds * 1000);
  });

  test('every mission starts with fresh markets', () => {
    const g = started(4, { rounds: 2 });
    fund(g, 0, { vet: 500 });
    E.buyAnimal(g, holder(g, 0, 'vet'), 'giraffe', Infinity, T0 + 5000);
    E.endRound(g); E.startRound(g, T0 + 100_000, seeded());
    assert.equal(g.market.animals.giraffe, T0 + 100_000);
    assert.equal(g.market.fuelResetAt, T0 + 100_000);
  });
});

describe('money', () => {
  test('the Captain gets the income every mission; unspent money carries over', () => {
    const g = setup(4, { income: 10, rounds: 3 });
    assert.equal(E.balance(g, tid(g, 0), 'captain'), 10, 'available during the briefing');
    E.startRound(g, T0, seeded()); assert.equal(E.balance(g, tid(g, 0), 'captain'), 10);
    E.endRound(g); E.startRound(g, T0, seeded()); assert.equal(E.balance(g, tid(g, 0), 'captain'), 20);
    for (const r of ['vet', 'pilot', 'engineer'] as const) assert.equal(E.balance(g, tid(g, 0), r), 0);
  });

  test('transfers move money and are validated', () => {
    const g = started(4);
    fund(g, 0, { vet: 300 });
    assert.equal(E.balance(g, tid(g, 0), 'vet'), 300);
    const cap = holder(g, 0, 'captain');
    throwsGame(() => E.transfer(g, cap, 'captain', 'vet', 5000, T0), /don't have/);
    throwsGame(() => E.transfer(g, cap, 'captain', 'vet', 0, T0), /above zero/);
    throwsGame(() => E.transfer(g, cap, 'captain', 'vet', -5, T0), /above zero/);
    throwsGame(() => E.transfer(g, cap, 'captain', 'captain', 10, T0), /someone else/);
    throwsGame(() => E.transfer(g, cap, 'vet', 'pilot', 10, T0), /Only the vet/);
    E.transfer(g, holder(g, 0, 'vet'), 'vet', 'captain', 50.9, T0);
    assert.equal(E.balance(g, tid(g, 0), 'vet'), 250, 'fractions floored');
  });

  test("a player can't move another team's money", () => {
    const g = started(8);
    E.transfer(g, holder(g, 1, 'captain'), 'captain', 'vet', 100, T0);
    assert.equal(E.balance(g, tid(g, 0), 'vet'), 0);
    assert.equal(E.balance(g, tid(g, 1), 'vet'), 100);
  });

  test("can't buy what you can't afford", () => {
    const g = started(4);
    fund(g, 0, { vet: 1, pilot: 1 });
    const t = T0 + SETTLED;
    throwsGame(() => E.buyAnimal(g, holder(g, 0, 'vet'), 'elephant', Infinity, t), /Not enough/);
    throwsGame(() => E.buyRocket(g, holder(g, 0, 'pilot'), 'titan', Infinity, t), /Not enough/);
    throwsGame(() => E.buyFuel(g, holder(g, 0, 'engineer'), 1, t), /Not enough/);
  });
});

describe('auction market (animals and rockets)', () => {
  test('price starts high, drifts to the floor, then stays there', () => {
    assert.equal(auctionPrice(100, T0, T0), 150);
    assert.equal(auctionPrice(100, T0, T0 + AUCTION.decayMs / 2), 100);
    assert.equal(auctionPrice(100, T0, T0 + AUCTION.decayMs), 50);
    assert.equal(auctionPrice(100, T0, T0 + AUCTION.decayMs * 5), 50);
    assert.equal(auctionPrice(100, T0, T0 - 5000), 150, 'clock skew before reset never goes above high');
    assert.equal(auctionPrice(1, T0, T0 + AUCTION.decayMs), 1, 'never below $1');
  });

  test('buying charges the live price, and resets that listing to full price for every team', () => {
    const g = started(8);
    fund(g, 0, { vet: 500 }); fund(g, 1, { vet: 500 });
    const t = T0 + SETTLED, base = animalById('elephant')!.base;
    const paid = E.buyAnimal(g, holder(g, 0, 'vet'), 'elephant', Infinity, t);
    assert.equal(paid, auctionPrice(base, 0, AUCTION.decayMs), 'settled at the floor');
    assert.equal(E.animalPriceNow(g, 'elephant', t), auctionPrice(base, t, t), 'back to high for everyone');
    assert.ok(E.animalPriceNow(g, 'elephant', t) > paid);
    assert.equal(E.animalPriceNow(g, 'orca', t), auctionPrice(animalById('orca')!.base, 0, AUCTION.decayMs), 'other listings untouched');
    assert.equal(E.buyAnimal(g, holder(g, 1, 'vet'), 'elephant', Infinity, t + 1), auctionPrice(base, t, t + 1));
  });

  test('a purchase is refused if the price jumped above what the player saw', () => {
    const g = started(8);
    fund(g, 0, { pilot: 500 }); fund(g, 1, { pilot: 500 });
    const t = T0 + SETTLED;
    E.buyRocket(g, holder(g, 0, 'pilot'), 'titan', Infinity, t);
    throwsGame(() => E.buyRocket(g, holder(g, 1, 'pilot'), 'titan', 5, t + 10), /Price jumped/);
    assert.equal(E.balance(g, tid(g, 1), 'pilot'), 500, 'nothing charged');
  });

  test('buying again replaces the item and is not refunded', () => {
    const g = started(4);
    fund(g, 0, { vet: 300 });
    const t = T0 + SETTLED;
    const p1 = E.buyAnimal(g, holder(g, 0, 'vet'), 'elephant', Infinity, t);
    const p2 = E.buyAnimal(g, holder(g, 0, 'vet'), 'penguin', Infinity, t);
    assert.equal(E.picksFor(g, tid(g, 0), 1).animal, 'penguin');
    assert.equal(E.balance(g, tid(g, 0), 'vet'), 300 - p1 - p2);
  });
});

describe('fuel pool', () => {
  test('fills at a rate that scales with teams, capped', () => {
    assert.equal(fuelRate(1), FUEL.minRate);
    assert.equal(fuelRate(50), 50 * FUEL.ratePerTeam);
    assert.equal(fuelInPool(T0, 2, T0 + 10_000), 20);
    assert.equal(fuelInPool(T0, 2, T0 + 10_000_000), FUEL.cap);
    assert.equal(fuelInPool(T0, 2, T0 - 10_000), 0);
  });

  test('a grab takes the whole pool for a flat price and empties it for everyone', () => {
    const g = started(8);
    fund(g, 0, { engineer: 100 }); fund(g, 1, { engineer: 100 });
    const rate = E.fuelRateFor(g);
    const got = E.buyFuel(g, holder(g, 0, 'engineer'), 1, T0 + 50_000);
    assert.equal(got, Math.floor(50 * rate));
    assert.equal(E.balance(g, tid(g, 0), 'engineer'), 100 - FUEL.grabCost);
    assert.equal(E.fuelPoolNow(g, T0 + 50_000), 0);
    throwsGame(() => E.buyFuel(g, holder(g, 1, 'engineer'), 1, T0 + 50_000), /empty/);
  });

  test('a grab is refused if another engineer emptied the pool since the player looked', () => {
    const g = started(8);
    fund(g, 0, { engineer: 100 }); fund(g, 1, { engineer: 100 });
    const saw = E.fuelPoolNow(g, T0 + 60_000);
    E.buyFuel(g, holder(g, 0, 'engineer'), saw, T0 + 60_000);
    throwsGame(() => E.buyFuel(g, holder(g, 1, 'engineer'), saw, T0 + 62_000), /just took the fuel/);
    assert.equal(E.balance(g, tid(g, 1), 'engineer'), 100, 'nothing charged');
  });

  test('grabs go into the team stock and add up', () => {
    const g = started(4);
    fund(g, 0, { engineer: 300 });
    const a1 = E.buyFuel(g, holder(g, 0, 'engineer'), 1, T0 + 30_000);
    const a2 = E.buyFuel(g, holder(g, 0, 'engineer'), 1, T0 + 60_000);
    assert.equal(E.fuelStockOf(g, tid(g, 0)), a1 + a2);
    assert.equal(E.picksFor(g, tid(g, 0), 1).fuel, 0, 'nothing on the rocket until it is sent');
  });

  test(`sending moves ${FUEL_SEND_STEP} units at a time from stock to the mission, then whatever is left`, () => {
    const g = started(4);
    fund(g, 0, { engineer: 300 });
    const got = E.buyFuel(g, holder(g, 0, 'engineer'), 1, T0 + 25_000); // 25 units at 1/s
    assert.equal(got, 25);
    const eng = holder(g, 0, 'engineer'), id = tid(g, 0);
    assert.equal(E.sendFuel(g, eng, T0 + 25_001), 10);
    assert.equal(E.sendFuel(g, eng, T0 + 25_002), 10);
    assert.equal(E.sendFuel(g, eng, T0 + 25_003), 5);
    assert.equal(E.picksFor(g, id, 1).fuel, 25);
    assert.equal(E.fuelStockOf(g, id), 0);
    throwsGame(() => E.sendFuel(g, eng, T0 + 25_004), /No fuel in stock/);
  });

  test('unsent stock carries over to the next mission', () => {
    const g = started(4, { rounds: 2 });
    fund(g, 0, { engineer: 300 });
    E.buyFuel(g, holder(g, 0, 'engineer'), 1, T0 + 40_000);
    E.endRound(g); E.startRound(g, T0 + 100_000, seeded(3));
    assert.equal(E.fuelStockOf(g, tid(g, 0)), 40);
    assert.equal(E.picksFor(g, tid(g, 0), 2).fuel, 0);
  });

  test('only the engineer sends fuel, only during a mission', () => {
    const g = started(4);
    fund(g, 0, { engineer: 10 });
    E.buyFuel(g, holder(g, 0, 'engineer'), 1, T0 + 30_000);
    throwsGame(() => E.sendFuel(g, holder(g, 0, 'pilot'), T0 + 30_001), /Only the engineer/);
    throwsGame(() => E.sendFuel(g, holder(g, 0, 'engineer'), g.endsAt!), /Time's up/);
  });
});

describe('mission rules', () => {
  test('only the right role can act', () => {
    const g = started(4);
    fund(g, 0, { vet: 300, pilot: 300, engineer: 300 });
    const t = T0 + SETTLED;
    throwsGame(() => E.buyAnimal(g, holder(g, 0, 'pilot'), 'giraffe', Infinity, t), /Only the vet/);
    throwsGame(() => E.buyRocket(g, holder(g, 0, 'vet'), 'hopper', Infinity, t), /Only the pilot/);
    throwsGame(() => E.buyFuel(g, holder(g, 0, 'captain'), 1, t), /Only the engineer/);
    throwsGame(() => E.launch(g, holder(g, 0, 'vet'), t), /Only the captain/);
    throwsGame(() => E.buyAnimal(g, 'nobody', 'giraffe', Infinity, t), /not on a team/);
  });

  test('unknown items are rejected', () => {
    const g = started(4);
    fund(g, 0, { vet: 300, pilot: 300 });
    throwsGame(() => E.buyAnimal(g, holder(g, 0, 'vet'), 'unicorn', Infinity, T0), /Unknown animal/);
    throwsGame(() => E.buyRocket(g, holder(g, 0, 'pilot'), 'saturn5', Infinity, T0), /Unknown rocket/);
  });

  test("can't launch without all three", () => {
    const g = started(4);
    fund(g, 0, { vet: 300, pilot: 300 });
    mission(g, 0, { animal: 'giraffe', rocket: 'heavy', launch: false });
    throwsGame(() => E.launch(g, holder(g, 0, 'captain'), T0 + SETTLED), /need an animal, a rocket and fuel/);
  });

  test('everything locks after launch', () => {
    const g = started(4);
    fund(g, 0, { vet: 300, pilot: 300, engineer: 300 });
    const t = mission(g, 0, { animal: 'giraffe', rocket: 'heavy', fuel: 55 });
    throwsGame(() => E.buyAnimal(g, holder(g, 0, 'vet'), 'hippo', Infinity, t), /already launched/);
    throwsGame(() => E.launch(g, holder(g, 0, 'captain'), t), /already launched/);
  });

  test("nothing can be bought once time's up", () => {
    const g = started(4);
    fund(g, 0, { vet: 300 });
    throwsGame(() => E.buyAnimal(g, holder(g, 0, 'vet'), 'giraffe', Infinity, g.endsAt!), /Time's up/);
  });
});

describe('scoring', () => {
  const run = (plays: Parameters<typeof mission>[2][]) => {
    const g = setup(4, { rounds: plays.length, minutes: 10 });
    plays.forEach((p, i) => {
      E.startRound(g, T0, seeded(i));
      fund(g, 0, { vet: 40, pilot: 40, engineer: 40 });
      mission(g, 0, p);
      E.endRound(g);
    });
    return { g, o: E.outcomes(g) };
  };

  test('landed: the animal scores its points', () => {
    const x = run([{ animal: 'giraffe', rocket: 'heavy', fuel: 55 }]).o.rounds[0]![0]!;
    assert.equal(x.status, 'landed'); assert.equal(x.points, 40);
  });
  test('an animal bigger than the rocket fails', () => {
    const x = run([{ animal: 'elephant', rocket: 'compact', fuel: 20 }]).o.rounds[0]![0]!;
    assert.equal(x.status, 'failed'); assert.equal(x.message, "The elephant (XL) didn't fit in the Compact (S)"); assert.equal(x.points, 0);
  });
  test('a bigger rocket than needed is fine', () => {
    assert.equal(run([{ animal: 'cat', rocket: 'titan', fuel: 80 }]).o.rounds[0]![0]!.status, 'landed');
  });
  test('size rules', () => {
    assert.ok(fits('M', 'M')); assert.ok(fits('S', 'XL')); assert.ok(!fits('L', 'M')); assert.ok(!fits('XL', 'L'));
    assert.ok(ANIMALS.every(a => ROCKETS.some(r => fits(a.size, r.size))), 'every animal has a rocket');
  });
  test('short of fuel on board fails; stock left behind does not count', () => {
    const g = setup(4, { rounds: 1, minutes: 10 });
    E.startRound(g, T0, seeded()); fund(g, 0, { vet: 40, pilot: 40, engineer: 40 });
    mission(g, 0, { animal: 'giraffe', rocket: 'heavy', launch: false });
    E.buyFuel(g, holder(g, 0, 'engineer'), 1, T0 + SETTLED + 30_000); // plenty in stock…
    E.sendFuel(g, holder(g, 0, 'engineer'), T0 + SETTLED + 30_001);   // …but only 10 sent
    E.sendFuel(g, holder(g, 0, 'engineer'), T0 + SETTLED + 30_002);
    E.launch(g, holder(g, 0, 'captain'), T0 + SETTLED + 30_003); E.endRound(g);
    const x = E.outcomes(g).rounds[0]![0]!;
    assert.equal(x.status, 'failed'); assert.equal(x.message, 'Ran out of fuel (20 of 55 needed)');
  });
  test('never launched = scrubbed, money still spent', () => {
    const { g, o } = run([{ animal: 'giraffe', launch: false }]);
    assert.equal(o.rounds[0]![0]!.status, 'scrubbed');
    assert.ok(E.balance(g, tid(g, 0), 'vet') < 40);
  });
  test('the same species scores every time it lands', () => {
    const { o } = run([{ animal: 'cat', rocket: 'compact', fuel: 20 }, { animal: 'cat', rocket: 'compact', fuel: 20 }]);
    assert.equal(o.rounds[1]![0]!.points, 10);
  });
  test('standings sorted; group terraforming adds every team up', () => {
    const g = setup(8, { rounds: 1, minutes: 10 });
    E.startRound(g, T0, seeded());
    for (const t of [0, 1]) fund(g, t, { vet: 40, pilot: 40, engineer: 40 });
    mission(g, 0, { animal: 'penguin', rocket: 'compact', fuel: 20 }, T0 + SETTLED);
    mission(g, 1, { animal: 'elephant', rocket: 'titan', fuel: 80 }, T0 + SETTLED + 60_000);
    E.endRound(g);
    const o = E.outcomes(g);
    assert.equal(o.standings[0]!.team, tid(g, 1)); assert.equal(o.standings[0]!.points, 60);
    assert.equal(o.groupPoints, 75);
    assert.deepEqual([...o.species].sort(), ['elephant', 'penguin']);
  });
  test('the running mission is never scored', () => {
    const g = started(4);
    fund(g, 0, { vet: 40, pilot: 40, engineer: 40 });
    mission(g, 0, { animal: 'cat', rocket: 'compact', fuel: 20 });
    assert.equal(E.outcomes(g).rounds.length, 0);
  });
  test('mission stats for the shared screen: money distributed and spent, launches', () => {
    const g = started(8);
    fund(g, 0, { vet: 5, pilot: 5, engineer: 5 }); fund(g, 1, { vet: 3 });
    mission(g, 0, { animal: 'cat', rocket: 'compact', fuel: 20 });
    const st = E.missionStats(g);
    assert.equal(st.distributed, 18);
    assert.equal(st.spent, 5 + 5 + 5 - E.balance(g, tid(g, 0), 'vet') - E.balance(g, tid(g, 0), 'pilot') - E.balance(g, tid(g, 0), 'engineer'));
    assert.deepEqual([st.launched, st.teams], [1, 2]);
  });
});

describe('public feed', () => {
  test('every purchase and launch is announced, newest kept', () => {
    const g = started(4);
    fund(g, 0, { vet: 30, pilot: 30, engineer: 30 });
    mission(g, 0, { animal: 'giraffe', rocket: 'heavy', fuel: 55 });
    const kinds = g.feed.map(f => f.kind);
    assert.deepEqual([kinds[0], kinds[1], kinds.at(-1)], ['animal', 'rocket', 'launch']);
    assert.ok(kinds.includes('fuel'));
    assert.ok(g.feed.every(f => f.teamName === g.teams[0]!.name));
  });
  test('feed is capped', () => {
    const g = started(4);
    fund(g, 0, { vet: 3000 });
    for (let i = 0; i < E.LIMITS.feedKept + 20; i++) E.buyAnimal(g, holder(g, 0, 'vet'), 'cat', Infinity, T0 + 1000 * (i + 1));
    assert.ok(g.feed.length <= E.LIMITS.feedKept);
  });
});

describe('economy sanity (tuning guardrails)', () => {
  const floor = (b: number) => auctionPrice(b, 0, AUCTION.decayMs), high = (b: number) => auctionPrice(b, 0, 0);
  test('one mission of income buys a small mission at floor prices', () => {
    const cheap = Math.min(...ANIMALS.map(a => floor(a.base))) + Math.min(...ROCKETS.map(r => floor(r.base))) + FUEL.grabCost * 2;
    assert.ok(cheap <= E.DEFAULT_SETTINGS.income, `${cheap}`);
  });
  test('an elephant needs saving up (more than one mission of income at full price)', () => {
    const e = high(animalById('elephant')!.base) + high(rocketById('titan')!.base);
    assert.ok(e > E.DEFAULT_SETTINGS.income, `${e}`);
  });
  test('each size class has a frugal rocket and a cheap thirsty one', () => {
    for (const size of ['S', 'M', 'L', 'XL'] as const) {
      const [a, b] = ROCKETS.filter(r => r.size === size);
      assert.ok(a && b, size);
      assert.ok((a!.base > b!.base) === (a!.fuel < b!.fuel), `${size}: pricier should need less fuel`);
    }
  });
  test('bigger animals score more', () => {
    const avg = (s: string) => { const xs = ANIMALS.filter(a => a.size === s).map(a => a.points); return xs.reduce((x, y) => x + y, 0) / xs.length; };
    assert.ok(avg('S') < avg('M') && avg('M') < avg('L') && avg('L') < avg('XL'));
  });
  test('the thirstiest rocket can be fuelled in one mission even in a crowded game', () => {
    const teams = 50, seconds = E.DEFAULT_SETTINGS.minutes * 60;
    const perTeam = (fuelRate(teams) * seconds) / teams;
    assert.ok(perTeam >= Math.max(...ROCKETS.map(r => r.fuel)), `each team averages ${perTeam} units`);
  });
});

describe('additional auction copies at a server-selected team count', () => {
  for (const [threshold, twoCopies] of [[undefined, false], [3, false], [2, true]] as const) {
    test('two teams, threshold ' + threshold, () => {
      const g = setup(8);
      E.startRound(g, T0, seeded(), threshold);
      const at = T0 + SETTLED;
      for (let i = 0; i < 2; i++) fund(g, i, { vet: 10, pilot: 10 });
      const animalPrice = E.animalPriceNow(g, 'cat', at);
      const rocketPrice = E.rocketPriceNow(g, 'compact', at);
      for (const team of [0, 1]) {
        if (team === 1 && !twoCopies) {
          throwsGame(() => E.buyAnimal(g, holder(g, team, 'vet'), 'cat', animalPrice, at), /Price jumped/);
          throwsGame(() => E.buyRocket(g, holder(g, team, 'pilot'), 'compact', rocketPrice, at), /Price jumped/);
          break;
        }
        E.buyAnimal(g, holder(g, team, 'vet'), 'cat', animalPrice, at);
        E.buyRocket(g, holder(g, team, 'pilot'), 'compact', rocketPrice, at);
      }
      assert.ok(E.animalPriceNow(g, 'cat', at) > animalPrice);
      assert.ok(E.rocketPriceNow(g, 'compact', at) > rocketPrice);
    });
  }
});

test('staggered sales advertise the oldest copy across a snapshot and reset next mission', () => {
  const g = setup(8);
  E.startRound(g, T0, seeded(), 2);
  fund(g, 0, { vet: 10, pilot: 10 });
  const first = T0 + SETTLED, second = first + 30_000;
  const pilot = holder(g, 0, 'pilot');
  const floor = E.rocketPriceNow(g, 'compact', first);
  E.buyRocket(g, pilot, 'compact', floor, first);
  const recovered: E.Game = JSON.parse(JSON.stringify(g));
  assert.equal(E.rocketPriceNow(recovered, 'compact', second), floor);
  E.buyRocket(recovered, pilot, 'compact', floor, second);
  assert.equal(recovered.market.rockets.compact, first);
  assert.equal(recovered.market.secondCopy!.rockets.compact, second);
  assert.equal(recovered.market.animals.cat, T0);
  assert.equal(recovered.market.fuelResetAt, T0);
  throwsGame(() => E.buyRocket(recovered, pilot, 'compact', floor, second), /Price jumped/);
  E.endRound(recovered);
  E.startRound(recovered, second, seeded());
  assert.equal(recovered.market.secondCopy, undefined);
  assert.equal(recovered.market.rockets.compact, second);
});
