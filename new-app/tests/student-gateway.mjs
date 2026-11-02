// Exercise the real gateway with a deterministic in-memory Firestore adapter.
// This checks allocation/recovery behavior; deployed Rules have separate tests.
import {build} from 'esbuild';
import {resolve} from 'node:path';
const database=`
let beltFailure=null;export const failBeltCursor=n=>{beltFailure=n};
export const root='clubs/antruong-v2',store=new Map();let serial=0,queue=Promise.resolve();export let transactions=0;
export const auth={currentUser:{uid:'staff',email:'staff@example.test',emailVerified:true}},db={},clubId='antruong-v2';
export const collection=(_db,path)=>({path});
export const doc=(base,path)=>({path:path||base.path+'/generated-'+(++serial),id:(path||'generated-'+serial).split('/').at(-1)});
export const serverTimestamp=()=>new Date().toISOString();
const snapshot=ref=>({ref,id:ref.path.split('/').at(-1),exists:()=>store.has(ref.path),data:()=>structuredClone(store.get(ref.path))});
export const getDoc=async ref=>snapshot(ref),getDocFromServer=getDoc;
export const where=(field,op,value)=>({field,op,value}),orderBy=()=>null,limit=()=>null;
export const query=(ref,...filters)=>({...ref,filters:filters.filter(Boolean)});
export const getDocsFromServer=async ref=>({docs:[...store.keys()].filter(k=>k.startsWith(ref.path+'/')&&!k.slice(ref.path.length+1).includes('/')).map(k=>snapshot({path:k})).filter(s=>(ref.filters||[]).every(f=>{const v=f.field.split('.').reduce((x,k)=>x?.[k],s.data());return f.op==='in'?f.value.includes(v):v===f.value}))});
export const setDoc=async(ref,data)=>{store.set(ref.path,structuredClone(data))};
export const deleteDoc=async ref=>{store.delete(ref.path)};
export const addDoc=async(ref,data)=>{const r=doc(ref);await setDoc(r,data);return r};
export const onSnapshot=()=>()=>{};
export async function runTransaction(_db,fn){const previous=queue;let release;queue=new Promise(r=>release=r);await previous;transactions++;const writes=[];let writing=false;const tx={get:async ref=>{if(writing)throw Error('Read after write');return snapshot(ref)},set:(ref,data)=>{if(ref.path.endsWith('/records/config--club')&&data.data?.studentBeltsSelfDefense20261102?.next===beltFailure){beltFailure=null;throw Error('simulated-disconnect')}writing=true;writes.push(()=>store.set(ref.path,structuredClone(data)))},delete:ref=>{writing=true;writes.push(()=>store.delete(ref.path))},update:(ref,data)=>{if(ref.path.endsWith('/meta/studentBeltsSelfDefense20261102')&&data.next===beltFailure){beltFailure=null;throw Error('simulated-disconnect')}writing=true;writes.push(()=>store.set(ref.path,{...store.get(ref.path),...data}))}};try{const result=await fn(tx);writes.forEach(f=>f());return result}finally{release()}}
export function writeBatch(){const tasks=[];return {set:(r,d)=>tasks.push(()=>setDoc(r,d)),delete:r=>tasks.push(()=>deleteDoc(r)),commit:async()=>{for(const t of tasks)await t()}}}
`;
const test=`
import assert from 'node:assert/strict';
import {mutate,readState,resetCurrentStudentBelts,importBackup,updateStudentRecords} from './src/gateway';
import {ensureStudentCodes} from './src/student-codes';
import {restoreApp} from './src/recovery';
import {store,root,transactions,failBeltCursor} from 'test:database';
const seed=(path,data)=>store.set(root+'/'+path,structuredClone(data));
const student=(id,code,extra={})=>({kind:'student',id,version:1,data:{id:code,name:'Cùng tên An',classId:'C1',...extra}});
seed('members/staff@example.test',{id:'STAFF',email:'staff@example.test',name:'HLV',status:'active',isSuperAdmin:false,allClasses:true,classIds:[],permissions:{students_direct:true}});
seed('meta/studentCodes',{ready:true});seed('meta/maintenance',{state:'ready'});seed('meta/import',{status:'ready'});
seed('records/class--C1',{kind:'class',id:'C1',version:1,data:{name:'C1'}});
seed('records/student--A',student('A','VVN.0001'));seed('studentCodes/code-vvn.0001',{studentUid:'A'});
seed('studentCodes/code-vvn.0002',{studentUid:'purged'});
seed('records/student--B',student('B','VVN.0003',{enrollmentStatus:'withdrawn'}));seed('studentCodes/code-vvn.0003',{studentUid:'B'});
await readState();const before=transactions;
const add=id=>mutate({kind:'student',id,version:0,data:{name:'Cùng tên An',id:'manually-entered',classId:'C1'}});
const results=await Promise.all([add('C'),add('D')]);
assert.deepEqual(results.map(r=>r.record.data.id).sort(),['VVN.0004','VVN.0005']);assert.ok(transactions-before>=3,'One competing writer must retry');
assert.equal(store.get(root+'/studentCodes/code-vvn.0002').studentUid,'purged');assert.equal(store.get(root+'/studentCodes/code-vvn.0003').studentUid,'B');
const highest=results.find(r=>r.record.data.id==='VVN.0005').record;store.delete(root+'/records/student--'+highest.id);await readState();
const next=await add('E');assert.equal(next.record.data.id,'VVN.0006');
// A form opened before/after an upload must never remove or replace file links.
const mediaStudent=store.get(root+'/records/student--A');mediaStudent.data.avatarFile={id:'server-avatar',category:'avatar'};mediaStudent.data.studentFiles=[{id:'server-certificate',category:'certificate'}];seed('records/student--A',mediaStudent);
await readState();const savedMedia=await mutate({kind:'student',id:'A',version:mediaStudent.version,data:{id:'VVN.0001',name:'Edited name',classId:'C1',avatarFile:{id:'forged'},studentFiles:[]}});
assert.deepEqual(savedMedia.record.data.avatarFile,mediaStudent.data.avatarFile);assert.deepEqual(savedMedia.record.data.studentFiles,mediaStudent.data.studentFiles);
await assert.rejects(()=>mutate({kind:'student',id:'A',version:mediaStudent.version,data:{id:'VVN.0001',name:'Stale form',classId:'C1'}}),/máy khác/);
console.log('PASS: normal edits preserve server-managed avatar/document links and reject stale versions.');
const owner=store.get(root+'/members/staff@example.test');owner.isSuperAdmin=true;seed('members/staff@example.test',owner);seed('meta/studentCodes',{ready:false});
await ensureStudentCodes({},root);assert.equal(store.get(root+'/studentCodes/code-vvn.0002').studentUid,'purged');assert.ok(store.has(root+'/studentCodes/code-vvn.0005'));
await restoreApp({hash:'test-restore',name:'test.json',plan:{rows:[{kind:'class',id:'C1',data:{name:'C1'}},student('A','VVN.0001')],members:null,profiles:null}},()=>{});
for(let i=1;i<=6;i++)assert.ok(store.has(root+'/studentCodes/code-vvn.'+String(i).padStart(4,'0')),'Recovery must retain retired code '+i);
await readState();const afterRestore=await add('F');assert.equal(afterRestore.record.data.id,'VVN.0007');
console.log('PASS: real gateway concurrent adds/retry, deleted and withdrawn code reservations, indexing/recovery never free used IDs, next code after restore.');

// One-time correction must retain other fields and resume without redoing rows.
const oldA=store.get(root+'/records/student--A');oldA.data.belt='Lam đai tam cấp';oldA.data.phone='test-phone';seed('records/student--A',oldA);
seed('records/student--RETIRED',student('RETIRED','VVN.0008',{belt:'Hoàng đai',deleted:true,enrollmentStatus:'withdrawn'}));seed('studentCodes/code-vvn.0008',{studentUid:'RETIRED'});
seed('records/student--SELF',student('SELF','VVN.0009',{belt:'Tự vệ nhập môn'}));seed('studentCodes/code-vvn.0009',{studentUid:'SELF'});
seed('records/attendance--TEST',{kind:'attendance',id:'TEST',version:1,data:{date:'2026-11-02',classId:'C1',status:'final',rows:[{studentUid:'A',status:'present',note:'kept'}]}});
seed('records/tuition--TEST',{kind:'tuition',id:'TEST',version:1,data:{studentUid:'A',classId:'C1',month:'2026-11',amount:100,status:'paid'}});
const initialStudents=[...store].filter(([key])=>key.startsWith(root+'/records/student--')).map(([,r])=>structuredClone(r));
const linkedBefore=JSON.stringify([...store].filter(([k])=>k.includes('/studentCodes/')||k.includes('/records/attendance--')||k.includes('/records/tuition--')));
failBeltCursor(2);await assert.rejects(resetCurrentStudentBelts(),/simulated-disconnect/);
assert.equal(store.get(root+'/records/config--club').data.studentBeltsSelfDefense20261102.next,1);
const completed=structuredClone(store.get(root+'/records/student--A'));
seed('records/student--LATER',student('LATER','VVN.0010',{belt:'Lam đai nhất cấp'}));
assert.equal(await resetCurrentStudentBelts(),3);
assert.deepEqual(store.get(root+'/records/student--A'),completed);
for(const original of initialStudents){const current=store.get(root+'/records/student--'+original.id);assert.deepEqual(current.data,{...original.data,belt:'Tự vệ nhập môn'});assert.equal(current.version,original.version+(original.data.belt==='Tự vệ nhập môn'?0:1));}
assert.equal(store.get(root+'/records/student--LATER').data.belt,'Lam đai nhất cấp');
assert.equal(JSON.stringify([...store].filter(([k])=>k.includes('/studentCodes/')||k.includes('/records/attendance--')||k.includes('/records/tuition--'))),linkedBefore);
const promoted=store.get(root+'/records/student--A');promoted.data.belt='Lam đai';seed('records/student--A',promoted);
assert.equal(await resetCurrentStudentBelts(),0);assert.equal(store.get(root+'/records/student--A').data.belt,'Lam đai');
console.log('PASS: one-time belt correction, interruption/resume, preserved IDs/fields/history, and future promotions/cohorts remain editable.');


store.clear();
seed('members/staff@example.test',{id:'OWNER',email:'staff@example.test',name:'Owner',status:'active',isSuperAdmin:true,allClasses:true,classIds:[],permissions:{}});
const beforeInit=JSON.stringify([...store]);
assert.deepEqual(await updateStudentRecords(),{codes:0,belts:0,errors:[]});
assert.equal(JSON.stringify([...store]),beforeInit,'Fresh project must not initialize code markers before import');
seed('meta/studentCodes',{ready:true});seed('meta/maintenance',{state:'ready'});
const backup=JSON.stringify({format:'antruong-v2',records:[{kind:'class',id:'C1',data:{name:'Class'}},student('A','VVN.0001')]});
const file={name:'migration.json',size:backup.length,text:async()=>backup};
assert.equal((await importBackup(file)).students,1);
assert.equal(store.get(root+'/studentCodes/code-vvn.0001').studentUid,'A');
assert.equal(store.get(root+'/meta/import').status,'ready');
console.log('PASS: fresh project waits for import; import creates student code reservations even when an old initialization marker exists.');

`;
await build({stdin:{contents:test,resolveDir:process.cwd(),sourcefile:'student-gateway-test.ts'},bundle:true,format:'esm',platform:'node',outfile:'tests/.student-gateway-built.mjs',plugins:[{name:'memory-firestore',setup(b){b.onResolve({filter:/^(test:database|firebase\/firestore)$/},()=>({path:'database',namespace:'test'}));b.onResolve({filter:/^\.\/firebase$/},()=>({path:'database',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:database,loader:'js'}))}}]});
await import(resolve('tests/.student-gateway-built.mjs'));
