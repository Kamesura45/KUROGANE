/**
 * ————— 🌍 Le pays et la région qu'on représente —————
 *
 * Un réglage LOCAL, au même titre que le pseudo : on le choisit dans l'écran
 * Compte, il vit sur le téléphone, et il ne demande **aucune connexion**. Se
 * déclarer d'un pays n'a rien à voir avec le fait d'avoir un compte — c'est une
 * façon de se présenter, pas une identité vérifiée.
 *
 * ⚠️ AUCUN DRAPEAU N'EST STOCKÉ. Un drapeau émoji se DÉDUIT du code ISO à deux
 * lettres : chaque lettre a son « indicateur régional » dans Unicode, et les
 * deux accolés forment le drapeau. Ranger 250 émojis à la main aurait été 250
 * occasions de se tromper, pour une information déjà contenue dans le code.
 */

/** L'écart entre 'A' (65) et l'indicateur régional 🇦 (0x1F1E6). */
const INDICATEUR = 0x1f1e6 - 65

/**
 * Le drapeau d'un code ISO. `''` pour un code vide ou mal formé — on ne veut
 * jamais afficher un carré vide à la place d'un pays.
 */
export function drapeau(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return String.fromCodePoint(
    code.charCodeAt(0) + INDICATEUR,
    code.charCodeAt(1) + INDICATEUR
  )
}

/*
 * ————— La liste —————
 *
 * Rangée en UNE chaîne plutôt qu'en tableau d'objets : deux cent cinquante
 * accolades et deux cent cinquante virgules n'apportaient rien, et la moindre
 * relecture y devenait pénible. Le format est « CODE Nom », une entrée par
 * ligne, et l'on découpe au premier espace.
 *
 * ⚠️ Les noms sont en FRANÇAIS et triés à l'affichage, pas ici : l'ordre
 * alphabétique dépend des accents (Éthiopie après Estonie), et c'est
 * `localeCompare` qui sait faire ça — pas moi à la main.
 */
const BRUT = `
AF Afghanistan
ZA Afrique du Sud
AL Albanie
DZ Algérie
DE Allemagne
AD Andorre
AO Angola
AG Antigua-et-Barbuda
SA Arabie saoudite
AR Argentine
AM Arménie
AU Australie
AT Autriche
AZ Azerbaïdjan
BS Bahamas
BH Bahreïn
BD Bangladesh
BB Barbade
BE Belgique
BZ Belize
BJ Bénin
BT Bhoutan
BY Biélorussie
BO Bolivie
BA Bosnie-Herzégovine
BW Botswana
BR Brésil
BN Brunei
BG Bulgarie
BF Burkina Faso
BI Burundi
KH Cambodge
CM Cameroun
CA Canada
CV Cap-Vert
CF Centrafrique
CL Chili
CN Chine
CY Chypre
CO Colombie
KM Comores
CG Congo
CD Congo (RDC)
KR Corée du Sud
KP Corée du Nord
CR Costa Rica
CI Côte d'Ivoire
HR Croatie
CU Cuba
DK Danemark
DJ Djibouti
DM Dominique
EG Égypte
AE Émirats arabes unis
EC Équateur
ER Érythrée
ES Espagne
EE Estonie
SZ Eswatini
US États-Unis
ET Éthiopie
FJ Fidji
FI Finlande
FR France
GA Gabon
GM Gambie
GE Géorgie
GH Ghana
GR Grèce
GD Grenade
GT Guatemala
GN Guinée
GQ Guinée équatoriale
GW Guinée-Bissau
GY Guyana
HT Haïti
HN Honduras
HU Hongrie
IN Inde
ID Indonésie
IQ Irak
IR Iran
IE Irlande
IS Islande
IL Israël
IT Italie
JM Jamaïque
JP Japon
JO Jordanie
KZ Kazakhstan
KE Kenya
KG Kirghizistan
KI Kiribati
KW Koweït
LA Laos
LS Lesotho
LV Lettonie
LB Liban
LR Liberia
LY Libye
LI Liechtenstein
LT Lituanie
LU Luxembourg
MK Macédoine du Nord
MG Madagascar
MY Malaisie
MW Malawi
MV Maldives
ML Mali
MT Malte
MA Maroc
MH Marshall
MU Maurice
MR Mauritanie
MX Mexique
FM Micronésie
MD Moldavie
MC Monaco
MN Mongolie
ME Monténégro
MZ Mozambique
MM Birmanie
NA Namibie
NR Nauru
NP Népal
NI Nicaragua
NE Niger
NG Nigeria
NO Norvège
NZ Nouvelle-Zélande
OM Oman
UG Ouganda
UZ Ouzbékistan
PK Pakistan
PW Palaos
PS Palestine
PA Panama
PG Papouasie-Nouvelle-Guinée
PY Paraguay
NL Pays-Bas
PE Pérou
PH Philippines
PL Pologne
PT Portugal
QA Qatar
RO Roumanie
GB Royaume-Uni
RU Russie
RW Rwanda
KN Saint-Kitts-et-Nevis
SM Saint-Marin
VA Saint-Siège
VC Saint-Vincent-et-les-Grenadines
LC Sainte-Lucie
SB Salomon
SV Salvador
WS Samoa
ST Sao Tomé-et-Principe
SN Sénégal
RS Serbie
SC Seychelles
SL Sierra Leone
SG Singapour
SK Slovaquie
SI Slovénie
SO Somalie
SD Soudan
SS Soudan du Sud
LK Sri Lanka
SE Suède
CH Suisse
SR Suriname
SY Syrie
TJ Tadjikistan
TZ Tanzanie
TD Tchad
CZ Tchéquie
TH Thaïlande
TL Timor oriental
TG Togo
TO Tonga
TT Trinité-et-Tobago
TN Tunisie
TM Turkménistan
TR Turquie
TV Tuvalu
UA Ukraine
UY Uruguay
VU Vanuatu
VE Venezuela
VN Viêt Nam
YE Yémen
ZM Zambie
ZW Zimbabwe
`

