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
| Typografie     | Twee woff2-bestanden in `src/styles/fonts/`, geen Google Fonts-CDN | Het bord wachtte op een render-blokkerende stylesheet van een derde partij; achter een captive portal of op een traag schoolnetwerk is dat een wit scherm. Baloo 2 is één variabel bestand (33 kB) dus 500–800 komt uit één download, en het geheel werkt met de stekker eruit |
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
  zijn eigen renderloop draait. Elke laag drift **precies één tegel** in
  beide richtingen: de verticale poot was een halve tegel, en dus sprong
  elke laag zichtbaar 105, 160 of 260 pixels op het moment dat zijn
  animatie omliep — zeldzaam genoeg (elke 90 tot 240 seconden) om op een
  storing in het paneel te lijken in plaats van op een fout in de
  stylesheet. Zie ook §3 voor waarom de lagen niet langer 200% × 200% zijn.
- **Een vignet** over de nevel. Op 75" liggen de hoeken bijna in het
  ooghoekgebied; ze een stop terugbrengen zet het gewicht terug in het
  midden waar de missies staan. Eén extra gradient in de bestaande stapel,
  dus geen element en geen kosten.

### Aankomst en vertrek
Schermen werden met `replaceChildren()` verwisseld, dus elke navigatie was
een harde knip — op een wandgroot paneel leest dat als geflikker in plaats
van als een verplaatsing. De router zet nu `.screen-enter` op wat hij net
gemonteerd heeft: één korte stijging met een fade, altijd dezelfde curve
(`--ease-out`). Het missierooster laat zijn vierentwintig rijen daarbovenop
achter elkaar binnenkomen (22 ms per rij, afgekapt op een halve seconde) en
elke voortgangsbalk veegt vanaf links open zodra zijn rij landt.

Het startscherm heeft als enige een échte vertrekanimatie. `sfx.launch()` is
anderhalve seconde motor en het scherm was binnen de eerste vijftig
milliseconden daarvan al weg. Nu ruimt het paneel eerst op (titel, knop en
voetregel zakken weg in 180 ms), klimt de raket met een vlam het beeld uit,
en pas daarna wisselt de route. Het geluid en het beeld vertellen hetzelfde
verhaal, en het wachten is de beloning in plaats van vertraging.

### De valkuil van `animation-fill-mode` (de derde CSS-les)
Een animatie die vooruit blijft vullen (`forwards`, en dus ook `both`) staat
voor de eigenschappen die hij aanraakt **boven transitions en boven gewone
declaraties** — voor de rest van het leven van dat element. `.screen-enter`
begon als `both`, en daarmee sloeg de fade-out van het startscherm over in
een harde sprong en zou `.mission:active` op alle vierentwintig rijen nooit
meer ingedrukt zijn. De regel voor dit project: **vul alleen vooruit waar de
ruststand van een element verschilt van zijn eigen CSS, en nooit op iets dat
dezelfde eigenschap ook transitioneert.** Een animatie met een vertraging
die verborgen moet beginnen wil `backwards`, niet `both`. De harness
controleert sindsdien of er na aankomst nog een afgelopen animatie staat te
vullen.

### Vaste schermgrammatica
Elk scherm onder het startscherm opent met dezelfde balk: ronde terugknop
(getekende driehoek, geen `◀`-glyph), koperen mono-label, en een haarlijn
eronder in plaats van een paneel. In het spel staan de uitleesvelden
rechts als **mono-label + waarde in de displayletter** (`LEVEL 3`),
gescheiden door 1px haarlijnen — zoals een echt paneel zijn meters labelt.

### Een nieuwe missie toevoegen
Kies één speelkleur en zet die in `game-registry.js`, samen met `maxPlayers`
(een getal, dat het rooster als `2P`/`4P` toont). De acht speelkleuren komen bij
vierentwintig missies drie keer rond; wat telt is dat dezelfde kleur nooit naast
of onder een andere terechtkomt, en de lijst staat op leeftijd gesorteerd met dat
in het achterhoofd. Eén emoji in een patrijspoort. Titel in Baloo 2 700, leeftijd
en het spelersgetal in Space Mono. Het spelscherm krijgt automatisch dezelfde
balk via `createHud()`, en sluit af met `showMissionComplete()` — dezelfde
patrijspoort, drie sterren, één amberen primaire knop.

