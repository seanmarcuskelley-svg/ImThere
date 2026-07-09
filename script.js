// ============================================================
// ImThere — script.js
// ============================================================

const SUPABASE_URL     = 'https://jxxjzwjmvnxivfztfpjt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4eGp6d2ptdm54aXZmenRmcGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3ODAyMjYsImV4cCI6MjA5ODM1NjIyNn0.TpxhJ_E9eapNPkMK6mxjKIUn5Uo5Crvyzbat-5UnzWw';

let sb;
try {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.error('Supabase init failed:', e);
}

// ============================================================
// Sports & Venues
// ============================================================
const VENUE_META = {
  basketball:        { label: 'Basketball Court', cls: 'venue-bball'  },
  tennis_pickleball: { label: 'Tennis / Pickleball', cls: 'venue-tennis' },
  field:             { label: 'Field',            cls: 'venue-field'  },
};

const SPORTS_BY_VENUE = {
  basketball:        ['Basketball'],
  tennis_pickleball: ['Tennis', 'Pickleball'],
  field:             ['Soccer','Football','Flag Football','Rugby','Ultimate Frisbee','Quadball','Handball','Lacrosse','Kickball','Volleyball','Field Hockey','Baseball','Softball'],
};

const ALL_SPORTS = [
  'Baseball','Basketball','Cricket','Cycling','Field Hockey','Flag Football',
  'Football','Golf','Gymnastics','Handball','Hiking','Kickball','Lacrosse',
  'Martial Arts','Pickleball','Pilates','Quadball','Rock Climbing','Rugby',
  'Running','Soccer','Softball','Swimming','Tennis','Track & Field',
  'Ultimate Frisbee','Volleyball','Yoga',
];

const SPORT_COLORS = [
  '#1b4d22','#22c55e','#3b82f6','#f59e0b','#ef4444',
  '#8b5cf6','#06b6d4','#f97316','#ec4899','#10b981',
];

// ============================================================
// Global state
// ============================================================
let currentUser    = null;
let currentProfile = null;
let allLocations   = [];
let userLat        = null;
let userLon        = null;
let mapInitialized = false;
let activeFeed     = 'all';
let activeVenues   = new Set(['basketball','tennis_pickleball','field']);
let maxDistance    = 25; // miles
let sportDropdownVal = '';

// ============================================================
// Top-level navigation
// ============================================================
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    const sec = document.getElementById(btn.dataset.section);
    if (sec) sec.classList.add('active');
    if (btn.dataset.section === 'map')     initMap();
    if (btn.dataset.section === 'profile') refreshProfileView();
    if (btn.dataset.section === 'create')  populateCreateForm();
  });
});

document.getElementById('goto-create')?.addEventListener('click', () => {
  document.querySelector('[data-section="create"]')?.click();
});

// ============================================================
// Courts filter panel
// ============================================================
document.getElementById('filter-toggle')?.addEventListener('click', () => {
  document.getElementById('filter-panel')?.classList.toggle('hidden');
});

document.getElementById('distance-slider')?.addEventListener('input', e => {
  maxDistance = parseInt(e.target.value);
  document.getElementById('distance-label').textContent = maxDistance + ' mi';
});

document.getElementById('apply-filter')?.addEventListener('click', () => {
  activeVenues = new Set(
    [...document.querySelectorAll('input[name="venue"]:checked')].map(el => el.value)
  );
  document.getElementById('filter-panel')?.classList.add('hidden');
  loadCourts();
});

document.getElementById('reset-filter')?.addEventListener('click', () => {
  document.querySelectorAll('input[name="venue"]').forEach(el => el.checked = true);
  activeVenues = new Set(['basketball','tennis_pickleball','field']);
  maxDistance  = 25;
  const slider = document.getElementById('distance-slider');
  if (slider) slider.value = 25;
  document.getElementById('distance-label').textContent = '25 mi';
  document.getElementById('filter-panel')?.classList.add('hidden');
  loadCourts();
});

// ============================================================
// Auth
// ============================================================
let authMode = 'signup';

if (sb) {
  sb.auth.getSession().then(({ data: { session } }) => {
    if (session) handleAuth(session.user);
  });
  sb.auth.onAuthStateChange((_ev, session) => handleAuth(session?.user ?? null));
}

async function handleAuth(user) {
  currentUser = user;
  const btn = document.getElementById('auth-trigger');
  if (user) {
    btn.textContent = user.email.split('@')[0];
    await ensureProfile(user);
  } else {
    currentProfile = null;
    btn.textContent = 'Sign in';
  }
  refreshProfileView();
}

