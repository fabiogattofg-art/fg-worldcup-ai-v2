FG World Cup AI - V2 MATCH LINEUPS + AUTO FIX

Cosa cambia:
- Scheda Formazioni ora mostra le PARTITE, non una lista infinita di giocatori.
- Clic su una partita => formazioni casa/trasferta modificabili.
- Nuova scheda Cerca Giocatore.
- Auto fix: devi selezionare la partita prima di incollare URL.
- L'import automatico aggiorna davvero quella partita, marca status Ufficiali/Parziale e ricalcola Monte Carlo.
- Fallback manuale corretto.
- Reset cache + ricalcola nella scheda Best.

Deploy:
Sostituisci tutti i file nella root GitHub con questi.
Render:
Build Command: npm install
Start Command: npm start

Dopo deploy:
1. Apri la web app.
2. Vai su Best.
3. Premi "Reset cache + ricalcola" se vedi vecchi dati.
