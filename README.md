# ARC – podgląd muralu

Strona podglądowa muralu: wizualizacja wzoru oraz interaktywny model 3D wnętrza ze sklepieniem (three.js, wypalone lightmapy z Blendera). Strzałkami lewo/prawo przełącza się wzory na ścianie S.

Strona jest publikowana automatycznie na GitHub Pages przy każdym pushu do `main` (`.github/workflows/pages.yml`):
https://armitiel.github.io/arc/

## Uruchomienie lokalnie

Wszystkie zależności (three.js r180) są w `Model_3D_mural/web/vendor`, więc nie trzeba nic instalować:

```
cd Model_3D_mural/web
npm start
```

Następnie otwórz http://127.0.0.1:8765 (wymaga Pythona; dowolny statyczny serwer też zadziała).

Pliki źródłowe (scena Blendera, PSD, skrypty) nie są częścią repozytorium.
