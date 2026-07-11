// ============================================================
// ImThere — script.js
// ============================================================

const SUPABASE_URL      = 'https://jxxjzwjmvnxivfztfpjt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4eGp6d2ptdm54aXZmenRmcGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3ODAyMjYsImV4cCI6MjA5ODM1NjIyNn0.TpxhJ_E9eapNPkMK6mxjKIUn5Uo5Crvyzbat-5UnzWw';

let sb;
try { sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); }
catch (e) { console.error('Supabase init failed:', e); }

// ── Sports / Venues ──────────────────────────────────────
const VENUE_META = {
  basketball:        { label: 'Courts', cls: 'venue-bball' },
  tennis_pickleball: { label: 'Tennis Courts', cls: 'venue-tennis' },
  field:             { label: 'Fields', cls: 'venue-field' },
};
const SITE_TYPES = ['Park','High School','Middle School','Elementary School','Community Center','Recreation Center','Other'];
const SPORTS_BY_VENUE = {
  basketball:        ['Basketball'],
  tennis_pickleball: ['Tennis','Pickleball'],
  field:             ['Soccer','Football','Flag Football','Rugby','Ultimate Frisbee',
                      'Quadball','Handball','Lacrosse','Kickball','Volleyball',
                      'Field Hockey','Baseball','Softball'],
};
const ALL_SPORTS = [
  'Baseball','Basketball','Cricket','Cycling','Field Hockey','Flag Football',
  'Football','Golf','Gymnastics','Handball','Hiking','Kickball','Lacrosse',
  'Martial Arts','Pickleball','Pilates','Quadball','Rock Climbing','Rugby',
  'Running','Soccer','Softball','Swimming','Tennis','Track & Field',
  'Ultimate Frisbee','Volleyball','Yoga',
];
const SPORT_COLORS = ['#16a34a','#22c55e','#3b82f6','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899','#10b981'];

// ── State ────────────────────────────────────────────────
let currentUser    = null;
let currentProfile = null;
let allLocations   = [];
let userLat = null, userLon = null;
let mapInitialized = false;
let leafletMap     = null;
let activeFeed     = 'all';
let activeVenues   = new Set(['basketball','tennis_pickleball','field']);
let maxDistance    = 5;
let locationDropdownList = [];
let courtRunCounts = {};
let courtCountsLoaded = false;
let activePostImage  = null;
let activeDmUser     = null;
let dmPolling        = null;
let profileGridMode  = 'posts';
let userFavorites    = new Set(); // Set of location IDs
let courtsViewMode   = 'all';    // 'all' | 'favorites'
let courtRatings     = {};       // { locId: { avg, count } }

// ── Navigation ───────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.section)?.classList.add('active');
    if (btn.dataset.section === 'map')     { initMap(); setTimeout(()=>leafletMap?.invalidateSize(),50); }
    if (btn.dataset.section === 'profile') refreshProfileView();
    if (btn.dataset.section === 'create')  { populateCreateForm(); showCreateChoice(); }
    if (btn.dataset.section === 'dms')     loadDmList();
  });
});

document.getElementById('goto-create')?.addEventListener('click', () => {
  document.querySelector('[data-section="create"]')?.click();
  setTimeout(() => showCreateRun(), 50);
});

// Create tab — choice / run / location views
function showCreateRun() {
  document.getElementById('create-choice')?.classList.add('hidden');
  document.getElementById('create-run-view')?.classList.remove('hidden');
}
function showCreateChoice() {
  document.getElementById('create-run-view')?.classList.add('hidden');
  document.getElementById('create-choice')?.classList.remove('hidden');
}

document.getElementById('create-back-btn')?.addEventListener('click', showCreateChoice);

document.getElementById('create-choice-run')?.addEventListener('click', showCreateRun);

document.getElementById('create-choice-loc')?.addEventListener('click', () => {
  if (!currentProfile) { openAuthModal(); return; }
  document.getElementById('add-location-modal')?.classList.remove('hidden');
  document.getElementById('add-loc-name').value = '';
  document.getElementById('add-loc-photo-preview').innerHTML = '';
  document.getElementById('add-loc-form').reset();
  document.getElementById('add-loc-msg').classList.add('hidden');
  document.getElementById('add-loc-coords').textContent = '';
});

// Courts view-mode tabs (All / Favorites)
document.querySelectorAll('.court-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.court-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    courtsViewMode = btn.dataset.mode;
    if (courtsViewMode === 'favorites' && !currentProfile) { openAuthModal(); return; }
    loadCourts(false);
  });
});

// ── Filter panel ─────────────────────────────────────────
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
  loadCourts(true);
});
document.getElementById('reset-filter')?.addEventListener('click', () => {
  document.querySelectorAll('input[name="venue"]').forEach(el => el.checked = true);
  activeVenues  = new Set(['basketball','tennis_pickleball','field']);
  maxDistance   = 5;
  const sl = document.getElementById('distance-slider');
  if (sl) sl.value = 5;
  document.getElementById('distance-label').textContent = '5 mi';
  document.getElementById('filter-panel')?.classList.add('hidden');
  loadCourts(false);
});

// ── Auth ─────────────────────────────────────────────────
let authMode = 'signup';

if (sb) {
  sb.auth.getSession().then(({ data: { session } }) => { if (session) handleAuth(session.user); });
  sb.auth.onAuthStateChange((_ev, session) => handleAuth(session?.user ?? null));
}

async function handleAuth(user) {
  currentUser = user;
  const btn = document.getElementById('auth-trigger');
  if (user) {
    await ensureProfile(user);
    btn.textContent = currentProfile?.username || user.email.split('@')[0];
    courtCountsLoaded = false; courtRunCounts = {};
    await loadUserFavorites();
    await loadCourtAverageRatings();
    loadCourts(false);
  } else {
    currentProfile = null;
    btn.textContent = 'Sign in';
    courtCountsLoaded = false; courtRunCounts = {};
    userFavorites = new Set(); courtRatings = {};
    loadCourts(false);
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
  document.getElementById('auth-subtitle').textContent = isSU ? 'Join ImThere to post runs and follow players.' : 'Log in to your ImThere account.';
  document.getElementById('auth-submit').textContent   = isSU ? 'Create account' : 'Log in';
  document.getElementById('signup-fields').style.display = isSU ? 'block' : 'none';
  document.querySelector('.auth-toggle').innerHTML = isSU
    ? 'Already have an account? <a href="#" id="auth-switch">Log in</a>'
    : 'New here? <a href="#" id="auth-switch">Sign up</a>';
  document.getElementById('auth-error')?.classList.add('hidden');
  document.getElementById('auth-switch')?.addEventListener('click', e => {
    e.preventDefault(); setAuthMode(isSU ? 'login' : 'signup');
  });
}
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
    result = await sb.auth.signUp({ email, password,
      options: { emailRedirectTo: 'https://seanmarcuskelley-svg.github.io/ImThere/' } });
  } else {
    result = await sb.auth.signInWithPassword({ email, password });
  }

  submitEl.disabled = false;
  submitEl.textContent = authMode === 'signup' ? 'Create account' : 'Log in';

  if (result.error) {
    errEl.textContent = result.error.message; errEl.classList.remove('hidden'); return;
  }

  if (authMode === 'signup' && result.data.user) {
    const uid   = result.data.user.id;
    const name  = document.getElementById('signup-name').value.trim();
    const uname = document.getElementById('signup-username').value.trim().replace(/^@/,'');
    const phone = document.getElementById('signup-phone').value.trim();
    const city  = document.getElementById('signup-city').value.trim();
    const base  = (uname || email.split('@')[0]).replace(/[^a-z0-9_]/gi,'');
    const username = base || 'player' + Math.floor(Math.random()*9000+1000);
    await sb.from('profile').upsert({ id:uid, display_name:name||username, username, phone:phone||null, city:city||null });
  }

  closeAuthModal();
  if (authMode === 'signup' && !result.data.session) {
    showBanner('Check your email to confirm your account.', false);
  }
});

// ── Profile ──────────────────────────────────────────────
async function ensureProfile(user) {
  if (!sb) return;
  const { data } = await sb.from('profile').select('*').eq('id', user.id).single();
  if (data) { currentProfile = data; }
  else {
    const base = user.email.split('@')[0].replace(/[^a-z0-9_]/gi,'');
    const username = base + Math.floor(Math.random()*900+100);
    const { data: c } = await sb.from('profile').insert({ id:user.id, username, display_name:base }).select().single();
    currentProfile = c;
  }
}

function refreshProfileView() {
  const gate = document.getElementById('profile-gate');
  const view = document.getElementById('profile-view');
  if (!currentUser || !currentProfile) {
    gate?.classList.remove('hidden'); view?.classList.add('hidden'); return;
  }
  gate?.classList.add('hidden'); view?.classList.remove('hidden');
  renderProfileCard();
  loadProfileStats();
  loadActivityChart();
  loadNearbyPlayers();
  loadFeed(activeFeed);
  loadStories();
  loadProfileGrid();
  populatePostLocations();
}

function renderProfileCard() {
  if (!currentProfile) return;
  const name = currentProfile.display_name || currentProfile.username || '';
  document.getElementById('profile-display-name').textContent = name;
  document.getElementById('profile-username').textContent = '@' + (currentProfile.username || '');
  document.getElementById('profile-bio').textContent  = currentProfile.bio  || '';
  document.getElementById('profile-city').textContent = currentProfile.city || '';

  // Avatar
  const av = document.getElementById('profile-avatar');
  const ca = document.getElementById('composer-avatar');
  if (currentProfile.avatar_url) {
    av.innerHTML  = `<img src="${escHtml(currentProfile.avatar_url)}" alt="avatar">`;
    if (ca) ca.innerHTML = `<img src="${escHtml(currentProfile.avatar_url)}" alt="avatar">`;
  } else {
    const initial = (name[0] || '?').toUpperCase();
    av.textContent = initial;
    if (ca) ca.textContent = initial;
  }
}

async function loadProfileStats() {
  if (!currentProfile || !sb) return;
  const uid = currentProfile.id;
  const [p, r, flrs, fling] = await Promise.all([
    sb.from('post').select('id',{count:'exact',head:true}).eq('author_id',uid),
    sb.from('run').select('id',{count:'exact',head:true}).eq('creator_id',uid),
    sb.from('follow').select('id',{count:'exact',head:true}).eq('following_id',uid),
    sb.from('follow').select('id',{count:'exact',head:true}).eq('follower_id',uid),
  ]);
  document.getElementById('stat-posts').textContent     = p.count    ?? 0;
  document.getElementById('stat-runs').textContent      = r.count     ?? 0;
  document.getElementById('stat-followers').textContent = flrs.count  ?? 0;
  document.getElementById('stat-following').textContent = fling.count ?? 0;
}

// Avatar upload
document.getElementById('avatar-upload')?.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file || !currentProfile || !sb) return;
  showBanner('Uploading photo...', false);
  const ext  = file.name.split('.').pop();
  const path = `avatars/${currentProfile.id}.${ext}`;
  const { error: upErr } = await sb.storage.from('media').upload(path, file, { upsert: true });
  if (upErr) { showBanner('Upload failed: ' + upErr.message, true); return; }
  const { data: { publicUrl } } = sb.storage.from('media').getPublicUrl(path);
  await sb.from('profile').update({ avatar_url: publicUrl }).eq('id', currentProfile.id);
  currentProfile.avatar_url = publicUrl;
  renderProfileCard();
  showBanner('Profile photo updated.', false);
});

