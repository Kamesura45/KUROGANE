# 🖼️ Les boutons peints

Quatre dessins remplacent quatre boutons du jeu :

| Fichier | Ce qu'on y voit | Bouton |
|---|---|---|
| `pause.png` | Carré bleu, deux barres, 休憩 *kyūkei* (repos) | ⏸ la pause, en course |
| `jouer.png` | Parchemin, « PLAYs », 遊ぶ *asobu* (jouer) | **JOUER**, à l'écran-titre |
| `infini.png` | Vert, « infinity Mode », 無限 *mugen* (infini) | **Course Infinity** |
| `compte.png` | Bannière verte, 戦士 *senshi* (guerrier) | **Compte**, à l'écran-titre |

Les **originaux** restent dans [`image/`](../../image), intacts. Ce dossier-ci ne
contient que les versions détourées, celles que le jeu sert.

## ⚠️ Détourer avant de poser

Les images arrivent en général avec un **fond blanc opaque**. Le canal alpha est
là, mais aucun pixel ne s'en sert — mesuré sur les quatre premières : **0 % de
transparent**, et 18 à 28 % de blanc pur. Posées telles quelles sur l'interface
sombre, elles dessinent quatre rectangles blancs.

```bash
node tools/detourer.mjs "image/mon-dessin.png" public/ui/jouer.png
```

L'outil part des **bords** et se propage : seul le blanc relié au bord s'en va.
Un blanc cerné par du dessin — le parchemin de « Jouer », la plaque grise de
戦士 — est à l'intérieur, donc il reste. Vérifié : le parchemin est identique au
pixel près avant et après.

Il **décompose** aussi les bords anticrénelés au lieu de les couper net, sans
quoi il reste un liseré pâle autour de chaque dessin. Après : **0 pixel blanc**
sur les bords des quatre.

## Remplacer un dessin

1. Dépose le nouveau fichier dans [`image/`](../../image).
2. Passe-le au détoureur vers `public/ui/<nom>.png`.
3. Recharge — rien d'autre à changer.

## Ce qui se passe si un fichier manque

**Rien de cassé.** `menu.ts` charge l'image AVANT de la poser ; si elle manque,
le bouton garde son apparence ordinaire, texte compris. Un bouton dont toute
l'apparence tiendrait dans un fichier absent serait un bouton invisible — et
l'on ne pourrait plus ni jouer, ni sortir d'une pause.
