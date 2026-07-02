# DataLad Desktop – Präsentation

---

## Folie 1 — Das Problem: Wissenschaftliche Daten sind schwer zu verwalten

- Forschungsdatensätze wachsen, ändern sich laufend und werden zwischen Teams und Institutionen geteilt
- Ohne Versionskontrolle: überschriebene Dateien, kein Änderungsprotokoll, „final_v3_ECHT.csv"-Chaos
- Reproduzierbarkeit erfordert zu wissen, *welche* Daten, welcher Code und welche Parameter ein Ergebnis erzeugt haben
- Nachvollziehbarkeit (Provenance) wird von Zeitschriften und Fördergebern zunehmend verlangt

---

## Folie 2 — DataLad: Versionskontrolle für die Wissenschaft

- Aufgebaut auf Git + git-annex – verfolgt *was*, *wann*, *von wem* und *warum* etwas geändert wurde
- Verwaltet große Binärdateien (MRT-Scans, Videos, Archive), die Git allein nicht bewältigen kann
- Unterstützt verschachtelte Datensätze (Superdatensätze) – Teilprojekte mit festgepinnten Versionen verknüpfen
- Ermöglicht reproduzierbare Analysen: Pipeline auf einem exakten Daten-Snapshot erneut ausführen
- Verteilte Speicherung: Daten können auf einem Server, S3 oder beim Kollegen liegen; Metadaten bleiben schlank

---

## Folie 3 — Die Hürde: Die Kommandozeile ist nicht für alle

- DataLad ist mächtig – aber mit über 50 CLI-Unterbefehlen und Git-Interna verbunden
- Die meisten Forschenden sind keine Softwareentwickler; die Lernkurve blockiert die Nutzung
- Typische Stolpersteine: Staging-Bereich, Remote-Syntax, Annex-Semantik, Merge-Konflikte
- Folge: Teams greifen auf gemeinsame Ordner, Dropbox oder gar keine Versionierung zurück

---

## Folie 4 — DataLad Desktop: GUI, die nicht im Weg steht

- Visuelle Arbeitsbaum-Ansicht – geänderte Dateien auf einen Blick, ohne Kommandozeile
- Checkpoints mit einem Klick speichern: kurze Nachricht schreiben, Dateien auswählen, fertig
- Große Annex-Dateien auf Abruf herunterladen – nur was wirklich gebraucht wird
- Mit Kollaborierenden synchronisieren ohne Remote- oder Branch-Syntax auswendig zu lernen
- Time Machine – Commit-Verlauf durchsuchen, Änderungen je Commit einsehen, von jedem früheren Stand einen neuen Branch erstellen
- Gitignore-Verwaltung, Branch-Erstellung und Unterstützung verschachtelter Teildatensätze – alles in der Oberfläche
- Installer für macOS und Windows; kein eigenes Git/Python-Setup nötig
