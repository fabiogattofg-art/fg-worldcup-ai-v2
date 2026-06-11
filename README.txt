FG World Cup AI V5.6 - Local Official Database

Questa versione elimina definitivamente il parsing live del PDF.

Cosa cambia:
- 1.248 giocatori ufficiali già inclusi nel progetto.
- 48 nazionali già caricate.
- Database locale: nessun PDF, nessun Jina Reader, nessun pdf-parse.
- Il pulsante Importa rose ufficiali FIFA ora carica dal file locale official_players.json.
- Tab Ufficiali continua a confrontare solo nomi presenti nel database.

Deploy Render:
- Build Command: npm install
- Start Command: npm start

Dopo deploy:
1. Database -> Reset cache + ricalcola
2. Database -> Importa rose ufficiali FIFA

Fonte originaria del database: PDF ufficiale FIFA SquadLists-English.pdf, scaricato e convertito localmente.
