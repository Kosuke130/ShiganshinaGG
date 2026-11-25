# ShiganshinaGG

Application Windows légère pour suivre ton compte League of Legends, façon op.gg — mais sur ton PC.

- **Aperçu** : rangs Solo/Duo et Flex, 20 dernières parties (KDA, participation, CS/min, dégâts/min, vision, MVP/ACE), rôles joués, meilleure partie, champions récents, coéquipiers fréquents
- **Historique** : parties détaillées avec sorts, runes, objets, note de performance (0-10), badges MVP / ACE / multikills / premier sang, vis-à-vis de voie ; tableau complet des 10 joueurs, comparaison des équipes (objectifs, or, dégâts, bannissements) et analyse de ta performance (types de dégâts, CS à 10 min, solo kills, plaques, temps mort…). Filtres par file et par champion.
- **Analyse** : 12 indicateurs clés, courbe de tendance (winrate et KDA glissants), winrate par rôle, par durée de partie, par côté, selon les premiers objectifs, carte jour × moment, activité sur 30 jours, meilleurs et pires matchups, coéquipiers, records personnels
- **Champions** : tableau triable (KDA, KP, note, CS/min, dégâts/min, part des dégâts, or, vision) + fiche détaillée par champion (objets et runes favoris, adversaires de voie, dernières parties)
- **Maîtrises** : score, points, niveaux et progression de chaque champion, filtres par classe
- **Partie en cours** : les 10 joueurs avec leur rang, LP, winrate et rang moyen de chaque équipe (détection automatique pour ton compte)
- **Évolution des LP** : courbe, pic, plus bas, variation 24 h / 7 jours, gain moyen par victoire/défaite
- **Builds & tier list** (onglets Build, Runes, Objets, Compétences, Matchups, Statistiques : stats par rune et par fragment, objets par slot avec timings, écarts d'or/XP/CS à 15 min par matchup, meilleurs alliés, winrate selon la durée, comparaison avec la moyenne du rôle) : runes complètes, sorts, objets de départ, bottes, build principal dans l'ordre d'achat, objets suivants, ordre des compétences et matchups de chaque champion, calculés à partir de vraies parties classées de ta région, au rang de ton choix (Challenger, Maître+, Diamant+, Émeraude+… ou un seul rang, de Fer à Challenger ; import en arrière-plan, ≈ 10 min pour 300 parties avec une clé de développement). Tier list S+ à D par rôle (winrate lissé + popularité), avec part de la voie, winrate, pick, ban, et filtre « hors méta ».
- **Coach** : après chaque partie, compare tes stats (CS à 10 min, CS/min, dégâts, or, vision, morts, participation) à celles des Master+ sur le même champion et le même rôle, avec une note sur 100 et 2-3 conseils concrets
- **Comparer deux joueurs** : rangs, stats sur 20 parties, champions et historique commun (ensemble / l'un contre l'autre)
- **Import automatique** : 150 parties du patch en cours une fois par jour, au rang choisi (désactivable dans Paramètres) ; tous les imports ne gardent que le patch en cours
- **Emblèmes de rang officiels**
- **Groupes (premades)** : détection automatique des duos, trios, 4 stack et 5 stack dans la partie en cours et dans tout l'historique (en arrière-plan, résultats gardés en mémoire), d'après les parties récentes que les joueurs ont en commun
- **Navigation** : boutons précédent / suivant, Alt+← / Alt+→ et boutons latéraux de la souris
- **Favoris & recherches récentes** dans la barre latérale et la barre de recherche (raccourci `/`)

Construite avec Tauri (Rust + WebView2 de Windows) : quelques Mo, peu de mémoire, aucun processus en arrière-plan quand elle est fermée.

## Compiler sur Windows

1. Installe **Visual Studio Build Tools** en cochant « Développement Desktop en C++ » : https://visualstudio.microsoft.com/fr/visual-cpp-build-tools/
2. Installe **Rust** : https://rustup.rs (lance `rustup-init.exe` et garde les options par défaut)
3. Double-clique sur **`build-windows.bat`**. La première compilation prend 5 à 10 minutes.
4. Lance **`ShiganshinaGG.exe`**. Ce fichier est portable : tu peux le copier où tu veux.

Pour obtenir un installateur (setup.exe) à la place :
```
cargo install tauri-cli --version "^2" --locked
cd src-tauri
cargo tauri build
```

## Premier lancement

1. Dans **Paramètres**, colle ta clé API Riot (https://developer.riotgames.com). Une clé de développement expire au bout de 24 h : régénère-la puis recolle-la.
2. Entre ton Riot ID (`Nom#TAG`) et ta région.
3. Dans **Analyse** ou **Champions**, clique sur « Importer 100 parties » pour remplir les statistiques.

Si tu utilisais RiftPulse, tes paramètres, parties et historique de LP sont repris automatiquement au premier lancement.

## Bon à savoir

- **Note de performance** : calculée par ShiganshinaGG pour chaque joueur de la partie (participation, part des dégâts, de l'or, de la vision, des objectifs, KDA). Le meilleur gagnant est MVP, le meilleur perdant ACE.
- **LP** : l'API Riot ne fournit pas d'historique des LP. ShiganshinaGG enregistre ton rang à chaque ouverture, puis toutes les 10 minutes tant que l'appli est ouverte.
- **Parties en cache** : les parties déjà enregistrées par l'ancienne version sont retéléchargées automatiquement pour obtenir les nouvelles statistiques.
- **Données** : tout est stocké localement dans `%APPDATA%\app.shiganshinagg.desktop\`.

ShiganshinaGG n'est ni affilié à Riot Games ni approuvé par Riot Games.
