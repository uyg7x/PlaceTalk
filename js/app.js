/* PlaceTalk — app.js — Complete clean version
   Real GPS · OpenStreetMap Overpass API · No seed data · localStorage */

/* ── STATE ── */
let userLat = null, userLng = null;
let currentUser = null;
let currentPlaceId = null;
let nearbyResults = [];
let userPlaces = [];
let savedIds = [];
let reviews = {};
let activeCategory = 'all';
let activeSort = 'distance';
let galIdx = 0;
let addPhotos = [], addTags = [], addStars = 0;
let rvStars = 0, rvPhotos = [];
let authCb = null;
let pendingCat = null;

/* ── CATEGORIES ── */

const CATS = [
  { id:'all',        label:'All Nearby',      icon:'' },
  { id:'restaurant', label:'Restaurants',     icon:'' },
  { id:'cafe',       label:'Cafes',           icon:'' },
  { id:'hotel',      label:'Hotels',          icon:'' },
  { id:'restroom',   label:'Restrooms',       icon:'' },
  { id:'railway',    label:'Railway',         icon:'' },
  { id:'bus',        label:'Bus Stops',       icon:'' },
  { id:'metro',      label:'Metro',           icon:'' },
  { id:'hospital',   label:'Hospitals',       icon:'' },
  { id:'atm',        label:'ATMs & Banks',    icon:'' },
  { id:'fuel',       label:'Fuel',            icon:'' },
  { id:'park',       label:'Parks',           icon:'' },
  { id:'nature',     label:'Nature',          icon:'' },
  { id:'shopping',   label:'Shopping',        icon:'' },
  { id:'worship',    label:'Worship',         icon:'' },
  { id:'school',     label:'Schools',         icon:'' },
  { id:'user',       label:'Community',       icon:'' },
];
const CAT = {};
CATS.forEach(c => CAT[c.id] = c);

const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const OVERPASS_TIMEOUT_MS = 22000;
const nearbyCache = new Map();
let activeNearbySearch = { seq: 0, controller: null };
const ALL_DISCOVERY_SELECTORS = [
  ['amenity','restaurant'], ['amenity','fast_food'], ['amenity','cafe'],
  ['amenity','hospital'], ['amenity','clinic'], ['amenity','pharmacy'],
  ['amenity','atm'], ['amenity','bank'], ['amenity','fuel'], ['amenity','toilets'],
  ['amenity','bus_station'], ['tourism','hotel'], ['railway','station'], ['railway','halt'],
  ['railway','subway_entrance'], ['highway','bus_stop'], ['leisure','park'],
  ['shop','supermarket'], ['shop','mall'], ['shop','convenience']
];

const CATEGORY_SELECTORS = {
  restaurant: [['amenity','restaurant'], ['amenity','fast_food'], ['amenity','food_court']],
  cafe:       [['amenity','cafe'], ['amenity','ice_cream']],
  hotel:      [['tourism','hotel'], ['tourism','hostel'], ['tourism','guest_house'], ['tourism','motel']],
  restroom:   [['amenity','toilets']],
  railway:    [['railway','station'], ['railway','halt']],
  bus:        [['highway','bus_stop'], ['amenity','bus_station']],
  metro:      [['station','subway'], ['railway','subway_entrance'], ['subway','yes']],
  hospital:   [['amenity','hospital'], ['amenity','clinic'], ['amenity','pharmacy']],
  atm:        [['amenity','atm'], ['amenity','bank']],
  fuel:       [['amenity','fuel'], ['amenity','charging_station']],
  park:       [['leisure','park'], ['leisure','garden']],
  nature:     [['leisure','nature_reserve'], ['tourism','viewpoint'], ['natural','beach'], ['natural','wood'], ['natural','water']],
  shopping:   [['shop','mall'], ['shop','supermarket'], ['shop','department_store'], ['shop','convenience']],
  worship:    [['amenity','place_of_worship']],
  school:     [['amenity','school'], ['amenity','university'], ['amenity','college']],
};

/* ── COLORS & HELPERS ── */
const AV_COLORS = ['#5B3CF5','#0EA5E9','#10B981','#F97316','#EF4444','#8B5CF6','#EC4899','#14B8A6'];
function avColor(n){ let h=0; for(let i=0;i<(n||'').length;i++)h+=n.charCodeAt(i); return AV_COLORS[h%AV_COLORS.length]; }
function initials(n){ return (n||'?').split(' ').map(w=>w[0]||'').join('').toUpperCase().slice(0,2); }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).substr(2,6); }
function today(){ return new Date().toISOString().slice(0,10); }
function fmtDate(d){ try{return new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});}catch(e){return d;} }
function g(id){ return document.getElementById(id); }
function val(id){ return (g(id)||{}).value||''; }

/* ── STORAGE ── */
function ls(k){ try{const r=localStorage.getItem(k);return r?JSON.parse(r):null;}catch(e){return null;} }
function lss(k,v){ try{localStorage.setItem(k,JSON.stringify(v));}catch(e){} }
function lsd(k){ try{localStorage.removeItem(k);}catch(e){} }

function load(){
  userPlaces = ls('pt_places')||[];
  savedIds   = ls('pt_saved') ||[];
  reviews    = ls('pt_reviews')||{};
  const u    = ls('pt_user');
  if(u){currentUser=u;updateNav();}
}
function savePlaces(){ lss('pt_places',userPlaces); }
function saveRevs(){ lss('pt_reviews',reviews); }
function saveSaved(){ lss('pt_saved',savedIds); }
function saveUser(){ if(currentUser)lss('pt_user',currentUser); }
function clearUser(){ lsd('pt_user'); }

/* ── VIEW ROUTING ── */
function showView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const el = g('view-'+id);
  if(el){ el.classList.add('active'); window.scrollTo(0,0); }
  if(id==='home') renderAll();
  if(id==='landing') startHeroBgRotation();
}

/* ── GEOLOCATION ── */
function getLocation(){
  showView('loading');
  setLoad('Getting your GPS location…',15);
  if(!navigator.geolocation){
    toast('Geolocation is not supported by your browser','error');
    showView('landing'); return;
  }
  navigator.geolocation.getCurrentPosition(
    pos=>{
      userLat=pos.coords.latitude;
      userLng=pos.coords.longitude;
      setLoad('Location found! Searching nearby…',48);
      reverseGeocode(userLat,userLng);
      const cat = pendingCat||'all';
      pendingCat=null;
      activeCategory=cat;
      fetchNearby(cat);
    },
    err=>{
      const msg = err.code===1?'Location access denied. Please allow in browser settings.'
                : err.code===2?'Location unavailable. Check your GPS/WiFi.'
                : 'Location timed out. Please try again.';
      toast(msg,'error');
      showView('landing');
    },
    { enableHighAccuracy:true, timeout:15000, maximumAge:0 }
  );
}

