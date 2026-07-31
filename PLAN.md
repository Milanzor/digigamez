# Digigamez — Kinderspelletjes voor Digiborden

Een browsergebaseerde spellenbundel voor een 75" touchscreen digibord, gericht op
kinderen van 2 t/m 7 jaar. Start bij een portal waar 1 of 2 spelers gekozen
worden, gevolgd door een raster met minigames. Volledig in het Nederlands,
geoptimaliseerd voor grote touchscreens en soepele 60fps-animaties.

## 1. Doelen & randvoorwaarden

- **Doelgroep**: kinderen 2–7 jaar, dus grote knoppen, weinig tekst, veel
  iconen/kleur/geluid, vergevingsgezinde besturing (geen "game over" drama,
  geen agressieve content).
- **Apparaat**: 75" touchscreen digibord (kiosk-modus), landscape. Het bord
  wordt aangestuurd door een laptop met **Firefox** in fullscreen — die is
  getest en doet multi-touch correct, dus de ingebouwde (stokoude) browser van
  het bord hoeft niet ondersteund te worden en we mikken op een moderne
  engine. Aanraakbediening is leidend, muis/toetsenbord als fallback voor
  ontwikkeling/testen.
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

## 2b. Visuele richting: "observatorium + cockpit"

Het hele pakket zit in één ruimtethema. Het uitgangspunt is niet de
standaard "zwarte ruimte met één neonkleur", maar ook niet langer het
Apollo-emaillepaneel waarmee dit begon: die geverfde panelen met dikke
randen vochten om aandacht met de spellen die erin stonden. De ruimte is
nu **écht donker** — een bijna-zwart indigo dat vanuit één hoek door een
nevel wordt aangelicht — en het chroom dat erop zweeft is getekend met
**1px crème haarlijnen** in plaats van massieve platen. Dat is de hele
omslag: een haarlijn leest als instrumentglas en laat de missiekleur het
enige felle op het scherm zijn.

- **Palet**: `--void-deep #05070f`, `--void #0d0c22`,
  `--nebula-lit #2a1f4d`, crème `#f3ece0` / `--muted #9a9280`,
  haarlijn crème op 14/22/30%.
- **Één actiekleur**: `--amber #ffc24a` — knoppen, voortgang, actieve
  staat, en niets anders. `--copper #d08c4a` is uitsluitend voor de kleine
  mono-kopjes. Nooit twee accenten in dezelfde knop.
- **Acht speelkleuren**: `--teal #5fe3c4`, `--coral #ff6b6b`,
  `--violet #b98cff`, `--pink #ff8fc7`, `--sky #8fd6ff`, `--green #7ee787`,
  `--flame #ffa14a`, `--copper`. Eén per missie, en ze komen de UI alleen
  binnen als *gloed in de patrijspoort* — nooit als rand of vulling.
- **Typografie**: `Baloo 2` (800/700/500) voor alles wat een kind leest.
  `Space Mono` (700) uitsluitend voor kleine hoofdletterlabels die de
  ruimtevaart-toon zetten — nooit voor lopende tekst of knoppen.
- **Signatuur — de patrijspoort**: een ring instrumentglas met één emoji
  erin (`.port`). Hij is de missie-icoon in het rooster, de raket op het
  startscherm en de trofee op het beloningsscherm, dus een kind komt
  overal hetzelfde object tegen. `.port--lit` (amber) markeert "dit is
  waar je was".
- **Voortgang** is een dunne amberen balk, niet meer een rij lampjes:
  dezelfde level-data, maar een balk is van achter in een lokaal leesbaar
  waar vijf stippen geteld moeten worden.
- **Sterrenveld**: drie getilede gradient-lagen die met CSS-transforms
  driften (parallax), plus een twinkelende opacity op de verste laag. Puur
  compositor-werk, dus het kost geen main-thread tijd terwijl een spel
  zijn eigen renderloop draait.

### Vaste schermgrammatica
Elk scherm onder het startscherm opent met dezelfde balk: ronde terugknop
(getekende driehoek, geen `◀`-glyph), koperen mono-label, en een haarlijn
eronder in plaats van een paneel. In het spel staan de uitleesvelden
rechts als **mono-label + waarde in de displayletter** (`LEVEL 3`),
gescheiden door 1px haarlijnen — zoals een echt paneel zijn meters labelt.