document.getElementById('auth-trigger')?.addEventListener('click', () => {
  if (currentUser) { sb?.auth.signOut(); return; }
  openAuthModal();
});
document.getElementById('profile-signin-btn')?.addEventListener('click', openAuthModal);

function openAuthModal()  { document.getElementById('auth-modal').classList.remove('hidden'); }
function closeAuthModal() {
  document.getElementById('auth-modal').classList.add('hidden');
  document.getElementById('auth-error').classList.add('hidden');
}
document.getElementById('modal-close')?.addEventListener('click', closeAuthModal);
document.getElementById('auth-modal')?.addEventListener('click', e => {
  if (e.target.id === 'auth-modal') closeAuthModal();
});

function setAuthMode(mode) {
  authMode = mode;
  const isSU = mode === 'signup';
  document.getElementById('auth-title').textContent    = isSU ? 'Create your account' : 'Welcome back';
  document.getElementById('auth-subtitle').textContent = isSU
    ? 'Join ImThere to post runs and follow players.'
    : 'Log in to your ImThere account.';
  document.getElementById('auth-submit').textContent   = isSU ? 'Create account' : 'Log in';
  document.getElementById('signup-fields').style.display = isSU ? 'block' : 'none';
  document.querySelector('.auth-toggle').innerHTML = isSU
    ? 'Already have an account? <a href="#" id="auth-switch">Log in</a>'
    : 'New here? <a href="#" id="auth-switch">Sign up</a>';
  document.getElementById('auth-error').classList.add('hidden');
  document.getElementById('auth-switch')?.addEventListener('click', e => {
    e.preventDefault(); setAuthMode(isSU ? 'login' : 'signup');
  });
}
// Wire initial switch link
document.getElementById('auth-switch')?.addEventListener('click', e => {
  e.preventDefault(); setAuthMode('login');
});

document.getElementById('auth-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl    = document.getElementById('auth-error');
  const submitEl = document.getElementById('auth-submit');

  submitEl.disabled = true;
  submitEl.textContent = authMode === 'signup' ? 'Creating...' : 'Logging in...';
  errEl.classList.add('hidden');

  let result;
  if (authMode === 'signup') {
    result = await sb.auth.signUp({
      email, password,
      options: { emailRedirectTo: 'https://seanmarcuskelley-svg.github.io/ImThere/' }
    });
  } else {
    result = await sb.auth.signInWithPassword({ email, password });
  }

  submitEl.disabled = false;
  submitEl.textContent = authMode === 'signup' ? 'Create account' : 'Log in';

  if (result.error) {
    errEl.textContent = result.error.message;
    errEl.classList.remove('hidden');
    return;
  }

  // On signup: save extra profile fields immediately
  if (authMode === 'signup' && result.data.user) {
    const uid      = result.data.user.id;
    const name     = document.getElementById('signup-name').value.trim();
    const uname    = document.getElementById('signup-username').value.trim().replace(/^@/,'');
    const phone    = document.getElementById('signup-phone').value.trim();
    const city     = document.getElementById('signup-city').value.trim();
    const base     = (uname || email.split('@')[0]).replace(/[^a-z0-9_]/gi,'');
    const username = base || 'player' + Math.floor(Math.random()*9000+1000);

    await sb.from('profile').upsert({
      id:           uid,
      display_name: name || username,
      username,
      phone:        phone || null,
      city:         city  || null,
    });
  }

  closeAuthModal();
  if (authMode === 'signup' && !result.data.session) {
    showBanner('Check your email to confirm your account, then log in.', false);
  }
});

// ============================================================
// Profile
// ============================================================
async function ensureProfile(user) {
  if (!sb) return;
  const { data } = await sb.from('profile').select('*').eq('id', user.id).single();
  if (data) {
    currentProfile = data;
  } else {
    const base     = user.email.split('@')[0].replace(/[^a-z0-9_]/gi,'');
    const username = base + Math.floor(Math.random()*900+100);
    const { data: created } = await sb.from('profile').insert({
      id: user.id, username, display_name: base,
    }).select().single();
    currentProfile = created;
  }
}

function refreshProfileView() {
  const gate = document.getElementById('profile-gate');
  const view = document.getElementById('profile-view');
  if (!currentUser || !currentProfile) {
    gate?.classList.remove('hidden');
    view?.classList.add('hidden');
    return;
  }
  gate?.classList.add('hidden');
  view?.classList.remove('hidden');
  renderProfileCard();
  loadProfileStats();
  loadActivityChart();
  loadNearbyPlayers();
  loadFeed(activeFeed);
  populatePostLocations();
}