function getLocationAndCat(cat){
  pendingCat=cat;
  getLocation();
}

function setLoad(msg,pct){
  const s=g('loadingSub'); if(s)s.textContent=msg;
  const b=g('loadingBar'); if(b)b.style.width=pct+'%';
}

function reverseGeocode(lat,lng){
  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`)
    .then(r=>r.json()).then(d=>{
      const a=d.address||{};
      const parts=[a.suburb||a.neighbourhood||a.village,a.city||a.town||a.county].filter(Boolean);
      const txt=parts.slice(0,2).join(', ')||'Your Location';
      const el=g('locText'); if(el)el.textContent='📍 '+txt;
    }).catch(()=>{ const el=g('locText'); if(el)el.textContent=`📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}`; });
}


/* ── OVERPASS FETCH ── */
function buildSelectorLines(catId, radius, lat, lng){
  const addPair = ([k,v], bag) => {
    bag.push(`node["${k}"="${v}"](around:${radius},${lat},${lng});`);
    bag.push(`way["${k}"="${v}"](around:${radius},${lat},${lng});`);
  };
  const lines = [];
  if(catId === 'all'){
    Object.entries(CATEGORY_SELECTORS).forEach(([key, pairs]) => {
      if(key === 'metro' || key === 'nature') return;
      pairs.forEach(pair => addPair(pair, lines));
    });
    lines.push(`node["station"="subway"](around:${radius},${lat},${lng});`);
    lines.push(`way["station"="subway"](around:${radius},${lat},${lng});`);
    lines.push(`node["railway"="subway_entrance"](around:${radius},${lat},${lng});`);
    lines.push(`node["subway"="yes"](around:${radius},${lat},${lng});`);
    lines.push(`way["subway"="yes"](around:${radius},${lat},${lng});`);
    lines.push(`node["leisure"="nature_reserve"](around:${radius},${lat},${lng});`);
    lines.push(`way["leisure"="nature_reserve"](around:${radius},${lat},${lng});`);
    lines.push(`node["tourism"="viewpoint"](around:${radius},${lat},${lng});`);
    lines.push(`way["tourism"="viewpoint"](around:${radius},${lat},${lng});`);
    lines.push(`node["natural"~"^(beach|wood|water)$"](around:${radius},${lat},${lng});`);
    lines.push(`way["natural"~"^(beach|wood|water)$"](around:${radius},${lat},${lng});`);
    return lines;
  }
  if(catId === 'metro'){
    lines.push(`node["station"="subway"](around:${radius},${lat},${lng});`);
    lines.push(`way["station"="subway"](around:${radius},${lat},${lng});`);
    lines.push(`node["railway"="subway_entrance"](around:${radius},${lat},${lng});`);
    lines.push(`node["subway"="yes"](around:${radius},${lat},${lng});`);
    lines.push(`way["subway"="yes"](around:${radius},${lat},${lng});`);
    return lines;
  }
  if(catId === 'nature'){
    lines.push(`node["leisure"="nature_reserve"](around:${radius},${lat},${lng});`);
    lines.push(`way["leisure"="nature_reserve"](around:${radius},${lat},${lng});`);
    lines.push(`node["tourism"="viewpoint"](around:${radius},${lat},${lng});`);
    lines.push(`way["tourism"="viewpoint"](around:${radius},${lat},${lng});`);
    lines.push(`node["natural"~"^(beach|wood|water)$"](around:${radius},${lat},${lng});`);
    lines.push(`way["natural"~"^(beach|wood|water)$"](around:${radius},${lat},${lng});`);
    lines.push(`node["leisure"="park"](around:${radius},${lat},${lng});`);
    lines.push(`way["leisure"="park"](around:${radius},${lat},${lng});`);
    return lines;
  }
  (CATEGORY_SELECTORS[catId] || []).forEach(pair => addPair(pair, lines));
  return lines;
}

function buildOverpassQuery(catId, radius){
  const selectorLines = buildSelectorLines(catId, radius, userLat, userLng);
  return `[out:json][timeout:25];\n(\n${selectorLines.join('\n')}\n);\nout center tags;`;
}

function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }
function getCachedNearby(query){
  const hit = nearbyCache.get(query);
  if(!hit) return null;
  if(Date.now() - hit.ts > SEARCH_CACHE_TTL_MS){
    nearbyCache.delete(query);
    return null;
  }
  return hit.data;
}
function setCachedNearby(query, data){
  nearbyCache.set(query, { ts: Date.now(), data });
}

async function fetchOverpassJson(query, externalSignal){
  const cached = getCachedNearby(query);
  if(cached) return cached;

  let lastErr = null;
  for(const endpoint of OVERPASS_ENDPOINTS){
    for(let attempt = 0; attempt < 2; attempt++){
      if(externalSignal?.aborted) throw new DOMException('Search aborted', 'AbortError');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort('timeout'), OVERPASS_TIMEOUT_MS);
      const forwardAbort = () => controller.abort(externalSignal?.reason || 'aborted');

      if(externalSignal){
        if(externalSignal.aborted) controller.abort(externalSignal.reason || 'aborted');
        else externalSignal.addEventListener('abort', forwardAbort, { once:true });
      }

      try{
        const res = await fetch(endpoint, {
          method:'POST',
          body:'data=' + encodeURIComponent(query),
          headers:{'Content-Type':'application/x-www-form-urlencoded'},
          signal: controller.signal,
        });

        if(!res.ok){
          const err = new Error(`HTTP ${res.status}`);
          err.status = res.status;
          err.endpoint = endpoint;
          throw err;
        }

        const data = await res.json();
        if(!data || !Array.isArray(data.elements)) throw new Error('Bad Overpass payload');
        setCachedNearby(query, data);
        return data;
      }catch(err){
        lastErr = err;
        if(externalSignal?.aborted) throw err;

        const retryableStatus = [429, 502, 503, 504].includes(err.status);
        const timedOut = err.name === 'AbortError';
        const retryable = retryableStatus || timedOut;

        if(retryable && attempt < 1){
          await sleep(700 + Math.floor(Math.random() * 500));
          continue;
        }
        break;
      }finally{
        clearTimeout(timeout);
        if(externalSignal) externalSignal.removeEventListener('abort', forwardAbort);
      }
    }
  }

  throw lastErr || new Error('Nearby search failed');
}

function normalizeNearbyElement(el){
  const lat = el.lat || (el.center && el.center.lat);
  const lng = el.lon || (el.center && el.center.lon);
  return {
    id:'osm_'+el.type+'_'+el.id,
    source:'osm',
    sourceLabel:'OpenStreetMap',
    name:el.tags?.name || el.tags?.['name:en'] || guessName(el.tags || {}),
    address:buildAddr(el.tags || {}),
    lat, lng,
    dist:haversine(userLat,userLng,lat,lng),
    category:detectCat(el.tags || {}),
    tags_raw:el.tags || {},
    avgRating:0,
    reviewCount:0,
    budget:el.tags?.['charge'] || el.tags?.['fee'] || '',
    photos:[],
    hours:el.tags?.['opening_hours'] || '',
    phone:el.tags?.['phone'] || el.tags?.['contact:phone'] || '',
    website:normalizeUrl(el.tags?.['website'] || el.tags?.['contact:website'] || ''),
  };
}

function radiusPlan(catId, baseRadius){
  if(catId === 'all') return [Math.min(baseRadius, 1000)];
  const plan = [baseRadius];
  const push = r => { if(!plan.includes(r)) plan.push(r); };
  if(['fuel','metro','nature','restroom'].includes(catId)){
    push(Math.max(baseRadius, 2000));
    push(Math.max(baseRadius, 5000));
  }else if(catId !== 'user'){
    push(Math.max(baseRadius, 2000));
  }
  return plan;
}

async function fetchNearby(catId){
  activeCategory = catId;
  if(!userLat){ showView('home'); renderAll(); return; }
  const radius = parseInt((g('radiusSelect')||{}).value || 1000, 10);
  setLoad('Searching nearby places…',65);

  if(activeNearbySearch.controller) activeNearbySearch.controller.abort('new-search');
  const requestSeq = activeNearbySearch.seq + 1;
  const searchController = new AbortController();
  activeNearbySearch = { seq: requestSeq, controller: searchController };

  if(catId === 'user'){
    nearbyResults = [];
    setTimeout(() => { showView('home'); renderAll(); }, 250);
    return;
  }

  try{
    const plan = radiusPlan(catId, radius);
    let found = [];
    let usedRadius = radius;
    for(const attemptRadius of plan){
      setLoad(`Searching within ${attemptRadius >= 1000 ? (attemptRadius/1000)+' km' : attemptRadius+' m'}…`, 72);
      const query = buildOverpassQuery(catId, attemptRadius);
      const data = await fetchOverpassJson(query, searchController.signal);
      if(activeNearbySearch.seq !== requestSeq) return;

      const seen = new Set();
      found = (data.elements || [])
        .map(normalizeNearbyElement)
        .filter(p => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .filter(p => {
          if(seen.has(p.id)) return false;
          seen.add(p.id);
          return true;
        })
        .sort((a,b) => a.dist - b.dist)
        .slice(0, catId === 'all' ? 60 : 80);

      usedRadius = attemptRadius;
      if(found.length || attemptRadius === plan[plan.length - 1]) break;
    }

    if(activeNearbySearch.seq !== requestSeq) return;
    nearbyResults = found;
    const radiusMsg = usedRadius > radius ? ` Expanded search to ${usedRadius >= 1000 ? usedRadius/1000 + ' km' : usedRadius + ' m'}.` : '';
    setLoad(`Done! Found ${nearbyResults.length} nearby.${radiusMsg}`, 100);
    setTimeout(() => { showView('home'); renderAll(); }, 260);
  }catch(err){
    if(searchController.signal.aborted && activeNearbySearch.seq !== requestSeq) return;
    console.error('Nearby search failed:', err);
    const isFileProtocol = location.protocol === 'file:';
    const statusMatch = String(err?.message || '').match(/HTTP\s+(\d+)/);
    const status = err?.status || (statusMatch ? Number(statusMatch[1]) : null);
    const serviceBusy = err?.name === 'AbortError' || [429, 502, 503, 504].includes(status);
    const msg = isFileProtocol
      ? 'Nearby search failed. Open the site with Live Server or deploy it online so browser location and map requests work properly.'
      : serviceBusy
        ? 'The map service is busy right now. Please wait a few seconds and try again.'
        : 'Nearby search failed. Please refresh, allow location access, and try again.';
    toast(msg,'error');
    nearbyResults = [];
    setLoad(serviceBusy ? 'Map service is busy.' : 'Nearby search failed.',100);
    setTimeout(() => { showView('home'); renderAll(); }, 320);
  }finally{
    if(activeNearbySearch.seq === requestSeq) activeNearbySearch.controller = null;
  }
}

function guessName(t){ return t.amenity||t.tourism||t.leisure||t.shop||t.highway||t.railway||t.natural||'Unnamed Place'; }
function buildAddr(t){
  return [t['addr:housenumber'],t['addr:street'],t['addr:suburb']||t['addr:neighbourhood'],t['addr:city']||t['addr:town']].filter(Boolean).join(', ')||t['addr:full']||'';
}
function detectCat(t){
  if(t.amenity === 'fuel' || t.amenity === 'charging_station') return 'fuel';
  if(t.station === 'subway' || t.railway === 'subway_entrance' || t.subway === 'yes') return 'metro';
  if(t.leisure === 'nature_reserve' || t.tourism === 'viewpoint' || ['beach','wood','water'].includes(t.natural)) return 'nature';
  for(const [id, pairs] of Object.entries(CATEGORY_SELECTORS)){
    for(const [k,v] of pairs){ if(t[k] === v) return id; }
  }
  return 'other';
}
function haversine(la1,lo1,la2,lo2){
  if(!la1||!lo1||!la2||!lo2)return 9999;
  const R=6371000,dL=(la2-la1)*Math.PI/180,dO=(lo2-lo1)*Math.PI/180;
  const a=Math.sin(dL/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dO/2)**2;
  return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}
function fmtDist(m){ return m<1000?m+'m':(m/1000).toFixed(1)+'km'; }

function normalizeUrl(url){
  const clean = (url || '').trim();
  if(!clean) return '';
  return /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
}
function buildMapsUrl(p){
  return p.lat && p.lng
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.lat},${p.lng}`)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.name,p.address].filter(Boolean).join(' '))}`;
}
function buildDirectionsUrl(p){
  return p.lat && p.lng
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${p.lat},${p.lng}`)}`
    : buildMapsUrl(p);
}
function isFoodPlace(p){ return ['restaurant','cafe'].includes(p.category); }
function buildPlatformLinks(p){
  const query = [p.name, p.address].filter(Boolean).join(' ');
  return {
    maps: buildMapsUrl(p),
    directions: buildDirectionsUrl(p),
    website: normalizeUrl(p.website),
    zomato: `https://www.google.com/search?q=${encodeURIComponent(`${query} site:zomato.com`)}`,
    swiggy: `https://www.google.com/search?q=${encodeURIComponent(`${query} site:swiggy.com`)}`,
  };
}
function sourceLabel(p){ return p.source === 'user' ? 'Community Added' : (p.sourceLabel || 'Live Source'); }

