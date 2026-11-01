const $=id=>document.getElementById(id);
let page=1,maxUpload=26214400;
const format=n=>{n=Number(n);return n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':n<1073741824?(n/1048576).toFixed(1)+' MB':(n/1073741824).toFixed(2)+' GB';};
function notice(text){$('notice').textContent=text;}
function signedIn(value){$('dashboard').hidden=!value;$('logout').hidden=!value;$('login').hidden=value;}
async function api(url,options={}){
 const response=await fetch(url,{...options,headers:{'X-SolarCDN-Request':'1',...options.headers}});
 if(response.status===401||response.status===403) signedIn(false);
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
async function init(){const data=await api('/api/auth/me');maxUpload=data.maxUploadBytes;$('identity').textContent=data.user.email;$('upload-help').textContent='PNG, JPEG, GIF, WebP or PDF · Maximum '+format(maxUpload)+'. Uploaded files are public.';signedIn(true);await load();}
$('login-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;notice('');try{const form=new FormData(event.target);await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(form))});event.target.reset();page=1;await init();}catch(e){notice(e.message);}finally{button.disabled=false;}};
$('upload-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;const file=event.target.elements.file.files[0];if(!file)return;if(file.size>maxUpload){notice('File exceeds '+format(maxUpload)+'.');return;}button.disabled=true;notice('Uploading…');try{await api('/api/assets',{method:'POST',body:new FormData(event.target)});event.target.reset();page=1;await load();notice('File uploaded. Its public URL is ready to copy.');}catch(e){notice(e.message);}finally{button.disabled=false;}};
$('logout').onclick=async()=>{try{await api('/api/auth/logout',{method:'POST'});signedIn(false);$('files').replaceChildren();notice('Signed out.');}catch(e){notice(e.message);}};
$('refresh').onclick=()=>load().catch(e=>notice(e.message));
$('previous').onclick=()=>{page--;load().catch(e=>notice(e.message));};$('next').onclick=()=>{page++;load().catch(e=>notice(e.message));};
init().catch(e=>{if(e.message!=='Please sign in')notice(e.message);});
