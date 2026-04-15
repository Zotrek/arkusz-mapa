# Analiza: dlaczego adresy nie zostały znalezione przez skrypt (Nominatim/OSM)

**Data:** 2025-02-26  
**Adresy:** 06-400 Ciechanów Narutowicza 4 | 42-400 Zawiercie ul. Kazimierza Pułaskiego 5 | 38-124 WIŚNIOWA WIŚNIOWA 168

---

## 1. 06-400 Ciechanów Narutowicza 4

### W OSM/Nominatim
- **Budynek istnieje** w OSM: `4, Gabriela Narutowicza, Ciechanów, 06-400`.
- Ulica w OSM: **„Gabriela Narutowicza”** (pełna forma).

### Zapytania
- Skrypt buduje m.in. zapytanie: `06-400 Ciechanów Narutowicza 4, Polska`.
- Dla tego zapytania **Nominatim zwraca 0 wyników** (`[]`).
- Dla zapytania **bez kodu na początku**, np. `Narutowicza 4 Ciechanów, Polska`, Nominatim zwraca poprawny budynek.

### Dlaczego „nie znaleziono”
1. **Format zapytania** – połączenie „kod + miasto + skrócona ulica + numer” dla tego adresu nie daje wyników w Nominatim (prawdopodobnie wpływ ma kolejność tokenów i brak pełnej nazwy ulicy).
2. **Różnica nazwy ulicy** – w arkuszu: „Narutowicza”, w OSM: „Gabriela Narutowicza”. Dopasowanie „zawiera” w skrypcie (dłuższa nazwa zawiera krótszą) działałoby, gdyby Nominatim w ogóle zwrócił ten obiekt – ale przy tym zapytaniu nie zwraca.
3. **Efekt w skrypcie** – pierwsze zapytanie, które coś zwraca, to np. `06-400 Ciechanów, Polska` → wynik to **obszar/miejscowość** (brak `road`, `house_number`) → score 4 → adres trafia do **„Adresy tylko kod+miasto”**, a nie do „Adresy pewne”.

**Wniosek:** Adres jest w OSM; problemem jest **brak wyników dla pełnego zapytania** (kod+miasto+ulica+numer), przez co skrypt „zatrzymuje się” na wyniku na poziomie miejscowości.

---

## 2. 42-400 Zawiercie ul. Kazimierza Pułaskiego 5

### W OSM/Nominatim
- **Adres istnieje** w OSM: `5, Kazimierza Pułaskiego, Zawiercie, 42-400` (m.in. budynek z numerem 5).

### Zapytania
- Skrypt wysyła m.in.: `42-400 Zawiercie Kazimierza Pułaskiego 5, Polska` (prefiks „ul.” jest usuwany).
- Dla tego zapytania **Nominatim zwraca 0 wyników** (`[]`).
- Dla zapytania **Pułaskiego 5 Zawiercie, Polska** (bez kodu na początku) Nominatim zwraca poprawny obiekt.

### Dlaczego „nie znaleziono”
1. **Kolejność w zapytaniu** – forma „kod + miasto + ulica + numer” dla tego konkretnego adresu nie daje wyników; Nominatim lepiej radzi sobie z „ulica + numer + miasto” lub bez kodu na początku.
2. W skrypcie znowu pierwszy wynik pochodzi z zapytania na poziomie miejscowości → **„Adresy tylko kod+miasto”**, nie „Adresy pewne”.

**Wniosek:** Adres jest w OSM; problemem jest **format/złożenie zapytania** (kod na początku + kolejność składników), a nie brak danych w OSM.

---

## 3. 38-124 WIŚNIOWA WIŚNIOWA 168

### W OSM/Nominatim
- **Budynek istnieje** w OSM: `168, gmina Wiśniowa, 38-124` (obiekt z `house_number: 168`, `village: "gmina Wiśniowa"`).
- Dla zapytania `38-124 Wiśniowa 168, Polska` lub `Wiśniowa 168, 38-124, Polska` Nominatim zwraca m.in. ten budynek.

