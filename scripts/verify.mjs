import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { compare, renderHtml, stableJson, LIMITS } from '../src/index.js';
const began=performance.now(), root=process.cwd();
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prompt-diff-verify-'));
const run=(cmd,args,cwd=root)=>{const r=spawnSync(cmd,args,{cwd,encoding:'utf8',env:{...process.env,npm_config_cache:path.join(dir,'cache'),npm_config_offline:'true',npm_config_audit:'false',npm_config_fund:'false',HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9'}});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;};
let browser;
try {
 run(process.execPath,['--test']);
 const packed=JSON.parse(run('npm',['pack','--json','--pack-destination',dir]))[0].filename;
 const install=path.join(dir,'installed');fs.mkdirSync(install);
 run('npm',['install','--offline','--ignore-scripts','--omit=dev','--no-package-lock','--prefix',install,path.join(dir,packed)]);
 const cli=path.join(install,'node_modules/local-llm-prompt-diff/bin/prompt-diff.js');
 const inputFiles=['before','after'].map(x=>path.join(root,'examples',x+'.json'));
 const hashes=()=>inputFiles.map(f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
 const beforeHashes=hashes();
 for(const suffix of ['one','two'])run(process.execPath,[cli,'compare',...inputFiles,'--json',path.join(dir,suffix+'.json'),'--html',path.join(dir,suffix+'.html')],install);
 for(const ext of ['json','html'])assert.deepEqual(fs.readFileSync(path.join(dir,'one.'+ext)),fs.readFileSync(path.join(dir,'two.'+ext)));
 assert.deepEqual(hashes(),beforeHashes);
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
 const context=await browser.newContext({offline:true,serviceWorkers:'block',viewport:{width:320,height:640}});
 const external=[],errors=[];context.on('serviceworker',()=>errors.push('unexpected service worker'));
 await context.route('**/*',route=>{if(route.request().url().startsWith('file:'))return route.continue();external.push(route.request().url());return route.abort();});
 context.on('request',req=>{if(/^(https?|wss?):/.test(req.url()))external.push(req.url());});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 let maxDom=0,maxArticles=0,cases=0,largestHtml=0,largestJson=0;
 async function checkReport(file,report){
   await page.goto(pathToFileURL(file).href);await page.waitForSelector('#status');
   for(const type of ['',...Object.keys(report.summary.byType)]){
     await page.selectOption('#filter',type);const expected=report.changes.map((c,i)=>({c,i})).filter(x=>!type||x.c.type===type);const actual=[];
     do {
       const records=await page.locator('article').evaluateAll(els=>els.map(e=>({i:Number(e.dataset.index),c:JSON.parse(e.querySelector('pre').textContent)})));
       actual.push(...records);maxArticles=Math.max(maxArticles,records.length);assert.ok(records.length<=LIMITS.pageSize);
       maxDom=Math.max(maxDom,await page.locator('*').count());
       if(await page.locator('#next').isDisabled())break;
       await page.click('#next');
     }while(true);
     assert.deepEqual(actual,expected.map(({i,c})=>({i,c})));
   }
   await page.selectOption('#filter','');
   for(const view of ['before','after']){
     await page.selectOption('#view',view);
     const texts=await page.locator('article pre').allTextContents();
     assert.deepEqual(texts,report.changes.slice(0,LIMITS.pageSize).map(c=>JSON.stringify(Object.hasOwn(c,view)?c[view]:Object.hasOwn(c,view+'Index')?c[view+'Index']:'(absent)',null,2)));
   }
   await page.selectOption('#view','both');
   await page.locator('h1').click();await page.keyboard.press('/');assert.equal(await page.locator('#filter').evaluate(e=>e===document.activeElement),true);
   await page.keyboard.press('Tab');assert.equal(await page.locator('#view').evaluate(e=>e===document.activeElement),true);
   assert.notEqual(await page.locator('#view').evaluate(e=>getComputedStyle(e).outlineStyle),'none');
   if(report.changes.length){await page.locator('article').first().focus();assert.notEqual(await page.locator('article').first().evaluate(e=>getComputedStyle(e).outlineStyle),'none');if(report.changes.length>1){await page.keyboard.press('ArrowDown');assert.equal(await page.locator('article').nth(1).evaluate(e=>e===document.activeElement),true);await page.keyboard.press('ArrowUp');}}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.equal(await page.locator('img,iframe,svg,link,script[src]').count(),0);assert.equal(await page.evaluate(()=>window.pwned),undefined);
   largestHtml=Math.max(largestHtml,fs.statSync(file).size);largestJson=Math.max(largestJson,Buffer.byteLength(stableJson(report)+'\n'));cases++;
 }
 await checkReport(path.join(dir,'one.html'),JSON.parse(fs.readFileSync(path.join(dir,'one.json'))));
 for(let seed=1;seed<=200;seed++){
   let x=seed;const rand=()=>((x=(Math.imul(x,1664525)+1013904223)>>>0)/2**32);
   const b={formatVersion:1,id:'before',variables:[{name:'v',default:'é😀'}],messages:Array.from({length:2+Math.floor(rand()*7)},(_,i)=>({id:'m'+i,role:'user',template:'你好 {{v}} '+i})),metadata:{tag:'safe'}};
   const a=structuredClone(b);a.id=seed===1?'a'.repeat(128):'after';a.messages.reverse();if(seed===1)a.messages[0].id='m'.repeat(128);a.messages[0].role='assistant';a.messages[0].template+=' </script><img src="https://example.invalid/x" onerror="window.pwned=1"> & 😀';a.variables[0].default='changed '+seed;a.variables.push({name:'new'});a.metadata.tag='<svg onload="fetch(\'https://example.invalid\')">';if(seed%2)a.messages.pop();if(seed%3)a.messages.push({id:'added',role:'tool',template:'new {{new}}'});
   const report=compare(b,a),file=path.join(dir,'seed.html');fs.writeFileSync(file,renderHtml(report));await checkReport(file,report);if(seed%25===0)console.error('Verified browser seeds: '+seed+'/200');
 }
 const b={formatVersion:1,id:'large',variables:Array.from({length:500},(_,i)=>({name:'v'+i,default:'old'})),messages:Array.from({length:500},(_,i)=>({id:'m'+i,role:'user',template:'old '+i})),metadata:Object.fromEntries(Array.from({length:50},(_,i)=>['k'+i,'old']))};
 const a=structuredClone(b);a.messages.reverse();a.messages.forEach(m=>{m.role='assistant';m.template='new 😀 '+m.id});a.variables.forEach(v=>v.default='new');Object.keys(a.metadata).forEach(k=>a.metadata[k]='new');
 const boundedStart=performance.now(),report=compare(b,a),html=renderHtml(report);const boundedMs=performance.now()-boundedStart;
 const large=path.join(dir,'large.html');fs.writeFileSync(large,html);await checkReport(large,report);
 await page.selectOption('#filter','');await page.locator('article').last().focus();await page.keyboard.press('ArrowDown');assert.equal(await page.locator('article').first().getAttribute('data-index'),'40');await page.keyboard.press('ArrowUp');assert.equal(await page.locator('article').last().getAttribute('data-index'),'39');
 await page.setViewportSize({width:1280,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const empty=compare(b,b);fs.writeFileSync(path.join(dir,'empty.html'),renderHtml(empty));await checkReport(path.join(dir,'empty.html'),empty);
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 const evidence={node:process.version,browser:browser.version(),browserCases:cases,seededCases:200,boundedFindings:report.changes.length,boundedCompareRenderMs:boundedMs,elapsedMs:performance.now()-began,peakVerifierRssKiB:process.resourceUsage().maxRSS,maxMountedArticles:maxArticles,maxDomElements:maxDom,largestHtmlBytes:largestHtml,largestJsonBytes:largestJson,automaticExternalRequests:external.length,installedOffline:true,byteIdentical:true,inputHashes:beforeHashes,limitations:['RSS covers verifier Node process only, excluding Chromium and spawned CLI/npm processes.','Offline emulation plus request interception verifies page traffic; it is not an OS network namespace.','Elapsed times and RSS are observations, not deterministic guarantees.']};
 console.log(JSON.stringify(evidence,null,2));
 if(process.argv.includes('--record'))fs.writeFileSync(path.join(root,'results/verification.json'),JSON.stringify(evidence,null,2)+'\n');
} finally {await browser?.close();fs.rmSync(dir,{recursive:true,force:true});}
