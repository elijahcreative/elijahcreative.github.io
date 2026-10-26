# Web Bot Auth — előkészítés és későbbi aktiválás

2026. október 26.: a nyilvános azonosítás külön, identity-only kiadásban éles. Valódi Ed25519 kulcs Vercel szerveroldali Secretként telepítve. A production directory és szolgáltatásleírás HTTP 200; az aláírás és a változatlan frontend ellenőrizve. A Cloudflare-kérelem beadva Balázs Kemenesi néven, státusza Waiting for review (01a17946-426b-76b1-9105-ab8ded7f3e92). A kimenő aláírás kikapcsolt.

## Három külön fázis

1. **Előkészítés:** kód, tesztek, nyilvános leírás tervezete és kérelemtervezet. Mindkét kapcsoló hiányzik/kikapcsolt; a cikkletöltés változatlan. A kulcskönyvtár 404-et ad, nem ál-kulcsot.
2. **Nyilvános azonosítás, külön élesítési engedéllyel:** valódi dedikált kulcs biztonságos létrehozása, Vercel szerveroldali titokként telepítése; a szolgáltatásleírás és a signed directory publikálása. Csak `WEB_BOT_AUTH_DIRECTORY_ENABLED=true`; a kimenő aláírás továbbra is kikapcsolt. A működő production URL és aláírás ellenőrzése után kerülhet sor a külön jóváhagyott Cloudflare-kérelemre.
3. **Csak Cloudflare-elfogadás és új jóváhagyás után:** `WEB_BOT_AUTH_ENABLED=true` a Vercelen. Végül valódi, szerveroldali Telex-tesztek. Sikertelen hozzáférés esetén a kimenő kapcsoló visszakapcsolandó kikapcsolt állapotba; az azonosítás önmagában nem megoldás.

## Konfiguráció

| Név | Hol? | Szerep |
|---|---|---|
| `WEB_BOT_AUTH_DIRECTORY_ENABLED` | Vercel, az adott környezetben | Csak a nyilvános signed directory bekapcsolása; kizárólag a `true` érték aktív. |
| `WEB_BOT_AUTH_ENABLED` | Vercel, az adott környezetben | Csak a Telexnek szánt kérések aláírása; kizárólag a `true` érték aktív. |
| `FLUX_BOT_PRIVATE_KEY_JWK` | Vercel szerveroldali Secret | Dedikált Ed25519 privát JWK. Nem kerülhet kliensoldali JS-be, Gitbe vagy naplóba. |

A privát kulcs egy helyen marad, a Vercelnél. A Worker csak a már hitelesített Vercel-kérés három, Telexnek szánt nyilvános aláírásfejlécét továbbítja. Aláírt üzemmódban mindkét meglévő relébeállítás kötelező, közvetlen kerülőút nincs. Az aláírásfejlécek módosítása vagy eltávolítása is érvényteleníti a relé HMAC-hitelesítését. A meglévő `TELEX_RELAY_SECRET` és a relé hitelesítése megmarad; nem helyettesíti és nem is azonos a Web Bot Auth-tal. Pixaluma erőforrása nem változik.

## HTTP és kulcskezelés

- Kötelező nyilvános útvonal: `/.well-known/http-message-signatures-directory`, HTTPS-en, átirányítás nélkül.
- A directory az aktuális kérés authority-jához kötött signed response-t ad. Production és az aktuális `VERCEL_URL` elfogadott; tetszőleges Host nem.
- A JSON csak nyilvános kulcsadatot adhat vissza; a privát `d` mezőt soha.
- A `Signature-Agent` a production identitásra mutat. Az előnézet nem állíthatja, hogy a production identitás már ellenőrzött.
- A kapcsolók kikapcsolt állapotában nincs új identitásfejléc és nincs szükség kulcsra. Bekapcsolt, hibás konfigurációnál általános hiba legyen, titok nélkül.
- Kulcsforgatáskor külön ellenőrzés és Cloudflare-bejegyzés-frissítés szükséges; egy új kulcs puszta létrehozása nem frissíti az elfogadott azonosságot.

## Visszaállítás

Először `WEB_BOT_AUTH_ENABLED` kikapcsolása; ez állítja vissza a korábbi kimenő Telex-fejléceket. A nyilvános leírás maradhat, a directory külön kapcsolható ki. Egy környezeti változó módosítása a Vercelnél új deploymentet is igényelhet, ezért a ténylegesen kiszolgált változatot mindig ellenőrizni kell.

## Előkészítési ellenőrzések

- Valódi, ideiglenes tesztkulcsos aláírás- és visszaellenőrzés; módosított tartalom vagy authority elutasítása.
- Directory/outbound kapcsolók függetlensége és hibás kulcs kezelése.
- A HMAC-közvetítő változatlanul elutasítja a jogosulatlan kéréseket.
- A Worker csak teljes, megengedett azonosságfejléc-csomagot továbbít, relé-hitelesítési titkot nem.
- Más kiadók lekérése, a mentett beállítások és a Flux klienskódja változatlan.
- Preview külön stagingből, a szokásos helyi beállítás-importtal. A generált preview-bootstrap nem kerülhet éles kiadásba.

A valódi kulcs létrehozása, titokként telepítése és a production directory publikálása a felhasználó „adjuk be” jóváhagyásával elkészült. A kérelmet beküldtük, a Cloudflare elbírálása még folyamatban. Az előkészítési tesztek nem bizonyítják, hogy a Telex átengedné az aláírt kérést.

## Kéréskezelési kiadás — 2026-10-26

A felhasználó jóváhagyta a takarékos kéréskezelés élesítését. Ez a kliens és a dedikált Flux Worker kiadása; a kimenő Web Bot Auth kapcsoló továbbra is false. Az új közvetítő már tudja továbbítani a később engedélyezett aláírásokat, de jelenleg nem küldünk ilyeneket. A meglévő nyilvános directory kulcsa megmarad.
