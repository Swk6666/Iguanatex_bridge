'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('office_addin/dialog-bridge.js', 'utf8');

async function fixture() {
    const parentEvents = {}, childEvents = {}, requests = [], closed = [];
    const origin = 'https://localhost:17864';
    const officeBase = {AsyncResultStatus:{Succeeded:'succeeded',Failed:'failed'},
        EventType:{DialogMessageReceived:'message',DialogEventReceived:'event',DialogParentMessageReceived:'parent'}};
    const dialog = {
        addEventHandler(type, fn){parentEvents[type]=fn;},
        messageChild(message){if(childEvents.parent)childEvents.parent({message,origin});},
        close(){if(parentEvents.event)parentEvents.event({error:12006});}
    };
    const parentOffice = {...officeBase,context:{requirements:{isSetSupported(){return true;}},ui:{
        displayDialogAsync(url, options, callback){assert.match(url,/dialog=1/);assert.equal(options.width,75);
            callback({status:'succeeded',value:dialog});}
    }}};
    const parent = {location:{search:'?mode=edit',origin},Office:parentOffice};
    vm.runInNewContext(source,{window:parent,URLSearchParams,Promise,Number,JSON,Error});
    const snapshot={mode:'edit',source:'x+y',target:{original:{id:'old'}}};
    await parent.IguanaDialogHost.open(snapshot,{
        async capture(edit){requests.push(['capture',edit]);return {original:{id:'captured'}};},
        async apply(target,renderId,sizeMode){requests.push(['apply',target,renderId,sizeMode]);
            if(renderId==='bad')throw Error('预览已过期');return {original:{id:'written'}};},
        closed(state){closed.push(state);}
    });
    const childOffice = {...officeBase,context:{ui:{
        addHandlerAsync(type,handler,callback){childEvents[type]=handler;callback({status:'succeeded'});},
        messageParent(message){parentEvents.message({message,origin});}
    }},onReady(fn){fn();}};
    const child = {location:{search:'?dialog=1&mode=edit',origin},Office:childOffice,setTimeout,clearTimeout};
    const document={body:{classList:{add(name){assert.equal(name,'office-dialog');}}},getElementById(){return {hidden:true};}};
    vm.runInNewContext(source,{window:child,document,URLSearchParams,Promise,Number,JSON,Error});
    return {parent,child,requests,closed,snapshot,parentEvents};
}
(async()=>{
    const f=await fixture();
    assert.equal((await f.child.IguanaDialogClient.ready).source,'x+y');
    const target=await f.child.IguanaOffice.capture(true);
    assert.equal(target.original.id,'captured');
    const result=await f.child.IguanaOffice.apply(target,{render_id:'abc',png:'large-image'},'height');
    assert.equal(result.original.id,'written');
    assert.deepEqual(f.requests.map(x=>x[0]),['capture','apply']);
    assert.equal(f.requests[1][2],'abc');assert.equal(f.requests[1][3],'height');
    await assert.rejects(f.child.IguanaOffice.apply(target,{render_id:'bad'},'font'),/预览已过期/);
    f.parentEvents.message({origin:'https://other.example',message:JSON.stringify({type:'call',id:99,operation:'capture',edit:true})});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(f.requests.length,3);
    f.child.IguanaDialogClient.close({source:'finished'});
    assert.equal(f.closed.length,1);assert.equal(f.closed[0].source,'finished');
    const unavailable={location:{search:'',origin:'https://localhost:17864'},Office:{...f.parent.Office,
        context:{...f.parent.Office.context,requirements:{isSetSupported(){return false;}}}}};
    vm.runInNewContext(source,{window:unavailable,URLSearchParams,Promise,Number,JSON,Error});
    await assert.rejects(unavailable.IguanaDialogHost.open({mode:'new'},{}),/不支持完整编辑窗口/);
    console.log('Office dialog bridge tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
