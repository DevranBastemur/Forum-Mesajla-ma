const STORAGE_USER = 'nexus-chat-v3-user';
const STORAGE_DB   = 'nexus-chat-v3-store';

const USERS = [
  { id:'u1', name:'Alice',   password:'Pass!Alice42' },
  { id:'u2', name:'Bob',     password:'Pass!Bob42' },
  { id:'u3', name:'Charlie', password:'Pass!Charlie42' },
  { id:'u4', name:'Diana',   password:'Pass!Diana42' },
];

let currentUser = null;                       // {id,name}
let currentConversation = { type:'channel', id:'public' };  // 'channel'|'dm'|'inbox'

const seed = {
  channels: {
    public: [
      msg('u1','Welcome to Nexus Chat. This room is public.','public'),
      msg('u2','Anyone can read messages here without login.','public'),
    ],
  },
  dms: {
    [pair('u1','u2')]: [ msg('u1','Hey Bob, check the docs?','dm'), msg('u2','On it, Alice!','dm') ],
    [pair('u2','u3')]: [ msg('u2','Charlie, beta branch merged.','dm') ],
    [pair('u1','u4')]: [ msg('u4','Alice, design looks great.','dm') ],
  }
};

const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
function pair(a,b){ return [a,b].sort().join('-'); }
function msg(authorId,text,scope){ return { id:'m'+Math.random().toString(16).slice(2), authorId, text, scope, ts:new Date().toISOString() }; }
function initials(name){ return name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase(); }
function formatTime(ts){ const d=new Date(ts); return d.toLocaleString('en-GB',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}); }
function escapeHtml(s){ return s.replace(/[&<>\"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function loadDB(){ const raw=localStorage.getItem(STORAGE_DB); return raw? JSON.parse(raw): seed; }
function saveDB(db){ localStorage.setItem(STORAGE_DB, JSON.stringify(db)); }

let DB = loadDB();

const userState   = $('#userState');
const logoutBtn   = $('#logoutBtn');
const userList    = $('#userList');
const messagesEl  = $('#messages');
const convTitle   = $('#conversationTitle');
const convMeta    = $('#conversationMeta');
const composer    = $('#composerInput');
const sendBtn     = $('#sendBtn');
const visibility  = $('#visibility');
const dmTarget    = $('#dmTarget');
const welcome     = $('#welcome');

function init(){
  const saved = localStorage.getItem(STORAGE_USER);
  if(!saved){
    window.location.href = 'login.html';
    return;
  }
  currentUser = JSON.parse(saved);
  userState.textContent = `User: ${currentUser.name}`;

  dmTarget.innerHTML = USERS
    .filter(u=>u.id!==currentUser.id) 
    .map(u=>`<option value="${u.id}">${u.name}</option>`).join('');

  userList.innerHTML = '';
  USERS.filter(u=>u.id!==currentUser.id).forEach(u=>{
    const li=document.createElement('li');
    li.innerHTML=`<button class="item" data-kind="dm" data-id="${u.id}">💬 ${u.name}</button>`;
    li.querySelector('button').addEventListener('click', ()=> switchTo({type:'dm', id:u.id}));
    userList.appendChild(li);
  });

  // left shortcuts
  $$('#leftPane [data-kind="channel"]').forEach(btn=>{
    btn.addEventListener('click', ()=> switchTo({type:'channel', id: btn.dataset.id}));
  });
  $$('#leftPane [data-view="inbox"]').forEach(btn=>{
    btn.addEventListener('click', ()=> switchTo({type:'inbox'}));
  });

  // logout
  logoutBtn.addEventListener('click', ()=>{
    localStorage.removeItem(STORAGE_USER);
    window.location.href = 'login.html';
  });

  switchTo({type:'inbox'});
  renderWelcome();
}

function renderWelcome(){
  welcome.innerHTML = `
    <strong>👋 Welcome, ${currentUser.name}</strong>
    <span class="pill">Public</span>
    <span class="pill">DM</span>
    <div class="muted small">Use the left panel to open #public or start a Direct Message.</div>
  `;
}

function switchTo(conv){
  currentConversation = conv;
  if(conv.type==='channel'){
    convTitle.textContent = `# ${conv.id}`;
    convMeta.textContent  = 'Public channel';
  } else if(conv.type==='dm'){
    const user = USERS.find(u=>u.id===conv.id);
    convTitle.textContent = `DM • ${user.name}`;
    convMeta.textContent  = 'Private conversation (only you and the other user can see)';
  } else { // inbox
    convTitle.textContent = '📥 My Inbox';
    convMeta.textContent  = 'Your recent direct messages';
  }
  render();
}

function render(){
  messagesEl.innerHTML = '';
  let list = [];

  if(currentConversation.type==='channel'){
    list = DB.channels.public || [];
  } else if(currentConversation.type==='dm'){
    const k = pair(currentUser.id, currentConversation.id);
    list = DB.dms[k] || [];
  } else { // inbox: tüm DM threadlerinden son 30 mesaj
    const myThreads = Object.keys(DB.dms).filter(k=> k.includes(currentUser.id));
    myThreads.forEach(k=>{
      list = list.concat(DB.dms[k]);
    });
    list = list.filter(m=>m.scope==='dm').slice(-30);
  }

  list.sort((a,b)=> new Date(a.ts) - new Date(b.ts));
  for(const m of list){
    const author = USERS.find(u=>u.id===m.authorId) || {name:'Unknown'};
    const row = document.createElement('div');
    row.className='msg';
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
      </div>
    `;
    messagesEl.appendChild(row);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

sendBtn.addEventListener('click', ()=>{
  const text = composer.value.trim();
  if(!text){ alert('Message cannot be empty.'); return; }
  const vis = visibility.value;
  if(vis==='public'){
    DB.channels.public.push(msg(currentUser.id, text, 'public'));
    if(currentConversation.type!=='channel'){ switchTo({type:'channel', id:'public'}); }
  } else {
    const to = dmTarget.value;
    if(!to || to===currentUser.id){ alert('Please pick a valid DM target.'); return; }
    const k = pair(currentUser.id, to);
    DB.dms[k] = DB.dms[k] || [];
    DB.dms[k].push(msg(currentUser.id, text, 'dm'));
    if(!(currentConversation.type==='dm' && currentConversation.id===to)){
      switchTo({type:'dm', id: to});
    } else {
      render();
    }
  }

  saveDB(DB);
  composer.value='';
});

init();