function renderProfileCard() {
  if (!currentProfile) return;
  const name = currentProfile.display_name || currentProfile.username || '';
  document.getElementById('profile-display-name').textContent = name;
  document.getElementById('profile-username').textContent = '@' + (currentProfile.username || '');
  document.getElementById('profile-bio').textContent  = currentProfile.bio  || '';
  document.getElementById('profile-city').textContent = currentProfile.city ? currentProfile.city : '';
  document.getElementById('profile-avatar').textContent = (name[0] || '?').toUpperCase();
}

async function loadProfileStats() {
  if (!currentProfile || !sb) return;
  const uid = currentProfile.id;
  const [postsRes, runsRes, followersRes, followingRes] = await Promise.all([
    sb.from('post').select('id', { count:'exact', head:true }).eq('author_id', uid),
    sb.from('run').select('id',  { count:'exact', head:true }).eq('creator_id', uid),
    sb.from('follow').select('id', { count:'exact', head:true }).eq('following_id', uid),
    sb.from('follow').select('id', { count:'exact', head:true }).eq('follower_id',  uid),
  ]);
  document.getElementById('stat-posts').textContent     = postsRes.count    ?? 0;
  document.getElementById('stat-runs').textContent      = runsRes.count     ?? 0;
  document.getElementById('stat-followers').textContent = followersRes.count ?? 0;
  document.getElementById('stat-following').textContent = followingRes.count ?? 0;
}

// Activity pie chart
async function loadActivityChart() {
  if (!currentProfile || !sb) return;
  const { data } = await sb.from('run')
    .select('sport').eq('creator_id', currentProfile.id);

  const card   = document.getElementById('activity-card');
  const empty  = document.getElementById('activity-empty');
  const canvas = document.getElementById('activity-chart');
  const legend = document.getElementById('activity-legend');

  if (!data || data.length === 0) {
    canvas.style.display = 'none';
    legend.style.display = 'none';
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  canvas.style.display = '';
  legend.style.display = '';

  // Tally by sport
  const counts = {};
  data.forEach(r => { counts[r.sport] = (counts[r.sport] || 0) + 1; });
  const total   = data.length;
  const entries = Object.entries(counts).sort((a,b) => b[1] - a[1]);

  // Draw pie on canvas
  const ctx  = canvas.getContext('2d');
  const cx   = 70, cy = 70, r = 60;
  let angle  = -Math.PI / 2;
  ctx.clearRect(0, 0, 140, 140);

  entries.forEach(([sport, count], i) => {
    const slice = (count / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = SPORT_COLORS[i % SPORT_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    angle += slice;
  });

  // Legend
  legend.innerHTML = entries.map(([sport, count], i) => `
    <div class="legend-row">
      <span class="legend-dot" style="background:${SPORT_COLORS[i % SPORT_COLORS.length]}"></span>
      <span class="legend-label">${escHtml(sport)}</span>
      <span class="legend-pct">${Math.round((count/total)*100)}%</span>
    </div>`).join('');
}

// Nearby players
async function loadNearbyPlayers() {
  if (!currentProfile?.city || !sb) return;
  const card = document.getElementById('nearby-players-card');
  const list = document.getElementById('nearby-players-list');
  if (!card || !list) return;

  const { data } = await sb.from('profile')
    .select('id, username, display_name, city')
    .ilike('city', `%${currentProfile.city.split(',')[0].trim()}%`)
    .neq('id', currentProfile.id)
    .limit(8);

  if (!data || !data.length) return;
  card.classList.remove('hidden');
  list.innerHTML = data.map(p => `
    <div class="player-row">
      <div class="post-avatar small">${(p.display_name||p.username||'?')[0].toUpperCase()}</div>
      <div><strong>${escHtml(p.display_name||p.username)}</strong><br><small>@${escHtml(p.username)} · ${escHtml(p.city||'')}</small></div>
      <button class="follow-btn" data-uid="${p.id}">Follow</button>
    </div>`).join('');

  list.querySelectorAll('.follow-btn').forEach(btn =>
    btn.addEventListener('click', () => followUser(btn.dataset.uid, btn))
  );
}

// Edit profile
document.getElementById('edit-profile-btn')?.addEventListener('click', () => {
  if (!currentProfile) return;
  document.getElementById('edit-display-name').value = currentProfile.display_name || '';
  document.getElementById('edit-username').value     = currentProfile.username || '';
  document.getElementById('edit-phone').value        = currentProfile.phone || '';
  document.getElementById('edit-city').value         = currentProfile.city  || '';
  document.getElementById('edit-bio').value          = currentProfile.bio   || '';
  document.getElementById('edit-profile-form').classList.toggle('hidden');
});
document.getElementById('cancel-edit-btn')?.addEventListener('click', () => {
  document.getElementById('edit-profile-form').classList.add('hidden');
});
document.getElementById('save-profile-btn')?.addEventListener('click', async () => {
  const msgEl    = document.getElementById('edit-profile-msg');
  const display  = document.getElementById('edit-display-name').value.trim();
  const username = document.getElementById('edit-username').value.trim().replace(/^@/,'');
  const phone    = document.getElementById('edit-phone').value.trim();
  const city     = document.getElementById('edit-city').value.trim();
  const bio      = document.getElementById('edit-bio').value.trim();
  if (!username) { showMsg(msgEl, 'Username required.', true); return; }

  const { error } = await sb.from('profile')
    .update({ display_name: display, username, phone: phone||null, city: city||null, bio: bio||null })
    .eq('id', currentProfile.id);

  if (error) { showMsg(msgEl, error.message, true); }
  else {
    currentProfile = { ...currentProfile, display_name:display, username, phone, city, bio };
    renderProfileCard();
    loadNearbyPlayers();
    document.getElementById('edit-profile-form').classList.add('hidden');
  }
});

// ============================================================
// Posts
// ============================================================
async function populatePostLocations() {
  const sel = document.getElementById('post-location');
  if (!sel || sel.options.length > 1) return;
  if (!allLocations.length) await fetchLocations();
  allLocations.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc.id;
    opt.textContent = loc.name;
    sel.appendChild(opt);
  });
}

document.getElementById('post-submit-btn')?.addEventListener('click', async () => {
  const msgEl   = document.getElementById('post-msg');
  const content = document.getElementById('post-content').value.trim();
  const locId   = document.getElementById('post-location').value || null;
  if (!content) { showMsg(msgEl, 'Write something first.', true); return; }
  if (!currentProfile) { openAuthModal(); return; }

  const { error } = await sb.from('post').insert({
    author_id: currentProfile.id, content, location_id: locId||null,
  });
  if (error) { showMsg(msgEl, error.message, true); }
  else {
    document.getElementById('post-content').value  = '';
    document.getElementById('post-location').value = '';
    showMsg(msgEl, 'Posted', false);
    loadFeed(activeFeed);
    loadProfileStats();
  }
});

document.querySelectorAll('.feed-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.feed-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFeed = btn.dataset.feed;
    loadFeed(activeFeed);
  });
});

