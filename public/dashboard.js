const $=id=>document.getElementById(id);
async function loadUsers(){
 const data=await api('/api/users?page='+userPage);$('users-list').replaceChildren();
 $('users-page').textContent='Page '+userPage;$('users-previous').disabled=userPage===1;$('users-next').disabled=data.users.length<50;
 for(const user of data.users){
  const row=document.createElement('div');row.className='admin-row';
  const label=document.createElement('span');label.textContent=user.email+' · '+user.role;
  const select=document.createElement('select');select.setAttribute('aria-label','Role for '+user.email);
  for(const role of ['user','staff','admin']){const option=document.createElement('option');option.value=role;option.textContent=role;select.append(option);}select.value=user.role;
  const save=document.createElement('button');save.textContent='Save role';
  select.disabled=save.disabled=Boolean(user.discord_managed)||String(user.id)===String(currentUser.id);
  save.onclick=async()=>{if(!confirm('Set '+user.email+' to '+select.value+'?'))return;save.disabled=true;try{await api('/api/users/'+user.id+'/role',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:select.value})});await loadUsers();notice('Role updated.');}catch(e){notice(e.message);}finally{save.disabled=false;}};
  row.append(label,select,save);$('users-list').append(row);
 }
}
let page=1,maxUpload=26214400,userPage=1,currentUser;
const format=n=>{n=Number(n);return n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':n<1073741824?(n/1048576).toFixed(1)+' MB':(n/1073741824).toFixed(2)+' GB';};
function notice(text){$('notice').textContent=text;}
const dashboardPath=role=>['admin','owner'].includes(role)?'/admin':role==='staff'?'/staff':'/dashboard';
function showLogin(register=false){
 $('access-heading').textContent=register?'Create your SolarCDN account':'Your content. Ready to deliver.';
 $('access-help').textContent=register?'Register to upload and manage your public files.':'Sign in to manage your public files.';
 $('registration').hidden=!register;$('login-form').hidden=register;
 $('view-label').textContent='Account access';document.title='SolarCDN · '+(register?'Create account':'Sign in');
}
function signedIn(value){
 $('account-nav').hidden=value;$('dashboard-link').hidden=!value;
 if(!value){currentUser=null;page=1;userPage=1;
  for(const id of ['files','users-list','admins-list','owners-list'])$(id).replaceChildren();
  $('identity').textContent='';$('bytes').textContent='0 B';$('count').textContent='0 files stored';
  $('upload-form').reset();showLogin(location.pathname==='/register');
 }
$('dashboard').hidden=!value;$('logout').hidden=!value;$('login').hidden=value;if(!value){$('admin-section').hidden=true;$('users-section').hidden=true;}}
async function api(url,options={}){
 const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,headers:{'X-SolarCDN-Request':'1',...options.headers}});
 if(response.status===401){signedIn(false);if(!['/','/login','/register'].includes(location.pathname))history.replaceState(null,'','/login');}
 if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'Request failed. Please try again.');}
 return response.status===204?null:response.json();
}
async function load(){
 const data=await api('/api/assets?page='+page);$('files').replaceChildren();
 $('bytes').textContent=format(data.usage.bytes);$('count').textContent=data.usage.count+' files stored';
 $('page').textContent='Page '+page;$('previous').disabled=page===1;$('next').disabled=page*50>=Number(data.usage.count);
 if(!data.assets.length){$('files').textContent='No files here yet. Upload your first file above.';return;}
 for(const file of data.assets){
  const card=document.createElement('article');card.className='card';
  const preview=document.createElement('div');preview.className='preview';
  if(file.mime_type.startsWith('image/')){const img=document.createElement('img');img.src=file.url;img.alt=file.original_name;img.loading='lazy';preview.append(img);}else preview.textContent='PDF document';
  const details=document.createElement('div');details.className='details';
  const name=document.createElement('h3');name.textContent=file.original_name;
  const meta=document.createElement('p');meta.textContent=format(file.byte_size)+' · '+new Date(file.created_at).toLocaleDateString();
  const url=document.createElement('input');url.readOnly=true;url.value=file.url;url.setAttribute('aria-label','Public URL for '+file.original_name);url.addEventListener('click',()=>url.select());
  const actions=document.createElement('div');actions.className='actions';
  const copy=document.createElement('button');copy.textContent='Copy URL';copy.onclick=async()=>{try{await navigator.clipboard.writeText(file.url);notice('Public URL copied.');}catch{url.focus();url.select();notice('Select and copy the public URL shown on the card.');}};
  const open=document.createElement('a');open.textContent='Preview ↗';open.href=file.url;open.target='_blank';open.rel='noopener noreferrer';
  const remove=document.createElement('button');remove.textContent='Delete';remove.className='danger';remove.onclick=async()=>{if(!confirm('Delete '+file.original_name+'? This cannot be undone.'))return;remove.disabled=true;try{await api('/api/assets/'+file.id,{method:'DELETE'});notice('File deleted. Cached copies may persist for up to one hour.');await load();}catch(e){notice(e.message);}finally{remove.disabled=false;}};
  actions.append(copy,open,remove);details.append(name,meta,url,actions);card.append(preview,details);$('files').append(card);
 }
}
async function init(){const data=await api('/api/auth/me');maxUpload=data.maxUploadBytes;currentUser=data.user;$('identity').textContent=data.user.discordId?'Discord '+data.user.discordId+' · '+data.user.role:data.user.email+' · '+data.user.role;$('upload-help').textContent='PNG, JPEG, GIF, WebP or PDF · Maximum '+format(maxUpload)+'. Uploaded files are public.';signedIn(true);
 const path=dashboardPath(data.user.role);history.replaceState(null,'',path);$('dashboard-link').href=path;
 const label=['admin','owner'].includes(data.user.role)?'Admin dashboard':data.user.role==='staff'?'Staff dashboard':'Your dashboard';
 $('view-label').textContent=label;document.title='SolarCDN · '+label;
 $('role-help').textContent=['admin','owner'].includes(data.user.role)?'Manage your files and account roles below.':data.user.role==='staff'?'Staff access · Manage your own public files.':'Manage your own public files.';
 await load();$('admin-section').hidden=!data.user.isOwner;if(data.user.isOwner)await loadAdmins();$('users-section').hidden=!['admin','owner'].includes(data.user.role);if(!$('users-section').hidden){userPage=1;await loadUsers();}}
