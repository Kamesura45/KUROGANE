# ⏸ Le bouton peint

Un seul dessin est utilisé par le jeu :

| Fichier | Ce qu'on y voit | Bouton |
|---|---|---|
| `pause.png` | Carré bleu, deux barres, 休憩 *kyūkei* (repos) | ⏸ la pause, en course |

Il y en a eu quatre — Jouer (遊ぶ), Course Infinity (無限) et Compte (戦士) —
mais l'idée a été abandonnée. Ces trois boutons sont revenus au texte.

Les **originaux** des quatre restent dans [`image/`](../../image), intacts, au cas
où l'envie reviendrait. Ce dossier-ci ne contient que ce que le jeu sert.

## ⚠️ Détourer avant de poser

Les images arrivent en général avec un **fond blanc opaque**. Le canal alpha est
là, mais aucun pixel ne s'en sert — mesuré sur les quatre premières : **0 % de
transparent**, et 18 à 28 % de blanc pur. Posées telles quelles sur l'interface
sombre, elles dessinent des rectangles blancs.

```bash
node tools/detourer.mjs "image/mon-dessin.png" public/ui/pause.png
```

L'outil part des **bords** et se propage : seul le blanc relié au bord s'en va.
Un blanc cerné par du dessin est à l'intérieur, donc il reste. Il **décompose**
aussi les bords anticrénelés au lieu de les couper net, sans quoi il subsiste un
liseré pâle tout autour.

## En ajouter un autre

1. Dépose le fichier ici, détouré.
2. Ajoute une ligne à la table `ART` dans `peindre()` (`src/menu.ts`).

⚠️ **N'y laisse pas d'entrée sans fichier.** Chaque ligne déclenche une requête :
une entrée orpheline, c'est un 404 à chaque ouverture du jeu, dans la console de
quiconque cherchera un vrai problème.

## Ce qui se passe si le fichier manque

**Rien de cassé.** `menu.ts` charge l'image AVANT de la poser ; sans elle, le
bouton garde son apparence ordinaire, texte compris. Un bouton dont toute
l'apparence tiendrait dans un fichier absent serait un bouton invisible — et
l'on ne pourrait plus sortir d'une pause.
