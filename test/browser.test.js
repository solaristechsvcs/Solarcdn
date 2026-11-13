import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

// Run the shipped browser event handlers with a small DOM/fetch adapter.
// HTTP tests independently exercise the actual server and cookie contract.
const script=await fs.readFile(new URL('../public/dashboard.js',import.meta.url),'utf8');
const html=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8');
async function browser(path='/login',role='user'){
 const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,{
  hidden:false,textContent:'',value:'',disabled:false,children:[],
  replaceChildren(){this.children=[];this.textContent='';},
  reset(){if(this.elements)for(const input of Object.values(this.elements))input.value='';},
  focus(){this.focused=true;}
 }]));
 for(const id of ['login-form','register-form'])elements.get(id).elements={email:{value:'new@example.test',focus(){}},password:{value:'secure-test-password',focus(){}}};
 let loggedIn=false,expired=false;
 const calls=[];
 const location={pathname:path,search:''};
 const context=vm.createContext({document:{getElementById:id=>{assert.ok(elements.has(id),id);return elements.get(id);}},location,
  history:{replaceState(_a,_b,path){location.pathname=path;}},URLSearchParams,TextEncoder,
  FormData:class{constructor(form){this.form=form;}*[Symbol.iterator](){for(const [k,v] of Object.entries(this.form.elements))yield [k,v.value];}},
  fetch:async(url,options)=>{
   calls.push({url,options});let status=200,data={};
   if(url==='/api/auth/providers')data={discord:false};
   else if(url==='/api/auth/register')data={message:'Account ready. Sign in with your credentials.'};
   else if(url==='/api/auth/login')loggedIn=true;
   else if(url==='/api/auth/logout'){loggedIn=false;status=204;}
   else if(!loggedIn||expired){status=401;data={error:'Please sign in'};}
   else if(url==='/api/auth/me')data={user:{id:1,email:'new@example.test',role},maxUploadBytes:1000};
   else if(url.startsWith('/api/assets'))data={assets:[],usage:{count:0,bytes:0}};
   else if(url.startsWith('/api/users'))data={users:[]};
   else throw new Error('Unexpected browser request '+url);
   return {status,ok:status<400,json:async()=>data};
  }});
 vm.runInContext(script,context);await new Promise(setImmediate);
 return {elements,location,calls,expire(){expired=true;},submit:async id=>elements.get(id).onsubmit({preventDefault(){},submitter:{},target:elements.get(id)})};
}

test('registration hands off email, clears password, and exposes sign-in',async()=>{
 const b=await browser('/register');
 assert.equal(b.elements.get('registration').hidden,false);
 assert.equal(b.elements.get('login-form').hidden,true);
 await b.submit('register-form');
 assert.equal(b.location.pathname,'/login');
 assert.equal(b.elements.get('login-form').hidden,false);
 assert.equal(b.elements.get('login-form').elements.email.value,'new@example.test');
 assert.equal(b.elements.get('register-form').elements.password.value,'');
 assert.match(b.elements.get('notice').textContent,/Sign in/);
});

for(const [role,path] of [['user','/dashboard'],['staff','/staff'],['admin','/admin']]){
 test(role+' sign-in routes to its view, session expiry and logout clear private UI',async()=>{
  const b=await browser('/admin',role);
  assert.equal(b.location.pathname,'/login');
  await b.submit('login-form');
  assert.equal(b.location.pathname,path);
  assert.equal(b.elements.get('login').hidden,true);
  assert.equal(b.elements.get('users-section').hidden,role!=='admin');
  assert.equal(b.elements.get('admin-section').hidden,true);
  assert.equal(b.elements.get('account-nav').hidden,true);
  assert.match(b.elements.get('role-help').textContent,/files/);
  assert.equal(b.elements.get('login-form').elements.password.value,'');
  for(const {options} of b.calls){assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');}
  if(role==='staff'){
   b.expire();await b.elements.get('refresh').onclick();
   assert.equal(b.location.pathname,'/login');
   assert.equal(b.elements.get('dashboard').hidden,true);
  }else await b.elements.get('logout').onclick();
  assert.equal(b.elements.get('identity').textContent,'');
  assert.equal(b.elements.get('users-section').hidden,true);
  assert.equal(b.elements.get('files').textContent,'');
  assert.equal(b.elements.get('account-nav').hidden,false);
 });
}
