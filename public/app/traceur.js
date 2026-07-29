
/* ============================================================
   ÉTAT
   ============================================================ */
const SEG_COLORS = ['#2E4A38','#C9752E','#3C6E8F','#A5432E','#8A6D3B','#5E7A4A','#B08968','#4C6E56','#7A5C8E','#3E6B5C'];

let rawPoints = [];   // points tels que chargés (ordre du fichier, jamais modifiés après reverse global)
let points = [];      // copie de travail, peut être inversée
let cum = [];         // distances cumulées (m) alignées sur `points`
let startIdx = 0;
let endIdx = 0;
let boundaries = [];  // ex: [startIdx, b1, b2, ..., endIdx]

let map, osmLayer, topoLayer;
let bgPolyline = null;
let segPolylines = [];
let startMarker = null, endMarker = null;
let boundMarkers = [];
let loopMarker = null;      // repère fusionné Départ/Arrivée, affiché uniquement en mode "déplacement de boucle"
let loopMoveMode = false;   // true tant que l'utilisateur n'a pas reposé le repère fusionné sur le tracé
const LOOP_THRESHOLD_M = 200; // distance max (m) entre départ et arrivée pour considérer le parcours comme une boucle

/* ============================================================
   HISTORIQUE (bouton "Annuler" du header)
   ============================================================ */
/* Empile un instantané de l'état AVANT chaque action qui modifie le tracé
   (chargement, inversion, réinitialisation, déplacement des repères D/A/
   frontières, découpage en jours, suppression d'un jour, fusion...), afin de
   permettre de revenir en arrière quelle que soit l'action effectuée. */
let undoStack = [];
const UNDO_MAX = 50;

function cloneTrackState(){
  return {
    rawPoints: rawPoints.map(p => ({lat:p.lat, lon:p.lon, ele:p.ele})),
    points: points.map(p => ({lat:p.lat, lon:p.lon, ele:p.ele})),
    startIdx, endIdx,
    boundaries: boundaries.slice(),
    pois: pois.map(p => ({...p}))
  };
}

function pushUndo(){
  if(points.length === 0) return; // rien à quoi revenir avant le tout premier chargement
  undoStack.push(cloneTrackState());
  if(undoStack.length > UNDO_MAX) undoStack.shift();
  updateUndoBtn();
}

function updateUndoBtn(){
  document.getElementById('undoBtn').disabled = undoStack.length === 0;
}

function restoreTrackState(state){
  externalPoiFetchToken++; // invalide toute requête POI externe encore en cours pour l'état qu'on quitte
  rawPoints = state.rawPoints.map(p => ({lat:p.lat, lon:p.lon, ele:p.ele}));
  points = state.points.map(p => ({lat:p.lat, lon:p.lon, ele:p.ele}));
  cum = computeCum(points);
  recomputeElevSmooth();
  startIdx = state.startIdx;
  endIdx = state.endIdx;
  boundaries = state.boundaries.slice();
  pois = state.pois.map(p => ({...p}));
  loopMoveMode = false;
  enableUIAfterLoad();
  renderAll();
  renderPOIs();
}

document.getElementById('undoBtn').addEventListener('click', () => {
  const prev = undoStack.pop();
  if(!prev) return;
  if(mergeState) exitMergeMode();
  restoreTrackState(prev);
  updateUndoBtn();
});

let pois = [];              // points d'intérêt (wpt) du fichier chargé, indépendants du tracé
let poiLayerGroups = {};    // catégorie -> L.layerGroup posé sur la carte
let poiVisible = {};        // catégorie -> bool (case cochée)
let poiMasterVisible = true;

const POI_CAT_META = {
  water:   {label:'Eau potable',           emoji:'💧', color:'#3C6E8F'},
  toilets: {label:'Toilettes',             emoji:'🚻', color:'#7A5C8E'},
  bakery:  {label:'Boulangerie',           emoji:'🥖', color:'#B5762C'},
  shop:    {label:'Épicerie / Alimentation', emoji:'🛒', color:'#C9752E'},
  food:    {label:'Café / Restauration',   emoji:'☕', color:'#A5432E'},
  lodging: {label:'Hébergement',           emoji:'🛏️', color:'#4C6E56'},
  other:   {label:'Autre',                 emoji:'📍', color:'#8A6D3B'}
};
const POI_CAT_ORDER = ['water','toilets','bakery','shop','food','lodging','other'];

/* fusion de 2 parcours GPX */
let mergeState = null; // null hors fusion ; sinon {track2, segments, crossings, hasStart1, hasEnd1, hasStart2, hasEnd2, selectedSegId, layers}
let mergeBannerTimeout = null;

/* ============================================================
   CARTE
   ============================================================ */
function initMap(){
  map = L.map('map', {zoomControl:true}).setView([45.75, 4.85], 6);

  osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  });

  topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    subdomains: ['a','b','c'],
    attribution: 'Données © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
  });

  // Fond par défaut : carte topo avec courbes de niveau.
  topoLayer.addTo(map);

  // Si la carte topo échoue à charger (tuiles indisponibles), on revient
  // silencieusement sur le plan OpenStreetMap standard.
  let topoErrors = 0;
  topoLayer.on('tileerror', () => {
    topoErrors++;
    if(topoErrors > 8 && map.hasLayer(topoLayer)){
      map.removeLayer(topoLayer);
      if(!map.hasLayer(osmLayer)) osmLayer.addTo(map);
    }
  });
}
initMap();
window.addEventListener('resize', () => {
  map.invalidateSize();
  updateElevationProfile();
});
setTimeout(() => map.invalidateSize(), 200);

/* ============================================================
   UTILITAIRES GÉO
   ============================================================ */
