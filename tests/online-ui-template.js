async (page) => {
  const fixture=/* FIXTURES */;
  for(const context of page.context().browser().contexts()) if(context!==page.context()) await context.close();
  await page.context().unrouteAll({behavior:'ignoreErrors'});
  const checks=[];const errors=[];const sockets=[];const connections=[];
  let room=null,botMode=false,botStep=4,botRequests=0;
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
      }else if(body.operation==='add-bot'){
        room.members.push({...fixture.botMember,seat:room.members.length});room.member_ids=room.members.map(m=>m.user_id);room.revision++;payload={room};broadcast('mw_rooms',room);
      }else if(body.operation==='remove-bot'){
        room.members=room.members.filter(m=>m.user_id!==body.bot_id).map((m,seat)=>({...m,seat}));room.member_ids=room.members.map(m=>m.user_id);room.revision++;payload={room};broadcast('mw_rooms',room);
      }else if(body.operation==='bot-step'){
        if(!botMode||room.state.currentPlayer!==1)throw Error('Bot attempted to take a human turn');
        botRequests++;room.state=clone(fixture.botStates[botStep]);room.revision++;room.updated_at=new Date().toISOString();
        room.transition={action:['roll','buy','build','end'][botStep-4],player:1,dice:room.state.dice,path:botStep===4?[1,2,3,4,5,6]:[],sounds:[]};
        botStep++;payload={room};broadcast('mw_rooms',room);
      }else if(body.operation==='heartbeat'){
        const old=connections.find(c=>c.client_id===body.client_id);
        const connection={code:room.code,user_id:actor,client_id:body.client_id,connected:body.connected!==false,seen_at:new Date().toISOString()};
        if(old)Object.assign(old,connection);else connections.push(connection);broadcast('mw_connections',connection);payload={ok:true};
      }else if(body.operation==='start'){
        if(actor!==room.host_id){status=403;payload={error:'Only the Host can start the game.'};}
        else{room.state=clone(botMode?fixture.botStates[0]:fixture.states[0]);room.status='playing';room.revision++;room.updated_at=new Date().toISOString();payload={room};broadcast('mw_rooms',room);}
      }else if(body.operation==='action'){
        const next=body.action==='roll'?(seat===0?1:4):body.action==='buy'?2:body.action==='end'?3:null;
        const special=body.action==='auction'?fixture.extras.auction:body.action==='bid'?fixture.extras.resold:null;
        if(next===null&&!special)throw Error('Unexpected fixture action '+body.action);
        room.state=clone(special||(botMode?fixture.botStates[next]:fixture.states[next]));room.revision++;room.updated_at=new Date().toISOString();
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
  await page.getByRole('button',{name:'Add bot +',exact:true}).click();
  await page.getByText('Bot · Ready',{exact:true}).waitFor();
  assert(await page.getByRole('button',{name:'Start Game'}).isEnabled(),'A human host can start with a bot opponent');
  await page.getByRole('button',{name:'Remove Bot Ada',exact:true}).click();
  assert(await page.locator('.lobby-player:not(.empty-seat)').count()===1,'Host can remove a bot before starting');
  assert(await page.locator('#room-code-display').inputValue()==='AB12CD','Host receives room code');
  assert((await page.locator('#room-link-display').inputValue()).endsWith('/game/AB12CD'),'Share link has the room route');
  await page.getByRole('button',{name:'Copy Code',exact:true}).click();
  assert((await page.locator('.copy-status').textContent()).length>0,'Copy Code gives feedback');
  await guest.goto('http://127.0.0.1:3000/game/AB12CD');await guest.locator('#online-name').fill('Guest');
  await guest.locator('#online-role').selectOption('competitor');await guest.locator('#online-token').selectOption('rocket');
  await guest.getByRole('button',{name:'Join lobby',exact:true}).click();await guest.locator('#room-code-display').waitFor();
  await page.getByText('Guest',{exact:true}).waitFor();
  assert(await guest.getByRole('button',{name:'Start Game'}).count()===0,'Guest cannot see a Start Game button');
  assert(await guest.getByRole('button',{name:'Add bot +',exact:true}).count()===0,'Guest cannot add or remove host-managed bots');
  assert(await page.locator('.lobby-player:not(.empty-seat)').count()===2,'Host sees both connected players');
  await guest.screenshot({path:'output/playwright/online-lobby-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Start Game'}).click();await page.locator('#game-screen').waitFor({state:'visible'});await guest.locator('#game-screen').waitFor({state:'visible'});
  await page.locator('#turn-action-card [data-action=roll]').waitFor();
  assert(await page.locator('#readable-board .readable-space').count()===40,'Clear board is the default and displays all 40 spaces');
  assert(await page.locator('#board-3d-container canvas').count()===0,'Default board does not require WebGL or zoom');
  assert(await guest.locator('#board-center [data-action=roll]').isDisabled(),'Guest cannot roll during host turn');
  await page.locator('#turn-action-card [data-action=roll]').click();
  await page.waitForFunction(()=>document.querySelector('#readable-dice').dataset.diceState==='rolling');
  assert(await page.locator('#turn-action-card .dice.rolling').count()===1,'Dice animate on both the board and action card');
  await page.locator('#modal [data-action=buy]').waitFor();
  assert(await page.locator('#modal [data-action=auction]').count()===0,'Unowned property offers purchase or skip, never an auction');
  assert(await page.locator('#readable-dice').getAttribute('data-dice-values')==='2,2','Clear board dice settle on the synchronized result');
  await page.locator('#modal [data-action=buy]').click();
  await guest.locator('#cash-0').filter({hasText:'$1,360'}).waitFor();
  assert(await guest.locator('#cash-0').textContent()==='$1,360','Purchase cash synchronized to guest');
  assert(await page.locator('#turn-action-card [data-action=roll]').count()===1,'Desktop doubles offer a visible Roll again button');
  assert((await guest.locator('#game-board [data-id="4"]').getAttribute('aria-label')).includes('owned by Host'),'Property ownership synchronized');
  await guest.locator('#readable-space-4 .readable-owner-icon').waitFor();
  assert((await guest.locator('#readable-space-4 .space-ownership').textContent()).includes('Owned by Host'),'Persistent board marker identifies the owner by full name');
  assert((await guest.locator('#ownership-notice').textContent()).includes('Now belongs to Host'),'Purchase popup is synchronized to the other player');
  await page.locator('#turn-action-card [data-action=end]').click();
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
  room.state=clone(fixture.extras.developed);room.revision++;room.transition={action:'build',player:0,dice:room.state.dice,path:[],sounds:['build']};broadcast('mw_rooms',room);
  await page.locator('.player-property[data-id="4"] [data-buildings="2"]').waitFor();
  await guest.locator('#readable-space-4 .space-buildings').filter({hasText:'2 houses'}).waitFor();
  assert(await page.locator('.player-property[data-id="4"] .house-icon').count()===2,'Player card lists two visible houses for this property');
  await guest.locator('#readable-space-4').click();
  assert(await guest.locator('#modal [data-buildings="2"] .house-icon').count()===2,'Property deed shows the owner and individual house icons');
  await guest.locator('#modal [data-action=close]').last().click();
  for(const width of [320,768,1024,1440]){
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+'px layout fits without page overflow');
    const textFits=await page.locator('.readable-space').evaluateAll(cards=>cards.every(card=>{
      const bounds=card.getBoundingClientRect();
      return bounds.left>=0&&bounds.right<=document.documentElement.clientWidth+1&&[...card.querySelectorAll('.space-name,.space-price,.space-ownership,.space-buildings,.space-visitors')].every(label=>{
        const style=getComputedStyle(label);
        return parseFloat(style.fontSize)>=14&&label.scrollWidth<=label.clientWidth+1&&label.scrollHeight<=label.clientHeight+1;
      });
    }));
    assert(textFits,width+'px board names, prices, owners and objects remain readable without zoom or clipping');
  }
  await page.locator('.player-property[data-id="4"]').click();await page.locator('#modal [data-action=manager]').click();
  await page.locator('#modal [data-action=auction][data-id="4"]').click();
  await guest.locator('#modal [data-action=bid]').waitFor();
  assert(await page.locator('#modal [data-action=bid]').isDisabled(),'Seller watches the live auction but cannot bid');
  await guest.locator('#bid-increment').fill('20');await guest.locator('#modal [data-action=bid]').click();
  await page.waitForFunction(()=>document.querySelector('#readable-space-4 .space-ownership').textContent.includes('Guest'));
  assert(await guest.locator('.player-card').filter({hasText:'Guest'}).locator('.player-property[data-id="4"] [data-buildings="2"]').count()===1,'Auction transfers the property and both houses to the winner');
  assert(await page.locator('#cash-0').textContent()==='$'+fixture.extras.resold.players[0].cash.toLocaleString('en-US'),'Winning bid is credited to the seller');
  await page.waitForTimeout(700); // Let the ownership and house entrance animations finish for visual inspection.
  await page.locator('[data-action=board-tabletop]').click();
  await page.locator('#board-3d-container canvas').waitFor();
  assert((await page.locator('.board-owner-marker[data-property="4"]').getAttribute('aria-label')).includes('Guest'),'Optional 3D view retains ownership and houses');
  await page.locator('[data-action=board-clear]').click();
  assert(await page.locator('#clear-board-view').isVisible(),'Switching back restores the clear board');
  await page.locator('[data-action=locate-token]').click();
  assert(await page.locator('#readable-space-4').evaluate(el=>el===document.activeElement),'Your token button locates and focuses the correct space');
  await page.keyboard.press('Enter');
  assert(await page.locator('#modal [data-buildings="2"]').count()===1,'Board spaces open their deeds from the keyboard');
  await page.locator('#modal [data-action=close]').last().click();
  await page.locator('#ownership-notice').waitFor({state:'hidden'});
  await page.locator('.board-tools').evaluate(el=>el.scrollIntoView({block:'start'}));
  await page.screenshot({path:'output/playwright/clear-board-desktop.png'});
  await guest.locator('.board-tools').evaluate(el=>el.scrollIntoView({block:'start'}));
  await guest.screenshot({path:'output/playwright/clear-board-mobile.png'});
  await guest.locator('#readable-space-4').evaluate(el=>el.scrollIntoView({block:'center'}));
  await guest.screenshot({path:'output/playwright/clear-board-mobile-houses.png'});
  await guestContext.addInitScript(()=>{const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:getContext.call(this,type,...args);};});
  await guest.reload();await guest.locator('#clear-board-view').waitFor();
  await guest.locator('[data-action=board-tabletop]').click();
  assert(await guest.locator('#clear-board-view').isVisible(),'Device without WebGL keeps the full readable board');
  room.state=clone(fixture.extras.event);room.revision++;room.transition={action:'roll',player:0,dice:room.state.dice,path:[],sounds:[]};broadcast('mw_rooms',room);
  await page.locator('#modal .event-card').waitFor();await guest.locator('#modal .event-card').waitFor();
  assert(await guest.locator('#modal [data-action=apply-event]').isDisabled(),'Both players see the event card and only its player can resolve it');
  await page.screenshot({path:'output/playwright/animated-event-card.png',fullPage:true});
  await guest.emulateMedia({reducedMotion:'reduce'});await guest.reload();await guest.locator('#modal .event-card').waitFor();
  assert(await guest.locator('#modal .event-card').evaluate(el=>el.getAnimations().length===0),'Reduced motion suppresses card animation and preserves event state');
  await guestContext.close();
  botMode=true;
  await page.goto('http://127.0.0.1:3000');await page.getByRole('button',{name:'Create Game',exact:true}).click();
  await page.locator('#online-name').fill('Host');await page.getByRole('button',{name:'Create Game',exact:true}).click();
  await page.getByRole('button',{name:'Add bot +',exact:true}).click();
  await page.getByText('Bot · Ready',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'output/playwright/bot-lobby-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Start Game'}).click();
  await page.locator('.mobile-controls [data-action=roll]').click();
  await page.locator('#modal [data-action=buy]').click();
  await page.locator('.mobile-controls [data-action=end]').click();
  await page.locator('#readable-dice[data-dice-state=rolling]').waitFor();
  assert(await page.locator('.mobile-controls [data-action=roll]').isDisabled(),'Human controls lock while the bot rolls');
  await page.reload();await page.locator('#game-screen').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#readable-space-6 .space-buildings')?.textContent.includes('1 house'),{},{timeout:20000});
  await page.waitForFunction(()=>!document.querySelector('.mobile-controls [data-action=roll]').disabled);
  assert(botRequests===4,'Bot automatically rolls, buys, builds and ends once across a browser refresh');
  assert((await page.locator('#readable-space-6 .space-ownership').textContent()).includes('Bot Ada'),'Bot ownership appears on the shared board');
  assert(await page.locator('.bot-badge').count()===1,'Bot player is clearly marked during play');
  await page.locator('#readable-space-6').evaluate(el=>el.scrollIntoView({block:'center'}));
  await page.screenshot({path:'output/playwright/bot-game-mobile.png'});
  assert(errors.length===0,'No browser runtime errors: '+errors.join('; '));
  return {transport:'Mocked Supabase Auth, HTTP and Realtime; real browser client and rules fixtures',checks};
}
