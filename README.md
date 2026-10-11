# Sigarsjefen

Trading-bot som handler **opening range breakout** på US100 (NQ), US500 (ES), gull og olje via Capital.com, med dashboard i nettleseren.

> Start alltid på **demokonto** (lekepenger). Capital.com oppgir selv at rundt 80 % av privatkunder taper penger på CFD-er. Kjør `npm run backtest` og la boten gå på demo en god stund før du vurderer ekte penger.

## Strategien

1. De første **15 minuttene** etter åpning (`ORB_MINUTES`) er *range*: høyeste og laveste pris.
2. Lukker et helt 5-minutters lys **over** range: kjøp (long). **Under**: selg (short).
3. **Stop-loss** på motsatt side av range. **Mål** = 2 ganger risikoen (`REWARD_RISK`).
4. Maks **én handel per marked per dag**, og ingen nye handler senere enn 2 timer etter åpning.
5. Alt lukkes 15 minutter før sesjonen slutter. Boten holder aldri posisjoner over natten.

Tidene følger New York, så sommertid håndteres automatisk:

| Marked | Tilsvarer | Åpning (norsk tid) | Stenging |
|---|---|---|---|
| US100 | NQ (Nasdaq-100) | 15:30 | 22:00 |
| US500 | ES (S&P 500) | 15:30 | 22:00 |
| GOLD | GC (gull) | 14:20 | 19:30 |
| OIL_CRUDE | CL (olje) | 15:00 | 20:30 |

I noen uker i mars og oktober/november er tidene én time tidligere, fordi USA og Norge bytter til og fra sommertid på forskjellige datoer.

## Kom i gang (Windows)

1. **Lag en gratis demokonto** på [capital.com](https://capital.com).
2. Slå på **tofaktor-innlogging (2FA)** under Innstillinger.
3. Gå til **Innstillinger → API integrations → Generate new key**. Velg et passord for nøkkelen og kopier nøkkelen.
4. Last ned koden (**Code → Download ZIP**), pakk ut og dobbeltklikk **Start Sigarsjefen**.
5. Første gang åpnes `.env` i Notisblokk. Fyll inn:
   - `CAPITAL_API_KEY`: nøkkelen
   - `CAPITAL_IDENTIFIER`: e-posten din
   - `CAPITAL_API_PASSWORD`: passordet du valgte for nøkkelen

   Lagre, og dobbeltklikk **Start Sigarsjefen** igjen.
6. Dashboardet åpnes på **http://localhost:3000**. La det svarte vinduet stå åpent.

## Kommandoer

```bash
npm install        # første gang
npm run konto      # sjekk innlogging, saldo og markeder
npm run backtest   # hvordan ville strategien gått de siste 60 dagene?
npm start          # start boten og dashboardet
npm test           # kjør testene
```

### Backtest

`npm run backtest` henter historiske 5-minutters priser og kjører nøyaktig samme strategi som boten. Resultatet vises i **R**, der 1R er det du risikerer per handel (0,5 % av kontoen som standard).

- **Totalt +10R** betyr ca. +5 % av kontoen med standardinnstillingene.
- **Profit factor over 1**: gevinstene var større enn tapene. **Under 1**: strategien tapte.
- Testen er bevisst litt pessimistisk: treffes både stop og mål i samme lys, regnes det som tap.

## Risikostyring

- **`RISK_PER_TRADE_PCT`** (0,5): størrelsen regnes ut slik at du taper denne andelen av kontoen hvis stop-loss treffes.
- **`DAILY_LOSS_LIMIT_PCT`** (2): ingen nye handler resten av dagen når dagens tap når grensen.
- **`MAX_TRADES_PER_DAY`** (3): maks antall handler per dag.
- Stop-loss og mål sendes med ordren og ligger **hos Capital.com**. De virker selv om PC-en slås av.
- Er kontoen for liten for minste handelsstørrelse, hopper boten over handelen i stedet for å risikere for mye.
- Var boten av da signalet kom, går den ikke inn for sent.

## Dashboard

På **http://localhost:3000** ser du kontoverdi over tid, dagens resultat, ett kort per marked med range og pris, åpne posisjoner med **Lukk**-knapp, og alle hendelser live. Med **Pause handel** stopper du nye handler. Åpne posisjoner beholder stop og mål.

Dashboardet kan bare åpnes fra PC-en boten kjører på.

## Gå over til ekte penger

Når du har sett at strategien fungerer over tid på demo:

1. Lag en API-nøkkel på din **ekte** Capital.com-konto.
2. Sett `CAPITAL_ENV=live` og de nye nøkkelverdiene i `.env`.
3. Start boten. Den venter 10 sekunder før den begynner, så du rekker å avbryte.

## Struktur

```
src/
├── index.ts             starter boten og dashboardet
├── bot.ts               én runde: konto, signaler, ordre, lukking ved sesjonsslutt
├── markets.ts           markeder og åpningstider
├── risk.ts              posisjonsstørrelse og dagstap-grense
├── config.ts            leser og sjekker .env
├── strategy/
│   ├── orb.ts           opening range breakout (ren logikk)
│   └── backtest.ts      simulering på historiske priser
├── broker/
│   ├── types.ts         hva boten trenger fra en megler
│   └── capital.ts       Capital.com-API
├── core/
│   ├── logger.ts        hendelseslogg (data/events-*.jsonl)
│   └── time.ts          New York-tid og sommertid
├── web/                 dashboardet
└── cli/
    ├── backtest.ts      npm run backtest
    └── konto.ts         npm run konto
```
