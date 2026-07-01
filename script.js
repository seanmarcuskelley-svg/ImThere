// ---- Supabase setup ----
const SUPABASE_URL = 'https://jxxjzwjmvnxivfztfpjt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4eGp6d2ptdm54aXZmenRmcGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3ODAyMjYsImV4cCI6MjA5ODM1NjIyNn0.TpxhJ_E9eapNPkMK6mxjKIUn5Uo5Crvyzbat-5UnzWw';
const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Auth state ----
let currentUser = null;

sb.auth.getSession().then(({ data: { session } }) => {
  if (session) setUser(session.user);
});

sb.auth.onAuthStateChange((_event, session) => {
  setUser(session ? session.user : null);
});

function setUser(user) {
  currentUser = user;
  const btn = document.getElementById('notify-btn');
  const msg = document.getElementById('notify-msg');
  if (user) {
    btn.textContent = '✓ Signed in as ' + user.email;
    btn.disabled = true;
    msg.textContent = "You're on the list. We'll let you know when it launches.";
    msg.classList.remove('hidden');
  } else {
    btn.textContent = 'Get early access';
    btn.disabled = false;
    msg.classList.add('hidden');
  }
}

// ---- Auth modal ----
let authMode = 'signup';

document.getElementById('notify-btn').addEventListener('click', () => {
  if (currentUser) return;
  document.getElementById('auth-modal').classList.remove('hidden');
});

document.getElementById('modal-close').addEventListener('click', closeModal);

document.getElementById('auth-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('auth-modal')) closeModal();
});

function closeModal() {
  document.getElementById('auth-modal').classList.add('hidden');
  document.getElementById('auth-error').classList.add('hidden');
}

function bindAuthSwitch() {
  const switchEl = document.getElementById('auth-switch');
  if (!switchEl) return;
  switchEl.addEventListener('click', (e) => {
    e.preventDefault();
    authMode = authMode === 'signup' ? 'login' : 'signup';
    const isSignup = authMode === 'signup';
    document.getElementById('auth-title').textContent = isSignup ? 'Get early access' : 'Welcome back';
    document.getElementById('auth-subtitle').textContent = isSignup
      ? 'Sign up to be first on the list and save your favorite courts.'
      : 'Log in to your IGotNext account.';
    document.getElementById('auth-submit').textContent = isSignup ? 'Sign up' : 'Log in';
    document.querySelector('.auth-toggle').innerHTML = isSignup
      ? 'Already have an account? <a href="#" id="auth-switch">Log in</a>'
      : 'New here? <a href="#" id="auth-switch">Sign up</a>';
    document.getElementById('auth-error').classList.add('hidden');
    bindAuthSwitch();
  });
}
bindAuthSwitch();

document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errorEl = document.getElementById('auth-error');
  const submitBtn = document.getElementById('auth-submit');

  submitBtn.disabled = true;
  submitBtn.textContent = authMode === 'signup' ? 'Signing up…' : 'Logging in…';
  errorEl.classList.add('hidden');

  let result;
  if (authMode === 'signup') {
    result = await sb.auth.signUp({ email, password });
  } else {
    result = await sb.auth.signInWithPassword({ email, password });
  }

  if (result.error) {
    errorEl.textContent = result.error.message;
    errorEl.classList.remove('hidden');
    submitBtn.disabled = false;
    submitBtn.textContent = authMode === 'signup' ? 'Sign up' : 'Log in';
  } else {
    closeModal();
    if (authMode === 'signup' && !result.data.session) {
      // Email confirmation required
      const msg = document.getElementById('notify-msg');
      msg.textContent = '📬 Check your email to confirm your account!';
      msg.classList.remove('hidden');
    }
  }
});

