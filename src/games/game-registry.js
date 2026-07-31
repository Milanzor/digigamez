// Central metadata registry. The portal renders its mission grid from this
// list and the router uses `load` to dynamically import only the chosen
// game, so the initial payload stays tiny regardless of how many games exist.
//
// Order is by age, youngest first, because that is the order a classroom
// scans the archive in. The eight play colours repeat now that there are
// fourteen missions; what matters is that two rows with the same colour never
// end up next to each other in the grid, so the list is ordered with that in
// mind as well.

export const GAMES = [
  {
    slug: 'vormen-sorteren',
    title: 'Sterrenvormen',
    icon: '🛰️',
    ageLabel: '2–4 jr',
    supportsTwoPlayers: false,
    color: '#ffc24a',
    load: () => import('./vormen-sorteren/index.js'),
  },
  {
    slug: 'zeepbellen',
    title: 'Zeepbellen',
    icon: '🫧',
    ageLabel: '2–4 jr',
    supportsTwoPlayers: true,
    color: '#5fe3c4',
    load: () => import('./zeepbellen/index.js'),
  },
  {
    slug: 'tekenen',
    title: 'Ruimtetekenen',
    icon: '🎨',
    ageLabel: '2–7 jr',
    supportsTwoPlayers: true,
    color: '#b98cff',
    load: () => import('./tekenen/index.js'),
  },
  {
    slug: 'sterrenorkest',
    title: 'Sterrenorkest',
    icon: '🎹',
    ageLabel: '2–7 jr',
    supportsTwoPlayers: true,
    color: '#ff8fc7',
    load: () => import('./sterrenorkest/index.js'),
  },
  {
    slug: 'geheugenspel',
    title: 'Ruimtegeheugen',
    icon: '🪐',
    ageLabel: '3–6 jr',
    supportsTwoPlayers: true,
    color: '#ff6b6b',
    load: () => import('./geheugenspel/index.js'),
  },
  {
    slug: 'sterrenecho',
    title: 'Sterrenecho',
    icon: '🔔',
    ageLabel: '3–7 jr',
    supportsTwoPlayers: true,
    color: '#8fd6ff',
    load: () => import('./sterrenecho/index.js'),
  },
  {
    slug: 'maanhockey',
    title: 'Maanhockey',
    icon: '🏒',
    ageLabel: '3–7 jr',
    supportsTwoPlayers: true,
    color: '#7ee787',
    load: () => import('./maanhockey/index.js'),
  },
  {
    slug: 'legpuzzel',
    title: 'Sterrenpuzzel',
    icon: '🧩',
    ageLabel: '3–7 jr',
    supportsTwoPlayers: true,
    color: '#5fe3c4',
    load: () => import('./legpuzzel/index.js'),
  },
  {
    slug: 'gekke-machine',
    title: 'Gekke Machine',
    icon: '⚙️',
    ageLabel: '4–7 jr',
    supportsTwoPlayers: false,
    color: '#ff8fc7',
    load: () => import('./gekke-machine/index.js'),
  },
  {
    slug: 'leidingen',
    title: 'Zuurstofleidingen',
    icon: '🔧',
    ageLabel: '4–7 jr',
    supportsTwoPlayers: false,
    color: '#8fd6ff',
    load: () => import('./leidingen/index.js'),
  },
  {
    slug: 'water-puzzel',
    title: 'Brandstof Sorteren',
    icon: '⛽',
    ageLabel: '5–7 jr',
    supportsTwoPlayers: false,
    color: '#7ee787',
    load: () => import('./water-puzzel/index.js'),
  },
  {
    slug: 'rover',
    title: 'Rover Programmeren',
    icon: '🤖',
    ageLabel: '5–7 jr',
    supportsTwoPlayers: true,
    color: '#b98cff',
    load: () => import('./rover/index.js'),
  },
  {
    slug: 'ruimte-invasie',
    title: 'Ruimte Invasie',
    icon: '🚀',
    ageLabel: '5–7 jr',
    supportsTwoPlayers: true,
    color: '#ffa14a',
    load: () => import('./ruimte-invasie/index.js'),
  },
  {
    slug: 'blokken-brekker',
    title: 'Asteroïdenveld',
    icon: '☄️',
    ageLabel: '6–7 jr',
    supportsTwoPlayers: true,
    color: '#d08c4a',
    load: () => import('./blokken-brekker/index.js'),
  },
];

export function getGame(slug) {
  return GAMES.find((g) => g.slug === slug);
}
