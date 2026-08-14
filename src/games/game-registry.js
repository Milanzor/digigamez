// Central metadata registry. The portal renders its mission grid from this
// list and the router uses `load` to dynamically import only the chosen
// game, so the initial payload stays tiny regardless of how many games exist.
//
// Order is by age, youngest first, because that is the order a classroom
// scans the archive in. The eight play colours repeat now that there are
// thirty missions; what matters is that two rows with the same colour
// never end up next to each other in the grid, so the list is ordered with
// that in mind as well.
//
// At thirty missions the grid is five columns wide (see portal.css), and that
// changed every adjacency in it — a neighbour used to be three rows away and is
// now one. The placement was solved rather than eyeballed, under three rules: no
// two orthogonal neighbours share a colour, amber stays the action colour by
// appearing exactly once here, and as few existing missions as possible move.
// The minimum turned out to be two — Ruimtegeheugen and Maanhockey — and no
// arrangement of the six new missions inside their own age bands avoids it.
//
// `maxPlayers` is a number rather than the old `supportsTwoPlayers` boolean.
// Raketrace is the reason: it wants three or four children at a 75" board, and
// a boolean cannot say that. The crew screen still asks only 1 or 2 — that
// question is about turn-taking, and a game that seats more asks for itself
// (Raketrace picks its lane count on its own start screen, the way Ruimte
// Invasie picks difficulty). The loader clamps the chosen crew to this number,
// so a board left on "2 astronauten" plays a solo game as a solo game.

