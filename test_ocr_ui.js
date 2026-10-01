'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function fixture(changeSource=false, finalStatus='succeeded') {
    const nodes={}, calls=[], events={};
    function element(key) {
        if(!nodes[key])nodes[key]={value:'',hidden:false,disabled:false,textContent:'',classList:{add(){}},
            querySelector(selector){return element(key+' '+selector);},dispatchEvent(e){events[e.type]=(events[e.type]||0)+1;}};
        return nodes[key];
    }
    const source=element('source');source.value='original';const container=element('panel');
    const sandbox={document:{addEventListener(type,fn){events[type]=fn;}},Event:class{constructor(type){this.type=type;}},
        URL:{createObjectURL(){return 'blob:local';},revokeObjectURL(){}},
        FileReader:class{readAsDataURL(){this.result='data:image/png;base64,abc';this.onload();}},
        setTimeout(fn){fn();}};
    vm.runInNewContext(fs.readFileSync('shared/ocr.js','utf8'),sandbox);
    let canStart=true;
    const controller=sandbox.IguanaOcr.mount(container,{source,canStart:()=>canStart,api:async(path,data)=>{
        calls.push([path,data]);
        if(path==='ocr/status') {
            if(changeSource)source.value='user edit';
            return {id:'job',status:finalStatus,message:finalStatus,source:finalStatus==='succeeded'?'A=b':undefined};
        }
        return {id:'job',status:'queued',message:'waiting'};
    }});
    const click=action=>element('panel [data-action='+action+']').onclick();
    const choose=(file={name:'formula.png',type:'image/png',size:50})=>{
        element('panel input').files=[file];element('panel input').onchange();
    };
    return {controller,source,nodes,calls,events,click,choose,element,setCanStart(v){canStart=v;}};
}
let count=0;
async function test(fn){await fn();count++;}
(async()=>{
    await test(async()=>{
        const f=fixture();f.choose();assert.equal(f.calls.length,0,'selection must not upload');
        await f.click('start');assert.equal(f.source.value,'A=b');assert.equal(f.events.input,1);
        assert.equal(f.calls[0][0],'ocr/start');assert.equal(f.calls[0][1].data,'abc');assert.equal(f.controller.isBusy(),false);
    });
    await test(async()=>{
        const f=fixture(true);f.choose();await f.click('start');assert.equal(f.source.value,'user edit');
        assert.equal(f.element('panel .ocr-result').hidden,false);
        assert.equal(f.element('panel .ocr-result textarea').value,'A=b');
        await f.click('use');assert.equal(f.source.value,'A=b');
    });
    await test(async()=>{
        const f=fixture();await f.click('start');assert.equal(f.calls.length,0);
        f.choose({type:'image/png',size:11*1024*1024});await f.click('start');assert.equal(f.calls.length,0);
        f.choose({type:'image/svg+xml',size:50});await f.click('start');assert.equal(f.calls.length,0);
    });
    await test(async()=>{
        const f=fixture(false,'failed');f.choose();await f.click('start');assert.equal(f.source.value,'original');
        assert.equal(f.element('panel .ocr-status').textContent,'failed');
    });
    await test(async()=>{
        const f=fixture(false,'cancelled');f.choose();await f.click('start');assert.equal(f.source.value,'original');
    });
    await test(async()=>{
        const f=fixture();f.choose();f.setCanStart(false);await f.click('start');assert.equal(f.calls.length,0);
    });
    await test(async()=>{
        const f=fixture();let prevented=false;
        f.events.paste({clipboardData:{files:[{type:'image/png',size:40,name:'pasted.png'}]},preventDefault(){prevented=true;}});
        assert(prevented);await f.click('start');assert.equal(f.source.value,'A=b');
    });
    console.log(count+' OCR UI interaction tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
