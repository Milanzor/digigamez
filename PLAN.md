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

## 2b. Visuele richting: "retro-futuristisch missieconsole"

Het hele pakket zit in één ruimtethema. Het uitgangspunt is niet de
standaard "zwarte ruimte met één neonkleur", maar een **Apollo-achtig
instrumentenpaneel**: diep indigo (nooit puur zwart) achter warm
emaille-wit, met verzadigde accentkleuren uit mid-century ruimteposters.
Het digibord is de patrijspoort van een ruimteschip; de spellen zijn
"missies" op verlichte consoleknoppen.

- **Palet**: `--void-deep #060a24`, `--void #0e1741`, `--panel #1a2a63`,
  emaille `#f9f4e7` / `#e7dfcb`, accenten `--sun #ffb224`,
  `--mars #ff5f4d`, `--teal #2fd9c6`, `--nebula #b06bff`, `--leaf #6ee87a`.
- **Typografie**: `Baloo 2` (800) als display — rond, stevig, kindvriendelijk
  en met goede Nederlandse diakritieken. `Space Mono` (700) uitsluitend voor
  uitleesvelden (level, score, missietitels), zoals de tekst op een echt
  instrumentpaneel.
- **Signatuur**: de patrijspoort met emaille-rand op het startscherm, en
  de missieknoppen met een gekleurde lichtbalk plus **levellampjes**
  (`●●●○○`) die echte voortgang tonen — geen decoratie.
- **Sterrenveld**: drie getilede gradient-lagen die met CSS-transforms
  driften (parallax). Puur compositor-werk, dus het kost geen main-thread
  tijd terwijl een spel zijn eigen renderloop draait.

### Schaalregel voor grote touchscreens (belangrijkste les)
Een 75" digibord rapporteert vaak 3840×2160 op `devicePixelRatio` 1.
Alles wat in `px` is opgemaakt wordt daardoor ongeveer half zo groot als op
een 1080p-paneel. Daarom is **elke maat in `vmin` met `clamp()`-grenzen**
uitgedrukt, nooit in vaste pixels. Gemeten resultaat: het missierooster
beslaat 79% van het scherm op zowel 1920×1080 als 3840×2160, en alle
maten verdubbelen exact. Minimale aanraakdoelen zijn `11vmin`
(≈120px op 1080p, ≈240px op 4K) — ruim boven de gangbare 44px-richtlijn,
want een kind staat dicht op een wandscherm.

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

Alle acht spellen zitten in hetzelfde ruimtethema en hebben een
**levelprogressie** die lokaal wordt opgeslagen (zie §6b).

| Spel (NL)                 | Genre                | Leeftijd | 1P / 2P | Kern-mechaniek en diepte |
|---------------------------|----------------------|----------|---------|--------------------------|
| **Sterrenvormen**         | Shape-sort           | 2–4      | 1P      | Sleep vracht naar de bijpassende luchtsluis. Diepte via drie knoppen: aantal stukken 3→6, vanaf level 3 driften de sluizen zijwaarts, vanaf level 5 moet ook de **kleur** kloppen. |
| **Ruimtegeheugen**        | Memory / matching    | 3–6      | 1P & 2P | Kaarten met planeten en aliens. Bord groeit 4→12 paren; vanaf level 2 is er één gouden **komeetpaar** dat dubbel telt. 2P om de beurt met scores. |
| **Sterrenpuzzel**         | Jigsaw               | 3–7      | 1P & 2P | Ruimtescènes (inline SVG, dus scherp op 4K) in stukjes. 4→20 stukjes; **👁️-knop** ghost het voorbeeld over het bord als hint in plaats van een moeilijkheidsmuur. |
| **Ruimtetekenen**         | Creatief             | 2–7      | 1P & 2P | Vrij tekenen op een sterrenveld. Diepte in het gereedschap: **gloeistift**, **spiegelmodus** (scribbels worden symmetrische wezens), stempels, gum, undo. Multi-touch: twee kinderen tekenen gelijktijdig. |
| **Zuurstofleidingen**     | Pipe-connect         | 4–7      | 1P      | Draai buizen zodat zuurstof de tank haalt. Puzzels zijn **solvable-by-construction** (pad eerst uitgelopen, dan geschud). Raster groeit 3×3→6×6; vanaf level 3 zitten er dichtgesoldeerde tegels in, vanaf level 4 zijn er **twee onafhankelijke netwerken**. |
| **Brandstof Sorteren**    | Water-sort           | 5–7      | 1P      | Giet raketbrandstof tot elke tank één kleur is. Kleuren 3→7 en reservetanks 2→1 met het level. **Undo** altijd beschikbaar, want de puzzel kan doodlopen en dan moet een kind niet opnieuw hoeven beginnen. |
| **Ruimte Invasie**        | Space Invaders       | 5–7      | 1P & 2P | Drie alientypes (drifter / zigzagger / gepanzerd), **eindboss elke 5e golf** met health bar, en op te vangen **power-ups** (drievoudig schot, sneller vuren). Aliens schieten niet en er zijn geen levens. |
| **Asteroïdenveld**        | Breakout             | 6–7      | 1P & 2P | Asteroïden met 1–3 hits, vier **veldpatronen** (vol / schaakbord / piramide / kloof), power-ups (brede vanger, multi-bal, trage bal). 2P = paddles boven én onder, coöperatief. |