Twee vuistregels die de laatste tien missies hebben opgeleverd. **Geen
`flex: 1` op een element waarvan de ouder zijn hoogte uit zijn inhoud haalt** —
er is dan geen vrije ruimte om op te eisen, en het bord van Sterrenrij klapte
zo dicht tot een streepje onder de kolomknoppen; leid de hoogte af met
`aspect-ratio`. En **`margin: 0 auto` zet `align-self: stretch` uit**: bij het
bekerspel bleef de baan daardoor nul pixels breed en stonden alle drie de stenen
op elkaar in het midden. Wil je een absoluut gepositioneerde inhoud centreren,
geef de doos dan een echte `width` en `align-self: center`.

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
- **De ruimte-achtergrond is een sprite, niet een tekening.** Acht spellen
  riepen `drawSpaceBackdrop` elk frame aan, en die bouwde twee gradients op en
  vulde het hele logische canvas twee keer — op een 4K-bord is een
  schermvullende gradient-fill per-pixel interpolatie over acht miljoen pixels,
  waar een blit een rechte kopie is. De gradientlagen staan nu één keer in een
  offscreen canvas op logische resolutie. De sterren blijven per frame getekend
  (ze scrollen en twinkelen) maar worden **op helderheid gegroepeerd** in tien
  emmers en per emmer als één pad gevuld: honderdvijftig sterren kosten tien
  fills in plaats van honderdvijftig. Gemeten op de software-rasteriser, het
  geval dat dit document al als gevaarlijk aanwees: **31 ms → 16 ms** per
  achtergrond bij een 4K-pixelbuffer.
- **Het sterrenveld van de portal is niet langer 200% × 200%.** Drie lagen van
  het dubbele van het scherm in beide richtingen vraagt de compositor op een
  3840×2160-bord om een textuur van 7680×4320 per laag — zo'n 400 MB
  GPU-geheugen voor drie lagen die samen een paar honderd pixels bewegen. Elke
  laag is nu zo groot als het scherm plus één tegel van zijn eigen patroon,
  wat de kost ruim halveert en op het scherm niets verandert.
- **Vooruitladen bij `pointerdown`.** De module van een missie wordt opgehaald
  zodra een vinger op de rij landt, ruim honderd milliseconde voordat de tik af
  is en de route wisselt; de import-cache maakt de `load()` van de loader daarna
  onmiddellijk, dus de meeste missies openen zonder laadscherm. Daarnaast wordt
  de laatst gespeelde missie in een `requestIdleCallback` opgehaald terwijl het
  rooster staat te wachten, want doorgaan waar je was is de waarschijnlijkste
  volgende tik. Een druk die een sleep blijkt te zijn heeft één module gekost
  waar het kind toch naar reikte.
- **Canvas-schaling**: canvas intern renderen op een vaste logische resolutie
  (bv. 1920×1080) en via CSS opschalen naar het fysieke 75"-paneel, met
  `devicePixelRatio`-correctie alleen waar nodig (crisp-canvas techniek) om
  overdraw op 4K-achtige paneelresoluties te vermijden.
- **Lazy loading per spel**: elk spel is een apart ES-module + eigen assets,
  dynamisch geïmporteerd (`import()`) zodra de speler het kiest — portal laadt
  alleen UI-assets, niet alle vierentwintig spellen tegelijk.
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
│   │   ├── verstoppertje/        # Verstop-en-zoek + bekerspel (peuters)
│   │   ├── magneetstrijd/        # Touwtrekken op reactie, 2P
│   │   ├── maatje/               # Eigen wezen bouwen (open, bewaart werk)
│   │   ├── ladingcontrole/       # Tellen: precies N kratten laden
│   │   ├── sterrenpaden/         # Stip-naar-stip sterrenbeelden
│   │   ├── meteoor-meppen/       # Mollen meppen op één gedeeld bord
│   │   ├── toren-bouwen/         # Blokken stapelen met een kraan
│   │   ├── raketrace/            # Twee pads afwisselen, 2-4P
│   │   ├── letterplaneten/       # Beginletters en woorden spellen
│   │   ├── vier-op-rij/          # Sterrenrij: vier op een rij + computer
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
   kaarten met duidelijke iconen (1 poppetje vs. 2 poppetjes). Bewust nog steeds
   maar twee kaarten, ook nu Raketrace er vier aan het bord kan zetten: deze
   vraag gaat over om-de-beurt spelen, en een spel dat meer stoelen heeft vraagt
   dat zelf op zijn eigen startscherm (zie §6c, "Open keuzes").
3. **Spellenrooster**: grid met kaarten per spel — groot icoon, Nederlandse
   titel, leeftijdsindicatie (bv. "2-4 jaar", "5-7 jaar"), en hoeveel spelers
   erbij kunnen (badge `2P` / `4P`, uit `maxPlayers` in de registry). De loader
   klemt de gekozen crew op dat getal, zodat een bord dat op "2 astronauten"
   staat een solospel gewoon als solospel opent. Filter/sortering op leeftijd is
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
5. **Idle-reset** (`src/shell/idle.js`): na vier minuten zonder aanraking gaat
   het bord terug naar het opstartscherm. Een digibord wordt voortdurend
   halverwege een scherm achtergelaten — de bel gaat, de les gaat door, en het
   archief staat open tot iemand langsloopt; het volgende kind hoort aan het
   begin van de flow te beginnen in plaats van halverwege iemand anders zijn
   keuze. Bewust **alleen op de portaalschermen** gewapend: een open spel wordt
   nooit onderbroken, want een vierjarige die vijf minuten naar een puzzel
   staart is aan het nadenken, en dat is van buiten niet te onderscheiden van
   niets doen.
