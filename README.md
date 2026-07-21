# smart-codex

Application locale TypeScript qui lit le contexte d'un projet, explique sa
decision de routage, puis execute la demande avec le Codex SDK.

## Interface Electron

Lancer l'application depuis n'importe quel terminal:

```powershell
smart-codex-app
```

Ou depuis la racine du projet:

```powershell
npm.cmd run desktop
```

Dans la fenetre, ecrire la demande, choisir le dossier projet, puis cliquer sur
`Lancer`. La decision du routeur apparait avant le resultat Codex.

## CLI

```powershell
smart-codex "Ajoute une page profil" --project C:\RomainOpen\TechPortal
smart-codex "Analyse cette architecture" -p C:\RomainOpen\fedora --dry-run
smart-codex "Corrige cette faute" -p C:\RomainOpen\TechPortal --json
```

| Route | Modele | Effort | Agents |
| --- | --- | --- | --- |
| `luna-low` | `gpt-5.6-luna` | `low` | 1 |
| `terra-medium` | `gpt-5.6-terra` | `medium` | 1 |
| `sol-high` | `gpt-5.6-sol` | `high` | 1 |
| `sol-xhigh` | `gpt-5.6-sol` | `xhigh` | 2 |

La route a deux agents execute un agent principal, une revue independante en
lecture seule, puis un dernier passage de correction. Les ecritures ne sont
jamais concurrentes.

## Developpement

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run desktop:smoke
```

Le moteur (`project-context`, `router`, `codex-runner`) reste independant de la
CLI et d'Electron. Le renderer n'a pas acces a Node; seules les trois operations
necessaires sont exposees par le preload isole.

