const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { Game } = require('../lib/game-engine.cjs');
const db = new PGlite();
const host = randomUUID(), guest = randomUUID(), third = randomUUID(), fourth = randomUUID(), fifth = randomUUID();
const p = (name, role = 'competitor', token = 'rocket') => ({ name, role, token });
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const rpc = async (name, args, casts) => (await query('select to_jsonb(r) as room from public.' + name + '(' + args.map((_, i) => '$' + (i + 1) + '::' + casts[i]).join(',') + ') r', args))[0].room;
const create = (code, actor = host, id = randomUUID()) => rpc('mw_create_room', [code, actor, p('Host', 'monopolist', 'briefcase'), id], ['text','uuid','jsonb','uuid']);
const joinRoom = (code, actor, player) => rpc('mw_join_room', [code, actor, player], ['text','uuid','jsonb']);
const commit = (r, actor, state, id = randomUUID(), start = false, fingerprint = 'action') => rpc('mw_commit_game', [r.code, actor, r.revision, state, null, id, fingerprint, start], ['text','uuid','bigint','jsonb','jsonb','uuid','text','boolean']);
const stateFor = r => JSON.parse(new Game(r.members, {}, { wait: async () => {} }).serialize());

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon,service_role;`);
  const file = '20261005182109_online_multiplayer.sql';
  const sql = readFileSync(join(__dirname,'../supabase/migrations',file),'utf8');
  // PGlite implements PostgreSQL SQL, locks and RLS but not logical replication.
  await db.exec(sql.split('-- Postgres Changes supplies')[0]);
});
after(async () => { await db.close(); });

test('Database enforces unique rooms, idempotent creation, and four seats', async () => {
  const id = randomUUID(); const room = await create('DB0001', host, id);
  assert.equal(room.host_id, host); assert.equal(room.members.length, 1);
  assert.equal((await create('DB0002', host, id)).code, 'DB0001');
  await assert.rejects(create('DB0001'), /duplicate key/);
  await joinRoom(room.code, guest, p('Guest'));
  await joinRoom(room.code, third, p('Third','monopolist','building'));
  const full = await joinRoom(room.code, fourth, p('Fourth','competitor','car'));
  assert.equal(full.members.length, 4);
  await assert.rejects(joinRoom(room.code, fifth, p('Fifth','competitor','coin')), /maximum of 4/);
  const reconnect = await joinRoom(room.code, guest, p('Different','monopolist','crown'));
  assert.equal(reconnect.members[1].name, 'Guest');
  assert.equal(reconnect.revision, full.revision);
});

test('Database locks names, tokens, host starts and post-start joining', async () => {
  let room = await create('DB0003');
  await assert.rejects(joinRoom(room.code, guest, p('Host')), /name is taken/);
  await assert.rejects(joinRoom(room.code, guest, p('Guest','competitor','briefcase')), /token is taken/);
  room = await joinRoom(room.code, guest, p('Guest'));
  const state = stateFor(room);
  await assert.rejects(commit(room, guest, state, randomUUID(), true), /Only the Host/);
  room = await commit(room, host, state, randomUUID(), true);
  await assert.rejects(joinRoom(room.code, third, p('Third','competitor','car')), /already started/);
  assert.equal((await joinRoom(room.code, guest, p('Guest'))).status, 'playing');
});

test('Revision compare-and-swap and receipts prevent duplicate game actions', async () => {
  let room = await create('DB0004'); room = await joinRoom(room.code, guest, p('Guest'));
  room = await commit(room, host, stateFor(room), randomUUID(), true);
  const id = randomUUID(), snapshot = room.state;
  snapshot.phase = 'end'; snapshot.players[0].cash = 1490;
  const updated = await commit(room, host, snapshot, id);
  assert.equal(updated.revision, room.revision + 1);
  await assert.rejects(commit(room, host, snapshot), /room changed/);
  assert.equal((await commit(room, host, snapshot, id)).revision, updated.revision);
  await assert.rejects(commit(room, guest, snapshot, id), /identifier/);
  await assert.rejects(commit(updated, guest, snapshot), /acting player/);
});

test('Host transfer and seat indexing are atomic in the lobby; play retains seats', async () => {
  let room = await create('DB0005'); room = await joinRoom(room.code, guest, p('Guest'));
  room = await joinRoom(room.code, third, p('Third','monopolist','building'));
  room = await rpc('mw_leave_room',[room.code,host],['text','uuid']);
  assert.equal(room.host_id, guest); assert.deepEqual(room.members.map(m=>m.seat), [0,1]);
  room = await commit(room, guest, stateFor(room), randomUUID(), true);
  const left = await rpc('mw_leave_room',[room.code,guest],['text','uuid']);
  assert.deepEqual(left.members,room.members); assert.deepEqual(left.state,room.state);
});

test('RLS allows members to read, rejects outsiders and all browser writes/RPCs', async () => {
  const room = await create('DB0006');
  await db.exec('set role authenticated');
  try {
    await query("select set_config('test.uid',$1,false)",[host]);
    assert.equal((await query('select code from public.mw_rooms where code=$1',[room.code])).length,1);
    await query("select set_config('test.uid',$1,false)",[fifth]);
    assert.equal((await query('select code from public.mw_rooms where code=$1',[room.code])).length,0);
    await assert.rejects(query('update public.mw_rooms set host_id=$1 where code=$2',[fifth,room.code]),/permission denied/);
    await assert.rejects(query('select public.mw_join_room($1,$2,$3)',[room.code,fifth,p('Fifth')]),/permission denied/);
    await assert.rejects(query('select * from public.mw_commands'),/permission denied/);
    await assert.rejects(query('select * from public.mw_game_secrets'),/permission denied/);
  } finally { await db.exec('reset role'); }
});

test('Future event order stays private and simultaneous revisions commit once', async () => {
  let room=await create('DB0007');room=await joinRoom(room.code,guest,p('Guest'));
  const state=stateFor(room);
  room=await commit(room,host,state,randomUUID(),true);
  assert.deepEqual(room.state.decks.market.order,[]);
  const secret=(await query('select state from public.mw_game_secrets where code=$1',[room.code]))[0].state;
  assert.equal(secret.decks.market.order.length,15);
  const a=structuredClone(secret);a.phase='end';a.players[0].cash=1450;
  const outcomes=await Promise.allSettled([commit(room,host,a),commit(room,host,a)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
  const final=(await query('select revision,state from public.mw_rooms where code=$1',[room.code]))[0];
  assert.equal(final.revision,room.revision+1);assert.equal(final.state.players[0].cash,1450);
});