async function refetchAll(){
  if(!userLat)return;
  showView('loading');setLoad('Refreshing…',20);
  await fetchNearby(activeCategory);
}


/* ── RENDER ── */
function buildCatBar(){
  const bar=g('catBar');
  bar.innerHTML=CATS.map(c=>`<div class="cat-pill${c.id===activeCategory?' active':''}" onclick="changeCat('${c.id}')">${c.icon ? c.icon + ' ' : ''}${c.label}</div>`).join('');
}

function changeCat(id){
  if(id===activeCategory)return;
  activeCategory=id;
  if(id==='user'){buildCatBar();renderAll();return;}
  buildCatBar();
  showView('loading');setLoad('Fetching '+CAT[id].label+'…',20);
  fetchNearby(id);
}

function allPlaces(){
  const revMap={};
  Object.entries(reviews).forEach(([pid,rvs])=>{
    if(!rvs.length)return;
    revMap[pid]={ avg:parseFloat((rvs.reduce((s,r)=>s+r.rating,0)/rvs.length).toFixed(1)), cnt:rvs.length };
  });
  const enrich=p=>{ const r=revMap[p.id]||{}; return {...p, avgRating:r.avg||p.avgRating||0, reviewCount:r.cnt||p.reviewCount||0}; };

  let list=[];
  if(activeCategory==='user') list=[...userPlaces].map(enrich);
  else if(activeCategory==='all') list=[...nearbyResults,...userPlaces].map(enrich);
  else list=[...nearbyResults.filter(p=>p.category===activeCategory),...userPlaces.filter(p=>p.category===activeCategory)].map(enrich);

  const sort=val('sortSel')||'distance';
  if(sort==='distance') list.sort((a,b)=>(a.dist||9999)-(b.dist||9999));
  else if(sort==='rating') list.sort((a,b)=>(b.avgRating||0)-(a.avgRating||0));
  else list.sort((a,b)=>a.name.localeCompare(b.name));
  return list;
}

