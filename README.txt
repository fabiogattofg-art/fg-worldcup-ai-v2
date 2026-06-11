FG World Cup AI V5.3 - PDFJS Import Fix

Correzione principale:
- Sostituito pdf-parse con pdfjs-dist.
- Estrazione testo pagina per pagina.
- Ricostruzione righe PDF tramite coordinate.
- Parser FIFA mantenuto su SQUAD LIST + righe GK/DF/MF/FW.

Dopo deploy:
1. Render: Clear build cache & deploy.
2. Dashboard: Database -> Reset cache + ricalcola.
3. Database -> Importa rose ufficiali FIFA.

Se fallisce, ora il debug first1000/sampleSquadHeaders sarà davvero utile.