async function loadFeed(mode) {
  const feedEl = document.getElementById('post-feed');
  if (!feedEl || !sb) return;
  feedEl.innerHTML = '<p class="loading-msg">Loading...</p>';

  let query = sb.from('post')
    .select('id, content, created_at, location_id, author_id, profile(username,display_name), location(name)')
    .order('created_at', { ascending: false }).limit(40);

  if (mode === 'mine' && currentProfile) {
    query = query.eq('author_id', currentProfile.id);
  } else if (mode === 'following' && currentProfile) {
    const { data: f } = await sb.from('follow').select('following_id').eq('follower_id', currentProfile.id);
    const ids = (f||[]).map(x => x.following_id);
    if (!ids.length) { feedEl.innerHTML = '<p class="empty-state">Follow some players to see their posts.</p>'; return; }
    query = query.in('author_id', ids);
  }

  const { data, error } = await query;
  if (error) { feedEl.innerHTML = `<p class="empty-state" style="color:#ef4444">${error.message}</p>`; return; }
  if (!data?.length) { feedEl.innerHTML = '<p class="empty-state">No posts yet.</p>'; return; }

  feedEl.innerHTML = '';
  data.forEach(post => {
    const prof    = post.profile || {};
    const author  = prof.display_name || prof.username || 'Player';
    const isMine  = currentProfile && post.author_id === currentProfile.id;
    const locTag  = post.location ? `<span class="post-location-tag">${escHtml(post.location.name)}</span>` : '';
    const card    = document.createElement('div');
    card.className = 'post-card';
    card.innerHTML = `
      <div class="post-header">
        <div class="post-avatar">${(author[0]||'?').toUpperCase()}</div>
        <div class="post-meta"><strong>${escHtml(author)}</strong><span class="post-when">${timeAgo(new Date(post.created_at))}</span></div>
        ${!isMine ? `<button class="follow-btn" data-uid="${post.author_id}">Follow</button>` : ''}
      </div>
      <p class="post-text">${escHtml(post.content)}</p>${locTag}`;
    feedEl.appendChild(card);
  });
  feedEl.querySelectorAll('.follow-btn').forEach(btn =>
    btn.addEventListener('click', () => followUser(btn.dataset.uid, btn))
  );
}