function renderAll(){
  buildCatBar();
  const list=allPlaces();
  const cnt=g('resultsCount');
  if(cnt) cnt.innerHTML=`<span>${list.length}</span> place${list.length!==1?'s':''} found near you`;
  const grid=g('placesGrid');
  if(!list.length){
    grid.innerHTML=`<div class="empty-state">
      <span class="es-icon">${activeCategory==='user'?'⭐':'🔍'}</span>
      <div class="es-title">${activeCategory==='user'?'No community places yet':'Nothing found nearby'}</div>
      <p class="es-desc">${activeCategory==='user'?'Be the first to add a store or place!':'Try a different category or increase the search radius.'}</p>
      <button class="btn btn-primary" onclick="requireAuth(openAddModal)">+ Add a Place</button>
    </div>`;
    return;
  }
  grid.innerHTML=list.map(placeCard).join('');
}

/* ── CATEGORY FALLBACK IMAGES (Unsplash) ── */
/* Multiple images per category — picked by place id to give variety */
const CAT_IMGS = {
  restaurant: [
    'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&q=80',
    'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&q=80',
    'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&q=80',
    'https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?w=600&q=80',
    'https://images.unsplash.com/photo-1579684947550-22e945225d9a?w=600&q=80',
  ],
  cafe: [
    'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=600&q=80',
    'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600&q=80',
    'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&q=80',
    'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=600&q=80',
  ],
  hotel: [
    'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&q=80',
    'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?w=600&q=80',
    'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=600&q=80',
    'https://images.unsplash.com/photo-1600011689032-8b628b8a8747?w=600&q=80',
  ],
  restroom: [
    'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=600&q=80',
    'https://images.unsplash.com/photo-1584622781564-1d987f7333c1?w=600&q=80',
    'https://images.unsplash.com/photo-1507089947368-19c1da9775ae?w=600&q=80',
  ],
  railway: [
    'https://images.unsplash.com/photo-1474487548417-781cb71495f3?w=600&q=80',
    'https://images.unsplash.com/photo-1532105956626-9569c03602f6?w=600&q=80',
    'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=600&q=80',
    'https://images.unsplash.com/photo-1510415590474-56ebb4b2b0a0?w=600&q=80',
  ],
  bus: [
    'https://images.unsplash.com/photo-1570125909232-eb263c188f7e?w=600&q=80',
    'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=600&q=80',
    'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=600&q=80',
  ],
  hospital: [
    'https://images.unsplash.com/photo-1516574187841-cb9cc2ca948b?w=600&q=80',
    'https://images.unsplash.com/photo-1538108149393-fbbd81895907?w=600&q=80',
    'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=600&q=80',
    'https://images.unsplash.com/photo-1586773860418-d37222d8fce3?w=600&q=80',
  ],
  atm: [
    'https://images.unsplash.com/photo-1601597111158-2fceff292cdc?w=600&q=80',
    'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=600&q=80',
    'https://images.unsplash.com/photo-1565043589221-1a6fd9ae45c7?w=600&q=80',
  ],
  fuel: [
    'https://images.unsplash.com/photo-1545465012-c1a6b6ffe131?w=600&q=80',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80',
    'https://images.unsplash.com/photo-1611270629569-8b357cb88da9?w=600&q=80',
  ],
  park: [
    'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?w=600&q=80',
    'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600&q=80',
    'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=600&q=80',
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600&q=80',
  ],
  nature: [
    'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=600&q=80',
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600&q=80',
    'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600&q=80',
  ],
  metro: [
    'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=600&q=80',
    'https://images.unsplash.com/photo-1510415590474-56ebb4b2b0a0?w=600&q=80',
    'https://images.unsplash.com/photo-1532105956626-9569c03602f6?w=600&q=80',
  ],
  shopping: [
    'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&q=80',
    'https://images.unsplash.com/photo-1519566335946-e6f65f0f4fdf?w=600&q=80',
    'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=600&q=80',
  ],
  worship: [
    'https://images.unsplash.com/photo-1561361058-c24cecae35ca?w=600&q=80',
    'https://images.unsplash.com/photo-1548013146-72479768bada?w=600&q=80',
    'https://images.unsplash.com/photo-1585116938581-e7b29e0bab68?w=600&q=80',
    'https://images.unsplash.com/photo-1568454537842-d933259bb258?w=600&q=80',
  ],
  school: [
    'https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=600&q=80',
    'https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?w=600&q=80',
    'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=600&q=80',
  ],
  other: [
    'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=600&q=80',
    'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=600&q=80',
    'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=600&q=80',
  ],
  user: [
    'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=600&q=80',
    'https://images.unsplash.com/photo-1519125323398-675f0ddb6308?w=600&q=80',
  ],
};