$('login-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;notice('');try{const form=new FormData(event.target);await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(form))});event.target.reset();page=1;await init();$('dashboard-heading').focus();}catch(e){notice(e.message);}finally{button.disabled=false;}};
$('register-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;const password=event.target.elements.password.value;if(new TextEncoder().encode(password).length>72){notice('Password must be at most 72 UTF-8 bytes.');event.target.elements.password.focus();return;}button.disabled=true;notice('');try{const data=await api('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});const email=event.target.elements.email.value.trim();event.target.reset();history.replaceState(null,'','/login');showLogin(false);$('login-form').elements.email.value=email;$('login-form').elements.password.focus();notice(data.message);}catch(e){notice(e.message);}finally{button.disabled=false;}};
$('users-previous').onclick=()=>{userPage--;loadUsers().catch(e=>notice(e.message));};
$('users-next').onclick=()=>{userPage++;loadUsers().catch(e=>notice(e.message));};
$('upload-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;const file=event.target.elements.file.files[0];if(!file)return;if(file.size>maxUpload){notice('File exceeds '+format(maxUpload)+'.');return;}button.disabled=true;notice('Uploading…');try{await api('/api/assets',{method:'POST',body:new FormData(event.target)});event.target.reset();page=1;await load();notice('File uploaded. Its public URL is ready to copy.');}catch(e){notice(e.message);}finally{button.disabled=false;}};
$('logout').onclick=async()=>{try{await api('/api/auth/logout',{method:'POST'});history.replaceState(null,'','/login');signedIn(false);$('login-form').reset();$('login-form').elements.email.focus();notice('Signed out.');}catch(e){notice(e.message);}};
$('refresh').onclick=()=>load().catch(e=>notice(e.message));
$('previous').onclick=()=>{page--;load().catch(e=>notice(e.message));};$('next').onclick=()=>{page++;load().catch(e=>notice(e.message));};

async function loadAdmins(){
 const data=await api('/api/admins');$('owners-list').replaceChildren();$('admins-list').replaceChildren();
 for(const id of data.owners){const row=document.createElement('p');row.textContent=id+' · Owner';$('owners-list').append(row);}
 if(!data.admins.length)$('admins-list').textContent='No Discord administrators assigned.';
 for(const admin of data.admins){
  const row=document.createElement('div');row.className='admin-row';const label=document.createElement('span');label.textContent=admin.discord_id;
  const button=document.createElement('button');button.className='danger';button.textContent='Revoke access';button.onclick=async()=>{
   if(!confirm('Revoke admin access for '+admin.discord_id+'?'))return;button.disabled=true;
   try{await api('/api/admins/'+admin.discord_id,{method:'DELETE'});await loadAdmins();notice('Administrator access revoked.');}catch(e){notice(e.message);}finally{button.disabled=false;}
  };row.append(label,button);$('admins-list').append(row);
 }
}
$('admin-form').onsubmit=async event=>{
 event.preventDefault();const button=event.submitter;button.disabled=true;
 try{const id=event.target.elements.discordId.value.trim();await api('/api/admins/'+encodeURIComponent(id),{method:'PUT'});event.target.reset();await loadAdmins();notice('Administrator can now sign in with Discord.');}catch(e){notice(e.message);}finally{button.disabled=false;}
};
const authErrors={state:'Discord sign-in expired or could not be verified. Please try again.',cancelled:'Discord sign-in was cancelled.',access:'Your Discord account has not been granted access. Ask an owner to add your Discord user ID.',provider:'Discord sign-in failed. Please try again.',disabled:'Discord sign-in is not configured.'};
const authError=new URLSearchParams(location.search).get('auth_error');
showLogin(location.pathname==='/register');
if(authError){notice(authErrors[authError]||'Discord sign-in failed.');history.replaceState(null,'','/');}
api('/api/auth/providers').then(data=>{$('discord-login').hidden=!data.discord;}).catch(e=>notice(e.message));
init().catch(e=>{if(e.message!=='Please sign in')notice(e.message);});
