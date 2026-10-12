# KUROGANE

Runner 3D en TypeScript (Three.js côté client, Colyseus + Postgres côté serveur).
Le dépôt a une règle avant toute autre : **avant d'optimiser, on mesure.**

## Première action de chaque session

**Ouvre le panneau dev** — c'est la planche à dessin du projet :

```
http://localhost:5173/dev.html
```

En PowerShell :

```powershell
Start-Process "http://localhost:5173/dev.html"
```

Garde-elle ouverte pendant toute la session. Elle donne accès aux bancs
(`anims`, `nav`, `torii`, `plateformes`, `mur`, `infini`, `glissade`, `sprint`,
`bambous`, `menu`, `fuites`, `image`, `journal`, le catalogue des sorts…), et
c'est aussi là qu'on **mesure** avant de toucher à quoi que ce soit.

- Ne jamais ouvrir le jeu via `http://192.168.1.194:5173` : cette origine
  n'est pas dans `ORIGINES`, la sonde réseau tombe sur le CORS et le compteur
  des connectés reste muet. **`localhost:5173` uniquement.**
- Si Vite n'est pas lancé : `npm run dev` à la racine. S'il est déjà sur le
  port, Vite ouvrira sur 5174 — alors il faut tuer l'ancien ou changer
  d'origine.
- Ces pages **ne partent pas en production** : Vite ne construit que
  `index.html`.

## Ce qui mérite d'être su avant de coder

- **Le dépôt français** : commentaires de code, messages de commit et README
  sont en français.
- **Windows, PowerShell 5.1, non-admin.** Pas d'opérateur `??` ni de ternaire
  (erreur de parse), `$` obligatoire sur les paramètres de fonction, écrire
  les scripts dans un fichier puis `powershell -File`.
- **Chaque appel shell est vierge.** Préfixer systématiquement :

  ```powershell
  $env:PATH = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
  ```

  Sans ça, `node`, `git` et `npx` n'existent pas. Et `git` écrit sur stderr →
  filtrer avec `Select-String` (sinon PowerShell lève un `NativeCommandError`).
- **Le code de production est en anglais**, les noms des symboles du jeu aussi.
  Le français est réservé aux commentaires et à l'UI.
- **Jamais de `Co-Authored-By`** dans les commits, et **jamais de commit sans
  demande explicite**. Messages de commit en français, ASCII seul, deux clauses
  liées par « et ».
- Branche courante : `feat/addon+réquipe` — contient un `é`, donc
  **`git push` nu**, jamais de nom de branche. Fast-forward `main` via
  `git push origin HEAD:main` puis `git fetch origin main:main`.
- Machine de dev : Phenom II X4 955 / 8 Go / **HDD** / NVIDIA GT 320. Une
  build de 15 s est normale ; ne pas « optimiser » le build.

## Vérifier un changement

```powershell
npx tsc --noEmit                                          # client
cd server; npx tsc --noEmit --project server/tsconfig.json
npm run build
npm run <banc>                                            # voir dev.html
```

Les 13 bancs sont listés dans `dev.html`. Un changement qui casse un banc doit
le dire, pas le cacher.
