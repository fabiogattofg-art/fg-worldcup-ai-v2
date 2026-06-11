FG World Cup AI V5.1 - Import Fix + Fanta Fix

Cosa corregge:
- Parser FIFA più robusto per il PDF ufficiale SquadLists-English.pdf.
- Import rose ufficiali con parser a sezioni e regex.
- Sezione Fanta ripristinata:
  - risultato primo tempo
  - risultato finale
  - Top 5 bonus
  - capitano
  - vice capitano
  - portiere clean sheet
  - primo ammonito
  - primo sostituito
  - clean sheet %

Deploy Render:
- Build Command: npm install
- Start Command: npm start

Dopo deploy:
1. Vai su Database.
2. Premi Reset cache + ricalcola.
3. Premi Importa rose ufficiali FIFA.
