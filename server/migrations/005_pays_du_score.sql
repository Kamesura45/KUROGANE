-- ————————————————————————————————————————————————————————————
--  005 — D'où vient le coureur
-- ————————————————————————————————————————————————————————————
--
-- Deux colonnes pour que le classement puisse se lire par pays, puis par
-- département / région / ville.
--
-- ⚠️ NULLABLES, ET SANS VALEUR PAR DÉFAUT. Les temps déjà enregistrés n'ont
-- aucune origine, et il ne faut PAS leur en inventer une : les ranger d'office
-- sous un pays ferait mentir tous les classements régionaux dès le premier jour.
-- Un filtre les écarte, ce qui est la vérité — on ne sait pas d'où ils viennent.
--
-- ⚠️ Le pays et la région sont DÉCLARATIFS. Ils viennent du client, qui les lit
-- d'un réglage local que le joueur choisit lui-même, sans compte. Rien ne les
-- vérifie et rien ne le peut : c'est une façon de se présenter, pas une preuve
-- de résidence. Le classement par pays est donc un jeu, pas un recensement.
--
-- Longueurs : le pays est un code ISO à 2 lettres ; la subdivision est un nom
-- affichable (« 29 Finistère », « Hokkaidō »), borné pour qu'un client modifié
-- ne puisse pas y ranger un roman.

alter table scores add column if not exists pays   text;
alter table scores add column if not exists region text;

-- Le filtre le plus courant : « les meilleurs de ce pays, sur cette longueur ».
-- Sans index, chaque consultation relirait toute la table.
create index if not exists scores_pays_idx on scores (longueur, pays, temps_ms);