// Activity pie chart
async function loadActivityChart() {
  if (!currentProfile || !sb) return;
  const { data } = await sb.from('run').select('sport').eq('creator_id', currentProfile.id);
  const canvas = document.getElementById('activity-chart');
  const legend = document.getElementById('activity-legend');
  const empty  = document.getElementById('activity-empty');
  if (!data?.length) {
    canvas.style.display = 'none'; legend.style.display = 'none';
    empty?.classList.remove('hidden'); return;
  }
  empty?.classList.add('hidden');
  canvas.style.display = ''; legend.style.display = '';
  const counts = {};
  data.forEach(r => { counts[r.sport] = (counts[r.sport]||0) + 1; });
  const total   = data.length;
  const entries = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  const ctx = canvas.getContext('2d');
  const cx=65,cy=65,r=58; let angle=-Math.PI/2;
  ctx.clearRect(0,0,130,130);
  entries.forEach(([sport,count],i) => {
    const slice = (count/total)*2*Math.PI;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,angle,angle+slice); ctx.closePath();
    ctx.fillStyle = SPORT_COLORS[i%SPORT_COLORS.length]; ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
    angle+=slice;
  });
  // donut hole
  ctx.beginPath(); ctx.arc(cx,cy,30,0,2*Math.PI); ctx.fillStyle='#fff'; ctx.fill();
  legend.innerHTML = entries.map(([sport,count],i) => `
    <div class="legend-row">
      <span class="legend-dot" style="background:${SPORT_COLORS[i%SPORT_COLORS.length]}"></span>
      <span class="legend-label">${escHtml(sport)}</span>
      <span class="legend-pct">${Math.round((count/total)*100)}%</span>
    </div>`).join('');
}

// Nearby players
async function loadNearbyPlayers() {
  if (!currentProfile?.city || !sb) return;
  const card = document.getElementById('nearby-players-card');
  const list = document.getElementById('nearby-players-list');
  if (!card||!list) return;
  const { data } = await sb.from('profile')
    .select('id,username,display_name,city,avatar_url')
    .ilike('city',`%${currentProfile.city.split(',')[0].trim()}%`)
    .neq('id',currentProfile.id).limit(8);
  if (!data?.length) return;
  card.classList.remove('hidden');
  list.innerHTML = data.map(p => `
    <div class="player-row">
      ${avatarHtml(p,30)}
      <div><strong>${escHtml(p.display_name||p.username)}</strong><br><small>@${escHtml(p.username)}${p.city?' · '+escHtml(p.city):''}</small></div>
      <button class="follow-btn" data-uid="${p.id}">Follow</button>
    </div>`).join('');
  list.querySelectorAll('.follow-btn').forEach(btn => btn.addEventListener('click', () => followUser(btn.dataset.uid,btn)));
}

// Edit profile
document.getElementById('edit-profile-btn')?.addEventListener('click', () => {
  if (!currentProfile) return;
  document.getElementById('edit-display-name').value = currentProfile.display_name||'';
  document.getElementById('edit-username').value     = currentProfile.username||'';
  document.getElementById('edit-phone').value        = currentProfile.phone||'';
  document.getElementById('edit-city').value         = currentProfile.city||'';
  document.getElementById('edit-bio').value          = currentProfile.bio||'';
  document.getElementById('edit-profile-form').classList.toggle('hidden');
});
document.getElementById('cancel-edit-btn')?.addEventListener('click', () => {
  document.getElementById('edit-profile-form').classList.add('hidden');
});
document.getElementById('save-profile-btn')?.addEventListener('click', async () => {
  const msg      = document.getElementById('edit-profile-msg');
  const display  = document.getElementById('edit-display-name').value.trim();
  const username = document.getElementById('edit-username').value.trim().replace(/^@/,'');
  const phone    = document.getElementById('edit-phone').value.trim();
  const city     = document.getElementById('edit-city').value.trim();
  const bio      = document.getElementById('edit-bio').value.trim();
  if (!username) { showMsg(msg,'Username required.',true); return; }
  const { error } = await sb.from('profile')
    .update({display_name:display,username,phone:phone||null,city:city||null,bio:bio||null})
    .eq('id',currentProfile.id);
  if (error) { showMsg(msg,error.message,true); }
  else {
    currentProfile = {...currentProfile,display_name:display,username,phone,city,bio};
    renderProfileCard(); loadNearbyPlayers();
    document.getElementById('edit-profile-form').classList.add('hidden');
  }
});

// ── Stories ──────────────────────────────────────────────
async function loadStories() {
  if (!sb) return;
  const since = new Date(Date.now() - 48*60*60*1000).toISOString();
  const { data } = await sb.from('post')
    .select('id,content,image_url,created_at,author_id,profile(username,display_name,avatar_url)')
    .gte('created_at',since).order('created_at',{ascending:false}).limit(20);

  const list = document.getElementById('stories-list');
  if (!list||!data?.length) return;

  // Group by author, one story per author
  const seen = new Set();
  const stories = data.filter(p => {
    if (seen.has(p.author_id)) return false;
    seen.add(p.author_id); return true;
  });

  list.innerHTML = stories.map(p => {
    const prof = p.profile||{};
    const name = prof.display_name||prof.username||'Player';
    const initials = (name[0]||'?').toUpperCase();
    const inner = prof.avatar_url
      ? `<img src="${escHtml(prof.avatar_url)}" alt="${escHtml(name)}">`
      : `<span class="story-initials">${initials}</span>`;
    return `<div class="story-item" data-post-id="${p.id}" data-author="${escHtml(name)}" data-content="${escHtml(p.content)}" data-img="${escHtml(p.image_url||'')}">
      <div class="story-ring"><div class="story-inner">${inner}</div></div>
      <span class="story-label">${escHtml(name)}</span>
    </div>`;
  }).join('');

  list.querySelectorAll('.story-item').forEach(item => {
    item.addEventListener('click', () => openStory(item.dataset));
  });
}

function openStory(data) {
  document.getElementById('story-viewer-author').textContent = data.author;
  document.getElementById('story-viewer-body').textContent   = data.content;
  document.getElementById('story-viewer').classList.remove('hidden');
}
document.getElementById('story-viewer-close')?.addEventListener('click', () => {
  document.getElementById('story-viewer').classList.add('hidden');
});
document.getElementById('story-add-btn')?.addEventListener('click', () => {
  document.getElementById('post-content')?.focus();
  // Scroll to composer
  document.getElementById('post-content')?.scrollIntoView({behavior:'smooth'});
});

// ── Post Grid ────────────────────────────────────────────
document.querySelectorAll('.grid-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.grid-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    profileGridMode = btn.dataset.grid;
    loadProfileGrid();
  });
});

async function loadProfileGrid() {
  if (!currentProfile||!sb) return;
  const grid = document.getElementById('profile-post-grid');
  if (!grid) return;
  grid.innerHTML = '<p class="post-grid-empty" style="font-size:.78rem">Loading...</p>';

  if (profileGridMode === 'posts') {
    const { data } = await sb.from('post').select('id,content,image_url,created_at')
      .eq('author_id',currentProfile.id).order('created_at',{ascending:false}).limit(30);
    if (!data?.length) { grid.innerHTML = '<p class="post-grid-empty">No posts yet.</p>'; return; }
    grid.innerHTML = data.map((p,i) => {
      const bg = SPORT_COLORS[i%SPORT_COLORS.length]+'22';
      if (p.image_url) return `<div class="post-grid-item"><img src="${escHtml(p.image_url)}" alt="post"></div>`;
      return `<div class="post-grid-item sport-bg" style="background:${bg}"><div class="grid-text-preview">${escHtml(p.content.substring(0,60))}</div></div>`;
    }).join('');
  } else {
    const { data } = await sb.from('run').select('id,sport,scheduled_at,location(name)')
      .eq('creator_id',currentProfile.id).order('scheduled_at',{ascending:false}).limit(30);
    if (!data?.length) { grid.innerHTML = '<p class="post-grid-empty">No runs posted yet.</p>'; return; }
    grid.innerHTML = data.map((r,i) => {
      const bg = SPORT_COLORS[i%SPORT_COLORS.length]+'22';
      const d  = new Date(r.scheduled_at);
      const ds = d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
      return `<div class="post-grid-item sport-bg" style="background:${bg}"><div class="grid-text-preview"><strong>${escHtml(r.sport)}</strong><br>${r.location?.name?escHtml(r.location.name.substring(0,20)):''}<br>${ds}</div></div>`;
    }).join('');
  }
}

// ── Posts ────────────────────────────────────────────────
async function populatePostLocations() {
  const sel = document.getElementById('post-location');
  if (!sel||sel.options.length>1) return;
  if (!allLocations.length) await fetchLocations();
  allLocations.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc.id; opt.textContent = loc.name;
    sel.appendChild(opt);
  });
}

// Post photo
document.getElementById('post-photo-btn')?.addEventListener('click', () => {
  document.getElementById('post-image-upload')?.click();
});
document.getElementById('post-image-upload')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  activePostImage = file;
  const url = URL.createObjectURL(file);
  document.getElementById('composer-preview-img').src = url;
  document.getElementById('composer-image-preview').classList.remove('hidden');
});
document.getElementById('remove-preview-btn')?.addEventListener('click', () => {
  activePostImage = null;
  document.getElementById('post-image-upload').value = '';
  document.getElementById('composer-image-preview').classList.add('hidden');
});

