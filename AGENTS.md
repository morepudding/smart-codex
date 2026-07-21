# smart-codex

Application locale TypeScript. Le moteur de routage doit rester independant de
l'interface afin d'etre reutilisable par la CLI puis par Electron.

- Ne jamais lire ni afficher les fichiers `.env*` du projet cible.
- Conserver une decision de routage explicable et testable.
- Utiliser le Codex SDK pour les executions de code locales.
- Ne pas demander une cle API pour le chemin Codex SDK standard.
- Valider avec `npm.cmd run typecheck`, `npm.cmd test` et `npm.cmd run build`.