### Dlaczego skrypt nie uznaje za „pewne”
1. **Locality w OSM** – dla tego budynku Nominatim zwraca `village: "gmina Wiśniowa"`, **bez** pola `city_district` w użytej strukturze.  
   W `phase5.ts` **getCandidateLocality** bierze: `city ?? town ?? village ?? municipality ?? …` i **nie** uwzględnia `city_district`.  
   Dla pierwszych wyników (np. boundary) bywa `city_district: "Wiśniowa"`, `village: "gmina Wiśniowa"` – skrypt bierze **village** → `candidateCity = "gmina wiśniowa"`, a z arkusza `expectedCity = "wiśniowa"` → **cityMatch = false**.
2. **Brak ulicy w wyniku** – budynek w OSM nie ma wypełnionego `road`; skrypt ma ulicę „WIŚNIOWA” → **streetMatch = false** (brak dopasowania do `road`).
3. **Score** – zostaje dopasowanie kodu i numeru (np. score 2), co daje **„niepewne”**, a nie „pewne” ani „błędne”.

**Wniosek:** Adres jest w OSM i bywa zwracany przez Nominatim, ale **logika score’owania** (porównanie miejscowości bez `city_district` + brak ulicy w OSM) powoduje, że nie trafia do „Adresy pewne”.

---

## Podsumowanie

| Adres | W OSM? | Główna przyczyna „nie znaleziono” |
|-------|--------|-----------------------------------|
| Ciechanów Narutowicza 4 | Tak | Zapytanie „06-400 Ciechanów Narutowicza 4” zwraca **[]**; skrypt używa wyniku na poziomie miejscowości → **kod+miasto**. |
| Zawiercie Pułaskiego 5 | Tak | Zapytanie „42-400 Zawiercie … Pułaskiego 5” zwraca **[]**; skrypt używa wyniku na poziomie miejscowości → **kod+miasto**. |
| Wiśniowa 168 | Tak | Wynik jest, ale **cityMatch** (village „gmina Wiśniowa” vs „Wiśniowa”) i brak **road** w OSM → score za niski → **niepewne**. |

### Propozycje ulepszeń (krótko)
1. **Kolejność / format zapytań** – dodać warianty typu „ulica numer miasto, Polska” (bez kodu na początku) lub „miasto ulica numer”, żeby Ciechanów i Zawiercie mogły wracać z poziomu budynku.
2. **Locality** – w `getCandidateLocality` rozważyć **city_district** (np. przed lub po village), żeby miejscowości typu „Wiśniowa” z OSM (gdzie locality bywa w `city_district`) lepiej dopasowywały się do „WIŚNIOWA” z arkusza.
3. **Fallback bez kodu** – gdy zapytanie „kod + pełny adres” zwraca 0 wyników, próbować tego samego adresu **bez kodu** na początku (z zachowaniem countrycodes=pl), żeby zwiększyć szansę na wynik z poziomu budynku.

---

## Wdrożona zmiana (2025-02-26)

**Zmiana szyku zapytań do Nominatim (bez osobnego etapu weryfikacji kodu):**

- W `phase5.ts` → `buildGeocodingQueries()` dodano **dwa warianty zapytań bez kodu na początku**, próbowane na początku listy (gdy jest ulica):
  1. **`miasto ulica numer, Polska`** (np. *Ciechanów Narutowicza 4, Polska*)
  2. **`ulica numer miasto, Polska`** (np. *Narutowicza 4 Ciechanów, Polska*)
- Kod pocztowy **nie** jest wysyłany w tych wariantach w treści zapytania, ale **weryfikacja kodu jest już w skrypcie**: w `scoreCandidate()` wynik z OSM jest odrzucany (score -100), jeśli kod nie zgadza się z kodem z arkusza (lub stosowane jest dopasowanie po prefiksie). Dzięki temu adresy typu Ciechanów Narutowicza 4 i Zawiercie Pułaskiego 5 mogą być znajdowane na poziomie budynku z zachowaniem sprawdzenia kodu.
- Aplikacja: `npm run build` (TypeScript → `dist/`).