export interface Pays {
  code: string
  nom: string
}

/** Tous les pays, triés par nom en respectant les accents. */
export const PAYS: readonly Pays[] = BRUT.trim()
  .split('\n')
  .map((l) => {
    const i = l.indexOf(' ')
    return { code: l.slice(0, i), nom: l.slice(i + 1) }
  })
  .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))

/*
 * ————— Les subdivisions —————
 *
 * ⚠️ Seuls quelques pays en ont ici, et c'est ASSUMÉ. Il n'existe aucune liste
 * universelle : la France a 18 régions, le Japon 47 préfectures, les États-Unis
 * 50 États, Monaco aucune. Prétendre couvrir les deux cents pays du monde aurait
 * demandé des milliers de lignes de données à tenir à jour, pour des classements
 * qui resteraient vides.
 *
 * On détaille donc là où il y a des joueurs, et les autres pays n'ont que leur
 * drapeau — ce qui suffit largement au classement mondial. En ajouter un plus
 * tard est une ligne dans cette table, rien de plus.
 */
/**
 * ————— 🏞️ Les subdivisions, par ordre de finesse —————
 *
 * ⚠️ TROIS NIVEAUX, ET C'EST UNE PRIORITÉ, pas un mélange : on donne les
 * DÉPARTEMENTS si on les a, sinon les RÉGIONS, sinon les VILLES. Un joueur doit
 * pouvoir se situer aussi finement que possible, mais jamais choisir entre deux
 * échelles dans la même liste — « Bretagne » et « Finistère » côte à côte ne se
 * comparent pas.
 *
 * Le format est compact À DESSEIN. En tableaux imbriqués, ces quelques milliers
 * de noms auraient fait autant de lignes que personne ne relit ; en texte, une
 * subdivision se vérifie d'un coup d'œil et s'ajoute en une ligne. L'ordre du
 * fichier est celui du menu — on ne trie pas.
 */
