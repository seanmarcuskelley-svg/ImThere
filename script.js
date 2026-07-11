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
let activeFeed     = 'all';
let activeVenues   = new Set(['basketball','tennis_pickleball','field']);
let maxDistance    = 5;
let locationDropdownList = [];
let courtRunCounts = {};
let courtCountsLoaded = false;
let activePostImage = null; // File object
let activeDmUser   = null; // { id, name, avatar }
let dmPolling      = null;
let profileGridMode = 'posts';

// ── Navigation ───────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.section)?.classList.add('active');
    if (btn.dataset.section === 'map')     initMap();
    if (btn.dataset.section === 'profile') refreshProfileView();
    if (btn.dataset.section === 'create')  populateCreateForm();
    if (btn.dataset.section === 'dms')     loadDmList();
  });
});

document.getElementById('goto-create')?.addEventListener('click', () => {
  document.querySelector('[data-section="create"]')?.click();
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
    loadCourts(false);
  } else {
    currentProfile = null;
    btn.textContent = 'Sign in';
    courtCountsLoaded = false; courtRunCounts = {};
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
  if (applyFilter) {
    if (userLat!==null) pool=pool.filter(l=>haversine(userLat,userLon,l.lat,l.lon)<=maxDistance);
    pool=pool.filter(l=>l.sports.some(s=>activeVenues.has(s)));
    pool.sort((a,b)=>scoreCourt(b)-scoreCourt(a));
  } else {
    pool=pool.filter(l=>l.sports.some(s=>activeVenues.has(s)));
    pool.sort((a,b)=>scoreCourt(b)-scoreCourt(a));
    pool=pool.slice(0,10);
  }
  renderCourts(pool,applyFilter);
}

function renderCourts(locs,filtered=false) {
  const list=document.getElementById('courts-list');
  if (!list) return;
  if (!locs.length) { list.innerHTML='<p class="empty-state">No courts match your filters. Try expanding the distance.</p>'; return; }

  const label=filtered?`${locs.length} court${locs.length!==1?'s':''} matching filters`:`Top ${locs.length} for you`;
  list.innerHTML=`<p class="courts-list-label">${label}</p>`;

  locs.forEach(loc=>{
    const dist=userLat!==null?`<span class="court-distance">${haversine(userLat,userLon,loc.lat,loc.lon).toFixed(1)} mi</span>`:'';
    const tags=(loc.sports||[]).map(s=>{const m=VENUE_META[s]||{label:s,cls:''};return`<span class="venue-tag ${m.cls}">${m.label}</span>`;}).join('');
    const runCount=courtRunCounts[loc.id]?.total||0;
    const card=document.createElement('div');
    card.className='court-card';
    card.innerHTML=`
      <div class="court-card-main">
        <div class="court-card-top">
          <div><h4>${escHtml(loc.name)}</h4><p class="court-city">${loc.city||'Montgomery County'}, MD</p></div>
          ${dist}
        </div>
        <div class="sport-tags-row">${tags}</div>
      </div>
      <div class="court-card-footer">
        <button class="court-footer-btn" data-action="runs">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${runCount} Run${runCount!==1?'s':''}
        </button>
        <button class="court-footer-btn" data-action="photos">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          Photos
        </button>
        <button class="court-footer-btn primary" data-action="create">
          + Run here
        </button>
      </div>
      <div class="court-expand" id="expand-${loc.id}"></div>`;

    card.querySelector('[data-action="create"]').addEventListener('click', ()=>jumpToCreateRun(loc.id));
    card.querySelector('[data-action="runs"]').addEventListener('click', ()=>toggleCourtExpand(loc,'runs'));
    card.querySelector('[data-action="photos"]').addEventListener('click', ()=>toggleCourtExpand(loc,'photos'));
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
    if (view==='runs') loadCourtRuns(loc,panel);
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
  }
});

// ── Map ──────────────────────────────────────────────────
async function initMap() {
  if (mapInitialized) return;
  mapInitialized=true;
  const mapEl=document.getElementById('leaflet-map');
  if (!mapEl) return;
  const map=L.map(mapEl,{zoomControl:false}).setView([39.15,-77.2],11);
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
      <div style="min-width:190px">
        <div class="map-popup-title">${escHtml(loc.name)}</div>
        <div class="map-popup-sub">${loc.city||'Montgomery County'}, MD · ${venueLabels}</div>
        <div class="map-popup-runs">${runs>0?runs+` upcoming run${runs>1?'s':''}`:'No runs yet'}</div>
        <button class="map-popup-btn" onclick="window.__jumpCreate('${loc.id}')">+ Create Run Here</button>
      </div>`,{maxWidth:240});
  });

  window.__jumpCreate=locId=>jumpToCreateRun(locId);

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
