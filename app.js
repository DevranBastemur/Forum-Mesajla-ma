// =====================
// Nexus Chat v3 — app.js
// (public-first + DM + delete + change password + GUEST can post to public)
// =====================

const STORAGE_USER  = 'nexus-chat-v3-user';    // {id,name}
const STORAGE_DB    = 'nexus-chat-v3-store';   // mesajlar
const STORAGE_USERS = 'nexus-chat-users';      // kullanıcı listesi (parolalarla)

// ---- Varsayılan kullanıcılar (parolalı) ----
const DEFAULT_USERS = [
  { id:'u1', name:'Alice',   password:'Pass!Alice42' },
  { id:'u2', name:'Bob',     password:'Pass!Bob42' },
  { id:'u3', name:'Charlie', password:'Pass!Charlie42' },
  { id:'u4', name:'Diana',   password:'Pass!Diana42' },
  // Guest kullanıcıyı listede TUTMUYORUZ; gönderim sırasında dinamik ekleyeceğiz
];

// ---- Kullanıcı deposu (kalıcı) ----
function loadUsers(){
  const raw = localStorage.getItem(STORAGE_USERS);
  return raw ? JSON.parse(raw) : DEFAULT_USERS.slice();
}
function saveUsers(users){
  localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
}
let USERS = loadUsers();

// ---- Durum ----
let currentUser = null; // {id, name} veya null
let currentConversation = { type:'channel', id:'public' }; // başlangıç: public

// ---- Yardımcılar ----
function msg(authorId, text, scope){
  return {
    id: 'm' + Date.now() + Math.random().toString(16).slice(2),
    authorId, text, scope, ts: new Date().toISOString()
  };
}
function pair(a,b){ return [a,b].sort().join('-'); }
function initials(name){ return name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase(); }
function formatTime(ts){ const d = new Date(ts); return d.toLocaleString('tr-TR', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit' }); }
function escapeHtml(s){
  return s.replace(/[&<>\"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'
  }[m]));
}

// ---- Başlangıç verisi ----
const seed = {
  channels: {
    public: [
    // İlk tohum mesajları istersen sil
      msg('u1', 'Welcome to Nexus Chat. This room is public.', 'public'),
      msg('u2', 'Anyone can read messages here without login.', 'public'),
    ],
  },
  dms: {
    [pair('u1','u2')]: [ msg('u1','Hey Bob, check the docs?', 'dm'), msg('u2','On it, Alice!', 'dm') ],
    [pair('u2','u3')]: [ msg('u2','Charlie, beta branch merged.', 'dm') ],
    [pair('u1','u4')]: [ msg('u4','Alice, design looks great.', 'dm') ],
  }
};

// ---- Mesaj deposu ----
function loadDB(){
  const raw = localStorage.getItem(STORAGE_DB);
  const db  = raw ? JSON.parse(raw) : seed;
  db.channels = db.channels || {};
  db.channels.public = db.channels.public || [];
  db.dms = db.dms || {};
  return db;
}
function saveDB(db){ localStorage.setItem(STORAGE_DB, JSON.stringify(db)); }
let DB = loadDB();

// ---- Kısa seçiciler ----
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));

const userList      = $('#userList');
const dmTarget      = $('#dmTarget');
const visibility    = $('#visibility');
const messagesEl    = document.getElementById('messages')
  || document.querySelector('[data-messages-root]')
  || document.body;
const convTitle     = $('#conversationTitle');
const convMeta      = $('#conversationMeta');
const composerInput = $('#composerInput');
const sendBtn       = $('#sendBtn');
const composeHint   = $('#composeHint');
const userState     = $('#userState');
const loginLink     = $('#loginLink');
const logoutBtn     = $('#logoutBtn');

// Change Password modal elemanları (dashboard için)
const changeBtn     = $('#changePassBtn');
const passModal     = $('#passModal');
const oldPass       = $('#oldPass');
const newPass       = $('#newPass');
const confirmPass   = $('#confirmPass');
const savePassBtn   = $('#savePass');
const cancelPass    = $('#cancelPass');