const DEPARTEMENTS_BRUT = `
FR 01 Ain, 02 Aisne, 03 Allier, 04 Alpes-de-Haute-Provence, 05 Hautes-Alpes, 06 Alpes-Maritimes, 07 Ardèche, 08 Ardennes, 09 Ariège, 10 Aube, 11 Aude, 12 Aveyron, 13 Bouches-du-Rhône, 14 Calvados, 15 Cantal, 16 Charente, 17 Charente-Maritime, 18 Cher, 19 Corrèze, 2A Corse-du-Sud, 2B Haute-Corse, 21 Côte-d'Or, 22 Côtes-d'Armor, 23 Creuse, 24 Dordogne, 25 Doubs, 26 Drôme, 27 Eure, 28 Eure-et-Loir, 29 Finistère, 30 Gard, 31 Haute-Garonne, 32 Gers, 33 Gironde, 34 Hérault, 35 Ille-et-Vilaine, 36 Indre, 37 Indre-et-Loire, 38 Isère, 39 Jura, 40 Landes, 41 Loir-et-Cher, 42 Loire, 43 Haute-Loire, 44 Loire-Atlantique, 45 Loiret, 46 Lot, 47 Lot-et-Garonne, 48 Lozère, 49 Maine-et-Loire, 50 Manche, 51 Marne, 52 Haute-Marne, 53 Mayenne, 54 Meurthe-et-Moselle, 55 Meuse, 56 Morbihan, 57 Moselle, 58 Nièvre, 59 Nord, 60 Oise, 61 Orne, 62 Pas-de-Calais, 63 Puy-de-Dôme, 64 Pyrénées-Atlantiques, 65 Hautes-Pyrénées, 66 Pyrénées-Orientales, 67 Bas-Rhin, 68 Haut-Rhin, 69 Rhône, 70 Haute-Saône, 71 Saône-et-Loire, 72 Sarthe, 73 Savoie, 74 Haute-Savoie, 75 Paris, 76 Seine-Maritime, 77 Seine-et-Marne, 78 Yvelines, 79 Deux-Sèvres, 80 Somme, 81 Tarn, 82 Tarn-et-Garonne, 83 Var, 84 Vaucluse, 85 Vendée, 86 Vienne, 87 Haute-Vienne, 88 Vosges, 89 Yonne, 90 Territoire de Belfort, 91 Essonne, 92 Hauts-de-Seine, 93 Seine-Saint-Denis, 94 Val-de-Marne, 95 Val-d'Oise, 971 Guadeloupe, 972 Martinique, 973 Guyane, 974 La Réunion, 976 Mayotte
`

/**
 * Le premier niveau administratif — régions, provinces, cantons, préfectures,
 * États — quel que soit son nom local.
 *
 * ⚠️ ON NE DÉTAILLE QUE CE DONT ON EST SÛR. Inventer les provinces d'un pays
 * qu'on connaît mal serait pire qu'un menu court : le joueur y lirait des noms
 * faux, et l'erreur nous serait invisible. Les pays absents gardent leurs trois
 * villes — un plancher honnête. En ajouter un est une ligne ici.
 */