async function followUser(targetId, btnEl) {
  if (!currentProfile) { openAuthModal(); return; }
  if (targetId === currentProfile.id) return;
  btnEl.disabled = true;
  const { error } = await sb.from('follow').insert({ follower_id: currentProfile.id, following_id: targetId });
  if (error?.code === '23505') {
    await sb.from('follow').delete().eq('follower_id', currentProfile.id).eq('following_id', targetId);
    btnEl.textContent = 'Follow';
  } else if (error) {
    showBanner(error.message, true);
  } else {
    btnEl.textContent = 'Following';
    loadProfileStats();
  }
  btnEl.disabled = false;
}

document.getElementById('player-search-btn')?.addEventListener('click', searchPlayers);
document.getElementById('player-search')?.addEventListener('keydown', e => { if (e.key==='Enter') searchPlayers(); });

async function searchPlayers() {
  const q = document.getElementById('player-search')?.value.trim();
  const el = document.getElementById('player-results');
  if (!q || !el || !sb) return;
  const { data } = await sb.from('profile').select('id, username, display_name, city').ilike('username', `%${q}%`).limit(10);
  if (!data?.length) { el.innerHTML = '<p class="empty-state">No players found.</p>'; return; }
  el.innerHTML = data.filter(p => !currentProfile || p.id !== currentProfile.id).map(p => `
    <div class="player-row">
      <div class="post-avatar small">${(p.display_name||p.username||'?')[0].toUpperCase()}</div>
      <div><strong>${escHtml(p.display_name||p.username)}</strong><br><small>@${escHtml(p.username)}${p.city ? ' · '+escHtml(p.city) : ''}</small></div>
      <button class="follow-btn" data-uid="${p.id}">Follow</button>
    </div>`).join('');
  el.querySelectorAll('.follow-btn').forEach(btn =>
    btn.addEventListener('click', () => followUser(btn.dataset.uid, btn))
  );
}

// ============================================================
// Courts
// ============================================================
async function fetchLocations() {
  if (!sb) return;
  const { data, error } = await sb
    .from('location')
    .select('id, name, city, zip, lat, lon, location_asset(sport)')
    .order('name').limit(145);

  if (error) {
    document.getElementById('courts-list').innerHTML =
      `<p class="empty-state" style="color:#ef4444">Could not load courts: ${error.message}</p>`;
    return;
  }
  allLocations = (data||[]).map(loc => ({
    ...loc, sports: (loc.location_asset||[]).map(a => a.sport),
  }));
}

async function loadCourts() {
  if (!allLocations.length) await fetchLocations();

  let sorted = [...allLocations];

  // Sort by distance if we have location
  if (userLat !== null) {
    sorted.sort((a,b) => haversine(userLat,userLon,a.lat,a.lon) - haversine(userLat,userLon,b.lat,b.lon));
    // Apply max distance filter
    sorted = sorted.filter(loc => haversine(userLat,userLon,loc.lat,loc.lon) <= maxDistance);
  }

  // Filter by selected venue types
  sorted = sorted.filter(loc => loc.sports.some(s => activeVenues.has(s)));

  renderCourts(sorted);
}

function renderCourts(locs) {
  const list = document.getElementById('courts-list');
  if (!list) return;
  if (!locs.length) {
    list.innerHTML = '<p class="empty-state">No courts match your filters.</p>';
    return;
  }
  list.innerHTML = '';
  locs.forEach(loc => {
    const dist = userLat !== null
      ? `<span class="court-distance">${haversine(userLat,userLon,loc.lat,loc.lon).toFixed(1)} mi</span>`
      : '';
    const tags = loc.sports.map(s => {
      const m = VENUE_META[s] || { label: s, cls: '' };
      return `<span class="venue-tag ${m.cls}">${m.label}</span>`;
    }).join('');

    const card = document.createElement('div');
    card.className = 'court-card';
    card.innerHTML = `
      <div class="court-card-top">
        <div>
          <h4>${escHtml(loc.name)}</h4>
          <p class="court-city">${loc.city||'Montgomery County'}, MD ${loc.zip||''}</p>
        </div>
        ${dist}
      </div>
      <div class="sport-tags-row">${tags}</div>
      <button class="run-here-btn" data-loc-id="${loc.id}">+ Run here</button>`;
    card.querySelector('.run-here-btn').addEventListener('click', () => jumpToCreateRun(loc.id));
    list.appendChild(card);
  });
}

