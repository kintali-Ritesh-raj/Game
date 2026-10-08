import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import MarketWars from '../lib/game-engine.cjs';
import {applyGameAction,startGame} from '../lib/game-actions';
import {addBotMembers,removeBotMembers,membersAfterLeaving} from '../lib/lobby-bots';
import {chooseBotAction,timeoutCommand} from '../lib/bot-strategy';
import {actingSeat,botReadyAt,botSeat} from '../lib/bot-timing';
import {profile} from '../lib/validation';
import type {Room} from '../lib/types';

function lobby():Room {
  const host={name:'Human',token:'briefcase' as const,user_id:randomUUID(),seat:0};
  return {code:'BOT123',host_id:host.user_id,members:[host],member_ids:[host.user_id],status:'lobby',revision:0,state:null,transition:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
}
function add(room:Room) {
  room.members=addBotMembers(room,room.host_id,room.revision);room.member_ids=room.members.map(m=>m.user_id);room.revision++;
}
function playing() { const room=lobby();add(room);room.state=startGame(room,room.host_id);room.status='playing';return room; }
async function step(room:Room) {
  const command=chooseBotAction(room.state!);assert.ok(command,'every actionable phase has a decision');
  const seat=actingSeat(room.state!);
  const result=await applyGameAction(room,room.members[seat].user_id,command);room.state=result.state;return command;
}

test('Host adds up to three distinct bots; humans cannot submit bot profiles or manage another host lobby',()=>{
  const room=lobby();add(room);add(room);add(room);
  assert.equal(room.members.length,4);assert.equal(new Set(room.members.map(m=>m.token)).size,4);assert.equal(new Set(room.member_ids).size,4);
  assert.throws(()=>add(room),/full/);
  assert.throws(()=>addBotMembers(room,room.members[1].user_id,room.revision),/Only the Host/);
  const clean=profile({...room.members[0],type:'bot'});assert.equal('type' in clean,false);
  const started=startGame(room,room.host_id);assert.deepEqual(started.players.map(p=>p.type),['human','bot','bot','bot']);
  room.status='playing';assert.throws(()=>removeBotMembers(room,room.host_id,room.revision,room.members[1].user_id),/before/);
});
test('Removing bots preserves humans and seat order, and host transfer always chooses a human',()=>{
  const room=lobby();add(room);
  const human={...room.members[0],name:'Friend',token:'rocket' as const,user_id:randomUUID(),seat:2};room.members.push(human);room.member_ids.push(human.user_id);
  assert.throws(()=>removeBotMembers(room,room.host_id,room.revision,human.user_id),/Human players/);
  assert.throws(()=>removeBotMembers(room,room.host_id,room.revision-1,room.members[1].user_id),/room changed/);
  const next=membersAfterLeaving(room,room.host_id);assert.equal(next.host_id,human.user_id);assert.deepEqual(next.members.map(m=>m.seat),[0,1]);
  const onlyBots=playing();onlyBots.status='lobby';onlyBots.state=null;
  const closed=membersAfterLeaving(onlyBots,onlyBots.host_id);assert.equal(closed.status,'closed');assert.equal(closed.members.length,0);
});
test('Only the acting bot wakes, including auction bids and off-turn debts; animations finish first',()=>{
  const room=playing();assert.equal(botSeat(room),null);
  room.state!.currentPlayer=1;assert.equal(botSeat(room),1);
  room.state!.currentPlayer=0;room.state!.pending={payer:1,creditor:0,amount:30,reason:'rent'};assert.equal(botSeat(room),1);
  room.state!.pending=null;room.state!.auction={bidder:1,property:1,bid:0,leader:null,order:[1],passed:[]};assert.equal(botSeat(room),1);
  room.transition={action:'roll',player:0,dice:[6,6],path:Array.from({length:12},(_,i)=>i),sounds:[]};
  assert.equal(botReadyAt(room)-Date.parse(room.updated_at),3850);
  room.status='finished';assert.equal(botSeat(room),null);
});
test('Bot buys within budget, skips expensive offers, and bids without overspending',async()=>{
  const room=playing();room.state!.currentPlayer=1;room.state!.phase='offer';room.state!.offer=1;
  assert.equal((await step(room)).action,'buy');assert.equal(room.state!.properties[1].owner,1);
  room.state!.phase='offer';room.state!.offer=2;room.state!.players[1].cash=130;
  assert.equal((await step(room)).action,'skip');assert.equal(room.state!.properties[2].owner,null);
  room.state!.currentPlayer=0;room.state!.phase='auction';room.state!.properties[2].owner=0;
  room.state!.auction={property:2,seller:0,returnPhase:'end',bidder:1,bid:0,leader:null,order:[1],passed:[]};
  assert.equal((await step(room)).action,'pass');assert.equal(room.state!.properties[2].owner,0);
  room.state!.players[1].cash=1000;room.state!.phase='auction';room.state!.auction={property:2,seller:0,returnPhase:'end',bidder:1,bid:0,leader:null,order:[1],passed:[]};
  assert.equal((await step(room)).action,'bid');assert.equal(room.state!.properties[2].owner,1);assert.equal(room.state!.players[0].cash,1510);
});
test('Bot develops allowed assets, unmortgages, takes doubles, and pays detention when affordable',async()=>{
  const room=playing();room.state!.currentPlayer=1;room.state!.phase='end';room.state!.properties[1].owner=1;room.state!.properties[2].owner=1;room.state!.players[1].position=1;room.state!.hasRolled=true;
  assert.equal((await step(room)).action,'build');assert.equal(room.state!.properties[1].buildings,1);
  room.state!.extraRoll=true;assert.equal((await step(room)).action,'roll');
  room.state!.phase='end';room.state!.extraRoll=false;room.state!.properties[2].owner=1;room.state!.properties[2].mortgaged=true;
  assert.equal((await step(room)).action,'unmortgage');
  room.state!.phase='ready';room.state!.players[1].penalty={kind:'prison',attempts:0};
  assert.equal((await step(room)).action,'release');assert.equal(room.state!.players[1].penalty,null);
});
test('Bots accept fair trades, refuse to hand over a set cheaply, and offer cash for the last property of a set',async()=>{
  const room=playing();room.state!.properties[1].owner=0;room.state!.properties[2].owner=1;room.state!.properties[9].owner=1;
  room.state!.phase='trade';room.state!.trade={from:0,to:1,returnPhase:'ready',give:{cash:150,properties:[]},get:{cash:0,properties:[2]}};
  assert.equal(chooseBotAction(room.state!)!.action,'reject-trade','$150 is too little for the property that completes the rival set');
  room.state!.trade.give.cash=250;assert.equal(chooseBotAction(room.state!)!.action,'accept-trade');
  room.state!.trade={from:0,to:1,returnPhase:'ready',give:{cash:0,properties:[1]},get:{cash:0,properties:[9]}};
  assert.equal(chooseBotAction(room.state!)!.action,'accept-trade','a property that completes the bot set is worth more to it');
  const proposer=playing();proposer.state!.currentPlayer=1;proposer.state!.phase='end';proposer.state!.properties[1].owner=1;proposer.state!.properties[2].owner=0;
  const offer=await step(proposer);assert.equal(offer.action,'trade');assert.deepEqual(offer.trade!.get.properties,[2]);assert.ok(offer.trade!.give.cash>=240);
  assert.equal(proposer.state!.phase,'trade');assert.equal((await step(proposer)).action,'accept-trade');assert.equal(proposer.state!.properties[2].owner,1);
  assert.equal((await step(proposer)).action,'build','the completed set is developed at once');
  proposer.state!.phase='end';proposer.state!.tradesThisTurn=0;proposer.state!.properties[2].owner=0;proposer.state!.properties[1].buildings=0;
  assert.notEqual(chooseBotAction(proposer.state!)!.action,'trade','the same offer is not repeated straight away');
});
test('A timed-out Prison turn pays the $50 fine, mortgaging the lowest-rent land first when cash is short',async()=>{
  const room=playing();const s=room.state!;s.players[0].penalty={kind:'prison',attempts:1};s.players[0].position=10;
  const forced=async()=>{const command=timeoutCommand(room.state!);room.state=(await applyGameAction(room,room.members[actingSeat(room.state!)].user_id,command)).state;return command;};
  assert.equal((await forced()).action,'release');assert.equal(room.state!.players[0].cash,1450);assert.equal(room.state!.players[0].penalty,null);
  assert.equal((await forced()).action,'timeout');assert.equal(room.state!.currentPlayer,1,'the turn then passes');
  const poor=playing();poor.state!.players[0].penalty={kind:'prison',attempts:0};poor.state!.players[0].position=10;poor.state!.players[0].cash=10;
  for(const id of [1,37,39])poor.state!.properties[id].owner=0; // rents $8, $34 and $42
  room.state=poor.state;const steps=[];
  for(let i=0;i<6&&room.state!.currentPlayer===0;i++)steps.push(await forced());
  assert.deepEqual(steps.map(c=>c.action+(('id' in c && c.id)||'')),['release','mortgage1','settle','timeout'],'only Beacon Wharf (lowest rent) is mortgaged');
  assert.equal(room.state!.properties[1].mortgaged,true);assert.equal(room.state!.properties[37].mortgaged,false);assert.equal(room.state!.players[0].cash,10);
  assert.equal(room.state!.players[0].penalty,null);
  const broke=playing();broke.state!.players[0].penalty={kind:'prison',attempts:0};broke.state!.players[0].cash=20;room.state=broke.state;
  assert.equal((await forced()).action,'release');assert.equal((await forced()).action,'bankrupt');assert.equal(room.state!.phase,'victory');
});
test('Solvent bots sell buildings and mortgage to settle off-turn debt; insolvent bots go bankrupt',async()=>{
  const room=playing();
  const game=MarketWars.Game.restore(JSON.stringify(room.state));game.state.players[1].cash=0;game.asset(1).owner=1;game.asset(1).buildings=1;
  game.state.phase='ready';game.state.pending=null;game.beginPayments([{payer:1,creditor:0,amount:60,reason:'fee',category:'rent'}]);room.state=JSON.parse(game.serialize());
  assert.equal((await step(room)).action,'sell');assert.equal((await step(room)).action,'mortgage');assert.equal((await step(room)).action,'settle');
  assert.equal(room.state!.pending,null);assert.equal(room.state!.players[0].cash,1560);
  const busted=playing();const g=MarketWars.Game.restore(JSON.stringify(busted.state));g.state.players[1].cash=0;g.beginPayments([{payer:1,creditor:0,amount:100,reason:'fee',category:'rent'}]);busted.state=JSON.parse(g.serialize());
  assert.equal((await step(busted)).action,'bankrupt');assert.equal(busted.state!.phase,'victory');assert.equal(busted.state!.winner,0);
});
test('Bot strategy completes 2- and 4-seat games, survives refresh, and never violates money or building rules',async()=>{
  for(const count of [2,4]) {
    const room=lobby();while(room.members.length<count)add(room);
    room.state=startGame(room,room.host_id);room.status='playing';let actions=0;
    while(room.state!.phase!=='victory'&&actions++<15000) {
      await step(room);
      assert.ok(room.state!.players.every(p=>p.cash>=0&&p.position>=0&&p.position<40));
      assert.ok(Object.values(room.state!.properties).every(a=>a.buildings>=0&&a.buildings<=5&&!(a.mortgaged&&a.buildings)));
      if(actions%37===0)room.state=JSON.parse(MarketWars.Game.restore(JSON.stringify(room.state)).serialize());
    }
    assert.equal(room.state!.phase,'victory');assert.equal(room.state!.players.filter(p=>!p.bankrupt).length,1);
  }
});
