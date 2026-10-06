import * as THREE from 'three';

export interface SpaceData { id:number; name:string; type:string; group?:string; price?:number; symbol?:string }
export interface GroupData { name:string; color:string }
export interface TokenState { id:number; position:number; color:string; token:string; symbol?:string; bankrupt:boolean; active:boolean }
export interface AssetState { owner:number|null; buildings:number; mortgaged:boolean; ownerColor?:string; ownerName?:string; ownerSymbol?:string }
export interface Board3DController {
  init():void;
  updateTiles(assets:Record<number,AssetState>,selectedId:number):void;
  updateTokens(tokens:TokenState[],speed:number):void;
  rollDice(values:[number,number],phase:'rolling'|'settled',speed?:number):void;
  setDice(values:[number,number]):void;
  resize():void; resetCamera():void; topCamera():void; destroy():void;
}

const HEIGHT=.18, SIZE=.72;
const UP=new THREE.Vector3(0,1,0);
const ease=(t:number)=>1-Math.pow(1-t,3);
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
function grid(id:number):[number,number] {
  if(id<=10)return [10,10-id];
  if(id<=20)return [20-id,0];
  if(id<=30)return [0,id-20];
  return [id-30,10];
}
function tile(id:number) {
  const [row,col]=grid(id);
  const axis=(n:number)=>n===0?-5.25:n===10?5.25:n-5;
  return {row,col,x:axis(col),z:axis(row),w:col===0||col===10?1.5:1,d:row===0||row===10?1.5:1};
}
function release(object:THREE.Object3D) {
  object.removeFromParent();
  const textures=new Set<THREE.Texture>(), materials=new Set<THREE.Material>(), geometries=new Set<THREE.BufferGeometry>();
  object.traverse(child=>{
    const mesh=child as THREE.Mesh;
    if(mesh.geometry)geometries.add(mesh.geometry);
    if(mesh.material)for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
      materials.add(material);
      const map=(material as THREE.MeshBasicMaterial).map;if(map)textures.add(map);
    }
  });
  textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());
}
function paintedTexture(width:number,height:number,paint:(ctx:CanvasRenderingContext2D)=>void) {
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(ctx)paint(ctx);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  return texture;
}
function wrap(ctx:CanvasRenderingContext2D,text:string,x:number,y:number,width:number,lineHeight:number) {
  let line='';for(const word of text.split(' ')){
    const next=line?line+' '+word:word;
    if(ctx.measureText(next).width>width&&line){ctx.fillText(line,x,y);y+=lineHeight;line=word;}else line=next;
  }ctx.fillText(line,x,y);
}