6. **Laadscherm met een drempel.** Het laadscherm verschijnt pas na 200 ms. Een
   dynamisch geïmporteerde spelmodule is er meestal eerder dan dat, en een
   laadpaneel dat één frame flitst is erger dan geen laadpaneel: dat leest als
   een storing. Alleen een laadtijd die echt lang is mag dat zeggen — en die
   krijgt dan één amberen pip die om de patrijspoort van de missie draait, de
   enige spinner in het pakket.

## 6. Spellenlijst

Gebaseerd op wat consistent hoog scoort in app-store-lijsten voor peuters/
kleuters (Sago Mini, Toca Boca, Lingokids, ElePant, jigsaw/matching-apps zoals
"Puzzle Kids" en "Kids Puzzle & Toddler Games") — de gemene deler is: grote
tastbare elementen, direct visueel/auditief succesgevoel, geen faalstatus die
als "verlies" aanvoelt, korte sessies. Zie bronnen onderaan dit document.

Alle vierentwintig spellen zitten in hetzelfde ruimtethema en hebben een
**levelprogressie** die lokaal wordt opgeslagen (zie §6b) — op de vier open
speelgoed-spellen na, die in plaats daarvan hun werk bewaren.

De archiefgeschiedenis in drie lagen: de eerste negen waren de MVP; daarna
kwamen de "eerste vijf" uit de kandidatenlijst (§6c), gebouwd ná de redesign en
dus meteen in de nieuwe huisstijl geboren; en daarna is de rest van die
kandidatenlijst afgebouwd — de tien onderaan. Daarmee is §6c leeg: elk spel dat
daar ooit is opgeschreven staat nu in deze tabel, op de vijf na die er bewust
niet komen.