### Ontwerpkeuze: geen verliesstatus
Geen van de acht spellen kent "game over". Aliens die de onderkant halen
trekken zich terug naar boven; een verloren bal komt gewoon terug in het
midden; een verkeerd geplaatst puzzelstuk zweeft terug. Er is dus altijd
vooruitgang en nooit een moment waarop een kind te horen krijgt dat het
verloren heeft. Score en level gaan alleen omhoog.

**Uitbreidingen (post-MVP, alvast in registry-structuur voorzien)**:
kleurplaten-only modus, bubble-pop reflex-spel, eenvoudig ritme-/muziekspel,
tel-/rekenspelletje, "verstop-en-zoek" (Sago Mini-stijl).

## 6b. Progressie en geluid

**Progressie** (`src/shell/progress.js`): elk spel schrijft het hoogst
bereikte level naar `localStorage`. Het portaal leest dat terug als
levellampjes op de missieknop, zodat een kind ziet hoe ver het in elk spel
is — de hub voelt daardoor als één geheel in plaats van acht losse spellen
die elke sessie op nul beginnen.

**Geluid** (`src/shell/audio.js`): volledig procedureel gesynthetiseerd via
de Web Audio API — oscillatoren voor tonen en arpeggio's, één gedeelde
noise-buffer met filters voor stuwraketten, inslagen en whooshes. Geen
audiobestanden betekent geen downloadkosten, geen licenties en nul
decode-latency. De keten eindigt op een limiter zodat snel vuren niet
gaat clippen op harde digibord-speakers. De kit is ruimte-specifiek:
`launch`, `thruster`, `laser`, `explode`, `impact`, `dock`, `pour`, `flow`,
`powerup`, `levelUp`, `missionComplete`. Mute-knop zit in de portaalbalk.

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

## 7b. Verificatie

Het geheel is geautomatiseerd nagelopen met een headless Chromium
(puppeteer-core tegen de systeem-Chromium) die de echte build bedient:
portaalflow doorlopen, alle acht spellen openen, tikken én slepen
simuleren, en per spel controleren op:

- console- en `pageerror`-meldingen (nul);
- aanraakdoelen kleiner dan 88px (nul);
- horizontale/verticale paginaoverflow (nergens);
- een canvas dat uniform van kleur is, d.w.z. niets getekend;
- correcte opruiming bij terugnavigatie (geen achterblijvend canvas of
  lopende renderloop).

Alles is op zowel 1920×1080 als 3840×2160 gemeten om de vmin-schaalregel
te bewijzen. Drie echte bugs kwamen hieruit:

1. **Leeg tekencanvas** — `ResizeObserver` vuurt altijd één keer bij
   `observe()`, en het zetten van `canvas.width` wist de bitmap. Het
   tekenscherm schilderde zijn achtergrond precies één keer en werd daarna
   meteen leeggeveegd. Opgelost met een `preserveOnResize`-optie in
   `setupCanvas()` die de bitmap over een resize heen tilt.
2. **Platgedrukt puzzelbord** — het bord kreeg zijn maat in JS maar zat in
   een flex-kolom, waardoor flex-shrink de 4:3-verhouding sloopte (720×540
   werd 715×210) en de gesneden afbeelding niet meer klopte. Opgelost met
   `flex: 0 0 auto` plus een expliciete verticale ruimteberekening.
3. **Samengeklonterde vormen op canvas** — opeenvolgende `arc()`-aanroepen
   in één pad worden door een lijn verbonden, waardoor kraters en
   alien-ogen aan elkaar plakten. Elk cirkeltje krijgt nu zijn eigen pad.

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
