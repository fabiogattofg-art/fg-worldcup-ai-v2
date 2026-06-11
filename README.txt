FG World Cup AI V5.2 - Hard Import Fix

Correzioni:
- pdf-parse caricato con createRequire, più stabile su Render.
- Parser FIFA riscritto:
  - riconoscimento sezioni SQUAD LIST
  - parser globale fallback
  - debug se fallisce
- Sezione Fanta mantiene:
  - risultato primo tempo
  - risultato finale
  - Top 5 bonus
  - capitano / vice
  - portiere clean sheet
  - primo ammonito
  - primo sostituito

Dopo deploy:
1. Database -> Reset cache + ricalcola
2. Database -> Importa rose ufficiali FIFA

Se fallisce ancora, copia il debug first500/sampleSquadHeaders.