### Een nieuwe missie toevoegen
Kies één ongebruikte speelkleur en zet die in `game-registry.js`. Eén emoji
in een patrijspoort. Titel in Baloo 2 700, leeftijd en `2P` in Space Mono.
Het spelscherm krijgt automatisch dezelfde balk via `createHud()`, en sluit
af met `showMissionComplete()` — dezelfde patrijspoort, drie sterren, één
amberen primaire knop.

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
- **Gloed als voorgerenderde sprite, nooit als `shadowBlur`.** Dit is de duurste
  val in canvas 2D: de browser doet een blur-pass per *fill of stroke* onder een
  `shadowBlur`, en een alien die uit acht vormen bestaat kost dus acht blurs.
  Bij een volle golf van veertig aliens waren dat ~200 blur-passes per frame en
  zakte een 4K-bord naar ~50fps (en op 4K softwarerendering naar 16fps). De
  gloed staat nu één keer per kleur in een klein offscreen canvas
  (`drawGlow` in `canvas-utils.js`): één `drawImage` per glimmend object,
  ongeacht uit hoeveel vormen het bestaat. Resultaat: 3 blur-passes per frame en
  een vaste 60fps.
- **Deeltjes-plafond**: een golf die in één frame wordt weggevaagd zet honderden
  deeltjes in de rij; boven het budget vallen de oudste af. Een feestje mag
  nooit meer kosten dan het spel zelf.
- **Sprite-atlassen** (1 PNG/WebP per spel-thema) i.p.v. losse imagebestanden
  → minder HTTP-requests, minder draw-call overhead.
- **Alles wat vaak herhaald wordt is een sprite, geen tekening.** Dezelfde les
  als de gloed: een `createRadialGradient` of een `fillText` per object per
  frame is duur, en op een volle werkbank staan er honderden. De knikker en de
  bel in de Gekke Machine, de emoji van elk onderdeel en de zeepbel in
  Zeepbellen worden één keer op device-resolutie in een offscreen canvas
  getekend en daarna geblit — scherp op 4K, en één `drawImage` per object.
- **Broad phase in de Gekke Machine.** Het plafond van 90 onderdelen kwam
  voort uit een simulatie waarin elke knikker elk onderdeel en elk botssegment
  bevroeg, drie keer per frame: tien keer zoveel onderdelen was honderd keer
  zoveel werk. Er ligt nu een uniform raster van 80px-cellen over de werkbank
  (segmenten én knikkers), en de krachtenlus loopt alleen nog over de
  onderdelen die op afstand werken (ventilator, band, magneet, zwart gat,
  stroop). Daarmee schaalt de kost met wat er *naast* een knikker ligt in
  plaats van met de hele bank, en past er **900 onderdelen en 600 knikkers**
  in met ~3ms hoofddraad-werk per frame.
- **Canvas-schaling**: canvas intern renderen op een vaste logische resolutie
  (bv. 1920×1080) en via CSS opschalen naar het fysieke 75"-paneel, met
  `devicePixelRatio`-correctie alleen waar nodig (crisp-canvas techniek) om
  overdraw op 4K-achtige paneelresoluties te vermijden.
- **Lazy loading per spel**: elk spel is een apart ES-module + eigen assets,
  dynamisch geïmporteerd (`import()`) zodra de speler het kiest — portal laadt
  alleen UI-assets, niet alle veertien spellen tegelijk.
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
│   │   ├── tekenen/              # Vrij tekenen op een schuifbaar bord
│   │   ├── gekke-machine/        # Fysica-zandbak (knikkerbaan)
│   │   ├── legpuzzel/            # Jigsaw puzzel
│   │   ├── geheugenspel/         # Memory / matching
│   │   ├── vormen-sorteren/      # Shape sorting (peuters)
│   │   ├── zeepbellen/           # Bellen prikken (peuters, multi-touch)
│   │   ├── sterrenecho/          # Simon says
│   │   ├── maanhockey/           # Airhockey, 2P tegenover elkaar
│   │   ├── rover/                # Commando's programmeren
│   │   ├── sterrenorkest/        # Stap-sequencer
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
4b. **Instellingen** (`#/instellingen`): het enige scherm voor de grote mensen,
   bereikbaar via ⚙️ op het opstartscherm én in de portaalbalk. Geluid aan/uit,
   volume in drie stappen (zacht/gewoon/hard), sterrenhemel bewegend of rustig
   (voor wie minder prikkels wil), volledig scherm aan/uit, en **alle voortgang
   wissen**. Dat laatste zit achter een knop die je 1,6 seconde vast moet
   houden: een kleuter tikt door een "weet je het zeker?" heen, maar houdt niet
   per ongeluk anderhalve seconde stil. Instellingen zelf blijven na het wissen
   staan, zodat het bord ingesteld blijft zoals de klas het wil.
