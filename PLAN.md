# Digigamez — Kinderspelletjes voor Digiborden

Een browsergebaseerde spellenbundel voor een 75" touchscreen digibord, gericht op
kinderen van 2 t/m 7 jaar. Start bij een portal waar 1 of 2 spelers gekozen
worden, gevolgd door een raster met minigames. Volledig in het Nederlands,
geoptimaliseerd voor grote touchscreens en soepele 60fps-animaties.

## 1. Doelen & randvoorwaarden

- **Doelgroep**: kinderen 2–7 jaar, dus grote knoppen, weinig tekst, veel
  iconen/kleur/geluid, vergevingsgezinde besturing (geen "game over" drama,
  geen agressieve content).
- **Apparaat**: 75" touchscreen digibord (kiosk-modus), landscape, waarschijnlijk
  Chrome/Edge in fullscreen. Aanraakbediening is leidend, muis/toetsenbord als
  fallback voor ontwikkeling/testen.
- **Taal**: alle UI-teksten in het Nederlands.
- **1 of 2 spelers**: sommige games ondersteunen gelijktijdig samen-/tegen-spelen
  op hetzelfde scherm (split-zone touch), andere zijn om-de-beurt.
- **Performance**: moet "highly optimised" zijn en soepel draaien — 60fps
  richtlijn, geen frameworks met veel overhead, canvas-rendering voor
  actie-games, lazy-loading per spel, geen onnodige DOM-reflows.
- **Deployment**: gratis hosting via GitHub Pages, automatisch gebouwd en
  gepubliceerd met GitHub Actions bij elke push naar `main`.
- **Geen backend**: alles client-side, geen accounts, geen data-opslag buiten
  `localStorage` (bv. onthouden van laatste spelerskeuze of losse voortgang).

## 2. Tech-stack keuzes

