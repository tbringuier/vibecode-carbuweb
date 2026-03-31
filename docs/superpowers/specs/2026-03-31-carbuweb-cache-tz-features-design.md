# Carbu'Web — Suppression cache, correction timezone, nouvelles features

**Date** : 2026-03-31
**Statut** : Approuvé

---

## Contexte

L'application Carbu'Web est un site statique (vanilla JS + Python build) déployé sur GitHub Pages toutes les 5 minutes. Le service worker cache-first provoque des erreurs "Erreur serveur HTTP local" chez les clients après un déploiement (ancien app.js servi depuis le cache SW tente de charger un data.json au format potentiellement changé). Les timestamps de mise à jour des prix affichent parfois ±1h à cause de chaînes ISO sans offset timezone.

---

## 1. Suppression du cache & mise à jour client fiable

### 1.1 SW auto-destructeur (transition)

Remplacer `templates/sw.js` par un SW minimal qui :
- `install` : `self.skipWaiting()`
- `activate` : purge tous les caches via `caches.keys()` + `caches.delete()`, puis `self.clients.claim()`, puis `self.registration.unregister()`
- `fetch` : passthrough simple `fetch(event.request)`

Ce SW sera récupéré automatiquement par les navigateurs des clients existants et se détruira.

### 1.2 Filet de sécurité dans app.js

Au chargement, app.js exécute :
```javascript
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs =>
        regs.forEach(r => r.unregister())
    );
    caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
}
```
Ce code est idempotent et peut rester en place indéfiniment.

### 1.3 Cache-busting par nommage de fichiers

**Au build (main.py)** :
- Générer un timestamp epoch (`BUILD_TS`)
- Renommer `app.js` → `app.<BUILD_TS>.js` dans `build/`
- Renommer `icon.svg` → `icon.<BUILD_TS>.svg` dans `build/`
- Injecter les noms de fichiers horodatés dans `index.html` via les placeholders `{{APP_JS}}` et `{{ICON_SVG}}`

**Fichiers non horodatés** :
- `data.json` : déjà servi avec `cache: 'no-store'` + query string `?_=${Date.now()}`
- `index.html` : pas horodaté, mais GitHub Pages envoie des headers Cache-Control raisonnables pour le HTML ; le navigateur revalide à chaque navigation

### 1.4 Suppression du manifest PWA

- Supprimer `manifest.webmanifest` des templates
- Retirer la balise `<link rel="manifest">` de `index.html`
- Supprimer `initPwaInstall()`, le bandeau d'installation, et les event listeners `beforeinstallprompt` dans app.js

---

## 2. Correction des timestamps / fuseaux horaires

### Problème

`normalize_price_update_iso()` dans main.py produit des chaînes ISO sans offset timezone pour les données quotidiennes (ex: `2026-03-30T10:59:06`). Le navigateur interprète ces chaînes en heure locale du client, ce qui donne ±1h selon la période DST.

### Correction

Modifier `normalize_price_update_iso()` pour garantir un offset explicite sur tout `maj_iso` écrit dans data.json :
- Si l'offset est déjà présent dans la chaîne source → le garder
- Si absent → parser la date, la localiser en `Europe/Paris` (les données gouvernementales sont en heure française), et reformater avec l'offset correct (+01:00 hiver, +02:00 été)
- Le cas synthétique date-only (`{date}T12:00:00`) → même traitement

**Aucun changement côté client** : `formatMajLabel()` fonctionne déjà correctement avec des ISO offsettés.

---

## 3. Système de rafraîchissement UI centralisé

### Problème

Chaque action utilisateur appelle manuellement une liste de fonctions de rendu. Oubli d'un appel = UI désynchronisée.

### Solution

Fonction `refreshAllViews()` unique :
```
refreshAllViews() →
    renderVehicleBar()
    renderVehiclesList()
    renderFavorites()
    syncFooterStationCount()
    syncFooterFuelDataUpdate()
    + re-rendu de la vue active si applicable
```