5. **Idle/screensaver** (nice-to-have, niet MVP): na X minuten inactiviteit
   terug naar opstartscherm met rustgevende animatie, zodat het digibord niet
   "vast" blijft staan in een spel.

## 6. Spellenlijst

Gebaseerd op wat consistent hoog scoort in app-store-lijsten voor peuters/
kleuters (Sago Mini, Toca Boca, Lingokids, ElePant, jigsaw/matching-apps zoals
"Puzzle Kids" en "Kids Puzzle & Toddler Games") — de gemene deler is: grote
tastbare elementen, direct visueel/auditief succesgevoel, geen faalstatus die
als "verlies" aanvoelt, korte sessies. Zie bronnen onderaan dit document.

Alle veertien spellen zitten in hetzelfde ruimtethema en hebben een
**levelprogressie** die lokaal wordt opgeslagen (zie §6b) — op de drie open
speelgoed-spellen na, die in plaats daarvan hun werk bewaren.

De eerste negen waren de MVP; de onderste vijf zijn de "eerste vijf" uit de
kandidatenlijst (§6c), gebouwd ná de redesign en dus meteen in de nieuwe
huisstijl geboren. Ze vullen de drie gaten die daar benoemd zijn: 2–4 jaar,
gelijktijdig samenspelen, en de ontbrekende genres muziek en logica.

