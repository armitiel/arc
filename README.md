# ARC – podgląd muralu

Strona podglądowa muralu: wizualizacja wzoru oraz interaktywny model 3D wnętrza ze sklepieniem (three.js, wypalone lightmapy z Blendera). Strzałkami lewo/prawo przełącza się wzory na ścianie S.

Strona jest statyczna – nie ma kroku budowania. Przy każdym pushu do `main` workflow `.github/workflows/pages.yml` publikuje folder `Model_3D_mural/web` na GitHub Pages: https://armitiel.github.io/arc/

## Uruchomienie lokalnie

```
cd Model_3D_mural/web
npm install
npm start
```

Strona będzie pod http://localhost:8765. Folder `web` można też otworzyć dowolnym serwerem statycznym – wszystkie pliki, łącznie z three.js, są w repozytorium.

## three.js

Wersja three.js jest ustawiona w `package.json`. Strona korzysta z kopii w `web/vendor/three` (tylko potrzebne, zminifikowane pliki). Po zmianie wersji:

```
npm install
npm run vendor
```

## Wzory

Wzory ściany S (`web/wzory/*.webp` + `psd.json`) są eksportowane z PSD skryptem `eksport_wzorow_www.py`. Pliki źródłowe (scena Blendera, PSD, skrypty) nie są częścią repozytorium.