De drie gaten die §6c benoemde zijn daarmee ook echt dicht. **2–4 jaar** heeft
nu vijf spellen in plaats van één. **Gelijktijdig samenspelen** heeft er zes,
waaronder één met vier stoelen. En de ontbrekende genres — muziek, tellen,
letters, logica, reactie — hebben allemaal minstens één spel; letters zelfs het
enige spel in de bundel dat écht Nederlands moet zijn om te werken.

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
| **Alien Verstoppertje**   | Verstop-en-zoek      | 2–5      | 1P & 2P | Tik een steen om en er zit een beestje onder, elk met zijn eigen animatie. Een omgekeerde steen blíjft omgekeerd — onthouden waar je al gekeken hebt is precies wat een tweejarige nog niet kan, dus doet het bord dat. Vanaf level 4 wordt het een **bekerspel**: volg de alien onder drie schuivende stenen, met elk level één schuif meer en één tel sneller. Mislukken is hier structureel onmogelijk; een misgok laat zien waar hij wél zat. |
| **Magneetstrijd**         | Touwtrekken          | 2–6      | 1P & 2P | Een satelliet hangt tussen twee tractorstralen. Niet op knoppen rammen maar **tik het paneel dat oplicht** — precies één paneel per kant is scherp, dus hameren levert niets op en het is reactie in plaats van snelheid. Vooraf kies je op een pictogramscherm wie een **voorsprong** krijgt, zodat een zevenjarige en een driejarige een eerlijke partij kunnen spelen. Alleen speel je tegen een robot die net te laat is. |
| **Maak je Maatje**        | Creatief             | 2–7      | 1P & 2P | Bouw een alien uit vier lijven, vier ogen, vier antennes, vier armen, vijf monden en twaalf kleuren. Elke keuzeknop is een **tekening van het maatje met dat onderdeel erin**, dus er valt niets te lezen. 🎲 verzint er een, 🎉 laat hem dansen en toeteren. Hij wordt bewaard via `shell/maatje.js` en duikt daarna op in andere missies — als laadmeester in Ladingcontrole en als piloot van de rover. |
| **Ladingcontrole**        | Tellen               | 3–6      | 1P & 2P | Laad *precies* N kratten in en de raket vertrekt alleen als het klopt. Elk aantal staat er twee keer — als **stippen in groepjes van vijf én als cijfer** — want dat is de brug die deze leeftijd oversteekt. Diepte: 1–5 → 1–10 → 1–20 → "er zaten er 3 in, er komen 2 bij" → meer/minder. Fout drukken laat de luik schudden en de twee aantallen naast elkaar zien; de kratten blijven staan. |
| **Sterrenpaden**          | Stip-naar-stip       | 3–6      | 1P      | Sleep van ster 1 naar 2 naar 3; het sterrenbeeld licht op en wordt een huis, vis, kroon, boot, poes, ster, raket of vlinder. Alleen de volgende ster gloeit, dus een kind dat nog niet tot tien komt weet toch waar het heen moet — de cijfers zijn er voor wie ze aan het leren is. Elke verbinding is de volgende toon omhoog, dus een afgemaakte tekening heeft onderweg een liedje gespeeld. |
| **Meteoor Meppen**        | Mollen meppen        | 3–7      | 1P & 2P | Aliens duiken op uit maankraters en je bopt ze. Eén **gedeeld** bord en één gedeelde teller: met tien vingers op het glas is er geen eerlijke manier om te zeggen wiens vinger er eerst was. De schotel is dubbele punten, en één vriendelijke poes **giechelt alleen** als je hem raakt — geen punten, ook geen straf, en precies dat maakt het kijken-voor-je-slaat. |
| **Toren Bouwen**          | Stapelen             | 3–7      | 1P & 2P | Een kraan zwaait een blok heen en weer, één tik laat het vallen. Hoe hoger de toren, hoe verder hij uit het lood komt te staan, en het **wiebelen waarschuwt** ruim voordat hij omgaat. Instorten is de grap, niet de straf: alles tuimelt weg en de kraan geeft je een nieuw blok op hetzelfde level. Een blok dat er te ver naast landt glijdt eraf en kost een beurt, nooit de toren. |
| **Raketrace**             | Race                 | 4–7      | 2P (4P) | Twee pads per raket, af te wisselen als een paar rennende benen. Alleen de **volgende** pad is scherp en licht op, dus op één pad rammen brengt je nergens: ritme in plaats van snelheid, en daarmee eerlijk over vier jaar leeftijdsverschil heen. Het aantal raketten (2, 3 of 4) kies je op het startscherm van het spel zelf; lege banen vliegt het station. |
| **Letterplaneten**        | Beginletters         | 5–7      | 1P      | Er komt een krat met 🚀 aan: tik de planeet met de **R**. Diepte: eerste letter → laatste letter → met lettertegels het hele woord spellen. Hoofdletters, want een kleine b en d zijn van twee meter afstand een valkuil. De plaatjes hebben allemaal één onmiskenbare Nederlandse naam — 🐱 (poes of kat?) staat er bewust *niet* in, want een kind dat "kat" denkt heeft geen fout gemaakt. |
| **Sterrenrij**            | Vier op een rij      | 5–7      | 1P & 2P | Laat planeten in een kolom vallen; de zwaartekracht stapelt ze. Het enige spel waarin twee kinderen tégen elkaar **nadenken**. Het bord schaalt helemaal terug naar drie-op-een-rij op 3×3 — geen uitgeklede versie, maar hetzelfde spel met een horizon die in een kinderhoofd past. Alleen speel je de stationscomputer: die pakt een winst, blokkeert een verlies, en gaat vanaf level 4 ook niet meer meteen zitten weggeven.

### Ontwerpkeuze: geen verliesstatus
Geen van de vierentwintig spellen kent "game over". Aliens die de onderkant
halen trekken zich terug naar boven; een geraakt schip wordt na een paar tellen
gerepareerd; een verloren bal komt gewoon terug in het midden; een verkeerd
geplaatst puzzelstuk zweeft terug; een verkeerde toon in Sterrenecho laat het
station het bericht herhalen; een rover die tegen een steen rijdt stuitert en
gaat door met de volgende opdracht.

De tien nieuwste spellen zijn langs dezelfde lat gebouwd, en dat was bij een
paar ervan het echte ontwerpwerk. Een toren die instort tuimelt spectaculair
weg en je krijgt een nieuw blok op hetzelfde level. Een verkeerd getelde vracht
laat de luik schudden en zet de twee aantallen naast elkaar — de kratten blijven
staan waar ze stonden. Een verkeerde letter wiebelt terug in de rij en het vakje
blijft open. Een misgok in het bekerspel laat zien waar de alien wél zat. En de
vriendelijke poes in Meteoor Meppen giechelt alleen: geen punten, maar ook geen
aftrek, want de enige prijs voor het aantikken hoort de seconde te zijn die je
eraan kwijt was.

Ook een verloren partij Maanhockey, Magneetstrijd, Raketrace of Sterrenrij telt
gewoon als een gespeelde missie: de ladder meet hoe ver je gekomen bent, nooit
hoe goed je was. Bij die vier zegt het beloningsscherm wél eerlijk wie er won —
dat is het eerste wat twee kinderen willen lezen — maar het level gaat hoe dan
ook omhoog. Er is dus altijd vooruitgang en nooit een moment waarop een kind te
horen krijgt dat het verloren heeft. Score en level gaan alleen omhoog.

**Uitbreidingen**: de kandidatenlijst in §6c is afgebouwd. Wat daar nog staat is
de lijst van vijf spellen die er bewust *niet* komen, plus de twee open keuzes
die inmiddels beslist zijn.

