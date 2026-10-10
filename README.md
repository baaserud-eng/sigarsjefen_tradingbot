# Sigarsjefen

Solana memecoin-bot som skanner nye tokens, sjekker dem for rug-risiko, kopierer de mest lønnsomme traderne og styrer risikoen automatisk.

> **Status:** kan handle, og har et dashboard i nettleseren. Boten finner nye tokens på DexScreener, sjekker dem for rug-risiko, kjøper via Jupiter og selger ved stop-loss, take-profit eller tidsgrense. Reddit, X, pump.fun og FOMO-copytrade kommer senere.

## Raskeste start (Windows)

Last ned koden (**Code** → **Download ZIP**), pakk den ut og dobbeltklikk **Start Sigarsjefen.bat**. Den installerer Node.js og pakkene hvis de mangler, starter boten i DRY RUN og åpner dashboardet.

## Kom i gang

Du trenger [Node.js](https://nodejs.org) versjon 20 eller nyere.

```bash
npm install
npm test
```

### 1. Lag en bot-wallet

```bash
npm run wallet:new
```

Dette lager `.env` (hvis den ikke finnes), lager en helt ny wallet og lagrer private key der. Adressen skrives ut. **Ta backup av `.env`**: mister du filen, mister du pengene.

### 2. Kjør i DRY RUN først

`.env` har `DRY_RUN=true`. Da gjør boten alt på ekte, bortsett fra å sende transaksjoner: den skanner, sjekker, henter ekte priser fra Jupiter og "kjøper" og "selger" med en simulert saldo.

```bash
npm start
```

La den gå noen timer. Hvis den simulerte saldoen går ned, vil den ekte også gjøre det.

### 3. Send SOL til walleten

Send et lite beløp fra Phantom eller en børs til adressen fra steg 1. Sjekk saldoen:

```bash
npm run wallet
```

### 4. Test ekte kjøp og salg

```bash
npm run swaptest
```

Bytter 0.002 SOL til USDC og tilbake. Koster rundt 0.0005 SOL og viser at transaksjonene går gjennom.

### 5. Skru på LIVE

Sett `DRY_RUN=false` i `.env` og start boten:

```bash
npm start
```

Boten venter 10 sekunder før den starter, så du rekker å avbryte med `Ctrl+C`. Stopper du boten, blir åpne posisjoner liggende i walleten og sjekkes igjen neste gang den starter.

## Dashboard

Når boten kjører, åpner du **http://localhost:3000** i nettleseren. Der ser du:

- saldo over tid, gevinst/tap og treffprosent
- åpne posisjoner med verdi og PnL, og en **Selg**-knapp for hver
- skanner-kart over alle tokens boten har sjekket den siste timen
- alle hendelser live, og hvor mye av dagens tapsgrense som er brukt
- knapp for å **pause kjøp** (åpne posisjoner passes fortsatt på)

Dashboardet kan bare åpnes fra samme PC som boten kjører på. Det skal ikke legges ut på nettet, fordi det styrer en wallet med ekte penger. Port endres med `WEB_PORT` i `.env`.

### Sjekk en token manuelt

```bash
npm run check <mint-adresse>
```

## Sikkerhet

- **`DRY_RUN=true` er standard.** Boten later bare som den handler. Sett `DRY_RUN=false` først når du har sett at strategien fungerer.
- **`.env` skal aldri pushes.** Den inneholder private key til bot-walleten og står i `.gitignore`.
- **Bruk en egen bot-wallet** med bare det beløpet du er villig til å tape.
- I LIVE-modus venter boten 10 sekunder før den starter, så du rekker å avbryte med `Ctrl+C`.

## Slik vurderes en token

Hver token starter på 100 poeng og får trekk for funn. Kritiske funn gir alltid avslag.

| Sjekk | Trekk | Type |
|---|---|---|
| Mint authority er på | 40 | Kritisk |
| Freeze authority er på | 40 | Kritisk |
| Farlige Token-2022-utvidelser (permanent delegate, transfer hook, m.fl.) | 40 | Kritisk |
| Ingen pool med likviditet | 40 | Kritisk |
| Topp-10 holdere over grensen (over 1,5x grensen) | 20 (35) | Advarsel |
| Likviditet under grensen (under halve grensen) | 20 (35) | Advarsel |
| Pool yngre enn 10 minutter | 5 | Info |

Pooler, bonding curves og andre program-eide kontoer telles ikke som holdere.

## Risikoregler

Styres fra `.env`:

- **`MAX_SOL_PER_TRADE`**: maks innsats per handel
- **`DAILY_LOSS_LIMIT_PCT`**: boten stopper alle nye kjøp resten av dagen (UTC) når tapet når denne grensen. Én handel er aldri større enn det som er igjen av grensen. Med 1 SOL og 5 % blir hver handel derfor maks 0.05 SOL.
- **`MAX_OPEN_POSITIONS`**: maks antall åpne posisjoner samtidig
- **`STOP_LOSS_PCT`** og **`TAKE_PROFIT_PCT`**: selg ved så mye tap eller gevinst. Memecoins kan falle mer enn stop-loss mellom to sjekker, så et tap kan bli større.
- **`MAX_HOLD_MINUTES`**: selg uansett etter så mange minutter
- **`MIN_SOL_RESERVE`**: SOL som alltid blir igjen til gebyrer

En token som ikke lenger har noen pris (typisk etter en rug) regnes som tapt etter 6 forsøk på rad.

Tilstanden lagres i `data/state-live.json` (og `data/state-dryrun.json` for simulering), så en omstart nullstiller ikke dagstapet.

## Struktur

```
src/
├── index.ts            hovedløkke: skann -> sjekk -> kjøp, og sjekk posisjoner -> selg
├── trader.ts           kjøps- og salgslogikk
├── config.ts           leser og validerer .env
├── scanner/
│   └── dexscreener.ts  nye og boostede Solana-tokens
├── exec/
│   └── jupiter.ts      kjøp og salg via Jupiter
├── web/
│   ├── server.ts       dashboard-server (bare localhost)
│   ├── dashboard.html  selve nettsiden
│   └── equity.ts       saldo over tid
├── core/
│   ├── logger.ts       logger alle hendelser til data/events-*.jsonl
│   └── wallet.ts       bot-wallet og saldo
├── safety/
│   ├── fetchFacts.ts   henter token-data fra Solana RPC og DexScreener
│   └── score.ts        poengregler
├── risk/
│   └── riskManager.ts  risikostyring og dagstap-grense
└── cli/
    ├── check.ts        npm run check <mint>
    ├── wallet.ts       npm run wallet / wallet:new
    └── swapTest.ts     npm run swaptest
```

## Neste steg

1. **Flere kilder:** pump.fun, Reddit og X
2. **Copytrade:** følge topp-wallets fra FOMO
3. **Varsler:** Telegram-melding ved kjøp, salg og stopp