function getCatImg(catId, placeId) {
  const pool = CAT_IMGS[catId] || CAT_IMGS['other'];
  /* pick deterministically by place id so same place always gets same image */
  let hash = 0;
  for (let i = 0; i < (placeId||'').length; i++) hash += placeId.charCodeAt(i);
  return pool[hash % pool.length];
}


function placeCard(p){
  const saved = savedIds.includes(p.id);
  const cat   = CAT[p.category] || {icon:'', label:''};
  const imgs  = p.photos || [];
  const dist  = p.dist != null ? fmtDist(p.dist) : '';
  const links = buildPlatformLinks(p);

  const imgSrc = imgs.length ? imgs[0] : getCatImg(p.category, p.id);
  const fallback = getCatImg(p.category, p.id+'_fb');

  return `<div class="place-card" onclick="openDetail('${p.id}')">
    <div class="card-img-wrap">
      <img class="card-img" src="${imgSrc}" alt="${p.name}" loading="lazy"
           onerror="this.src='${fallback}';this.onerror=null;"/>
      ${dist ? `<div class="card-dist">${dist}</div>` : ''}
      <button class="card-save${saved?' saved':''}" onclick="event.stopPropagation();toggleSave('${p.id}',this)">${saved?'Saved':'Save'}</button>
      ${cat.label ? `<div class="card-cat">${cat.label}</div>` : ''}
      <div class="card-source">${sourceLabel(p)}</div>
    </div>
    <div class="card-body">
      <div class="card-name">${p.name}</div>
      <div class="card-addr">${p.address || 'Nearby'}</div>
      <div class="card-foot">
        <div class="card-rating">
          ${starsHTML(p.avgRating||0)}
          <span class="rating-val">${p.avgRating ? p.avgRating.toFixed(1) : '—'}</span>
          ${p.reviewCount ? `<span class="rating-cnt">(${p.reviewCount})</span>` : ''}
        </div>
        ${p.budget ? `<div class="card-budget">${p.budget}</div>` : ''}
      </div>
    </div>
    <div class="card-link-row">
      <a class="mini-link" href="${links.maps}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Maps</a>
      ${isFoodPlace(p) ? `<a class="mini-link" href="${links.swiggy}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Swiggy</a>
      <a class="mini-link" href="${links.zomato}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Zomato</a>` : ''}
      ${links.website ? `<a class="mini-link" href="${links.website}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Website</a>` : ''}
    </div>
  </div>`;
}

function starsHTML(r){
  const f=Math.floor(r),h=r-f>=.5?1:0,e=5-f-h;
  return `<div class="stars">${'<span class="star">★</span>'.repeat(f)}${h?'<span class="star">★</span>':''}${'<span class="star empty">★</span>'.repeat(e)}</div>`;
}

function toggleSave(id,btn){
  const i=savedIds.indexOf(id);
  if(i>-1){savedIds.splice(i,1);btn.textContent='Save';btn.classList.remove('saved');toast('Removed from saved','info');}
  else{savedIds.push(id);btn.textContent='Saved';btn.classList.add('saved');toast('Saved','success');}
  saveSaved();
}
function changeSort(v){ activeSort=v; renderAll(); }

/* ── DETAIL ── */

function openDetail(id){
  currentPlaceId=id; galIdx=0;
  const p=[...nearbyResults,...userPlaces].find(x=>x.id===id);
  if(!p)return;
  const rvs=reviews[id]||[];
  const avg=rvs.length?parseFloat((rvs.reduce((s,r)=>s+r.rating,0)/rvs.length).toFixed(1)):(p.avgRating||0);
  const cat=CAT[p.category]||{icon:'',label:''};
  const imgs=p.photos||[];
  const saved=savedIds.includes(id);
  const dist=p.dist!=null?fmtDist(p.dist):'';
  const rb=[5,4,3,2,1].map(n=>({n,cnt:rvs.filter(r=>r.rating===n).length,pct:rvs.length?Math.round(rvs.filter(r=>r.rating===n).length/rvs.length*100):0}));
  const links = buildPlatformLinks(p);

  const fallbackImg = getCatImg(p.category, p.id);
  let galHtml=imgs.length
    ?`<div class="det-gal" id="detGal">
        <img class="det-gal-img" id="galMain" src="${imgs[0]}" alt="${p.name}" onerror="this.src='${fallbackImg}';this.onerror=null;"/>
        ${imgs.length>1?`<button class="det-gal-nav det-gal-prev" onclick="changeGal(-1)">‹</button><button class="det-gal-nav det-gal-next" onclick="changeGal(1)">›</button><div class="det-gal-cnt" id="galCnt">1/${imgs.length}</div>`:''}
      </div>`
    :`<div class="det-gal"><img class="det-gal-img" src="${fallbackImg}" alt="${p.name}" style="filter:brightness(.85)"/></div>`;

  g('detailContent').innerHTML=`${galHtml}
  <div class="det-body">
    <div class="det-name">${p.name}</div>
    <div class="det-addr">${p.address||'Location nearby'}</div>
    <div class="det-chips">
      ${dist?`<span class="det-chip chip-dist">${dist} away</span>`:''}
      ${p.budget?`<span class="det-chip chip-budget">${p.budget}</span>`:''}
      <span class="det-chip chip-cat">${cat.icon} ${cat.label}</span>
      <span class="det-chip chip-source">${sourceLabel(p)}</span>
    </div>
    ${avg||rvs.length?`<div class="det-rating-row"><div class="det-score">${avg.toFixed(1)}</div>${starsHTML(avg)}<span style="font-size:.8rem;color:var(--ink4);margin-left:4px">(${rvs.length} review${rvs.length!==1?'s':''})</span></div>`:''}
    <div class="det-actions">
      <button class="btn btn-primary btn-sm" onclick="requireAuth(()=>openReview('${id}'))">Write review</button>
      <button class="btn btn-ghost btn-sm" id="detSave" onclick="toggleSaveDetail('${id}',this)">${saved?'Saved':'Save'}</button>
      <a class="btn-maps" href="${links.maps}" target="_blank" rel="noopener">Open Maps</a>
      <a class="btn-maps" href="${links.directions}" target="_blank" rel="noopener">Directions</a>
    </div>
    ${isFoodPlace(p)?`<div class="det-platforms">
      <a class="det-platform-btn" href="${links.swiggy}" target="_blank" rel="noopener">Find on Swiggy</a>
      <a class="det-platform-btn" href="${links.zomato}" target="_blank" rel="noopener">Find on Zomato</a>
    </div>`:''}
    ${p.desc?`<p class="det-desc">${p.desc}</p>`:''}
    <div class="det-info">
      ${p.hours?`<div class="info-blk"><div class="info-lbl">Hours</div><div class="info-val">${p.hours}</div></div>`:''}
      ${p.phone?`<div class="info-blk"><div class="info-lbl">Phone</div><div class="info-val">${p.phone}</div></div>`:''}
      ${links.website?`<div class="info-blk"><div class="info-lbl">Website</div><div class="info-val"><a href="${links.website}" target="_blank" rel="noopener" style="color:var(--primary)">${links.website}</a></div></div>`:''}
    </div>
    ${p.tags&&p.tags.length?`<div class="det-tags">${p.tags.map(t=>`<span class="tag-badge">#${t}</span>`).join('')}</div>`:''}
    <div class="reviews-ttl">Reviews${rvs.length?` (${rvs.length})`:''}</div>
    ${rvs.length?`<div class="rb-wrap">
      <div class="rb-score"><div class="rb-big">${avg.toFixed(1)}</div>${starsHTML(avg)}<div class="rb-cnt">${rvs.length} review${rvs.length!==1?'s':''}</div></div>
      <div class="rb-bars">${rb.map(r=>`<div class="rb-row"><div class="rb-lbl">${r.n}★</div><div class="rb-track"><div class="rb-fill" style="width:${r.pct}%"></div></div><div class="rb-n">${r.cnt}</div></div>`).join('')}</div>
    </div>`:''}
    ${rvs.length?rvs.map(r=>`<div class="rv-card">
      <div class="rv-hd">
        <div class="rv-user"><div class="rv-av" style="background:${avColor(r.userName)}">${initials(r.userName)}</div><div><div class="rv-name">${r.userName}</div><div class="rv-date">${fmtDate(r.date)}</div></div></div>
        ${starsHTML(r.rating)}
      </div>
      <p class="rv-text">${r.text}</p>
      ${r.budget?`<span class="rv-budget">Spent: ${r.budget}</span>`:''}
      ${r.photos&&r.photos.length?`<div class="rv-photos">${r.photos.map(ph=>`<img class="rv-photo" src="${ph}" onerror="this.style.display='none'">`).join('')}</div>`:''}
    </div>`).join('')
    :`<div class="no-reviews">No reviews yet. Be the first.</div>`}
    <div style="text-align:center;margin-top:14px;">
      <button class="btn btn-primary" onclick="requireAuth(()=>openReview('${id}'))">Write a Review</button>
    </div>
  </div>`;
  openModal('detailModal');
}

function changeGal(dir){
  const p=[...nearbyResults,...userPlaces].find(x=>x.id===currentPlaceId);
  if(!p||!p.photos||!p.photos.length)return;
  galIdx=(galIdx+dir+p.photos.length)%p.photos.length;
  const m=g('galMain'); if(m)m.src=p.photos[galIdx];
  const c=g('galCnt'); if(c)c.textContent=`${galIdx+1}/${p.photos.length}`;
}

function toggleSaveDetail(id,btn){
  const i=savedIds.indexOf(id);
  if(i>-1){savedIds.splice(i,1);btn.textContent='Save';toast('Removed from saved','info');}
  else{savedIds.push(id);btn.textContent='Saved';toast('Saved','success');}
  saveSaved();
}

/* ── ADD PLACE ── */
function openAddModal(){
  addPhotos=[];addTags=[];addStars=0;
  ['apName','apAddress','apBudget','apDesc','apHours','apPhone','apPhotoUrl'].forEach(id=>{const el=g(id);if(el)el.value='';});
  const fs=g('apCategory');if(fs)fs.value='';
  renderAddPhotos();renderAddTags();
  document.querySelectorAll('#apStarPicker .sp-btn').forEach(b=>b.classList.remove('lit'));
  openModal('addModal');
}

function detectMyLoc(){
  if(!userLat){toast('Allow location first','error');return;}
  const btn=g('detectLocBtn');
  if(btn){btn.textContent='Working…';btn.disabled=true;}
  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${userLat}&lon=${userLng}&zoom=18`)
    .then(r=>r.json()).then(d=>{
      const el=g('apAddress');if(el)el.value=d.display_name||`${userLat.toFixed(5)}, ${userLng.toFixed(5)}`;
      if(btn){btn.textContent='Use current location';btn.disabled=false;}
    }).catch(()=>{
      const el=g('apAddress');if(el)el.value=`${userLat.toFixed(5)}, ${userLng.toFixed(5)}`;
      if(btn){btn.textContent='Use current location';btn.disabled=false;}
    });
}

