# Sigarsjefen

Solana memecoin-bot som skanner nye tokens, sjekker dem for rug-risiko, kopierer de mest lønnsomme traderne og styrer risikoen automatisk.

> **Status:** grunnmur. Konfig, sikkerhetssjekk av tokens og risikostyring er på plass. Skanner, copytrade og kjøp/salg via Jupiter kommer i neste steg.

## Kom i gang

Du trenger [Node.js](https://nodejs.org) versjon 20 eller nyere.

```bash
npm install
cp .env.example .env     # på Windows: copy .env.example .env
npm test                 # kjører testene
npm start                # starter boten (DRY RUN som standard)
```

### Sjekk en token manuelt

```bash
npm run check <mint-adresse>
```

Eksempel på svar:

```
$BONK  score 100/100  GODKJENT  (grense 70)
  Ingen funn.
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
- **`DAILY_LOSS_LIMIT_PCT`**: boten stopper all handel resten av dagen (UTC) når tapet når denne grensen. Innsatsen krympes også automatisk slik at én handel ikke kan bryte grensen.
- **`MAX_OPEN_POSITIONS`**: maks antall åpne posisjoner samtidig
- **`STOP_LOSS_PCT`** og **`TAKE_PROFIT_PCT`**: brukes når kjøp/salg kobles på

Tilstanden lagres i `data/state.json`, så en omstart nullstiller ikke dagstapet.

## Struktur

```
src/
├── index.ts            hovedløkke
├── config.ts           leser og validerer .env
├── core/
│   ├── logger.ts       logger alle hendelser til data/events.jsonl (for dashboardet)
│   └── wallet.ts       bot-wallet og saldo
├── safety/
│   ├── fetchFacts.ts   henter token-data fra Solana RPC og DexScreener
│   └── score.ts        poengregler
├── risk/
│   └── riskManager.ts  risikostyring og dagstap-grense
└── cli/
    └── check.ts        npm run check <mint>
```

## Neste steg

1. **Skanner:** nye tokens fra pump.fun, Reddit og X
2. **Copytrade:** følge topp-wallets fra FOMO
3. **Executor:** kjøp og salg via Jupiter, med stop-loss og take-profit
4. **Rapportering:** Telegram-varsler og kobling til dashboardet