document.getElementById('post-submit-btn')?.addEventListener('click', async () => {
  const msgEl   = document.getElementById('post-msg');
  const content = document.getElementById('post-content').value.trim();
  const locId   = document.getElementById('post-location').value || null;
  if (!content) { showMsg(msgEl,'Write something first.',true); return; }
  if (!currentProfile) { openAuthModal(); return; }

  let image_url = null;
  if (activePostImage) {
    const ext  = activePostImage.name.split('.').pop();
    const path = `posts/${currentProfile.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from('media').upload(path, activePostImage);
    if (!upErr) {
      image_url = sb.storage.from('media').getPublicUrl(path).data.publicUrl;
    }
  }

  const { error } = await sb.from('post').insert({
    author_id: currentProfile.id, content, location_id: locId, image_url
  });
  if (error) { showMsg(msgEl,error.message,true); }
  else {
    document.getElementById('post-content').value = '';
    document.getElementById('post-location').value = '';
    activePostImage = null;
    document.getElementById('post-image-upload').value = '';
    document.getElementById('composer-image-preview').classList.add('hidden');
    showMsg(msgEl,'Posted!',false);
    loadFeed(activeFeed); loadProfileStats(); loadStories(); loadProfileGrid();
  }
});

document.querySelectorAll('.feed-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.feed-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); activeFeed = btn.dataset.feed; loadFeed(activeFeed);
  });
});

async function loadFeed(mode) {
  const feedEl = document.getElementById('post-feed');
  if (!feedEl||!sb) return;
  feedEl.innerHTML = '<p class="loading-msg">Loading...</p>';

  let query = sb.from('post')
    .select('id,content,image_url,created_at,location_id,author_id,profile(username,display_name,avatar_url),location(name)')
    .order('created_at',{ascending:false}).limit(40);

  if (mode==='mine'&&currentProfile) { query=query.eq('author_id',currentProfile.id); }
  else if (mode==='following'&&currentProfile) {
    const {data:f} = await sb.from('follow').select('following_id').eq('follower_id',currentProfile.id);
    const ids=(f||[]).map(x=>x.following_id);
    if (!ids.length) { feedEl.innerHTML='<p class="empty-state">Follow some players to see their posts.</p>'; return; }
    query=query.in('author_id',ids);
  }

  const {data,error}=await query;
  if (error) { feedEl.innerHTML=`<p class="empty-state" style="color:var(--red)">${error.message}</p>`; return; }
  if (!data?.length) { feedEl.innerHTML='<p class="empty-state">No posts yet.</p>'; return; }

  feedEl.innerHTML='';
  data.forEach(post => {
    const prof  = post.profile||{};
    const author= prof.display_name||prof.username||'Player';
    const isMine= currentProfile&&post.author_id===currentProfile.id;
    const imgTag= post.image_url?`<img class="post-image" src="${escHtml(post.image_url)}" alt="post image">` : '';
    const locTag= post.location?`<span class="post-location-tag">${escHtml(post.location.name)}</span>`:'';
    const card  = document.createElement('div');
    card.className='post-card';
    card.innerHTML=`
      <div class="post-header">
        ${avatarHtml(prof,36)}
        <div class="post-meta"><strong>${escHtml(author)}</strong><span class="post-when">${timeAgo(new Date(post.created_at))}</span></div>
        ${!isMine?`<button class="follow-btn" data-uid="${post.author_id}">Follow</button>`:''}
      </div>
      <p class="post-text">${escHtml(post.content)}</p>
      ${imgTag}${locTag}`;
    feedEl.appendChild(card);
  });
  feedEl.querySelectorAll('.follow-btn').forEach(btn => btn.addEventListener('click', ()=>followUser(btn.dataset.uid,btn)));
}

async function followUser(targetId, btnEl) {
  if (!currentProfile) { openAuthModal(); return; }
  if (targetId===currentProfile.id) return;
  btnEl.disabled=true;
  const {error}=await sb.from('follow').insert({follower_id:currentProfile.id,following_id:targetId});
  if (error?.code==='23505') {
    await sb.from('follow').delete().eq('follower_id',currentProfile.id).eq('following_id',targetId);
    btnEl.textContent='Follow'; btnEl.classList.remove('following');
  } else if (error) { showBanner(error.message,true); }
  else { btnEl.textContent='Following'; btnEl.classList.add('following'); loadProfileStats(); }
  btnEl.disabled=false;
}

document.getElementById('player-search-btn')?.addEventListener('click', searchPlayers);
document.getElementById('player-search')?.addEventListener('keydown', e => { if(e.key==='Enter') searchPlayers(); });

async function searchPlayers() {
  const q  = document.getElementById('player-search')?.value.trim();
  const el = document.getElementById('player-results');
  if (!q||!el||!sb) return;
  const {data}=await sb.from('profile').select('id,username,display_name,city,avatar_url').ilike('username',`%${q}%`).limit(10);
  if (!data?.length) { el.innerHTML='<p class="empty-state">No players found.</p>'; return; }
  el.innerHTML=data.filter(p=>!currentProfile||p.id!==currentProfile.id).map(p=>`
    <div class="player-row">
      ${avatarHtml(p,30)}
      <div><strong>${escHtml(p.display_name||p.username)}</strong><br><small>@${escHtml(p.username)}${p.city?' · '+escHtml(p.city):''}</small></div>
      <button class="follow-btn" data-uid="${p.id}">Follow</button>
    </div>`).join('');
  el.querySelectorAll('.follow-btn').forEach(btn=>btn.addEventListener('click',()=>followUser(btn.dataset.uid,btn)));
}

// ── Favorites ────────────────────────────────────────────
async function loadUserFavorites() {
  userFavorites = new Set();
  if (!currentProfile || !sb) return;
  const { data } = await sb.from('court_favorite').select('location_id').eq('user_id', currentProfile.id);
  (data || []).forEach(r => userFavorites.add(r.location_id));
}

async function toggleFavorite(locId, btn) {
  if (!currentProfile) { openAuthModal(); return; }
  const wasFav = userFavorites.has(locId);

  // Optimistic UI update
  if (wasFav) {
    userFavorites.delete(locId);
    btn.classList.remove('fav-active');
    btn.querySelector('svg')?.setAttribute('fill', 'none');
  } else {
    userFavorites.add(locId);
    btn.classList.add('fav-active');
    btn.querySelector('svg')?.setAttribute('fill', 'currentColor');
  }

  let error;
  if (wasFav) {
    ({ error } = await sb.from('court_favorite').delete()
      .eq('user_id', currentProfile.id).eq('location_id', locId));
  } else {
    ({ error } = await sb.from('court_favorite').insert(
      { user_id: currentProfile.id, location_id: locId }
    ));
  }

  if (error) {
    // Rollback
    if (wasFav) {
      userFavorites.add(locId);
      btn.classList.add('fav-active');
      btn.querySelector('svg')?.setAttribute('fill', 'currentColor');
    } else {
      userFavorites.delete(locId);
      btn.classList.remove('fav-active');
      btn.querySelector('svg')?.setAttribute('fill', 'none');
    }
    showBanner(error.message || 'Could not save favorite', true);
    return;
  }

  if (courtsViewMode === 'favorites') loadCourts(false);
}

// ── Ratings ───────────────────────────────────────────────
async function loadCourtAverageRatings() {
  courtRatings = {};
  if (!sb) return;
  const { data } = await sb.from('court_rating').select('location_id,rating');
  (data || []).forEach(r => {
    if (!courtRatings[r.location_id]) courtRatings[r.location_id] = { sum: 0, count: 0 };
    courtRatings[r.location_id].sum   += r.rating;
    courtRatings[r.location_id].count += 1;
  });
  Object.keys(courtRatings).forEach(id => {
    const obj = courtRatings[id];
    obj.avg = obj.sum / obj.count;
  });
}

function starsHtml(avg, count, interactive = false, locId = '') {
  if (interactive) {
    return `<div class="star-row interactive" id="stars-${locId}">
      ${[1,2,3,4,5].map(n => `<button class="star-btn" data-n="${n}" data-loc="${locId}" aria-label="${n} star">★</button>`).join('')}
    </div>`;
  }
  if (!avg) return '<span class="no-rating">No ratings yet</span>';
  const full  = Math.round(avg);
  const stars = [1,2,3,4,5].map(n => `<span class="${n<=full?'star-on':'star-off'}">★</span>`).join('');
  return `<div class="star-row">${stars}<span class="rating-num">${avg.toFixed(1)} (${count})</span></div>`;
}

async function openCourtRatingPanel(loc, panel) {
  const uid = currentProfile?.id;
  let myRating = null;
  if (uid && sb) {
    const { data } = await sb.from('court_rating').select('*').eq('user_id', uid).eq('location_id', loc.id).single();
    myRating = data;
  }

  // Use shortened ID safe for input names (no hyphens)
  const lid = loc.id.replace(/-/g,'');

  const CONDITIONS = [
    { key:'surface',    label:'Surface',        type:'radio',    opts:['Great shape','Good','Fair','Rough','Cracked/damaged'] },
    { key:'hoops',      label:'Hoops',          type:'radio',    opts:['Has hoops','No hoops','Bent rims','Double rims'] },
    { key:'nets',       label:'Nets',           type:'radio',    opts:['New nets','Damaged nets','No nets'] },
    { key:'lighting',   label:'Lighting',       type:'radio',    opts:['Well lit','Partial lighting','No lighting'] },
    { key:'lights_off', label:'Lights off at',  type:'time' },
    { key:'parking',    label:'Parking',        type:'checkbox', opts:['Free parking','Street parking','Paid parking','Limited spots','No parking nearby'] },
    { key:'extras',     label:'Extras',         type:'checkbox', opts:['Bathrooms nearby','Water fountain','Seating/bleachers','Shade','Fenced in','Scoreboard','Covered area'] },
  ];

  const condHtml = CONDITIONS.map(cond => {
    if (cond.type === 'time') {
      const val = myRating?.conditions?.lights_off || '';
      return `<div class="cond-group" id="lights-off-group-${lid}" style="display:none">
        <div class="cond-label">${cond.label} <span class="optional">(optional)</span></div>
        <input type="time" class="cond-time-input" id="cond-lights_off-${lid}" value="${val}">
      </div>`;
    }
    const isCheckbox = cond.type === 'checkbox';
    const prev = myRating?.conditions?.[cond.key];
    return `<div class="cond-group">
      <div class="cond-label">${cond.label}</div>
      <div class="cond-chips">
        ${cond.opts.map(o => {
          const isChecked = isCheckbox
            ? Array.isArray(prev) && prev.includes(o)
            : prev === o;
          return `<label class="cond-chip"><input type="${isCheckbox?'checkbox':'radio'}" name="cond-${cond.key}-${lid}" value="${escHtml(o)}" ${isChecked?'checked':''}><span>${escHtml(o)}</span></label>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');

  const existing = myRating ? `<p class="rating-existing">Your rating: ${myRating.rating}★ — update below</p>` : '';

  panel.innerHTML = `<div class="rating-section" id="rating-${loc.id}">
    <h5>Rate this court</h5>
    ${starsHtml(courtRatings[loc.id]?.avg, courtRatings[loc.id]?.count)}
    ${existing}
    ${starsHtml(0,0,true,loc.id)}
    <div class="cond-form">${condHtml}</div>
    <textarea class="rating-review" id="review-${loc.id}" placeholder="Optional: describe what you saw..." rows="2">${myRating?.review||''}</textarea>
    <button class="submit-btn" style="margin-top:10px;font-size:.84rem;padding:10px" id="rate-submit-${loc.id}">Submit Rating</button>
    <p class="form-msg hidden" id="rate-msg-${loc.id}"></p>
  </div>`;

  // Wire stars
  const starRow = document.getElementById(`stars-${loc.id}`);
  let selectedStar = myRating?.rating || 0;
  if (starRow) {
    starRow.querySelectorAll('.star-btn').forEach(btn => {
      const n = parseInt(btn.dataset.n);
      if (n <= selectedStar) btn.classList.add('selected');
      btn.addEventListener('mouseenter', () => starRow.querySelectorAll('.star-btn').forEach(b => b.classList.toggle('hover', parseInt(b.dataset.n) <= n)));
      btn.addEventListener('mouseleave', () => starRow.querySelectorAll('.star-btn').forEach(b => b.classList.remove('hover')));
      btn.addEventListener('click', () => {
        selectedStar = n;
        starRow.querySelectorAll('.star-btn').forEach(b => b.classList.toggle('selected', parseInt(b.dataset.n) <= n));
      });
    });
  }

  // Show/hide lights-off time
  panel.querySelectorAll(`input[name="cond-lighting-${lid}"]`).forEach(radio => {
    radio.addEventListener('change', () => {
      const grp = document.getElementById(`lights-off-group-${lid}`);
      if (grp) grp.style.display = (radio.checked && radio.value !== 'No lighting') ? 'block' : 'none';
    });
    if (radio.checked && radio.value !== 'No lighting') {
      const grp = document.getElementById(`lights-off-group-${lid}`);
      if (grp) grp.style.display = 'block';
    }
  });

  document.getElementById(`rate-submit-${loc.id}`)?.addEventListener('click', async () => {
    const msgEl = document.getElementById(`rate-msg-${loc.id}`);
    if (!selectedStar) { showMsg(msgEl, 'Tap stars to rate.', true); return; }
    if (!currentProfile) { openAuthModal(); return; }
    const review = document.getElementById(`review-${loc.id}`)?.value.trim() || null;
    const conditions = {};
    CONDITIONS.forEach(cond => {
      if (cond.type === 'time') {
        const val = document.getElementById(`cond-lights_off-${lid}`)?.value;
        if (val) conditions[cond.key] = val;
      } else if (cond.type === 'checkbox') {
        const checked = [...panel.querySelectorAll(`input[name="cond-${cond.key}-${lid}"]:checked`)].map(el => el.value);
        if (checked.length) conditions[cond.key] = checked;
      } else {
        const checked = panel.querySelector(`input[name="cond-${cond.key}-${lid}"]:checked`);
        if (checked) conditions[cond.key] = checked.value;
      }
    });
    const { error } = await sb.from('court_rating').upsert({
      user_id: currentProfile.id, location_id: loc.id,
      rating: selectedStar, review, conditions
    }, { onConflict: 'user_id,location_id' });
    if (error) { showMsg(msgEl, error.message, true); }
    else {
      showMsg(msgEl, 'Rating saved!', false);
      await loadCourtAverageRatings();
      // Update the displayed average
      const avgEl = document.querySelector(`#rating-${loc.id} .star-row:not(.interactive)`);
      if (avgEl) avgEl.outerHTML = starsHtml(courtRatings[loc.id]?.avg, courtRatings[loc.id]?.count);
    }
  });
}

// ── Busy Times ────────────────────────────────────────────
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const HOURS_LABEL = { 6:'6am',9:'9am',12:'12pm',15:'3pm',18:'6pm',21:'9pm' };

async function loadBusyTimes(loc, panel) {
  if (!sb) return;
  const { data } = await sb.from('run').select('scheduled_at').eq('location_id', loc.id);
  if (!data?.length) { panel.innerHTML += '<p style="font-size:.75rem;color:var(--text-3);padding:4px 0">Not enough run data yet for busy times.</p>'; return; }

  // Aggregate by day of week
  const byDay = [0,0,0,0,0,0,0];
  data.forEach(r => { byDay[new Date(r.scheduled_at).getDay()]++; });
  const maxDay = Math.max(...byDay) || 1;

  // Aggregate by hour bucket
  const byHour = {};
  for (let h = 0; h < 24; h++) byHour[h] = 0;
  data.forEach(r => { byHour[new Date(r.scheduled_at).getHours()]++; });
  const maxHr = Math.max(...Object.values(byHour)) || 1;

  const dayBars = byDay.map((cnt, i) => {
    const pct = Math.round((cnt / maxDay) * 100);
    const intensity = pct > 66 ? 'busy-high' : pct > 33 ? 'busy-mid' : 'busy-low';
    return `<div class="busy-day-col">
      <div class="busy-bar-wrap"><div class="busy-bar ${intensity}" style="height:${Math.max(pct,4)}%"></div></div>
      <div class="busy-day-label">${DAYS_SHORT[i]}</div>
    </div>`;
  }).join('');

  panel.innerHTML += `
    <div class="busy-times-section">
      <h5>Popular times</h5>
      <div class="busy-chart">${dayBars}</div>
      <p class="busy-note">Based on ${data.length} run${data.length!==1?'s':''} posted here</p>
    </div>`;
}

// ── Courts ───────────────────────────────────────────────
async function fetchLocations() {
  if (!sb) return;
  const {data,error}=await sb.from('location').select('id,name,city,zip,lat,lon,location_asset(sport)').order('name').limit(145);
  if (error) { document.getElementById('courts-list').innerHTML=`<p class="empty-state" style="color:var(--red)">Could not load courts: ${error.message}</p>`; return; }
  allLocations=(data||[]).map(loc=>({...loc,sports:(loc.location_asset||[]).map(a=>a.sport)}));
}

async function fetchCourtCounts() {
  if (courtCountsLoaded||!sb) return;
  courtCountsLoaded=true;
  const {data:allRuns}=await sb.from('run').select('location_id');
  (allRuns||[]).forEach(r=>{
    if(!courtRunCounts[r.location_id]) courtRunCounts[r.location_id]={total:0,personal:0};
    courtRunCounts[r.location_id].total++;
  });
  if (currentProfile) {
    const {data:myRuns}=await sb.from('run').select('location_id').eq('creator_id',currentProfile.id);
    (myRuns||[]).forEach(r=>{
      if(!courtRunCounts[r.location_id]) courtRunCounts[r.location_id]={total:0,personal:0};
      courtRunCounts[r.location_id].personal++;
    });
  }
}

function scoreCourt(loc) {
  const c=courtRunCounts[loc.id]||{total:0,personal:0};
  const dist=(userLat!==null)?haversine(userLat,userLon,loc.lat,loc.lon):10;
  return c.personal*15 + c.total*3 + Math.max(0,30-dist);
}

async function loadCourts(applyFilter=false) {
  if (!allLocations.length) await fetchLocations();
  await fetchCourtCounts();
  let pool=[...allLocations];

  if (courtsViewMode === 'favorites') {
    pool = pool.filter(l => userFavorites.has(l.id));
    pool.sort((a,b) => scoreCourt(b) - scoreCourt(a));
    renderCourts(pool, true, true);
    return;
  }

  if (applyFilter) {
    if (userLat!==null) pool=pool.filter(l=>haversine(userLat,userLon,l.lat,l.lon)<=maxDistance);
    pool=pool.filter(l=>l.sports.some(s=>activeVenues.has(s)));
    pool.sort((a,b)=>scoreCourt(b)-scoreCourt(a));
  } else {
    pool=pool.filter(l=>l.sports.some(s=>activeVenues.has(s)));
    pool.sort((a,b)=>scoreCourt(b)-scoreCourt(a));
    pool=pool.slice(0,10);
  }
  renderCourts(pool, applyFilter, false);
}

function renderCourts(locs, filtered=false, isFavView=false) {
  const list=document.getElementById('courts-list');
  if (!list) return;
  if (!locs.length) {
    list.innerHTML = isFavView
      ? '<p class="empty-state">No favorites yet. Tap the heart on any court to save it.</p>'
      : '<p class="empty-state">No courts match your filters. Try expanding the distance.</p>';
    return;
  }

  const label = isFavView
    ? `${locs.length} saved court${locs.length!==1?'s':''}`
    : filtered
      ? `${locs.length} court${locs.length!==1?'s':''} matching filters`
      : `Top ${locs.length} for you`;
  list.innerHTML=`<p class="courts-list-label">${label}</p>`;

  locs.forEach(loc=>{
    const dist=userLat!==null?`<span class="court-distance">${haversine(userLat,userLon,loc.lat,loc.lon).toFixed(1)} mi</span>`:'';
    const tags=(loc.sports||[]).map(s=>{const m=VENUE_META[s]||{label:s,cls:''};return`<span class="venue-tag ${m.cls}">${m.label}</span>`;}).join('');
    const runCount=courtRunCounts[loc.id]?.total||0;
    const isFav=userFavorites.has(loc.id);
    const rObj=courtRatings[loc.id];
    const ratingHtml=rObj
      ? `<div class="court-rating">${'★'.repeat(Math.round(rObj.avg))}<span class="rating-num-sm">${rObj.avg.toFixed(1)} (${rObj.count})</span></div>`
      : '';

    const card=document.createElement('div');
    card.className='court-card';
    card.innerHTML=`
      <div class="court-card-main">
        <div class="court-card-top">
          <div>
            <h4 class="court-name-link" data-loc="${loc.id}">${escHtml(loc.name)}</h4>
            <p class="court-city">${loc.city||'Montgomery County'}, MD</p>
            ${ratingHtml}
          </div>
          <div style="display:flex;align-items:flex-start;gap:6px">
            ${dist}
            <button class="fav-btn${isFav?' fav-active':''}" data-loc="${loc.id}" title="${isFav?'Remove from favorites':'Save to favorites'}">
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="${isFav?'currentColor':'none'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
            </button>
          </div>
        </div>
        <div class="sport-tags-row">${tags}</div>
      </div>
      <div class="court-card-footer">
        <button class="court-footer-btn" data-action="runs">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${runCount} Run${runCount!==1?'s':''}
        </button>
        <button class="court-footer-btn" data-action="rate">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          Rate
        </button>
        <button class="court-footer-btn" data-action="photos">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          Photos
        </button>
        <button class="court-footer-btn primary" data-action="create">+ Run here</button>
      </div>
      <div class="court-expand" id="expand-${loc.id}"></div>`;

    card.querySelector('[data-action="create"]').addEventListener('click', ()=>jumpToCreateRun(loc.id));
    card.querySelector('[data-action="runs"]').addEventListener('click', ()=>openCourtDetail(loc.id));
    card.querySelector('[data-action="rate"]').addEventListener('click', ()=>toggleCourtExpand(loc,'rate'));
    card.querySelector('[data-action="photos"]').addEventListener('click', ()=>openCourtDetail(loc.id));
    card.querySelector('.fav-btn').addEventListener('click', e=>toggleFavorite(loc.id, e.currentTarget));
    card.querySelector('.court-name-link').addEventListener('click', ()=>openCourtDetail(loc.id));
    list.appendChild(card);
  });
}

function toggleCourtExpand(loc,view) {
  const panel=document.getElementById(`expand-${loc.id}`);
  if (!panel) return;
  const isOpen=panel.classList.contains('open')&&panel.dataset.view===view;
  panel.classList.toggle('open',!isOpen);
  panel.dataset.view=view;
  if (!isOpen) {
    panel.innerHTML='';
    if (view==='runs')   { loadCourtRuns(loc,panel); loadBusyTimes(loc,panel); }
    if (view==='rate')   { if (!currentProfile){openAuthModal();panel.classList.remove('open');return;} openCourtRatingPanel(loc,panel); }
    if (view==='photos') loadCourtPhotos(loc,panel);
  } else {
    panel.innerHTML='';
  }
}

async function loadCourtRuns(loc,panel) {
  panel.innerHTML='<h5>Upcoming runs</h5><p class="loading-msg" style="padding:12px">Loading...</p>';
  if (!sb) return;
  const now=new Date().toISOString();
  const {data}=await sb.from('run')
    .select('id,sport,scheduled_at,going_count,needed_count,notes')
    .eq('location_id',loc.id).gte('scheduled_at',now)
    .order('scheduled_at').limit(5);

  let html='<h5>Upcoming runs</h5>';
  if (!data?.length) { html+='<p style="font-size:.8rem;color:var(--text-3);padding:8px 0">No runs posted yet. Be the first!</p>'; }
  else {
    html+=data.map(r=>{
      const d=new Date(r.scheduled_at);
      const ds=d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
      const ts=d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
      const needed=r.needed_count?`/${r.needed_count}`:'';
      return `<div class="mini-run-card" id="run-card-${r.id}">
        <div class="mini-run-top">
          <span class="mini-run-sport">${escHtml(r.sport)}</span>
          <span class="mini-run-time">${ds} · ${ts}</span>
        </div>
        <div class="mini-run-meta">${r.going_count}${needed} players${r.notes?` · ${escHtml(r.notes)}`:''}</div>
        <div class="run-comments" id="comments-${r.id}">
          <h6>Comments</h6>
          <div class="comment-list" id="comment-list-${r.id}"><p style="font-size:.75rem;color:var(--text-3)">Loading...</p></div>
          <div class="comment-form" id="comment-form-${r.id}">
            <input type="text" placeholder="Add a comment..." id="comment-input-${r.id}">
            <button data-run="${r.id}">Send</button>
          </div>
        </div>
      </div>`;
    }).join('');
  }
  panel.innerHTML=html;
  // Load comments and wire send buttons
  data?.forEach(r=>{
    loadRunComments(r.id);
    const sendBtn=panel.querySelector(`#comment-form-${r.id} button`);
    sendBtn?.addEventListener('click',()=>postComment(r.id,`comment-input-${r.id}`,`comment-list-${r.id}`));
    panel.querySelector(`#comment-input-${r.id}`)?.addEventListener('keydown',e=>{
      if(e.key==='Enter') postComment(r.id,`comment-input-${r.id}`,`comment-list-${r.id}`);
    });
  });
}

async function loadRunComments(runId) {
  if (!sb) return;
  const listEl=document.getElementById(`comment-list-${runId}`);
  if (!listEl) return;
  const {data}=await sb.from('run_comment')
    .select('id,content,created_at,profile(username,display_name,avatar_url)')
    .eq('run_id',runId).order('created_at').limit(20);
  if (!data?.length) { listEl.innerHTML='<p style="font-size:.75rem;color:var(--text-3)">No comments yet.</p>'; return; }
  listEl.innerHTML=data.map(c=>{
    const prof=c.profile||{}; const name=prof.display_name||prof.username||'Player';
    return `<div class="comment-item">
      ${avatarHtml(prof,28)}
      <div class="comment-body">
        <span class="comment-author">${escHtml(name)}</span>
        <span class="comment-when"> · ${timeAgo(new Date(c.created_at))}</span>
        <p class="comment-text">${escHtml(c.content)}</p>
      </div>
    </div>`;
  }).join('');
}

async function postComment(runId,inputId,listId) {
  if (!currentProfile) { openAuthModal(); return; }
  const input=document.getElementById(inputId);
  const text=input?.value.trim();
  if (!text||!sb) return;
  input.value='';
  await sb.from('run_comment').insert({run_id:runId,author_id:currentProfile.id,content:text});
  loadRunComments(runId);
}

async function loadCourtPhotos(loc,panel) {
  panel.innerHTML='<h5>Court photos</h5><p class="loading-msg" style="padding:12px">Loading...</p>';
  if (!sb) return;
  const {data}=await sb.from('court_photo').select('id,url,caption').eq('location_id',loc.id).order('created_at',{ascending:false}).limit(12);
  let html='<h5>Court photos</h5><div class="court-photos-strip">';
  if (data?.length) {
    html+=data.map(p=>`<img class="court-photo-thumb" src="${escHtml(p.url)}" alt="${escHtml(p.caption||'')}${p.caption?'" title="'+escHtml(p.caption):''}">`).join('');
  }
  html+=`<label class="court-photo-add" for="court-photo-${loc.id}">
    <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
    Add photo
    <input type="file" id="court-photo-${loc.id}" accept="image/*" style="display:none" data-loc="${loc.id}">
  </label></div>`;
  panel.innerHTML=html;
  document.getElementById(`court-photo-${loc.id}`)?.addEventListener('change',e=>uploadCourtPhoto(e,loc));
}

async function uploadCourtPhoto(e,loc) {
  const file=e.target.files[0];
  if (!file||!currentProfile||!sb) return;
  showBanner('Uploading photo...',false);
  const ext=file.name.split('.').pop();
  const path=`courts/${loc.id}/${Date.now()}.${ext}`;
  const {error:upErr}=await sb.storage.from('media').upload(path,file);
  if (upErr) { showBanner('Upload failed: '+upErr.message,true); return; }
  const {data:{publicUrl}}=sb.storage.from('media').getPublicUrl(path);
  await sb.from('court_photo').insert({location_id:loc.id,author_id:currentProfile.id,url:publicUrl});
  showBanner('Photo added!',false);
  const panel=document.getElementById(`expand-${loc.id}`);
  if (panel) loadCourtPhotos(loc,panel);
}

// ── Court Detail Page ─────────────────────────────────────
let activeDetailLoc = null;

function openCourtDetail(locId) {
  if (!allLocations.length) { loadCourts(false).then(()=>openCourtDetail(locId)); return; }
  const loc = allLocations.find(l => l.id === locId);
  if (!loc) return;
  activeDetailLoc = loc;

  document.getElementById('cd-name').textContent = loc.name;
  const favBtn = document.getElementById('cd-fav');
  const isFav  = userFavorites.has(locId);
  favBtn.classList.toggle('fav-active', isFav);
  favBtn.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
  document.getElementById('cd-body').scrollTop = 0;
  document.getElementById('court-detail').classList.remove('hidden');

  loadCdPhotos(loc);
  renderCdInfo(loc);
  loadCdConditions(loc);
  loadCdRuns(loc);
}

document.getElementById('cd-back')?.addEventListener('click', () => {
  document.getElementById('court-detail').classList.add('hidden');
  activeDetailLoc = null;
});
document.getElementById('cd-fav')?.addEventListener('click', e => {
  if (!activeDetailLoc) return;
  toggleFavorite(activeDetailLoc.id, e.currentTarget);
  const isFav = userFavorites.has(activeDetailLoc.id);
  e.currentTarget.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
});
document.getElementById('cd-create-run')?.addEventListener('click', () => {
  document.getElementById('court-detail').classList.add('hidden');
  if (activeDetailLoc) jumpToCreateRun(activeDetailLoc.id);
});
document.getElementById('cd-rate-btn')?.addEventListener('click', () => {
  if (!activeDetailLoc) return;
  if (!currentProfile) { openAuthModal(); return; }
  const runsEl = document.getElementById('cd-runs');
  // Scroll to rating section or open inline
  const existing = document.getElementById(`rating-${activeDetailLoc.id}`);
  if (existing) { existing.scrollIntoView({behavior:'smooth'}); return; }
  // Append rating panel below runs
  const panel = document.createElement('div');
  panel.id = `cd-rate-panel`;
  runsEl.parentElement.appendChild(panel);
  openCourtRatingPanel(activeDetailLoc, panel);
  panel.scrollIntoView({behavior:'smooth'});
});
document.getElementById('cd-add-photo')?.addEventListener('click', () => {
  if (!currentProfile) { openAuthModal(); return; }
  document.getElementById('cd-photo-input').click();
});
document.getElementById('cd-photo-input')?.addEventListener('change', async e => {
  if (!activeDetailLoc) return;
  const fakePanel = { innerHTML: '' };
  await uploadCourtPhoto(e, activeDetailLoc);
  loadCdPhotos(activeDetailLoc);
});

async function loadCdPhotos(loc) {
  const el = document.getElementById('cd-photos');
  if (!el || !sb) return;
  const { data } = await sb.from('court_photo').select('url,caption').eq('location_id', loc.id).order('created_at',{ascending:false}).limit(20);
  if (!data?.length) {
    el.innerHTML = '<div class="cd-photos-empty">No photos yet — tap Photo below to add the first one</div>';
    return;
  }
  el.innerHTML = data.map(p =>
    `<div class="cd-photo-item"><img src="${escHtml(p.url)}" alt="${escHtml(p.caption||loc.name)}" loading="lazy"></div>`
  ).join('');
}

function renderCdInfo(loc) {
  const el = document.getElementById('cd-info');
  if (!el) return;
  const dist = userLat !== null ? `<span class="cd-distance">${haversine(userLat,userLon,loc.lat,loc.lon).toFixed(1)} mi away</span>` : '';
  const tags = (loc.sports||[]).map(s => { const m=VENUE_META[s]||{label:s,cls:''}; return `<span class="venue-tag ${m.cls}">${m.label}</span>`; }).join('');
  const rObj = courtRatings[loc.id];
  const ratingHtml = rObj
    ? `<div class="cd-rating-row">${starsHtml(rObj.avg, rObj.count)}</div>`
    : '<div class="cd-rating-row no-rating">No ratings yet — be the first</div>';

  el.innerHTML = `
    <div class="cd-info-row">
      <div>
        <h2 class="cd-info-name">${escHtml(loc.name)}</h2>
        <p class="cd-info-city">
          <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${loc.city||'Montgomery County'}, MD ${loc.zip?'· '+loc.zip:''}
        </p>
        ${ratingHtml}
        ${dist}
      </div>
      <div class="cd-venue-tags">${tags}</div>
    </div>`;
}

async function loadCdConditions(loc) {
  const el = document.getElementById('cd-conditions');
  if (!el || !sb) return;
  const { data } = await sb.from('court_rating').select('conditions,rating').eq('location_id', loc.id);
  if (!data?.length) { el.innerHTML = '<span class="cd-empty-note">No conditions reported yet. Rate this court to help others!</span>'; return; }

  // Aggregate conditions by key
  const agg = {};
  data.forEach(r => {
    if (!r.conditions) return;
    Object.entries(r.conditions).forEach(([k, v]) => {
      if (!agg[k]) agg[k] = {};
      if (Array.isArray(v)) { v.forEach(item => { agg[k][item] = (agg[k][item]||0)+1; }); }
      else { agg[k][v] = (agg[k][v]||0)+1; }
    });
  });

  const KEY_LABELS = { surface:'Surface', hoops:'Hoops', lighting:'Lighting', parking:'Parking', extras:'Extras' };
  const condHtml = Object.entries(agg).map(([key, vals]) => {
    const top = Object.entries(vals).sort((a,b)=>b[1]-a[1]).slice(0,3);
    const chips = top.map(([val,cnt]) => `<span class="cond-result-chip">${escHtml(val)} <em>${cnt}</em></span>`).join('');
    return `<div class="cd-cond-row"><span class="cd-cond-key">${KEY_LABELS[key]||key}</span><div class="cond-result-chips">${chips}</div></div>`;
  }).join('');

  el.innerHTML = condHtml || '<span class="cd-empty-note">No conditions data yet.</span>';
}

async function loadCdRuns(loc) {
  const el = document.getElementById('cd-runs');
  if (!el || !sb) return;
  el.innerHTML = '<p class="loading-msg">Loading runs...</p>';

  const now = new Date().toISOString();
  const { data: runs } = await sb.from('run')
    .select('id,sport,scheduled_at,going_count,needed_count,notes,privacy,creator_id')
    .eq('location_id', loc.id).gte('scheduled_at', now)
    .order('scheduled_at').limit(30);

  // Fetch creator profiles separately to avoid FK hint issues
  const creatorIds = [...new Set((runs||[]).map(r=>r.creator_id).filter(Boolean))];
  const creatorMap = {};
  if (creatorIds.length && sb) {
    const { data: profs } = await sb.from('profile').select('id,username,display_name,avatar_url').in('id', creatorIds);
    (profs||[]).forEach(p => { creatorMap[p.id] = p; });
  }
  (runs||[]).forEach(r => { r.profile = creatorMap[r.creator_id] || {}; });

  if (!runs?.length) {
    el.innerHTML = `<div class="cd-empty-note">No upcoming runs. <button class="link-btn" onclick="document.getElementById('cd-create-run').click()">Post one!</button></div>`;
    return;
  }

  // Load RSVPs
  const runIds = runs.map(r => r.id);
  const { data: rsvps } = await sb.from('run_rsvp')
    .select('run_id,guests,user_id,profile(username,display_name,avatar_url)')
    .in('run_id', runIds);

  const rsvpMap = {};
  (rsvps||[]).forEach(r => {
    if (!rsvpMap[r.run_id]) rsvpMap[r.run_id] = [];
    rsvpMap[r.run_id].push(r);
  });

  // Filter by privacy
  const visible = runs.filter(r => {
    if (r.privacy === 'public') return true;
    if (!currentProfile) return false;
    if (r.creator_id === currentProfile.id) return true;
    return (rsvpMap[r.id]||[]).some(rv => rv.user_id === currentProfile.id);
  });

  if (!visible.length) { el.innerHTML='<div class="cd-empty-note">No public runs right now.</div>'; return; }

  // Group public runs into 45-min windows; private/friends stay separate
  const publicRuns  = visible.filter(r => r.privacy === 'public');
  const privateRuns = visible.filter(r => r.privacy !== 'public');
  const timeGroups  = groupRunsByTime(publicRuns, 45);

  el.innerHTML = '';

  // Render public groups
  timeGroups.forEach(group => {
    const d      = new Date(group.time);
    const ds     = d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
    const ts     = d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    const allRsvp= group.runs.flatMap(r => rsvpMap[r.id]||[]);
    const totalGoers = group.runs.reduce((s,r) => {
      const rsvpCount = (rsvpMap[r.id]||[]).reduce((a,rv) => a+1+(rv.guests||0),0);
      return s + Math.max(r.going_count||0, rsvpCount);
    }, 0);
    const needed = group.runs[0]?.needed_count;
    const sports = [...new Set(group.runs.map(r=>r.sport))].join(' / ');

    const groupEl = document.createElement('div');
    groupEl.className = 'run-time-group';
    groupEl.innerHTML = `
      <div class="run-time-header" data-open="false">
        <div class="run-time-left">
          <div class="run-time-label">${ds} · ${ts}</div>
          <div class="run-time-meta">${escHtml(sports)} · ${totalGoers}${needed?'/'+needed:''} going</div>
        </div>
        <svg class="run-time-chevron" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="run-time-body hidden">
        ${group.runs.map(r => renderRunCard(r, rsvpMap[r.id]||[], false)).join('')}
      </div>`;

    groupEl.querySelector('.run-time-header').addEventListener('click', e => {
      const header = e.currentTarget;
      const body   = groupEl.querySelector('.run-time-body');
      const isOpen = header.dataset.open === 'true';
      header.dataset.open = String(!isOpen);
      body.classList.toggle('hidden', isOpen);
      groupEl.querySelector('.run-time-chevron').style.transform = isOpen ? '' : 'rotate(180deg)';
    });

    el.appendChild(groupEl);
  });

  // Render private/friends runs
  privateRuns.forEach(r => {
    const groupEl = document.createElement('div');
    groupEl.className = 'run-time-group';
    const d  = new Date(r.scheduled_at);
    const ds = d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
    const ts = d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    groupEl.innerHTML = `
      <div class="run-time-header" data-open="false">
        <div class="run-time-left">
          <div class="run-time-label">
            <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none" stroke-width="2" style="vertical-align:middle;margin-right:4px"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            ${ds} · ${ts}
          </div>
          <div class="run-time-meta">${escHtml(r.sport)} · ${r.privacy === 'friends' ? 'Friends only' : 'Private'}</div>
        </div>
        <svg class="run-time-chevron" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="run-time-body hidden">
        ${renderRunCard(r, rsvpMap[r.id]||[], true)}
      </div>`;
    groupEl.querySelector('.run-time-header').addEventListener('click', e => {
      const header = e.currentTarget;
      const body   = groupEl.querySelector('.run-time-body');
      const isOpen = header.dataset.open === 'true';
      header.dataset.open = String(!isOpen);
      body.classList.toggle('hidden', isOpen);
      groupEl.querySelector('.run-time-chevron').style.transform = isOpen ? '' : 'rotate(180deg)';
    });
    el.appendChild(groupEl);
  });

  // Wire RSVP buttons
  el.querySelectorAll('.rsvp-btn').forEach(btn => {
    btn.addEventListener('click', () => rsvpToRun(btn.dataset.run, btn));
  });
  el.querySelectorAll('.rsvp-guests').forEach(sel => {
    sel.addEventListener('change', () => {
      const runId = sel.dataset.run;
      const btn   = el.querySelector(`.rsvp-btn[data-run="${runId}"]`);
      if (btn && btn.classList.contains('going')) rsvpToRun(runId, btn, parseInt(sel.value));
    });
  });

  // Wire comment toggles
  el.querySelectorAll('.comments-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const runId   = btn.dataset.run;
      const section = document.getElementById(`rci-${runId}`);
      if (!section) return;
      const isHidden = section.classList.contains('hidden');
      section.classList.toggle('hidden', !isHidden);
      if (isHidden) loadRunCommentsInline(runId);
    });
  });
  el.querySelectorAll('.rci-send').forEach(btn => {
    const runId = btn.dataset.run;
    btn.addEventListener('click', () => postCommentInline(runId));
    document.getElementById(`rci-input-${runId}`)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') postCommentInline(runId);
    });
  });
}

