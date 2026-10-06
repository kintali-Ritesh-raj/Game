// Build deterministic fixtures for the CLI browser checks. Transport is mocked;
// these checks complement (and do not replace) the live Supabase smoke test.
const fs=require('node:fs');
const {Game}=require('../lib/game-engine.cjs');
(async()=>{
  const members=[{name:'Host',role:'monopolist',token:'briefcase',user_id:'10000000-0000-4000-8000-000000000001',seat:0},{name:'Guest',role:'competitor',token:'rocket',user_id:'10000000-0000-4000-8000-000000000002',seat:1}];
  const game=new Game(members,{}, {random:()=>.2,wait:async()=>{}});
  const states=[JSON.parse(game.serialize())];
  await game.rollDice();states.push(JSON.parse(game.serialize()));
  game.purchaseProperty();states.push(JSON.parse(game.serialize()));
  game.nextTurn();states.push(JSON.parse(game.serialize()));
  await game.rollDice();states.push(JSON.parse(game.serialize()));
  game.state.currentPlayer=0;game.state.phase='end';
  const group=require('../lib/game-engine.cjs').BOARD[4].group;
  for(const space of game.groupSpaces(group))game.asset(space.id).owner=0;
  game.buildStructure(4);game.buildStructure(4);
  const developed=JSON.parse(game.serialize());
  game.startAuction(4);const auction=JSON.parse(game.serialize());
  game.auctionBid(20);const resold=JSON.parse(game.serialize());
  game.drawCard('market');const event=JSON.parse(game.serialize());
  const extras={developed,auction,resold,event};
  for(const state of [...states,...Object.values(extras)])for(const deck of Object.values(state.decks))deck.order=[];
  const sessions=members.map(m=>{
    const user={id:m.user_id,aud:'authenticated',role:'authenticated',app_metadata:{provider:'anonymous',providers:['anonymous']},user_metadata:{},identities:[],is_anonymous:true,created_at:new Date().toISOString()};
    const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
    return {user,access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:user.id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})+'.test-signature',refresh_token:'ui-test-refresh-'+m.seat,expires_in:3600,token_type:'bearer'};
  });
  fs.mkdirSync('output/playwright',{recursive:true});
  fs.writeFileSync('output/playwright/online-ui-checks.js',fs.readFileSync('tests/online-ui-template.js','utf8').replace('/* FIXTURES */',JSON.stringify({members,states,extras,sessions})));
})();
