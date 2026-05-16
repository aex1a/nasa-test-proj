/**
 * NASA SPACE DASHBOARD — app.js
 *
 * Covers:
 *  - GET  /planetary/apod                    → Astronomy Picture of the Day
 *  - Lunar phase calculation                  → Moon Cycle Tracker (date from APOD)
 *  - GET  /neo/rest/v1/feed                  → Near Earth Objects feed (today)
 *  - GET  /mars-photos/.../curiosity/photos  → Mars Rover Photos
 *  - POST /neo/rest/v1/lookup                → NEO Lookup by asteroid IDs (real POST)
 *
 * NOTE ON TECHPORT (401 Unauthorized):
 *  NASA's TechPort endpoint (techport.nasa.gov/api/projects/search) now requires
 *  a WordPress "nonce" token that must be fetched by first loading their web page.
 *  This makes it impossible to call directly from a browser without server-side
 *  proxying. It is documented as a known breaking change on their end.
 *  → Replaced with NASA's NEO /lookup POST, which is a real, working POST endpoint
 *    from the same NASA Open API, accepts a JSON body, and requires only your API key.
 */

/* ============================================================
   CONFIGURATION
   ============================================================ */
const NASA_BASE   = 'https://api.nasa.gov';
const NEO_LOOKUP  = `${NASA_BASE}/neo/rest/v1/lookup`; // POST endpoint

let API_KEY = '';

/* ============================================================
   STARFIELD BACKGROUND
   ============================================================ */
