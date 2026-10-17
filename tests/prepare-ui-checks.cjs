// Build deterministic fixtures for the CLI browser checks. Transport is mocked;
// these checks complement (and do not replace) the live Supabase smoke test.
const fs=require('node:fs');
const {Game}=require('../lib/game-engine.cjs');
(async()=>{
  const members=[{name:'Host',token:'black',user_id:'10000000-0000-4000-8000-000000000001',seat:0},{name:'Guest',token:'blue',user_id:'10000000-0000-4000-8000-000000000002',seat:1}];
  const game=new Game(members,{}, {random:()=>.2,wait:async()=>{}});
  // Roll 1 + 3 = 4 (not doubles, so the landing resolves) onto Lockside Walk.
  let face=0;game.random=()=>[0,.4][face++%2];
  const states=[JSON.parse(game.serialize())];
  await game.rollDice();states.push(JSON.parse(game.serialize()));
  game.purchaseProperty();states.push(JSON.parse(game.serialize()));
  game.nextTurn();states.push(JSON.parse(game.serialize()));
  await game.rollDice();states.push(JSON.parse(game.serialize()));
  // Host owns the whole canal set and has since landed on Lockside Walk again, so building is allowed.
  game.asset(4).ready=true;
  game.state.currentPlayer=0;game.state.phase='end';game.state.hasRolled=true;game.state.extraRoll=false;
  const group=require('../lib/game-engine.cjs').BOARD[4].group;
  for(const space of game.groupSpaces(group))game.asset(space.id).owner=0;
  // Fixture shortcut for "landed on it again": stand on each space, build one level, step back.
  const landBuild=(g,id)=>{const from=g.active.position;Object.assign(g.state,{phase:'end',hasRolled:true,extraRoll:false});g.active.position=id;g.asset(id).ready=true;g.buildStructure(id);delete g.asset(id).builtTurn;g.active.position=from;};
  for(const id of [4,6,7,4])landBuild(game,id);
  const developed=JSON.parse(game.serialize());
  game.startAuction(4);const auction=JSON.parse(game.serialize());
  game.auctionBid(20);const resold=JSON.parse(game.serialize());
  game.drawCard('market');const event=JSON.parse(game.serialize());
  // Host owes $150 rent with only $20 cash, holding a developed Tidehaven pair to liquidate.
  const debtor=new Game(members,{}, {random:()=>.2,wait:async()=>{}});
  debtor.asset(1).owner=0;debtor.asset(2).owner=0;landBuild(debtor,1);landBuild(debtor,2);debtor.active.cash=20;
  debtor.beginPayments([{payer:0,creditor:1,amount:150,reason:'Beacon Wharf rent',category:'rent'}]);
  const debt=JSON.parse(debtor.serialize());
  const debtReady=JSON.parse(debtor.serialize());debtReady.players[0].cash=160;
  // Host stands on the Wheel of Fortune; the second state is after a spin that landed on the -$100 slice.
  const wheelGame=new Game(members,{}, {random:()=>.2,wait:async()=>{}});
  wheelGame.state.phase='moving';wheelGame.active.position=30;wheelGame.resolveSpace();
  const wheelState=JSON.parse(wheelGame.serialize());
  wheelGame.random=()=>.63;wheelGame.spinWheel();const spun=JSON.parse(wheelGame.serialize());
  const extras={developed,auction,resold,event,debt,debtReady,wheelState,spun};
  const botMember={name:'Bot Ada',token:'lime',user_id:'20000000-0000-4000-8000-000000000001',seat:1,type:'bot'};
  const botGame=new Game([members[0],botMember],{},{random:()=>.2,wait:async()=>{}});botGame.state.players[1].type='bot';
  let botFace=0;botGame.random=()=>[0,.4][botFace++%2];
  const botStates=[JSON.parse(botGame.serialize())];
  await botGame.rollDice();botStates.push(JSON.parse(botGame.serialize()));
  botGame.purchaseProperty();botStates.push(JSON.parse(botGame.serialize()));
  botGame.nextTurn();botStates.push(JSON.parse(botGame.serialize()));
  let die=0;botGame.random=()=>die++%2?.55:.2;
  await botGame.rollDice();botStates.push(JSON.parse(botGame.serialize()));
  botGame.purchaseProperty();botStates.push(JSON.parse(botGame.serialize()));
  // Fixture shortcut: hand the bot the rest of the canal set so its build step can be shown.
  botGame.asset(4).owner=1;botGame.asset(7).owner=1;botGame.asset(6).ready=true;botGame.buildStructure(6);botStates.push(JSON.parse(botGame.serialize()));
  botGame.nextTurn();botStates.push(JSON.parse(botGame.serialize()));
  for(const state of [...states,...botStates,...Object.values(extras)])for(const deck of Object.values(state.decks))deck.order=[];
  const sessions=members.map(m=>{
    const user={id:m.user_id,aud:'authenticated',role:'authenticated',app_metadata:{provider:'anonymous',providers:['anonymous']},user_metadata:{},identities:[],is_anonymous:true,created_at:new Date().toISOString()};
    const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
    return {user,access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:user.id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})+'.test-signature',refresh_token:'ui-test-refresh-'+m.seat,expires_in:3600,token_type:'bearer'};
  });
  fs.mkdirSync('output/playwright',{recursive:true});
  fs.writeFileSync('output/playwright/online-ui-checks.js',fs.readFileSync('tests/online-ui-template.js','utf8').replace('/* FIXTURES */',JSON.stringify({members,states,extras,sessions,botMember,botStates})));
})();