const REGIONS_BRUT = `
BE Anvers, Brabant flamand, Brabant wallon, Bruxelles-Capitale, Flandre-Occidentale, Flandre-Orientale, Hainaut, Liège, Limbourg, Luxembourg, Namur
CH Argovie, Appenzell Rhodes-Extérieures, Appenzell Rhodes-Intérieures, Bâle-Campagne, Bâle-Ville, Berne, Fribourg, Genève, Glaris, Grisons, Jura, Lucerne, Neuchâtel, Nidwald, Obwald, Saint-Gall, Schaffhouse, Schwytz, Soleure, Tessin, Thurgovie, Uri, Valais, Vaud, Zoug, Zurich
CA Alberta, Colombie-Britannique, Île-du-Prince-Édouard, Manitoba, Nouveau-Brunswick, Nouvelle-Écosse, Nunavut, Ontario, Québec, Saskatchewan, Terre-Neuve-et-Labrador, Territoires du Nord-Ouest, Yukon
LU Capellen, Clervaux, Diekirch, Echternach, Esch-sur-Alzette, Grevenmacher, Luxembourg, Mersch, Redange, Remich, Vianden, Wiltz
MC Monaco-Ville, Monte-Carlo, La Condamine, Fontvieille
MA Tanger-Tétouan-Al Hoceïma, L'Oriental, Fès-Meknès, Rabat-Salé-Kénitra, Béni Mellal-Khénifra, Casablanca-Settat, Marrakech-Safi, Drâa-Tafilalet, Souss-Massa, Guelmim-Oued Noun, Laâyoune-Sakia El Hamra, Dakhla-Oued Ed-Dahab
DZ Adrar, Alger, Annaba, Batna, Béchar, Béjaïa, Biskra, Blida, Bouira, Chlef, Constantine, Djelfa, El Oued, Ghardaïa, Guelma, Jijel, Laghouat, Mascara, Médéa, Mostaganem, M'Sila, Oran, Ouargla, Relizane, Saïda, Sétif, Sidi Bel Abbès, Skikda, Souk Ahras, Tébessa, Tiaret, Tizi Ouzou, Tlemcen
TN Ariana, Béja, Ben Arous, Bizerte, Gabès, Gafsa, Jendouba, Kairouan, Kasserine, Kébili, Le Kef, Mahdia, La Manouba, Médenine, Monastir, Nabeul, Sfax, Sidi Bouzid, Siliana, Sousse, Tataouine, Tozeur, Tunis, Zaghouan
SN Dakar, Diourbel, Fatick, Kaffrine, Kaolack, Kédougou, Kolda, Louga, Matam, Saint-Louis, Sédhiou, Tambacounda, Thiès, Ziguinchor
CI Abidjan, Bas-Sassandra, Comoé, Denguélé, Gôh-Djiboua, Lacs, Lagunes, Montagnes, Sassandra-Marahoué, Savanes, Vallée du Bandama, Woroba, Yamoussoukro, Zanzan
CM Adamaoua, Centre, Est, Extrême-Nord, Littoral, Nord, Nord-Ouest, Ouest, Sud, Sud-Ouest
US Alabama, Alaska, Arizona, Arkansas, Californie, Caroline du Nord, Caroline du Sud, Colorado, Connecticut, Dakota du Nord, Dakota du Sud, Delaware, Floride, Géorgie, Hawaï, Idaho, Illinois, Indiana, Iowa, Kansas, Kentucky, Louisiane, Maine, Maryland, Massachusetts, Michigan, Minnesota, Mississippi, Missouri, Montana, Nebraska, Nevada, New Hampshire, New Jersey, Nouveau-Mexique, New York, Ohio, Oklahoma, Oregon, Pennsylvanie, Rhode Island, Tennessee, Texas, Utah, Vermont, Virginie, Virginie-Occidentale, Washington, Washington D.C., Wisconsin, Wyoming
DE Bade-Wurtemberg, Basse-Saxe, Bavière, Berlin, Brandebourg, Brême, Hambourg, Hesse, Mecklembourg-Poméranie, Rhénanie-du-Nord-Westphalie, Rhénanie-Palatinat, Sarre, Saxe, Saxe-Anhalt, Schleswig-Holstein, Thuringe
ES Andalousie, Aragon, Asturies, Baléares, Canaries, Cantabrie, Castille-et-León, Castille-La Manche, Catalogne, Communauté de Madrid, Communauté valencienne, Estrémadure, Galice, La Rioja, Murcie, Navarre, Pays basque, Ceuta, Melilla
IT Abruzzes, Basilicate, Calabre, Campanie, Émilie-Romagne, Frioul-Vénétie Julienne, Latium, Ligurie, Lombardie, Marches, Molise, Ombrie, Piémont, Pouilles, Sardaigne, Sicile, Toscane, Trentin-Haut-Adige, Val d'Aoste, Vénétie
PT Aveiro, Beja, Braga, Bragance, Castelo Branco, Coimbra, Évora, Faro, Guarda, Leiria, Lisbonne, Portalegre, Porto, Santarém, Setúbal, Viana do Castelo, Vila Real, Viseu, Açores, Madère
NL Brabant-Septentrional, Drenthe, Flevoland, Frise, Gueldre, Groningue, Hollande-Méridionale, Hollande-Septentrionale, Limbourg, Overijssel, Utrecht, Zélande
GB Angleterre, Écosse, Pays de Galles, Irlande du Nord
IE Connacht, Leinster, Munster, Ulster
AT Burgenland, Carinthie, Basse-Autriche, Haute-Autriche, Salzbourg, Styrie, Tyrol, Vorarlberg, Vienne
PL Basse-Silésie, Cujavie-Poméranie, Lublin, Lubusz, Łódź, Petite-Pologne, Mazovie, Opole, Basses-Carpates, Podlachie, Poméranie, Silésie, Sainte-Croix, Varmie-Mazurie, Grande-Pologne, Poméranie-Occidentale
JP Hokkaidō, Aomori, Iwate, Miyagi, Akita, Yamagata, Fukushima, Ibaraki, Tochigi, Gunma, Saitama, Chiba, Tokyo, Kanagawa, Niigata, Toyama, Ishikawa, Fukui, Yamanashi, Nagano, Gifu, Shizuoka, Aichi, Mie, Shiga, Kyoto, Osaka, Hyōgo, Nara, Wakayama, Tottori, Shimane, Okayama, Hiroshima, Yamaguchi, Tokushima, Kagawa, Ehime, Kōchi, Fukuoka, Saga, Nagasaki, Kumamoto, Ōita, Miyazaki, Kagoshima, Okinawa
BR Acre, Alagoas, Amapá, Amazonas, Bahia, Ceará, District fédéral, Espírito Santo, Goiás, Maranhão, Mato Grosso, Mato Grosso do Sul, Minas Gerais, Pará, Paraíba, Paraná, Pernambouc, Piauí, Rio de Janeiro, Rio Grande do Norte, Rio Grande do Sul, Rondônia, Roraima, Santa Catarina, São Paulo, Sergipe, Tocantins
MX Aguascalientes, Basse-Californie, Basse-Californie du Sud, Campeche, Chiapas, Chihuahua, Coahuila, Colima, Durango, Guanajuato, Guerrero, Hidalgo, Jalisco, Mexico, État de Mexico, Michoacán, Morelos, Nayarit, Nuevo León, Oaxaca, Puebla, Querétaro, Quintana Roo, San Luis Potosí, Sinaloa, Sonora, Tabasco, Tamaulipas, Tlaxcala, Veracruz, Yucatán, Zacatecas
AU Australie-Méridionale, Australie-Occidentale, Nouvelle-Galles du Sud, Queensland, Tasmanie, Victoria, Territoire du Nord, Territoire de la capitale
`