| Spel (NL)                 | Genre                | Leeftijd | 1P / 2P | Kern-mechaniek en diepte |
|---------------------------|----------------------|----------|---------|--------------------------|
| **Sterrenvormen**         | Shape-sort           | 2–4      | 1P      | Sleep vracht naar de bijpassende luchtsluis. Diepte via drie knoppen: aantal stukken 3→6, vanaf level 3 driften de sluizen zijwaarts, vanaf level 5 moet ook de **kleur** kloppen. |
| **Ruimtegeheugen**        | Memory / matching    | 3–6      | 1P & 2P | Kaarten met planeten en aliens. Bord groeit 4→12 paren; vanaf level 2 is er één gouden **komeetpaar** dat dubbel telt. 2P om de beurt met scores. |
| **Sterrenpuzzel**         | Jigsaw               | 3–7      | 1P & 2P | Ruimtescènes (inline SVG, dus scherp op 4K) in stukjes. 4→20 stukjes; **👁️-knop** ghost het voorbeeld over het bord als hint in plaats van een moeilijkheidsmuur. |
| **Ruimtetekenen**         | Creatief             | 2–7      | 1P & 2P | Vrij tekenen op een bord van **drie schermen breed** dat je met ✋ verschuift en met knijpen/wiel zoomt. Elf kwasten (stift, neon, krijt, regenboog, sterrenstof, spuitbus, waterverf, lint dat dun wordt als je snel beweegt, stippellijn, stempelspoor, gum), zes vormen met vulknop, **32 stempels**, spiegel-, viervoudige én **caleidoscoop-symmetrie (zes kanten)**, **zeventien achtergronden** achter één keuzelade (ruimte, nachtlucht, raster, onder water, zonsondergang, op de maan, Mars, stad bij nacht, bos, weiland, sneeuw, vulkaan, regenboog, schoolbord, ruitjes, papier, schrijflijntjes) — elk een eigen schilderfunctie over de hele wereld, dus met een échte horizon, zon of skyline; de sierlijke onderdelen (kraters, ramen, boomstammen, vlokken) worden één keer als `Path2D` opgebouwd en daarna elk frame hergebruikt, zodat pannen twee path-fills kost in plaats van duizenden arcs, **zes kleurplaten** (raket, poes, bloem, vis, vlinder, huis) als vaste onderlaag die niet mee-gumt, undo/redo en opslaan als PNG. Streken zijn vectoren, dus scherp op elke zoom, en de tekening staat er na een rondje portal nog. Multi-touch: twee kinderen tekenen gelijktijdig. |
| **Gekke Machine**         | Fysica-zandbak       | 4–7      | 1P      | Bouw een knikkerbaan van **twintig onderdelen** (knikker, stuiterbal, ballon, raket, plank, trampoline, transportband, wip, molen, kegel, klokkenspel, ventilator, kanon, magneet, zwart gat, stroop, bom, knikkerkraan, beamer-paar, emmer), **teken banen** die meedoen als vaste botsingslijnen, en druk op ▶ om alles los te laten. 🎲 laadt vijf voorbeeldmachines, 🐢 zet alles in slow motion, 💫 laat de sporen van de knikkers zien, ↩️ neemt de laatste bouwstap terug en met ✋ tik je een ventilator, band of bel een standje verder. ⏹ zet elk onderdeel terug waar het gebouwd is, en de werkbank staat er na een rondje portal nog — experimenteren kost dus niks. |
| **Zuurstofleidingen**     | Pipe-connect         | 4–7      | 1P      | Draai buizen zodat zuurstof de tank haalt. Puzzels zijn **solvable-by-construction** (pad eerst uitgelopen, dan geschud). Raster groeit 3×3→6×6; vanaf level 3 zitten er dichtgesoldeerde tegels in, vanaf level 4 zijn er **twee onafhankelijke netwerken**. Als het klopt **stroomt de zuurstof zichtbaar door**: tegel voor tegel vanaf de kraan naar de tank, met een oplopend klokkenspel-toontje bij elke bocht — het moment dat het kind gebouwd heeft, dus dat wordt getoond in plaats van alleen gemeld. |
| **Brandstof Sorteren**    | Water-sort           | 5–7      | 1P      | Giet raketbrandstof tot elke tank één kleur is. Kleuren 3→7 en reservetanks 2→1 met het level. **Undo** altijd beschikbaar, want de puzzel kan doodlopen en dan moet een kind niet opnieuw hoeven beginnen. |
| **Ruimte Invasie**        | Space Invaders       | 5–7      | 1P & 2P | **Moeilijkheidskeuze vooraf** (makkelijk / gewoon / moeilijk; op moeilijk schieten de aliens terug en hebben de schepen een schildbalk). Vijf alientypes met eigen silhouet en gedrag — inktvis, schotel, kever, splitser die in tweeën breekt, en zijn kleintjes — plus **drie afwisselende eindbosses** (Kwalmonster, Sterrenkrab, Het Grote Oog), een bonusschotel en power-ups (drievoudig schot, sneller vuren, schild). De zwerm keert altijd om ruim **boven de schepen**, zodat aliens nooit onschietbaar laag komen. |
| **Asteroïdenveld**        | Breakout             | 6–7      | 1P & 2P | Asteroïden met 1–3 hits, vier **veldpatronen** (vol / schaakbord / piramide / kloof), power-ups (brede vanger, multi-bal, trage bal). 2P = paddles boven én onder, coöperatief. |
| **Zeepbellen**            | Bellen prikken       | 2–4      | 1P & 2P | Bellen drijven omhoog uit de luchtsluis; prikken met tien vingers tegelijk, dus twee kinderen hoeven geen beurt af te wachten. Elke prik is de volgende noot van een pentatonische loopje. Diepte: kleiner en sneller, vanaf level 3 **splitsen** grote bellen in twee, en pas vanaf level 4 is er een opdracht ("prik alleen de blauwe") — een verkeerd aangetikte bel stuitert weg in plaats van iets te kosten. |
| **Sterrenecho**           | Simon says           | 3–7      | 1P & 2P | Vier tot zes panelen spelen een melodie voor, jij speelt hem na. `chime(n)` indexeert een pentatonische ladder, dus **elke reeks is per constructie muzikaal**. Diepte: lengte 4→8, 4→6 panelen, tempo, en op het laatste level **alleen geluid** als aanwijzing. Fout is geen verlies: het station herhaalt het bericht. 2P coöperatief: je echoot de reeks en zet er zelf één toon bij voor de ander. |
| **Maanhockey**            | Airhockey            | 3–7      | 1P & 2P | Twee kinderen naast elkaar aan het bord, elk een vanger in de eigen helft; alleen tegen een robot die net iets te laat is. Eerste bij vijf. Diepte: pucksnelheid, vanaf level 3 **twee manen**, level 4 bumpers, level 5 een magneetveld in de middencirkel. Plus een coöperatieve stand "houd de maan in de lucht" met één gedeelde teller, waarin niemand kán verliezen. |
| **Rover Programmeren**    | Sequencing / logica  | 5–7      | 1P & 2P | Zet ⬆ ⤺ ⤻ in de wachtrij, druk op ▶ en de rover rijdt naar de kristallen. Botsen is stuiteren en doorgaan, en een run die het niet haalde zet het veld terug maar **laat het programma staan** — je past je plan aan in plaats van het opnieuw te bouwen. Diepte: raster 4×4→6×6, obstakels, meer kristallen, en een **×2-token** vanaf level 4. Velden zijn solvable-by-construction (bereikbaarheidscheck vóór ze verschijnen). 2P: om de beurt één opdracht aan één gedeeld programma. |
| **Sterrenorkest**         | Stap-sequencer       | 2–7      | 1P & 2P | Zeven rijen (bel, blub, trom, bas) × acht stappen; tik cellen aan, een leeskop veegt erover. Multi-touch, dus twee kinderen bouwen tegelijk. Elke rij hangt aan een toon van dezelfde pentatonische ladder, dus **de lus kan niet vals klinken**. 🎲 verzint een lus, 🐢/🚶/🐇 zet het tempo, en de lus wordt bewaard zoals Ruimtetekenen zijn streken bewaart. |