// ---- Load courts (real Supabase data) ----
async function loadCourts() {
  const SPORT_LABELS = {
    basketball:        { label: '🏀 Basketball',     cls: 'basketball' },
    tennis_pickleball: { label: '🎾 Tennis/Pickleball', cls: 'tennis' },
    field:             { label: '⚽ Field',           cls: 'soccer' },
  };

  const { data, error } = await sb
    .from('location')
    .select('name, city, zip, lat, lon, location_asset(sport)')
    .order('name')
    .limit(145);

  // -- Courts tab inside phone mockup --
  const courtsList = document.getElementById('courts-list');
  const courtsCount = document.getElementById('courts-count');

  // -- Courts section on main page --
  const courtsGrid = document.getElementById('courts-grid');

  if (error || !data) {
    const msg = '<p class="empty-state">Could not load courts.</p>';
    if (courtsList) courtsList.innerHTML = msg;
    if (courtsGrid) courtsGrid.innerHTML = msg;
    return;
  }

  if (courtsCount) courtsCount.textContent = data.length;

  // Phone mockup: small cards, first 40
  if (courtsList) {
    courtsList.innerHTML = '';
    data.slice(0, 40).forEach(loc => {
      const tags = (loc.location_asset || []).map(a => {
        const s = SPORT_LABELS[a.sport] || { label: a.sport, cls: '' };
        return `<span class="sport-tag ${s.cls}">${s.label}</span>`;
      }).join('');
      const card = document.createElement('div');
      card.className = 'run-card';
      card.innerHTML = `
        <div class="run-info">
          <div class="run-top"><h3>${loc.name}</h3></div>
          <p class="run-meta">📍 ${loc.city || ''}, MD ${loc.zip || ''}</p>
          <div class="sport-tags-row">${tags}</div>
        </div>`;
      courtsList.appendChild(card);
    });
  }

  // Full courts grid on main page
  if (courtsGrid) {
    courtsGrid.innerHTML = '';
    data.forEach(loc => {
      const tags = (loc.location_asset || []).map(a => {
        const s = SPORT_LABELS[a.sport] || { label: a.sport, cls: '' };
        return `<span class="sport-tag ${s.cls}">${s.label}</span>`;
      }).join('');
      const card = document.createElement('div');
      card.className = 'court-card';
      card.innerHTML = `
        <h4>${loc.name}</h4>
        <p class="court-city">📍 ${loc.city || 'Montgomery County'}, MD</p>
        <div class="sport-tags-row">${tags}</div>`;
      courtsGrid.appendChild(card);
    });
  }
}

loadCourts();

// ---- Notify me button (original fallback if user already signed in) ----
// (handled by setUser above; this section removed to avoid duplicate listener)

// ---- Tab switching ----
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabButtons.forEach((b) => b.classList.remove('active'));
    tabPanels.forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// ---- Join run buttons ----
const myRunsList = document.getElementById('myruns-list');
const myRunsEmpty = document.getElementById('myruns-empty');

document.querySelectorAll('.join-btn').forEach((btn) => {
  if (btn.disabled) return;
  btn.addEventListener('click', () => {
    if (btn.classList.contains('joined')) return;
    btn.textContent = 'Joined ✓';
    btn.classList.add('joined');
    const card = btn.closest('.run-card');
    const name = card?.dataset.run;
    const meta = card?.dataset.meta;
    if (name) {
      myRunsEmpty.classList.add('hidden');
      const entry = document.createElement('div');
      entry.className = 'run-card';
      entry.innerHTML = `<div class="run-info"><h3>${name}</h3><p class="run-meta">📍 ${meta}</p></div>`;
      myRunsList.appendChild(entry);
    }
  });
});

// ---- Chats ----
const chatData = {
  pickup5v5chat: {
    title: 'Pickup 5v5',
    messages: [
      { from: 'DL', text: "who's in for 6:30?" },
      { from: 'JN', text: "I'm coming" },
      { from: 'DL', text: 'see you guys at 6:30' },
    ],
  },
  morning3schat: {
    title: 'Morning 3s',
    messages: [{ from: 'SW', text: 'anyone else coming?' }],
  },
  dmjordan: {
    title: 'Jordan',
    messages: [{ from: 'Jordan', text: 'you up for tonight?' }],
  },
};

const chatThread = document.getElementById('chat-thread');
const chatTitle = document.getElementById('chat-thread-title');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
let activeChatId = null;

function renderMessages(messages) {
  chatMessages.innerHTML = '';
  messages.forEach((msg) => {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble' + (msg.from === 'You' ? ' me' : '');
    bubble.textContent = `${msg.from}: ${msg.text}`;
    chatMessages.appendChild(bubble);
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

document.querySelectorAll('.chat-row').forEach((row) => {
  row.addEventListener('click', () => {
    const id = row.dataset.chat;
    const chat = chatData[id];
    if (!chat) return;
    activeChatId = id;
    chatTitle.textContent = chat.title;
    renderMessages(chat.messages);
    chatThread.classList.remove('hidden');
  });
});

document.getElementById('chat-back').addEventListener('click', () => {
  chatThread.classList.add('hidden');
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !activeChatId) return;
  chatData[activeChatId].messages.push({ from: 'You', text });
  renderMessages(chatData[activeChatId].messages);
  chatInput.value = '';
});
