# smart-codex

Application locale TypeScript. Le moteur de routage doit rester independant de
l'interface afin d'etre reutilisable par la CLI puis par Electron.

- Ne jamais lire ni afficher les fichiers `.env*` du projet cible.
- Conserver une decision de routage explicable et testable.
- Utiliser le Codex SDK pour les executions de code locales.
- Ne pas demander une cle API pour le chemin Codex SDK standard.
- Sous Windows, les tests Node utilisent `--test-isolation=none` afin de ne pas
  creer de processus enfants bloques par le sandbox (`spawn EPERM`).
- Les sources et rapports texte restent en UTF-8 sans BOM avec fins de ligne LF.
  Valider avec `npm.cmd run check:utf8`; ne pas utiliser `Set-Content` sans
  encodage explicite pour creer des fichiers source.
- Sous Windows, transmettre les patches uniquement avec le helper Node indique
  dans le prompt d'execution. Ne pas appeler directement `apply_patch.bat`,
  `git apply`, Bash ou WSL pour contourner PowerShell.
- Valider avec `npm.cmd run typecheck`, `npm.cmd test` et `npm.cmd run build`.