function setApStars(n){
  addStars=n;
  document.querySelectorAll('#apStarPicker .sp-btn').forEach(b=>b.classList.toggle('lit',parseInt(b.dataset.val)<=n));
}
function setRvStars(n){
  rvStars=n;
  document.querySelectorAll('#rvStarPicker .sp-btn').forEach(b=>b.classList.toggle('lit',parseInt(b.dataset.val)<=n));
}

function handleTagKey(e){
  if(e.key==='Enter'||e.key===','){
    e.preventDefault();
    const inp=g('tagInp');const v=(inp.value||'').trim().replace(/,/,'');
    if(v&&!addTags.includes(v)){addTags.push(v);inp.value='';renderAddTags();}
  }
}
function removeTag(t){addTags=addTags.filter(x=>x!==t);renderAddTags();}
function renderAddTags(){
  const w=g('tagWrap');if(!w)return;
  w.innerHTML=addTags.map(t=>`<span class="tag-chip">#${t}<span class="tag-rm" onclick="removeTag('${t}')">✕</span></span>`).join('')
    +`<input class="tag-inp" id="tagInp" placeholder="${addTags.length?'More…':'Add tags…'}" onkeydown="handleTagKey(event)"/>`;
}
function handlePhotoFile(e){
  Array.from(e.target.files).forEach(f=>{
    const r=new FileReader();r.onload=ev=>{addPhotos.push(ev.target.result);renderAddPhotos();};r.readAsDataURL(f);
  });
}
function addPhotoByUrl(){
  const u=(val('apPhotoUrl')||'').trim();if(!u)return;
  addPhotos.push(u);const el=g('apPhotoUrl');if(el)el.value='';renderAddPhotos();
}
function renderAddPhotos(){
  const p=g('photosPreview');if(!p)return;
  p.innerHTML=addPhotos.map((ph,i)=>`<div class="ph-thumb"><img src="${ph}" alt="" onerror="this.style.display='none'"/><button class="ph-rm" onclick="addPhotos.splice(${i},1);renderAddPhotos()">✕</button></div>`).join('');
}
function dragOver(e){e.preventDefault();g('photoZone').classList.add('drag');}
function dragLeave(){g('photoZone').classList.remove('drag');}
function dropPhoto(e){
  e.preventDefault();dragLeave();
  Array.from(e.dataTransfer.files).forEach(f=>{
    const r=new FileReader();r.onload=ev=>{addPhotos.push(ev.target.result);renderAddPhotos();};r.readAsDataURL(f);
  });
}

