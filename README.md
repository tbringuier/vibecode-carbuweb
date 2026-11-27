# Carbu'Web — historique des prix des carburants

Branche generee automatiquement par la CI (`pipeline/history.py`). Ne pas modifier a la main.
Servie telle quelle sous `https://carbuweb.folf.fr/history/`.

## Sources

1. Archives annuelles officielles `donnees.roulez-eco.fr/opendata/annee/AAAA` (tous les
   changements de prix depuis 2007) — elles font foi pour les jours qu'elles couvrent.
2. Prix releves a chaque build du site — completent la journee en cours.

## Modele

Resolution journaliere : pour chaque station et carburant, le prix de cloture de chaque
jour ou il change. Un prix stable reconfirme est reenregistre tous les 30 jours ;
un releve vaut au plus 45 jours (au-dela : pas de donnee). Prix en millimes d'euro.

## Fichiers

- `index.json` : manifeste (schema, couverture, sources importees, zones).
- `stations/<2 derniers chiffres de l'id>/<id>.json` :
  `{"v":1,"id":"…","m":{"n":nom,"a":adresse,"cp":…,"c":ville},"f":{"Gazole":[j0,p0,dj1,dp1,…]}}`
  `j` = jours depuis le 1970-01-01, `p` = prix en millimes ; apres le premier couple,
  valeurs en delta par rapport au precedent.
- `zones/fr.json`, `zones/region/<slug>.json`, `zones/dept/<code>.json` : moyennes journalieres
  `{"d0":jour,"len":n,"f":{"Gazole":{"a":[…],"n":[…]}}}` — `a` moyenne (millimes) et `n` nombre
  de stations, en deltas ; `n = 0` : pas de donnee ce jour.

## Stockage git

La branche garde une fenetre glissante de commits recents puis est consolidee en un commit
racine : sa taille suit le volume de donnees, pas le nombre de builds. Tout l'historique
peut etre reconstruit depuis les archives officielles.