### Ontwerpkeuze: geen verliesstatus
Geen van de veertien spellen kent "game over". Aliens die de onderkant halen
trekken zich terug naar boven; een geraakt schip wordt na een paar tellen
gerepareerd; een verloren bal komt gewoon terug in het midden; een verkeerd
geplaatst puzzelstuk zweeft terug; een verkeerde toon in Sterrenecho laat het
station het bericht herhalen; een rover die tegen een steen rijdt stuitert en
gaat door met de volgende opdracht. Ook een verloren partij Maanhockey telt
gewoon als een gespeelde missie: de ladder meet hoe ver je gekomen bent, nooit
hoe goed je was. Er is dus altijd vooruitgang en nooit een moment waarop een
kind te horen krijgt dat het verloren heeft. Score en level gaan alleen omhoog.

**Uitbreidingen**: zie §6c voor de uitgewerkte kandidatenlijst.

## 6b. Progressie en geluid

**Progressie** (`src/shell/progress.js`): elk spel schrijft het hoogst
bereikte level naar `localStorage`. Het portaal leest dat terug als een
amberen voortgangsbalk op de missierij, zodat een kind ziet hoe ver het in
elk spel is — de hub voelt daardoor als één geheel in plaats van veertien
losse spellen die elke sessie op nul beginnen. Dezelfde vijf-levelladder voedt de
drie sterren op het beloningsscherm (`starsForLevel`); die sterren zijn
bewust géén prestatiecijfer, want geen van deze spellen meet *hoe goed* een
level is opgelost en een verzonnen score zou de sterren willekeurig maken.

Het spel dat het laatst gespeeld is wordt onthouden (`lastGame`) en licht op
in het rooster, zodat een kind dat terugkomt bij het bord ziet waar het was.

**Beloningsmoment** (`showMissionComplete`): een level afmaken krijgt zijn
eigen scherm in plaats van een banner die voorbijschuift — patrijspoort met
het missie-icoon, drie sterren, en dan *Volgend level* / *Nog een keer* /
🏠. Het is ook de enige plek waar het kind kiest wat er daarna gebeurt in
plaats van automatisch in het volgende level te worden gezet.

De drie open spellen bewaren niet een level maar het **werk zelf**: de Gekke
Machine schrijft de hele werkbank (onderdelen plus getekende banen) weg,
Ruimtetekenen de streken als vectoren en het Sterrenorkest zijn lus als acht
getallen. Alle drie zijn zo klein dat ze in `localStorage` passen, en het
scheelt het verdriet van een half uur bouwen, tekenen of componeren dat
verdwijnt zodra iemand op ◀ drukt.

