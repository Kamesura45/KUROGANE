-- ————————————————————————————————————————————————————————————
--  004 — Deux coloris de plus, pensés pour les CORNES et les OREILLES
-- ————————————————————————————————————————————————————————————
--
-- ⚠️ LA RÈGLE INTANGIBLE TIENT TOUJOURS : on ne vend QUE de l'apparence, et
-- surtout PAS les ornements de tête eux-mêmes. Les cornes et les oreilles
-- décident du style du guerrier perso (cf. CUSTOM_STYLE dans src/roster.ts) :
-- les vendre reviendrait à vendre un passif, donc de la puissance. Elles
-- restent gratuites, et le resteront.
--
-- Ce qu'on ajoute ici, ce sont deux COULEURS de plus. Elles n'ouvrent aucun
-- ornement, ne changent aucun réglage de jeu, et s'appliquent au bandeau comme
-- au corps — comme les huit précédentes.
--
-- 🎯 POURQUOI « pour les cornes et les oreilles » : dans le maillage, les deux
-- ornements sont taillés dans `matAccent`, c'est-à-dire la couleur du BANDEAU
-- (cf. roster.ts). Une teinte de bandeau est donc, littéralement, la teinte de
-- ses cornes ou de ses oreilles. Ces deux-là sont choisies pour ça : ce sont
-- des couleurs de MATIÈRE — de l'os et de la braise — qui ne disent pas
-- grand-chose sur un bandeau plat, et beaucoup sur une pointe.
--
--   · Kohaku 琥珀 — l'ambre. La corne translucide prise dans la lumière ; sur
--     une oreille de renard, c'est le poil roux qui revient. Payable en Mon :
--     elle doit rester atteignable, c'est la plus « naturelle » des deux.
--   · Shu 朱 — le vermillon des sanctuaires. La seule couleur que le jeu
--     s'était réservée jusqu'ici (les liserés, les torii, les ligatures) : la
--     porter, c'est prendre la teinte de la piste elle-même. D'où le jade —
--     comme l'or et l'argent, elle ne s'obtient pas en courant.
--
-- `on conflict do nothing` : rejouer cette migration ne duplique rien et
-- n'écrase pas un prix qu'on aurait ajusté depuis.
insert into articles (code, nom, categorie, prix_mon, prix_hisui, valeur, rang) values
  ('coul_kohaku', 'Kohaku 琥珀', 'couleur',  800, null, '#c8791f',  55),
  ('coul_shu',    'Shu 朱',      'couleur', null,   40, '#e0402a',  75)
on conflict (code) do nothing;