function jumpToCreateRun(locId) {
  document.querySelector('[data-section="create"]')?.click();
  setTimeout(() => {
    const sel = document.getElementById('run-location');
    if (sel) { sel.value = locId; updateSportHint(); }
  }, 50);
}

// Geolocation
function detectLocation() {
  const statusEl = document.getElementById('location-status');
  // Show distance filter only if geolocation available
  if (!navigator.geolocation) {
    if (statusEl) statusEl.textContent = 'All courts in Montgomery County, MD';
    document.getElementById('distance-filter-section')?.style && (document.getElementById('distance-filter-section').style.display = 'none');
    loadCourts(); return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude;
      userLon = pos.coords.longitude;
      if (statusEl) statusEl.textContent = 'Sorted by distance from you';
      loadCourts();
    },
    () => {
      if (statusEl) statusEl.textContent = 'All courts in Montgomery County, MD';
      document.getElementById('distance-filter-section')?.style && (document.getElementById('distance-filter-section').style.display = 'none');
      loadCourts();
    },
    { timeout: 8000 }
  );
}

// ============================================================
// Sport search dropdown (Create Run)
// ============================================================
function buildSportDropdown(filter = '') {
  const dd = document.getElementById('sport-dropdown');
  if (!dd) return;

  const lower    = filter.toLowerCase();
  const filtered = filter ? ALL_SPORTS.filter(s => s.toLowerCase().includes(lower)) : ALL_SPORTS;

  if (!filtered.length) { dd.classList.add('hidden'); return; }

  dd.innerHTML = filtered.map(s =>
    `<div class="sport-option" data-val="${escHtml(s)}">${escHtml(s)}</div>`
  ).join('');
  dd.classList.remove('hidden');

  dd.querySelectorAll('.sport-option').forEach(opt => {
    opt.addEventListener('mousedown', e => {
      e.preventDefault();
      selectSport(opt.dataset.val);
    });
  });
}

function selectSport(val) {
  sportDropdownVal = val;
  const input = document.getElementById('run-sport-input');
  if (input) input.value = val;
  document.getElementById('sport-dropdown')?.classList.add('hidden');
}

document.getElementById('run-sport-input')?.addEventListener('input', e => {
  buildSportDropdown(e.target.value);
});
document.getElementById('run-sport-input')?.addEventListener('focus', e => {
  buildSportDropdown(e.target.value);
});
document.getElementById('run-sport-input')?.addEventListener('blur', () => {
  setTimeout(() => document.getElementById('sport-dropdown')?.classList.add('hidden'), 150);
});

function updateSportHint() {
  const sel   = document.getElementById('run-location');
  const hint  = document.getElementById('sport-hint');
  if (!sel || !hint) return;
  const loc   = allLocations.find(l => l.id === sel.value);
  if (!loc) { hint.classList.add('hidden'); return; }
  const sports = [...new Set(loc.sports.flatMap(v => SPORTS_BY_VENUE[v] || []))];
  if (sports.length) {
    hint.textContent = 'Common at this venue: ' + sports.join(', ');
    hint.classList.remove('hidden');
  }
}

// ============================================================
// Create Run form
// ============================================================
async function populateCreateForm() {
  if (!allLocations.length) await fetchLocations();
  const sel = document.getElementById('run-location');
  if (!sel) return;

  if (sel.options.length <= 1) {
    const sorted = userLat !== null
      ? [...allLocations].sort((a,b) => haversine(userLat,userLon,a.lat,a.lon) - haversine(userLat,userLon,b.lat,b.lon))
      : allLocations;
    sorted.forEach(loc => {
      const opt = document.createElement('option');
      opt.value = loc.id;
      const dist = userLat !== null ? ` (${haversine(userLat,userLon,loc.lat,loc.lon).toFixed(1)} mi)` : '';
      opt.textContent = loc.name + (loc.city ? ` — ${loc.city}` : '') + dist;
      sel.appendChild(opt);
    });
  }

  const dateEl = document.getElementById('run-date');
  if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];

  sel.addEventListener('change', updateSportHint);
}