async function loadRunCommentsInline(runId) {
  const listEl = document.getElementById(`rcl-${runId}`);
  if (!listEl || !sb) return;
  listEl.innerHTML = '<p style="font-size:.75rem;color:var(--text-3)">Loading...</p>';
  const { data } = await sb.from('run_comment')
    .select('id,content,created_at,profile(username,display_name,avatar_url)')
    .eq('run_id', runId).order('created_at').limit(30);
  if (!data?.length) { listEl.innerHTML = '<p style="font-size:.75rem;color:var(--text-3)">No comments yet.</p>'; return; }
  listEl.innerHTML = data.map(c => {
    const prof = c.profile||{}; const name = prof.display_name||prof.username||'Player';
    return `<div class="comment-item">
      ${avatarHtml(prof,26)}
      <div class="comment-body">
        <span class="comment-author">${escHtml(name)}</span>
        <span class="comment-when"> · ${timeAgo(new Date(c.created_at))}</span>
        <p class="comment-text">${escHtml(c.content)}</p>
      </div>
    </div>`;
  }).join('');
}

async function postCommentInline(runId) {
  if (!currentProfile) { openAuthModal(); return; }
  const input = document.getElementById(`rci-input-${runId}`);
  const text  = input?.value.trim();
  if (!text || !sb) return;
  input.value = '';
  const { error } = await sb.from('run_comment').insert({ run_id: runId, author_id: currentProfile.id, content: text });
  if (error) { showBanner(error.message, true); return; }
  loadRunCommentsInline(runId);
}

