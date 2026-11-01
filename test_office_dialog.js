'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('office_addin/dialog-bridge.js', 'utf8');

async function fixture() {
    const parentEvents = {}, childEvents = {}, requests = [], closed = [], http = [], messages = [];
    const origin = 'https://localhost:17864';
    const officeBase = {AsyncResultStatus:{Succeeded:'succeeded',Failed:'failed'},
        EventType:{DialogMessageReceived:'message',DialogEventReceived:'event',DialogParentMessageReceived:'parent'}};
    const dialog = {
        addEventHandler(type, fn){parentEvents[type]=fn;},
        messageChild(message){messages.push(message);if(childEvents.parent)childEvents.parent({message,origin});},
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
        async capturePictures(){requests.push(['capturePictures']);return [{target:{id:'picture'}}];},
        async readPicture(target){requests.push(['readPicture',target]);return {id:'temporary-image'};},
        async applyBatch(target,renderId){requests.push(['applyBatch',target,renderId]);return {ok:true};},
        async scanFormulas(){requests.push(['scanFormulas']);return {items:[{id:'formula'}]};},
        async syncFormula(item,metadata){requests.push(['syncFormula',item,metadata]);return {ok:true};},
        closed(state){closed.push(state);}
    });
    const childOffice = {...officeBase,context:{ui:{
        addHandlerAsync(type,handler,callback){childEvents[type]=handler;callback({status:'succeeded'});},
        messageParent(message){parentEvents.message({message,origin});}
    }},onReady(fn){fn();}};
    const child = {location:{search:'?dialog=1&mode=edit',origin},Office:childOffice,setTimeout,clearTimeout};
    const document={body:{classList:{add(name){assert.equal(name,'office-dialog');}}},getElementById(){return {hidden:true};}};
    async function fetch(url,options){http.push([url,options]);return {ok:true,async json(){
        if(url==='/api/session')return {token:'test-token'};
        if(url==='/api/wps/review-get')return {image:'large-image'};
        return {ok:true};
    }};}
    vm.runInNewContext(source,{window:child,document,URLSearchParams,Promise,Number,JSON,Error,fetch});
    return {parent,child,requests,closed,snapshot,parentEvents,http,messages};
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
    assert.equal(f.parent.IguanaDialogHost.isOpen(),true);
    await assert.rejects(f.parent.IguanaDialogHost.open({mode:'new'},{}),/先关闭/);
    assert.equal((await f.child.IguanaOffice.capturePictures())[0].target.id,'picture');
    assert.equal(await f.child.IguanaOffice.readPicture({id:'picture'}),'large-image');
    assert.equal((await f.child.IguanaOffice.applyBatch({id:'picture'},{render_id:'cached',svg:'large-image'})).ok,true);
    assert.equal((await f.child.IguanaOffice.scanFormulas()).items[0].id,'formula');
    await f.child.IguanaOffice.syncFormula({id:'formula'},{source:'x'});
    assert.deepEqual(f.http.map(x=>x[0]),['/api/session','/api/wps/review-get','/api/session','/api/wps/review-discard']);
    assert.equal(f.messages.some(message=>message.includes('large-image')),false);
    assert.equal(f.requests.find(x=>x[0]==='applyBatch')[2],'cached');
    f.parentEvents.message({origin:'https://other.example',message:JSON.stringify({type:'call',id:99,operation:'capture',edit:true})});
    f.parentEvents.message({origin:'https://localhost:17864',message:JSON.stringify({type:'call',id:99,operation:'constructor'})});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(f.requests.length,8);
    f.child.IguanaDialogClient.close({source:'finished'});
    assert.equal(f.closed.length,1);assert.equal(f.closed[0].source,'finished');
    assert.equal(f.parent.IguanaDialogHost.isOpen(),false);
    const unavailable={location:{search:'',origin:'https://localhost:17864'},Office:{...f.parent.Office,
        context:{...f.parent.Office.context,requirements:{isSetSupported(){return false;}}}}};
    vm.runInNewContext(source,{window:unavailable,URLSearchParams,Promise,Number,JSON,Error});
    await assert.rejects(unavailable.IguanaDialogHost.open({mode:'new'},{}),/不支持完整编辑窗口/);
    console.log('Office dialog bridge tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
