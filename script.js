// ============================================================
// ImThere — script.js
// ============================================================

const SUPABASE_URL = 'https://jxxjzwjmvnxivfztfpjt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4eGp6d2ptdm54aXZmenRmcGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3ODAyMjYsImV4cCI6MjA5ODM1NjIyNn0.TpxhJ_E9eapNPkMK6mxjKIUn5Uo5Crvyzbat-5UnzWw';
const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// Global state
// ============================================================
let currentUser   = null;
let currentProfile = null;
let allLocations  = [];     // [{id, name, city, zip, lat, lon, sports:[]}]
let userLat       = null;
let userLon       = null;
let activeSport   = 'all';
let activeFeed    = 'all';
let leafletMap    = null;
let mapInitialized = false;

const SPORT_META = {
  basketball:        { emoji: '🏀', label: 'Basketball',        cls: 'basketball' },
  tennis_pickleball: { emoji: '🎾', label: 'Tennis/Pickleball', cls: 'tennis'     },
  field:             { emoji: '⚽', label: 'Field',             cls: 'soccer'     },
};

// ============================================================
// Tab navigation (top-level sections)
// ============================================================
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    const sec = document.getElementById(btn.dataset.section);
    if (sec) sec.classList.add('active');
    if (btn.dataset.section === 'map') initMap();
    if (btn.dataset.section === 'profile') refreshProfileView();
    if (btn.dataset.section === 'create') populateCreateForm();
  });
});

// "Create a Run" banner on Courts tab → jump to Create tab
document.getElementById('goto-create').addEventListener('click', () => {
  document.querySelector('[data-section="create"]').click();
});

// ============================================================
// Auth
// ============================================================
let authMode = 'signup';

sb.auth.getSession().then(({ data: { session } }) => {
  if (session) handleAuth(session.user);
});

sb.auth.onAuthStateChange((_event, session) => {
  handleAuth(session ? session.user : null);
});

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

// Header sign-in button
document.getElementById('auth-trigger').addEventListener('click', () => {
  if (currentUser) { sb.auth.signOut(); return; }
  openAuthModal();
});

// Profile section sign-in button
document.getElementById('profile-signin-btn').addEventListener('click', openAuthModal);

function openAuthModal() {
  document.getElementById('auth-modal').classList.remove('hidden');
}
function closeAuthModal() {
  document.getElementById('auth-modal').classList.add('hidden');
  document.getElementById('auth-error').classList.add('hidden');
}

document.getElementById('modal-close').addEventListener('click', closeAuthModal);
document.getElementById('auth-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('auth-modal')) closeAuthModal();
});

function bindAuthSwitch() {
  const el = document.getElementById('auth-switch');
  if (!el) return;
  el.addEventListener('click', e => {
    e.preventDefault();
    authMode = authMode === 'signup' ? 'login' : 'signup';
    const isSignup = authMode === 'signup';
    document.getElementById('auth-title').textContent   = isSignup ? 'Sign in to ImThere' : 'Welcome back';
    document.getElementById('auth-subtitle').textContent = isSignup
      ? 'Create an account or log in.'
      : 'Log in to your ImThere account.';
    document.getElementById('auth-submit').textContent  = isSignup ? 'Sign up' : 'Log in';
    document.querySelector('.auth-toggle').innerHTML    = isSignup
      ? 'Already have an account? <a href="#" id="auth-switch">Log in</a>'
      : 'New here? <a href="#" id="auth-switch">Sign up</a>';
    document.getElementById('auth-error').classList.add('hidden');
    bindAuthSwitch();
  });
}
bindAuthSwitch();

document.getElementById('auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl    = document.getElementById('auth-error');
  const submitEl = document.getElementById('auth-submit');

  submitEl.disabled    = true;
  submitEl.textContent = authMode === 'signup' ? 'Signing up…' : 'Logging in…';
  errEl.classList.add('hidden');

  const result = authMode === 'signup'
    ? await sb.auth.signUp({ email, password })
    : await sb.auth.signInWithPassword({ email, password });

  if (result.error) {
    errEl.textContent = result.error.message;
    errEl.classList.remove('hidden');
    submitEl.disabled    = false;
    submitEl.textContent = authMode === 'signup' ? 'Sign up' : 'Log in';
  } else {
    closeAuthModal();
    if (authMode === 'signup' && !result.data.session) {
      alert('📬 Check your email to confirm your account!');
    }
  }
});

