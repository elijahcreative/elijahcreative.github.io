# Flux Vercel verzio

Ez a mappa a Vercelre szant kulon valtozat. Az eredeti projektfajlok egy szinttel feljebb valtozatlanul megmaradnak.

## Fajlok

- `index.html`: a Flux frontend, valtozatlanul atmasolva.
- `flux-config.json`: a jelenlegi forrasbeallitasok masolata.
- `api/article.js`: Vercel Function a cikkolvaso szerveroldali kivonatolasahoz.
- `vercel.json`: minimalis Vercel konfiguracio.
- `package.json`: kenyelmi parancsok.

## Elso telepites

```bash
npm i -g vercel
cd "flux-vercel"
vercel login
vercel
```

Az elso `vercel` parancs kerdez par dolgot. Altalaban ezek jok:

- Set up and deploy? `Y`
- Which scope? a sajat fiokod
- Link to existing project? `N`
- Project name? `flux` vagy amit szeretnel
- In which directory is your code located? `.`
- Want to modify settings? `N`

## Publikus eles verzio

```bash
cd "flux-vercel"
vercel --prod
```

Ez adja azt a linket, amit masokkal is meg tudsz osztani.