// ---- Başlat ----
function init(){
  // Oturumu yükle (varsa)
  const savedUser = localStorage.getItem(STORAGE_USER);
  if(savedUser){ currentUser = JSON.parse(savedUser); }

  initSideLists();

  // Kanal butonları (#public)
  $$('#leftPane [data-kind="channel"]').forEach(btn=>{
    btn.addEventListener('click', ()=> switchTo({type:'channel', id: btn.dataset.id}));
  });

  // Logout
  if (logoutBtn) {
    logoutBtn.addEventListener('click', ()=>{
      currentUser = null;
      localStorage.removeItem(STORAGE_USER);
      updateComposer();
      switchTo({type:'channel', id:'public'});
    });
  }

  // Mesaj silme — genel delegasyon
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('.delete-btn');
    if(!btn) return;
    const mid = btn.dataset.mid;
    if(confirm('Bu mesajı silmek istediğine emin misin?')){
      deleteMessage(mid);
    }
  });

  // Şifre değiştirme butonu (dashboard)
  if (changeBtn && passModal) {
    changeBtn.addEventListener('click', ()=>{
      if(!currentUser){ alert('Please login first.'); return; }
      passModal.classList.remove('hide');
      if (oldPass) oldPass.value = '';
      if (newPass) newPass.value = '';
      if (confirmPass) confirmPass.value = '';
      oldPass?.focus();
    });
  }
  if (cancelPass) {
    cancelPass.addEventListener('click', ()=> passModal.classList.add('hide'));
  }
  if (savePassBtn) {
    savePassBtn.addEventListener('click', ()=>{
      if(!currentUser) return;
      const u = USERS.find(x=>x.id===currentUser.id);
      if(!u){ alert('User not found'); return; }

      const oldP = oldPass?.value || '';
      const newP = newPass?.value || '';
      const cNew = confirmPass?.value || '';

      if(oldP !== u.password){ alert('Old password incorrect'); return; }
      if(newP.length < 4){ alert('Password too short (min 4)'); return; }
      if(newP !== cNew){ alert('New passwords do not match'); return; }

      u.password = newP;
      saveUsers(USERS);

      alert('Password changed. Please logout and login again with your new password.');
      passModal.classList.add('hide');
    });
  }

  // Başka sekmede public/kullanıcılar değişirse
  window.addEventListener('storage', (e)=>{
    if(e.key === STORAGE_DB){
      DB = loadDB();
      render();
    }
    if(e.key === STORAGE_USERS){
      USERS = loadUsers();
      initSideLists();
    }
  });

  // Compose yetkileri & varsayılan görünüm
  updateComposer();
  switchTo({type:'channel', id:'public'});
}

function initSideLists(){
  // Sol panel: kullanıcı listesi
  if (userList) {
    userList.innerHTML = '';
    USERS.forEach(u=>{
      const li = document.createElement('li');
      li.innerHTML = `<button class="item" data-kind="dm" data-id="${u.id}">💬 ${u.name}</button>`;
      li.querySelector('button').addEventListener('click', ()=>{
        if(!currentUser){ window.location.href = 'login.html'; return; }
        switchTo({ type:'dm', id: u.id });
      });
      userList.appendChild(li);
    });
  }

  // DM hedef select
  if (dmTarget) {
    dmTarget.innerHTML = USERS.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  }
}

// ---- Konuşma Değiştir ----
function switchTo(conv){
  currentConversation = conv;

  if(conv.type==='channel'){
    if (convTitle) convTitle.textContent = `# ${conv.id}`;
    if (convMeta)  convMeta.textContent  = 'Herkes okuyabilir (login gerekmez).';
    if (visibility){ 
      visibility.value = 'public'; 
      visibility.disabled = !currentUser; // GUEST DM seçemesin
    }
    if (dmTarget) dmTarget.disabled = true;
  } else {
    const user = USERS.find(u=>u.id===conv.id);
    if (convTitle) convTitle.textContent = `DM • ${user ? user.name : conv.id}`;
    if (convMeta)  convMeta.textContent  = 'Sadece iki kişi arasında görünür.';
    if (visibility){ 
      visibility.value = 'dm'; 
      visibility.disabled = !currentUser; 
    }
    if (dmTarget){ 
      dmTarget.value = user ? user.id : ''; 
      dmTarget.disabled = !currentUser; 
    }
  }

  render();
}

// ---- Çizim ----
render();