// ============================================================
// Profile — ensure row exists after sign up
// ============================================================
async function ensureProfile(user) {
  const { data } = await sb.from('profile').select('*').eq('id', user.id).single();
  if (data) {
    currentProfile = data;
  } else {
    const username = user.email.split('@')[0].replace(/[^a-z0-9_]/gi, '') + Math.floor(Math.random() * 100);
    const { data: created } = await sb.from('profile').insert({
      id: user.id,
      username,
      display_name: user.email.split('@')[0],
    }).select().single();
    currentProfile = created;
  }
}

// ============================================================
// Profile section rendering
// ============================================================
function refreshProfileView() {
  const gate = document.getElementById('profile-gate');
  const view = document.getElementById('profile-view');
  if (!currentUser) {
    gate.classList.remove('hidden');
    view.classList.add('hidden');
    return;
  }
  gate.classList.add('hidden');
  view.classList.remove('hidden');
  renderProfileCard();
  loadProfileStats();
  loadFeed(activeFeed);
  populatePostLocations();
}

function renderProfileCard() {
  if (!currentProfile) return;
  const name = currentProfile.display_name || currentProfile.username || '';
  document.getElementById('profile-display-name').textContent = name;
  document.getElementById('profile-username').textContent = '@' + (currentProfile.username || '');
  document.getElementById('profile-bio').textContent = currentProfile.bio || '';
  document.getElementById('profile-avatar').textContent = (name[0] || '?').toUpperCase();
}

async function loadProfileStats() {
  if (!currentProfile) return;
  const uid = currentProfile.id;
  const [postsRes, followersRes, followingRes] = await Promise.all([
    sb.from('post').select('id', { count: 'exact', head: true }).eq('author_id', uid),
    sb.from('follow').select('id', { count: 'exact', head: true }).eq('following_id', uid),
    sb.from('follow').select('id', { count: 'exact', head: true }).eq('follower_id', uid),
  ]);
  document.getElementById('stat-posts').textContent     = postsRes.count ?? 0;
  document.getElementById('stat-followers').textContent = followersRes.count ?? 0;
  document.getElementById('stat-following').textContent = followingRes.count ?? 0;
}

// Edit profile
document.getElementById('edit-profile-btn').addEventListener('click', () => {
  if (!currentProfile) return;
  document.getElementById('edit-display-name').value = currentProfile.display_name || '';
  document.getElementById('edit-username').value     = currentProfile.username || '';
  document.getElementById('edit-bio').value          = currentProfile.bio || '';
  document.getElementById('edit-profile-form').classList.toggle('hidden');
});

document.getElementById('cancel-edit-btn').addEventListener('click', () => {
  document.getElementById('edit-profile-form').classList.add('hidden');
});

document.getElementById('save-profile-btn').addEventListener('click', async () => {
  const msgEl   = document.getElementById('edit-profile-msg');
  const display = document.getElementById('edit-display-name').value.trim();
  const username = document.getElementById('edit-username').value.trim().replace(/^@/, '');
  const bio     = document.getElementById('edit-bio').value.trim();

  if (!username) { showMsg(msgEl, 'Username required.', true); return; }

  const { error } = await sb.from('profile').update({ display_name: display, username, bio })
    .eq('id', currentProfile.id);

  if (error) {
    showMsg(msgEl, error.message, true);
  } else {
    currentProfile = { ...currentProfile, display_name: display, username, bio };
    renderProfileCard();
    document.getElementById('edit-profile-form').classList.add('hidden');
  }
});

// ============================================================
// Posts
// ============================================================
async function populatePostLocations() {
  const sel = document.getElementById('post-location');
  if (sel.options.length > 1) return;
  if (!allLocations.length) await fetchLocations();
  allLocations.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc.id;
    opt.textContent = loc.name;
    sel.appendChild(opt);
  });
}