/** Lit un bloc « CODE Nom1, Nom2, … » et en fait une table par code pays. */
function lireBloc(brut: string): Record<string, readonly string[]> {
  return Object.fromEntries(
    brut
      .trim()
      .split('\n')
      .map((l) => {
        const i = l.indexOf(' ')
        return [l.slice(0, i), l.slice(i + 1).split(', ')]
      })
  )
}

export const DEPARTEMENTS: Readonly<Record<string, readonly string[]>> = lireBloc(
  DEPARTEMENTS_BRUT
)
export const REGIONS: Readonly<Record<string, readonly string[]>> = lireBloc(REGIONS_BRUT)

/*
 * ————— Les VILLES : le plancher, à trois choix minimum —————
 *
 * Un pays sans subdivision détaillée ne laissait rien à choisir, et son joueur
 * restait un drapeau parmi d'autres. On lui donne donc TROIS villes connues :
 * sa capitale d'abord, puis ses deux plus grandes ou plus notoires.
 *
 * ⚠️ TROIS, ni une ni trente. Une seule (la capitale) ne laissait aucun choix —
 * un menu à une entrée n'est pas un menu. Et ouvrir la porte aux villes
 * secondaires demanderait des dizaines de milliers d'entrées à tenir à jour,
 * pour des classements qui resteraient vides. Trois suffisent à se situer, et
 * tiennent en un fichier qu'un humain peut relire.
 *
 * Là où il y a vraiment des joueurs, on détaille les vraies subdivisions
 * (voir REGIONS) et ces villes-là ne servent pas.
 *
 * ⚠️ Les noms sont en FRANÇAIS quand l'usage l'impose : Pékin, Le Caire,
 * Londres, Moscou, Bombay. Écrire « Beijing » dans un menu qui liste 194 pays
 * en français jurerait.
 *
 * ⚠️ UNE EXCEPTION ASSUMÉE : le Vatican n'a qu'une entrée. C'est un État d'un
 * demi-kilomètre carré ; lui inventer deux villes serait faux, et la fausseté
 * coûte plus cher ici qu'un menu court.
 */