## 6b. Progressie en geluid

**Progressie** (`src/shell/progress.js`): elk spel schrijft het hoogst
bereikte level naar `localStorage`. Het portaal leest dat terug als een
amberen voortgangsbalk op de missierij, zodat een kind ziet hoe ver het in
elk spel is — de hub voelt daardoor als één geheel in plaats van vierentwintig
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

De vier open spellen bewaren niet een level maar het **werk zelf**: de Gekke
Machine schrijft de hele werkbank (onderdelen plus getekende banen) weg,
Ruimtetekenen de streken als vectoren, het Sterrenorkest zijn lus als acht
getallen en Maak je Maatje zijn wezen als zes getallen en twee kleuren. Alle
vier zijn zo klein dat ze in `localStorage` passen, en het scheelt het verdriet
van een half uur bouwen, tekenen of componeren dat verdwijnt zodra iemand op ◀
drukt.

Het maatje is het enige bewaarde werk dat zijn eigen spel **verlaat**.
`src/shell/maatje.js` houdt het formaat vast (zes kleine getallen en twee
kleuren, plat, geen nesting) en levert de canvas-tekening, zodat elk ander spel
het wezen kan lezen zonder te weten hoe het in elkaar zit. `getMaatje()` vult
alles aan wat mist, dus een oude of met de hand geknutselde opslag kan geen spel
laten crashen, en `hasMaatje()` vertelt of er al één gebouwd is — een kind dat
nog niet in Maak je Maatje is geweest krijgt een gewone astronaut in plaats van
het standaard groene blob, want ongevraagd opduiken als het wezen van een
vreemde verspilt de onthulling. Er is één helper die je altijd wilt gebruiken:
`drawMaatjeIn(ctx, m, cx, cy, w, h, t)`, want de tekening reikt verder boven zijn
oorsprong dan eronder (een antenne gaat tot -0,85 van de maat, een arm tot ±0,9)
en de eerste twee aanroepers sneden dus allebei de antenne van de bovenkant af.

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
- **Om-de-beurt** (Geheugenspel, Legpuzzel-race, Sterrenecho, Rover,
  Toren Bouwen, Sterrenrij): duidelijke "Astronaut 1 / 2 is aan de beurt"-badge
  in de balk, groot en met kleurcodering. Bij Sterrenecho, Rover en Toren Bouwen
  is de beurt coöperatief — je bouwt aan één gedeelde reeks, één gedeeld
  programma of één gedeelde toren, dus er is niets te winnen van elkaar.
  Sterrenrij is de enige waar je echt tegen elkaar speelt.
- **Gelijktijdig split-zone** (Ruimte Invasie, Blokken Brekker, Maanhockey,
  Magneetstrijd, Raketrace): scherm fysiek verdeeld in een linker- en
  rechterhelft (of in banen), elke speler heeft een eigen touch-zone en eigen
  kleur, zodat twee kinderen tegelijk op hetzelfde 75"-scherm kunnen spelen
  zonder elkaars input te kapen. Raketrace zet er desgevraagd vier naast elkaar.
- **Coöperatief gedeeld** (Tekenen, Zeepbellen, Sterrenorkest, Maak je Maatje,
  Meteoor Meppen, Alien Verstoppertje, Ladingcontrole): beide spelers werken vrij
  op hetzelfde vlak, geen zone-scheiding nodig — het bord neemt gewoon tien
  vingers tegelijk aan. Bij Meteoor Meppen is dat ook de reden dat er één
  gedeelde teller is in plaats van twee: met tien vingers op hetzelfde glas is er
  geen eerlijke manier om te bepalen wiens vinger er eerst was, en zo'n regel
  verzinnen betekent erover ruziën.

**De eerlijkheidsregel die de nieuwe 2P-spellen delen.** Magneetstrijd en
Raketrace zijn allebei gebouwd rond hetzelfde probleem: op een klassenbord walst
een zevenjarige die op een knop ramt zó over een driejarige heen, en de kleine
stopt met spelen. In beide spellen is daarom precies één knop per speler scherp,
en die licht amberkleurig op. Rammen op de rest levert *niets* — geen straf, ook
geen effect. Daarmee is het spel reactie (Magneetstrijd) of ritme (Raketrace) in
plaats van tiksnelheid, en dat verschil is over vier jaar leeftijd heen veel
kleiner. Magneetstrijd kan er bovendien een voorsprong bovenop leggen.

## 6c. Kandidaat-spellen (afgebouwd)

Deze lijst was de voorraad voor ná de visuele redesign: er werd niets uit
gebouwd voordat het nieuwe ontwerp stond, zodat elk nieuw spel meteen in de
nieuwe huisstijl geboren wordt in plaats van erna omgebouwd te moeten worden.
**Die voorraad is nu leeg.** Eerst de "eerste vijf", daarna de overige tien —
alle vijftien staan in de tabel van §6. Wat hieronder overblijft is het
archief van de argumentatie: welk gat elk spel vulde, wat er bewust *niet*
komt, en de twee open keuzes, die inmiddels beslist zijn.

