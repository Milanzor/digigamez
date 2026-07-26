// Central metadata registry for all games. The portal renders its grid from
// this list, and the router uses `load` to dynamically import only the
// chosen game's module (lazy loading keeps the initial bundle small).

export const GAMES = [
  {
    slug: 'vormen-sorteren',
    title: 'Vormen Sorteren',
    icon: '🔺',
    ageLabel: '2-4 jaar',
    supportsTwoPlayers: false,
    color: '#FFD166',
    load: () => import('./vormen-sorteren/index.js'),
  },
  {
    slug: 'geheugenspel',
    title: 'Geheugenspel',
    icon: '🃏',
    ageLabel: '3-6 jaar',
    supportsTwoPlayers: true,
    color: '#EF476F',
    load: () => import('./geheugenspel/index.js'),
  },
  {
    slug: 'legpuzzel',
    title: 'Legpuzzel',
    icon: '🧩',
    ageLabel: '3-7 jaar',
    supportsTwoPlayers: true,
    color: '#06D6A0',
    load: () => import('./legpuzzel/index.js'),
  },
  {
    slug: 'tekenen',
    title: 'Tekenen',
    icon: '🖍️',
    ageLabel: '2-7 jaar',
    supportsTwoPlayers: true,
    color: '#118AB2',
    load: () => import('./tekenen/index.js'),
  },
  {
    slug: 'leidingen',
    title: 'Leidingen Verbinden',
    icon: '🚰',
    ageLabel: '4-7 jaar',
    supportsTwoPlayers: false,
    color: '#8338EC',
    load: () => import('./leidingen/index.js'),
  },
  {
    slug: 'water-puzzel',
    title: 'Water Puzzel',
    icon: '💧',
    ageLabel: '5-7 jaar',
    supportsTwoPlayers: false,
    color: '#3A86FF',
    load: () => import('./water-puzzel/index.js'),
  },
  {
    slug: 'ruimte-invasie',
    title: 'Ruimte Invasie',
    icon: '🚀',
    ageLabel: '5-7 jaar',
    supportsTwoPlayers: true,
    color: '#FF6B35',
    load: () => import('./ruimte-invasie/index.js'),
  },
  {
    slug: 'blokken-brekker',
    title: 'Blokken Brekker',
    icon: '🧱',
    ageLabel: '6-7 jaar',
    supportsTwoPlayers: true,
    color: '#FFB703',
    load: () => import('./blokken-brekker/index.js'),
  },
];

export function getGame(slug) {
  return GAMES.find((g) => g.slug === slug);
}