const CAPITALES_BRUT = `
AF Kaboul, Kandahar, Hérat
ZA Pretoria, Le Cap, Johannesbourg
AL Tirana, Durrës, Vlorë
DZ Alger, Oran, Constantine
DE Berlin, Munich, Hambourg
AD Andorre-la-Vieille, Escaldes-Engordany, Encamp
AO Luanda, Huambo, Lobito
AG Saint John's, All Saints, Liberta
SA Riyad, Djeddah, La Mecque
AR Buenos Aires, Córdoba, Rosario
AM Erevan, Gyumri, Vanadzor
AU Canberra, Sydney, Melbourne
AT Vienne, Graz, Salzbourg
AZ Bakou, Gandja, Soumgaït
BS Nassau, Freeport, West End
BH Manama, Riffa, Muharraq
BD Dacca, Chittagong, Khulna
BB Bridgetown, Speightstown, Oistins
BZ Belmopan, Belize City, San Ignacio
BJ Porto-Novo, Cotonou, Parakou
BT Thimphou, Phuentsholing, Paro
BY Minsk, Homiel, Moguilev
BO Sucre, La Paz, Santa Cruz
BA Sarajevo, Banja Luka, Mostar
BW Gaborone, Francistown, Molepolole
BR Brasilia, São Paulo, Rio de Janeiro
BN Bandar Seri Begawan, Kuala Belait, Seria
BG Sofia, Plovdiv, Varna
BF Ouagadougou, Bobo-Dioulasso, Koudougou
BI Gitega, Bujumbura, Ngozi
KH Phnom Penh, Siem Reap, Battambang
CM Yaoundé, Douala, Garoua
CV Praia, Mindelo, Santa Maria
CF Bangui, Bimbo, Berbérati
CL Santiago, Valparaiso, Concepción
CN Pékin, Shanghai, Canton
CY Nicosie, Limassol, Larnaca
CO Bogota, Medellín, Cali
KM Moroni, Mutsamudu, Fomboni
CG Brazzaville, Pointe-Noire, Dolisie
CD Kinshasa, Lubumbashi, Goma
KR Séoul, Busan, Incheon
KP Pyongyang, Hamhung, Chongjin
CR San José, Alajuela, Cartago
CI Yamoussoukro, Abidjan, Bouaké
HR Zagreb, Split, Rijeka
CU La Havane, Santiago de Cuba, Camagüey
DK Copenhague, Aarhus, Odense
DJ Djibouti, Ali Sabieh, Tadjourah
DM Roseau, Portsmouth, Marigot
EG Le Caire, Alexandrie, Gizeh
AE Abou Dabi, Dubaï, Charjah
EC Quito, Guayaquil, Cuenca
ER Asmara, Keren, Massaoua
ES Madrid, Barcelone, Valence
EE Tallinn, Tartu, Narva
SZ Mbabane, Manzini, Lobamba
US Washington, New York, Los Angeles
ET Addis-Abeba, Dire Dawa, Mekele
FJ Suva, Nadi, Lautoka
FI Helsinki, Espoo, Tampere
GA Libreville, Port-Gentil, Franceville
GM Banjul, Serekunda, Brikama
GE Tbilissi, Batoumi, Koutaïssi
GH Accra, Kumasi, Tamale
GR Athènes, Thessalonique, Patras
GD Saint-Georges, Gouyave, Grenville
GT Guatemala, Quetzaltenango, Escuintla
GN Conakry, Nzérékoré, Kankan
GQ Malabo, Bata, Ebebiyín
GW Bissau, Bafatá, Gabú
GY Georgetown, Linden, New Amsterdam
HT Port-au-Prince, Cap-Haïtien, Les Cayes
HN Tegucigalpa, San Pedro Sula, La Ceiba
HU Budapest, Debrecen, Szeged
IN New Delhi, Bombay, Bangalore
ID Jakarta, Surabaya, Bandung
IQ Bagdad, Bassorah, Mossoul
IR Téhéran, Machhad, Ispahan
IE Dublin, Cork, Galway
IS Reykjavik, Kópavogur, Akureyri
IL Jérusalem, Tel-Aviv, Haïfa
IT Rome, Milan, Naples
JM Kingston, Montego Bay, Spanish Town
JP Tokyo, Osaka, Kyoto
JO Amman, Zarqa, Irbid
KZ Astana, Almaty, Chymkent
KE Nairobi, Mombasa, Kisumu
KG Bichkek, Och, Djalal-Abad
KI Tarawa, Betio, Bikenibeu
KW Koweït, Hawalli, Al Jahra
LA Vientiane, Louang Prabang, Paksé
LS Maseru, Teyateyaneng, Mafeteng
LV Riga, Daugavpils, Liepāja
LB Beyrouth, Tripoli, Saïda
LR Monrovia, Gbarnga, Buchanan
LY Tripoli, Benghazi, Misrata
LI Vaduz, Schaan, Balzers
LT Vilnius, Kaunas, Klaipėda
LU Luxembourg, Esch-sur-Alzette, Differdange
MK Skopje, Bitola, Kumanovo
MG Antananarivo, Toamasina, Antsirabe
MY Kuala Lumpur, George Town, Johor Bahru
MW Lilongwe, Blantyre, Mzuzu
MV Malé, Addu, Fuvahmulah
ML Bamako, Sikasso, Mopti
MT La Valette, Birkirkara, Sliema
MA Rabat, Casablanca, Marrakech
MH Majuro, Ebeye, Laura
MU Port-Louis, Beau-Bassin, Curepipe
MR Nouakchott, Nouadhibou, Kaédi
MX Mexico, Guadalajara, Monterrey
FM Palikir, Weno, Kolonia
MD Chisinau, Tiraspol, Balti
MC Monaco, Monte-Carlo, La Condamine
MN Oulan-Bator, Erdenet, Darkhan
ME Podgorica, Nikšić, Budva
MZ Maputo, Matola, Beira
MM Naypyidaw, Rangoun, Mandalay
NA Windhoek, Walvis Bay, Swakopmund
NR Yaren, Denigomodu, Aiwo
NP Katmandou, Pokhara, Lalitpur
NI Managua, León, Granada
NE Niamey, Zinder, Maradi
NG Abuja, Lagos, Kano
NO Oslo, Bergen, Trondheim
NZ Wellington, Auckland, Christchurch
OM Mascate, Salalah, Sohar
UG Kampala, Gulu, Entebbe
UZ Tachkent, Samarcande, Boukhara
PK Islamabad, Karachi, Lahore
PW Ngerulmud, Koror, Airai
PS Ramallah, Gaza, Hébron
PA Panama, Colón, David
PG Port Moresby, Lae, Mont Hagen
PY Asuncion, Ciudad del Este, Encarnación
NL Amsterdam, Rotterdam, La Haye
PE Lima, Arequipa, Cusco
PH Manille, Quezon City, Cebu
PL Varsovie, Cracovie, Gdansk
PT Lisbonne, Porto, Braga
QA Doha, Al Rayyan, Al Wakrah
RO Bucarest, Cluj-Napoca, Timisoara
GB Londres, Manchester, Édimbourg
RU Moscou, Saint-Pétersbourg, Novossibirsk
RW Kigali, Butare, Gisenyi
KN Basseterre, Charlestown, Sandy Point
SM Saint-Marin, Borgo Maggiore, Serravalle
VA Vatican
VC Kingstown, Georgetown, Barrouallie
LC Castries, Vieux Fort, Soufrière
SB Honiara, Gizo, Auki
SV San Salvador, Santa Ana, San Miguel
WS Apia, Vaitele, Faleula
ST Sao Tomé, Trindade, Neves
SN Dakar, Thiès, Saint-Louis
RS Belgrade, Novi Sad, Niš
SC Victoria, Anse Boileau, Beau Vallon
SL Freetown, Bo, Kenema
SG Singapour, Jurong, Woodlands
SK Bratislava, Košice, Prešov
SI Ljubljana, Maribor, Celje
SO Mogadiscio, Hargeisa, Bosaso
SD Khartoum, Omdourman, Port-Soudan
SS Djouba, Malakal, Ouaou
LK Colombo, Kandy, Galle
SE Stockholm, Göteborg, Malmö
SR Paramaribo, Lelydorp, Nieuw Nickerie
SY Damas, Alep, Homs
TJ Douchanbé, Khodjent, Kulob
TZ Dodoma, Dar es Salaam, Arusha
TD N'Djaména, Moundou, Sarh
CZ Prague, Brno, Ostrava
TH Bangkok, Chiang Mai, Pattaya
TL Dili, Baucau, Maliana
TG Lomé, Sokodé, Kara
TO Nuku'alofa, Neiafu, Haveluloto
TT Port-d'Espagne, Chaguanas, San Fernando
TN Tunis, Sfax, Sousse
TM Achgabat, Türkmenabat, Daşoguz
TR Ankara, Istanbul, Izmir
TV Funafuti, Vaiaku, Asau
UA Kyiv, Kharkiv, Odessa
UY Montevideo, Salto, Paysandú
VU Port-Vila, Luganville, Norsup
VE Caracas, Maracaibo, Valencia
VN Hanoï, Hô Chi Minh-Ville, Da Nang
YE Sanaa, Aden, Taïz
ZM Lusaka, Kitwe, Ndola
ZW Harare, Bulawayo, Mutare
`

