# TaM Montpellier

## Présentation

Cette intégration amène la **TaM**, les trams et bus de Montpellier Méditerranée Métropole, dans Gladys. Elle donne les **prochains départs, corrigés en temps réel, avec leur retard**, aux arrêts que vous choisissez (trois dans le formulaire, jusqu’à 10 de plus avec un bouton), filtrés par ligne et par direction. Elle suit aussi le **trafic** de six lignes au plus (normal, info trafic, perturbé, très perturbé), avec les alertes de la TaM : déviations, arrêts non desservis, travaux. Chaque arrêt et chaque ligne devient un appareil à afficher sur un tableau de bord et à utiliser dans des scènes.

Les données viennent de l’**open data officiel de la TaM**, publié sur `transport.data.gouv.fr` sous licence ODbL : ni compte ni clé. Elles couvrent les lignes urbaines et suburbaines. Les **horaires** (GTFS) sont téléchargés une fois par jour s’ils ont changé, et gardés par l’intégration. Le **temps réel** (GTFS-RT) de tout le réseau est lu en **une seule requête pour tous les arrêts suivis**, chaque minute par défaut (toutes les 10 minutes quand aucun arrêt n’annonce rien dans la demi-heure, la nuit). Les alertes sont lues toutes les 5 minutes.

Un départ est **suivi en temps réel** dès que le véhicule a quitté son terminus : son heure estimée et son retard sont donnés. Avant, ce sont les **horaires théoriques**, marqués « (théorique) ». Les **courses supprimées** et les **arrêts non desservis** sont signalés.

C’est une intégration **cloud** : elle contacte `gtfsproxy.e-tam.fr`. Rien d’autre ne quitte votre réseau.

## Prérequis

- Gladys Assistant 5.3.0 ou plus récent.
- Rien d’autre : l’open data de la TaM ne demande ni compte ni clé.

## Configuration

| Champ                 | Quoi saisir                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Arrêt 1, 2, 3         | Le nom de l’arrêt tel qu’écrit dessus (« Comédie », « Gare Saint-Roch ») ou le code d’un quai (« 41115 »).       |
| Ligne                 | Seulement cette ligne : « 1 », « 6 », « Amigo ». Vide : toutes les lignes de l’arrêt.                            |
| Direction             | Seulement les destinations qui contiennent ces mots : « Gare Sud », « Jacou \| Sabines ». Vide : les deux sens.  |
| Lignes suivies        | Les lignes dont vous suivez le trafic, six au plus : « 1, 2, 6, 17 ».                                            |
| Lecture du temps réel | Toutes les 30 secondes, chaque minute, toutes les 2 minutes ou toutes les 5 minutes.                             |
| Langue des textes     | Noms des appareils, résumés et sorties des scènes. Les noms d’arrêts et les messages trafic restent en français. |

Un arrêt réunit tous les quais de son nom, trams et bus : « Comédie » donne les deux sens des trams 1, 2 et 3. Le bouton **Chercher un arrêt** donne les arrêts qui contiennent quelques mots, avec les codes de leurs quais et leurs lignes (« Gare Saint-Roch [41135, 41221] → 1, 2, 3 »). Quelques mots suffisent quand un seul arrêt les contient (« rondel » → Rondelet). **Tester la connexion** redemande les horaires et lit aussitôt chaque arrêt et chaque ligne.

Une ligne s’écrit comme sur le véhicule : « 1 » à « 5 » pour les trams, « 6 », « 17 », « A », « Amigo »…

Plus d’arrêts que les trois du formulaire (domicile, travail, école…) : **Ajouter un arrêt** prend les trois mêmes champs — arrêt, ligne, direction — et suit jusqu’à 10 arrêts de plus. **Lister les arrêts** montre tous les arrêts suivis, numérotés ; **Retirer un arrêt** prend ce numéro (ou le nom). Les arrêts ajoutés sont gardés dans la configuration de Gladys, donc dans ses sauvegardes.

## Utilisation

### Appareils

Dans l’onglet **Découvrir**, créez les appareils voulus :

- **TaM \<arrêt\>** : le prochain départ en texte (« 1 → Gare Sud France · 3 min (+2 min de retard) »), l’attente du prochain départ et du suivant (minutes), et le retard du prochain (minutes, publié seulement quand il est suivi en temps réel) ;
- **TaM tram 1**, **TaM ligne 17**… : le trafic en texte (« Trafic perturbé : Rugby : La ligne 17 est déviée. ») et le nombre de messages trafic en cours.