async function submitPlace(){
  if(!currentUser){openModal('authModal');return;}
  const name=(val('apName')||'').trim();
  const addr=(val('apAddress')||'').trim();
  const cat=val('apCategory');
  const budget=(val('apBudget')||'').trim();
  const desc=(val('apDesc')||'').trim();
  if(!name){toast('Place name is required','error');return;}
  if(!addr){toast('Address is required','error');return;}
  if(!cat){toast('Please select a category','error');return;}
  const place={
    id:'usr_'+uid(),source:'user', sourceLabel:'Community',
    name,address:addr,lat:userLat,lng:userLng,dist:0,
    category:cat,budget,desc,
    hours:val('apHours'),phone:val('apPhone'),
    photos:[...addPhotos],tags:[...addTags],
    addedBy:currentUser.id,addedByName:currentUser.name,
    date:today(),avgRating:addStars||0,reviewCount:0,
  };
  userPlaces.unshift(place);
  if(addStars>0){
    if(!reviews[place.id])reviews[place.id]=[];
    reviews[place.id].push({id:uid(),placeId:place.id,userId:currentUser.id,userName:currentUser.name,rating:addStars,text:desc||'Added this place!',budget,photos:[],date:today()});
    saveRevs();
  }
  savePlaces();
  closeModal('addModal');
  toast(`"${name}" published! 🎉`,'success');
  renderAll();
}

/* ── REVIEW ── */
function openReview(id){
  currentPlaceId=id;
  const p=[...nearbyResults,...userPlaces].find(x=>x.id===id);
  const el=g('rvPlaceName');if(el)el.textContent=p?`📍 ${p.name}`:'';
  rvStars=0;rvPhotos=[];
  ['rvText','rvBudget','rvPhotoUrl'].forEach(id=>{const e=g(id);if(e)e.value='';});
  const prev=g('rvPhotosPreview');if(prev)prev.innerHTML='';
  document.querySelectorAll('#rvStarPicker .sp-btn').forEach(b=>b.classList.remove('lit'));
  openModal('reviewModal');
}
function addRvPhoto(){
  const u=(val('rvPhotoUrl')||'').trim();if(!u)return;
  rvPhotos.push(u);const el=g('rvPhotoUrl');if(el)el.value='';
  const prev=g('rvPhotosPreview');
  if(prev)prev.innerHTML=rvPhotos.map((ph,i)=>`<div class="ph-thumb"><img src="${ph}" alt=""/><button class="ph-rm" onclick="rvPhotos.splice(${i},1);addRvPhoto()">✕</button></div>`).join('');
}
async function submitReview(){
  if(!currentUser){openModal('authModal');return;}
  if(!rvStars){toast('Please give a star rating','error');return;}
  const text=(val('rvText')||'').trim();
  if(!text){toast('Please write your review','error');return;}
  if(!reviews[currentPlaceId])reviews[currentPlaceId]=[];
  reviews[currentPlaceId].push({id:uid(),placeId:currentPlaceId,userId:currentUser.id,userName:currentUser.name,rating:rvStars,text,budget:val('rvBudget'),photos:[...rvPhotos],date:today()});
  saveRevs();
  closeModal('reviewModal');
  toast('Review published! 🙌','success');
  openDetail(currentPlaceId);
  renderAll();
}

/* ── AUTH ── */
const UKEY='pt_users';
function getUsers(){return ls(UKEY)||[];}
function saveUsers(u){lss(UKEY,u);}

function loginUser(){
  const email=(val('loginEmail')||'').trim().toLowerCase();
  const pwd=val('loginPwd');
  if(!email||!pwd){toast('Fill all fields','error');return;}
  const users=getUsers();
  const user=users.find(u=>u.email===email&&u.password===pwd);
  if(!user){toast('Invalid email or password','error');return;}
  currentUser=user;saveUser();updateNav();closeModal('authModal');
  toast(`Welcome back, ${user.name}! 👋`,'success');
  if(authCb){authCb();authCb=null;}
}
function signupUser(){
  const name=(val('suName')||'').trim();
  const email=(val('suEmail')||'').trim().toLowerCase();
  const pwd=val('suPwd');const conf=val('suConfirm');
  if(!name||!email||!pwd){toast('Fill all required fields','error');return;}
  if(pwd!==conf){toast('Passwords do not match','error');return;}
  if(pwd.length<6){toast('Password must be at least 6 characters','error');return;}
  const users=getUsers();
  if(users.find(u=>u.email===email)){toast('Email already registered','error');return;}
  const user={id:uid(),name,email,password:pwd,joined:today()};
  users.push(user);saveUsers(users);
  currentUser=user;saveUser();updateNav();closeModal('authModal');
  toast(`Welcome to PlaceTalk, ${name}! 🎉`,'success');
  if(authCb){authCb();authCb=null;}
}
function logoutUser(){
  currentUser=null;clearUser();updateNav();
  closeModal('profileModal');toast('Logged out. See you soon!','info');
  closeDd();
}
function updateNav(){
  const area=g('navUserArea');if(!area)return;
  if(currentUser){
    const col=avColor(currentUser.name);
    area.innerHTML=`
      <button class="btn btn-outline-primary btn-sm" onclick="requireAuth(openAddModal)" style="font-size:.74rem;">+ Add Place</button>
      <div class="nav-avatar" id="navAv" style="background:${col}" onclick="toggleDd()">${initials(currentUser.name)}
        <div class="dd-menu" id="navDd">
          <div class="dd-item" onclick="showProfile()">👤 My Profile</div>
          <div class="dd-item" onclick="requireAuth(openAddModal)">➕ Add Place</div>
          <div class="dd-sep"></div>
          <div class="dd-item danger" onclick="logoutUser()">🚪 Log Out</div>
        </div>
      </div>`;
  } else {
    area.innerHTML=`
      <button class="btn btn-ghost btn-sm" onclick="openModal('authModal')">Log in</button>
      <button class="btn btn-primary btn-sm" onclick="openModal('authModal');switchAuthTab('signup')">Sign up</button>`;
  }
}
function toggleDd(){const d=g('navDd');if(d)d.classList.toggle('open');}
function closeDd(){const d=g('navDd');if(d)d.classList.remove('open');}
document.addEventListener('click',e=>{const av=g('navAv');if(av&&!av.contains(e.target))closeDd();});
function requireAuth(cb){if(currentUser){cb();}else{authCb=cb;openModal('authModal');}}
function switchAuthTab(tab){
  document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.auth-panel').forEach(p=>p.classList.remove('active'));
  g('atab-'+tab).classList.add('active');
  g('apanel-'+tab).classList.add('active');
}