De keuzes kwamen niet uit een wensenlijst maar uit drie gaten in de negen
spellen van de MVP:

1. **2–4 jaar was dun.** Alleen Sterrenvormen was echt op die leeftijd gemikt;
   Ruimtetekenen is open, niet gericht. → nu vijf spellen: Zeepbellen, Alien
   Verstoppertje, Magneetstrijd, Maak je Maatje en Sterrenvormen zelf.
2. **2P was vooral om-de-beurt.** Alleen Ruimte Invasie en Asteroïdenveld
   zetten twee kinderen gelijktijdig aan het bord — precies het enige wat een
   75" multi-touch paneel kan en een tablet niet. → nu ook Maanhockey,
   Magneetstrijd, Meteoor Meppen en Raketrace, die laatste met vier stoelen.
3. **Hele genres ontbraken**: muziek, tellen, letters, logica/sequencing,
   reactie. En er waren maar twee open speelgoed-spellen. → Sterrenecho en
   Sterrenorkest (muziek), Ladingcontrole en Sterrenpaden (tellen),
   Letterplaneten (letters), Rover en Sterrenrij (logica), Magneetstrijd en
   Meteoor Meppen (reactie), en Maak je Maatje als vierde open speelgoed.

### Twee kinderen gelijktijdig

- **Maanhockey** 🏒 — ✅ gebouwd, zie §6.
- **Magneetstrijd** 🧲 — ✅ gebouwd, zie §6.
- **Meteoor Meppen** 🔨 — ✅ gebouwd, zie §6.
- **Sterrenrij** 🔴 — ✅ gebouwd, zie §6.
- **Raketrace** 🏁 — ✅ gebouwd, zie §6.

### Muziek (bijna gratis in deze codebase)

- **Sterrenecho** 🔔 — ✅ gebouwd, zie §6.
- **Sterrenorkest** 🎹 — ✅ gebouwd, zie §6.

### Logica en tellen (het gat bij 5–7)

- **Rover Programmeren** 🤖 — ✅ gebouwd, zie §6.
- **Ladingcontrole** 📦 — ✅ gebouwd, zie §6.
- **Sterrenpaden** ✨ — ✅ gebouwd, zie §6.
- **Letterplaneten** 🔤 — ✅ gebouwd, zie §6.

### Voor de kleinsten (2–4)

- **Zeepbellen** 🫧 — ✅ gebouwd, zie §6.
- **Alien Verstoppertje** 🙈 — ✅ gebouwd, zie §6.
- **Maak je Maatje** 👽 — ✅ gebouwd, zie §6.
- **Toren Bouwen** 🧱 — ✅ gebouwd, zie §6.

### Wat het bouwen van de vijftien aan de gedeelde laag toevoegde

De "eerste vijf" voegden `blub`, `bass` en `drum` naast `chime` toe in
`audio.js` (alle vier op dezelfde toonladder) en een missierooster op vier
kolommen. De tien daarna hebben er dit bij gedaan — en dat is opnieuw weinig,
wat het beste bewijs is dat die laag klopt:

- **`maxPlayers` in plaats van `supportsTwoPlayers`** — zie de open keuzes.
- **`src/shell/maatje.js`** — het gedeelde maatje, formaat plus tekening.
- **Zes rijen in het missierooster** — de patrijspoort in het rooster ging van
  10vmin naar 8vmin, want vierentwintig missies in vier kolommen zijn zes rijen
  en die liepen op de oude rijhoogte van een 16:9-bord af. Vijf kolommen zou
  maar vijf rijen kosten, maar dan is een kolom op 1080p zo'n 350px en breekt
  "Rover Programmeren" over twee regels — dat kost de gewonnen rijhoogte weer en
  maakt van een scanbare lijst een muur van blokjes van twee regels.
- **Niets anders.** De tien passen op `createHud`, `showMissionComplete`,
  `setupCanvas`, `drawGlow`, `createBurst` en `progress.js` zoals die al waren.

### Beelden in plaats van zinnen

De vier jongste nieuwe spellen dwongen een regel af die eigenlijk voor het hele
pakket geldt en nu overal wordt toegepast: **een spelregel die een kind moet
kunnen volgen, wordt getekend en niet geschreven.** Een tweejarige leest niets,
en "prik alleen de blauwe bellen" is voor hen precies zo nuttig als een leeg
scherm. Zeepbellen heeft daarom nu een legenda van échte bellen — de gevraagde
kleur met een vinkje, de andere drie elk met een eigen kruisje, want één kruis
over een groepje is een stukje grammatica dat ze nog niet kennen. Meteoor Meppen
zet zijn puntenwaarde neer als één of twee vingers en de poes met een kruis.
Magneetstrijd en Raketrace laten hun opgelichte paneel in de legenda zien.
Ladingcontrole zet elk aantal zowel als stippen als als cijfer. Sterrenpaden laat
alleen de volgende ster gloeien. Bij alle vijf is de geschreven variant er nog
wel voor wie leest — maar hij is nergens de enige.

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

