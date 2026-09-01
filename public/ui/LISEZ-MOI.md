# 🖼️ Les boutons peints

Dépose ici les quatre images, **sous ces noms exacts** :

| Fichier | Ce qu'on y voit | Bouton remplacé |
|---|---|---|
| `pause.png` | Carré bleu, deux barres, 休憩 *kyūkei* (repos) | ⏸ la pause, en course |
| `jouer.png` | Parchemin, « PLAYs », 遊ぶ *asobu* (jouer) | **JOUER**, à l'écran-titre |
| `infini.png` | Vert, « infinity Mode », 無限 *mugen* (infini) | **COURSE SANS FIN** |
| `compte.png` | Bannière verte, 戦士 *senshi* (guerrier) | **Compte**, à l'écran-titre |

`.png` de préférence, avec **fond transparent** : les boutons se posent sur des
écrans sombres, et un fond blanc autour du dessin se verrait comme un rectangle.
`.webp` marche aussi — il faut alors changer l'extension dans `menu.ts`.

## Pourquoi ce dossier plutôt qu'un autre

`public/` est recopié tel quel dans le site : le chemin `/ui/jouer.png` marchera
en développement comme en production, sans passer par le compilateur.

## Ce qui se passe si un fichier manque

**Rien de cassé.** Chaque image est chargée avant d'être posée ; si elle manque,
le bouton garde son apparence actuelle — texte, couleur, bordure. Un bouton dont
toute l'apparence tiendrait dans un fichier absent serait un bouton invisible, et
c'est précisément ce qu'il ne faut pas.

Tu peux donc en déposer une seule et voir le résultat tout de suite.
