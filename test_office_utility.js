'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
async function fixture(mode) {
    const nodes={}, calls=[], synced=[];
    const get=id=>nodes[id]||(nodes[id]={hidden:true,disabled:false,value:'',textContent:'',className:''});
    const state={history:{conversation_id:'c1',active_job:'j1',turns:[]},settings:{point_size:18,color:'#000000',align:'left',review:true},config:{model:'test-model',configured:true,key_source:'本机设置'}};
    const sandbox={URLSearchParams,location:{search:'?mode='+mode},document:{getElementById:get},
        window:{localStorage:{getItem(){return 'c1';}}},
        Office:{HostType:{PowerPoint:'PowerPoint'},context:{requirements:{isSetSupported(){return true;}}},onReady(fn){fn({host:'PowerPoint'});}},
        IguanaOffice:{async scanFormulas(){return {items:[{page:1,original:{tags:{LATEXADDIN:'x'},alt:''}}],skippedGroups:0,hasAlt:true};},
            async syncFormula(item,meta){synced.push({item,meta});}},
        async fetch(url,options){return {ok:true,json:async()=>{
            if(url==='/api/session')return {token:'test'};
            const req=JSON.parse(options.body);calls.push([url,req]);
            if(url==='/api/wps/settings')return Object.keys(req).length ? req : state.settings;
            if(url==='/api/chat/config')return Object.keys(req).length ? {...state.config,model:req.model} : state.config;
            if(url==='/api/office/batch/status'||url==='/api/office/batch/cancel')return {status:'idle'};
            if(url==='/api/chat/history')return state.history;
            if(url==='/api/chat/status')return {status:'running',message:'识别中'};
            if(url==='/api/chat/cancel')return {};
            if(url==='/api/metadata')return {found:true,tags:req.tags,alt:'backup'};
            if(url==='/api/doctor')return {xelatex:'available'};
            throw Error(url);
        }}}};
    vm.runInNewContext(fs.readFileSync('office_addin/utility.js','utf8'),sandbox);
    await new Promise(resolve=>setImmediate(resolve));
    return {get,calls,synced,state};
}
(async()=>{
    let f=await fixture('settings');assert.equal(f.get('settings').hidden,false);
    f.get('size').value='26';f.get('color').value='#AABBCC';f.get('align').value='right';await f.get('save').onclick();
    const saved=f.calls.find(c=>c[0]==='/api/wps/settings' && Object.keys(c[1]).length)[1];
    assert.equal(saved.point_size,26);assert.equal(saved.align,'right');assert.equal(saved.review,true);
    assert.equal(f.get('colorValue').textContent,'#000000');f.get('color').oninput();assert.equal(f.get('colorValue').textContent,'#AABBCC');
    f=await fixture('api');assert.equal(f.get('apiSettings').hidden,false);assert.equal(f.get('apiModel').value,'test-model');
    assert.match(f.get('apiSource').textContent,/本机设置/);assert.equal(f.get('apiKey').value,'');
    f.get('apiKey').value=' fake-key ';f.get('apiModel').value=' new-model ';await f.get('apiSave').onclick();
    const config=f.calls.find(c=>c[0]==='/api/chat/config' && Object.keys(c[1]).length)[1];
    assert.equal(config.api_key,'fake-key');assert.equal(config.model,'new-model');assert.equal(f.get('apiKey').value,'');
    assert.match(f.get('status').textContent,/已保存/);
    f=await fixture('protect');assert.equal(f.get('protect').hidden,false);await f.get('sync').onclick();
    assert.equal(f.synced.length,1);assert.match(f.get('syncResult').textContent,/同步 1 个/);
    f=await fixture('cancel');assert.ok(f.calls.some(c=>c[0]==='/api/chat/cancel'&&c[1].id==='j1'));
    assert.match(f.get('progressText').textContent,/正在停止/);
    f=await fixture('help');assert.match(f.get('capabilities').textContent,/支持直接读取/);
    console.log('Office utility interaction tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