### Open keuzes — beslist

- **3–4 spelers? Ja, maar niet in de portal.** `supportsTwoPlayers` is nu
  `maxPlayers`, een getal, en het rooster zet dat als badge (`2P` / `4P`) op de
  missierij. De crewkeuze in §5 vraagt echter nog steeds alleen 1 of 2, en dat
  is een bewuste keuze: die vraag gaat over om-de-beurt spelen, en als de portal
  "4 astronauten" zou aanbieden dan opent drieëntwintig van de vierentwintig
  missies alsnog als 2P — dat is een keuze die niet doet wat hij belooft.
  Hoeveel raketten er op de baan staan is een eigenschap van de race, dus
  Raketrace vraagt het zelf op zijn startscherm, net zoals Ruimte Invasie zijn
  moeilijkheidsgraad vraagt. De loader klemt de gekozen crew op `maxPlayers`, en
  dat lost meteen ook het omgekeerde geval op: een bord dat op "2 astronauten"
  staat opende de solospellen met een beurtbadge die niemand kon gebruiken.
- **Gedeeld maatje tussen spellen? Ja, via `src/shell/maatje.js`.** Beslist
  vóór Maak je Maatje gebouwd werd, precies zoals hier stond dat het moest. Het
  formaat is opzettelijk saai — zes kleine gehele getallen en twee kleuren, plat
  — en `getMaatje()` vult ontbrekende velden aan, zodat een spel dat het wezen
  leest nooit kan omvallen over een oude opslag. Twee missies leunen er nu op
  (Ladingcontrole en Rover); er kunnen er zonder aanpassing meer bij. Zie §6b
  voor de reden dat `drawMaatjeIn` bestaat.

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
  fotosensitiviteit bij jonge kinderen). Twee kleuren zijn hierop nagemeten en
  bijgewerkt: `--faint` haalde 3,3:1 tegen de leegte en `.hint-line` 4,3:1,
  terwijl dat juist de kleine mono-regels zijn die van achter uit een lokaal
  gelezen worden. Nu 5,6:1 en 6,4:1, zonder dat er een tweede crème bijkomt.
- **Elke tik moet op zijn eigen knop beginnen én eindigen.** De portaalknoppen
  hingen aan een kale `pointerup`, en die vuurt op wat er onder de vinger zit op
  het moment van optillen: een hand die het bord oversteekt en ergens anders
  loslaat koos dus een missie, een crew of — het ergste geval — de terugknop
  linksboven in een spel, precies waar zo'n hand langskomt. Alles loopt nu via
  `onTap` uit `pointer.js`, dat de druk op hetzelfde element wil zien beginnen
  en niet verder dan 24 pixels wil hebben bewogen.
- **Toegankelijke motie**: "rustig" in de instellingen en de
  `prefers-reduced-motion`-voorkeur van het besturingssysteem zijn hetzelfde
  verzoek van twee verschillende mensen, dus `applyCalm()` vouwt de media query
  in hetzelfde `data-calm`-attribuut. Zo staat er één lijst met animaties in de
  stylesheet in plaats van twee die uit elkaar gaan lopen, en volgt het bord een
  omgezette systeemvoorkeur zonder herladen.

## 7b. Verificatie

Het geheel is geautomatiseerd nagelopen met een headless Chromium
(puppeteer-core tegen de systeem-Chromium) die de echte build bedient:
portaalflow doorlopen, alle spellen openen, tikken én slepen
simuleren, en per spel controleren op:

- console- en `pageerror`-meldingen (nul);
- aanraakdoelen kleiner dan 88px;
- horizontale/verticale paginaoverflow (nergens);
- een canvas dat uniform van kleur is, d.w.z. niets getekend;
- correcte opruiming bij terugnavigatie (geen achterblijvend canvas of
  lopende renderloop);
- knoppen die geheel of gedeeltelijk buiten het scherm vallen — een stage die
  buiten zijn eigen doos loopt geeft géén paginaoverflow, dus die controle mist
  het; dit is de check die het overlopende stenenveld van Alien Verstoppertje
  ving;
- het missierooster: vierentwintig rijen die op één scherm passen zonder
  scrollen, en geen titel die over twee regels breekt;
- **een afgelopen animatie die nog vooruit staat te vullen** — de check die uit
  de fill-mode-les van §2b is gegroeid, en die de volgende keer meteen aanwijst
  waarom een transition of een `:active` niets meer doet;
