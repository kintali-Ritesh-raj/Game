async (page) => {
  const progress={last:'(none)'};
  try { return await run(page,progress); }
  catch (error) { throw Error(String(error.message).split(String.fromCharCode(10))[0]+' | last passing check: '+progress.last); }
  async function run(page,progress){
  const fixture=/* FIXTURES */;
  for(const context of page.context().browser().contexts()) if(context!==page.context()) await context.close();
  await page.context().unrouteAll({behavior:'ignoreErrors'});
  const checks=[];const errors=[];const sockets=[];const connections=[];
  let room=null,botMode=false,botStep=4,botRequests=0;
  const assert=(condition,message)=>{if(!condition)throw Error(message);checks.push(message);progress.last=message;};
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
      }else if(body.operation==='profile'){const member=room.members.find(m=>m.user_id===actor);Object.assign(member,{name:body.name,token:body.token},[4,5,6].includes(body.sides)?{sides:body.sides}:{});room.revision++;payload={room};broadcast('mw_rooms',room);
      }else if(body.operation==='peek'){payload={status:room?.status||'lobby',players:room?.members.length||0,taken:(room?.members||[]).map(m=>m.token)};
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
      }else if(body.operation==='timeout'){
        payload={room}; // Fixture turns never expire; the server decides real timeouts.
      }else if(body.operation==='rejoin-code'){
        payload={rejoin_code:seat===0?'HSTA-2345':'GSTB-6789'};
      }else throw Error('Unexpected fixture operation '+body.operation);
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(payload)});
    });
    // Test cookies remain in the browser, while server rendering is anonymous.
    await context.route('**/game/**',route=>{const headers={...route.request().headers()};delete headers.cookie;return route.continue({headers});});
    await context.addInitScript(()=>{
      // These checks exercise the 2D board; start each tab on it once (the 3D view has its own checks).
      try{if(!sessionStorage.getItem('mw-board-pinned')){localStorage.setItem('market-wars-board-view','2d');sessionStorage.setItem('mw-board-pinned','1');}}catch{}
      window.__audioCalls=[];const play=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=function(){window.__audioCalls.push(this.src);return play.call(this);};
    });
  }
  await page.setViewportSize({width:1366,height:900});
  const hostContext=page.context();await hostContext.clearCookies();await setup(hostContext,0);
  const guestContext=await hostContext.browser().newContext({viewport:{width:390,height:844}});await setup(guestContext,1);
  const guest=await guestContext.newPage();
  page.on('pageerror',e=>errors.push(e.message));guest.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:3000');
  // A reused browser session may remember an earlier run: start this run on the 2D board.
  await page.evaluate(()=>{sessionStorage.setItem('mw-board-pinned','1');localStorage.setItem('market-wars-board-view','2d');});
  await page.getByRole('button',{name:'Create Game',exact:true}).click();
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
  assert(await page.locator('.lobby-board .board-option').count()===2&&(await page.locator('.lobby-board .board-option.selected').textContent()).includes('Classic'),'The Host picks the board in the lobby: Classic or Skyline (5 sides); the hexagon is gone');
  await guest.goto('http://localhost:3000/game/AB12CD');await guest.locator('#online-name').fill('Guest');
  await guest.locator('.token-option.taken:has(input[value=black])').waitFor({timeout:8000});
  assert(await guest.locator('.token-option:has(input[value=black]) input').isDisabled()&&(await guest.locator('.token-option.taken').count())===1,'A joining player sees the colour already chosen by the Host as taken and cannot pick it');
  assert(await guest.locator('.board-picker').count()===0,'Only the Host chooses the board');
  assert(await guest.locator('.token-option').count()===6,'The player form offers exactly the six colour markers');
  await guest.locator('.token-option:has(input[value=blue])').click();
  await guest.getByRole('button',{name:'Join lobby',exact:true}).click();await guest.locator('#room-code-display').waitFor();
  await page.locator('.lobby-player').getByText('Guest',{exact:true}).waitFor();
  assert(await guest.getByRole('button',{name:'Start Game'}).count()===0,'Guest cannot see a Start Game button');
  assert(await guest.getByRole('button',{name:'Add bot +',exact:true}).count()===0,'Guest cannot add or remove host-managed bots');
  assert(await page.locator('.lobby-player:not(.empty-seat)').count()===2,'Host sees both connected players');
  assert(await page.locator('.lobby-player').count()===6&&(await page.locator('.lobby-topline').textContent()).includes('2 / 6 PLAYERS')&&await page.locator('.lobby-color').count()===6,'The table seats up to six players in six colours');
  await guest.locator('.lobby-color.taken').nth(1).waitFor();
  assert(await guest.locator('.lobby-color.taken').count()===2&&(await guest.locator('.lobby-colors').textContent()).includes('Host'),'Every player sees which colours are taken, and by whom');
  await page.locator('.lobby-board .board-option:has-text("Skyline")').click();
  await guest.locator('.lobby-board-choice:has-text("Skyline")').waitFor({timeout:8000});
  assert((await guest.locator('.lobby-board-choice').textContent()).includes('Pentagon · 50 spaces'),'The Host’s board choice is shown to every player');
  await page.locator('.online-lobby').screenshot({path:'output/playwright/lobby-colors-board.png'});
  await page.locator('.lobby-board .board-option:has-text("Classic")').click();await guest.locator('.lobby-board-choice:has-text("Classic")').waitFor({timeout:8000});
  await guest.screenshot({path:'output/playwright/online-lobby-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Start Game'}).click();await page.locator('#game-screen').waitFor({state:'visible'});await guest.locator('#game-screen').waitFor({state:'visible'});
  await page.locator('#turn-action-card [data-action=roll]').waitFor();
  assert(await page.locator('#classic-board-view').isVisible() && await page.locator('#game-board .board-tile').count()===40,'Original square board is the default and displays all 40 spaces');
  assert(await page.locator('.board-view-toggle').count()===0&&await page.locator('canvas').count()===0,'There is no 3D board or 2D/3D switch');
  const nameSize=()=>page.locator('#game-board [data-id="1"] .tile-name').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  await page.locator('[data-action=zoom-fit]').click();await page.waitForTimeout(200);
  const nameBefore=await nameSize();
  await page.locator('[data-action=zoom-in]').click();await page.locator('[data-action=zoom-in]').click();
  await page.waitForFunction(()=>document.getElementById('board-viewport').classList.contains('zoomed'));
  const zoomedSize=await nameSize();
  assert(Math.abs(zoomedSize/nameBefore-1.5)<.08&&(await page.locator('#zoom-level').textContent())==='150%','Zooming lays the board out larger (text 1.5x at 150%), so it stays vector-sharp');
  await page.locator('[data-action=zoom-fit]').click();
  assert(Math.abs(await nameSize()-nameBefore)<.01&&!(await page.locator('#board-viewport').evaluate(el=>el.classList.contains('zoomed'))),'Fit returns to the whole board');
  assert(await page.locator('#token-layer .player-token').count()===2,'Both players have visible tokens on the square board');
  const reveal=page.getByRole('button',{name:'Show rejoin code',exact:true});if(await reveal.count())await reveal.click();
  await page.locator('.rejoin-code',{hasText:'HSTA-2345'}).waitFor();
  assert(true,'Each player can reveal their private rejoin code');
  assert(await page.locator('#board-3d-container').count()===0&&await page.locator('[data-action=board-clear],[data-action=board-tabletop]').count()===0,'Only the square board is offered (List and 3D views removed)');
  assert(await guest.locator('#board-center [data-action=roll]').isDisabled(),'Guest cannot roll during host turn');
  await page.locator('#turn-action-card [data-action=roll]').click();
  await page.locator('#board-center .dice.rolling').waitFor();
  assert(await page.locator('#turn-action-card .dice.rolling').count()===1,'Dice animate on both the board and action card');
  await page.waitForTimeout(320);await page.locator('#board-center').screenshot({path:'output/playwright/dice-rolling.png'});
  await page.locator('#modal [data-action=buy]').waitFor();
  assert(await page.locator('#modal [data-action=auction]').count()===0,'Unowned property offers purchase or skip, never an auction');
  assert((await page.locator('#board-center .dice-total').textContent()).includes('4 TOTAL'),'Board dice settle on the synchronized result');
  await page.locator('#modal [data-action=buy]').click();
  await guest.locator('#cash-0').filter({hasText:'$1,360'}).waitFor();
  assert(await guest.locator('#cash-0').textContent()==='$1,360','Purchase cash synchronized to guest');
  await page.waitForFunction(()=>document.querySelector('#turn-action-card [data-action=end]')?.disabled===false,{},{timeout:10000});
  assert(true,'After a non-doubles landing the turn can be ended');
  assert((await guest.locator('#game-board [data-id="4"]').getAttribute('aria-label')).includes('owned by Host'),'Property ownership synchronized');
  await guest.locator('#game-board [data-id="4"][aria-label*="owned by Host"]').waitFor();
  assert(await guest.locator('#classic-token-0').getAttribute('data-space')==='4','Host token moves to the purchased space on both boards');
  await guest.locator('#toast-stack .toast-item',{hasText:'Host purchased Puri Beach'}).waitFor();
  assert(await guest.locator('#ownership-notice').count()===0,'Purchase appears as a top notification for the other player, with no duplicate corner card');
  assert(await guest.locator('#toast-stack .toast-item.tone-deal',{hasText:'Host purchased Puri Beach'}).count()===1&&(await guest.locator('#toast-stack .toast-item.tone-deal .toast-title').first().textContent())==='Purchased','A purchase notification is styled as a deal and names the buyer');
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
  // Go offline only once the reloaded page has attached its connection listeners.
  await guest.locator('.network-status.is-connected').waitFor();
  await guestContext.setOffline(true);
  await guest.waitForFunction(()=>document.querySelector('#board-center [data-action=end]').disabled);
  assert(await guest.locator('#board-center [data-action=end]').isDisabled(),'Offline player cannot submit moves');
  await guestContext.setOffline(false);
  await guest.waitForFunction(()=>!document.querySelector('#board-center [data-action=end]').disabled);
  assert(await guest.locator('#cash-1').textContent()==='$1,488','Reconnect restores the latest state');
  await guest.setViewportSize({width:320,height:740});
  assert(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'320px phone has no page overflow');
  await guest.setViewportSize({width:390,height:844});await guest.screenshot({path:'output/playwright/online-game-mobile.png',fullPage:true});
  await page.setViewportSize({width:1366,height:900});await page.screenshot({path:'output/playwright/online-game-desktop.png',fullPage:true});
  await guest.goto('http://localhost:3000');await guest.getByRole('button',{name:'Join Game',exact:true}).click();
  await guest.locator('#join-room-code').fill('AB12CD');await guest.getByRole('button',{name:'Join lobby',exact:true}).click();
  await guest.locator('#game-screen').waitFor({state:'visible'});
  assert(await guest.locator('#cash-1').textContent()==='$1,488','Manual room-code entry rejoins the same game');
  room.state=clone(fixture.extras.developed);room.revision++;room.transition={action:'build',player:0,dice:room.state.dice,path:[],sounds:['build']};broadcast('mw_rooms',room);
  await page.locator('.player-property[data-id="4"][data-buildings="2"]').waitFor();
  assert(await page.locator('[data-pieces="4"] .piece-house').count()===2&&await page.locator('[data-pieces="4"] .piece-tower').count()===0,'Board shows two owner-coloured miniature houses on the developed property');
  assert(await page.locator('[data-pieces="4"] .piece-badge').getAttribute('data-owner')==='0','Ownership shield uses the owner (Host) while the colour band keeps the property group');
  await page.locator('#turn-action-card [data-action=trade-compose]').click();await page.locator('#trade-target').waitFor();
  assert(await page.locator('.trade-side').first().locator('[data-trade-side=give]:not([disabled])').count()===3&&(await page.locator('.trade-side').first().innerText()).includes('2 HOUSES'),'Every owned property can be offered, houses included, and the houses are shown');
  assert((await page.locator('.trade-side').nth(1).innerText()).includes('owns no properties yet'),'Trade window says when the other player owns nothing');
  await page.locator('#modal [data-action=close]').first().click();
  for(const width of [390,1366,1920]){
    await page.setViewportSize({width,height:900});await page.waitForTimeout(300);
    const stray=await page.locator('#game-board').evaluate(board=>{
      const tol=1.5,bad=[],inside=(r,t)=>r.left>=t.left-tol&&r.right<=t.right+tol&&r.top>=t.top-tol&&r.bottom<=t.bottom+tol;
      const hit=(a,b)=>a.left<b.right-tol&&b.left<a.right-tol&&a.top<b.bottom-tol&&b.top<a.bottom-tol;
      board.querySelectorAll('.tile-pieces').forEach(anchor=>{
        const tile=board.querySelector('.board-tile[data-id="'+anchor.dataset.pieces+'"]'),t=tile.getBoundingClientRect();
        const text=[...tile.querySelectorAll('.tile-name,.tile-price')].map(el=>el.getBoundingClientRect());
        anchor.querySelectorAll('.piece-badge svg,.piece-house svg,.piece-tower svg').forEach(el=>{const r=el.getBoundingClientRect();if(!inside(r,t)||text.some(x=>hit(r,x)))bad.push(anchor.dataset.pieces);});
      });
      board.querySelectorAll('.player-token:not([hidden]) .pawn-art').forEach(art=>{const token=art.closest('.player-token');if(!inside(art.getBoundingClientRect(),board.querySelector('.board-tile[data-id="'+token.dataset.space+'"]').getBoundingClientRect()))bad.push('pawn@'+token.dataset.space);});
      return bad;
    });
    assert(stray.length===0,width+'px every shield, house, tower and pawn stays inside its own card and clear of the property text ('+stray.join(',')+')');
  }
  for(const width of [1366,1920]){await page.setViewportSize({width,height:900});await page.waitForTimeout(200);
    assert(await page.locator('#player-cards').evaluate(el=>el.scrollHeight<=el.clientHeight+1&&[...el.querySelectorAll('.player-card')].every(card=>card.getBoundingClientRect().height<110)),width+'px every player card is compact and the list needs no scrolling');}
  for(const width of [320,768,1024,1440]){
    await page.setViewportSize({width,height:900});
    await page.waitForTimeout(250); // Let token positions settle after responsive layout changes.
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+'px square board fits without page overflow '+await page.evaluate(()=>document.documentElement.scrollWidth+' '+[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,6).map(el=>el.tagName+'.'+el.className+'@'+Math.round(el.getBoundingClientRect().right)).join(' ')));
    const offSpace=await page.locator('#game-board').evaluate(board=>[...board.querySelectorAll('.player-token:not([hidden])')].map(token=>{
      // A pawn's base must be on its space.
      const marker=token.getBoundingClientRect(),tile=board.querySelector('.board-tile[data-id="'+token.dataset.space+'"]').getBoundingClientRect();
      const baseX=marker.left+marker.width/2,baseY=marker.top+marker.height*.94;
      const miss=Math.max(tile.left-baseX,baseX-tile.right,tile.top-baseY,baseY-tile.bottom,0);
      return miss>2?token.id+'@'+token.dataset.space+' off by '+Math.round(miss)+'px (base '+Math.round(baseX)+','+Math.round(baseY)+' tile '+[tile.left,tile.top,tile.right,tile.bottom].map(Math.round)+' transition '+token.style.transition+')':'';
    }).filter(Boolean));
    assert(offSpace.length===0,width+'px pawns remain on their correct spaces after resize '+offSpace.join('; '));
  assert(await page.locator('#game-board .player-token .pawn-art').count()===2,'Players are shown as shaded 3D pawns rather than flat markers');
    const geometry=await page.locator('#game-board').evaluate(board=>{
      const r=board.getBoundingClientRect();
      const corners=[0,10,20,30].map(id=>{const t=board.querySelector('[data-id="'+id+'"]').getBoundingClientRect();return {x:t.x-r.x,y:t.y-r.y};});
      return {square:Math.abs(r.width-r.height)<2,visible:r.width>250,corners};
    });
    assert(geometry.square&&geometry.visible&&geometry.corners[0].x>geometry.corners[1].x&&geometry.corners[0].y>geometry.corners[2].y,width+'px board keeps its square perimeter and four corners');
  }
  await page.locator('[data-action=locate-token]').click();
  assert(await page.locator('#game-board [data-id="4"]').evaluate(el=>el===document.activeElement),'Your token focuses the correct square-board space');
  await page.keyboard.press('Enter');
  assert(await page.locator('#modal [data-buildings="2"] .house-icon').count()===2,'Square-board deed opens from the keyboard with the correct buildings');
  await page.locator('#modal [data-action=close]').last().click();
  await page.evaluate(()=>window.scrollTo(0,0));
  await guest.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'output/playwright/classic-board-desktop.png'});
  await guest.screenshot({path:'output/playwright/classic-board-mobile.png'});
  assert((await page.locator('.player-property[data-id="4"]').textContent())==='2'&&(await page.locator('.player-property[data-id="4"]').getAttribute('title')).includes('2 houses'),'The player card chip for this property shows its 2 houses');
  await guest.locator('#game-board [data-id="4"]').click();
  assert(await guest.locator('#modal [data-buildings="2"] .house-icon').count()===2,'Property deed shows the owner and individual house icons');
  assert((await guest.locator('#modal .rent-table thead').textContent()).includes('All 3 owned')&&(await guest.locator('#modal .rent-table tbody tr').nth(3).textContent()).includes('$288')&&(await guest.locator('#modal .rent-table tbody tr').nth(3).textContent()).includes('$576'),'The deed shows every rent doubled for owning the full color set');
  await guest.locator('#modal [data-action=close]').last().click();
  await page.locator('.player-property[data-id="4"]').click();await page.locator('#modal [data-action=manager]').click();
  await page.locator('#modal [data-action=auction][data-id="4"]').click();
  await guest.locator('#modal [data-action=bid]').waitFor();
  assert(await page.locator('#modal [data-action=bid]').isDisabled(),'Seller watches the live auction but cannot bid');
  await guest.locator('#bid-increment').fill('20');await guest.locator('#modal [data-action=bid]').click();
  await page.waitForFunction(()=>document.querySelector('#game-board [data-id="4"]').getAttribute('aria-label').includes('owned by Guest'));
  await page.locator('[data-pieces="4"] .piece-badge[data-owner="1"]').waitFor();
  assert(await page.locator('[data-pieces="4"] .piece-house').count()===2,'After the auction the shield and both houses switch to the new owner');
  assert(await guest.locator('.player-card').filter({hasText:'Guest'}).locator('.player-property[data-id="4"][data-buildings="2"]').count()===1,'Auction transfers the property and both houses to the winner');
  await guest.locator('#player-cards').screenshot({path:'output/playwright/player-list.png'});
  assert(await page.locator('#cash-0').textContent()==='$'+fixture.extras.resold.players[0].cash.toLocaleString('en-US'),'Winning bid is credited to the seller');
  await page.waitForTimeout(700); // Let the ownership and house entrance animations finish for visual inspection.
  await page.locator('.board-tools').evaluate(el=>el.scrollIntoView({block:'start'}));
  await page.screenshot({path:'output/playwright/after-auction-desktop.png'});
  await guest.locator('#game-board').evaluate(el=>el.scrollIntoView({block:'center'}));
  await guest.screenshot({path:'output/playwright/after-auction-mobile.png'});
  room.state=clone(fixture.extras.event);room.revision++;room.transition={action:'roll',player:0,dice:room.state.dice,path:[],sounds:[]};broadcast('mw_rooms',room);
  await page.locator('#modal .event-card').waitFor();await guest.locator('#modal .event-card').waitFor();
  assert(await guest.locator('#modal [data-action=apply-event]').isDisabled(),'Both players see the event card and only its player can resolve it');
  await page.screenshot({path:'output/playwright/animated-event-card.png',fullPage:true});
  await guest.emulateMedia({reducedMotion:'reduce'});await guest.reload();await guest.locator('#modal .event-card').waitFor();
  assert(await guest.locator('#modal .event-card').evaluate(el=>el.getAnimations().length===0),'Reduced motion suppresses card animation and preserves event state');
  assert(await page.locator('#modal .rarity-tag').count()===1&&/^(COMMON|UNCOMMON|RARE)$/.test(await page.locator('#modal .rarity-tag').textContent()),'The event card shows its rarity');
  room.state=clone(fixture.extras.dieCard);room.revision++;room.transition={action:'roll',player:0,dice:room.state.dice,path:[],sounds:[]};broadcast('mw_rooms',room);
  await page.locator('#modal [data-action=apply-event]:has-text("Roll the die")').waitFor();await guest.locator('#modal .event-card h3:has-text("IPL fever")').waitFor();
  assert((await page.locator('#modal [data-action=apply-event]').textContent()).includes('Roll the die')&&(await page.locator('#modal').textContent()).includes('Nothing is rolled until you press the button'),'A die card waits for the player to press Roll the die');
  assert(await page.locator('#modal [data-action=apply-event]').isEnabled()&&await guest.locator('#modal [data-action=apply-event]').isDisabled()&&(await guest.locator('#modal').textContent()).includes('rolls the die'),'Only the drawing player can roll the card die; the others see who must roll');
  room.state=clone(fixture.extras.dieRolled);room.revision++;room.transition={action:'apply-event',player:0,dice:room.state.dice,path:[],sounds:['income']};broadcast('mw_rooms',room);
  await page.locator('#fx-stage .fx-cube').waitFor();
  assert(await page.locator('#fx-stage .fx-face').count()===6&&await page.locator('#fx-stage .fx-cube').evaluate(el=>el.getAnimations().length>0),'The card die is thrown as a tumbling 3D cube');
  assert(await page.locator('#toast-stack .toast-item',{hasText:'received $60'}).count()===0,'The result toast waits until the die has landed');
  // Both screens at once: the guest uses reduced motion, so its die shows the result straight away and closes sooner.
  const [hostResult,guestResult]=await Promise.all([page,guest].map(p=>p.locator('#fx-stage .fx-result:not([hidden])').waitFor({timeout:6000}).then(()=>p.locator('#fx-stage .fx-result b').textContent())));
  assert(hostResult==='+$60'&&guestResult==='+$60'&&(await page.locator('#fx-stage .fx-result span').textContent()).includes('2 × $30'),'Every player sees the die land on the server roll and the amount it pays');
  assert(await page.locator('#fx-stage.tone-gain').count()===1,'A winning card die is shown in the gain colour');
  await page.locator('#fx-stage').screenshot({path:'output/playwright/card-die.png'});
  await page.locator('#toast-stack .toast-item.tone-gain',{hasText:'Host received $60'}).waitFor({timeout:8000});
  assert(await page.locator('#fx-stage').count()===0,'The die closes before the result notification appears');
  await page.waitForFunction(()=>[...document.querySelectorAll('#toast-stack .toast-item.tone-gain .toast-amount')].some(el=>el.textContent==='+$60'),{},{timeout:3000});
  assert((await page.locator('#toast-stack .toast-item.tone-gain .toast-who').first().textContent()).includes('You'),'A gain notification is green, shows +$60 and names the player (You on your own screen)');
  await page.locator('#toast-stack').screenshot({path:'output/playwright/toast-gain.png'});
  room.state=clone(fixture.extras.wheelState);room.revision++;room.transition={action:'roll',player:0,dice:room.state.dice,path:[],sounds:[]};broadcast('mw_rooms',room);
  await page.locator('#modal [data-action=spin]').waitFor();await guest.locator('#modal [data-action=spin]').waitFor();
  assert(await page.locator('#modal [data-action=spin]').isEnabled()&&await guest.locator('#modal [data-action=spin]').isDisabled(),'Only the player standing on the Konark Wheel can spin it');
  assert(await page.locator('#modal .wheel-disc svg text').count()===8,'The wheel shows its eight slices');
  await page.locator('#modal').screenshot({path:'output/playwright/wheel-spin.png'});
  room.state=clone(fixture.extras.spun);room.revision++;room.transition={action:'spin',player:0,dice:room.state.dice,path:[],sounds:['event']};broadcast('mw_rooms',room);
  await page.locator('#modal [data-action=wheel-continue]').waitFor();await guest.locator('#modal [data-action=wheel-continue]').waitFor();
  await page.waitForFunction(()=>/rotate\(\d{4}/.test(document.getElementById('wheel-disc')?.style.transform||''),{},{timeout:5000});checks.push('The wheel turns to the slice the server chose');
  await page.locator('#wheel-outcome:not([hidden])').waitFor({timeout:12000});await guest.locator('#wheel-outcome:not([hidden])').waitFor({timeout:12000});
  await page.locator('#modal').screenshot({path:'output/playwright/wheel-result.png'});
  assert((await page.locator('#wheel-outcome').textContent()).includes('Lost $200')&&(await guest.locator('#wheel-outcome').textContent()).includes('Lost $200'),'Every player sees the same wheel result');
  await page.locator('#modal [data-action=wheel-continue]').click();await page.locator('#modal').waitFor({state:'hidden'});
  assert((await page.locator('#game-board [data-id="20"] .tile-kind').textContent()).includes('POT $200'),'The Taj Mahal tile shows the jackpot, fed by the wheel loss');
  assert((await page.locator('#modal').count())===0||!(await page.locator('#modal').isVisible()),'The wheel result closes');
  room.state=clone(fixture.extras.freeHouse);room.revision++;room.transition={action:'spin',player:0,dice:room.state.dice,path:[],sounds:[]};broadcast('mw_rooms',room);
  await page.locator('#modal [data-action=wheel-continue]').waitFor();await page.locator('#modal [data-action=wheel-continue]').click();
  await page.locator('#modal [data-action=free-build]').first().waitFor({timeout:12000});
  assert(await page.locator('#modal [data-action=free-build]').count()===1&&await page.locator('#modal [data-action=free-build]').getAttribute('data-id')==='2','The Free house offers only the property that keeps building even');
  assert(await page.locator('#modal [data-action=free-build]').isEnabled(),'The player on the wheel can pick the free house');
  await page.locator('#modal').screenshot({path:'output/playwright/free-house.png'});
  assert(await guest.locator('#modal [data-action=free-build]').count()===0,'Other players do not see the free-house choice');
  room.state=clone(fixture.extras.buffed);room.revision++;room.transition={action:'end',player:0,dice:room.state.dice,path:[],sounds:[]};broadcast('mw_rooms',room);
  await page.locator('.perk-badge').first().waitFor();
  assert((await page.locator('#turn-action-card .perk-badge').allTextContents()).join('|')==='Bonus Salary ×2|Nitro Dice ×2|Neta Pass ×1'&&(await page.locator('.player-card').first().getAttribute('title')).includes('Nitro Dice ×2'),'Power-ups show on the turn card and in the player card tooltip with their remaining uses');
  assert(await page.locator('.player-card').first().locator('.perk-badge').count()===0,'Player cards stay compact: no badges inside');
  assert((await page.locator('#city-banner').textContent()).includes('Property Boom (rents +50%), 2 rounds left.')&&(await page.locator('#city-banner').textContent()).includes('Next round: Tax Audit'),'The board header shows the active City Event and the announced one');
  assert((await page.locator('.city-status').textContent()).includes('Round 5'),'The turn card shows the round and the City Event');
  await page.locator('.board-tools').screenshot({path:'output/playwright/city-banner.png'});
  room.state=clone(fixture.extras.buildPrompt);room.revision++;room.transition={action:'end',player:0,dice:room.state.dice,path:[],sounds:[]};broadcast('mw_rooms',room);
  await page.locator('#modal[data-kind=build-prompt]').waitFor();
  assert((await page.locator('#modal[data-kind=build-prompt] [data-action=build]').textContent()).includes('$50')&&await page.locator('#modal[data-kind=build-prompt] [data-action=build-ignore]').isVisible(),'Landing on your own buildable property opens a build popup with Build and Ignore');
  assert(!(await guest.locator('#modal[data-kind=build-prompt]').isVisible().catch(()=>false)),'Other players do not get the build popup');
  await page.locator('#modal').screenshot({path:'output/playwright/build-prompt.png'});
  await page.locator('#modal [data-action=build-ignore]').click();await page.waitForTimeout(400);
  room.revision++;broadcast('mw_rooms',room);await page.waitForTimeout(600);
  assert(!(await page.locator('#modal[data-kind=build-prompt]').isVisible().catch(()=>false)),'Ignore closes the build popup and it stays closed for that landing');
  // A 5-sided game: 50 spaces drawn as a pentagon, pawns on the board, nothing spills off the page.
  room.state=clone(fixture.extras.pentaGame);room.revision++;room.transition={action:'end',player:0,dice:room.state.dice,path:[],sounds:[]};broadcast('mw_rooms',room);
  await page.locator('#game-board.poly-board').waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('#game-board .board-tile').length===50,{},{timeout:8000});
  assert((await page.locator('#game-board [data-id="45"]').getAttribute('aria-label')).startsWith('Chennai Central')&&await page.locator('#game-board [data-id="40"]').getAttribute('aria-label')==='Dalal Street'&&await page.locator('#game-board .poly-felt').count()===1,'A 5-sided game draws 50 spaces as a pentagon with the Dalal Street corner');
  await page.waitForTimeout(500);
  const polyOk=await page.evaluate(()=>{const b=document.getElementById('game-board').getBoundingClientRect();return [...document.querySelectorAll('#token-layer .player-token:not([hidden]) .pawn-art')].every(p=>{const r=p.getBoundingClientRect();return r.left>=b.left-2&&r.right<=b.right+2&&r.top>=b.top-2&&r.bottom<=b.bottom+2;});});
  assert(polyOk,'Pawns stand on the pentagon board');
  await page.locator('#classic-board-view').screenshot({path:'output/playwright/board-pentagon.png'});
  for(const width of [390,1366]){await page.setViewportSize({width,height:900});await page.waitForTimeout(300);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+'px pentagon board fits without page overflow');}
  room.state=clone(fixture.extras.declined);room.revision++;room.transition={action:'reject-trade',player:0,dice:room.state.dice,path:[],sounds:[]};broadcast('mw_rooms',room);
  await page.locator('#toast-stack .toast-item',{hasText:'declined the trade offer'}).waitFor({timeout:8000});
  assert((await page.locator('#toast-stack .toast-item',{hasText:'declined the trade offer'}).locator('.toast-title').textContent())==='Trade declined'&&(await page.locator('#toast-stack .toast-item .toast-remark').first().textContent())==='“Close, but too low.”','The decline popup carries the bot’s short remark');
  await page.waitForTimeout(700);await page.locator('#toast-stack').screenshot({path:'output/playwright/toast-declined.png'});
  room.state=clone(fixture.extras.jailed);room.revision++;room.transition={action:'end',player:0,dice:room.state.dice,path:[],sounds:[]};broadcast('mw_rooms',room);
  await page.locator('#classic-token-0.jailed').waitFor();
  assert(await page.locator('#classic-token-0 .pawn-cage').isVisible()&&await page.locator('#classic-token-1.jailed').count()===0,'A jailed pawn is shown behind bars; free pawns are not');
  assert((await page.locator('#game-board [data-id="33"] .tile-kind').textContent())==='+$150 INTEREST'&&(await page.locator('#board-center [data-action=release]').textContent()).includes('Pay $150 to leave'),'In round 21 Reserve Bank shows $150 interest and leaving Prison costs $150');
  await page.waitForTimeout(700);await page.locator('#game-board .board-tile[data-id="10"]').screenshot({path:'output/playwright/jailed-pawn.png'});
  await page.locator('#modal[data-kind=jail]').waitFor();
  assert(await page.locator('#modal[data-kind=jail] [data-action=roll]').isEnabled()&&(await page.locator('#modal[data-kind=jail] [data-action=release]').textContent()).includes('Pay $150 to leave')&&await page.locator('#modal[data-kind=jail] [data-action=close]').count()===0,'A jailed player gets a Prison popup: roll for doubles or pay, with no way to dismiss it');
  await page.keyboard.press('Escape');assert(await page.locator('#modal[data-kind=jail]').isVisible(),'Escape does not dismiss the Prison popup');
  assert(!(await guest.locator('#modal[data-kind=jail]').isVisible().catch(()=>false)),'Other players do not get the Prison popup');
  await page.locator('#modal').screenshot({path:'output/playwright/jail-prompt.png'});
  await guest.locator('#classic-token-0.jailed').waitFor();
  assert(await guest.locator('#classic-token-0 .pawn-cage').isVisible(),'Other players see the jailed pawn behind bars too');
  room.state=clone(fixture.extras.debt);room.revision++;room.transition={action:'roll',player:0,dice:room.state.dice,path:[],sounds:[]};broadcast('mw_rooms',room);
  await page.locator('#modal [data-action=settle]').waitFor();await page.locator('#modal [data-action=manager]').click();
  await page.locator('#modal .debt-meter').waitFor();
  assert(await page.locator('#modal .debt-bar').getAttribute('aria-valuenow')==='20'&&(await page.locator('#modal .debt-meter-status').textContent()).includes('$130 more needed'),'Portfolio shows a payment bar with the cash still needed');
  assert(await page.locator('#modal .debt-meter [data-action=settle]').isDisabled()&&await page.locator('#modal .modal-actions [data-action=settle]').isDisabled(),'Pay stays disabled in the portfolio until the cash covers the debt');
  await page.screenshot({path:'output/playwright/debt-meter-short.png'});
  room.state=clone(fixture.extras.debtReady);room.revision++;room.transition={action:'sell',player:0,dice:room.state.dice,path:[],sounds:[]};broadcast('mw_rooms',room);
  await page.locator('#modal .debt-meter.ready').waitFor();
  assert(await page.locator('#modal .debt-meter [data-action=settle]').isEnabled()&&(await page.locator('#modal .debt-bar i').getAttribute('style')).includes('100%'),'The bar fills and Pay unlocks once enough cash is raised');
  await page.screenshot({path:'output/playwright/debt-meter-ready.png'});
  await guestContext.close();
  botMode=true;
  await page.goto('http://localhost:3000');await page.getByRole('button',{name:'Create Game',exact:true}).click();
  await page.locator('#online-name').fill('Host');await page.getByRole('button',{name:'Create Game',exact:true}).click();
  await page.getByRole('button',{name:'Add bot +',exact:true}).click();
  await page.getByText('Bot · Ready',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'output/playwright/bot-lobby-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Start Game'}).click();
  await page.locator('.mobile-controls [data-action=roll]').click();
  await page.locator('#modal [data-action=buy]').click();
  await page.locator('.mobile-controls [data-action=end]').click();
  await page.locator('#board-center .dice.rolling').waitFor();
  assert(await page.locator('.mobile-controls [data-action=roll]').isDisabled(),'Human controls lock while the bot rolls');
  await page.reload();await page.locator('#game-screen').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#game-board [data-id="6"]')?.getAttribute('aria-label').includes('1 house'),{},{timeout:20000});
  await page.waitForFunction(()=>!document.querySelector('.mobile-controls [data-action=roll]').disabled);
  assert(botRequests===4,'Bot automatically rolls, buys, builds and ends once across a browser refresh');
  assert((await page.locator('#game-board [data-id="6"]').getAttribute('aria-label')).includes('owned by Bot Ada'),'Bot ownership appears on the shared board');
  assert(await page.locator('.bot-badge').count()===1,'Bot player is clearly marked during play');
  assert(await page.locator('#classic-token-1').getAttribute('data-space')==='6','Bot token moves around the square board');
  await page.locator('#classic-board-view').evaluate(el=>el.scrollIntoView({block:'center'}));
  await page.screenshot({path:'output/playwright/bot-game-mobile.png'});
  assert(errors.length===0,'No browser runtime errors: '+errors.join('; '));
  return {transport:'Mocked Supabase Auth, HTTP and Realtime; real browser client and rules fixtures',checks};
}
}