document.getElementById('create-run-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const msgEl  = document.getElementById('create-run-msg');
  const submit = document.getElementById('create-run-submit');

  const locId   = document.getElementById('run-location').value;
  const sport   = document.getElementById('run-sport-input').value.trim();
  const date    = document.getElementById('run-date').value;
  const time    = document.getElementById('run-time').value;
  const going   = parseInt(document.getElementById('run-going').value) || 1;
  const needed  = document.getElementById('run-needed').value ? parseInt(document.getElementById('run-needed').value) : null;
  const privacy = document.querySelector('input[name="privacy"]:checked')?.value || 'public';
  const notes   = document.getElementById('run-notes').value.trim() || null;
  const notify  = document.getElementById('run-notify')?.checked;

  if (!locId)        { showMsg(msgEl, 'Select a location.', true); return; }
  if (!sport)        { showMsg(msgEl, 'Enter a sport or activity.', true); return; }
  if (!date || !time){ showMsg(msgEl, 'Add date and time.', true); return; }

  // Request notification permission if checked
  if (notify && 'Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }

  submit.disabled = true;
  submit.textContent = 'Posting...';

  const scheduled_at = new Date(`${date}T${time}`).toISOString();

  const { error } = await sb.from('run').insert({
    location_id:  locId,
    sport,
    scheduled_at,
    going_count:  going,
    needed_count: needed,
    privacy,
    notes,
    creator_id:   currentProfile?.id || null,
  });

  submit.disabled = false;
  submit.textContent = 'Post Run';

  if (error) {
    showMsg(msgEl, error.message, true);
  } else {
    showMsg(msgEl, 'Run posted! It will appear on the map.', false);

    // Browser notification
    if (notify && Notification.permission === 'granted') {
      const locName = document.getElementById('run-location').selectedOptions[0]?.text || 'your court';
      new Notification('ImThere — Run posted!', {
        body: `${sport} at ${locName.split(' —')[0]} is live. People can find it on the map.`,
        icon: '/ImThere/favicon.ico',
      });
    }

    e.target.reset();
    document.getElementById('run-going').value = 1;
    document.querySelector('input[name="privacy"][value="public"]').checked = true;
    document.getElementById('sport-hint')?.classList.add('hidden');
    sportDropdownVal = '';
  }
});

// ============================================================
// Map
// ============================================================
async function initMap() {
  if (mapInitialized) return;
  mapInitialized = true;

  const mapEl = document.getElementById('leaflet-map');
  if (!mapEl) return;

  const map = L.map(mapEl).setView([39.15, -77.2], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors', maxZoom: 19,
  }).addTo(map);

  if (!allLocations.length) await fetchLocations();
  if (!allLocations.length) return;

  let countMap = {};
  if (sb) {
    const { data: runs } = await sb.from('run').select('location_id').gte('scheduled_at', new Date().toISOString());
    (runs||[]).forEach(r => { countMap[r.location_id] = (countMap[r.location_id]||0) + 1; });
  }

  allLocations.forEach(loc => {
    if (!loc.lat || !loc.lon) return;
    const runs   = countMap[loc.id] || 0;
    const color  = runs > 0 ? '#22c55e' : '#1b4d22';
    const radius = runs > 0 ? 10 : 7;

    const marker = L.circleMarker([loc.lat, loc.lon], {
      radius, fillColor: color, color:'#fff', weight:2, fillOpacity:0.9,
    }).addTo(map);

    const venueLabels = (loc.sports||[]).map(s => VENUE_META[s]?.label||s).join(', ') || 'Court';
    const runLine     = runs > 0
      ? `<p style="color:#16a34a;font-weight:700;margin:4px 0">${runs} upcoming run${runs>1?'s':''}</p>`
      : `<p style="color:#aaa;font-size:0.8rem;margin:4px 0">No runs posted yet</p>`;

    marker.bindPopup(`
      <div style="font-size:0.85rem;line-height:1.6;min-width:190px">
        <strong style="font-size:0.95rem">${escHtml(loc.name)}</strong><br>
        <span style="color:#666">${loc.city||'Montgomery County'}, MD</span><br>
        <span style="color:#1b4d22;font-size:0.8rem">${venueLabels}</span>
        ${runLine}
        <button onclick="window.__jumpCreate('${loc.id}')"
          style="display:block;width:100%;margin-top:6px;background:#1b4d22;color:#fff;border:none;border-radius:6px;padding:6px;font-size:0.82rem;font-weight:700;cursor:pointer">
          + Create Run Here
        </button>
      </div>`, { maxWidth: 240 });
  });

  window.__jumpCreate = locId => {
    document.querySelector('[data-section="create"]')?.click();
    setTimeout(() => {
      const sel = document.getElementById('run-location');
      if (sel) { sel.value = locId; updateSportHint(); }
    }, 100);
  };

  if (userLat !== null) {
    L.circleMarker([userLat, userLon], {
      radius:8, fillColor:'#3b82f6', color:'#fff', weight:2, fillOpacity:1,
    }).addTo(map).bindPopup('You are here');
    map.setView([userLat, userLon], 13);
  }
}