function haversine(lat1, lon1, lat2, lon2){
  const R = 6371000, toRad = d => d*Math.PI/180;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function computeCum(pts){
  const c = [0];
  for(let i=1;i<pts.length;i++) c.push(c[i-1] + haversine(pts[i-1].lat, pts[i-1].lon, pts[i].lat, pts[i].lon));
  return c;
}
function distBetween(a,b){ return cum[b] - cum[a]; }

/* Un parcours est considéré comme une "boucle" quand son départ et son
   arrivée actuels (repères D et A, pas forcément les extrémités brutes du
   fichier si l'utilisateur les a déjà déplacés) sont distants d'au plus
   LOOP_THRESHOLD_M. On l'exige aussi hors découpage en jours actif, pour ne
   pas mélanger fusion du point de jonction et frontières internes. */
function isLoopTrack(){
  if(!points.length || boundaries.length !== 2) return false;
  return haversine(points[startIdx].lat, points[startIdx].lon, points[endIdx].lat, points[endIdx].lon) <= LOOP_THRESHOLD_M;
}

/* Le signal d'altitude brut d'un GPX (GPS ou baro) est bruité : de petites
   oscillations de ±1 à 5 m entre points consécutifs, sommées telles quelles,
   gonflent artificiellement le dénivelé cumulé (souvent x1.5 à x3 par rapport
   à un outil qui lisse le profil avant de calculer). On lisse donc l'altitude
   par une moyenne glissante définie en distance (pas en nombre de points, pour
   rester cohérent quelle que soit la densité d'enregistrement du traceur),
   puis on calcule le dénivelé sur ce profil lissé — comme le font la plupart
   des outils de randonnée. */
let elevSmooth = [];
let smoothWindow = 350; // mètres — fenêtre de lissage fixe utilisée pour le calcul du dénivelé

function computeSmoothedElevations(pts, cumArr, windowMeters){
  const n = pts.length;
  const out = new Array(n);
  if(windowMeters <= 0){
    for(let i=0;i<n;i++) out[i] = pts[i].ele;
    return out;
  }
  const half = windowMeters / 2;
  let lo = 0, hi = 0, sum = 0;
  for(let i=0;i<n;i++){
    if(i===0){
      while(hi < n-1 && cumArr[hi+1] - cumArr[0] <= half) hi++;
      for(let k=0;k<=hi;k++) sum += pts[k].ele;
    } else {
      while(hi < n-1 && cumArr[hi+1] - cumArr[i] <= half){ hi++; sum += pts[hi].ele; }
    }
    while(cumArr[i] - cumArr[lo] > half){ sum -= pts[lo].ele; lo++; }
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

function recomputeElevSmooth(){
  elevSmooth = computeSmoothedElevations(points, cum, smoothWindow);
}

function elevGainLoss(a,b){
  let gain=0, loss=0;
  for(let i=a+1;i<=b;i++){
    const d = elevSmooth[i] - elevSmooth[i-1];
    if(d>0) gain+=d; else loss += -d;
  }
  return {gain, loss};
}
function nearestIndex(lat, lon, lo, hi){
  return nearestIndexIn(points, lat, lon, lo, hi);
}
/* Version générique (utilisable sur n'importe quel tableau de points, ex.
   le 2e parcours lors d'une fusion), la variante ci-dessus ne fait que
   déléguer ici avec le tableau `points` global pour ne rien casser des
   usages existants. */
function nearestIndexIn(pts, lat, lon, lo, hi){
  let best=lo, bd=Infinity;
  for(let i=lo;i<=hi;i++){
    const d = haversine(lat,lon, pts[i].lat, pts[i].lon);
    if(d<bd){bd=d; best=i;}
  }
  return best;
}

/* ============================================================
   GÉOMÉTRIE — croisement de 2 tracés (fusion de parcours)
   ============================================================ */
/* Un "croisement" est défini par la proximité réelle entre les 2 tracés,
   pas par une intersection géométrique exacte des segments :
   - les 2 tracés sont considérés "joints" tant qu'ils restent à moins de
     JOIN_SPLIT_THRESHOLD_M l'un de l'autre ;
   - le passage sous ce seuil (jonction) et le passage au-dessus
     (séparation) sont chacun un point de croisement.
   Ce modèle gère correctement les portions où les 2 tracés suivent le
   même sentier sur une certaine distance (pas seulement un point unique
   d'intersection). */
const JOIN_SPLIT_THRESHOLD_M = 20;
// Nombre de points consécutifs requis dans le nouvel état avant de
// confirmer une transition : évite qu'un bruit GPS pile au seuil ne
// génère une rafale de faux croisements très rapprochés.
const JOIN_SPLIT_DEBOUNCE_PTS = 3;
// 2 points de croisement distants de moins de CROSS_MERGE_DIST_M sont
// fusionnés en un seul : au-delà du simple anti-rebond ci-dessus, ça évite
// de créer plusieurs croisements quasi confondus (ex. les 2 tracés
// oscillent brièvement autour du seuil de proximité sur une courte
// distance) qui compliqueraient inutilement le graphe de fusion.
const CROSS_MERGE_DIST_M = 30;

/* Grille spatiale restreinte à un sous-intervalle [lo,hi] d'un tracé —
   variante de buildPointGrid utile ici car track1/track2 sont toujours
   manipulés avec leurs propres bornes startIdx/endIdx. */
function buildPointGridRange(pts, lo, hi, cellSize){
  const grid = new Map();
  for(let idx=lo; idx<=hi; idx++){
    const p = pts[idx];
    const key = Math.floor(p.lon/cellSize) + '_' + Math.floor(p.lat/cellSize);
    if(!grid.has(key)) grid.set(key, []);
    grid.get(key).push(idx);
  }
  return grid;
}

/* Pour chaque point de pts1 (sur [lo1,hi1]), calcule sa distance minimale
   à pts2 (sur [lo2,hi2]) et détecte les transitions proche/loin autour de
   thresholdM. Retourne un point de croisement {i1, lat, lon} par
   transition confirmée (jonction ou séparation). */
function findProximityCrossings(pts1, lo1, hi1, pts2, lo2, hi2, thresholdM){
  const cellSize = 0.0015; // ~150 m — cohérent avec le reste du fichier
  const grid2 = buildPointGridRange(pts2, lo2, hi2, cellSize);

  const close = new Array(hi1 + 1);
  for(let i=lo1; i<=hi1; i++){
    const d = minDistanceToTrack(pts2, grid2, cellSize, pts1[i].lat, pts1[i].lon);
    close[i] = d <= thresholdM;
  }

  const transitions = [];
  let state = close[lo1];
  let i = lo1 + 1;
  while(i <= hi1){
    if(close[i] !== state){
      let run = 1;
      while(i + run <= hi1 && close[i + run] === close[i]) run++;
      if(run >= JOIN_SPLIT_DEBOUNCE_PTS || i + run > hi1){
        transitions.push(i);
        state = close[i];
        i += run;
        continue;
      }
    }
    i++;
  }
  return clusterNearbyCrossings(
    transitions.map(idx => ({i1: idx, lat: pts1[idx].lat, lon: pts1[idx].lon}))
  );
}

/* Fusionne les points de croisement consécutifs (dans l'ordre du tracé)
   distants de moins de CROSS_MERGE_DIST_M en un seul, en gardant le point
   central de chaque groupe comme représentant — même logique que l'ancien
   regroupement par indice, mais basée sur une vraie distance en mètres. */
function clusterNearbyCrossings(points){
  if(points.length === 0) return [];
  const clusters = [];
  let current = [points[0]];
  for(let k=1;k<points.length;k++){
    const prev = current[current.length-1];
    const d = haversine(prev.lat, prev.lon, points[k].lat, points[k].lon);
    if(d <= CROSS_MERGE_DIST_M){
      current.push(points[k]);
    } else {
      clusters.push(current);
      current = [points[k]];
    }
  }
  clusters.push(current);
  return clusters.map(c => c[Math.floor(c.length/2)]);
}

/* ============================================================
   POI (points d'intérêt) — classification par mots-clés
   ============================================================ */
/* Les exports GPX (OnRouteMap et consorts) utilisent des libellés de type
   très variés et pas toujours normalisés ("Eau potable", "Cimetière (eau
   potable)", "Épicerie"...). On classe donc chaque wpt dans une poignée de
   catégories utiles en rando, par recherche de mots-clés insensible aux
   accents et à la casse, plutôt que par correspondance exacte. */
function stripAccents(str){
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function classifyPoi(typeStr, nameStr){
  const s = stripAccents(((typeStr || '') + ' ' + (nameStr || '')).toLowerCase());
  if(/\b(eau|fontaine|source|potable|robinet)\b/.test(s)) return 'water';
  if(/toilette|wc\b|sanitaire/.test(s)) return 'toilets';
  if(/boulangerie|boulanger\b/.test(s)) return 'bakery';
  if(/epicerie|supermarche|superette|alimentation|boucherie|primeur|commerce/.test(s)) return 'shop';
  if(/cafe|restaurant|restauration|snack|pizza|bar\b|auberge(?!.*(gite|dortoir))/.test(s)) return 'food';
  if(/gite|hotel|camping|refuge|dortoir|hebergement|chambre/.test(s)) return 'lodging';
  return 'other';
}

function poiIcon(cat){
  const meta = POI_CAT_META[cat] || POI_CAT_META.other;
  return L.divIcon({
    className: '',
    html: `<div class="poi-pin" style="width:24px;height:24px;background:${meta.color};">${meta.emoji}</div>`,
    iconSize: [24,24],
    iconAnchor: [12,12],
    popupAnchor: [0,-10]
  });
}

/* ============================================================
   GPX
   ============================================================ */
function parseGPX(text){
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if(xml.querySelector('parsererror')) throw new Error('Fichier GPX invalide.');
  let nodes = Array.from(xml.getElementsByTagName('trkpt'));
  if(nodes.length === 0) nodes = Array.from(xml.getElementsByTagName('rtept'));
  if(nodes.length === 0) throw new Error('Aucun point de tracé (trkpt/rtept) trouvé dans ce fichier.');
  const points = nodes.map(n => {
    const eleNode = n.getElementsByTagName('ele')[0];
    return {
      lat: parseFloat(n.getAttribute('lat')),
      lon: parseFloat(n.getAttribute('lon')),
      ele: eleNode ? parseFloat(eleNode.textContent) : 0
    };
  }).filter(p => !isNaN(p.lat) && !isNaN(p.lon));

  return {points, pois: parseGPXPois(xml)};
}

/* Les wpt d'un GPX "avec POI" décrivent des points d'intérêt le long du
   parcours (eau, toilettes, commerces...). Certains exports ajoutent aussi
   un wpt technique à lat=0/lon=0 (repère de titre, sans intérêt cartographique)
   qu'on écarte, ainsi que tout wpt sans nom ni type exploitable. */
function parseGPXPois(xml){
  const wptNodes = Array.from(xml.getElementsByTagName('wpt'));
  const out = [];
  wptNodes.forEach(n => {
    const lat = parseFloat(n.getAttribute('lat'));
    const lon = parseFloat(n.getAttribute('lon'));
    if(isNaN(lat) || isNaN(lon)) return;
    if(lat === 0 && lon === 0) return;
    const nameNode = n.getElementsByTagName('name')[0];
    const typeNode = n.getElementsByTagName('type')[0];
    const descNode = n.getElementsByTagName('desc')[0];
    const name = nameNode ? nameNode.textContent.trim() : '';
    const type = typeNode ? typeNode.textContent.trim() : '';
    const desc = descNode ? descNode.textContent.trim() : '';
    if(!name && !type) return;
    out.push({lat, lon, name, type, desc, cat: classifyPoi(type, name)});
  });
  return out;
}

/* ============================================================
   POI EXTERNES (points d'eau, boulangeries, toilettes) — API Overpass
   ============================================================
   Au chargement d'un GPX, on interroge Overpass (données OpenStreetMap)
   le long du corridor du tracé pour compléter automatiquement les POI du
   fichier avec les points d'eau potable, boulangeries et toilettes publiques
   répertoriés à proximité. Seuls les résultats à 150 m maximum du tracé
   (distance réelle au tracé, pas seulement à la zone englobante) sont
   conservés. */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const EXTERNAL_POI_RADIUS_M = 150;       // seuil final, exact, appliqué côté client
const EXTERNAL_POI_QUERY_MARGIN_M = 220; // rayon envoyé à Overpass (marge de sécurité pour l'échantillonnage)
let externalPoiFetchToken = 0; // permet d'ignorer une réponse tardive si un autre tracé a entretemps été chargé

/* Échantillonne le tracé tous les `spacingM` mètres de distance cumulée,
   pour construire la liste de centres du corridor envoyée à Overpass
   (filtre "around" avec une liste de coordonnées). */
function buildCorridorAnchors(pts, spacingM){
  const c = computeCum(pts);
  const coords = [{lat:pts[0].lat, lon:pts[0].lon}];
  let next = spacingM;
  for(let i=1;i<pts.length;i++){
    if(c[i] >= next){
      coords.push({lat:pts[i].lat, lon:pts[i].lon});
      next += spacingM;
    }
  }
  const last = pts[pts.length-1];
  if(coords[coords.length-1].lat !== last.lat || coords[coords.length-1].lon !== last.lon){
    coords.push({lat:last.lat, lon:last.lon});
  }
  return coords;
}

function buildOverpassQuery(anchors, catFilters){
  const coordStr = anchors.map(p => p.lat.toFixed(6) + ',' + p.lon.toFixed(6)).join(',');
  const r = EXTERNAL_POI_QUERY_MARGIN_M;
  const parts = catFilters.map(f => `node(around:${r},${coordStr})[${f}];`).join('');
  return `[out:json][timeout:30];(${parts});out body;`;
}

const EXTERNAL_POI_TAG_FILTERS = {
  water:   '"amenity"="drinking_water"',
  bakery:  '"shop"="bakery"',
  toilets: '"amenity"="toilets"'
};

async function fetchOverpass(query){
  let lastErr = null;
  for(const url of OVERPASS_ENDPOINTS){
    try{
      const res = await fetch(url, {method:'POST', body: 'data=' + encodeURIComponent(query)});
      if(!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    }catch(err){ lastErr = err; }
  }
  throw lastErr || new Error('Overpass indisponible');
}

/* Une seule requête Overpass avec TOUTES les ancres du corridor pouvait
   dépasser le timeout serveur (30s) sur les longs parcours, faisant
   échouer toute la recherche. On lotit donc les ancres par petits paquets,
   envoyés en parallèle avec une concurrence limitée (pour rester correct
   vis-à-vis du service public partagé), chaque paquet ayant largement le
   temps de répondre. On n'affiche les résultats sur la carte qu'une fois
   TOUS les lots revenus (succès ou échec). */
const POI_BATCH_ANCHOR_COUNT = 120; // ancres par requête
const POI_BATCH_CONCURRENCY = 3;    // requêtes Overpass simultanées max

function chunkArray(arr, size){
  const out = [];
  for(let i=0; i<arr.length; i+=size) out.push(arr.slice(i, i+size));
  return out;
}

/* Exécute `tasks` (fonctions renvoyant une Promise) avec au plus `limit`
   en vol simultanément ; résout toujours (jamais de rejet global), avec un
   résultat par tâche au format {status:'fulfilled', value} ou
   {status:'rejected', reason}, dans l'ordre d'origine des tâches. */
async function runWithConcurrency(tasks, limit){
  const results = new Array(tasks.length);
  let next = 0;
  async function worker(){
    while(next < tasks.length){
      const i = next++;
      try{ results[i] = {status: 'fulfilled', value: await tasks[i]()}; }
      catch(err){ results[i] = {status: 'rejected', reason: err}; }
    }
  }
  const workers = Array.from({length: Math.min(limit, tasks.length)}, worker);
  await Promise.all(workers);
  return results;
}

function classifyExternalPoi(tags){
  if(tags.amenity === 'drinking_water') return 'water';
  if(tags.shop === 'bakery') return 'bakery';
  if(tags.amenity === 'toilets') return 'toilets';
  return null;
}

/* Grille spatiale grossière (mêmes principes que findCrossings) pour
   retrouver rapidement, pour un point candidat, les points du tracé situés
   dans son voisinage immédiat plutôt que de comparer à tout le tracé. */
function buildPointGrid(pts, cellSize){
  const grid = new Map();
  pts.forEach((p, idx) => {
    const key = Math.floor(p.lon/cellSize) + '_' + Math.floor(p.lat/cellSize);
    if(!grid.has(key)) grid.set(key, []);
    grid.get(key).push(idx);
  });
  return grid;
}

function minDistanceToTrack(pts, grid, cellSize, lat, lon){
  const cx = Math.floor(lon/cellSize), cy = Math.floor(lat/cellSize);
  for(let ring=1; ring<=4; ring++){
    let best = Infinity;
    for(let dx=-ring; dx<=ring; dx++){
      for(let dy=-ring; dy<=ring; dy++){
        const arr = grid.get((cx+dx)+'_'+(cy+dy));
        if(!arr) continue;
        arr.forEach(idx => {
          const d = haversine(lat, lon, pts[idx].lat, pts[idx].lon);
          if(d < best) best = d;
        });
      }
    }
    if(best < Infinity) return best;
  }
  return Infinity;
}

const EXTERNAL_POI_SEARCH_LABELS = {
  water:   "points d'eau potable",
  bakery:  'boulangeries',
  toilets: 'toilettes publiques'
};

/* Ne garde, parmi `poisArr`, que les POI situés à moins de `radiusM` du
   tracé `trackPts`. Sert à nettoyer automatiquement les POI qui se
   retrouvaient sur une portion de tracé supprimée (ex. suppression d'un
   segment lors d'une fusion de 2 parcours) : sans ce filtre, ils restaient
   affichés alors qu'ils ne sont plus proches d'aucun point du tracé final. */
const MERGE_POI_KEEP_RADIUS_M = 300;
function filterPoisNearTrack(poisArr, trackPts, radiusM){
  if(!poisArr || poisArr.length === 0) return [];
  if(!trackPts || trackPts.length === 0) return [];
  const cellSize = 0.0015;
  const grid = buildPointGrid(trackPts, cellSize);
  return poisArr.filter(p => minDistanceToTrack(trackPts, grid, cellSize, p.lat, p.lon) <= radiusM);
}

function joinFr(list){
  if(list.length === 0) return '';
  if(list.length === 1) return list[0];
  return list.slice(0, -1).join(', ') + ' et ' + list[list.length - 1];
}

function showPoiLoadingPopin(cats, batchCount){
  const labels = (cats || []).map(c => EXTERNAL_POI_SEARCH_LABELS[c]).filter(Boolean);
  const text = labels.length
    ? `Recherche des ${joinFr(labels)} à proximité du parcours…`
    : 'Recherche des points à proximité du parcours…';
  document.getElementById('poiLoadingText').textContent = text;
  document.getElementById('poiLoadingPopin').dataset.baseText = text;
  document.getElementById('poiLoadingPopin').dataset.batchCount = batchCount || '';
  document.getElementById('poiLoadingPopin').style.display = 'flex';
}
function updatePoiLoadingProgress(received, total){
  if(!total || total <= 1) return; // pas la peine d'afficher "1/1"
  const popin = document.getElementById('poiLoadingPopin');
  const base = popin.dataset.baseText || '';
  document.getElementById('poiLoadingText').textContent = `${base} (${received}/${total})`;
}
function hidePoiLoadingPopin(){ document.getElementById('poiLoadingPopin').style.display = 'none'; }

/* Récupère les POI externes autour du tracé `pts`, pour les catégories
   demandées uniquement (`cats`, sous-ensemble de ['water','bakery','toilets']),
   et les ajoute à `pois` (marqués `source:'api'`). Seules les catégories
   effectivement recherchées sont remplacées : relancer une recherche sur
   une catégorie ne fait pas disparaître les résultats déjà obtenus pour une
   autre. `externalPoiFetchToken` permet d'ignorer une réponse arrivée après
   qu'un autre tracé a été chargé, ou après un "Annuler" (undo).*/
async function fetchNearbyPois(pts, cats){
  if(!cats || cats.length === 0) return;
  const myToken = ++externalPoiFetchToken;
  const total = computeCum(pts).slice(-1)[0] || 0;
  const spacing = Math.max(120, total / 900); // borne le nombre d'ancres même sur un très long tracé
  const anchors = buildCorridorAnchors(pts, spacing);
  const catFilters = cats.map(c => EXTERNAL_POI_TAG_FILTERS[c]).filter(Boolean);
  const batches = chunkArray(anchors, POI_BATCH_ANCHOR_COUNT);

  showPoiLoadingPopin(cats, batches.length);
  try{
    let received = 0;
    const tasks = batches.map(batch => async () => {
      const data = await fetchOverpass(buildOverpassQuery(batch, catFilters));
      received++;
      if(myToken === externalPoiFetchToken) updatePoiLoadingProgress(received, batches.length);
      return data;
    });
    const settled = await runWithConcurrency(tasks, POI_BATCH_CONCURRENCY);
    if(myToken !== externalPoiFetchToken) return; // un autre tracé a été chargé entretemps

    const oks = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
    if(oks.length === 0){
      const firstErr = settled.find(r => r.status === 'rejected');
      throw (firstErr && firstErr.reason) || new Error('Overpass indisponible');
    }

    const grid = buildPointGrid(pts, 0.0015);
    const found = [];
    oks.forEach(data => {
      (data.elements || []).forEach(el => {
        if(el.type !== 'node' || typeof el.lat !== 'number' || typeof el.lon !== 'number') return;
        const cat = classifyExternalPoi(el.tags || {});
        if(!cat || !cats.includes(cat)) return;
        const d = minDistanceToTrack(pts, grid, 0.0015, el.lat, el.lon);
        if(d > EXTERNAL_POI_RADIUS_M) return;
        const tags = el.tags || {};
        const meta = POI_CAT_META[cat];
        found.push({
          lat: el.lat, lon: el.lon,
          name: tags.name || meta.label,
          type: meta.label,
          desc: '',
          cat,
          source: 'api'
        });
      });
    });

    // Un même POI peut apparaître dans 2 lots voisins (zone de recouvrement
    // du corridor entre la dernière ancre d'un lot et la première du
    // suivant) : on déduplique avant d'afficher.
    const seen = new Set();
    const dedup = found.filter(p => {
      const key = p.cat + '_' + p.lat.toFixed(5) + '_' + p.lon.toFixed(5);
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    pois = pois.filter(p => !(p.source === 'api' && cats.includes(p.cat))).concat(dedup);
    renderPOIs();
    if(oks.length < batches.length){
      console.warn(`Recherche de POI : ${batches.length - oks.length}/${batches.length} lot(s) Overpass en échec, résultats partiels affichés.`);
    }
  }catch(err){
    if(myToken === externalPoiFetchToken){
      console.warn("Récupération des points d'eau / boulangeries / toilettes impossible :", err);
      alert("La recherche des POI à proximité a échoué (service Overpass indisponible). Réessayez plus tard.");
    }
  }finally{
    if(myToken === externalPoiFetchToken) hidePoiLoadingPopin();
  }
}

function handleGpxText(text){
  try{
    const {points: pts, pois: poisArr} = parseGPX(text);
    if(pts.length < 2) throw new Error('Le tracé doit contenir au moins 2 points.');
    loadTrack(pts, poisArr);
  }catch(err){
    alert('Erreur : ' + err.message);
  }
}

document.getElementById('fileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = evt => handleGpxText(evt.target.result);
  reader.readAsText(file);
  e.target.value = '';
});

/* ============================================================
   MODE SIMPLE / MODE AVANCÉ
   ============================================================ */
function setMode(mode){
  const simple = mode === 'simple';
  document.getElementById('modeSimpleBtn').classList.toggle('active', simple);
  document.getElementById('modeSimpleBtn').setAttribute('aria-selected', simple);
  document.getElementById('modeAdvancedBtn').classList.toggle('active', !simple);
  document.getElementById('modeAdvancedBtn').setAttribute('aria-selected', !simple);
  document.getElementById('simpleModeControls').style.display = simple ? 'flex' : 'none';
  document.getElementById('advancedModeControls').style.display = simple ? 'none' : 'flex';
}
document.getElementById('modeSimpleBtn').addEventListener('click', () => setMode('simple'));
document.getElementById('modeAdvancedBtn').addEventListener('click', () => setMode('advanced'));
setMode('simple'); // mode par défaut

/* Le dossier "base-gpx" est listé automatiquement au démarrage. Une page web
   ne peut pas parcourir le disque toute seule : on va donc chercher, via
   fetch(), soit un petit manifeste base-gpx/manifest.json (["etape1.gpx", ...]),
   soit — à défaut — la page de listing que génèrent la plupart des serveurs
   web statiques pour un dossier (ex. `python -m http.server`). Cela ne
   fonctionne que si la page est servie via http(s) (pas en double-cliquant
   sur le fichier), ce qui est indiqué à l'utilisateur si rien n'est trouvé. */
let baseGpxNames = [];

async function fetchManifestNames(){
  try{
    const res = await fetch('/base-gpx/manifest.json', {cache:'no-store'});
    if(!res.ok) return null;
    const data = await res.json();
    if(Array.isArray(data)) return data.filter(n => /\.gpx$/i.test(n));
    return null;
  }catch(e){ return null; }
}

async function fetchDirectoryListingNames(){
  try{
    const res = await fetch('/base-gpx/', {cache:'no-store'});
    if(!res.ok) return null;
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const names = Array.from(doc.querySelectorAll('a[href]'))
      .map(a => decodeURIComponent(a.getAttribute('href')))
      .filter(href => /\.gpx$/i.test(href))
      .map(href => href.split('/').pop());
    return names.length ? names : null;
  }catch(e){ return null; }
}

async function loadBaseGpxList(){
  const sel = document.getElementById('baseGpxSelect');
  const prepareBtn = document.getElementById('prepareStepsBtn');
  const hint = document.getElementById('baseGpxHint');

  let names = await fetchManifestNames();
  if(!names) names = await fetchDirectoryListingNames();

  if(!names || names.length === 0){
    sel.innerHTML = '<option value="">Aucun fichier trouvé dans base-gpx/</option>';
    sel.disabled = true;
    prepareBtn.disabled = true;
    hint.style.display = 'inline';
    hint.innerHTML = "Rien trouvé automatiquement : servez la page via un serveur local (ex. <code>python -m http.server</code> depuis le dossier contenant <code>base-gpx/</code>), ou ajoutez <code>base-gpx/manifest.json</code> listant vos fichiers.";
    return;
  }

  names = [...new Set(names)].sort((a,b) => a.localeCompare(b, 'fr'));
  baseGpxNames = names;
  hint.style.display = 'none';
  sel.innerHTML = '';
  names.forEach((n, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = n.replace(/\.gpx$/i, '');
    sel.appendChild(opt);
  });
  sel.disabled = false;
  prepareBtn.disabled = false;
}
loadBaseGpxList();

document.getElementById('prepareStepsBtn').addEventListener('click', async () => {
  const idx = parseInt(document.getElementById('baseGpxSelect').value, 10);
  const name = baseGpxNames[idx];
  if(!name) return;
  try{
    const res = await fetch('/base-gpx/' + encodeURIComponent(name), {cache:'no-store'});
    if(!res.ok) throw new Error(`Impossible de charger "base-gpx/${name}".`);
    const text = await res.text();
    handleGpxText(text);
  }catch(err){
    alert('Erreur : ' + err.message);
  }
});

function enableUIAfterLoad(){
  document.getElementById('reverseBtn').disabled = false;
  document.getElementById('resetBtn').disabled = false;
  document.getElementById('splitCard').style.display = 'block';
  document.getElementById('statsEmpty').style.display = 'none';
  document.getElementById('statsBody').style.display = 'block';
  document.getElementById('mapEmpty').style.display = 'none';
  document.getElementById('segCount').max = Math.max(2, Math.min(20, Math.floor(points.length/2)));
  document.getElementById('saveStateBtn').disabled = false;
  document.getElementById('exportStateBtn').disabled = false;
  document.getElementById('addGpxBtn').disabled = false;
  document.getElementById('findPoiBtn').disabled = false;
}

/* Applique un état complet (import GPX initial, reprise d'une sauvegarde
   mémoire, ou import d'un fichier .te) : recalcule tout et met à jour l'UI. */
function applyState(state){
  if(mergeState) exitMergeMode();
  pushUndo();
  loopMoveMode = false;
  rawPoints = state.rawPoints.map(p => ({lat:p.lat, lon:p.lon, ele:p.ele}));
  points = state.points.map(p => ({lat:p.lat, lon:p.lon, ele:p.ele}));
  cum = computeCum(points);
  recomputeElevSmooth();
  startIdx = state.startIdx;
  endIdx = state.endIdx;
  boundaries = state.boundaries.slice();
  pois = Array.isArray(state.pois) ? state.pois.map(p => ({...p})) : [];
  enableUIAfterLoad();
  fitToTrack();
  renderAll();
  renderPOIs();
}

function loadTrack(pts, poisArr){
  applyState({
    rawPoints: pts,
    points: pts.slice(),
    startIdx: 0,
    endIdx: pts.length - 1,
    boundaries: [0, pts.length - 1],
    pois: poisArr || []
  });
}

function fitToTrack(){
  map.invalidateSize();
  const bounds = L.latLngBounds(points.map(p => [p.lat, p.lon]));
  map.fitBounds(bounds, {padding:[30,30]});
}

/* ============================================================
   ACTIONS GLOBALES
   ============================================================ */
document.getElementById('reverseBtn').addEventListener('click', () => {
  if(points.length === 0) return;
  pushUndo();
  loopMoveMode = false;
  const n = points.length;
  points = points.slice().reverse();
  cum = computeCum(points);
  recomputeElevSmooth();
  const newStart = n - 1 - endIdx;
  const newEnd   = n - 1 - startIdx;
  boundaries = boundaries.map(b => n - 1 - b).sort((a,b)=>a-b);
  startIdx = newStart; endIdx = newEnd;
  renderAll();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  if(rawPoints.length === 0) return;
  pushUndo();
  loopMoveMode = false;
  points = rawPoints.slice();
  cum = computeCum(points);
  recomputeElevSmooth();
  startIdx = 0; endIdx = points.length - 1;
  boundaries = [startIdx, endIdx];
  document.getElementById('segTableWrap').style.display = 'none';
  fitToTrack();
  renderAll();
});

/* ============================================================
   SAUVEGARDES (mémoire de session) + EXPORT / IMPORT FICHIER .te
   ============================================================ */
let savedStates = [];

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function getCurrentStateObject(label){
  return {
    format: 'traceur-etat',
    version: 1,
    label: label || null,
    savedAt: new Date().toISOString(),
    rawPoints: rawPoints,
    points: points,
    startIdx: startIdx,
    endIdx: endIdx,
    boundaries: boundaries,
    pois: pois
  };
}

document.getElementById('saveStateBtn').addEventListener('click', () => {
  if(points.length === 0) return;
  const suggested = 'Sauvegarde ' + (savedStates.length + 1);
  const label = prompt('Nom de cette sauvegarde :', suggested);
  if(label === null) return; // annulé
  const state = getCurrentStateObject(label.trim() || suggested);
  savedStates.push({
    id: Date.now() + '-' + Math.random().toString(36).slice(2),
    label: state.label,
    savedAt: state.savedAt,
    rawPoints: rawPoints.slice(),
    points: points.slice(),
    startIdx, endIdx,
    boundaries: boundaries.slice(),
    pois: pois.slice()
  });
  renderSaveList();
});

function renderSaveList(){
  const wrap = document.getElementById('saveListWrap');
  const list = document.getElementById('saveList');
  if(savedStates.length === 0){ wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  list.innerHTML = '';
  savedStates.forEach(s => {
    const time = new Date(s.savedAt).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
    const row = document.createElement('div');
    row.className = 'save-row';
    row.innerHTML = `
      <div class="save-info">
        <div class="save-label">${escapeHtml(s.label)}</div>
        <div class="save-time">${time}</div>
      </div>
      <div class="row-actions">
        <button class="mini-btn restore-btn" title="Reprendre cette sauvegarde" aria-label="Reprendre cette sauvegarde">↺</button>
        <button class="del-btn" title="Supprimer cette sauvegarde" aria-label="Supprimer cette sauvegarde">${DEL_ICON}</button>
      </div>`;
    row.querySelector('.restore-btn').addEventListener('click', () => restoreSavedState(s.id));
    row.querySelector('.del-btn').addEventListener('click', () => deleteSavedState(s.id));
    list.appendChild(row);
  });
}

function restoreSavedState(id){
  const s = savedStates.find(x => x.id === id);
  if(!s) return;
  applyState({
    rawPoints: s.rawPoints,
    points: s.points,
    startIdx: s.startIdx,
    endIdx: s.endIdx,
    boundaries: s.boundaries,
    pois: s.pois
  });
  document.getElementById('segTableWrap').style.display = boundaries.length > 2 ? 'block' : 'none';
}

function deleteSavedState(id){
  savedStates = savedStates.filter(x => x.id !== id);
  renderSaveList();
}

document.getElementById('exportStateBtn').addEventListener('click', () => {
  if(points.length === 0) return;
  const state = getCurrentStateObject(null);
  const jsonStr = JSON.stringify(state);
  const blob = new Blob([jsonStr], {type:'application/octet-stream'});
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0,16).replace('T','-').replace(':','h');
  const link = document.createElement('a');
  link.href = url;
  link.download = `traceur-${stamp}.te`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.getElementById('importStateInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    try{
      const state = JSON.parse(evt.target.result);
      if(state.format !== 'traceur-etat' || !Array.isArray(state.rawPoints) || !Array.isArray(state.points)
         || !Array.isArray(state.boundaries) || typeof state.startIdx !== 'number' || typeof state.endIdx !== 'number'){
        throw new Error("Ce fichier .te n'est pas reconnu ou est corrompu.");
      }
      applyState(state);
      document.getElementById('segTableWrap').style.display = boundaries.length > 2 ? 'block' : 'none';
    }catch(err){
      alert('Erreur : ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

document.getElementById('splitBtn').addEventListener('click', () => {
  const n = parseInt(document.getElementById('segCount').value, 10);
  if(!n || n < 2){ alert('Choisissez un nombre de jours ≥ 2.'); return; }
  if(n > (endIdx - startIdx)){ alert('Trop de jours pour le nombre de points disponibles.'); return; }
  pushUndo();
  splitEqual(n);
  renderAll();
  document.getElementById('segTableWrap').style.display = 'block';
});

function deleteSegment(i){
  const nSeg = boundaries.length - 1;
  if(nSeg <= 1) return;
  pushUndo();
  if(i < nSeg - 1){
    // il existe un jour suivant : il absorbe la place du jour supprimé
    boundaries.splice(i + 1, 1);
  } else {
    // dernier jour supprimé : le jour précédent absorbe sa place
    boundaries.splice(i, 1);
  }
  renderAll();
}

function splitEqual(n){
  const total = distBetween(startIdx, endIdx);
  const target = total / n;
  const bs = [startIdx];
  let cursor = startIdx;
  for(let k=1;k<n;k++){
    const targetDist = cum[startIdx] + k*target;
    let idx = cursor;
    while(idx < endIdx && cum[idx] < targetDist) idx++;
    // choisir le point le plus proche de la cible entre idx-1 et idx
    if(idx>0 && Math.abs(cum[idx-1]-targetDist) < Math.abs(cum[idx]-targetDist)) idx = idx-1;
    idx = Math.max(idx, cursor+1);
    idx = Math.min(idx, endIdx-1);
    bs.push(idx);
    cursor = idx;
  }
  bs.push(endIdx);
  // dédoublonner / garder croissant strict
  boundaries = [...new Set(bs)].sort((a,b)=>a-b);
}

/* Le déplacement du départ ou de l'arrivée ne doit raccourcir/allonger que le
   premier (ou dernier) jour : les frontières internes des autres jours restent
   fixes en indice, on borne juste le déplacement pour ne pas les traverser. */
/* ============================================================
   RENDU CARTE
   ============================================================ */
function pinIcon(cls, label, size){
  return L.divIcon({
    className: '',
    html: `<div class="trk-pin ${cls}" style="width:${size}px;height:${size}px;"><span>${label}</span></div>`,
    iconSize: [size,size],
    iconAnchor: [size/2, size]
  });
}

function clearLayers(){
  if(bgPolyline){ map.removeLayer(bgPolyline); bgPolyline=null; }
  segPolylines.forEach(p => map.removeLayer(p)); segPolylines = [];
  if(startMarker){ map.removeLayer(startMarker); startMarker=null; }
  if(endMarker){ map.removeLayer(endMarker); endMarker=null; }
  if(loopMarker){ map.removeLayer(loopMarker); loopMarker=null; }
  boundMarkers.forEach(m => map.removeLayer(m)); boundMarkers = [];
}

function renderAll(){
  clearLayers();
  if(points.length === 0) return;

  // tracé complet en fond, discret
  bgPolyline = L.polyline(points.map(p=>[p.lat,p.lon]), {
    color: '#E63946', weight: 3.5, opacity: .6, dashArray: '2 7'
  }).addTo(map);

  // segments actifs colorés
  for(let i=0;i<boundaries.length-1;i++){
    const a = boundaries[i], b = boundaries[i+1];
    const seg = points.slice(a, b+1).map(p=>[p.lat,p.lon]);
    const color = boundaries.length>2 ? SEG_COLORS[i % SEG_COLORS.length] : '#2E4A38';
    const pl = L.polyline(seg, {color, weight:5, opacity:.92, lineCap:'round'}).addTo(map);
    segPolylines.push(pl);
  }

  if(loopMoveMode && isLoopTrack()){
    // mode "déplacement du point de jonction" : Départ et Arrivée sont
    // fusionnés en un seul repère, déplaçable n'importe où sur le tracé.
    loopMarker = L.marker([points[startIdx].lat, points[startIdx].lon], {
      draggable:true, icon: pinIcon('loop','D·A',34), zIndexOffset: 1100
    }).addTo(map).bindTooltip('Point Départ/Arrivée — glissez-le à l’endroit voulu sur le parcours', {direction:'top', offset:[0,-30]});
    loopMarker.on('dragend', e => {
      const {lat,lng} = e.target.getLatLng();
      const m = nearestIndex(lat, lng, 0, points.length - 1);
      if(m > 0 && m < points.length - 1){
        pushUndo();
        // Reboucle le parcours en repartant du point choisi : le point M
        // devient à la fois le nouveau départ et la nouvelle arrivée, et
        // l'ancienne jonction (bout à bout des deux extrémités d'origine)
        // se retrouve, elle, au milieu du tracé, sans discontinuité.
        points = points.slice(m).concat(points.slice(0, m + 1));
        cum = computeCum(points);
        recomputeElevSmooth();
        startIdx = 0;
        endIdx = points.length - 1;
        boundaries = [startIdx, endIdx];
      }
      loopMoveMode = false;
      renderAll();
    });
  } else {
    // repère départ
    startMarker = L.marker([points[startIdx].lat, points[startIdx].lon], {
      draggable:true, icon: pinIcon('start','D',30), zIndexOffset: 1000
    }).addTo(map).bindTooltip('Départ — glissez pour déplacer', {direction:'top', offset:[0,-28]});
    startMarker.on('dragend', e => {
      const {lat,lng} = e.target.getLatLng();
      pushUndo();
      // le départ ne peut pas dépasser la première frontière interne (le jour 1
      // seul est raccourci/allongé, les jours suivants restent inchangés)
      const hi = boundaries.length > 2 ? Math.min(endIdx-1, boundaries[1]-1) : endIdx-1;
      startIdx = nearestIndex(lat, lng, 0, Math.max(0, hi));
      boundaries[0] = startIdx;
      renderAll();
    });

    // repère arrivée
    endMarker = L.marker([points[endIdx].lat, points[endIdx].lon], {
      draggable:true, icon: pinIcon('end','A',30), zIndexOffset: 1000
    }).addTo(map).bindTooltip('Arrivée — glissez pour déplacer', {direction:'top', offset:[0,-28]});
    endMarker.on('dragend', e => {
      const {lat,lng} = e.target.getLatLng();
      pushUndo();
      // l'arrivée ne peut pas dépasser la dernière frontière interne (seul le
      // dernier jour est raccourci/allongé, les précédents restent inchangés)
      const lo = boundaries.length > 2 ? Math.max(startIdx+1, boundaries[boundaries.length-2]+1) : startIdx+1;
      endIdx = nearestIndex(lat, lng, Math.min(lo, points.length-1), points.length-1);
      boundaries[boundaries.length-1] = endIdx;
      renderAll();
    });
  }

  // repères de tronçons internes
  if(boundaries.length > 2){
    for(let i=1;i<boundaries.length-1;i++){
      const idx = boundaries[i];
      const m = L.marker([points[idx].lat, points[idx].lon], {
        draggable:true, icon: pinIcon('bound', String(i), 22), zIndexOffset: 900
      }).addTo(map).bindTooltip('Frontière Jour ' + i + ' / Jour ' + (i+1), {direction:'top', offset:[0,-22]});
      m.on('dragend', (function(bi){
        return function(e){
          const {lat,lng} = e.target.getLatLng();
          const lo = boundaries[bi-1] + 1;
          const hi = boundaries[bi+1] - 1;
          if(hi < lo) return renderAll();
          const idx2 = nearestIndex(lat, lng, lo, hi);
          pushUndo();
          boundaries[bi] = idx2;
          renderAll();
        };
      })(i));
      boundMarkers.push(m);
    }
  }

  updateStats();
  updateSegTable();
  updateElevationProfile();
}

/* ============================================================
   RENDU DES POI (points d'intérêt)
   ============================================================ */
/* Contrairement au tracé, les POI ne dépendent pas des frontières de jours :
   ils sont donc posés une seule fois par fichier chargé (renderPOIs), et non
   recréés à chaque renderAll() (appelé très souvent, ex. pendant un drag). */
function clearPoiLayers(){
  Object.values(poiLayerGroups).forEach(lg => { if(map.hasLayer(lg)) map.removeLayer(lg); });
  poiLayerGroups = {};
}

function renderPOIs(){
  clearPoiLayers();
  if(!pois || pois.length === 0){ updatePoiCard(); return; }

  const groups = {};
  pois.forEach(p => {
    const cat = p.cat;
    const meta = POI_CAT_META[cat] || POI_CAT_META.other;
    if(!groups[cat]) groups[cat] = L.layerGroup();
    const marker = L.marker([p.lat, p.lon], {icon: poiIcon(cat)});
    const title = escapeHtml(p.name || meta.label);
    const subtitle = p.type && p.type !== p.name ? `<div style="color:#4B5A50;">${escapeHtml(p.type)}</div>` : '';
    marker.bindPopup(`<b>${title}</b>${subtitle}`);
    marker.addTo(groups[cat]);
  });
  poiLayerGroups = groups;
  updatePoiCard();
  applyPoiVisibility();
}

function applyPoiVisibility(){
  Object.keys(poiLayerGroups).forEach(cat => {
    const lg = poiLayerGroups[cat];
    const show = poiMasterVisible && poiVisible[cat] !== false;
    if(show){ if(!map.hasLayer(lg)) lg.addTo(map); }
    else { if(map.hasLayer(lg)) map.removeLayer(lg); }
  });
}

function updatePoiCard(){
  const card = document.getElementById('poiCard');
  const list = document.getElementById('poiCategoryList');
  if(!pois || pois.length === 0){
    card.style.display = 'none';
    list.innerHTML = '';
    return;
  }
  card.style.display = 'block';

  const counts = {};
  pois.forEach(p => { counts[p.cat] = (counts[p.cat] || 0) + 1; });

  list.innerHTML = '';
  POI_CAT_ORDER.forEach(cat => {
    if(!counts[cat]) return;
    const meta = POI_CAT_META[cat];
    if(poiVisible[cat] === undefined) poiVisible[cat] = true;
    const row = document.createElement('label');
    row.className = 'poi-cat-row';
    row.innerHTML = `
      <input type="checkbox" data-cat="${cat}" ${poiVisible[cat] ? 'checked' : ''}>
      <span class="poi-cat-dot" style="background:${meta.color}">${meta.emoji}</span>
      <span class="poi-cat-label">${meta.label}</span>
      <span class="poi-cat-count">${counts[cat]}</span>`;
    row.querySelector('input').addEventListener('change', e => {
      poiVisible[cat] = e.target.checked;
      applyPoiVisibility();
    });
    list.appendChild(row);
  });
}

document.getElementById('poiMasterToggle').addEventListener('change', e => {
  poiMasterVisible = e.target.checked;
  applyPoiVisibility();
});

/* ============================================================
   FUSION DE 2 PARCOURS GPX
   ============================================================
   Modèle : chaque parcours (1 = le tracé principal, 2 = celui qu'on vient
   d'ajouter) est découpé en "segments" délimités par son propre départ/
   arrivée et par ses points de croisement avec l'autre parcours. Chaque
   segment relie 2 "nœuds" : 'D1'/'A1'/'D2'/'A2' (départ/arrivée) ou 'Xk'
   (le k-ième croisement, partagé par les 2 parcours à cet endroit). On
   supprime des segments jusqu'à ce que ceux qui restent forment un unique
   chemin continu entre exactement 2 nœuds de type départ/arrivée : à ce
   moment-là, la fusion est terminée et devient le nouveau parcours officiel. */

function showMergeInfoBanner(text, autoHideMs){
  const el = document.getElementById('mergeInfoBanner');
  document.getElementById('mergeInfoBannerText').textContent = text;
  el.style.display = 'flex';
  if(mergeBannerTimeout) clearTimeout(mergeBannerTimeout);
  if(autoHideMs !== 0){
    mergeBannerTimeout = setTimeout(() => { el.style.display = 'none'; }, autoHideMs || 9000);
  }
}
document.getElementById('mergeInfoBannerClose').addEventListener('click', () => {
  document.getElementById('mergeInfoBanner').style.display = 'none';
  if(mergeBannerTimeout) clearTimeout(mergeBannerTimeout);
});

/* ---- popin d'ajout du 2e fichier ---- */
function openAddGpxModal(){ document.getElementById('addGpxModalOverlay').style.display = 'flex'; }
function closeAddGpxModal(){
  document.getElementById('addGpxModalOverlay').style.display = 'none';
  document.getElementById('secondFileInput').value = '';
}
document.getElementById('addGpxBtn').addEventListener('click', openAddGpxModal);
document.getElementById('closeAddGpxModalBtn').addEventListener('click', closeAddGpxModal);
document.getElementById('addGpxModalOverlay').addEventListener('click', e => {
  if(e.target.id === 'addGpxModalOverlay') closeAddGpxModal();
});

function openFindPoiModal(){ document.getElementById('findPoiModalOverlay').style.display = 'flex'; }
function closeFindPoiModal(){ document.getElementById('findPoiModalOverlay').style.display = 'none'; }
document.getElementById('findPoiBtn').addEventListener('click', openFindPoiModal);
document.getElementById('closeFindPoiModalBtn').addEventListener('click', closeFindPoiModal);
document.getElementById('findPoiModalOverlay').addEventListener('click', e => {
  if(e.target.id === 'findPoiModalOverlay') closeFindPoiModal();
});
document.getElementById('launchFindPoiBtn').addEventListener('click', () => {
  if(points.length === 0) return;
  const cats = [];
  if(document.getElementById('findPoiWater').checked) cats.push('water');
  if(document.getElementById('findPoiBakery').checked) cats.push('bakery');
  if(document.getElementById('findPoiToilets').checked) cats.push('toilets');
  if(cats.length === 0){ alert('Sélectionnez au moins un type de point à rechercher.'); return; }
  closeFindPoiModal();
  fetchNearbyPois(points, cats);
});

document.getElementById('secondFileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = evt => handleSecondGpxText(evt.target.result);
  reader.readAsText(file);
});

function handleSecondGpxText(text){
  try{
    const {points: pts2} = parseGPX(text);
    if(pts2.length < 2) throw new Error('Le 2ᵉ tracé doit contenir au moins 2 points.');
    closeAddGpxModal();
    startMergeWithSecondTrack(pts2);
  }catch(err){
    alert('Erreur : ' + err.message);
  }
}

function startMergeWithSecondTrack(pts2){
  const cum2 = computeCum(pts2);
  const track2 = {rawPoints: pts2, points: pts2.slice(), cum: cum2, startIdx: 0, endIdx: pts2.length - 1};

  const clusters = findProximityCrossings(points, startIdx, endIdx, track2.points, track2.startIdx, track2.endIdx, JOIN_SPLIT_THRESHOLD_M);

  if(clusters.length === 0){
    showMergeInfoBanner("Les 2 parcours ne se croisent pas : la fusion n'est possible qu'entre parcours qui se croisent. Le 2ᵉ tracé n'a pas été conservé.");
    return;
  }

  // on entre en mode fusion : plus de découpage en jours sur le parcours 1
  boundaries = [startIdx, endIdx];
  document.getElementById('segTableWrap').style.display = 'none';

  mergeState = {
    track2,
    hasStart1: true, hasEnd1: true, hasStart2: true, hasEnd2: true,
    selectedSegId: null,
    segments: [],
    crossings: [],
    layers: {}
  };
  enterMergeModeUI();
  rebuildMergeModel();

  const allPts = points.slice(startIdx, endIdx+1).concat(track2.points.slice(track2.startIdx, track2.endIdx+1));
  map.fitBounds(L.latLngBounds(allPts.map(p => [p.lat, p.lon])), {padding:[40,40]});
}

/* Reconstruit entièrement le modèle de segments à partir des positions
   actuelles des repères D/A des 2 parcours (repart de zéro : toute
   suppression de tronçon précédente est réinitialisée — c'est le cas
   uniquement quand on déplace un repère départ/arrivée en cours de fusion). */
function rebuildMergeModel(){
  const t2 = mergeState.track2;
  mergeState.hasStart1 = true; mergeState.hasEnd1 = true;
  mergeState.hasStart2 = true; mergeState.hasEnd2 = true;
  mergeState.selectedSegId = null;

  const clusters = findProximityCrossings(points, startIdx, endIdx, t2.points, t2.startIdx, t2.endIdx, JOIN_SPLIT_THRESHOLD_M);

  const crossings = clusters.map((c, k) => {
    const j2 = nearestIndexIn(t2.points, c.lat, c.lon, t2.startIdx, t2.endIdx);
    return {id: 'X'+k, lat: c.lat, lon: c.lon, i1: c.i1, j2};
  });
  mergeState.crossings = crossings;

  if(crossings.length === 0){
    mergeState.segments = [];
    showMergeInfoBanner("Les 2 parcours ne se croisent plus dans la zone sélectionnée : ajustez les repères de départ/arrivée, ou annulez la fusion.");
    renderMergeUI();
    return;
  }

  const cuts1 = crossings.map(c => ({idx: c.i1, nodeId: c.id}));
  const cuts2 = crossings.map(c => ({idx: c.j2, nodeId: c.id}));
  mergeState.segments = [
    ...buildTrackSegments(1, startIdx, endIdx, cuts1),
    ...buildTrackSegments(2, t2.startIdx, t2.endIdx, cuts2)
  ];
  renderMergeUI();
  updateMergeCard();
}

function buildTrackSegments(trackNum, lo, hi, cutList){
  const dNode = trackNum === 1 ? 'D1' : 'D2';
  const aNode = trackNum === 1 ? 'A1' : 'A2';
  const cuts = [{idx: lo, nodeId: dNode}, ...cutList, {idx: hi, nodeId: aNode}]
    .sort((a,b) => a.idx - b.idx);
  const segs = [];
  for(let k=0;k<cuts.length-1;k++){
    const a = cuts[k], b = cuts[k+1];
    if(b.idx <= a.idx) continue; // croisement confondu avec un départ/arrivée : segment nul, on l'ignore
    segs.push({id: 'seg'+trackNum+'_'+k, track: trackNum, i0: a.idx, i1: b.idx, nodeStart: a.nodeId, nodeEnd: b.nodeId, deleted: false});
  }
  return segs;
}

function clearMergeLayers(){
  if(!mergeState) return;
  const L_ = mergeState.layers || {};
  if(L_.bg1) map.removeLayer(L_.bg1);
  if(L_.bg2) map.removeLayer(L_.bg2);
  Object.values(L_.segPolylines || {}).forEach(p => map.removeLayer(p));
  (L_.crossMarkers || []).forEach(m => map.removeLayer(m));
  if(L_.startMarker2) map.removeLayer(L_.startMarker2);
  if(L_.endMarker2) map.removeLayer(L_.endMarker2);
  mergeState.layers = {};
}

/* Coordonnée canonique de chaque nœud de croisement — i1 (tracé 1) et j2
   (tracé 2) ne sont que les points les plus proches sur chacun des 2
   tracés, pas forcément exactement la même coordonnée. Sert à "accrocher"
   visuellement les tronçons entre eux à chaque croisement, aussi bien
   pendant l'édition (renderMergeUI) qu'au moment de la fusion finale. */
function crossingCoordMap(){
  const m = {};
  (mergeState.crossings || []).forEach(c => { m[c.id] = {lat: c.lat, lon: c.lon}; });
  return m;
}

function renderMergeUI(){
  clearLayers();       // vide les couches "mode normal" du parcours 1 (marqueurs D/A, tronçons de jours…)
  clearMergeLayers();
  if(!mergeState) return;
  const t2 = mergeState.track2;
  const layers = {};

  layers.bg1 = L.polyline(points.map(p=>[p.lat,p.lon]), {color:'#E63946', weight:3, opacity:.35, dashArray:'2 7'}).addTo(map);
  layers.bg2 = L.polyline(t2.points.map(p=>[p.lat,p.lon]), {color:'#E63946', weight:3, opacity:.35, dashArray:'2 7'}).addTo(map);

  layers.segPolylines = {};
  const coordMap = crossingCoordMap();
  mergeState.segments.filter(s => !s.deleted).forEach(seg => {
    const src = seg.track === 1 ? points : t2.points;
    const latlngs = src.slice(seg.i0, seg.i1+1).map(p => [p.lat, p.lon]);
    // Accroche visuellement les 2 extrémités du tronçon sur la coordonnée
    // canonique du croisement, si elles en touchent un : les tronçons
    // restants se rejoignent alors sans décalage dès qu'on supprime un
    // tronçon, sans attendre la fusion finale.
    if(coordMap[seg.nodeStart]) latlngs[0] = [coordMap[seg.nodeStart].lat, coordMap[seg.nodeStart].lon];
    if(coordMap[seg.nodeEnd]) latlngs[latlngs.length - 1] = [coordMap[seg.nodeEnd].lat, coordMap[seg.nodeEnd].lon];
    const selected = mergeState.selectedSegId === seg.id;
    const baseColor = seg.track === 1 ? '#2E4A38' : '#3C6E8F';
    const poly = L.polyline(latlngs, {
      color: selected ? '#111' : baseColor,
      weight: selected ? 8 : 5,
      opacity: .95, lineCap: 'round'
    }).addTo(map);
    poly.on('click', e => { L.DomEvent.stopPropagation(e); selectMergeSegment(seg.id, e.latlng); });
    layers.segPolylines[seg.id] = poly;
  });

  layers.crossMarkers = mergeState.crossings.map(c =>
    L.circleMarker([c.lat, c.lon], {radius:5, color:'#fff', weight:1.5, fillColor:'#1E2822', fillOpacity:1, interactive:false}).addTo(map)
  );

  if(mergeState.hasStart1){
    startMarker = L.marker([points[startIdx].lat, points[startIdx].lon], {draggable:true, icon: pinIcon('start','D',30), zIndexOffset:1000})
      .addTo(map).bindTooltip('Départ parcours 1 — glissez pour déplacer', {direction:'top', offset:[0,-28]});
    startMarker.on('dragend', e => {
      const {lat,lng} = e.target.getLatLng();
      startIdx = nearestIndex(lat, lng, 0, endIdx-1);
      rebuildMergeModel();
    });
  }
  if(mergeState.hasEnd1){
    endMarker = L.marker([points[endIdx].lat, points[endIdx].lon], {draggable:true, icon: pinIcon('end','A',30), zIndexOffset:1000})
      .addTo(map).bindTooltip('Arrivée parcours 1 — glissez pour déplacer', {direction:'top', offset:[0,-28]});
    endMarker.on('dragend', e => {
      const {lat,lng} = e.target.getLatLng();
      endIdx = nearestIndex(lat, lng, startIdx+1, points.length-1);
      rebuildMergeModel();
    });
  }
  if(mergeState.hasStart2){
    layers.startMarker2 = L.marker([t2.points[t2.startIdx].lat, t2.points[t2.startIdx].lon], {draggable:true, icon: pinIcon('start2','D2',30), zIndexOffset:1000})
      .addTo(map).bindTooltip('Départ parcours 2 — glissez pour déplacer', {direction:'top', offset:[0,-28]});
    layers.startMarker2.on('dragend', e => {
      const {lat,lng} = e.target.getLatLng();
      t2.startIdx = nearestIndexIn(t2.points, lat, lng, 0, t2.endIdx-1);
      rebuildMergeModel();
    });
  }
  if(mergeState.hasEnd2){
    layers.endMarker2 = L.marker([t2.points[t2.endIdx].lat, t2.points[t2.endIdx].lon], {draggable:true, icon: pinIcon('end2','A2',30), zIndexOffset:1000})
      .addTo(map).bindTooltip('Arrivée parcours 2 — glissez pour déplacer', {direction:'top', offset:[0,-28]});
    layers.endMarker2.on('dragend', e => {
      const {lat,lng} = e.target.getLatLng();
      t2.endIdx = nearestIndexIn(t2.points, lat, lng, t2.startIdx+1, t2.points.length-1);
      rebuildMergeModel();
    });
  }

  mergeState.layers = layers;
}

/* Un tronçon n'est supprimable que dans 2 cas :
   (a) il relie 2 points de croisement ET il existe encore, sans lui, un
       autre chemin entre ces 2 mêmes points (donc "2 parcours possibles"
       entre les 2 croisements : le supprimer ne coupe rien) ;
   (b) il relie un point de départ/arrivée à un point de croisement (c'est
       une branche terminale : la retirer revient juste à ne pas retenir
       ce départ/arrivée comme extrémité du parcours final).
   Dans tout autre cas (ex. il s'agit du seul chemin entre 2 croisements),
   la suppression casserait la continuité du parcours : on l'interdit. */
function isDANode(n){ return n === 'D1' || n === 'A1' || n === 'D2' || n === 'A2'; }
function isCrossNode(n){ return typeof n === 'string' && n.charAt(0) === 'X'; }

/* Vrai s'il existe un chemin entre seg.nodeStart et seg.nodeEnd en
   n'empruntant aucun tronçon supprimé ni `seg` lui-même (recherche en
   largeur sur le graphe des nœuds départ/arrivée/croisements). */
function hasAlternatePath(allSegments, seg){
  const others = allSegments.filter(s => s.id !== seg.id && !s.deleted);
  const adj = {};
  others.forEach(s => {
    (adj[s.nodeStart] = adj[s.nodeStart] || []).push(s.nodeEnd);
    (adj[s.nodeEnd] = adj[s.nodeEnd] || []).push(s.nodeStart);
  });
  const visited = new Set([seg.nodeStart]);
  const stack = [seg.nodeStart];
  while(stack.length){
    const n = stack.pop();
    (adj[n] || []).forEach(n2 => { if(!visited.has(n2)){ visited.add(n2); stack.push(n2); } });
  }
  return visited.has(seg.nodeEnd);
}

function isSegmentDeletable(seg, allSegments){
  const startDA = isDANode(seg.nodeStart), endDA = isDANode(seg.nodeEnd);
  const startX = isCrossNode(seg.nodeStart), endX = isCrossNode(seg.nodeEnd);
  if((startDA && endX) || (endDA && startX)) return true;               // cas (b)
  if(startX && endX) return hasAlternatePath(allSegments, seg);          // cas (a)
  return false;
}

function selectMergeSegment(segId, latlng){
  mergeState.selectedSegId = segId;
  renderMergeUI();
  const seg = mergeState.segments.find(s => s.id === segId);
  const deletable = !!seg && isSegmentDeletable(seg, mergeState.segments);
  const content = deletable
    ? '<div class="seg-menu"><div class="seg-menu-title">Tronçon sélectionné</div><button class="seg-menu-del" id="segMenuDelBtn">🗑 Supprimer ce tronçon</button></div>'
    : '<div class="seg-menu"><div class="seg-menu-title">Tronçon sélectionné</div>'
      + '<p style="font-size:.85em;color:#5a5a5a;max-width:220px;margin:.4em 0 0;">Suppression impossible : c\'est l\'unique chemin entre ces 2 points, le supprimer couperait le parcours.</p></div>';
  const popup = L.popup({closeButton:true, className:'seg-menu-popup', autoPan:true})
    .setLatLng(latlng)
    .setContent(content)
    .openOn(map);
  if(deletable){
    setTimeout(() => {
      const btn = document.getElementById('segMenuDelBtn');
      if(btn) btn.addEventListener('click', () => { map.closePopup(popup); deleteMergeSegment(segId); });
    }, 0);
  }
  map.on('popupclose', function onClose(ev){
    if(ev.popup === popup){
      mergeState.selectedSegId = null;
      renderMergeUI();
      map.off('popupclose', onClose);
    }
  });
}

function deleteMergeSegment(segId){
  const seg = mergeState.segments.find(s => s.id === segId);
  if(!seg) return;
  seg.deleted = true;
  if(seg.nodeStart === 'D1' || seg.nodeEnd === 'D1') mergeState.hasStart1 = false;
  if(seg.nodeStart === 'A1' || seg.nodeEnd === 'A1') mergeState.hasEnd1 = false;
  if(seg.nodeStart === 'D2' || seg.nodeEnd === 'D2') mergeState.hasStart2 = false;
  if(seg.nodeStart === 'A2' || seg.nodeEnd === 'A2') mergeState.hasEnd2 = false;
  mergeState.selectedSegId = null;
  renderMergeUI();
  updateMergeCard();
  checkMergeCompletion();
}

function updateMergeCard(){
  if(!mergeState) return;
  const remaining = mergeState.segments.filter(s => !s.deleted);
  document.getElementById('mergeCardBody').innerHTML = `
    <p>${mergeState.crossings.length} croisement(s) détecté(s), ${mergeState.segments.length} tronçon(s) au total.</p>
    <p>Cliquez sur un tronçon de la carte pour le sélectionner, puis supprimez ceux à ne pas garder. Objectif : n'en garder que ${remaining.length > 0 ? '' : ''}ceux qui forment un seul tracé continu, avec un seul départ et une seule arrivée.</p>
    <p><b>${remaining.length}</b> tronçon(s) restant(s).</p>
  `;
}

function isMergeGraphConnected(segments){
  if(segments.length === 0) return false;
  const adj = {};
  segments.forEach(s => {
    (adj[s.nodeStart] = adj[s.nodeStart] || []).push(s);
    (adj[s.nodeEnd] = adj[s.nodeEnd] || []).push(s);
  });
  const visited = new Set([segments[0].id]);
  const stack = [segments[0]];
  while(stack.length){
    const s = stack.pop();
    [s.nodeStart, s.nodeEnd].forEach(n => {
      (adj[n] || []).forEach(s2 => {
        if(!visited.has(s2.id)){ visited.add(s2.id); stack.push(s2); }
      });
    });
  }
  return visited.size === segments.length;
}

function checkMergeCompletion(){
  const remaining = mergeState.segments.filter(s => !s.deleted);
  if(remaining.length === 0) return;

  const degree = {};
  remaining.forEach(s => {
    degree[s.nodeStart] = (degree[s.nodeStart] || 0) + 1;
    degree[s.nodeEnd] = (degree[s.nodeEnd] || 0) + 1;
  });
  const isDA = n => n === 'D1' || n === 'A1' || n === 'D2' || n === 'A2';
  const endNodes = Object.keys(degree).filter(n => degree[n] === 1);
  const degreesOk = Object.values(degree).every(d => d <= 2);

  if(degreesOk && endNodes.length === 2 && endNodes.every(isDA) && isMergeGraphConnected(remaining)){
    finalizeMerge(remaining, endNodes);
  }
}

/* Ordonne les segments restants en un chemin continu, du nœud de départ au
   nœud d'arrivée, en déterminant pour chacun s'il faut le parcourir dans
   son sens naturel (i0→i1) ou à l'envers. */
function orderMergeSegments(segments, startNode){
  const adj = {};
  segments.forEach(s => {
    (adj[s.nodeStart] = adj[s.nodeStart] || []).push({seg: s, other: s.nodeEnd});
    (adj[s.nodeEnd] = adj[s.nodeEnd] || []).push({seg: s, other: s.nodeStart});
  });
  const visited = new Set();
  const order = [];
  let current = startNode;
  while(true){
    const options = (adj[current] || []).filter(o => !visited.has(o.seg.id));
    if(options.length === 0) break;
    const opt = options[0];
    visited.add(opt.seg.id);
    order.push({seg: opt.seg, reversed: opt.seg.nodeStart !== current});
    current = opt.other;
  }
  return order;
}

function finalizeMerge(remaining, endNodes){
  const startNode = endNodes.find(n => n === 'D1' || n === 'D2') || endNodes[0];
  const ordered = orderMergeSegments(remaining, startNode);
  const t2 = mergeState.track2;

  const crossingCoord = crossingCoordMap();

  let newPoints = [];
  ordered.forEach(({seg, reversed}, idx) => {
    const src = seg.track === 1 ? points : t2.points;
    let slice = src.slice(seg.i0, seg.i1+1).map(p => ({lat:p.lat, lon:p.lon, ele:p.ele}));
    if(reversed) slice = slice.reverse();
    if(idx > 0){
      const entryNode = reversed ? seg.nodeEnd : seg.nodeStart;
      const canon = crossingCoord[entryNode];
      if(canon && newPoints.length > 0){
        // Accroche le dernier point déjà ajouté (fin du tronçon précédent)
        // exactement sur le point de croisement, pour une jonction continue.
        const last = newPoints[newPoints.length - 1];
        newPoints[newPoints.length - 1] = {...last, lat: canon.lat, lon: canon.lon};
      }
      slice = slice.slice(1); // évite de dupliquer le point de jonction
    }
    newPoints = newPoints.concat(slice);
  });

  const keepPois = filterPoisNearTrack(pois, newPoints, MERGE_POI_KEEP_RADIUS_M);
  exitMergeMode();
  loadTrack(newPoints, keepPois);
  showMergeInfoBanner('Fusion terminée : les 2 parcours ne forment plus qu\'un seul tracé, du départ à l\'arrivée.', 6000);
}

function enterMergeModeUI(){
  loopMoveMode = false;
  document.getElementById('statsCard').style.display = 'none';
  document.getElementById('splitCard').style.display = 'none';
  document.getElementById('segTableWrap').style.display = 'none';
  document.getElementById('elevWrap').style.display = 'none';
  document.getElementById('mergeCard').style.display = 'block';
  setMergeControlsDisabled(true);
  setTimeout(() => map.invalidateSize(), 50);
}

function exitMergeMode(){
  clearMergeLayers();
  mergeState = null;
  document.getElementById('mergeCard').style.display = 'none';
  document.getElementById('statsCard').style.display = 'block';
  document.getElementById('splitCard').style.display = 'block';
  document.getElementById('elevWrap').style.display = '';
  setMergeControlsDisabled(false);
  setTimeout(() => map.invalidateSize(), 50);
}

function setMergeControlsDisabled(disabled){
  ['reverseBtn','resetBtn','saveStateBtn','exportStateBtn','prepareStepsBtn','baseGpxSelect','splitBtn','segCount'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.disabled = disabled;
  });
  document.getElementById('addGpxBtn').disabled = disabled || points.length === 0;
  document.getElementById('findPoiBtn').disabled = disabled || points.length === 0;
  document.getElementById('importStateInput').disabled = disabled;
  const fileLabel = document.querySelector('label[for="fileInput"]');
  if(fileLabel) fileLabel.classList.toggle('btn-disabled-look', disabled);
  const importLabel = document.querySelector('label[for="importStateInput"]');
  if(importLabel) importLabel.classList.toggle('btn-disabled-look', disabled);
}

document.getElementById('cancelMergeBtn').addEventListener('click', () => {
  exitMergeMode();
  fitToTrack();
  renderAll();
});

/* ============================================================
   CARTOUCHES / TABLEAU
   ============================================================ */
function fmtKm(m){ return (m/1000).toFixed(2); }
function fmtM(m){ return Math.round(m).toString(); }

function updateStats(){
  const total = distBetween(startIdx, endIdx);
  const {gain, loss} = elevGainLoss(startIdx, endIdx);
  document.getElementById('statLength').innerHTML = fmtKm(total) + '<small> km</small>';
  document.getElementById('statPlus').innerHTML = '+' + fmtM(gain) + '<small> m</small>';
  document.getElementById('statMinus').innerHTML = '−' + fmtM(loss) + '<small> m</small>';
  updateLoopUI();
}

/* Affiche/masque le bouton de fusion Départ/Arrivée selon que le parcours
   est actuellement une boucle, et reflète l'état (actif / inactif) du mode
   de déplacement en cours. */
function updateLoopUI(){
  const wrap = document.getElementById('loopActions');
  const btn = document.getElementById('loopModeBtn');
  const help = document.getElementById('loopHelp');
  const loop = !mergeState && isLoopTrack();
  if(!loop && loopMoveMode) loopMoveMode = false;
  wrap.style.display = loop ? 'flex' : 'none';
  if(!loop) return;
  btn.classList.toggle('active', loopMoveMode);
  btn.textContent = loopMoveMode ? '✕ Annuler le déplacement' : '🔗 Déplacer le point Départ/Arrivée';
  help.style.display = loopMoveMode ? 'block' : 'none';
}

document.getElementById('loopModeBtn').addEventListener('click', () => {
  if(mergeState || !isLoopTrack()) return;
  loopMoveMode = !loopMoveMode;
  renderAll();
});

function updateSegTable(){
  const wrap = document.getElementById('segTableWrap');
  const body = document.getElementById('segTableBody');
  if(boundaries.length <= 2){ wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  body.innerHTML = '';
  for(let i=0;i<boundaries.length-1;i++){
    const a = boundaries[i], b = boundaries[i+1];
    const len = distBetween(a,b);
    const {gain, loss} = elevGainLoss(a,b);
    const color = SEG_COLORS[i % SEG_COLORS.length];
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><span class="seg-dot" style="background:${color}"></span><span class="seg-num">Jour ${i+1}</span></td>
      <td>${fmtKm(len)} km</td>
      <td style="color:#2E4A38">+${fmtM(gain)} m</td>
      <td style="color:#A5432E">−${fmtM(loss)} m</td>
      <td><div class="row-actions">
        <button class="dl-btn" title="Télécharger le Jour ${i+1} en GPX" aria-label="Télécharger le Jour ${i+1}">${DL_ICON}</button>
        <button class="del-btn" title="Supprimer le Jour ${i+1}" aria-label="Supprimer le Jour ${i+1}">${DEL_ICON}</button>
      </div></td>`;
    tr.querySelector('.dl-btn').addEventListener('click', () => downloadSegmentGPX(i));
    tr.querySelector('.del-btn').addEventListener('click', () => deleteSegment(i));
    body.appendChild(tr);
  }
}

const DL_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M6.5 10.5 12 16l5.5-5.5"/><path d="M4 19.5h16"/></svg>';
const DEL_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4.6c0-.3.3-.6.6-.6h4.8c.3 0 .6.3.6.6V7"/><path d="M6 7l1 12.4c0 .9.7 1.6 1.6 1.6h6.8c.9 0 1.6-.7 1.6-1.6L18 7"/></svg>';

function pointsToGPX(pts, name){
  const trkpts = pts.map(p =>
    `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><ele>${(p.ele||0).toFixed(1)}</ele></trkpt>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Traceur" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

function downloadSegmentGPX(i){
  const a = boundaries[i], b = boundaries[i+1];
  const subset = points.slice(a, b+1);
  const name = 'Jour ' + (i+1);
  const gpxStr = pointsToGPX(subset, name);
  const blob = new Blob([gpxStr], {type:'application/gpx+xml'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `jour-${i+1}.gpx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Téléchargement du parcours complet (du repère Départ au repère Arrivée).
   Le bouton qui appelle cette fonction ne vit que dans #statsBody, lequel
   est masqué pendant une fusion (2 parcours = 2 départs/arrivées) : il n'est
   donc, par construction, jamais accessible tant qu'il n'y a pas un unique
   départ et une unique arrivée. */
function downloadFullTrackGPX(){
  const subset = points.slice(startIdx, endIdx+1);
  const gpxStr = pointsToGPX(subset, 'Parcours complet');
  const blob = new Blob([gpxStr], {type:'application/gpx+xml'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'parcours.gpx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.getElementById('downloadFullTrackBtn').addEventListener('click', downloadFullTrackGPX);

/* ============================================================
   PROFIL D'ALTITUDE (SVG)
   ============================================================ */
function niceStep(rough){
  if(rough <= 0) return 1;
  const pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow10;
  let step;
  if(n < 1.5) step = 1;
  else if(n < 3) step = 2;
  else if(n < 7) step = 5;
  else step = 10;
  return step * pow10;
}

function updateElevationProfile(){
  const svg = document.getElementById('elevSvg');
  svg.innerHTML = '';
  if(points.length === 0 || endIdx <= startIdx) return;

  // dimensions réelles en pixels : le viewBox est calé 1:1 sur la taille
  // affichée pour que le texte des graduations ne soit jamais déformé.
  const rect = svg.getBoundingClientRect();
  const W = Math.max(320, Math.round(rect.width));
  const H = Math.max(90, Math.round(rect.height));
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.removeAttribute('preserveAspectRatio');

  const padLeft = 46, padRight = 14, padTop = 12, padBottom = 26;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  let minEleRaw = Infinity, maxEleRaw = -Infinity;
  for(let i=startIdx;i<=endIdx;i++){
    if(elevSmooth[i] < minEleRaw) minEleRaw = elevSmooth[i];
    if(elevSmooth[i] > maxEleRaw) maxEleRaw = elevSmooth[i];
    if(points[i].ele < minEleRaw) minEleRaw = points[i].ele;
    if(points[i].ele > maxEleRaw) maxEleRaw = points[i].ele;
  }
  if(minEleRaw === maxEleRaw){ minEleRaw -= 10; maxEleRaw += 10; }

  // graduation altitude : on choisit un pas "rond" puis on englobe la plage
  const eleStep = niceStep((maxEleRaw - minEleRaw) / 4);
  const minEle = Math.floor(minEleRaw / eleStep) * eleStep;
  const maxEle = Math.ceil(maxEleRaw / eleStep) * eleStep;

  const span = cum[endIdx] - cum[startIdx] || 1;
  const totalKm = span / 1000;
  const distStep = niceStep(totalKm / 5) || 0.5;

  function X(i){ return padLeft + ((cum[i]-cum[startIdx]) / span) * plotW; }
  function Y(ele){ return padTop + (1 - (ele-minEle)/(maxEle-minEle)) * plotH; }

  const ns = 'http://www.w3.org/2000/svg';
  function addText(x, y, str, anchor){
    const t = document.createElementNS(ns,'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('text-anchor', anchor || 'middle');
    t.setAttribute('font-family', "'IBM Plex Mono', monospace");
    t.setAttribute('font-size', '10');
    t.setAttribute('fill', '#4B5A50');
    t.textContent = str;
    svg.appendChild(t);
    return t;
  }

  // --- graduation verticale (altitude) : lignes horizontales + labels ---
  for(let e = minEle; e <= maxEle + 0.001; e += eleStep){
    const y = Y(e);
    const gl = document.createElementNS(ns,'line');
    gl.setAttribute('x1', padLeft); gl.setAttribute('x2', W - padRight);
    gl.setAttribute('y1', y.toFixed(1)); gl.setAttribute('y2', y.toFixed(1));
    gl.setAttribute('stroke', '#E6DEC7'); gl.setAttribute('stroke-width', '1');
    svg.appendChild(gl);
    addText(padLeft - 8, y + 3, Math.round(e) + ' m', 'end');
  }

  // --- graduation horizontale (distance) : lignes verticales + labels ---
  for(let d = 0; d <= totalKm + 0.0001; d += distStep){
    const x = padLeft + (d*1000/span) * plotW;
    const gl = document.createElementNS(ns,'line');
    gl.setAttribute('x1', x.toFixed(1)); gl.setAttribute('x2', x.toFixed(1));
    gl.setAttribute('y1', padTop); gl.setAttribute('y2', H - padBottom);
    gl.setAttribute('stroke', '#EDE7D4'); gl.setAttribute('stroke-width', '1');
    svg.appendChild(gl);
    addText(x, H - padBottom + 15, d.toFixed(distStep < 1 ? 1 : 0) + ' km', 'middle');
  }

  // --- axes ---
  const axisY = document.createElementNS(ns,'line');
  axisY.setAttribute('x1', padLeft); axisY.setAttribute('x2', padLeft);
  axisY.setAttribute('y1', padTop); axisY.setAttribute('y2', H - padBottom);
  axisY.setAttribute('stroke', '#B6A984'); axisY.setAttribute('stroke-width', '1.3');
  svg.appendChild(axisY);

  const axisX = document.createElementNS(ns,'line');
  axisX.setAttribute('x1', padLeft); axisX.setAttribute('x2', W - padRight);
  axisX.setAttribute('y1', H - padBottom); axisX.setAttribute('y2', H - padBottom);
  axisX.setAttribute('stroke', '#B6A984'); axisX.setAttribute('stroke-width', '1.3');
  svg.appendChild(axisX);

  // --- altitude brute en fond, pour comparaison visuelle avec le lissage ---
  {
    let dRaw = '';
    for(let i=startIdx;i<=endIdx;i++){
      dRaw += (i===startIdx? 'M':'L') + X(i).toFixed(1) + ',' + Y(points[i].ele).toFixed(1) + ' ';
    }
    const rawLine = document.createElementNS(ns,'path');
    rawLine.setAttribute('d', dRaw);
    rawLine.setAttribute('fill','none');
    rawLine.setAttribute('stroke', '#9A9178');
    rawLine.setAttribute('stroke-width','1');
    rawLine.setAttribute('opacity','0.55');
    svg.appendChild(rawLine);
  }

  // --- courbe(s) d'altitude lissée par tronçon (= base du calcul de dénivelé) ---
  for(let s=0;s<boundaries.length-1;s++){
    const a = boundaries[s], b = boundaries[s+1];
    const color = boundaries.length>2 ? SEG_COLORS[s % SEG_COLORS.length] : '#2E4A38';
    let d = '';
    for(let i=a;i<=b;i++){
      d += (i===a? 'M':'L') + X(i).toFixed(1) + ',' + Y(elevSmooth[i]).toFixed(1) + ' ';
    }
    const area = document.createElementNS(ns,'path');
    area.setAttribute('d', d + `L${X(b).toFixed(1)},${H-padBottom} L${X(a).toFixed(1)},${H-padBottom} Z`);
    area.setAttribute('fill', color); area.setAttribute('opacity','0.16');
    svg.appendChild(area);

    const line = document.createElementNS(ns,'path');
    line.setAttribute('d', d);
    line.setAttribute('fill','none');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width','2.4');
    line.setAttribute('stroke-linejoin','round');
    svg.appendChild(line);
  }

  // --- repères verticaux des frontières internes de tronçons ---
  for(let i=1;i<boundaries.length-1;i++){
    const x = X(boundaries[i]);
    const vl = document.createElementNS(ns,'line');
    vl.setAttribute('x1', x); vl.setAttribute('x2', x);
    vl.setAttribute('y1', padTop); vl.setAttribute('y2', H-padBottom);
    vl.setAttribute('stroke', '#8A8067'); vl.setAttribute('stroke-width','1.2');
    vl.setAttribute('stroke-dasharray','3 3');
    svg.appendChild(vl);
  }

  // --- repère de survol (ligne + point), synchronisé avec la carte ---
  hoverLineEl = document.createElementNS(ns,'line');
  hoverLineEl.setAttribute('y1', padTop); hoverLineEl.setAttribute('y2', H - padBottom);
  hoverLineEl.setAttribute('stroke', '#1E2822'); hoverLineEl.setAttribute('stroke-width','1');
  hoverLineEl.setAttribute('opacity','0');
  svg.appendChild(hoverLineEl);

  hoverDotEl = document.createElementNS(ns,'circle');
  hoverDotEl.setAttribute('r','4.5');
  hoverDotEl.setAttribute('fill', '#C9752E');
  hoverDotEl.setAttribute('stroke', '#fff');
  hoverDotEl.setAttribute('stroke-width','1.6');
  hoverDotEl.setAttribute('opacity','0');
  svg.appendChild(hoverDotEl);

  // échelles exposées pour la synchronisation carte / frise au survol
  profileScale = {padLeft, plotW, W, H, padTop, padBottom, X, Y};
}

/* ============================================================
   SURVOL DE LA FRISE → REPÈRE SUR LA CARTE
   ============================================================ */
let profileScale = null;
let hoverLineEl = null, hoverDotEl = null;
let hoverMapMarker = null;

function indexAtDistance(targetDist){
  let lo = startIdx, hi = endIdx;
  while(lo < hi){
    const mid = (lo + hi) >> 1;
    if(cum[mid] < targetDist) lo = mid + 1; else hi = mid;
  }
  if(lo > startIdx && Math.abs(cum[lo-1]-targetDist) < Math.abs(cum[lo]-targetDist)) return lo - 1;
  return lo;
}

function showHoverAt(idx){
  const p = points[idx];
  if(!hoverMapMarker){
    hoverMapMarker = L.circleMarker([p.lat, p.lon], {
      radius: 8, color: '#fff', weight: 2, fillColor: '#C9752E', fillOpacity: 1
    });
  } else {
    hoverMapMarker.setLatLng([p.lat, p.lon]);
  }
  if(!map.hasLayer(hoverMapMarker)) hoverMapMarker.addTo(map);

  if(hoverLineEl && hoverDotEl && profileScale){
    const x = profileScale.X(idx);
    const y = profileScale.Y(p.ele); // altitude exacte (non lissée) du point survolé
    hoverLineEl.setAttribute('x1', x); hoverLineEl.setAttribute('x2', x);
    hoverLineEl.setAttribute('opacity', '1');
    hoverDotEl.setAttribute('cx', x); hoverDotEl.setAttribute('cy', y);
    hoverDotEl.setAttribute('opacity', '1');
  }

  document.getElementById('elevHoverInfo').textContent =
    Math.round(p.ele) + ' m · ' + fmtKm(cum[idx] - cum[startIdx]) + ' km';
}

function hideHover(){
  if(hoverMapMarker && map.hasLayer(hoverMapMarker)) map.removeLayer(hoverMapMarker);
  if(hoverLineEl) hoverLineEl.setAttribute('opacity','0');
  if(hoverDotEl) hoverDotEl.setAttribute('opacity','0');
  document.getElementById('elevHoverInfo').textContent = '';
  const tip = document.getElementById('elevTooltip');
  tip.style.opacity = '0';
}

function updateElevTooltip(clientX, clientY, ele){
  const wrap = document.getElementById('elevWrap');
  const rect = wrap.getBoundingClientRect();
  const tip = document.getElementById('elevTooltip');
  let left = clientX - rect.left + 14;
  let top = clientY - rect.top - 30;
  left = Math.min(Math.max(left, 4), rect.width - 66);
  top = Math.max(top, 4);
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
  tip.textContent = Math.round(ele) + ' m';
  tip.style.opacity = '1';
}

function onProfilePointerMove(clientX, clientY){
  if(!profileScale || points.length === 0 || endIdx <= startIdx) return;
  const svg = document.getElementById('elevSvg');
  const rect = svg.getBoundingClientRect();
  let t = (clientX - rect.left - profileScale.padLeft) / profileScale.plotW;
  t = Math.max(0, Math.min(1, t));
  const targetDist = cum[startIdx] + t * (cum[endIdx] - cum[startIdx]);
  const idx = indexAtDistance(targetDist);
  showHoverAt(idx);
  updateElevTooltip(clientX, clientY, points[idx].ele);
}

const elevSvgEl = document.getElementById('elevSvg');
elevSvgEl.addEventListener('mousemove', e => onProfilePointerMove(e.clientX, e.clientY));
elevSvgEl.addEventListener('mouseleave', hideHover);
elevSvgEl.addEventListener('touchmove', e => {
  if(e.touches[0]) onProfilePointerMove(e.touches[0].clientX, e.touches[0].clientY);
}, {passive:true});
elevSvgEl.addEventListener('touchend', hideHover);

/* ============================================================
   FRISE REPLIABLE / CARTE AGRANDISSABLE
   ============================================================ */
document.getElementById('elevToggleBtn').addEventListener('click', () => {
  const wrap = document.getElementById('elevWrap');
  const btn = document.getElementById('elevToggleBtn');
  const collapsed = wrap.classList.toggle('collapsed');
  btn.textContent = collapsed ? '︿' : '⌄';
  btn.title = collapsed ? 'Déplier le profil' : 'Replier le profil';
  setTimeout(() => {
    map.invalidateSize();
    if(!collapsed) updateElevationProfile();
  }, 190);
});

document.getElementById('mapExpandBtn').addEventListener('click', () => {
  const layoutEl = document.querySelector('.layout');
  const btn = document.getElementById('mapExpandBtn');
  const expanded = layoutEl.classList.toggle('map-expanded');
  btn.innerHTML = expanded ? '⤡' : '⤢';
  btn.title = expanded ? 'Réduire la carte' : 'Agrandir la carte';
  setTimeout(() => {
    map.invalidateSize();
    if(!document.getElementById('elevWrap').classList.contains('collapsed')) updateElevationProfile();
  }, 220);
});

