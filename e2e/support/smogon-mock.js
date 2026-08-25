// @ts-check
// Mocks the real Smogon/Pokémon Showdown network calls (lib/smogon-client.js)
// so specs never depend on play.pokemonshowdown.com/pkmn.github.io being
// reachable — deterministic and fast. Modeled on e2e/support/pokeapi-mock.js.
//
// formats-data.js's own shape (unquoted keys) is deliberately preserved
// here, not simplified to JSON, so this exercises parseFormatsData's real
// parsing path rather than assuming it works.

const FORMATS_DATA_TEXT =
  'exports.BattleFormatsData = {' +
  'chansey:{tier:"PU"},' +
  'bulbasaur:{tier:"LC"}' +
  '};';

const SETS_GEN9 = {
  Chansey: {
    ou: {
      Defensive: {
        moves: ['Seismic Toss', 'Soft-Boiled', ['Heal Bell', 'Thunder Wave'], 'Stealth Rock'],
        item: 'Eviolite',
        nature: 'Bold',
        evs: { hp: 248, def: 252, spd: 8 },
      },
    },
    nu: {
      Defensive: {
        moves: ['Seismic Toss', 'Soft-Boiled', 'Heal Bell', 'Stealth Rock'],
        item: 'Eviolite',
        nature: 'Bold',
        // Real Smogon data sometimes offers alternative EV spreads for one
        // set — an array, not a single object — which is exactly the
        // shape that broke _competitiveSetHtml before it handled it.
        evs: [
          { hp: 8, def: 252, spd: 248 },
          { hp: 248, def: 252, spd: 8 },
        ],
      },
    },
  },
  // Bulbasaur intentionally has no gen9 set — exercises the "no published
  // competitive data" empty state.
};

/** @param {import('@playwright/test').Page} page */
export async function mockSmogon(page) {
  await page.route('**/play.pokemonshowdown.com/data/formats-data.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: FORMATS_DATA_TEXT })
  );
  await page.route('**/pkmn.github.io/smogon/data/sets/gen9.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(SETS_GEN9) })
  );
}