function renderRunCard(run, rsvps, isPrivate) {
  const creator = run.profile||{};
  const totalRsvp = rsvps.reduce((s,rv) => s+1+(rv.guests||0), 0);
  const going  = Math.max(run.going_count||0, totalRsvp);
  const needed = run.needed_count ? `/${run.needed_count}` : '';
  const isGoing = currentProfile && rsvps.some(rv => rv.user_id === currentProfile.id);

  // Avatar stack
  const avatarStack = rsvps.slice(0,5).map(rv => {
    const p = rv.profile||{}; const name = p.display_name||p.username||'?';
    return p.avatar_url
      ? `<img class="rsvp-avatar" src="${escHtml(p.avatar_url)}" title="${escHtml(name)}" alt="${escHtml(name)}">`
      : `<div class="rsvp-avatar initials">${(name[0]||'?').toUpperCase()}</div>`;
  }).join('');

  const rsvpRows = rsvps.map(rv => {
    const p = rv.profile||{}; const name = p.display_name||p.username||'Player';
    const guests = rv.guests ? `<span class="rsvp-guests-badge">+${rv.guests}</span>` : '';
    const isMe   = currentProfile && rv.user_id === currentProfile.id;
    return `<div class="rsvp-person${isMe?' me':''}">${avatarHtml(p,24)}<span>${escHtml(name)}${isMe?' (you)':''}</span>${guests}</div>`;
  }).join('');

  const myRsvp = rsvps.find(rv => currentProfile && rv.user_id === currentProfile.id);

  return `<div class="run-detail-card${isPrivate?' private-run':''}">
    <div class="run-detail-top">
      <div>
        <span class="run-sport-badge">${escHtml(run.sport)}</span>
        ${run.notes?`<p class="run-notes">${escHtml(run.notes)}</p>`:''}
      </div>
      <div class="run-going-count">${going}${needed} <span>going</span></div>
    </div>
    <div class="run-organizer">
      ${avatarHtml(creator,20)}
      <span>Organized by <strong>${escHtml(creator.display_name||creator.username||'Player')}</strong></span>
    </div>
    ${rsvps.length ? `<div class="rsvp-avatar-stack">${avatarStack}${rsvps.length>5?`<div class="rsvp-avatar initials">+${rsvps.length-5}</div>`:''}</div>` : ''}
    ${rsvpRows ? `<div class="rsvp-list">${rsvpRows}</div>` : ''}
    <div class="rsvp-bar">
      <button class="rsvp-btn${isGoing?' going':''}" data-run="${run.id}">${isGoing?'✓ Going':"I'm going"}</button>
      ${isGoing ? `<select class="rsvp-guests" data-run="${run.id}">
        <option value="0"${!myRsvp?.guests?' selected':''}>Just me</option>
        <option value="1"${myRsvp?.guests===1?' selected':''}>+1</option>
        <option value="2"${myRsvp?.guests===2?' selected':''}>+2</option>
        <option value="3"${myRsvp?.guests===3?' selected':''}>+3</option>
      </select>` : ''}
    </div>
    <div class="run-comments-row">
      <button class="comments-toggle-btn" data-run="${run.id}">
        <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        Comments
      </button>
    </div>
    <div class="rci hidden" id="rci-${run.id}">
      <div class="comment-list" id="rcl-${run.id}"></div>
      <div class="rci-form">
        <input type="text" id="rci-input-${run.id}" placeholder="Add a comment..." class="rci-input">
        <button class="rci-send" data-run="${run.id}">
          <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>
  </div>`;
}

