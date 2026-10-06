// End-to-end smoke test against a REAL configured Supabase project and Next app.
// This intentionally has no local-only or mocked fallback.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {mkdir,writeFile,unlink}=require('node:fs/promises');
const {join}=require('node:path');
const {createClient}=require('@supabase/supabase-js');
require('@next/env').loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret=process.env.SUPABASE_SECRET_KEY,base=process.env.TEST_APP_URL||'http://127.0.0.1:3000';
if(process.env.RUN_LIVE_TESTS!=='1'||!url||!key||!secret){
  console.error('Live test requires a configured test Supabase project, SUPABASE_SECRET_KEY, a running Next app, and RUN_LIVE_TESTS=1. No live test was run.');process.exit(1);
}
const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const users=[],clients=[],rooms=[],channels=[];
const runId=randomUUID(),receiptPath=join(process.cwd(),'output','live-tests',runId+'.json');
async function saveReceipt(){
  await writeFile(receiptPath,JSON.stringify({runId,projectUrl:url,appUrl:base,rooms,userIds:users.map(session=>session.user.id)},null,2));
}
async function request(index,path,body){
  const res=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+users[index].access_token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  return {status:res.status,data:await res.json()};
}
const profile=(i)=>({name:'Live Test '+(i+1),role:i%2?'competitor':'monopolist',token:['briefcase','rocket','building','car','coin'][i]});
(async()=>{
  // Verify cleanup access before creating any persistent test data.
  const authAccess=await admin.auth.admin.listUsers({page:1,perPage:1});if(authAccess.error)throw authAccess.error;
  const dbAccess=await admin.from('mw_rooms').select('code').limit(1);if(dbAccess.error)throw dbAccess.error;
  await mkdir(join(process.cwd(),'output','live-tests'),{recursive:true});
  try{
    for(let i=0;i<5;i++){
      const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});clients.push(client);
      const {data,error}=await client.auth.signInAnonymously({options:{data:{live_test_run_id:runId}}});if(error)throw error;users.push(data.session);await saveReceipt();
    }
    const created=await request(0,'/api/rooms',{...profile(0),request_id:randomUUID()});assert.equal(created.status,201,created.data.error);
    let room=created.data.room;rooms.push(room.code);await saveReceipt();const path='/api/rooms/'+room.code;
    let resolveUpdate;const received=new Promise(resolve=>{resolveUpdate=resolve;});
    const channel=clients[0].channel('live-test-'+randomUUID()).on('postgres_changes',{event:'UPDATE',schema:'public',table:'mw_rooms',filter:'code=eq.'+room.code},payload=>resolveUpdate(payload.new));channels.push(channel);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Realtime subscription timed out.')),12000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(status==='CHANNEL_ERROR'){clearTimeout(timer);reject(Error('Realtime subscription failed.'));}});});
    for(let i=1;i<4;i++){const joined=await request(i,path,{operation:'join',...profile(i)});assert.equal(joined.status,200,joined.data.error);room=joined.data.room;}
    const update=await Promise.race([received,new Promise((_,reject)=>setTimeout(()=>reject(Error('No real Supabase Realtime update received.')),12000))]);assert.equal(update.code,room.code);
    assert.equal((await request(4,path,{operation:'join',...profile(4)})).status,409);
    assert.equal((await request(1,path,{operation:'start',revision:room.revision,request_id:randomUUID()})).status,403);
    const started=await request(0,path,{operation:'start',revision:room.revision,request_id:randomUUID()});assert.equal(started.status,200,started.data.error);room=started.data.room;
    assert.equal((await request(1,path,{operation:'action',action:'roll',revision:room.revision,request_id:randomUUID()})).status,403);
    const body={operation:'action',action:'roll',revision:room.revision,request_id:randomUUID()};
    const attempts=await Promise.all([request(0,path,body),request(0,path,{...body,request_id:randomUUID()})]);
    const attemptSummary=JSON.stringify(attempts.map(result=>({status:result.status,error:result.data.error})));
    assert.equal(attempts.filter(x=>x.status===200).length,1,attemptSummary);assert.equal(attempts.filter(x=>x.status===409).length,1,attemptSummary);
    const successful=attempts.find(x=>x.status===200);const retryBody=attempts[0].status===200?body:null;
    if(retryBody){const repeat=await request(0,path,retryBody);assert.equal(repeat.status,200);assert.equal(repeat.data.room.revision,successful.data.room.revision);}
    const restored=await request(1,path);assert.deepEqual(restored.data.room.state,successful.data.room.state);
    const denied=await clients[4].from('mw_rooms').select('*').eq('code',room.code);assert.equal(denied.data?.length,0);
    const writes=await clients[0].from('mw_rooms').update({revision:999}).eq('code',room.code);assert.ok(writes.error);
    const secrets=await clients[0].from('mw_game_secrets').select('*');assert.ok(secrets.error);
  }finally{
    const cleanupErrors=[];
    async function cleanup(label,operation){try{const result=await operation();if(result?.error)throw result.error;}catch(error){cleanupErrors.push(Error(label+': '+error.message));}}
    for(const channel of channels)await cleanup('Realtime unsubscribe',()=>channel.unsubscribe());
    for(const code of rooms)await cleanup('Delete test room '+code,()=>admin.from('mw_rooms').delete().eq('code',code));
    for(const session of users)await cleanup('Delete test identity '+session.user.id,()=>admin.auth.admin.deleteUser(session.user.id));
    for(const client of clients)await cleanup('Close Realtime channels',()=>client.removeAllChannels());
    if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'Test cleanup failed. Recovery IDs are in '+receiptPath+'. '+cleanupErrors.map(error=>error.message).join('; '));
    if(users.length||rooms.length)await unlink(receiptPath);
  }
  console.log('PASS real Supabase: four players, room capacity, host/turn permissions, Realtime delivery, concurrent rolls, restoration, RLS, and secret-state protection. Temporary room and all five test identities removed.');
})().catch(error=>{console.error('Live test failed:',error.message);process.exitCode=1;});