| Onderdeel      | Keuze                                   | Waarom |
|----------------|------------------------------------------|--------|
| Taal           | Vanilla JavaScript (ES modules), geen TS build-complexiteit nodig voor dit schaal | Kleinste footprint, geen framework-overhead, maximale controle over de render-loop |
| Bundler        | [Vite](https://vitejs.dev/)              | Snelle dev-server, geoptimaliseerde productie-build (code-splitting, minificatie, asset-hashing), triviale GitHub Pages-config |
| Rendering      | HTML5 `<canvas>` 2D per spel             | Voorspelbare, snelle rendering voor bewegende objecten; voorkomt DOM-thrashing bij veel elementen (ruimteschepen, puzzelstukjes, etc.) |
| UI-chrome      | HTML/CSS (portal, menu's, knoppen)       | Toegankelijker or styling van grote touch-knoppen, canvas alleen voor de spellen zelf |
| State/routing  | Eigen minimale hash-router (`#/portal`, `#/spel/breakout`) | Geen noodzaak voor React/Vue; scheelt kB's en hydration-overhead |
| Audio          | Web Audio API + korte gecomprimeerde `.ogg`/`.mp3` sample sprites | Lage latency geluidseffecten, één audio-sprite per categorie i.p.v. veel bestanden |
| Assets         | SVG voor UI-iconen (schaalt naar 75" zonder wazig te worden), PNG/WebP sprite-atlassen voor spel-graphics | SVG blijft scherp op groot scherm; atlassen verminderen HTTP-requests en draw calls |
| State-opslag   | `localStorage` (laatste spelerskeuze, highscores optioneel) | Geen backend nodig, werkt offline na eerste load |
| Hosting        | GitHub Pages (`gh-pages` branch of `docs/`-output via Actions) | Gratis, past bij "later deployen via GitHub Actions" |
| CI/CD          | GitHub Actions workflow: install → build → deploy naar Pages | Automatisch bij push naar `main` |

### Waarom geen groot framework (React/Vue/etc.)?
Voor een kiosk-app die vooral canvas-animaties toont, voegt een reactief
framework vooral overhead toe (virtual DOM diffing, hydration, grotere bundle)
zonder voordeel — de complexe interactie zit ín de canvas render-loop, niet in
de DOM-boom. Vanilla JS + Vite geeft de kleinste bundel en de meeste controle
over `requestAnimationFrame`-timing, wat cruciaal is voor "soepel draaien" op
een touchscreen.

## 3. Performance-aanpak ("highly optimised, soepel")

- **Eén globale render-loop** per actief spel via `requestAnimationFrame`,
  met delta-time zodat snelheid onafhankelijk is van de refresh rate.
- **Object pooling** voor kortlevende objecten (kogels, deeltjes, puzzelstukjes)
  om garbage collection tijdens het spelen te minimaliseren.
- **Sprite-atlassen** (1 PNG/WebP per spel-thema) i.p.v. losse imagebestanden
  → minder HTTP-requests, minder draw-call overhead.
- **Canvas-schaling**: canvas intern renderen op een vaste logische resolutie
  (bv. 1920×1080) en via CSS opschalen naar het fysieke 75"-paneel, met
  `devicePixelRatio`-correctie alleen waar nodig (crisp-canvas techniek) om
  overdraw op 4K-achtige paneelresoluties te vermijden.
- **Lazy loading per spel**: elk spel is een apart ES-module + eigen assets,
  dynamisch geïmporteerd (`import()`) zodra de speler het kiest — portal laadt
  alleen UI-assets, niet alle 8 spellen tegelijk.
- **Unified pointer events**: alle input via `pointerdown/move/up` (werkt voor
  touch én muis) i.p.v. aparte touch-/mouse-handlers, met input-throttling op
  `pointermove` waar niet nodig per frame.
- **Preload tijdens portal**: volgend waarschijnlijk spel (of in ieder geval
  gedeelde UI-assets/audio) preloaden zodra de speler het spelscherm nadert.
- **Geen layout-thrash**: animaties via canvas of `transform`/`opacity` (GPU-
  composited), nooit via `top/left`/`width` op DOM-elementen tijdens gameplay.
- **Wake Lock API**: voorkomt dat het scherm/dimmen aanslaat tijdens een sessie
  op het digibord (`navigator.wakeLock`).
- **Fullscreen API**: automatisch fullscreen bij opstarten in kiosk-modus.
- **Asset-budget**: doel <5MB per spel-module (gzipped), totale eerste-load
  (portal) <500kB.
- **Lighthouse-check** in CI (optioneel, later) om performance-regressies te
  signaleren.

## 4. Architectuur / mappenstructuur

```
digigamez/
├── PLAN.md
├── index.html                  # entry point, laadt shell.js
├── package.json
├── vite.config.js
├── public/
│   └── favicon.svg
├── src/
│   ├── shell/
│   │   ├── router.js           # simpele hash-router
│   │   ├── main.js              # bootstrap: fullscreen, wake lock, router init
│   │   ├── pointer.js           # unified pointer-event helper
│   │   ├── audio.js             # Web Audio sprite-manager
│   │   └── storage.js           # localStorage helpers (spelerskeuze, scores)
│   ├── portal/
│   │   ├── portal.js            # portalscherm: spelerkeuze + spelrooster
│   │   ├── portal.css
│   │   └── player-select.js
│   ├── games/
│   │   ├── game-registry.js     # metadata: naam, leeftijd, icoon, module-pad
│   │   ├── ruimte-invasie/       # Space Invaders-achtig
│   │   ├── leidingen/            # Pipe-connect puzzel
│   │   ├── water-puzzel/         # Water-sort puzzel
│   │   ├── tekenen/              # Vrij tekenen / kleurplaten
│   │   ├── legpuzzel/            # Jigsaw puzzel
│   │   ├── geheugenspel/         # Memory / matching
│   │   ├── vormen-sorteren/      # Shape sorting (peuters)
│   │   └── blokken-brekker/      # Breakout/Arkanoid
│   │       ├── index.js          # init(container, {players}) / destroy()
│   │       ├── style.css
│   │       └── assets/
│   └── shared/
│       ├── ui-components.js     # herbruikbare knoppen, terug-knop, HUD
│       └── canvas-utils.js      # scaling, object-pool, sprite-loader helpers
├── .github/
│   └── workflows/
│       └── deploy.yml           # build + deploy naar GitHub Pages
└── .gitignore
```

Elke spelmodule volgt hetzelfde contract:
```js
export function init(container, { players, onExit }) { /* start spel */ }
export function destroy() { /* cleanup: cancel rAF, remove listeners */ }
```
Zo kan de shell spellen los laden/verwijderen zonder geheugenlekken
(belangrijk voor een digibord dat dagenlang blijft draaien).

## 5. Portal-flow

1. **Opstartscherm**: logo/titel, grote "Start"-knop (auto-fullscreen bij
   eerste touch, want Fullscreen API vereist user-gesture).
2. **Spelerkeuze**: "Speel met 1 speler" / "Speel met 2 spelers" — twee grote
   kaarten met duidelijke iconen (1 poppetje vs. 2 poppetjes).
3. **Spellenrooster**: grid met kaarten per spel — groot icoon, Nederlandse
   titel, leeftijdsindicatie (bv. "2-4 jaar", "5-7 jaar"), en of het spel
   2-speler-ondersteuning heeft (badge). Filter/sortering op leeftijd is
   optioneel "nice-to-have" (niet MVP).
4. **In-game**: elk spel heeft een consistente terug-knop (linksboven, groot,
   duimvriendelijk) die teruggaat naar het rooster zonder de portal opnieuw
   te laden.
5. **Idle/screensaver** (nice-to-have, niet MVP): na X minuten inactiviteit
   terug naar opstartscherm met rustgevende animatie, zodat het digibord niet
   "vast" blijft staan in een spel.

## 6. Spellenlijst (MVP)

Gebaseerd op wat consistent hoog scoort in app-store-lijsten voor peuters/
kleuters (Sago Mini, Toca Boca, Lingokids, ElePant, jigsaw/matching-apps zoals
"Puzzle Kids" en "Kids Puzzle & Toddler Games") — de gemene deler is: grote
tastbare elementen, direct visueel/auditief succesgevoel, geen faalstatus die
als "verlies" aanvoelt, korte sessies. Zie bronnen onderaan dit document.

| Spel (NL)                | Genre                          | Leeftijd | 1P / 2P | Kern-mechaniek |
|---------------------------|--------------------------------|----------|---------|----------------|
| **Vormen Sorteren**       | Shape-sort                     | 2–4      | 1P      | Sleep vormen naar de juiste silhouet-opening; grote drag-targets, geen tijdsdruk, altijd positieve feedback. |
| **Geheugenspel**          | Matching / memory              | 3–6      | 1P & 2P | Omgedraaide kaarten, tik om 2 om te draaien, gelijke paren verdwijnen; 2P om de beurt met scorebord. |
| **Legpuzzel**             | Jigsaw                         | 3–7      | 1P & 2P | Sleep puzzelstukjes (4/9/16/25 stukjes naar leeftijd) in een frame; magnetisch "snappen" bij bijna-juiste positie. |
| **Tekenen**               | Creatief / vrij tekenen         | 2–7      | 1P & 2P | Vinger-tekenen met kleuren/dikte-keuze, stempels, wis-knop, "opslaan als sticker"-gevoel (lokaal, geen echte export nodig voor MVP). |
| **Leidingen Verbinden**   | Pipe-connect puzzel            | 4–7      | 1P      | Draai buis-tegels zodat water van bron naar afvoer kan stromen vóór de tijd om is (zachte, niet-straffende timer). |
| **Water Puzzel**          | Water-sort puzzel               | 5–7      | 1P      | Giet gekleurd water tussen buisjes tot elke buis één kleur bevat; klassiek "water sort"-mechaniek, populair op iOS/Android. |
| **Ruimte Invasie**        | Space-Invaders-achtig           | 5–7      | 1P & 2P | Simpel schieten op vriendelijke buitenaardse vormen die langzaam zakken; 2P = twee schepen naast elkaar op hetzelfde scherm, aparte score. |
| **Blokken Brekker**       | Breakout/Arkanoid               | 6–7      | 1P & 2P | Bal + paddle(s), blokken kapot maken; 2P = twee paddles (boven/onder of links/rechts gesplitst scherm) coöperatief de bal in het spel houden. |

**Uitbreidingen (post-MVP, alvast in registry-structuur voorzien)**:
kleurplaten-only modus, bubble-pop reflex-spel, eenvoudig ritme-/muziekspel,
tel-/rekenspelletje, "verstop-en-zoek" (Sago Mini-stijl).

### 2-speler aanpak per spel
- **Om-de-beurt** (Geheugenspel, Legpuzzel-race): duidelijke "Speler 1 / Speler
  2 is aan de beurt"-banner, groot en met kleurcodering.
- **Gelijktijdig split-zone** (Ruimte Invasie, Blokken Brekker): scherm fysiek
  verdeeld in een linker- en rechterhelft (of boven/onder), elke speler heeft
  een eigen touch-zone en eigen kleur, zodat twee kinderen tegelijk op hetzelfde
  75"-scherm kunnen spelen zonder elkaars input te kapen.
- **Coöperatief gedeeld** (Tekenen): beide spelers tekenen vrij op hetzelfde
  canvas, geen zone-scheiding nodig.

## 7. Toegankelijkheid & kindvriendelijkheid

- Minimale tekst, waar mogelijk vervangen door iconen/kleur; wat er staat is
  kort en in eenvoudig Nederlands.
- Grote hitboxen (min. 88×88px CSS-pixels, ruim boven de gangbare 44px-richtlijn,
  gezien de afstand tot een 75"-scherm en kinderhanden).
- Geen "game over"/verlies-schermen die als straf aanvoelen — bij falen gewoon
  "Probeer nog eens!" met vrolijke animatie.
- Geluid staat aan met duidelijke, vriendelijke feedback-sounds; mute-knop
  altijd zichtbaar in de shell-header.
- Kleurenpalet met voldoende contrast; geen fel knipperende content (i.v.m.
  fotosensitiviteit bij jonge kinderen).

## 8. Deployment via GitHub Actions → GitHub Pages

1. Repo `milanzor/digigamez` op GitHub (via `gh repo create`).
2. `vite.config.js` met `base: '/digigamez/'` (project-pages pad).
3. `.github/workflows/deploy.yml`:
   - Trigger: `push` naar `main`.
   - Stappen: checkout → `actions/setup-node` → `npm ci` → `npm run build` →
     `actions/upload-pages-artifact` (van `dist/`) → `actions/deploy-pages`.
   - Permissions: `pages: write`, `id-token: write`.
4. Repo-instelling **Settings → Pages → Source: GitHub Actions** (eenmalig
   handmatig te bevestigen door de eigenaar, of via `gh api` indien gewenst).
5. Resultaat: elke push naar `main` bouwt en publiceert automatisch naar
   `https://milanzor.github.io/digigamez/`.

## 9. Wat wordt nu wel/niet gebouwd

**Nu (dit werk)**:
- Volledige projectstructuur + build-tooling (Vite).
- Portal met 1P/2P-keuze en spellenrooster.
- Alle 8 MVP-spellen als speelbare, canvas-gebaseerde modules met basis-
  polish (geluid, animatie, 1P/2P waar van toepassing).
- Shell-optimalisaties: fullscreen, wake lock, unified pointer input, lazy
  loading, object pooling waar relevant.
- GitHub Actions-workflow voor automatische deploy.

**Later / bewust buiten scope**:
- Accounts, cloud-opslag van voortgang/scores.
- Uitgebreide screensaver/idle-detectie (kan later toegevoegd worden via de
  bestaande router).
- Extra spellen uit de "uitbreidingen"-lijst.
- Diepgaande a11y voor screenreaders (niet relevant voor dit kiosk-gebruik,
  wel behouden we contrast/hitbox-richtlijnen).
- Automatische Lighthouse/performance-gates in CI.

## Bronnen (referentie-onderzoek highly-rated kids touch games)

- [Best Toddler Apps for Learning (2026) — Educational App Store](https://www.educationalappstore.com/app-lists/best-toddler-apps)
- [Best Apps for Toddlers — Common Sense Media](https://www.commonsensemedia.org/lists/best-apps-for-toddlers)
- [15 Best Tablet Games for Kids — Kids Tablets](https://www.kidstablets.org/tablet-games-for-kids/)
- [Best iPad Games For Kids In 2026 — TutoClub](https://tutoclub.com/blog/best-ipad-games-for-kids)
- [5 Best Jigsaw Puzzle Apps for Kids — Educational App Store](https://www.educationalappstore.com/best-apps/5-best-jigsaw-puzzle-apps-for-kids)
- [23 Puzzle Apps For Toddlers — Romper](https://www.romper.com/life/20-puzzle-apps-for-toddlers-that-are-actually-fun-34004597)
- [Top Puzzle Apps — Common Sense Media](https://www.commonsensemedia.org/lists/top-puzzle-apps)