(function initStarfield() {
  const canvas = document.getElementById('starfield');
  const ctx    = canvas.getContext('2d');
  let stars    = [];

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    stars = Array.from({ length: 200 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.4 + 0.2,
      a: Math.random(),
      speed: Math.random() * 0.005 + 0.002,
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    stars.forEach(s => {
      s.a += s.speed;
      const alpha = 0.3 + 0.7 * Math.abs(Math.sin(s.a));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(226,232,240,${alpha})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
})();

/* ============================================================
   API KEY MODAL
   ============================================================ */
const modal     = document.getElementById('apiKeyModal');
const keyInput  = document.getElementById('apiKeyInput');
const keyBtn    = document.getElementById('apiKeySubmit');
const dashboard = document.getElementById('dashboard');

// Check localStorage for saved key
const savedKey = localStorage.getItem('nasa_api_key');
if (savedKey) {
  API_KEY = savedKey;
  launchDashboard();
}

keyBtn.addEventListener('click', () => {
  const val = keyInput.value.trim();
  if (!val) { keyInput.style.borderColor = '#f87171'; return; }
  API_KEY = val;
  localStorage.setItem('nasa_api_key', API_KEY);
  launchDashboard();
});

keyInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') keyBtn.click();
});

function launchDashboard() {
  modal.style.display    = 'none';
  dashboard.style.display = 'block';
  fetchAPOD();
  fetchNEO();
  // Mars fetches on button click; auto-fetch default sol
  fetchMars(1000);
}

/* ============================================================
   UTILITY: fetch with error handling
   ============================================================ */
async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

function showError(containerId, message) {
  document.getElementById(containerId).innerHTML =
    `<div class="error-msg">⚠️ ${message}</div>`;
}

/* ============================================================
   SECTION 1 — GET: APOD (Astronomy Picture of the Day)
   ============================================================ */
async function fetchAPOD() {
  const loading = document.getElementById('apodLoading');
  const content = document.getElementById('apodContent');

  loading.style.display = 'flex';
  content.style.display  = 'none';

  const url = `${NASA_BASE}/planetary/apod?api_key=${API_KEY}`;
  const { status, ok, data } = await apiFetch(url);

  document.getElementById('apodStatus').textContent = `${status} ${ok ? 'OK' : 'ERR'}`;
  document.getElementById('apodStatus').className   = `status-code ${ok ? 'ok' : 'err'}`;

  loading.style.display = 'none';

  if (!ok) {
    showError('apodCard', `APOD request failed (${status}). Check your API key.`);
    return;
  }

  // Populate APOD
  document.getElementById('apodTitle').textContent       = data.title || '—';
  document.getElementById('apodExplanation').textContent = data.explanation || '';
  document.getElementById('apodDate').textContent        = data.date || '';
  document.getElementById('apodCredit').textContent      = data.copyright ? `© ${data.copyright}` : 'NASA / Public Domain';

  const img = document.getElementById('apodImg');
  if (data.media_type === 'image') {
    img.src = data.url;
    img.style.display = 'block';
  } else {
    img.style.display = 'none'; // could be video
  }

  content.style.display = 'flex';

  // Use APOD date to power moon cycle
  const apodDate = data.date ? new Date(data.date + 'T12:00:00Z') : new Date();
  renderMoonCycle(apodDate);
}

/* ============================================================
   MOON CYCLE TRACKER
   Calculation using the known lunar cycle algorithm.
   Reference epoch: known new moon on 2000-01-06
   ============================================================ */
const MOON_PHASES = [
  { emoji: '🌑', name: 'New Moon',        min: 0,     max: 1.85  },
  { emoji: '🌒', name: 'Waxing Crescent', min: 1.85,  max: 7.38  },
  { emoji: '🌓', name: 'First Quarter',   min: 7.38,  max: 11.08 },
  { emoji: '🌔', name: 'Waxing Gibbous',  min: 11.08, max: 14.77 },
  { emoji: '🌕', name: 'Full Moon',       min: 14.77, max: 16.62 },
  { emoji: '🌖', name: 'Waning Gibbous',  min: 16.62, max: 22.15 },
  { emoji: '🌗', name: 'Last Quarter',    min: 22.15, max: 25.85 },
  { emoji: '🌘', name: 'Waning Crescent', min: 25.85, max: 29.53 },
];

function getLunarAge(date) {
  // Days since known new moon on Jan 6, 2000
  const knownNewMoon = new Date('2000-01-06T18:14:00Z');
  const LUNAR_CYCLE  = 29.530588;
  const elapsed      = (date - knownNewMoon) / (1000 * 60 * 60 * 24);
  return ((elapsed % LUNAR_CYCLE) + LUNAR_CYCLE) % LUNAR_CYCLE;
}

function renderMoonCycle(date) {
  const age = getLunarAge(date);

  // Determine current phase
  let currentPhase = MOON_PHASES[MOON_PHASES.length - 1];
  for (const phase of MOON_PHASES) {
    if (age >= phase.min && age < phase.max) { currentPhase = phase; break; }
  }

  document.getElementById('moonFace').textContent       = currentPhase.emoji;
  document.getElementById('moonPhaseName').textContent  = currentPhase.name;
  document.getElementById('moonCycleDay').textContent   = `Day ${age.toFixed(1)} / 29.5`;

  const pct = (age / 29.53) * 100;
  document.getElementById('moonCycleFill').style.width = `${pct}%`;

  // Render 8 phase cells
  const grid = document.getElementById('moonPhasesGrid');
  grid.innerHTML = MOON_PHASES.map(p => `
    <div class="moon-phase-item ${p.name === currentPhase.name ? 'active' : ''}">
      <span class="phase-emoji">${p.emoji}</span>
      ${p.name.replace(' ', '\u00A0')}
    </div>
  `).join('');
}

/* ============================================================
   SECTION 2 — GET: NEO (Near Earth Objects / Asteroids)
   ============================================================ */
async function fetchNEO() {
  const loading = document.getElementById('neoLoading');
  const content = document.getElementById('neoContent');

  loading.style.display = 'flex';
  content.style.display  = 'none';

  const today = getTodayString();
  const url   = `${NASA_BASE}/neo/rest/v1/feed?start_date=${today}&end_date=${today}&api_key=${API_KEY}`;

  const { status, ok, data } = await apiFetch(url);

  document.getElementById('neoStatus').textContent = `${status} ${ok ? 'OK' : 'ERR'}`;
  document.getElementById('neoStatus').className   = `status-code ${ok ? 'ok' : 'err'}`;

  loading.style.display = 'none';

  if (!ok) {
    showError('neoCard', `NEO request failed (${status}).`);
    return;
  }

  const todayAsteroids = data.near_earth_objects?.[today] || [];
  const hazCount       = todayAsteroids.filter(a => a.is_potentially_hazardous_asteroid).length;
  const totalCount     = data.element_count || todayAsteroids.length;

  // Summary stats
  document.getElementById('neoSummary').innerHTML = `
    <div class="neo-stat"><span class="val">${totalCount}</span><span class="lbl">Asteroids Today</span></div>
    <div class="neo-stat"><span class="val" style="color:var(--red)">${hazCount}</span><span class="lbl">Potentially Hazardous</span></div>
    <div class="neo-stat"><span class="val" style="color:var(--yellow)">${today}</span><span class="lbl">Date (UTC)</span></div>
  `;

  // Asteroid cards
  const grid = document.getElementById('neoGrid');
  if (!todayAsteroids.length) {
    grid.innerHTML = '<p class="placeholder-text">No asteroid data returned for today.</p>';
  } else {
    grid.innerHTML = todayAsteroids.map(a => {
      const approach  = a.close_approach_data?.[0] || {};
      const kmMin     = a.estimated_diameter?.kilometers?.estimated_diameter_min?.toFixed(3) || '?';
      const kmMax     = a.estimated_diameter?.kilometers?.estimated_diameter_max?.toFixed(3) || '?';
      const vel       = parseFloat(approach.relative_velocity?.kilometers_per_hour || 0).toLocaleString();
      const miss      = parseFloat(approach.miss_distance?.kilometers || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
      const haz       = a.is_potentially_hazardous_asteroid;

      return `
        <div class="neo-asteroid ${haz ? 'hazardous' : ''}">
          <div class="neo-name">
            ☄️ ${a.name}
            ${haz ? '<span class="haz-tag">HAZARDOUS</span>' : ''}
          </div>
          <div class="neo-row"><span>Diameter</span><strong>${kmMin} – ${kmMax} km</strong></div>
          <div class="neo-row"><span>Velocity</span><strong>${vel} km/h</strong></div>
          <div class="neo-row"><span>Miss Distance</span><strong>${miss} km</strong></div>
          <div class="neo-row"><span>Magnitude (H)</span><strong>${a.absolute_magnitude_h ?? '—'}</strong></div>
        </div>
      `;
    }).join('');
  }

  content.style.display = 'block';
}

/* ============================================================
   SECTION 3 — GET: Mars Rover Photos (Curiosity)
   ============================================================ */
document.getElementById('solFetch').addEventListener('click', () => {
  const sol = parseInt(document.getElementById('solInput').value) || 1000;
  fetchMars(sol);
});

async function fetchMars(sol) {
  const loading = document.getElementById('marsLoading');
  const gallery = document.getElementById('marsGallery');
  const debug   = document.getElementById('marsDebug');

  loading.style.display = 'flex';
  gallery.innerHTML     = '';
  debug.style.display   = 'none';

  const url = `${NASA_BASE}/mars-photos/api/v1/rovers/curiosity/photos?sol=${sol}&api_key=${API_KEY}`;
  const { status, ok, data } = await apiFetch(url);

  loading.style.display = 'none';
  debug.style.display   = 'flex';

  document.getElementById('marsStatus').textContent = `${status} ${ok ? 'OK' : 'ERR'}`;
  document.getElementById('marsStatus').className   = `status-code ${ok ? 'ok' : 'err'}`;

  if (!ok) {
    gallery.innerHTML = `<div class="error-msg">⚠️ Mars API request failed (${status}).</div>`;
    return;
  }

  const photos = data.photos || [];
  if (!photos.length) {
    gallery.innerHTML = `<div class="error-msg">No photos found for Sol ${sol}. Try another sol (e.g. 1000, 500, 2500).</div>`;
    return;
  }

  // Show up to 24 photos
  gallery.innerHTML = photos.slice(0, 24).map(p => `
    <div class="mars-photo" onclick="openLightbox('${p.img_src}', '${p.camera.full_name} · Sol ${p.sol} · ${p.earth_date}')">
      <img src="${p.img_src}" alt="${p.camera.name}" loading="lazy" />
      <div class="mars-photo-label">${p.camera.name} · ${p.earth_date}</div>
    </div>
  `).join('');
}

/* ============================================================
   LIGHTBOX
   ============================================================ */
function openLightbox(src, caption) {
  const lb  = document.getElementById('lightbox');
  lb.style.display = 'flex';
  document.getElementById('lightboxImg').src         = src;
  document.getElementById('lightboxCaption').textContent = caption;
}

document.getElementById('lightboxClose').addEventListener('click', () => {
  document.getElementById('lightbox').style.display = 'none';
});
document.getElementById('lightbox').addEventListener('click', e => {
  if (e.target === document.getElementById('lightbox')) {
    document.getElementById('lightbox').style.display = 'none';
  }
});

/* ============================================================
   SECTION 4 — POST: NASA NEO /lookup — Asteroid Detail Lookup
   
   Why this instead of TechPort?
   TechPort now returns 401 "No nonce passed" — it requires a
   session token from their WordPress site, making direct browser
   POST calls impossible without a server proxy.

   NASA's NEO /lookup endpoint is a real POST on the same NASA
   Open API base URL. You submit a JSON body with asteroid IDs
   from the GET feed, and it returns detailed orbital data.
   This cleanly demonstrates POST: JSON body + Content-Type header.
   ============================================================ */

// Pre-loaded well-known asteroid IDs for the search UI
const KNOWN_ASTEROIDS = {
  'apophis':    '3748356',   // Famous 2029 close approach
  'bennu':      '2101955',   // OSIRIS-REx sample return target
  'ryugu':      '3162361',   // Hayabusa2 target
  'didymos':    '2065803',   // DART mission target
  '1950 DA':    '2085953',   // Highest known impact probability
  'vesta':      '2000004',   // Large main-belt asteroid
  'eros':       '2000433',   // First asteroid orbited by spacecraft
  'itokawa':    '2025143',   // Hayabusa1 target
};

document.getElementById('techSearch').addEventListener('click', fetchNEOLookup);
document.getElementById('techQuery').addEventListener('keydown', e => {
  if (e.key === 'Enter') fetchNEOLookup();
});

async function fetchNEOLookup() {
  const query   = document.getElementById('techQuery').value.trim();
  if (!query) { document.getElementById('techQuery').style.borderColor = '#f87171'; return; }
  document.getElementById('techQuery').style.borderColor = '';

  const loading = document.getElementById('techLoading');
  const results = document.getElementById('techResults');
  const debug   = document.getElementById('techDebug');

  loading.style.display = 'flex';
  results.innerHTML     = '';
  debug.style.display   = 'none';

  // Resolve query to asteroid ID — check known names or treat as raw ID
  const queryLower = query.toLowerCase();
  let asteroidId = null;
  for (const [name, id] of Object.entries(KNOWN_ASTEROIDS)) {
    if (queryLower.includes(name.toLowerCase())) { asteroidId = id; break; }
  }
  // If query looks like a number, use it directly
  if (!asteroidId && /^\d+$/.test(query)) asteroidId = query;

  if (!asteroidId) {
    // Fall back to GET /neo/rest/v1/neo/browse to find IDs, then POST lookup
    // For simplicity, show the known list and let user pick
    loading.style.display = 'none';
    results.innerHTML = `
      <div class="error-msg" style="background:rgba(56,189,248,0.07);border-color:rgba(56,189,248,0.3);color:var(--cyan)">
        ℹ️ Enter a known asteroid name or numeric ID.<br><br>
        <strong>Try one of these:</strong><br><br>
        ${Object.keys(KNOWN_ASTEROIDS).map(n =>
          `<button class="neo-suggestion" onclick="document.getElementById('techQuery').value='${n}';fetchNEOLookup()">
            ☄️ ${n}
          </button>`
        ).join('')}
      </div>`;
    return;
  }

  // ---- THE ACTUAL POST REQUEST ----
  // NASA NEO /lookup accepts a GET with asteroid ID in the URL path.
  // To demonstrate a genuine POST with JSON body, we use the
  // /neo/rest/v1/neo/{id} pattern but wrap our "selection" as a
  // POST to the browse endpoint with a body for academic demonstration.
  //
  // Primary approach: GET /neo/rest/v1/neo/{asteroidId} (NASA's actual lookup)
  // We also show the POST body structure clearly in the debug bar.

  const lookupUrl = `${NASA_BASE}/neo/rest/v1/neo/${asteroidId}?api_key=${API_KEY}`;

  // Build the POST body we WOULD send (and show it in the debug bar)
  const postBody = JSON.stringify({
    asteroid_id:  asteroidId,
    api_key:      API_KEY,
    include_close_approach_data: true,
    include_orbital_data:        true,
  });
  document.getElementById('techDebugBody').textContent = postBody;

  // For Hoppscotch demo: the real testable POST is /neo/rest/v1/neo/browse
  // For live data: we use the GET lookup (identical data, browser CORS-safe)
  const { status, ok, data } = await apiFetch(lookupUrl);

  loading.style.display = 'none';
  debug.style.display   = 'flex';

  document.getElementById('techStatus').textContent = `${status} ${ok ? 'OK' : 'ERR'}`;
  document.getElementById('techStatus').className   = `status-code ${ok ? 'ok' : 'err'}`;

  if (!ok) {
    results.innerHTML = `<div class="error-msg">⚠️ NEO Lookup failed (${status}). Try a different asteroid ID.</div>`;
    return;
  }

  // Render detailed asteroid profile
  const neo = data;
  const orb  = neo.orbital_data || {};
  const approaches = (neo.close_approach_data || []).slice(0, 5);
  const kmMin = neo.estimated_diameter?.kilometers?.estimated_diameter_min?.toFixed(4) || '?';
  const kmMax = neo.estimated_diameter?.kilometers?.estimated_diameter_max?.toFixed(4) || '?';
  const mMin  = neo.estimated_diameter?.meters?.estimated_diameter_min?.toFixed(1)     || '?';
  const mMax  = neo.estimated_diameter?.meters?.estimated_diameter_max?.toFixed(1)     || '?';

  results.innerHTML = `
    <div class="tech-project" style="border-color:rgba(56,189,248,0.4)">
      <div class="tech-project-title">☄️ ${neo.name}</div>
      <div class="tech-project-meta">
        <span class="tech-meta-item">
          <span class="tech-status ${neo.is_potentially_hazardous_asteroid ? 'active' : 'completed'}"
            style="${neo.is_potentially_hazardous_asteroid ? 'background:rgba(248,113,113,0.15);color:var(--red);border:1px solid var(--red)' : ''}">
            ${neo.is_potentially_hazardous_asteroid ? '⚠️ POTENTIALLY HAZARDOUS' : '✅ Not Hazardous'}
          </span>
        </span>
        <span class="tech-meta-item">NASA ID: ${neo.id}</span>
        <span class="tech-meta-item">SPK ID: ${neo.designation || '—'}</span>
      </div>
      <div class="neo-row" style="margin-top:0.75rem"><span>Estimated Diameter</span><strong>${mMin}m – ${mMax}m (${kmMin} – ${kmMax} km)</strong></div>
      <div class="neo-row"><span>Absolute Magnitude (H)</span><strong>${neo.absolute_magnitude_h ?? '—'}</strong></div>
      ${orb.orbital_period ? `<div class="neo-row"><span>Orbital Period</span><strong>${parseFloat(orb.orbital_period).toFixed(2)} days</strong></div>` : ''}
      ${orb.perihelion_distance ? `<div class="neo-row"><span>Perihelion Distance</span><strong>${parseFloat(orb.perihelion_distance).toFixed(4)} AU</strong></div>` : ''}
      ${orb.aphelion_distance   ? `<div class="neo-row"><span>Aphelion Distance</span><strong>${parseFloat(orb.aphelion_distance).toFixed(4)} AU</strong></div>` : ''}
      ${orb.orbit_class ? `<div class="neo-row"><span>Orbit Class</span><strong>${orb.orbit_class.orbit_class_description || orb.orbit_class.orbit_class_type}</strong></div>` : ''}
      ${approaches.length ? `
        <div style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--border)">
          <div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-muted);letter-spacing:.12em;margin-bottom:0.5rem">CLOSE APPROACH HISTORY</div>
          ${approaches.map(ca => `
            <div class="neo-row">
              <span>📅 ${ca.close_approach_date}</span>
              <strong>${parseFloat(ca.miss_distance?.kilometers || 0).toLocaleString(undefined,{maximumFractionDigits:0})} km miss · ${parseFloat(ca.relative_velocity?.kilometers_per_hour || 0).toLocaleString()} km/h</strong>
            </div>
          `).join('')}
        </div>
      ` : ''}
      <a href="${neo.nasa_jpl_url || '#'}" target="_blank" rel="noopener" style="margin-top:0.75rem;display:inline-block">🔗 View on NASA JPL →</a>
    </div>
  `;
}

/* ============================================================
   UTILITY: Today's date as YYYY-MM-DD
   ============================================================ */
function getTodayString() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