/* ── PROFILE ── */
function showProfile(){closeDd();openModal('profileModal');renderProfile();}
function renderProfile(){
  if(!currentUser)return;
  const col=avColor(currentUser.name);
  g('profAv').style.background=col;g('profAv').textContent=initials(currentUser.name);
  g('profName').textContent=currentUser.name;
  g('profEmail').textContent=currentUser.email;
  const myPlaces=userPlaces.filter(p=>p.addedBy===currentUser.id);
  const myRevs=Object.values(reviews).flat().filter(r=>r.userId===currentUser.id);
  const mySaved=[...nearbyResults,...userPlaces].filter(p=>savedIds.includes(p.id));
  g('pStatP').textContent=myPlaces.length;
  g('pStatR').textContent=myRevs.length;
  g('pStatS').textContent=mySaved.length;
  g('ppMyPlaces').innerHTML=myPlaces.length?myPlaces.map(placeCard).join(''):`<div class="empty-state" style="padding:40px 0"><span class="es-icon">🏙️</span><div class="es-title">No places yet</div><button class="btn btn-primary" onclick="closeModal('profileModal');requireAuth(openAddModal)">+ Add Place</button></div>`;
  g('ppMyRevs').innerHTML=myRevs.length?myRevs.map(r=>{const pl=[...nearbyResults,...userPlaces].find(p=>p.id===r.placeId);return`<div class="rv-card" onclick="pl&&openDetail('${r.placeId}')" style="cursor:pointer"><div class="rv-hd"><div style="font-weight:700;color:var(--ink)">${pl?pl.name:'Unknown Place'}</div>${starsHTML(r.rating)}</div><div style="font-size:.72rem;color:var(--ink4);margin-bottom:5px">${fmtDate(r.date)}</div><p class="rv-text">${r.text}</p></div>`;}).join(''):`<div class="empty-state" style="padding:40px 0"><span class="es-icon">📝</span><div class="es-title">No reviews yet</div></div>`;
  g('ppSaved').innerHTML=mySaved.length?mySaved.map(placeCard).join(''):`<div class="empty-state" style="padding:40px 0"><span class="es-icon">❤️</span><div class="es-title">No saved places</div></div>`;
  const sn=g('settName');if(sn)sn.value=currentUser.name;
}
function switchProfTab(tab,el){
  document.querySelectorAll('.prof-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.prof-panel').forEach(p=>p.classList.remove('active'));
  if(el)el.classList.add('active');
  g('pp-'+tab).classList.add('active');
}
function saveSettings(){
  const name=(val('settName')||'').trim();
  const pwd=val('settPwd');
  if(!name){toast('Name cannot be empty','error');return;}
  currentUser.name=name;
  if(pwd){if(pwd.length<6){toast('Password min 6 chars','error');return;}currentUser.password=pwd;}
  const users=getUsers();const i=users.findIndex(u=>u.id===currentUser.id);
  if(i>-1)users[i]=currentUser;
  saveUsers(users);saveUser();updateNav();renderProfile();
  toast('Settings saved ✅','success');
}

/* ── MODALS ── */
function openModal(id){const m=g(id);if(m){m.classList.add('open');document.body.style.overflow='hidden';}}
function closeModal(id){const m=g(id);if(m){m.classList.remove('open');document.body.style.overflow='';}}
function closeOnBd(e,id){if(e.target===g(id))closeModal(id);}
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal-ov.open').forEach(m=>m.classList.remove('open'));});

/* ── TOAST ── */
function toast(msg,type=''){
  const c=g('toastWrap');const t=document.createElement('div');
  t.className='toast'+(type?' '+type:'');t.textContent=msg;c.appendChild(t);
  requestAnimationFrame(()=>requestAnimationFrame(()=>t.classList.add('show')));
  setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),400);},3400);
}

/* ── HERO BG ROTATOR ── */
const heroBgs=[
  'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1800&q=85',
  'https://images.unsplash.com/photo-1487958449943-2429e8be8625?w=1800&q=85',
  'https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=1800&q=85',
  'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1800&q=85',
];
let heroBgIdx=0,heroBgTimer=null;
function startHeroBgRotation(){
  if(heroBgTimer)return;
  heroBgTimer=setInterval(()=>{
    heroBgIdx=(heroBgIdx+1)%heroBgs.length;
    const img=g('heroBgImg');if(!img)return;
    img.style.transition='opacity 1.2s';img.style.opacity='0';
    setTimeout(()=>{img.src=heroBgs[heroBgIdx];img.style.opacity='1';},1200);
  },6000);
}

/* ── INIT ── */
function initCustomCursor(){
  if(window.matchMedia('(pointer: coarse)').matches) return;
  const dot=g('cursorDot');
  const ring=g('cursorRing');
  if(!dot || !ring) return;
  let x=window.innerWidth/2, y=window.innerHeight/2;
  let rx=x, ry=y;
  document.addEventListener('mousemove',e=>{
    x=e.clientX; y=e.clientY;
    dot.style.transform=`translate(${x}px, ${y}px)`;
    document.body.classList.add('cursor-ready');
  }, {passive:true});
  const tick=()=>{
    rx += (x-rx)*0.18;
    ry += (y-ry)*0.18;
    ring.style.transform=`translate(${rx}px, ${ry}px)`;
    requestAnimationFrame(tick);
  };
  tick();
  document.addEventListener('mousedown',()=>document.body.classList.add('cursor-down'));
  document.addEventListener('mouseup',()=>document.body.classList.remove('cursor-down'));
  document.addEventListener('mouseover',e=>{
    if(e.target.closest('a, button, input, select, textarea, .nav-logo, .premium-cat-tile, .premium-quick-btn, .visual-slide, .place-card, .chip, .btn, .btn-loc, .modal-x, .save-btn, .platform-btn, .action-btn')){
      document.body.classList.add('cursor-hover');
    }
  });
  document.addEventListener('mouseout',e=>{
    if(e.target.closest('a, button, input, select, textarea, .nav-logo, .premium-cat-tile, .premium-quick-btn, .visual-slide, .place-card, .chip, .btn, .btn-loc, .modal-x, .save-btn, .platform-btn, .action-btn')){
      document.body.classList.remove('cursor-hover');
    }
  });
  document.addEventListener('mouseleave',()=>document.body.classList.remove('cursor-ready'));
  document.addEventListener('mouseenter',()=>document.body.classList.add('cursor-ready'));
}

function init(){
  load();
  updateNav();
  startHeroBgRotation();
  initCustomCursor();
}
init();