**Geluid** (`src/shell/audio.js`): volledig procedureel gesynthetiseerd via
de Web Audio API — oscillatoren voor tonen en arpeggio's, één gedeelde
noise-buffer met filters voor stuwraketten, inslagen en whooshes. Geen
audiobestanden betekent geen downloadkosten, geen licenties en nul
decode-latency. De keten eindigt op een limiter zodat snel vuren niet
gaat clippen op harde digibord-speakers. De kit is ruimte-specifiek:
`launch`, `thruster`, `laser`, `explode`, `impact`, `dock`, `pour`, `flow`,
`powerup`, `levelUp`, `missionComplete`. Daarnaast vier stemmen die alle vier
op dezelfde **pentatonische** toonladder indexeren: `chime(n)` (klokkenspel),
`blub(n)`, `bass(n)` en de toonloze `drum(n)`. Welke combinatie een kind ook
neerzet — bellen in de Gekke Machine, cellen in het Sterrenorkest, een reeks
in Sterrenecho — er kan geen valse noot uit komen. Dat is precies waarom de
twee muziekspellen zo goedkoop waren om te bouwen: er is geen stemwerk en
geen manier om iets lelijks te maken. Mute-knop zit in de portaalbalk; geluid en volume worden
onthouden in `localStorage` onder een eigen `set:`-prefix, wat ook de reden is
dat "alle voortgang wissen" (`resetProgress()`) veilig per prefix kan vegen:
alle levels, tekeningen en machines gaan eruit, de instellingen blijven staan.
Nieuwe spellen hoeven daar niets voor te registreren.

### 2-speler aanpak per spel
- **Om-de-beurt** (Geheugenspel, Legpuzzel-race, Sterrenecho, Rover): duidelijke
  "Astronaut 1 / 2 is aan de beurt"-badge in de balk, groot en met
  kleurcodering. Bij Sterrenecho en Rover is de beurt coöperatief — je bouwt aan
  één gedeelde reeks of één gedeeld programma, dus er is niets te winnen van
  elkaar.
- **Gelijktijdig split-zone** (Ruimte Invasie, Blokken Brekker, Maanhockey):
  scherm fysiek verdeeld in een linker- en rechterhelft (of boven/onder), elke
  speler heeft een eigen touch-zone en eigen kleur, zodat twee kinderen tegelijk
  op hetzelfde 75"-scherm kunnen spelen zonder elkaars input te kapen.
- **Coöperatief gedeeld** (Tekenen, Zeepbellen, Sterrenorkest): beide spelers
  werken vrij op hetzelfde vlak, geen zone-scheiding nodig — het bord neemt
  gewoon tien vingers tegelijk aan.

## 6c. Kandidaat-spellen (bouwvoorraad na de redesign)

Deze lijst was de voorraad voor ná de visuele redesign: er werd niets uit
gebouwd voordat het nieuwe ontwerp stond, zodat elk nieuw spel meteen in de
nieuwe huisstijl geboren wordt in plaats van erna omgebouwd te moeten worden.
**De "eerste vijf" onderaan zijn inmiddels gebouwd** en staan in de tabel van
§6; de rest hieronder is nog voorraad.

De keuzes komen niet uit een wensenlijst maar uit drie gaten in de negen
spellen van de MVP:

1. **2–4 jaar is dun.** Alleen Sterrenvormen is echt op die leeftijd gemikt;
   Ruimtetekenen is open, niet gericht.
2. **2P is vooral om-de-beurt.** Alleen Ruimte Invasie en Asteroïdenveld
   zetten twee kinderen gelijktijdig aan het bord — precies het enige wat een
   75" multi-touch paneel kan en een tablet niet.
3. **Hele genres ontbreken**: muziek, tellen, letters, logica/sequencing,
   reactie. En er zijn maar twee open speelgoed-spellen (Tekenen, Machine).

### Twee kinderen gelijktijdig

- **Maanhockey** 🏒 — ✅ gebouwd, zie §6.
- **Magneetstrijd** 🧲 — touwtrekken, 2–6, 2P. Een satelliet hangt tussen
  twee tractorstralen. Niet op knoppen rammen (een zevenjarige walst dan
  over een driejarige heen) maar **tik het paneel dat oplicht**: reactie in
  plaats van snelheid, en één kant kan een voorsprong krijgen. Van de
  overkant van het lokaal in één oogopslag te lezen.
- **Meteoor Meppen** 🔨 — mollen meppen, 3–7, 1P & 2P op één *gedeeld*
  bord. Aliens duiken uit kraters op en twee kinderen graaien naar dezelfde
  krater. Diepte: opduiktempo, alientypes met verschillende waarde, en één
  vriendelijk exemplaar dat alleen giechelt als je het raakt (geen punten,
  ook geen straf).
