# Zasady dla agentów

Nad tym folderem pracuje równolegle kilku agentów. Repozytorium: https://github.com/armitiel/arc (gałąź `main`).
Każdy push do `main` od razu wdraża stronę na Vercel (arc-alpha-lake.vercel.app), a inne gałęzie dostają osobny adres podglądu.

## Co jest w repo

Tylko strona podglądowa: `Model_3D_mural/web` + `README.md`, `AGENTS.md`, `vercel.json`, `.github/`.
`.gitignore` to lista dozwolonych plików – nowy plik strony trzeba w nim dopisać (`!/ścieżka`), inaczej nie trafi do repo.
Scena Blendera, PSD i skrypty Pythona zostają tylko lokalnie.

## Praca równoległa

1. **Jeden plik – jeden agent.** Zanim zaczniesz edytować plik, sprawdź `git status` i datę modyfikacji. Jeśli plik zmienił się w ciągu ostatnich ~10 minut i to nie Ty, ktoś nad nim pracuje – nie edytuj go, zapytaj użytkownika.
2. **Commituj tylko swoje pliki, wymieniając je z nazwy:** `git add ścieżka/pliku`. Nigdy `git add -A`, `git add .` ani `git commit -a`.
3. **Sprawdź, co commitujesz:** `git diff --cached` przed commitem. Jeśli w pliku są cudze zmiany, nie commituj go – zgłoś to użytkownikowi.
4. **Przed pushem:** `git pull --rebase origin main`. Nie używaj `git push --force` na `main`.
5. **Większe zmiany** (nowy wygląd, przebudowa `viewer.js`) rób na osobnej gałęzi, np. `agent/<nazwa>-<temat>`, i sprawdź podgląd z Vercela przed scaleniem do `main`.
6. **Nie usuwaj i nie przenoś cudzych plików**, nie cofaj cudzych commitów bez zgody użytkownika.

## Strona – szybkie fakty

- Bez kroku budowania. Lokalnie: `cd Model_3D_mural/web && npm install && npm start` → http://localhost:8765
- three.js jest w `web/vendor/three` (pliki .min). Zmiana wersji: zmień ją w `package.json`, potem `npm install && npm run vendor`.
- Wzory ściany S: `web/wzory/*.webp` + `psd.json`, generowane przez `eksport_wzorow_www.py` z PSD. Muszą mieć kanał alfa (shader go używa).
- Po zmianie sprawdź, czy strona się ładuje bez błędów w konsoli i czy działa przełączanie wzorów.