/** One animation loop owns all motion. Server snapshots remain the only game state. */
export function createBoard3D(container:HTMLElement,board:SpaceData[],groups:Record<string,GroupData>,onSelect:(id:number)=>void):Board3DController {
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const listeners=new AbortController();
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  const canvas=renderer.domElement;canvas.setAttribute('aria-label','Interactive city board. Use arrow keys to inspect spaces; Enter opens the selected property.');canvas.tabIndex=0;
  container.append(canvas);
  const overlay=document.createElement('div');overlay.className='board-owner-overlay';container.append(overlay);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#e8e3d5');
  const camera=new THREE.PerspectiveCamera(43,1,.1,80);
  const ambient=new THREE.HemisphereLight('#fff8e6','#71837c',2.1);scene.add(ambient);
  const sun=new THREE.DirectionalLight('#fff4dc',2.2);sun.position.set(-4,16,8);sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-8,right:8,top:8,bottom:-8,near:.5,far:40});
  sun.shadow.bias=-.001;scene.add(sun);

  const base=new THREE.Mesh(new THREE.BoxGeometry(12.35,.22,12.35),new THREE.MeshStandardMaterial({color:'#202c2e',roughness:.85}));
  base.position.y=-.15;base.receiveShadow=true;scene.add(base);
  const center=new THREE.Mesh(new THREE.BoxGeometry(9.1,.05,9.1),new THREE.MeshStandardMaterial({color:'#bce3ed',roughness:.9}));
  center.position.y=-.005;center.receiveShadow=true;scene.add(center);
  const brandTexture=paintedTexture(1024,1024,ctx=>{
    ctx.fillStyle='#bce3ed';ctx.fillRect(0,0,1024,1024);
    ctx.translate(512,512);ctx.rotate(-Math.PI/7);
    ctx.fillStyle='#1c292b';ctx.fillRect(-430,-74,860,148);
    ctx.textAlign='center';ctx.fillStyle='#fff7e4';ctx.font='900 98px Arial';ctx.fillText('MARKET WARS',0,33);
    ctx.font='bold 22px Arial';ctx.fillStyle='#344e53';ctx.fillText('BUILD YOUR ADVANTAGE. OWN YOUR STRATEGY.',0,117);
    for(const [x,y,label] of [[-185,-300,'MARKET EVENTS'],[185,320,'ECONOMIC EVENTS']] as [number,number,string][]){
      ctx.fillStyle='#fff9e9';ctx.fillRect(x-172,y-74,344,148);
      ctx.strokeStyle='#243536';ctx.lineWidth=4;ctx.strokeRect(x-172,y-74,344,148);
      ctx.font='bold 26px Arial';ctx.fillStyle='#243536';ctx.fillText(label,x,y+10);
    }
  });
  const branding=new THREE.Mesh(new THREE.PlaneGeometry(8.7,8.7),new THREE.MeshBasicMaterial({map:brandTexture}));
  branding.rotation.x=-Math.PI/2;branding.position.y=.025;scene.add(branding);

  const tiles=new Map<number,THREE.Group>(),surfaces=new Map<number,THREE.Mesh>(),targets:THREE.Object3D[]=[];
  const buildings=new Map<number,THREE.Group>(),owners=new Map<number,{button:HTMLButtonElement;anchor:THREE.Vector3;key:string}>();
  const assetsCache=new Map<number,string>();
  const popIns=new Map<THREE.Object3D,{start:number;delay:number}>();
  let selected=0,ready=false,destroyed=false;
  const createdAt=performance.now();
  board.forEach(space=>{
    const p=tile(space.id),group=new THREE.Group();group.position.set(p.x,0,p.z);scene.add(group);tiles.set(space.id,group);
    const body=new THREE.Mesh(new THREE.BoxGeometry(p.w-.045,HEIGHT,p.d-.045),new THREE.MeshStandardMaterial({color:space.price?'#f5f0df':'#cde8ed',roughness:.8}));
    body.position.y=HEIGHT/2;body.castShadow=true;body.receiveShadow=true;body.userData.spaceId=space.id;
    group.add(body);surfaces.set(space.id,body);targets.push(body);
    const texture=paintedTexture(256,320,ctx=>{
      ctx.fillStyle=space.price?'#f5f0df':'#cde8ed';ctx.fillRect(0,0,256,320);
      if(space.group){ctx.fillStyle=groups[space.group]?.color||'#9ab5ba';ctx.fillRect(0,0,256,55);}
      ctx.fillStyle='#1e2c2d';ctx.textAlign='center';ctx.font='bold 30px Arial';
      wrap(ctx,space.name,128,space.price?96:93,234,35);
      ctx.font='bold 35px Arial';ctx.fillText(space.price?'$'+space.price:(space.symbol||'◇'),128,278);
    });
    const face=new THREE.Mesh(new THREE.PlaneGeometry(p.w-.065,p.d-.065),new THREE.MeshBasicMaterial({map:texture}));
    face.rotation.set(-Math.PI/2,0,0);face.position.y=HEIGHT+.002;group.add(face);
  });

  function buildingGroup(id:number,count:number,color:string,animate:boolean) {
    const previous=buildings.get(id);if(previous){popIns.delete(previous);release(previous);buildings.delete(id);}
    if(!count)return;
    const p=tile(id),group=new THREE.Group();
    group.position.set(p.x,HEIGHT,p.z);scene.add(group);buildings.set(id,group);
    const n=count===5?1:count;
    for(let i=0;i<n;i++){
      const house=new THREE.Group(),h=count===5?.94:.23;
      const body=new THREE.Mesh(new THREE.BoxGeometry(count===5?.38:.19,h,.25),new THREE.MeshStandardMaterial({color,roughness:.75}));
      body.position.y=h/2;body.castShadow=true;house.add(body);
      const roof=new THREE.Mesh(new THREE.ConeGeometry(count===5?.32:.17,.15,4),new THREE.MeshStandardMaterial({color:'#fff2d5'}));
      roof.rotation.y=Math.PI/4;roof.position.y=h+.075;roof.castShadow=true;house.add(roof);
      const offset=(i-(n-1)/2)*.235;
      house.position.set(p.col===0?.40:p.col===10?-.40:offset,0,p.row===0?.40:p.row===10?-.40:offset);
      group.add(house);
    }
    if(animate&&!motion.matches)popIns.set(group,{start:performance.now(),delay:0});
  }
  function ownerBadge(id:number,asset:AssetState,animate:boolean) {
    const old=owners.get(id);
    if(asset.owner===null){old?.button.remove();owners.delete(id);return;}
    const key=[asset.owner,asset.ownerName,asset.buildings,asset.mortgaged].join('|');
    if(old?.key===key)return;
    const button=old?.button||document.createElement('button');
    button.type='button';button.className='board-owner-marker';button.dataset.property=String(id);
    button.style.setProperty('--owner-color',asset.ownerColor||'#304d50');
    button.replaceChildren();
    const icon=document.createElement('span');icon.className='owner-marker-icon';icon.textContent=asset.ownerSymbol||'●';icon.setAttribute('aria-hidden','true');
    const amount=document.createElement('span');amount.className='owner-marker-count';
    amount.textContent=asset.buildings===5?'▥ 1':asset.buildings?'⌂ '+asset.buildings:'';
    button.append(icon,amount);
    const buildingLabel=asset.buildings===5?'1 tower':asset.buildings+' houses';
    button.title=board[id].name+' belongs to '+asset.ownerName+' · '+buildingLabel;
    button.setAttribute('aria-label',button.title);button.onclick=()=>onSelect(id);
    if(!old)overlay.append(button);
    const p=tile(id),anchor=new THREE.Vector3(p.x,HEIGHT+.5,p.z);
    if(p.row===0)anchor.z-=.48;else if(p.row===10)anchor.z+=.48;else if(p.col===0)anchor.x-=.48;else anchor.x+=.48;
    owners.set(id,{button,anchor,key});
    if(animate&&!motion.matches)icon.animate([{transform:'translateY(-22px) scale(.3)',opacity:0},{transform:'translateY(-5px) scale(1.3)',opacity:1,offset:.65},{transform:'translateY(0) scale(1)',opacity:1}],{duration:650,easing:'cubic-bezier(.2,.8,.2,1)'});
  }

  const tokens=new Map<number,THREE.Group>();
  const moves=new Map<number,{from:THREE.Vector3;to:THREE.Vector3;start:number;duration:number}>();
  const tokenHomes=new Map<number,THREE.Vector3>();
  function makeToken(t:TokenState){
    const group=new THREE.Group();
    const body=new THREE.Mesh(new THREE.CylinderGeometry(.12,.20,.35,16),new THREE.MeshStandardMaterial({color:t.color,roughness:.35,metalness:.15}));
    body.position.y=.18;body.castShadow=true;group.add(body);
    const head=new THREE.Mesh(new THREE.SphereGeometry(.13,12,10),new THREE.MeshStandardMaterial({color:t.color,roughness:.3}));
    head.position.y=.42;head.castShadow=true;group.add(head);
    const iconTexture=paintedTexture(96,96,ctx=>{
      ctx.fillStyle=t.color;ctx.beginPath();ctx.arc(48,48,44,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#fff9ea';ctx.lineWidth=5;ctx.stroke();ctx.font='48px "Segoe UI Emoji",Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(t.symbol||'●',48,49);
    });
    const badge=new THREE.Sprite(new THREE.SpriteMaterial({map:iconTexture,depthTest:false}));badge.scale.set(.38,.38,1);badge.position.y=.74;group.add(badge);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.24,.022,6,24),new THREE.MeshBasicMaterial({color:'#fff8db'}));
    ring.rotation.x=Math.PI/2;ring.position.y=.025;ring.name='active-ring';group.add(ring);
    scene.add(group);tokens.set(t.id,group);return group;
  }
  function updateTokens(list:TokenState[],speed=1){
    const live=new Set(list.map(t=>t.id));
    for(const [id,group] of tokens)if(!live.has(id)){release(group);tokens.delete(id);moves.delete(id);tokenHomes.delete(id);}
    list.forEach(t=>{
      const existing=tokens.get(t.id),group=existing||makeToken(t);group.visible=!t.bankrupt;
      group.userData.active=t.active;group.getObjectByName('active-ring')!.visible=t.active&&!t.bankrupt;
      const shared=list.filter(other=>!other.bankrupt&&other.position===t.position),index=shared.findIndex(other=>other.id===t.id),p=tile(t.position);
      const dest=new THREE.Vector3(p.x+(shared.length>1?(index%2? .23:-.23):0),HEIGHT+.02,p.z+(shared.length>2?(index<2?-.20:.20):0));
      if(tokenHomes.get(t.id)?.equals(dest))return;
      tokenHomes.set(t.id,dest);
      if(!existing||motion.matches){moves.delete(t.id);group.position.copy(dest);}
      else moves.set(t.id,{from:group.position.clone(),to:dest,start:performance.now(),duration:150/Math.max(1,speed)});
    });
  }

  const normals=[new THREE.Vector3(),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,0,-1),new THREE.Vector3(0,-1,0)];
  const pipLayouts:number[][][]=[[],[[0,0]],[[-1,-1],[1,1]],[[-1,-1],[0,0],[1,1]],[[-1,-1],[1,-1],[-1,1],[1,1]],[[-1,-1],[1,-1],[0,0],[-1,1],[1,1]],[[-1,-1],[1,-1],[-1,0],[1,0],[-1,1],[1,1]]];
  const dice=[new THREE.Group(),new THREE.Group()];
  dice.forEach((group,index)=>{
    const box=new THREE.Mesh(new THREE.BoxGeometry(SIZE,SIZE,SIZE),new THREE.MeshStandardMaterial({color:'#fff9ec',roughness:.38}));box.castShadow=true;group.add(box);
    for(let value=1;value<=6;value++){
      const normal=normals[value],u=new THREE.Vector3(Math.abs(normal.y)>.5?1:0,Math.abs(normal.x)>.5?1:0,0);
      if(Math.abs(normal.z)>.5)u.set(1,0,0);
      const v=new THREE.Vector3().crossVectors(normal,u);
      const pipMaterial=new THREE.MeshBasicMaterial({color:'#1b2b2e'});
      for(const [x,y] of pipLayouts[value]){
        const pip=new THREE.Mesh(new THREE.CircleGeometry(.05,10),pipMaterial);
        pip.position.copy(normal).multiplyScalar(SIZE/2+.002).addScaledVector(u,x*.19).addScaledVector(v,y*.19);
        pip.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);group.add(pip);
      }
    }
    group.position.set(index? .65:-.65,.44,.45);scene.add(group);
  });
  let roll:{start:number;duration:number;values:[number,number];settle:THREE.Quaternion[]}|null=null;
  const dieQuaternion=(value:number,index:number)=>new THREE.Quaternion().setFromAxisAngle(UP,index?.16:-.16).multiply(new THREE.Quaternion().setFromUnitVectors(normals[value]||UP,UP));
  function setDice(values:[number,number]){
    roll=null;container.dataset.diceState='settled';container.dataset.diceValues=values.join(',');
    dice.forEach((die,i)=>{die.quaternion.copy(dieQuaternion(values[i],i));die.position.set(i?.65:-.65,.44,.45);});
  }
  function rollDice(values:[number,number],phase:'rolling'|'settled',speed=1){
    if(phase==='settled'||motion.matches){setDice(values);return;}
    if(roll)return;
    roll={start:performance.now(),duration:950/Math.max(1,speed),values,settle:[]};
    container.dataset.diceState='rolling';delete container.dataset.diceValues;
  }

  const view={phi:.90,theta:0,radius:18.8,x:0,z:0};
  const desired={...view};
  let movingCamera=false;
  function cameraPosition(){
    const distance=view.radius*Math.max(1,1.15/camera.aspect);
    camera.position.set(view.x+distance*Math.cos(view.phi)*Math.sin(view.theta),distance*Math.sin(view.phi),view.z+distance*Math.cos(view.phi)*Math.cos(view.theta));
    camera.lookAt(view.x,0,view.z);camera.updateMatrixWorld();
  }
  function resetCamera(){Object.assign(desired,{phi:.90,theta:0,radius:18.8,x:0,z:0});movingCamera=true;}
  function topCamera(){Object.assign(desired,{phi:Math.PI/2-.025,theta:0,radius:17.4,x:0,z:0});movingCamera=true;}
  cameraPosition();
  const pointers=new Map<number,{x:number;y:number}>();let startPoint={x:0,y:0},dragged=false,lastPinch=0;
  const on=(type:string,fn:EventListener,options:AddEventListenerOptions={})=>canvas.addEventListener(type,fn,{...options,signal:listeners.signal});
  function pick(x:number,y:number){
    const rect=canvas.getBoundingClientRect(),point=new THREE.Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1);
    const ray=new THREE.Raycaster();ray.setFromCamera(point,camera);const hit=ray.intersectObjects(targets)[0];if(hit)onSelect(hit.object.userData.spaceId);
  }
  on('pointerdown',((event:PointerEvent)=>{
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.setPointerCapture(event.pointerId);
    startPoint={x:event.clientX,y:event.clientY};dragged=false;lastPinch=0;
  }) as EventListener);
  on('pointermove',((event:PointerEvent)=>{
    const old=pointers.get(event.pointerId);if(!old)return;
    const dx=event.clientX-old.x,dy=event.clientY-old.y;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(Math.hypot(event.clientX-startPoint.x,event.clientY-startPoint.y)>5)dragged=true;
    if(pointers.size===2){
      dragged=true;const [a,b]=[...pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);
      if(lastPinch)desired.radius=THREE.MathUtils.clamp(desired.radius-(distance-lastPinch)*.035,9,26);lastPinch=distance;
    }else if(event.buttons===2){desired.x-=dx*.012;desired.z-=dy*.012;}
    else{desired.theta-=dx*.007;desired.phi=THREE.MathUtils.clamp(desired.phi-dy*.005,.35,Math.PI/2-.025);}
    movingCamera=true;
  }) as EventListener);
  on('pointerup',((event:PointerEvent)=>{
    if(!dragged&&pointers.size===1&&event.button===0)pick(event.clientX,event.clientY);
    pointers.delete(event.pointerId);lastPinch=0;
  }) as EventListener);
  on('pointercancel',((event:PointerEvent)=>{pointers.delete(event.pointerId);lastPinch=0;}) as EventListener);
  on('contextmenu',event=>event.preventDefault());
  on('wheel',((event:WheelEvent)=>{event.preventDefault();desired.radius=THREE.MathUtils.clamp(desired.radius+event.deltaY*.012,9,26);movingCamera=true;}) as EventListener,{passive:false});
  on('keydown',((event:KeyboardEvent)=>{
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();selected=(selected+(['ArrowLeft','ArrowDown'].includes(event.key)?1:39))%40;canvas.setAttribute('aria-label',board[selected].name+'. Press Enter for property details.');}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect(selected);}
    if(event.key==='Home')resetCamera();
  }) as EventListener);
  function updateTiles(assets:Record<number,AssetState>,selectedId:number){
    selected=selectedId;
    for(const space of board){
      const asset=assets[space.id];if(!asset)continue;
      const key=JSON.stringify(asset);if(assetsCache.get(space.id)===key)continue;
      const animate=ready&&assetsCache.has(space.id);
      assetsCache.set(space.id,key);
      ownerBadge(space.id,asset,animate);
      const old=buildings.get(space.id),buildingKey=asset.buildings+'|'+asset.ownerColor;
      if(old?.userData.key!==buildingKey){
        buildingGroup(space.id,asset.buildings,asset.ownerColor||groups[space.group||'']?.color||'#356452',animate);
        const next=buildings.get(space.id);if(next)next.userData.key=buildingKey;
      }
      const surface=surfaces.get(space.id)!;
      (surface.material as THREE.MeshStandardMaterial).color.set(asset.mortgaged?'#969f9a':'#f5f0df');
    }
    ready=true;
  }
  function resize(){
    const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;
    renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();cameraPosition();
  }
  const observer=new ResizeObserver(resize);observer.observe(container);
  let raf=0,last=performance.now();
  function frame(now:number){
    if(destroyed)return;raf=requestAnimationFrame(frame);
    if(!container.clientWidth||document.hidden){last=now;return;}
    const dt=Math.min((now-last)/1000,.05);last=now;
    if(movingCamera){
      let difference=0;
      for(const key of Object.keys(view) as (keyof typeof view)[]){difference+=Math.abs(desired[key]-view[key]);view[key]=motion.matches?desired[key]:THREE.MathUtils.lerp(view[key],desired[key],1-Math.exp(-10*dt));}
      movingCamera=difference>.001;cameraPosition();
    }
    tiles.forEach((group,id)=>{
      const entrance=motion.matches?1:clamp((now-createdAt-id*12)/550);
      const lift=id===selected?.055:0;
      group.position.y=motion.matches?lift:entrance<1?-.65*(1-ease(entrance)):THREE.MathUtils.lerp(group.position.y,lift,1-Math.exp(-12*dt));
    });
    for(const [object,pop] of popIns){
      const t=motion.matches?1:clamp((now-pop.start-pop.delay)/550);
      const scale=t===1?1:1+2.7*Math.pow(t-1,3)+1.7*Math.pow(t-1,2);
      object.scale.setScalar(Math.max(.01,scale));if(t===1)popIns.delete(object);
    }
    tokens.forEach((group,id)=>{
      const move=moves.get(id),home=tokenHomes.get(id);
      if(move){
        const t=motion.matches?1:clamp((now-move.start)/move.duration);
        group.position.lerpVectors(move.from,move.to,ease(t));group.position.y+=motion.matches?0:Math.sin(Math.PI*t)*.24;
        if(t===1)moves.delete(id);
      }else if(home)group.position.y=home.y+(group.userData.active&&!motion.matches?Math.sin(now*.003)*.025:0);
      const ring=group.getObjectByName('active-ring');if(ring)ring.scale.setScalar(motion.matches?1:1+Math.sin(now*.004)*.08);
    });
    if(roll){
      const t=motion.matches?1:clamp((now-roll.start)/roll.duration);
      dice.forEach((die,i)=>{
        const spin=Math.min(t/.75,1),direction=i?-1:1;
        if(t<.75)die.rotation.set(spin*Math.PI*5,spin*Math.PI*4*direction,spin*Math.PI*3);
        else {
          if(!roll!.settle[i])roll!.settle[i]=die.quaternion.clone();
          die.quaternion.slerpQuaternions(roll!.settle[i],dieQuaternion(roll!.values[i],i),ease((t-.75)/.25));
        }
        die.position.set((i?.65:-.65)+Math.sin(t*Math.PI*2+i)*.4*(1-t),.44+Math.abs(Math.sin(t*Math.PI*3))*(1-t)*1.6,.45+Math.sin(t*Math.PI)*.4*direction);
      });
      if(t===1)setDice(roll.values);
    }
    owners.forEach(({button,anchor})=>{
      const point=anchor.clone().project(camera);
      button.style.transform='translate(-50%,-50%) translate('+((point.x+1)*container.clientWidth/2)+'px,'+((-point.y+1)*container.clientHeight/2)+'px)';
      button.hidden=point.z>1||point.z< -1;
    });
    renderer.render(scene,camera);
  }
  function init(){resize();setDice([1,1]);raf=requestAnimationFrame(frame);}
  function destroy(){
    destroyed=true;cancelAnimationFrame(raf);listeners.abort();observer.disconnect();
    owners.forEach(owner=>owner.button.remove());moves.clear();popIns.clear();
    release(scene);renderer.dispose();canvas.remove();overlay.remove();
  }
  return {init,updateTiles,updateTokens,rollDice,setDice,resize,resetCamera,topCamera,destroy};
}