document.getElementById('post-submit-btn').addEventListener('click', async () => {
  const msgEl   = document.getElementById('post-msg');
  const content = document.getElementById('post-content').value.trim();
  const locId   = document.getElementById('post-location').value || null;
  if (!content) { showMsg(msgEl, 'Write something first.', true); return; }
  if (!currentProfile) { showMsg(msgEl, 'Sign in to post.', true); return; }

  const { error } = await sb.from('post').insert({
    author_id:   currentProfile.id,
    content,
    location_id: locId || null,
  });

  if (error) {
    showMsg(msgEl, error.message, true);
  } else {
    document.getElementById('post-content').value = '';
    document.getElementById('post-location').value = '';
    showMsg(msgEl, 'Posted ✓', false);
    loadFeed(activeFeed);
    loadProfileStats();
  }
});

// Feed tabs
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
  feedEl.innerHTML = '<p class="loading-msg">Loading…</p>';

  let query = sb.from('post')
    .select('id, content, created_at, location_id, author_id, profile(username, display_name), location(name)')
    .order('created_at', { ascending: false })
    .limit(40);

  if (mode === 'mine' && currentProfile) {
    query = query.eq('author_id', currentProfile.id);
  } else if (mode === 'following' && currentProfile) {
    // Get IDs being followed
    const { data: follows } = await sb.from('follow')
      .select('following_id').eq('follower_id', currentProfile.id);
    const ids = (follows || []).map(f => f.following_id);
    if (!ids.length) {
      feedEl.innerHTML = '<p class="empty-state">Follow some players to see their posts here.</p>';
      return;
    }
    query = query.in('author_id', ids);
  }

  const { data, error } = await query;

  if (error || !data || !data.length) {
    feedEl.innerHTML = '<p class="empty-state">No posts yet.</p>';
    return;
  }

  feedEl.innerHTML = '';
  data.forEach(post => {
    const prof     = post.profile || {};
    const author   = prof.display_name || prof.username || 'Unknown';
    const initials = (author[0] || '?').toUpperCase();
    const locTag   = post.location ? `<span class="post-location-tag">📍 ${post.location.name}</span>` : '';
    const when     = timeAgo(new Date(post.created_at));
    const isMine   = currentProfile && post.author_id === currentProfile.id;

    const card = document.createElement('div');
    card.className = 'post-card';
    card.innerHTML = `
      <div class="post-header">
        <div class="post-avatar">${initials}</div>
        <div class="post-meta">
          <strong>${author}</strong>
          <span class="post-when">${when}</span>
        </div>
        ${!isMine ? `<button class="follow-btn" data-uid="${post.author_id}" data-uname="${prof.username || author}">Follow</button>` : ''}
      </div>
      <p class="post-text">${escHtml(post.content)}</p>
      ${locTag}
    `;
    feedEl.appendChild(card);
  });

  // Wire follow buttons
  feedEl.querySelectorAll('.follow-btn').forEach(btn => {
    btn.addEventListener('click', () => followUser(btn.dataset.uid, btn));
  });
}

async function followUser(targetId, btnEl) {
  if (!currentProfile) { openAuthModal(); return; }
  if (targetId === currentProfile.id) return;

  btnEl.disabled = true;
  const { error } = await sb.from('follow').insert({
    follower_id:  currentProfile.id,
    following_id: targetId,
  });

  if (error && error.code === '23505') {
    // Already following — unfollow
    await sb.from('follow').delete()
      .eq('follower_id', currentProfile.id).eq('following_id', targetId);
    btnEl.textContent = 'Follow';
  } else if (error) {
    alert(error.message);
  } else {
    btnEl.textContent = 'Following ✓';
    loadProfileStats();
  }
  btnEl.disabled = false;
}

// Player search
document.getElementById('player-search-btn').addEventListener('click', searchPlayers);
document.getElementById('player-search').addEventListener('keydown', e => {
  if (e.key === 'Enter') searchPlayers();
});