La nuit, sans départ dans les trois heures, l’appareil donne le premier départ du matin.

### Trafic

La TaM publie des **alertes** : un texte, les lignes (ou les arrêts) concernées et leurs périodes. L’état d’une ligne vient de sa plus forte alerte en cours : **très perturbé** pour une interruption, **perturbé** pour une déviation, des arrêts non desservis ou des retards, **info trafic** sinon ; **normal** sans alerte. Une alerte qui commence dans les trois jours est affichée « à venir ».

### Widgets du tableau de bord

![Le widget des départs TaM à Gare Saint-Roch et le widget du trafic TaM des trams et de lignes de bus (illustration générée, pas une capture d’écran)](https://raw.githubusercontent.com/William-De71/gladys-tam-montpellier/main/docs/assets/widgets.fr.png)

- **Départs TaM** : les prochains départs d’un arrêt, en compact. Une ligne par ligne et destination, avec ses prochains départs à la suite (« 2 · 17 min »). Une course supprimée est affichée (« supprimé 22:48 ») et passe la ligne en orange, comme un retard de 5 minutes ou plus. Le réglage **Trajets affichés** fixe le nombre de lignes. Choisissez un arrêt suivi, ou saisissez n’importe quel arrêt (et une ligne) dans les réglages du widget. Avec **Plusieurs arrêts**, un widget montre plusieurs appareils d’arrêt : ceux d’un même arrêt sont réunis sous son nom ; pour des arrêts différents, chaque arrêt commence par une ligne à son nom.
- **Trafic TaM** : l’état de chaque ligne, puis les alertes en cours et celles des trois prochains jours, avec leur période. Touchez une carte pour le texte complet. Les lignes suivies, celles saisies dans les réglages, ou les cinq lignes de tram si vous n’en suivez aucune.

### Scènes

Déclencheurs, une fois par changement (la première lecture sert seulement de référence) :

- **TaM : départ bientôt** : un départ d’un arrêt suivi part dans 2, 3, 5, 10, 15 ou 20 minutes, compté sur son estimation en temps réel.
- **TaM : départ supprimé** : une course de l’heure à venir d’un arrêt suivi est supprimée, ou ne dessert pas l’arrêt.
- **TaM : ligne perturbée** : une ligne suivie devient perturbée ou très perturbée.
- **TaM : fin de perturbation** : plus aucune perturbation en cours sur la ligne.
- **TaM : nouveau message trafic** : la TaM publie une alerte sur une ligne suivie, en cours ou à venir.

Chacun donne une phrase toute prête, `{{triggerEvent.data.summary}}`, et ses valeurs (ligne, destination, heure, retard, titre, texte, début et fin…). Les actions **TaM : prochains départs** et **TaM : trafic d’une ligne** renvoient le même genre de valeurs, à mettre dans un message ou à tester dans une condition.

Exemples :

- Quand le tram 1 vers Gare Sud France part de Comédie dans 5 minutes → passer la lampe de l’entrée en vert.
- Quand un départ de votre arrêt est supprimé, ou que la ligne 17 est déviée → envoyer le résumé sur votre téléphone avant de partir.
- Chaque jour de semaine à 7 h 30 → lire les prochains départs de votre arrêt et les faire annoncer par l’enceinte de la cuisine.

### Transport

Cloud uniquement : les données viennent d’internet. Les horaires une fois par jour, le temps réel de tout le réseau en une requête, les alertes toutes les 5 minutes.

## Dépannage

- **« Inconnu ou ambigu »** : utilisez **Chercher un arrêt**, puis copiez le nom exact ou un code de quai ; pour une ligne, son nom comme sur le véhicule (« 1 », « 17 », « Amigo »).
- **« (théorique) » après un départ** : le véhicule n’a pas encore quitté son terminus, ou la TaM ne le suit pas ; l’heure est celle des horaires.
- **Aucun départ dans la direction saisie** : les destinations sont celles écrites sur les véhicules (« Gare Sud France », « Occitanie ») ; videz la direction pour toutes les voir.
- **« L’open data de la TaM ne répond pas »** : l’intégration réessaie à chaque lecture ; en attendant, les départs viennent des horaires gardés.
- **Pour signaler un problème** : appuyez sur **Diagnostic**, puis copiez les lignes commençant par « TaM diagnostic » de l’onglet Journaux dans une issue GitHub ou une réponse sur le forum, avec les versions de Gladys et de l’intégration.
