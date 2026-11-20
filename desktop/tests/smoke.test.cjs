'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('desktop shell contains primary ChatGPT-style navigation and composer',()=>{
  const html=read('index.html');
  for(const id of ['sidebar','chatList','projectList','accountTrigger','modelTrigger','messages','promptInput','sendButton','settingsModal','settingsBody','searchModal','temporaryToggle']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
});
test('windows renderer is isolated and sandboxed',()=>{
  const source=read('main.cjs');
  assert.match(source,/nodeIntegration:\s*false/);
  assert.match(source,/contextIsolation:\s*true/);
  assert.match(source,/sandbox:\s*true/);
  assert.match(source,/safeStorage\.encryptString/);
  assert.match(source,/shell\.openExternal/);
  assert.match(read('index.html'),/Content-Security-Policy/);
});
test('desktop supports persisted chat, project, library, and model workflows',()=>{
  const app=read('app.js');
  for(const feature of ['sendMessage','createProject','renderLibrary','renderSettings','syncModels','generateImage','temporaryMode','renderSearch']){
    assert.ok(app.includes(feature),'Expected '+feature);
  }
  assert.match(read('main.cjs'),/library:\s*Array\.isArray\(input\.library\)/);
});
test('Windows build targets portable executable',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.build.productName,'LUMAVUN Desktop');
  assert.ok(pkg.build.win.target.includes('portable'));
  assert.match(pkg.scripts.dist,/electron-builder/);
});