- **Sterrenrij** 🔴 — vier op een rij, 5–7, 2P om de beurt + een milde
  computerspeler. Planeten in een kolom laten vallen, zwaartekracht stapelt
  ze. Schaalt naar drie-op-een-rij op 3×3 voor de kleinsten. Er is nu geen
  enkel spel waarin twee kinderen tegen elkaar *nadenken*.
- **Raketrace** 🏁 — 4–7, 2P (en op dit paneel eerlijk gezegd 3–4P). Twee
  pads links-rechts afwisselen als rennende benen om snelheid te maken.
  Weer ritme in plaats van rammen, dus eerlijk over de leeftijden heen.

### Muziek (bijna gratis in deze codebase)

- **Sterrenecho** 🔔 — ✅ gebouwd, zie §6.
- **Sterrenorkest** 🎹 — ✅ gebouwd, zie §6.

### Logica en tellen (het gat bij 5–7)

- **Rover Programmeren** 🤖 — ✅ gebouwd, zie §6.
- **Ladingcontrole** 📦 — tellen, 3–6, 1P & 2P. Laad *precies* N kratten in
  de raket; de teller laat zien wat je hebt en hij vertrekt alleen als het
  klopt. Diepte: 1–5 → 1–10 → 1–20 → "er zaten 3 in, er komen 2 bij" →
  meer/minder. Tastbaar in plaats van overhoring, dus het voelt nooit als
  een toets.
- **Sterrenpaden** ✨ — stip-naar-stip, 3–6, 1P. Sleep van ster 1 naar 2
  naar 3; het sterrenbeeld licht op en wordt een raket, poes of vis.
  Telvolgorde plus fijne motoriek, en de onthulling is de belofte. De
  leveldata is niets meer dan een lijst punten, dus heel goedkoop.
- **Letterplaneten** 🔤 — beginletters, 5–7, 1P. Er komt een krat met 🚀
  aan, tik de planeet met de **R**. Diepte: eerste letter → laatste letter →
  met lettertegels woorden van 3–4 letters bouwen. De bundel heeft nu nul
  taalinhoud, en dit is het enige genre dat écht Nederlands moet zijn om te
  werken.

### Voor de kleinsten (2–4)

- **Zeepbellen** 🫧 — ✅ gebouwd, zie §6.
- **Alien Verstoppertje** 🙈 — verstop-en-zoek, 2–5, 1P & 2P. Kraters en
  stenen in een tafereel; tik om op te lichten en er zit een beestje onder,
  elk met zijn eigen animatie. Diepte: aantal verstopt, en daarna een
  bekerspel (volg de alien onder drie schuivende bekers — echte
  aandachtstraining). Mislukken is hier structureel onmogelijk.
- **Maak je Maatje** 👽 — eigen wezen bouwen, 2–7, 1P & 2P coöperatief.
  Koppen, ogen, antennes, armen en kleuren mengen; de alien knippert, danst
  en toetert. Bewaard zoals Ruimtetekenen. Dit is het Toca Boca-vak, en er
  ligt een mooie haak: **laat het gemaakte maatje in andere spellen
  opduiken** — als kaart in Ruimtegeheugen, als piloot van de rover, op de
  kratten van Ladingcontrole. Dan voelt de hub als één wereld in plaats van
  veertien losse kasten.
- **Toren Bouwen** 🧱 — stapelen, 3–7, 1P & 2P om de beurt. Een kraan
  zwaait een blok heen en weer, tik om te lossen. Elke speler legt er één
  op: hoe hoog voordat het gaat wiebelen? Instorten is grappig, geen
  verlies. De fysica van Gekke Machine doet het zware werk al.

### Eerste vijf — gebouwd

In deze volgorde gebouwd, één spel per gat, en vier van de vijf leunden op
code die er al stond:

1. **Zeepbellen** — vult 2–4 en was vrijwel gratis.
2. **Sterrenecho** — muziek voor niks, dankzij de bestaande pentatoniek.
3. **Maanhockey** — het ontbrekende kop-op-kop spel, op bestaande balfysica.
4. **Rover Programmeren** — het ontbrekende denkspel.
5. **Sterrenorkest** — derde open speelgoed, bewaart zijn eigen werk.