const VILLES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  CAPITALES_BRUT.trim()
    .split('\n')
    .map((l) => {
      const i = l.indexOf(' ')
      // La capitale d'abord, puis les autres : l'ordre du fichier est celui du
      // menu, et l'on veut la capitale en tête plutôt qu'un alphabet arbitraire.
      return [l.slice(0, i), l.slice(i + 1).split(', ')]
    })
)

/** Le nom d'un pays depuis son code. `''` si le code est inconnu. */
export function nomPays(code: string): string {
  return PAYS.find((p) => p.code === code)?.nom ?? ''
}

/**
 * Ce qu'on peut choisir SOUS un pays.
 *
 * Ses régions quand on les détaille ; sinon sa capitale, seule. Le tableau
 * n'est jamais vide pour un pays connu — c'est ce qui garantit que tout joueur,
 * où qu'il soit, a de quoi se situer plus finement que son drapeau.
 */
export function regionsDe(code: string): readonly string[] {
  // ⚠️ L'ORDRE EST LA RÈGLE : le plus fin d'abord. Départements, sinon régions,
  // sinon villes. Jamais deux échelles mélangées dans la même liste.
  return DEPARTEMENTS[code] ?? REGIONS[code] ?? VILLES[code] ?? []
}

/** Ce qu'on propose sous un pays — sert à nommer le champ dans le menu. */
export type Niveau = 'departement' | 'region' | 'ville' | 'aucun'

/**
 * À quelle échelle ce pays est-il détaillé ?
 *
 * ⚠️ L'ÉTIQUETTE DOIT DIRE LA VÉRITÉ. Appeler « Région » une liste de trois
 * villes ferait chercher la sienne dans un menu qui ne l'a pas ; appeler
 * « Ville » les cent-un départements français serait tout aussi faux. Le menu ne
 * devine pas : il demande ici.
 */
export function niveauDe(code: string): Niveau {
  if (DEPARTEMENTS[code]) return 'departement'
  if (REGIONS[code]) return 'region'
  if (VILLES[code]) return 'ville'
  return 'aucun'
}

/**
 * Valide un couple (pays, région) relu du stockage.
 *
 * ⚠️ La région est REJETÉE si elle n'appartient pas au pays. Sans ce contrôle,
 * changer de pays laisserait derrière soi la région du précédent — on se
 * retrouverait japonais et normand.
 */
export function valider(code: unknown, region: unknown): { pays: string; region: string } {
  const p = typeof code === 'string' && PAYS.some((x) => x.code === code) ? code : ''
  const r = typeof region === 'string' && regionsDe(p).includes(region) ? region : ''
  return { pays: p, region: r }
}
