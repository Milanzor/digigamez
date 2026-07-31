// Central metadata registry. The portal renders its mission grid from this
// list and the router uses `load` to dynamically import only the chosen
// game, so the initial payload stays tiny regardless of how many games exist.

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
    slug: 'geheugenspel',
    title: 'Ruimtegeheugen',
    icon: '🪐',
    ageLabel: '3–6 jr',
    supportsTwoPlayers: true,
    color: '#ff6b6b',
    load: () => import('./geheugenspel/index.js'),
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
    slug: 'tekenen',
    title: 'Ruimtetekenen',
    icon: '🎨',
    ageLabel: '2–7 jr',
    supportsTwoPlayers: true,
    color: '#b98cff',
    load: () => import('./tekenen/index.js'),
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