Wat ze onderweg aan de gedeelde laag hebben toegevoegd: `blub`, `bass` en
`drum` naast `chime` in `audio.js` (alle vier op dezelfde toonladder), en een
missierooster dat op vier kolommen staat omdat veertien rijen in drie kolommen
van een 16:9-bord af lopen. Verder niets — de vijf passen op `createHud`,
`showMissionComplete`, `setupCanvas` en `progress.js` zoals ze al waren, wat
het beste bewijs is dat die laag klopt.

### Daarna

De volgende drie uit de voorraad, weer één per gat: **Ladingcontrole** (tellen,
3–6), **Sterrenrij** (tegen elkaar nadenken, 5–7) en **Maak je Maatje** — die
laatste pas als de vraag over een gedeeld maatje hieronder beslist is, want
spellen die erop gaan leunen willen een vast formaat.

### Bewust niet

- **Zoek-de-verschillen** — kost per level nieuw tekenwerk, en op 4K is een
  verschil nauwelijks te verstoppen.
- **Kantel-doolhof** — geen accelerometer op een bord dat door een laptop
  wordt aangestuurd.
- **Ritme-meetikken** — de mechaniek *is* mislukken; de sequencer levert de
  muziek zonder die prijs.
- **Tangram** — overlapt Sterrenvormen en Sterrenpuzzel.
- **Slang tegen elkaar** — leunt op botsen en verliezen, wat slecht rijmt
  met de regel uit §6.

### Open keuzes

- **3–4 spelers?** Raketrace en Meteoor Meppen worden beter met vier
  kinderen, en het paneel kan het. Alleen: de spelerkeuze in de portal (§5)
  kent nu 1P en 2P, en `supportsTwoPlayers` in de registry is een boolean.
  Dat zou een `maxPlayers`-getal moeten worden. Beslissen vóór Raketrace,
  niet erna.
- **Gedeeld maatje tussen spellen.** Als Maak je Maatje zijn wezen in
  `localStorage` zet, kan elk ander spel het lezen. Dat is een kleine
  gedeelde module (`src/shell/maatje.js`) en een grote winst voor het gevoel
  dat het één wereld is — maar het moet wel meteen goed, want spellen die er
  eenmaal op leunen willen een vast formaat.

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
portaalflow doorlopen, alle veertien spellen openen, tikken én slepen
simuleren, en per spel controleren op:

- console- en `pageerror`-meldingen (nul);
- aanraakdoelen kleiner dan 88px;
- horizontale/verticale paginaoverflow (nergens);
- een canvas dat uniform van kleur is, d.w.z. niets getekend;
- correcte opruiming bij terugnavigatie (geen achterblijvend canvas of
  lopende renderloop);
- het missierooster: veertien rijen die op één scherm passen zonder scrollen.

Alles is op zowel 1920×1080 als 3840×2160 gemeten om de vmin-schaalregel
te bewijzen.

**Openstaand**: op 1920×1080 zitten de gereedschapsknoppen van Ruimtetekenen
(56px) en de Gekke Machine (71px) onder de 88px-richtlijn. Op het echte bord
(3840×2160) zijn ze 112 respectievelijk 142px en dus ruim in orde; ze groter
maken op 1080p zou de twee dichte werkbalken over het speelveld duwen. Bewust
zo gelaten, niet vergeten.

Naast de generieke sweep worden de nieuwe spellen ook echt *gespeeld* in de
harness — een reeks echoën in Sterrenecho, een programma laten lopen tot de
rover zijn kristal heeft, cellen aanzetten en na een rondje portal terugkomen
om te zien of de lus er nog staat — want een spel dat niet crasht is nog geen
spel dat werkt. Drie echte bugs kwamen uit de eerste ronde:

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

**Gebouwd**:
- Volledige projectstructuur + build-tooling (Vite).
- Portal met 1P/2P-keuze, instellingenscherm en een missierooster van
  veertien rijen op vier kolommen.
- Alle veertien spellen als speelbare modules met polish (geluid, animatie,
  1P/2P waar van toepassing): de negen van de MVP plus de eerste vijf uit de
  kandidatenlijst.
- Shell-optimalisaties: fullscreen, wake lock, unified pointer input, lazy
  loading, object pooling waar relevant.
- GitHub Actions-workflow voor automatische deploy.

**Later / bewust buiten scope**:
- Accounts, cloud-opslag van voortgang/scores.
- Uitgebreide screensaver/idle-detectie (kan later toegevoegd worden via de
  bestaande router).
- De resterende spellen uit de kandidatenlijst in §6c.
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
