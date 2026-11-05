/* Optional advanced/private Studio. Private state lives only in this closure. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  let privateMode = false, token = '', workspace = null, epoch = 0, catalog = null;
  let reference = null, maskId = null, maskDirty = true, pending = null, activeJob = null;
  let busy = false, drawing = false, presets = [], expiryTimer = null, historyRead = 0, polling = false;
  const dialog = el('advancedDialog'), canvas = el('advancedMask'), ctx = canvas.getContext('2d');
  const prefix = () => privateMode ? '/api/private-studio' : '/api/studio';
  function text(tag, value) { const node = document.createElement(tag); node.textContent = value; return node; }
  function button(label, action) { const node = text('button',label); node.type = 'button'; node.addEventListener('click',action); return node; }
  function status(value) { el('advancedStatus').textContent = value; }
  async function request(path, method = 'GET', body, raw = false) {
    requireOwner(); const version = epoch, auth = state.authVersion;
    const headers = {'X-Luma-Owner-Token':state.token}; if (token) headers['X-Luma-Studio-Session'] = token;
    if (body !== undefined) headers['Content-Type'] = raw ? body.type : 'application/json';
    const response = await fetch(path,{method,headers,cache:'no-store',credentials:'same-origin',body:body===undefined?undefined:raw?body:JSON.stringify(body)});
    if (version !== epoch || auth !== state.authVersion) throw new Error('Studio session changed');
    if (!response.ok) {
      if (response.status === 423 || response.status === 401) lock();
      const data = await response.json().catch(() => ({}));
      throw new Error(typeof data.detail==='string'?data.detail:'Studio request rejected');
    }
    return response.json();
  }
  async function media(path) {
    const version = epoch, auth = state.authVersion;
    const headers = {'X-Luma-Owner-Token':state.token}; if (token) headers['X-Luma-Studio-Session']=token;
    const response=await fetch(path,{headers,cache:'no-store'});
    if (!response.ok) throw new Error('Private image unavailable');
    const blob=await response.blob();
    return new Promise((resolve,reject) => {const reader=new FileReader();reader.onload=()=>version===epoch&&auth===state.authVersion?resolve(reader.result):reject(new Error('Studio locked'));reader.onerror=reject;reader.readAsDataURL(blob);});
  }
  function clearSensitive() {
    epoch++; token='';workspace=null;reference=null;pending=null;activeJob=null;busy=false;catalog=null;presets=[];maskId=null;
    clearTimeout(expiryTimer);canvas.width=0;canvas.height=0;el('advancedSourcePreview').removeAttribute('src');el('advancedSourcePreview').hidden=true;
    for(const id of ['advancedResults','studioGallery','modelManager','loraManager','advancedModel','loraPresets']) el(id).replaceChildren();
    for(const id of ['advancedPrompt','advancedNegative','advancedSeed','advancedReferenceUpload']) el(id).value='';
    for(const id of ['eligibleAdult','fictionalAdults','acceptStudioPolicies','confirmPrivateCloud']) el(id).checked=false;
    el('advancedBody').hidden=true;el('privateGate').hidden=true;el('advancedMask').hidden=true;status('Locked');
  }
  function lock(refresh = true) {
    const owner=state.token, wasPrivate=privateMode, oldToken=token;
    clearSensitive(); if(dialog.open) dialog.close();
    if(wasPrivate&&oldToken&&owner) fetch('/api/private-studio/lock',{method:'POST',headers:{'X-Luma-Owner-Token':owner},cache:'no-store'}).catch(()=>{});
    if(!wasPrivate&&state.token&&refresh===true) refreshAll();
  }
  window.lumaLockStudio=()=>lock(false);
  async function open(isPrivate) {
    try {
      requireOwner(); if(dialog.open) lock(); clearSensitive(); privateMode=isPrivate;
      dialog.classList.toggle('private-mode',isPrivate);el('advancedTitle').textContent=isPrivate?'Private Studio 18+':'Advanced Studio';
      el('privateGate').hidden=!isPrivate;el('advancedBody').hidden=isPrivate;
      for(const id of ['hiddenGalleryLabel','galleryVisibilityLabel','deleteStudioWorkspace']) el(id).hidden=!isPrivate;
      dialog.showModal();el('attachMenu').hidden=true;
      if(!isPrivate) {workspace=state.conversationId;await refreshCatalog();await refreshHistory();}
    } catch(error) {showToast(error.message,true);}
  }
  async function refreshCatalog() {
    catalog=await request(`${prefix()}/catalog?engine=${el('advancedEngine').value}`);
    el('engineAvailability').textContent=catalog.available?'Engine ready; only reviewed model/LoRA combinations can run.':catalog.reason||'Engine unavailable';
    el('advancedGenerate').disabled=!catalog.available;
    const models=el('advancedModel');models.replaceChildren();
    for(const model of catalog.models) {const option=text('option',`${model.display_name} (${model.family})${model.ready?'':' — unavailable'}`);option.value=model.id;option.disabled=!model.ready;models.append(option);}
    if(catalog.default_model&&catalog.models.some(m=>m.id===catalog.default_model&&m.ready)) models.value=catalog.default_model;
    else models.value=catalog.models.find(m=>m.ready)?.id||'';
    el('modelManager').replaceChildren();
    for(const model of catalog.models) el('modelManager').append(text('div',`${model.display_name} · ${model.version||'unknown version'} · ${model.family} · ${model.verification||'unverified'}\n${model.requirements||''}\nLicense: ${model.license||'unknown'}; source: ${model.source||'unknown'}\n${model.reason||'Compatible and available'}`));
    const data=await request(`${prefix()}/presets`);presets=data.items;el('loraPresets').replaceChildren(text('option','Select preset'));
    for(const preset of presets){const option=text('option',preset.name);option.value=preset.id;el('loraPresets').append(option);}
    renderLoras(); controls();
  }
  function renderLoras() {
    const model=catalog?.models.find(m=>m.id===el('advancedModel').value);el('loraManager').replaceChildren();
    for(const lora of catalog?.loras||[]) {
      const row=document.createElement('label'),check=document.createElement('input'),strength=document.createElement('input');
      check.type='checkbox';check.dataset.lora=lora.id;check.disabled=!lora.ready||lora.family!==model?.family||(lora.compatible_models?.length&&!lora.compatible_models.includes(model?.id));
      strength.type='number';strength.min='-1';strength.max='1.5';strength.step='.1';strength.value='1';strength.dataset.loraStrength=lora.id;
      row.append(check,text('span',`${lora.display_name} · ${lora.family}${check.disabled?' · incompatible/unavailable':''}`),strength);el('loraManager').append(row);
    }
  }
  function selections() {return [...el('loraManager').querySelectorAll('[data-lora]:checked')].map(node=>({id:node.dataset.lora,strength:Number([...el('loraManager').querySelectorAll('[data-lora-strength]')].find(n=>n.dataset.loraStrength===node.dataset.lora).value)}));}
  function controls() {
    const cloud=el('advancedEngine').value==='cloud', edit=el('advancedOperation').value!=='text_to_image';
    el('nativeParameters').hidden=cloud;el('negativeLabel').hidden=cloud;el('loraSection').hidden=cloud;el('privateCloudLabel').hidden=!(privateMode&&cloud);
    el('referenceControls').hidden=!edit;el('maskTools').hidden=el('advancedOperation').value!=='inpaint';canvas.hidden=!reference||el('advancedOperation').value!=='inpaint';
  }
  async function ensureWorkspace() {
    if(workspace)return;
    const result=privateMode?await request('/api/private-studio/workspaces','POST',{}):await request('/api/conversations','POST',{title:'Advanced artwork'});
    workspace=result.id;await refreshGallery();
  }
  async function refreshGallery() {
    if(!privateMode)return;
    const data=await request(`/api/private-studio/workspaces?include_hidden=${el('includeHiddenGallery').checked}`);
    el('studioGallery').replaceChildren();
    data.items.forEach((row,index)=>el('studioGallery').append(button(`Private workspace ${index+1}${row.gallery_visible?'':' (hidden)'}`,async()=>{
      try {workspace=row.id;reference=null;maskId=null;pending=null;el('galleryVisibility').checked=row.gallery_visible;await refreshHistory();}catch(error){status(error.message);}
    })));
  }
  async function refreshHistory(renderImages = true) {
    if(!workspace)return;
    const version=epoch, read=++historyRead;
    const data=await request(privateMode?`/api/private-studio/workspaces/${workspace}`:`/api/images/conversations/${workspace}`);
    if(version!==epoch || read!==historyRead)return;
    if(renderImages) el('advancedResults').replaceChildren();
    for(const asset of (renderImages ? data.assets.filter(a=>a.message_id) : [])) {
      const row=document.createElement('figure');row.className='advanced-result';const image=document.createElement('img');image.alt='Studio image revision';image.dataset.advancedAsset=asset.id;
      row.append(image);el('advancedResults').append(row);
      media(`${privateMode?'/api/private-studio':'/api/images'}/assets/${asset.id}`).then(src=>{if(version===epoch&&image.isConnected)image.src=src;}).catch(()=>{});
      row.append(button('Use as reference / edit',()=>selectReference({parent_id:asset.id},`${privateMode?'/api/private-studio':'/api/images'}/assets/${asset.id}`)),button('Download',async()=>{
        try{const src=await media(`${privateMode?'/api/private-studio':'/api/images'}/assets/${asset.id}?download=true`);const a=document.createElement('a');a.href=src;a.download=asset.id+'.png';a.click();}catch(error){status(error.message);}
      }));
      if(asset.parent_id) row.append(button('Compare original',async()=>{try{const src=await media(`${privateMode?'/api/private-studio':'/api/images'}/assets/${asset.parent_id}`);const original=document.createElement('img');original.alt='Original revision';original.src=src;if(version===epoch)row.append(original);}catch(error){status(error.message);}}));
    }
    activeJob=data.jobs.find(j=>j.provider_active)||null;
    el('advancedCancel').hidden=!activeJob||!['running','needs_recovery'].includes(activeJob.status);el('advancedRecover').hidden=!activeJob||!['needs_recovery','cancelled'].includes(activeJob.status);
    if(activeJob) {const detail=await request(`${prefix()}/jobs/${activeJob.id}`);el('advancedProgress').value=detail.execution?.progress||0;el('advancedRecover').hidden=!detail.execution?.remote_id;status(`Job ${detail.status} · ${detail.execution?.stage||'cloud request'}${detail.error?' · '+detail.error:''}`);}
  }
  async function upload(blob) {
    await ensureWorkspace();
    return request(privateMode?`/api/private-studio/workspaces/${workspace}/uploads`:'/api/chat/attachments','POST',blob,true);
  }
  async function selectReference(fields,path) {
    try {
      const src=await media(path);reference=fields;maskId=null;maskDirty=true;
      const image=el('advancedSourcePreview');image.onload=()=>{
        if(image.naturalWidth*image.naturalHeight>1048576){status('Reference exceeds editor pixel budget; use a smaller image.');reference=null;image.removeAttribute('src');return;}
        canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;ctx.fillStyle='black';ctx.fillRect(0,0,canvas.width,canvas.height);controls();
      };
      image.src=src;image.hidden=false;el('referenceSelection').textContent=fields.parent_id?'Selected immutable revision':'Uploaded reference selected';el('advancedOperation').value='image_to_image';controls();
    } catch(error){status(error.message);}
  }
  el('advancedReferenceUpload').addEventListener('change',async()=>{
    const file=el('advancedReferenceUpload').files[0];if(!file)return;
    try {if(file.size>4194304)throw new Error('Reference exceeds 4 MiB');const data=await upload(file);await selectReference({reference_attachment_id:data.id},`${privateMode?'/api/private-studio':'/api/chat'}/uploads/${data.id}`.replace('/api/chat/uploads/','/api/chat/attachments/'));}catch(error){status(error.message);}finally{el('advancedReferenceUpload').value='';}
  });
  function stroke(event) {
    if(!drawing)return;const rect=canvas.getBoundingClientRect();const x=(event.clientX-rect.left)*canvas.width/rect.width,y=(event.clientY-rect.top)*canvas.height/rect.height;
    ctx.fillStyle=el('maskErase').checked?'black':'white';ctx.beginPath();ctx.arc(x,y,Number(el('maskBrushSize').value)/2,0,Math.PI*2);ctx.fill();maskDirty=true;
  }
  canvas.addEventListener('pointerdown',event=>{drawing=true;canvas.setPointerCapture(event.pointerId);stroke(event);});canvas.addEventListener('pointermove',stroke);canvas.addEventListener('pointerup',()=>drawing=false);canvas.addEventListener('pointercancel',()=>drawing=false);
  el('maskReset').addEventListener('click',()=>{ctx.fillStyle='black';ctx.fillRect(0,0,canvas.width,canvas.height);maskDirty=true;});
  el('maskInvert').addEventListener('click',()=>{if(!canvas.width)return;const data=ctx.getImageData(0,0,canvas.width,canvas.height);for(let i=0;i<data.data.length;i+=4)data.data[i]=data.data[i+1]=data.data[i+2]=255-data.data[i];ctx.putImageData(data,0,0);maskDirty=true;});
  el('maskCompare').addEventListener('click',()=>canvas.hidden=!canvas.hidden);
  el('advancedForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;const version=epoch;
    try {
      if(!confirm('Run this explicit image operation? GPU time or cloud charges may apply. No automatic retry.'))return;
      busy=true;el('advancedGenerate').disabled=true;await ensureWorkspace();
      const engine=el('advancedEngine').value,operation=el('advancedOperation').value;
      const payload={engine,operation,model:el('advancedModel').value,prompt:el('advancedPrompt').value,confirm_cloud:el('confirmPrivateCloud').checked};
      if(operation!=='text_to_image'){if(!reference)throw new Error('Select a reference first');Object.assign(payload,reference);}
      if(engine!=='cloud')Object.assign(payload,{negative_prompt:el('advancedNegative').value,width:Number(el('advancedWidth').value),height:Number(el('advancedHeight').value),steps:Number(el('advancedSteps').value),cfg:Number(el('advancedCfg').value),denoise:Number(el('advancedDenoise').value),n:Number(el('advancedBatch').value),loras:selections(),...(el('advancedSeed').value!==''?{seed:Number(el('advancedSeed').value)}:{})});
      if(operation==='inpaint') {
        if(!canvas.width)throw new Error('Load a reference before painting the mask');
        if(maskDirty||!maskId){const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));maskId=(await upload(blob)).id;maskDirty=false;}
        payload.mask_attachment_id=maskId;
      }
      const signature=JSON.stringify([workspace,payload]);if(!pending||pending.signature!==signature)pending={signature,payload:{...payload,client_message_id:crypto.randomUUID()}};
      const result=await request(privateMode?`/api/private-studio/workspaces/${workspace}/generate`:`/api/studio/conversations/${workspace}/generate`,'POST',pending.payload);
      if(version!==epoch)return;
      status(result.error||`Job ${result.status}`);if(result.status==='completed')pending=null;
      await refreshHistory();await refreshGallery();
    }catch(error){if(version===epoch)status(error.message);}
    finally{if(version===epoch){busy=false;el('advancedGenerate').disabled=!catalog?.available;}}
  });
  el('advancedEngine').addEventListener('change',()=>refreshCatalog().catch(error=>status(error.message)));
  el('advancedModel').addEventListener('change',()=>{renderLoras();controls();});el('advancedOperation').addEventListener('change',controls);
  el('saveDefaultModel').addEventListener('click',async()=>{try{await request(prefix()+'/default-model','PUT',{engine:el('advancedEngine').value,model:el('advancedModel').value});status('Default model saved');}catch(error){status(error.message);}});
  el('saveLoraPreset').addEventListener('click',async()=>{try{const name=prompt('Preset name');if(!name)return;const model=catalog.models.find(m=>m.id===el('advancedModel').value);await request(prefix()+'/presets','POST',{name,family:model.family,selections:selections(),engine:el('advancedEngine').value});await refreshCatalog();status('LoRA preset saved');}catch(error){status(error.message);}});
  el('loraPresets').addEventListener('change',()=>{const preset=presets.find(p=>p.id===el('loraPresets').value);if(!preset)return;for(const check of el('loraManager').querySelectorAll('[data-lora]')){const entry=preset.selections.find(s=>s.id===check.dataset.lora);check.checked=Boolean(entry)&&!check.disabled;if(entry)[...el('loraManager').querySelectorAll('[data-lora-strength]')].find(n=>n.dataset.loraStrength===entry.id).value=entry.strength;}});
  el('unlockStudio').addEventListener('click',async()=>{
    try{const unlockStarted=performance.now();const data=await request('/api/private-studio/unlock','POST',{adult_eligible:el('eligibleAdult').checked,fictional_adults_only:el('fictionalAdults').checked,accept_law_license_provider_policies:el('acceptStudioPolicies').checked});token=data.session_token;expiryTimer=setTimeout(lock,Math.max(0,data.valid_for_seconds*1000-(performance.now()-unlockStarted)));el('privateGate').hidden=true;el('advancedBody').hidden=false;await refreshCatalog();await refreshGallery();}catch(error){showToast(error.message,true);}
  });
  el('newStudioWorkspace').addEventListener('click',async()=>{try{workspace=null;reference=null;pending=null;el('advancedResults').replaceChildren();await ensureWorkspace();status('New workspace ready');}catch(error){status(error.message);}});
  el('includeHiddenGallery').addEventListener('change',()=>refreshGallery().catch(error=>status(error.message)));
  el('galleryVisibility').addEventListener('change',async()=>{try{if(workspace)await request(`/api/private-studio/workspaces/${workspace}`,'PATCH',{gallery_visible:el('galleryVisibility').checked});await refreshGallery();}catch(error){status(error.message);}});
  el('deleteStudioWorkspace').addEventListener('click',async()=>{try{if(!workspace||!confirm('Delete this private workspace and purge its local files? Remote engine files/backups are separate.'))return;await request(`/api/private-studio/workspaces/${workspace}`,'DELETE',{confirm_delete:true});await request('/api/private-studio/purge','POST',{});workspace=null;reference=null;pending=null;el('advancedResults').replaceChildren();canvas.width=0;el('advancedSourcePreview').removeAttribute('src');await refreshGallery();status('Workspace deleted; active remote jobs must finish before purge.');}catch(error){status(error.message);}});
  el('advancedCancel').addEventListener('click',async()=>{try{if(activeJob)await request(`${prefix()}/jobs/${activeJob.id}/cancel`,'POST',{});status('Cancellation requested. Physical slot remains reserved until completion is known.');}catch(error){status(error.message);}});
  el('advancedRecover').addEventListener('click',async()=>{try{if(activeJob)await request(`${prefix()}/jobs/${activeJob.id}/recover`,'POST',{});await refreshHistory();}catch(error){status(error.message);}});
  el('advancedLock').addEventListener('click',()=>lock());dialog.addEventListener('cancel',event=>{event.preventDefault();lock();});
  el('advancedStudioBtn').addEventListener('click',()=>open(false));el('privateStudioBtn').addEventListener('click',()=>open(true));
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&privateMode&&dialog.open)lock();});window.addEventListener('pagehide',()=>lock(false));
  setInterval(async()=>{if(busy&&workspace&&dialog.open&&!polling){polling=true;try{await refreshHistory(false);}catch(_){}finally{polling=false;}}},1000);
})();
