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
export const REGIONS: Readonly<Record<string, readonly string[]>> = {
  FR: [
    'Auvergne-Rhône-Alpes',
    'Bourgogne-Franche-Comté',
    'Bretagne',
    'Centre-Val de Loire',
    'Corse',
    'Grand Est',
    'Hauts-de-France',
    'Île-de-France',
    'Normandie',
    'Nouvelle-Aquitaine',
    'Occitanie',
    'Pays de la Loire',
    "Provence-Alpes-Côte d'Azur",
    'Guadeloupe',
    'Guyane',
    'La Réunion',
    'Martinique',
    'Mayotte',
  ],
  BE: ['Bruxelles-Capitale', 'Flandre', 'Wallonie'],
  CH: ['Suisse romande', 'Suisse alémanique', 'Tessin'],
  CA: [
    'Alberta',
    'Colombie-Britannique',
    'Île-du-Prince-Édouard',
    'Manitoba',
    'Nouveau-Brunswick',
    'Nouvelle-Écosse',
    'Nunavut',
    'Ontario',
    'Québec',
    'Saskatchewan',
    'Terre-Neuve-et-Labrador',
    'Territoires du Nord-Ouest',
    'Yukon',
  ],
}

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
  return REGIONS[code] ?? VILLES[code] ?? []
}

/**
 * A-t-on de vraies subdivisions pour ce pays, ou seulement sa capitale ?
 *
 * Sert à l'étiquette du menu : appeler « Région » une liste qui ne contient
 * qu'une ville serait faux, et l'inverse tout autant.
 */
export function aDesRegions(code: string): boolean {
  return REGIONS[code] !== undefined
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