async function searchPlayers() {
  const q = document.getElementById('player-search').value.trim();
  const resultsEl = document.getElementById('player-results');
  if (!q) return;

  const { data, error } = await sb.from('profile')
    .select('id, username, display_name')
    .ilike('username', `%${q}%`)
    .limit(10);

  if (error || !data || !data.length) {
    resultsEl.innerHTML = '<p class="empty-state">No players found.</p>';
    return;
  }

  resultsEl.innerHTML = '';
  data.forEach(p => {
    if (currentProfile && p.id === currentProfile.id) return;
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `
      <div class="post-avatar small">${(p.display_name || p.username || '?')[0].toUpperCase()}</div>
      <div><strong>${p.display_name || p.username}</strong><br><small>@${p.username}</small></div>
      <button class="follow-btn" data-uid="${p.id}">Follow</button>
    `;
    resultsEl.appendChild(row);
  });

  resultsEl.querySelectorAll('.follow-btn').forEach(btn => {
    btn.addEventListener('click', () => followUser(btn.dataset.uid, btn));
  });
}

// ============================================================
// Courts — fetch all locations, sort by distance
// ============================================================
async function fetchLocations() {
  const { data, error } = await sb
    .from('location')
    .select('id, name, city, zip, lat, lon, location_asset(sport)')
    .order('name')
    .limit(145);

  if (error || !data) return;

  allLocations = data.map(loc => ({
    ...loc,
    sports: (loc.location_asset || []).map(a => a.sport),
  }));
}

async function loadCourts() {
  if (!allLocations.length) await fetchLocations();

  // Sort by distance if we have location
  let sorted = [...allLocations];
  if (userLat !== null) {
    sorted.sort((a, b) => haversine(userLat, userLon, a.lat, a.lon) - haversine(userLat, userLon, b.lat, b.lon));
  }

  // Filter by sport
  const filtered = activeSport === 'all'
    ? sorted
    : sorted.filter(loc => loc.sports.includes(activeSport));

  renderCourts(filtered);
}

function renderCourts(locs) {
  const list = document.getElementById('courts-list');
  if (!locs.length) {
    list.innerHTML = '<p class="empty-state">No courts found.</p>';
    return;
  }
  list.innerHTML = '';
  locs.forEach(loc => {
    const dist = userLat !== null
      ? `<span class="court-distance">${haversine(userLat, userLon, loc.lat, loc.lon).toFixed(1)} mi</span>`
      : '';
    const tags = loc.sports.map(s => {
      const m = SPORT_META[s] || {};
      return `<span class="sport-tag ${m.cls || ''}">${m.emoji || ''} ${m.label || s}</span>`;
    }).join('');
    const card = document.createElement('div');
    card.className = 'court-card';
    card.innerHTML = `
      <div class="court-card-top">
        <div>
          <h4>${escHtml(loc.name)}</h4>
          <p class="court-city">📍 ${loc.city || 'Montgomery County'}, MD ${loc.zip || ''}</p>
        </div>
        ${dist}
      </div>
      <div class="sport-tags-row">${tags}</div>
      <button class="run-here-btn" data-loc-id="${loc.id}" data-loc-name="${escHtml(loc.name)}">+ Run here</button>
    `;
    card.querySelector('.run-here-btn').addEventListener('click', () => {
      jumpToCreateRun(loc.id);
    });
    list.appendChild(card);
  });
}

function jumpToCreateRun(locId) {
  document.querySelector('[data-section="create"]').click();
  const sel = document.getElementById('run-location');
  if (sel) sel.value = locId;
}

// Sport filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeSport = btn.dataset.sport;
    loadCourts();
  });
});

// Geolocation
function detectLocation() {
  const statusEl = document.getElementById('location-status');
  if (!navigator.geolocation) {
    statusEl.textContent = 'Geolocation not supported.';
    loadCourts();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude;
      userLon = pos.coords.longitude;
      statusEl.textContent = 'Sorted by distance from you';
      loadCourts();
    },
    () => {
      statusEl.textContent = 'All courts in Montgomery County, MD';
      loadCourts();
    },
    { timeout: 6000 }
  );
}

// ============================================================
// Create Run form
// ============================================================
async function populateCreateForm() {
  if (!allLocations.length) await fetchLocations();
  const sel = document.getElementById('run-location');
  if (sel.options.length > 1) return; // already populated
  const sorted = userLat !== null
    ? [...allLocations].sort((a,b) => haversine(userLat,userLon,a.lat,a.lon) - haversine(userLat,userLon,b.lat,b.lon))
    : allLocations;
  sorted.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc.id;
    opt.textContent = loc.name + (loc.city ? ` — ${loc.city}` : '');
    sel.appendChild(opt);
  });

  // Default date to today
  const today = new Date();
  document.getElementById('run-date').value = today.toISOString().split('T')[0];

  // Pre-fill email if signed in
  if (currentUser) {
    document.getElementById('run-email').value = currentUser.email;
  }
}