function render(){
  if (!messagesEl) return;
  messagesEl.innerHTML = '';
  const list = getMessagesFor(currentConversation)
    .slice()
    .sort((a,b)=> new Date(a.ts) - new Date(b.ts));

  for(const m of list){
    renderRow(m);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderRow(m){
  const author = USERS.find(u=>u.id===m.authorId) 
               || (m.authorId==='guest' ? {name:'Guest'} : {name:'Unknown'});
  const row = document.createElement('div');
  row.className = 'msg';
  row.innerHTML = `
    <div class="avatar">${initials(author.name)}</div>
    <div>
      <div class="meta">
        <strong>${author.name}</strong>
        <span>•</span>
        <span>${formatTime(m.ts)}</span>
        <div class="chips"><span class="chip">${m.scope}</span></div>
      </div>
      <div class="body">${escapeHtml(m.text)}</div>
      ${currentUser && currentUser.id === m.authorId ? `
        <div style="margin-top:6px">
          <button class="icon-btn delete-btn" data-mid="${m.id}">🗑️ Sil</button>
        </div>` : ``}
    </div>
  `;
  messagesEl.appendChild(row);
}

// ---- Veri Sağlayıcılar ----
function getMessagesFor(conv){
  if(conv.type==='channel'){
    return DB.channels.public || []; // GUEST de okuyabilir
  } else {
    if(!currentUser) return [];
    const k = pair(currentUser.id, conv.id);
    return DB.dms[k] || [];
  }
}

// ---- Compose Yetkileri ----
// GUEST public yazabilsin; DM & visibility sadece login
function updateComposer(){
  const authed = !!currentUser;

  if (composerInput) composerInput.disabled = false; // GUEST de yazabilsin
  if (sendBtn)       sendBtn.disabled       = false; // GUEST gönderebilsin
  if (visibility)    visibility.disabled    = !authed; // DM seçimi için login şart
  if (dmTarget)      dmTarget.disabled      = !authed;

  if (composeHint) composeHint.textContent = authed 
    ? 'Kurallara uygun yazın.' 
    : 'Guest olarak sadece public mesaj atabilirsiniz.';
  if (userState)   userState.textContent   = authed ? `User: ${currentUser.name}` : 'Guest';
  if (loginLink)   loginLink.classList.toggle('hide', authed);
  if (logoutBtn)   logoutBtn.classList.toggle('hide', !authed);
}

// ---- Gönderme ----
if (sendBtn) {
  sendBtn.addEventListener('click', ()=>{
    const text = (composerInput?.value || '').trim();
    if(!text){ alert('Message cannot be empty.'); return; }

    const vis = visibility?.value || 'public'; // public | dm

    // Guest sadece public'e yazabilir
    if(!currentUser && vis !== 'public'){
      alert('Guests can only write in the public channel.');
      return;
    }

    // Gönderen kim?
    let authorId;
    if(currentUser){
      authorId = currentUser.id;
    } else {
      authorId = 'guest';
      // Guest kullanıcı görünmesi için USERS listesine tek seferlik ekle
      if(!USERS.find(u=>u.id==='guest')){
        USERS.push({ id:'guest', name:'Guest' });
        // dmTarget/userList'e eklenmesini İSTEMİYORUZ, o yüzden saveUsers çağırmıyoruz.
        // (Guest DM yapamaz, sadece public)
      }
    }

    if(vis==='public'){
      DB.channels.public.push(msg(authorId, text, 'public'));
    } else {
      // DM: sadece login kullanıcı
      const to = dmTarget.value;
      const k  = pair(currentUser.id, to);
      DB.dms[k] = DB.dms[k] || [];
      DB.dms[k].push(msg(authorId, text, 'dm'));
    }

    saveDB(DB);
    if (composerInput) composerInput.value = '';
    render();
  });
}

// ---- Silme ----
// Not: Silme işlemi SADECE login kullanıcıların kendi mesajlarında görünür.
// (Guest için doğrulanabilir bir kimlik yok; bu yüzden guest mesajlarında sil butonu çıkmaz.)
function deleteMessage(messageId){
  if(!currentUser) return;

  if(currentConversation.type === 'channel'){
    DB.channels.public = (DB.channels.public || [])
      .filter(m => !(m.id === messageId && m.authorId === currentUser.id));
  } else if(currentConversation.type === 'dm'){
    const k = pair(currentUser.id, currentConversation.id);
    DB.dms[k] = (DB.dms[k] || [])
      .filter(m => !(m.id === messageId && m.authorId === currentUser.id));
  }

  saveDB(DB);
  render();
}

// ---- Çalıştır (DOMContentLoaded güvenli) ----
if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