Règle : toute modification de state utilisateur (véhicule, favoris, rayon, ordre) appelle `refreshAllViews()`. Le rafraîchissement périodique des données (swap de `db`) l'appelle aussi.

---

## 4. Taille du réservoir & estimation du plein

### Modèle de données

Champ `tankSize` (entier, litres) ajouté à l'objet véhicule :
```javascript
{ id, name, icon, fuels, tankSize: 50 }  // tankSize: null si non renseigné
```

Migration transparente : les véhicules existants sans `tankSize` fonctionnent comme avant.

### UI — Formulaire véhicule

Input numérique optionnel, label "Réservoir (L)", dans le formulaire de création/édition de véhicule.

### UI — Affichage du prix du plein

Partout où un prix au litre est affiché ET que le véhicule actif a un `tankSize` non null :
- **Cartes favoris / stations** : sous le prix au litre, texte secondaire grisé `Plein ≈ XX.XX €`
- **Détail station** : idem, dans chaque ligne de carburant

Calcul : `(prix * tankSize).toFixed(2)`.

Si `tankSize` est `null` ou absent → rien affiché (comportement identique à aujourd'hui).

---

## 5. Réordonnancement des véhicules et lieux favoris

### Modèle

L'ordre est celui des tableaux `carbuVehicles` et `carbuFavorites` en localStorage. Réordonner = permuter les éléments dans le tableau + `saveFavorites()` / `saveVehicles()` + `refreshAllViews()`.

### Interactions

- **Drag-and-drop** : attributs `draggable`, events `dragstart/dragover/drop`. Natif HTML5, pas de bibliothèque. Disponible partout (desktop et mobile si supporté).
- **Flèches haut/bas** : boutons visibles sur chaque élément. Toujours présents (pas de détection de device).

### Emplacements

- Barre véhicules (haut de page)
- Section paramètres / liste véhicules
- Section lieux favoris (cartes sur la page d'accueil)

### Feedback visuel

- Élément en cours de drag : `opacity: 0.4`
- Zone de drop : bordure pointillée
- Persistance immédiate en localStorage

---

## 6. Rayon de recherche par lieu favori

### Modèle de données

Champ `radiusKm` (entier, km) sur les favoris de type `address` :
```javascript
{ id, type: 'address', name, lat, lon, radiusKm: 10 }
```
- Valeur par défaut à la création : `userRadius` global
- Favoris `station` non concernés
- Migration : favoris existants sans `radiusKm` → fallback sur `userRadius`

### UI — Widget favori adresse

- Icône `fa-gear` à côté de l'étoile sur la carte du lieu favori
- Clic → popover/dropdown inline avec sélecteur de rayon (5, 10, 15, 20, 30 km)
- Changement → sauvegarde immédiate + `refreshAllViews()`

### UI — Étoile de suppression rapide

- Icône `fa-star` (pleine, jaune) visible sur chaque widget de favori (adresse ET station)
- Clic → supprime le favori directement (réversible en re-favoritant)
- `refreshAllViews()` immédiat

### UI — Page "Stations autour de"

- Même icône engrenage à côté de l'étoile dans le header de la vue
- Même sélecteur de rayon
- Changement → relance la recherche avec le nouveau rayon + sauvegarde

---

## 7. Nettoyage du code

- **Message d'erreur** : remplacer "Erreur serveur HTTP local" par un message avec `e.message` et un bouton "Réessayer"
- **Constantes localStorage** : regrouper les clés (`'carbuVehicles'`, `'carbuFavorites'`, etc.) en constantes nommées en haut de app.js
- **`saveFavorites()`** : extraire la sauvegarde des favoris (dupliquée ~6 fois) en une fonction dédiée, symétrique avec `saveVehicles()`
- **Suppression code mort PWA** : `initPwaInstall()`, bandeau, `beforeinstallprompt`

---

## Hors périmètre

- Pas de framework JS, pas de state management réactif
- Pas de refactoring cosmétique sur le code non touché
- Pas de modification du pipeline de données Python (sauf timestamps)
- Pas de modification du workflow GitHub Actions (sauf si nécessaire pour le nommage de fichiers)