document.getElementById('create-run-form').addEventListener('submit', async e => {
  e.preventDefault();
  const msgEl  = document.getElementById('create-run-msg');
  const submit = document.getElementById('create-run-submit');
  const locId  = document.getElementById('run-location').value;
  const sport  = document.querySelector('input[name="run-sport"]:checked')?.value;
  const date   = document.getElementById('run-date').value;
  const time   = document.getElementById('run-time').value;
  const going  = parseInt(document.getElementById('run-going').value) || 1;
  const needed = document.getElementById('run-needed').value
    ? parseInt(document.getElementById('run-needed').value)
    : null;
  const privacy = document.querySelector('input[name="privacy"]:checked')?.value || 'public';
  const notes  = document.getElementById('run-notes').value.trim() || null;
  const email  = document.getElementById('run-email').value.trim() || null;

  if (!locId || !sport || !date || !time) {
    showMsg(msgEl, 'Fill in location, sport, date, and time.', true);
    return;
  }

  submit.disabled = true;
  submit.textContent = 'Posting…';

  const scheduled_at = new Date(`${date}T${time}`).toISOString();

  const { error } = await sb.from('run').insert({
    location_id: locId,
    sport,
    scheduled_at,
    going_count: going,
    needed_count: needed,
    privacy,
    notes,
    creator_email: email,
  });

  submit.disabled = false;
  submit.textContent = 'Post Run';

  if (error) {
    showMsg(msgEl, error.message, true);
  } else {
    showMsg(msgEl, '✓ Run posted! People will see it on the map and courts list.', false);
    e.target.reset();
    document.getElementById('run-going').value = 1;
    document.querySelector('input[name="privacy"][value="public"]').checked = true;
  }
});

// ============================================================
// Map — Leaflet
// ============================================================
async function initMap() {
  if (mapInitialized) return;
  mapInitialized = true;

  const mapEl = document.getElementById('leaflet-map');
  const map = L.map(mapEl).setView([39.15, -77.2], 11);
  leafletMap = map;

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  if (!allLocations.length) await fetchLocations();

  // Fetch run counts per location
  const { data: runCounts } = await sb.from('run')
    .select('location_id')
    .gte('scheduled_at', new Date().toISOString());

  const countMap = {};
  (runCounts || []).forEach(r => {
    countMap[r.location_id] = (countMap[r.location_id] || 0) + 1;
  });

  allLocations.forEach(loc => {
    if (!loc.lat || !loc.lon) return;
    const runs   = countMap[loc.id] || 0;
    const color  = runs > 0 ? '#22c55e' : '#1b4d22';
    const radius = runs > 0 ? 10 : 7;

    const marker = L.circleMarker([loc.lat, loc.lon], {
      radius,
      fillColor: color,
      color: '#fff',
      weight: 2,
      fillOpacity: 0.9,
    }).addTo(map);

    const assets   = loc.sports || [];
    const assetHtml = assets.length
      ? assets.map(s => `<span class="map-tag">${SPORT_META[s]?.emoji || ''} ${SPORT_META[s]?.label || s}</span>`).join(' ')
      : '<em>No sport data</em>';

    const runLine = runs > 0
      ? `<p style="color:#22c55e;font-weight:600;">🟢 ${runs} upcoming run${runs > 1 ? 's' : ''}</p>`
      : `<p style="color:#aaa;font-size:0.8rem;">No runs posted yet</p>`;

    const popupHtml = `
      <div class="map-popup">
        <strong>${loc.name}</strong><br>
        <small>📍 ${loc.city || 'Montgomery County'}, MD</small><br><br>
        ${assetHtml}<br><br>
        ${runLine}
        <button onclick="window.__jumpCreate('${loc.id}')" class="map-create-btn">+ Create Run Here</button>
      </div>`;

    marker.bindPopup(popupHtml, { maxWidth: 240 });
  });

  // Global helper for popup button
  window.__jumpCreate = (locId) => {
    document.querySelector('[data-section="create"]').click();
    setTimeout(() => {
      const sel = document.getElementById('run-location');
      if (sel) sel.value = locId;
    }, 100);
  };

  // User location marker
  if (userLat !== null) {
    L.circleMarker([userLat, userLon], {
      radius: 8,
      fillColor: '#3b82f6',
      color: '#fff',
      weight: 2,
      fillOpacity: 1,
    }).addTo(map).bindPopup('You are here');
    map.setView([userLat, userLon], 13);
  }
}