export const GAMES = [
  {
    slug: 'vormen-sorteren',
    title: 'Sterrenvormen',
    icon: '🛰️',
    ageLabel: '2–4 jr',
    maxPlayers: 1,
    color: '#ffc24a',
    load: () => import('./vormen-sorteren/index.js'),
  },
  {
    slug: 'zeepbellen',
    title: 'Zeepbellen',
    icon: '🫧',
    ageLabel: '2–4 jr',
    maxPlayers: 2,
    color: '#5fe3c4',
    load: () => import('./zeepbellen/index.js'),
  },
  {
    slug: 'verstoppertje',
    title: 'Alien Verstoppertje',
    icon: '🙈',
    ageLabel: '2–5 jr',
    maxPlayers: 2,
    color: '#ff6b6b',
    load: () => import('./verstoppertje/index.js'),
  },
  {
    slug: 'magneetstrijd',
    title: 'Magneetstrijd',
    icon: '🧲',
    ageLabel: '2–6 jr',
    maxPlayers: 2,
    color: '#8fd6ff',
    load: () => import('./magneetstrijd/index.js'),
  },
  {
    slug: 'tekenen',
    title: 'Ruimtetekenen',
    icon: '🎨',
    ageLabel: '2–7 jr',
    maxPlayers: 2,
    color: '#b98cff',
    load: () => import('./tekenen/index.js'),
  },
  {
    slug: 'sterrenorkest',
    title: 'Sterrenorkest',
    icon: '🎹',
    ageLabel: '2–7 jr',
    maxPlayers: 2,
    color: '#ff8fc7',
    load: () => import('./sterrenorkest/index.js'),
  },
  {
    slug: 'maatje',
    title: 'Maak je Maatje',
    icon: '👽',
    ageLabel: '2–7 jr',
    maxPlayers: 2,
    color: '#7ee787',
    load: () => import('./maatje/index.js'),
  },
  {
    slug: 'geheugenspel',
    title: 'Ruimtegeheugen',
    icon: '🪐',
    ageLabel: '3–6 jr',
    maxPlayers: 2,
    color: '#d08c4a',
    load: () => import('./geheugenspel/index.js'),
  },
  {
    slug: 'ladingcontrole',
    title: 'Ladingcontrole',
    icon: '📦',
    ageLabel: '3–6 jr',
    maxPlayers: 2,
    color: '#ffa14a',
    load: () => import('./ladingcontrole/index.js'),
  },
  {
    slug: 'sterrenpaden',
    title: 'Sterrenpaden',
    icon: '✨',
    ageLabel: '3–6 jr',
    maxPlayers: 1,
    color: '#d08c4a',
    load: () => import('./sterrenpaden/index.js'),
  },
  {
    slug: 'sterrenecho',
    title: 'Sterrenecho',
    icon: '🔔',
    ageLabel: '3–7 jr',
    maxPlayers: 2,
    color: '#8fd6ff',
    load: () => import('./sterrenecho/index.js'),
  },
  {
    slug: 'maanhockey',
    title: 'Maanhockey',
    icon: '🏒',
    ageLabel: '3–7 jr',
    maxPlayers: 2,
    color: '#5fe3c4',
    load: () => import('./maanhockey/index.js'),
  },
  {
    slug: 'meteoor-meppen',
    title: 'Meteoor Meppen',
    icon: '🔨',
    ageLabel: '3–7 jr',
    maxPlayers: 2,
    color: '#ff6b6b',
    load: () => import('./meteoor-meppen/index.js'),
  },
  {
    slug: 'legpuzzel',
    title: 'Sterrenpuzzel',
    icon: '🧩',
    ageLabel: '3–7 jr',
    maxPlayers: 2,
    color: '#5fe3c4',
    load: () => import('./legpuzzel/index.js'),
  },
  {
    slug: 'toren-bouwen',
    title: 'Toren Bouwen',
    icon: '🧱',
    ageLabel: '3–7 jr',
    maxPlayers: 2,
    color: '#b98cff',
    load: () => import('./toren-bouwen/index.js'),
  },
  {
    slug: 'lopende-band',
    title: 'Lopende Band',
    icon: '🗂️',
    ageLabel: '3–7 jr',
    maxPlayers: 2,
    color: '#ff8fc7',
    load: () => import('./lopende-band/index.js'),
  },
  {
    slug: 'doolhof',
    title: 'Sterrendoolhof',
    icon: '🌀',
    ageLabel: '3–7 jr',
    maxPlayers: 1,
    color: '#7ee787',
    load: () => import('./doolhof/index.js'),
  },
  {
    slug: 'kleurenlab',
    title: 'Kleurenlab',
    icon: '🧪',
    ageLabel: '3–7 jr',
    maxPlayers: 2,
    color: '#ffa14a',
    load: () => import('./kleurenlab/index.js'),
  },
  {
    slug: 'gekke-machine',
    title: 'Gekke Machine',
    icon: '⚙️',
    ageLabel: '4–7 jr',
    maxPlayers: 1,
    color: '#ff8fc7',
    load: () => import('./gekke-machine/index.js'),
  },
  {
    slug: 'leidingen',
    title: 'Zuurstofleidingen',
    icon: '🔧',
    ageLabel: '4–7 jr',
    maxPlayers: 1,
    color: '#8fd6ff',
    load: () => import('./leidingen/index.js'),
  },
  {
    slug: 'sterrenschrift',
    title: 'Sterrenschrift',
    icon: '✍️',
    ageLabel: '4–7 jr',
    maxPlayers: 2,
    color: '#ff6b6b',
    load: () => import('./sterrenschrift/index.js'),
  },
  {
    slug: 'sluisdeuren',
    title: 'Sluisdeuren',
    icon: '🤝',
    ageLabel: '4–7 jr',
    maxPlayers: 2,
    color: '#b98cff',
    load: () => import('./sluisdeuren/index.js'),
  },
  {
    slug: 'raketrace',
    title: 'Raketrace',
    icon: '🏁',
    ageLabel: '4–7 jr',
    maxPlayers: 4,
    color: '#ff6b6b',
    load: () => import('./raketrace/index.js'),
  },
  {
    slug: 'water-puzzel',
    title: 'Brandstof Sorteren',
    icon: '⛽',
    ageLabel: '5–7 jr',
    maxPlayers: 1,
    color: '#7ee787',
    load: () => import('./water-puzzel/index.js'),
  },
  {
    slug: 'rover',
    title: 'Rover Programmeren',
    icon: '🤖',
    ageLabel: '5–7 jr',
    maxPlayers: 2,
    color: '#b98cff',
    load: () => import('./rover/index.js'),
  },
  {
    slug: 'letterplaneten',
    title: 'Letterplaneten',
    icon: '🔤',
    ageLabel: '5–7 jr',
    maxPlayers: 1,
    color: '#ffa14a',
    load: () => import('./letterplaneten/index.js'),
  },
  {
    slug: 'vier-op-rij',
    title: 'Sterrenrij',
    icon: '🔴',
    ageLabel: '5–7 jr',
    maxPlayers: 2,
    color: '#5fe3c4',
    load: () => import('./vier-op-rij/index.js'),
  },
  {
    slug: 'ruimte-invasie',
    title: 'Ruimte Invasie',
    icon: '🚀',
    ageLabel: '5–7 jr',
    maxPlayers: 2,
    color: '#ffa14a',
    load: () => import('./ruimte-invasie/index.js'),
  },
  {
    slug: 'blokken-brekker',
    title: 'Asteroïdenveld',
    icon: '☄️',
    ageLabel: '6–7 jr',
    maxPlayers: 2,
    color: '#d08c4a',
    load: () => import('./blokken-brekker/index.js'),
  },
  {
    slug: 'spiegelstralen',
    title: 'Spiegelstralen',
    icon: '🪞',
    ageLabel: '6–7 jr',
    maxPlayers: 1,
    color: '#8fd6ff',
    load: () => import('./spiegelstralen/index.js'),
  },
];

export function getGame(slug) {
  return GAMES.find((g) => g.slug === slug);
}