- **een sleep die op een knop eindigt**: de harness drukt onderaan het scherm,
  sleept naar een crewkaart en laat los, en controleert dat er *niets* gekozen
  is;
- de raket: dat hij bij het opstijgen echt klimt en zijn vlam uitslaat, gelezen
  uit de computed transform in plaats van uit een plaatje, want een headless
  screenshot landt zelden waar je hem wilt hebben;
- de typografie: dat Baloo 2 en Space Mono geladen zijn en dat er **geen enkel
  verzoek naar `fonts.googleapis.com` of `fonts.gstatic.com`** meer uitgaat;
- het beloningsscherm los van een spel, door `showMissionComplete` rechtstreeks
  uit de bron te monteren: de ring die eruit golft, het juiste aantal sterren,
  en drie knoppen die binnen het scherm vallen en de 88px halen.

Alles is op zowel 1920×1080 als 3840×2160 gemeten om de vmin-schaalregel
te bewijzen.

**Openstaand**: op 1920×1080 zitten de gereedschapsknoppen van Ruimtetekenen
(56px) en de Gekke Machine (71px) onder de 88px-richtlijn. Op het echte bord
(3840×2160) zijn ze 112 respectievelijk 142px en dus ruim in orde; ze groter
maken op 1080p zou de twee dichte werkbalken over het speelveld duwen. Bewust
zo gelaten, niet vergeten.

Naast de generieke sweep worden de nieuwe spellen ook echt *gespeeld* in de
harness — een reeks echoën in Sterrenecho, een programma laten lopen tot de
rover zijn kristal heeft, vier planeten in een kolom laten vallen, een toren van
vijf hoog stapelen, kratten inladen tot de raket groen wordt — want een spel dat
niet crasht is nog geen spel dat werkt. En de screenshots worden ook echt
*bekeken*: de helft van de bugs hieronder gaf geen enkele foutmelding.

Drie echte bugs kwamen uit de eerste ronde:

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

En vijf uit de ronde van de laatste tien spellen, waarvan er vier alleen op een
screenshot te zien waren:

4. **Afgesneden antenne** — `drawMaatje` reikt tot 0,85 van zijn maat boven zijn
   oorsprong (een antenne) en 0,9 ernaast (een arm), maar de eerste twee
   aanroepers rekenden met de maat zelf. Beide sneden de antenne van de bovenkant
   af. Opgelost met `drawMaatjeIn`, dat de doos krijgt en de maat uitrekent, plus
   een geëxporteerde `EXTENT` zodat de volgende aanroeper het niet hoeft te raden.
5. **Blok dat een halve blokhoogte doorzakte** — Toren Bouwen liet een vallend
   blok landen op `screenY(n) - BLOCK_H/2` maar tekende het gestapelde blok op
   `screenY(n)`, dus elk blok wipte op het moment van landen zichtbaar naar
   beneden. Dezelfde uitdrukking gebruiken op beide plekken.
6. **Dichtgeklapt bord** — zie de `flex: 1`-regel bij "Een nieuwe missie
   toevoegen".
7. **Drie stenen op één plek** — zie de `margin: 0 auto`-regel op dezelfde plek.
8. **Overlopend stenenveld** — twaalf stenen met een vaste `aspect-ratio` in drie
   rijen kwamen ruim boven een schermhoogte uit en de onderste rij viel eraf,
   zonder dat de pagina ging scrollen. Rijen delen nu de overgebleven hoogte
   (`grid-auto-rows: 1fr`), en de harness controleert sindsdien of knoppen buiten
   het scherm vallen.

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
  vierentwintig rijen op vier kolommen.
- Alle vierentwintig spellen als speelbare modules met polish (geluid, animatie,
  1P/2P/4P waar van toepassing): de negen van de MVP, de eerste vijf uit de
  kandidatenlijst, en de tien waarmee die lijst is afgebouwd.
- Het gedeelde maatje (`src/shell/maatje.js`), dat het wezen uit Maak je Maatje
  in andere missies laat opduiken.
- Shell-optimalisaties: fullscreen, wake lock, unified pointer input, lazy
  loading, object pooling waar relevant.
- GitHub Actions-workflow voor automatische deploy.

- Shell-polijstwerk: zelfgehoste fonts, aankomstanimaties per scherm, de
  vertrekanimatie van de raket, idle-reset op de portaalschermen, vooruitladen
  van spelmodules bij `pointerdown`, en een `manifest.webmanifest` zodat een
  tablet het bord chromeloos van zijn beginscherm kan starten.

**Later / bewust buiten scope**:
- Accounts, cloud-opslag van voortgang/scores.
- Een echte screensaver met een eigen animatie. De idle-reset van §5 stuurt het
  bord terug naar het startscherm, en dat startscherm is met zijn driftende
  sterrenveld en dobberende raket al wat een screensaver zou moeten zijn.
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