// ============================================================
// App section — phone mockup tabs
// ============================================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById(btn.dataset.tab);
    if (panel) panel.classList.add('active');
  });
});

// Join buttons in mockup
const myRunsList = document.getElementById('myruns-list');
const myRunsEmpty = document.getElementById('myruns-empty');

document.querySelectorAll('.join-btn').forEach(btn => {
  if (btn.disabled) return;
  btn.addEventListener('click', () => {
    if (btn.classList.contains('joined')) return;
    btn.textContent = 'Joined ✓';
    btn.classList.add('joined');
    const card = btn.closest('.run-card');
    const name = card?.dataset.run;
    const meta = card?.dataset.meta;
    if (name && myRunsList) {
      if (myRunsEmpty) myRunsEmpty.classList.add('hidden');
      const entry = document.createElement('div');
      entry.className = 'run-card';
      entry.innerHTML = `<div class="run-info"><h3>${name}</h3><p class="run-meta">📍 ${meta}</p></div>`;
      myRunsList.appendChild(entry);
    }
  });
});

// Chat system (mockup)
const chatData = {
  pickup5v5chat:  { title: 'Pickup 5v5',  messages: [{ from:'DL', text:"who's in for 6:30?" },{ from:'JN', text:"I'm coming" },{ from:'DL', text:'see you at 6:30' }] },
  morning3schat:  { title: 'Morning 3s',  messages: [{ from:'SW', text:'anyone else coming?' }] },
  dmjordan:       { title: 'Jordan',      messages: [{ from:'Jordan', text:'you up for tonight?' }] },
};

const chatThread = document.getElementById('chat-thread');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
let activeChatId = null;

function renderMessages(msgs) {
  chatMessages.innerHTML = '';
  msgs.forEach(msg => {
    const el = document.createElement('div');
    el.className = 'chat-bubble' + (msg.from === 'You' ? ' me' : '');
    el.textContent = `${msg.from}: ${msg.text}`;
    chatMessages.appendChild(el);
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

document.querySelectorAll('.chat-row').forEach(row => {
  row.addEventListener('click', () => {
    const id   = row.dataset.chat;
    const chat = chatData[id];
    if (!chat) return;
    activeChatId = id;
    document.getElementById('chat-thread-title').textContent = chat.title;
    renderMessages(chat.messages);
    chatThread.classList.remove('hidden');
  });
});

document.getElementById('chat-back').addEventListener('click', () => {
  chatThread.classList.add('hidden');
});

chatForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !activeChatId) return;
  chatData[activeChatId].messages.push({ from: 'You', text });
  renderMessages(chatData[activeChatId].messages);
  chatInput.value = '';
});

// Waitlist
document.getElementById('waitlist-btn').addEventListener('click', () => {
  const email = document.getElementById('waitlist-email').value.trim();
  const msgEl = document.getElementById('waitlist-msg');
  if (!email) return;
  msgEl.classList.remove('hidden');
  document.getElementById('waitlist-email').value = '';
});

// ============================================================
// Utilities
// ============================================================
function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function showMsg(el, text, isError) {
  el.textContent = text;
  el.style.color = isError ? '#ef4444' : '#22c55e';
  el.classList.remove('hidden');
  if (!isError) setTimeout(() => el.classList.add('hidden'), 4000);
}

function timeAgo(date) {
  const secs = Math.floor((new Date() - date) / 1000);
  if (secs < 60)  return 'just now';
  if (secs < 3600) return Math.floor(secs/60) + 'm ago';
  if (secs < 86400) return Math.floor(secs/3600) + 'h ago';
  return Math.floor(secs/86400) + 'd ago';
}

function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// Boot
// ============================================================
detectLocation();       // triggers loadCourts() after geolocation
populateCreateForm();   // load court options into Create Run form (will also run on tab switch)