async function rsvpToRun(runId, btn, guests = 0) {
  if (!currentProfile) { openAuthModal(); return; }
  if (!sb) return;
  const isGoing = btn.classList.contains('going');
  btn.disabled = true;

  if (isGoing) {
    const { error } = await sb.from('run_rsvp').delete().eq('run_id', runId).eq('user_id', currentProfile.id);
    if (error) { showBanner(error.message, true); btn.disabled = false; return; }
  } else {
    const { error } = await sb.from('run_rsvp').upsert(
      { run_id: runId, user_id: currentProfile.id, guests, status: 'going' },
      { onConflict: 'run_id,user_id' }
    );
    if (error) { showBanner(error.message, true); btn.disabled = false; return; }
  }

  btn.disabled = false;
  // Refresh the runs section so RSVP list updates live
  if (activeDetailLoc) loadCdRuns(activeDetailLoc);
}

function groupRunsByTime(runs, windowMin = 45) {
  const groups = [];
  const windowMs = windowMin * 60 * 1000;
  runs.forEach(run => {
    const t = new Date(run.scheduled_at).getTime();
    const group = groups.find(g => Math.abs(g.time - t) <= windowMs);
    if (group) { group.runs.push(run); }
    else { groups.push({ time: t, runs: [run] }); }
  });
  return groups.sort((a, b) => a.time - b.time);
}

// Make court cards clickable → detail page
// (called in renderCourts below via data-loc attribute on h4)

// ── Add Location ─────────────────────────────────────────
let addLocPhotos = []; // File[]
let addLocLat = null, addLocLon = null;

document.getElementById('add-location-btn')?.addEventListener('click', () => {
  if (!currentProfile) { openAuthModal(); return; }
  document.getElementById('add-location-modal').classList.remove('hidden');
  addLocPhotos = []; addLocLat = null; addLocLon = null;
  document.getElementById('add-loc-photo-preview').innerHTML = '';
  document.getElementById('add-loc-form').reset();
  document.getElementById('add-loc-msg').classList.add('hidden');
  document.getElementById('add-loc-coords').textContent = '';
});
document.getElementById('add-location-modal')?.addEventListener('click', e => {
  if (e.target.id === 'add-location-modal') document.getElementById('add-location-modal').classList.add('hidden');
});
document.getElementById('add-loc-close')?.addEventListener('click', () => {
  document.getElementById('add-location-modal').classList.add('hidden');
});

document.getElementById('add-loc-use-location')?.addEventListener('click', () => {
  const btn = document.getElementById('add-loc-use-location');
  btn.textContent = 'Getting location...'; btn.disabled = true;
  navigator.geolocation?.getCurrentPosition(pos => {
    addLocLat = pos.coords.latitude; addLocLon = pos.coords.longitude;
    document.getElementById('add-loc-coords').textContent = `${addLocLat.toFixed(5)}, ${addLocLon.toFixed(5)}`;
    btn.textContent = 'Location captured'; btn.disabled = false;
  }, () => { btn.textContent = 'Use my location'; btn.disabled = false; showBanner('Location unavailable.',true); });
});

document.getElementById('add-loc-photos')?.addEventListener('change', e => {
  const files = Array.from(e.target.files);
  addLocPhotos = [...addLocPhotos, ...files].slice(0, 6);
  renderAddLocPreviews();
});

function renderAddLocPreviews() {
  const wrap = document.getElementById('add-loc-photo-preview');
  wrap.innerHTML = addLocPhotos.map((f,i) => {
    const url = URL.createObjectURL(f);
    return `<div class="add-loc-thumb" style="background-image:url('${url}')">
      <button class="add-loc-thumb-rm" data-i="${i}">&times;</button>
    </div>`;
  }).join('');
  wrap.querySelectorAll('.add-loc-thumb-rm').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      addLocPhotos.splice(parseInt(btn.dataset.i), 1);
      renderAddLocPreviews();
    });
  });
}