// ============================================================
// App mockup
// ============================================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab)?.classList.add('active');
  });
});

document.querySelectorAll('.join-btn').forEach(btn => {
  if (btn.disabled) return;
  btn.addEventListener('click', () => {
    if (btn.classList.contains('joined')) return;
    btn.textContent = 'Joined';
    btn.classList.add('joined');
    const card = btn.closest('.run-card');
    const name = card?.dataset.run, meta = card?.dataset.meta;
    if (name) {
      document.getElementById('myruns-empty')?.classList.add('hidden');
      const el = document.createElement('div');
      el.className = 'run-card';
      el.innerHTML = `<div class="run-info"><h3>${name}</h3><p class="run-meta">${meta}</p></div>`;
      document.getElementById('myruns-list')?.appendChild(el);
    }
  });
});

const chatData = {
  pickup5v5chat: { title:'Pickup 5v5', messages:[{from:'DL',text:"who's in for 6:30?"},{from:'JN',text:"I'm coming"}] },
  morning3schat: { title:'Morning 3s', messages:[{from:'SW',text:'anyone else coming?'}] },
  dmjordan:      { title:'Jordan',     messages:[{from:'Jordan',text:'you up for tonight?'}] },
};
const chatThread   = document.getElementById('chat-thread');
const chatMessages = document.getElementById('chat-messages');
let activeChatId   = null;

function renderChat(msgs) {
  if (!chatMessages) return;
  chatMessages.innerHTML = msgs.map(m =>
    `<div class="chat-bubble${m.from==='You'?' me':''}">${m.from}: ${m.text}</div>`
  ).join('');
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

document.querySelectorAll('.chat-row').forEach(row => {
  row.addEventListener('click', () => {
    const chat = chatData[row.dataset.chat];
    if (!chat || !chatThread) return;
    activeChatId = row.dataset.chat;
    document.getElementById('chat-thread-title').textContent = chat.title;
    renderChat(chat.messages);
    chatThread.classList.remove('hidden');
  });
});
document.getElementById('chat-back')?.addEventListener('click', () => chatThread?.classList.add('hidden'));
document.getElementById('chat-form')?.addEventListener('submit', e => {
  e.preventDefault();
  const inp  = document.getElementById('chat-input');
  const text = inp?.value.trim();
  if (!text || !activeChatId) return;
  chatData[activeChatId].messages.push({ from:'You', text });
  renderChat(chatData[activeChatId].messages);
  if (inp) inp.value = '';
});

document.getElementById('waitlist-btn')?.addEventListener('click', () => {
  const email = document.getElementById('waitlist-email')?.value.trim();
  if (!email) return;
  document.getElementById('waitlist-msg')?.classList.remove('hidden');
  const el = document.getElementById('waitlist-email');
  if (el) el.value = '';
});

// ============================================================
// Utils
// ============================================================
function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function showMsg(el, text, isError) {
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? '#ef4444' : '#16a34a';
  el.classList.remove('hidden');
  if (!isError) setTimeout(() => el.classList.add('hidden'), 5000);
}

function showBanner(msg, isError) {
  let b = document.getElementById('global-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'global-banner';
    b.style.cssText = 'position:fixed;top:52px;left:0;right:0;z-index:300;padding:10px 16px;font-size:0.85rem;font-weight:600;text-align:center;';
    document.body.appendChild(b);
  }
  b.textContent = msg;
  b.style.background = isError ? '#ef4444' : '#22c55e';
  b.style.color = '#fff';
  b.style.display = 'block';
  if (!isError) setTimeout(() => b.style.display='none', 4000);
}

function timeAgo(date) {
  const s = Math.floor((new Date()-date)/1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}

function escHtml(str) {
  return (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// Boot
// ============================================================
detectLocation();
populateCreateForm();
