async (page) => {
  const fixture=/* FIXTURES */;
  for(const context of page.context().browser().contexts()) if(context!==page.context()) await context.close();
  await page.context().unrouteAll({behavior:'ignoreErrors'});
  const checks=[];const errors=[];const sockets=[];const connections=[];
  let room=null;
  const assert=(condition,message)=>{if(!condition)throw Error(message);checks.push(message);};
  const clone=v=>JSON.parse(JSON.stringify(v));
  const broadcast=(table,record)=>{
    for(const s of sockets)if(s.topic){const id=s.changes.find(c=>c.table===table)?.id;if(id!==undefined)s.ws.send(JSON.stringify([s.join,null,s.topic,'postgres_changes',{ids:[id],data:{schema:'public',table,type:'UPDATE',record,old_record:{},commit_timestamp:new Date().toISOString(),columns:[],errors:null}}]));}
  };
  async function setup(context,seat){
    await context.route('**/auth/v1/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(route.request().url().includes('/user')?fixture.sessions[seat].user:fixture.sessions[seat])}));
    await context.routeWebSocket('**/realtime/v1/websocket**',ws=>{
      const s={ws,topic:null,join:null,changes:[]};sockets.push(s);
      ws.onMessage(raw=>{
        const [join,ref,topic,event,payload]=JSON.parse(String(raw));
        if(event==='phx_join'){
          s.topic=topic;s.join=join;s.changes=(payload.config?.postgres_changes||[]).map((c,i)=>({...c,id:i+1}));
          ws.send(JSON.stringify([join,ref,topic,'phx_reply',{status:'ok',response:{postgres_changes:s.changes}}]));
        }else if(event==='heartbeat'||event==='phx_leave')ws.send(JSON.stringify([join,ref,topic,'phx_reply',{status:'ok',response:{}}]));
      });
      ws.onClose(()=>{s.topic=null;});
    });
    await context.route('**/api/rooms**',async route=>{
      const req=route.request(),body=req.method()==='POST'?req.postDataJSON():null;
      const actor=fixture.members[seat].user_id;
      let status=200,payload;
      if(!body){if(!room||!room.member_ids.includes(actor)){status=403;payload={error:'Join this room to access the lobby.'};}else payload={room,connections};}
      else if(req.url().endsWith('/api/rooms')){
        room={code:'AB12CD',host_id:actor,created_by:actor,creation_id:body.request_id,members:[fixture.members[0]],member_ids:[actor],status:'lobby',revision:0,state:null,transition:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};payload={room};
      }else if(body.operation==='join'){
        if(!room.member_ids.includes(actor)){room.members.push(fixture.members[seat]);room.member_ids.push(actor);room.revision++;broadcast('mw_rooms',room);}payload={room};
      }else if(body.operation==='heartbeat'){
        const old=connections.find(c=>c.client_id===body.client_id);
        const connection={code:room.code,user_id:actor,client_id:body.client_id,connected:body.connected!==false,seen_at:new Date().toISOString()};
        if(old)Object.assign(old,connection);else connections.push(connection);broadcast('mw_connections',connection);payload={ok:true};
      }else if(body.operation==='start'){
        if(actor!==room.host_id){status=403;payload={error:'Only the Host can start the game.'};}
        else{room.state=clone(fixture.states[0]);room.status='playing';room.revision++;payload={room};broadcast('mw_rooms',room);}
      }else if(body.operation==='action'){
        const next=body.action==='roll'?(seat===0?1:4):body.action==='buy'?2:body.action==='end'?3:null;
        if(next===null)throw Error('Unexpected fixture action '+body.action);
        room.state=clone(fixture.states[next]);room.revision++;
        room.transition={action:body.action,player:seat,dice:room.state.dice,path:body.action==='roll'?[1,2,3,4]:[],sounds:body.action==='roll'?(seat===0?['dice']:['dice','visitor']):[]};
        payload={room};broadcast('mw_rooms',room);
      }else throw Error('Unexpected fixture operation '+body.operation);
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(payload)});
    });
    // Test cookies remain in the browser, while server rendering is anonymous.
    await context.route('**/game/**',route=>{const headers={...route.request().headers()};delete headers.cookie;return route.continue({headers});});
    await context.addInitScript(()=>{
      window.__audioCalls=[];const play=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=function(){window.__audioCalls.push(this.src);return play.call(this);};
    });
  }
  const hostContext=page.context();await hostContext.clearCookies();await setup(hostContext,0);
  const guestContext=await hostContext.browser().newContext({viewport:{width:390,height:844}});await setup(guestContext,1);
  const guest=await guestContext.newPage();
  page.on('pageerror',e=>errors.push(e.message));guest.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3000');await page.getByRole('button',{name:'Create Game',exact:true}).click();
  await page.locator('#online-name').fill('Host');await page.getByRole('button',{name:'Create Game',exact:true}).click();
  await page.locator('#room-code-display').waitFor();
  assert(await page.locator('#room-code-display').inputValue()==='AB12CD','Host receives room code');
  assert((await page.locator('#room-link-display').inputValue()).endsWith('/game/AB12CD'),'Share link has the room route');
  await page.getByRole('button',{name:'Copy Code',exact:true}).click();
  assert((await page.locator('.copy-status').textContent()).length>0,'Copy Code gives feedback');
  await guest.goto('http://127.0.0.1:3000/game/AB12CD');await guest.locator('#online-name').fill('Guest');
  await guest.locator('#online-role').selectOption('competitor');await guest.locator('#online-token').selectOption('rocket');
  await guest.getByRole('button',{name:'Join lobby',exact:true}).click();await guest.locator('#room-code-display').waitFor();
  await page.getByText('Guest',{exact:true}).waitFor();
  assert(await guest.getByRole('button',{name:'Start Game'}).count()===0,'Guest cannot see a Start Game button');
  assert(await page.locator('.lobby-player:not(.empty-seat)').count()===2,'Host sees both connected players');
  await guest.screenshot({path:'output/playwright/online-lobby-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Start Game'}).click();await page.locator('#game-screen').waitFor({state:'visible'});await guest.locator('#game-screen').waitFor({state:'visible'});
  await page.locator('#board-center [data-action=roll]').waitFor();
  assert(await guest.locator('#board-center [data-action=roll]').isDisabled(),'Guest cannot roll during host turn');
  await page.locator('#board-center [data-action=roll]').click();
  await page.locator('#modal [data-action=buy]').waitFor();await page.locator('#modal [data-action=buy]').click();
  await guest.locator('#cash-0').filter({hasText:'$1,360'}).waitFor();
  assert(await guest.locator('#cash-0').textContent()==='$1,360','Purchase cash synchronized to guest');
  assert((await guest.locator('#game-board [data-id="4"]').getAttribute('aria-label')).includes('owned by Host'),'Property ownership synchronized');
  await page.locator('#board-center [data-action=end]').click();
  await guest.waitForFunction(()=>!document.querySelector('#board-center [data-action=roll]').disabled);
  assert(await page.locator('#board-center [data-action=roll]').isDisabled(),'Host cannot roll during guest turn');
  await guest.locator('.mobile-controls [data-action=roll]').click();
  await page.locator('#cash-0').filter({hasText:'$1,372'}).waitFor();
  assert(await guest.locator('#cash-1').textContent()==='$1,488','Rent deducted on the guest device');
  assert(await page.locator('#cash-0').textContent()==='$1,372','Rent credited on the host device');
  await guest.waitForFunction(()=>window.__audioCalls.some(s=>s.endsWith('/faah_sound.mpeg')));
  const sound=await guest.evaluate(()=>window.__audioCalls);
  assert(sound.some(s=>s.endsWith('/Dice_sound.mpeg')),'Dice sound plays during online roll');
  assert(sound.some(s=>s.endsWith('/faah_sound.mpeg')),'Visitor sound plays on another player property');
  const before=await guest.locator('#turn-label').textContent();
  await guest.reload();await guest.locator('#game-screen').waitFor({state:'visible'});
  assert(await guest.locator('#turn-label').textContent()===before,'Refresh restores the same turn');
  assert(await guest.locator('#cash-1').textContent()==='$1,488','Refresh retains money and room identity');
  await guestContext.setOffline(true);
  await guest.waitForFunction(()=>document.querySelector('#board-center [data-action=roll]').disabled);
  assert(await guest.locator('#board-center [data-action=roll]').isDisabled(),'Offline player cannot submit moves');
  await guestContext.setOffline(false);
  await guest.waitForFunction(()=>!document.querySelector('#board-center [data-action=roll]').disabled);
  assert(await guest.locator('#cash-1').textContent()==='$1,488','Reconnect restores the latest state');
  await guest.setViewportSize({width:320,height:740});
  assert(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'320px phone has no page overflow');
  await guest.setViewportSize({width:390,height:844});await guest.screenshot({path:'output/playwright/online-game-mobile.png',fullPage:true});
  await page.setViewportSize({width:1366,height:900});await page.screenshot({path:'output/playwright/online-game-desktop.png',fullPage:true});
  await guest.goto('http://127.0.0.1:3000');await guest.getByRole('button',{name:'Join Game',exact:true}).click();
  await guest.locator('#join-room-code').fill('AB12CD');await guest.getByRole('button',{name:'Join lobby',exact:true}).click();
  await guest.locator('#game-screen').waitFor({state:'visible'});
  assert(await guest.locator('#cash-1').textContent()==='$1,488','Manual room-code entry rejoins the same game');
  assert(errors.length===0,'No browser runtime errors: '+errors.join('; '));
  await guestContext.close();
  return {transport:'Mocked Supabase Auth, HTTP and Realtime; real browser client and rules fixtures',checks};
}