document.getElementById('add-loc-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const msgEl  = document.getElementById('add-loc-msg');
  const submit = document.getElementById('add-loc-submit');
  const name      = document.getElementById('add-loc-name').value.trim();
  const siteType  = document.getElementById('add-loc-type').value;
  const address   = document.getElementById('add-loc-address').value.trim();
  const isOutdoor = document.getElementById('add-loc-outdoor').checked;
  const notes     = document.getElementById('add-loc-notes').value.trim() || null;
  const venueTypes = [...document.querySelectorAll('input[name="add-loc-venue"]:checked')].map(el => el.value);

  // Collect conditions
  const conditions = {};
  ['surface','hoops','lighting','parking'].forEach(key => {
    const checked = document.querySelector(`input[name="sub-${key}"]:checked`);
    if (checked) conditions[key] = checked.value;
  });
  const extras = [...document.querySelectorAll('input[name="sub-extras"]:checked')].map(el => el.value);
  if (extras.length) conditions.extras = extras;

  // Collect good run times
  const goodRunDays  = [...document.querySelectorAll('input[name="sub-days"]:checked')].map(el => el.value);
  const goodRunTimes = [...document.querySelectorAll('input[name="sub-times"]:checked')].map(el => el.value);

  if (!name)             { showMsg(msgEl,'Name is required.',true); return; }
  if (!siteType)         { showMsg(msgEl,'Select a site type.',true); return; }
  if (!address)          { showMsg(msgEl,'Address is required.',true); return; }
  if (!venueTypes.length){ showMsg(msgEl,'Select at least one venue type.',true); return; }
  if (!isOutdoor)        { showMsg(msgEl,'Only outdoor locations can be added here. For indoor, create a run and add the location there.',true); return; }
  if (!addLocPhotos.length){ showMsg(msgEl,'At least one photo is required.',true); return; }

  // Geocode address via Nominatim if no GPS coords
  if (!addLocLat && address) {
    try {
      const res  = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address+', Montgomery County, MD')}&format=json&limit=1`);
      const json = await res.json();
      if (json[0]) { addLocLat = parseFloat(json[0].lat); addLocLon = parseFloat(json[0].lon); }
    } catch {}
  }

  submit.disabled = true; submit.textContent = 'Uploading photos...';

  // Upload photos
  const photoUrls = [];
  for (const file of addLocPhotos) {
    const ext  = file.name.split('.').pop();
    const path = `loc-submissions/${currentProfile.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: upErr } = await sb.storage.from('media').upload(path, file);
    if (!upErr) photoUrls.push(sb.storage.from('media').getPublicUrl(path).data.publicUrl);
  }

  submit.textContent = 'Submitting...';
  const { error } = await sb.from('location_submission').insert({
    submitted_by:  currentProfile.id,
    name, site_type: siteType, address,
    lat:          addLocLat, lon: addLocLon,
    venue_types:  venueTypes,
    is_outdoor:   true,
    notes,
    photo_urls:   photoUrls,
    conditions:   Object.keys(conditions).length ? conditions : null,
    good_run_times: (goodRunDays.length||goodRunTimes.length) ? { days: goodRunDays, times: goodRunTimes } : null,
    status:       'pending',
  });

  submit.disabled = false; submit.textContent = 'Submit Location';
  if (error) { showMsg(msgEl, error.message, true); }
  else {
    document.getElementById('add-location-modal').classList.add('hidden');
    showBanner('Thanks! We\'ll review and add your location soon.', false);
  }
});

function jumpToCreateRun(locId) {
  document.querySelector('[data-section="create"]')?.click();
  showCreateRun();
  setTimeout(async()=>{
    if (!locationDropdownList.length) await populateCreateForm();
    const entry=locationDropdownList.find(l=>l.id===locId);
    if (entry) {
      document.getElementById('run-location-input').value=entry.label;
      document.getElementById('run-location').value=locId;
      updateSportHint();
    }
  },100);
}

function detectLocation() {
  const statusEl=document.getElementById('location-status');
  if (!navigator.geolocation) {
    if(statusEl) statusEl.textContent='Montgomery County, MD';
    document.getElementById('distance-filter-section')?.remove();
    loadCourts(); return;
  }
  navigator.geolocation.getCurrentPosition(
    pos=>{ userLat=pos.coords.latitude; userLon=pos.coords.longitude; if(statusEl) statusEl.textContent='Sorted by distance'; loadCourts(); },
    ()=>{ if(statusEl) statusEl.textContent='Montgomery County, MD'; document.getElementById('distance-filter-section')?.remove(); loadCourts(); },
    {timeout:8000}
  );
}

// ── Location + Sport dropdowns ───────────────────────────
let locationDropdownBound=false;

async function populateCreateForm() {
  if (!allLocations.length) await fetchLocations();
  if (!locationDropdownList.length) {
    const sorted=userLat!==null
      ?[...allLocations].sort((a,b)=>haversine(userLat,userLon,a.lat,a.lon)-haversine(userLat,userLon,b.lat,b.lon))
      :allLocations;
    locationDropdownList=sorted.map(loc=>{
      const dist=userLat!==null?` · ${haversine(userLat,userLon,loc.lat,loc.lon).toFixed(1)} mi`:'';
      return {id:loc.id,label:loc.name+(loc.city?` — ${loc.city}`:'')+dist};
    });
  }
  const dateEl=document.getElementById('run-date');
  if (dateEl&&!dateEl.value) dateEl.value=new Date().toISOString().split('T')[0];
  if (!locationDropdownBound) {
    locationDropdownBound=true;
    bindDropdown('run-location-input','location-dropdown',locationDropdownList,
      item=>{ document.getElementById('run-location').value=item.id; updateSportHint(); });
  }
}

function bindDropdown(inputId,dropId,items,onSelect) {
  const input=document.getElementById(inputId);
  const dd=document.getElementById(dropId);
  if (!input||!dd) return;
  function build(filter='') {
    const lower=filter.toLowerCase();
    const list=filter?items.filter(i=>i.label.toLowerCase().includes(lower)):items;
    if (!list.length) { dd.classList.add('hidden'); return; }
    dd.innerHTML=list.map(i=>`<div class="sport-option" data-id="${i.id||''}" data-label="${escHtml(i.label||i)}">${escHtml(i.label||i)}</div>`).join('');
    dd.classList.remove('hidden');
    dd.querySelectorAll('.sport-option').forEach(opt=>{
      opt.addEventListener('mousedown',e=>{
        e.preventDefault();
        input.value=opt.dataset.label;
        dd.classList.add('hidden');
        onSelect(opt.dataset.id?{id:opt.dataset.id,label:opt.dataset.label}:opt.dataset.label);
      });
    });
  }
  input.addEventListener('input',e=>{ build(e.target.value); if(onSelect&&inputId==='run-location-input') document.getElementById('run-location').value=''; });
  input.addEventListener('focus',e=>build(e.target.value));
  input.addEventListener('blur',()=>setTimeout(()=>dd.classList.add('hidden'),150));
}

function buildSportDropdown(filter='') {
  const dd=document.getElementById('sport-dropdown');
  if (!dd) return;
  const lower=filter.toLowerCase();
  const filtered=filter?ALL_SPORTS.filter(s=>s.toLowerCase().includes(lower)):ALL_SPORTS;
  if (!filtered.length) { dd.classList.add('hidden'); return; }
  dd.innerHTML=filtered.map(s=>`<div class="sport-option" data-val="${escHtml(s)}">${escHtml(s)}</div>`).join('');
  dd.classList.remove('hidden');
  dd.querySelectorAll('.sport-option').forEach(opt=>{
    opt.addEventListener('mousedown',e=>{
      e.preventDefault();
      document.getElementById('run-sport-input').value=opt.dataset.val;
      dd.classList.add('hidden');
    });
  });
}
document.getElementById('run-sport-input')?.addEventListener('input',e=>buildSportDropdown(e.target.value));
document.getElementById('run-sport-input')?.addEventListener('focus',e=>buildSportDropdown(e.target.value));
document.getElementById('run-sport-input')?.addEventListener('blur',()=>setTimeout(()=>document.getElementById('sport-dropdown')?.classList.add('hidden'),150));

function updateSportHint() {
  const locId=document.getElementById('run-location')?.value;
  const hint=document.getElementById('sport-hint');
  if (!hint||!locId) { hint?.classList.add('hidden'); return; }
  const loc=allLocations.find(l=>l.id===locId);
  if (!loc) { hint.classList.add('hidden'); return; }
  const sports=[...new Set(loc.sports.flatMap(v=>SPORTS_BY_VENUE[v]||[]))];
  if (sports.length) { hint.textContent='Common here: '+sports.join(', '); hint.classList.remove('hidden'); }
}

// Create Run submit
document.getElementById('create-run-form')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const msgEl=document.getElementById('create-run-msg');
  const submit=document.getElementById('create-run-submit');
  const locId=document.getElementById('run-location').value;
  const sport=document.getElementById('run-sport-input').value.trim();
  const date=document.getElementById('run-date').value;
  const time=document.getElementById('run-time').value;
  const going=parseInt(document.getElementById('run-going').value)||1;
  const needed=document.getElementById('run-needed').value?parseInt(document.getElementById('run-needed').value):null;
  const privacy=document.querySelector('input[name="privacy"]:checked')?.value||'public';
  const notes=document.getElementById('run-notes').value.trim()||null;
  const notify=document.getElementById('run-notify')?.checked;

  if (!locId)         { showMsg(msgEl,'Select a location.',true); return; }
  if (!sport)         { showMsg(msgEl,'Enter a sport or activity.',true); return; }
  if (!date||!time)   { showMsg(msgEl,'Add date and time.',true); return; }

  if (notify&&'Notification'in window&&Notification.permission==='default') {
    await Notification.requestPermission();
  }
  submit.disabled=true; submit.textContent='Posting...';
  const scheduled_at=new Date(`${date}T${time}`).toISOString();
  const {error}=await sb.from('run').insert({location_id:locId,sport,scheduled_at,going_count:going,needed_count:needed,privacy,notes,creator_id:currentProfile?.id||null});
  submit.disabled=false; submit.textContent='Post Run';
  if (error) { showMsg(msgEl,error.message,true); }
  else {
    showMsg(msgEl,'Run posted! It will appear on the map.',false);
    if (notify&&Notification.permission==='granted') {
      new Notification('ImThere — Run posted!',{body:`${sport} is live on the map.`});
    }
    e.target.reset();
    document.getElementById('run-sport-input').value='';
    document.getElementById('run-location-input').value='';
    document.getElementById('run-going').value=1;
    document.querySelector('input[name="privacy"][value="public"]').checked=true;
    document.getElementById('sport-hint')?.classList.add('hidden');
    courtCountsLoaded=false; courtRunCounts={};
    // Return to choice screen after success
    setTimeout(() => showCreateChoice(), 1500);
  }
});

