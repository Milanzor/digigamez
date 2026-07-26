// Central metadata registry. The portal renders its mission grid from this
// list and the router uses `load` to dynamically import only the chosen
// game, so the initial payload stays tiny regardless of how many games exist.

export const GAMES = [
  {
    slug: 'vormen-sorteren',
    title: 'Sterrenvormen',
    icon: '🛰️',
    ageLabel: '2-4 jr',
    supportsTwoPlayers: false,
    color: '#ffb224',
    load: () => import('./vormen-sorteren/index.js'),
  },
  {
    slug: 'geheugenspel',
    title: 'Ruimtegeheugen',
    icon: '🪐',
    ageLabel: '3-6 jr',
    supportsTwoPlayers: true,
    color: '#ff5f4d',
    load: () => import('./geheugenspel/index.js'),
  },
  {
    slug: 'legpuzzel',
    title: 'Sterrenpuzzel',
    icon: '🧩',
    ageLabel: '3-7 jr',
    supportsTwoPlayers: true,
    color: '#2fd9c6',
    load: () => import('./legpuzzel/index.js'),
  },
  {
    slug: 'tekenen',
    title: 'Ruimtetekenen',
    icon: '🎨',
    ageLabel: '2-7 jr',
    supportsTwoPlayers: true,
    color: '#b06bff',
    load: () => import('./tekenen/index.js'),
  },
  {
    slug: 'leidingen',
    title: 'Zuurstofleidingen',
    icon: '🔧',
    ageLabel: '4-7 jr',
    supportsTwoPlayers: false,
    color: '#7cc4ff',
    load: () => import('./leidingen/index.js'),
  },
  {
    slug: 'water-puzzel',
    title: 'Brandstof Sorteren',
    icon: '⛽',
    ageLabel: '5-7 jr',
    supportsTwoPlayers: false,
    color: '#6ee87a',
    load: () => import('./water-puzzel/index.js'),
  },
  {
    slug: 'ruimte-invasie',
    title: 'Ruimte Invasie',
    icon: '🚀',
    ageLabel: '5-7 jr',
    supportsTwoPlayers: true,
    color: '#ff8a3d',
    load: () => import('./ruimte-invasie/index.js'),
  },
  {
    slug: 'blokken-brekker',
    title: 'Asteroïdenveld',
    icon: '☄️',
    ageLabel: '6-7 jr',
    supportsTwoPlayers: true,
    color: '#ffd166',
    load: () => import('./blokken-brekker/index.js'),
  },
];

export function getGame(slug) {
  return GAMES.find((g) => g.slug === slug);
}