// ── Map ──────────────────────────────────────────────────
async function initMap() {
  if (mapInitialized) return;
  mapInitialized=true;
  const mapEl=document.getElementById('leaflet-map');
  if (!mapEl) return;
  const map=L.map(mapEl,{zoomControl:false}).setView([39.15,-77.2],11);
  leafletMap=map;
  L.control.zoom({position:'bottomright'}).addTo(map);

  // CartoDB Voyager — clean, professional tiles
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{
    attribution:'© <a href="https://www.openstreetmap.org">OpenStreetMap</a> © <a href="https://carto.com">CARTO</a>',
    maxZoom:19,
  }).addTo(map);

  if (!allLocations.length) await fetchLocations();
  if (!allLocations.length) return;

  let countMap={};
  if (sb) {
    const {data:runs}=await sb.from('run').select('location_id').gte('scheduled_at',new Date().toISOString());
    (runs||[]).forEach(r=>{countMap[r.location_id]=(countMap[r.location_id]||0)+1;});
  }

  allLocations.forEach(loc=>{
    if (!loc.lat||!loc.lon) return;
    const runs=countMap[loc.id]||0;
    const pinHtml=`<div class="map-pin${runs>0?' active':''}"><span>${runs>0?runs:''}</span></div>`;
    const icon=L.divIcon({html:pinHtml,className:'',iconSize:[30,36],iconAnchor:[15,36],popupAnchor:[0,-38]});
    const marker=L.marker([loc.lat,loc.lon],{icon}).addTo(map);
    const venueLabels=(loc.sports||[]).map(s=>VENUE_META[s]?.label||s).join(', ')||'Court';
    marker.bindPopup(`
      <div style="min-width:200px">
        <div class="map-popup-title">${escHtml(loc.name)}</div>
        <div class="map-popup-sub">${loc.city||'Montgomery County'}, MD · ${venueLabels}</div>
        <div class="map-popup-runs">${runs>0?`<strong>${runs}</strong> upcoming run${runs>1?'s':''}`:'No runs yet'}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="map-popup-btn" style="flex:1" onclick="window.__openDetail('${loc.id}')">View Court</button>
          <button class="map-popup-btn" style="flex:1;background:var(--surface);color:var(--brand);border:1.5px solid var(--brand)" onclick="window.__jumpCreate('${loc.id}')">+ Run</button>
        </div>
      </div>`,{maxWidth:250});
  });

  window.__jumpCreate=locId=>jumpToCreateRun(locId);
  window.__openDetail=locId=>openCourtDetail(locId);

  if (userLat!==null) {
    const youIcon=L.divIcon({
      html:'<div style="width:16px;height:16px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3)"></div>',
      className:'',iconSize:[16,16],iconAnchor:[8,8]
    });
    L.marker([userLat,userLon],{icon:youIcon}).addTo(map).bindPopup('You');
    map.setView([userLat,userLon],13);
  }
}

// ── DMs ──────────────────────────────────────────────────
async function loadDmList() {
  if (!currentProfile||!sb) {
    document.getElementById('dm-conv-list').innerHTML=`<div class="dm-empty"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><p>Sign in to view messages.</p></div>`;
    return;
  }
  const uid=currentProfile.id;
  // Get all DMs where I'm sender or receiver
  const {data,error}=await sb.from('dm')
    .select('id,content,created_at,sender_id,receiver_id,read_by_receiver,sender:profile!dm_sender_id_fkey(username,display_name,avatar_url),receiver:profile!dm_receiver_id_fkey(username,display_name,avatar_url)')
    .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
    .order('created_at',{ascending:false}).limit(100);

  if (error) { console.error('DM list error',error); return; }

  // Group into conversations by the OTHER user
  const convMap={};
  (data||[]).forEach(msg=>{
    const otherId=msg.sender_id===uid?msg.receiver_id:msg.sender_id;
    const otherProf=msg.sender_id===uid?msg.receiver:msg.sender;
    if (!convMap[otherId]) convMap[otherId]={id:otherId,profile:otherProf,lastMsg:msg,unread:0};
    if (msg.receiver_id===uid&&!msg.read_by_receiver) convMap[otherId].unread++;
  });

  const convs=Object.values(convMap);
  const list=document.getElementById('dm-conv-list');
  if (!convs.length) {
    list.innerHTML=`<div class="dm-empty"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><p>No messages yet.<br>Search for a player above.</p></div>`;
    return;
  }
  list.innerHTML=convs.map(c=>{
    const p=c.profile||{}; const name=p.display_name||p.username||'Player';
    const preview=c.lastMsg.sender_id===uid?`You: ${c.lastMsg.content}`:c.lastMsg.content;
    const ago=timeAgo(new Date(c.lastMsg.created_at));
    return `<div class="dm-conv-item${c.unread?' unread':''}" data-uid="${c.id}" data-name="${escHtml(name)}">
      <div class="dm-conv-avatar">${p.avatar_url?`<img src="${escHtml(p.avatar_url)}">`:(name[0]||'?').toUpperCase()}</div>
      <div class="dm-conv-info">
        <div class="dm-conv-top"><span class="dm-conv-name">${escHtml(name)}</span><span class="dm-conv-time">${ago}</span></div>
        <div class="dm-conv-preview">${escHtml(preview.substring(0,60))}</div>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.dm-conv-item').forEach(item=>{
    item.addEventListener('click',()=>openDmThread(item.dataset.uid,item.dataset.name));
  });
}

// Start DM with username search
document.getElementById('dm-start-btn')?.addEventListener('click', startDm);
document.getElementById('dm-search-user')?.addEventListener('keydown',e=>{if(e.key==='Enter')startDm();});
async function startDm() {
  const q=document.getElementById('dm-search-user')?.value.trim().replace(/^@/,'');
  if (!q||!sb) return;
  if (!currentProfile) { openAuthModal(); return; }
  const {data}=await sb.from('profile').select('id,username,display_name').ilike('username',q).limit(1);
  if (!data?.length) { showBanner('Player not found.',true); return; }
  const p=data[0];
  document.getElementById('dm-search-user').value='';
  openDmThread(p.id,p.display_name||p.username);
}

function openDmThread(otherId,otherName) {
  activeDmUser={id:otherId,name:otherName};
  document.getElementById('dm-thread-name').textContent=otherName;
  document.getElementById('dm-thread-avatar').textContent=(otherName[0]||'?').toUpperCase();
  document.getElementById('dm-thread').classList.remove('hidden');
  loadDmMessages(otherId);
  if (dmPolling) clearInterval(dmPolling);
  dmPolling=setInterval(()=>loadDmMessages(otherId),8000);
}

document.getElementById('dm-back-btn')?.addEventListener('click',()=>{
  document.getElementById('dm-thread').classList.add('hidden');
  if (dmPolling) { clearInterval(dmPolling); dmPolling=null; }
  loadDmList();
});

async function loadDmMessages(otherId) {
  if (!currentProfile||!sb) return;
  const uid=currentProfile.id;
  const {data}=await sb.from('dm')
    .select('id,content,created_at,sender_id,read_by_receiver')
    .or(`and(sender_id.eq.${uid},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${uid})`)
    .order('created_at').limit(60);

  const msgs=document.getElementById('dm-messages');
  if (!msgs) return;
  const wasAtBottom=msgs.scrollTop+msgs.clientHeight>=msgs.scrollHeight-20;
  msgs.innerHTML=(data||[]).map(m=>{
    const mine=m.sender_id===uid;
    const t=new Date(m.created_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    return `<div class="dm-bubble-row${mine?' mine':''}">
      <div class="dm-bubble">${escHtml(m.content)}<div class="dm-bubble-time">${t}</div></div>
    </div>`;
  }).join('');
  if (wasAtBottom||true) msgs.scrollTop=msgs.scrollHeight;

  // Mark unread as read
  await sb.from('dm').update({read_by_receiver:true})
    .eq('receiver_id',uid).eq('sender_id',otherId).eq('read_by_receiver',false);
}

document.getElementById('dm-send-btn')?.addEventListener('click',sendDmMessage);
document.getElementById('dm-input')?.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendDmMessage();}
});
async function sendDmMessage() {
  const input=document.getElementById('dm-input');
  const text=input?.value.trim();
  if (!text||!activeDmUser||!currentProfile||!sb) return;
  input.value='';
  const {error}=await sb.from('dm').insert({sender_id:currentProfile.id,receiver_id:activeDmUser.id,content:text});
  if (error) { showBanner(error.message,true); return; }
  loadDmMessages(activeDmUser.id);
}

// ── App mockup ───────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab)?.classList.add('active');
  });
});
document.querySelectorAll('.join-btn').forEach(btn=>{
  if (btn.disabled) return;
  btn.addEventListener('click',()=>{
    if (btn.classList.contains('joined')) return;
    btn.textContent='Joined'; btn.classList.add('joined');
    const card=btn.closest('.run-card');
    if (card?.dataset.run) {
      document.getElementById('myruns-empty')?.classList.add('hidden');
      const el=document.createElement('div'); el.className='run-card';
      el.innerHTML=`<div class="run-info"><h3>${escHtml(card.dataset.run)}</h3><p class="run-meta">${escHtml(card.dataset.meta||'')}</p></div>`;
      document.getElementById('myruns-list')?.appendChild(el);
    }
  });
});
const chatData={
  pickup5v5chat:{title:'Pickup 5v5',messages:[{from:'DL',text:"who's in for 6:30?"},{from:'JN',text:"I'm coming"}]},
  morning3schat:{title:'Morning 3s',messages:[{from:'SW',text:'anyone else coming?'}]},
};
let activeChatId=null;
const chatThread=document.getElementById('chat-thread');
function renderChat(msgs){
  const el=document.getElementById('chat-messages');
  if (!el) return;
  el.innerHTML=msgs.map(m=>`<div class="chat-bubble${m.from==='You'?' me':''}">${m.from}: ${m.text}</div>`).join('');
  el.scrollTop=el.scrollHeight;
}
document.querySelectorAll('.chat-row').forEach(row=>{
  row.addEventListener('click',()=>{
    const chat=chatData[row.dataset.chat];
    if (!chat||!chatThread) return;
    activeChatId=row.dataset.chat;
    document.getElementById('chat-thread-title').textContent=chat.title;
    renderChat(chat.messages);
    chatThread.classList.remove('hidden');
  });
});
document.getElementById('chat-back')?.addEventListener('click',()=>chatThread?.classList.add('hidden'));
document.getElementById('chat-form')?.addEventListener('submit',e=>{
  e.preventDefault();
  const inp=document.getElementById('chat-input');
  const text=inp?.value.trim();
  if (!text||!activeChatId) return;
  chatData[activeChatId].messages.push({from:'You',text});
  renderChat(chatData[activeChatId].messages);
  if (inp) inp.value='';
});
document.getElementById('waitlist-btn')?.addEventListener('click',()=>{
  const email=document.getElementById('waitlist-email')?.value.trim();
  if (!email) return;
  document.getElementById('waitlist-msg')?.classList.remove('hidden');
  const el=document.getElementById('waitlist-email'); if(el) el.value='';
});

// ── Utils ────────────────────────────────────────────────
function haversine(lat1,lon1,lat2,lon2){
  const R=3958.8,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function showMsg(el,text,isError){
  if(!el)return;el.textContent=text;el.style.color=isError?'var(--red)':'var(--brand)';el.classList.remove('hidden');
  if(!isError) setTimeout(()=>el.classList.add('hidden'),5000);
}
function showBanner(msg,isError){
  let b=document.getElementById('global-banner');
  if (!b){b=document.createElement('div');b.id='global-banner';b.style.cssText='position:fixed;top:var(--header-h);left:0;right:0;z-index:300;padding:10px 16px;font-size:.83rem;font-weight:700;text-align:center;';document.body.appendChild(b);}
  b.textContent=msg;b.style.background=isError?'var(--red)':'var(--brand)';b.style.color='#fff';b.style.display='block';
  if(!isError) setTimeout(()=>b.style.display='none',4000);
}
function timeAgo(date){
  const s=Math.floor((new Date()-date)/1000);
  if(s<60)return'just now';if(s<3600)return Math.floor(s/60)+'m';
  if(s<86400)return Math.floor(s/3600)+'h';return Math.floor(s/86400)+'d';
}
function escHtml(str){return(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function avatarHtml(profile,size=36){
  const name=profile?.display_name||profile?.username||'?';
  const cls=size<=30?'post-avatar small':'post-avatar';
  const sizeStyle=`width:${size}px;height:${size}px;`;
  if (profile?.avatar_url) return `<div class="${cls}" style="${sizeStyle}"><img src="${escHtml(profile.avatar_url)}" alt="${escHtml(name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>`;
  return `<div class="${cls}" style="${sizeStyle}">${(name[0]||'?').toUpperCase()}</div>`;
}

// ── Boot ─────────────────────────────────────────────────
detectLocation();
populateCreateForm();
