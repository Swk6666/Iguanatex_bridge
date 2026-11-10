'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');

function fixture({review=false, hold=false}={}) {
    let release;
    const gate = hold ? new Promise(resolve => { release=resolve; }) : Promise.resolve();
    const state={batch:null, writes:[], reviews:0, calls:[]};
    const target=id=>({presentationId:'deck',slideId:'s1',original:{id,alt:''},structure:id,imageDigest:id});
    const items=[{target:target('p1')},{target:target('p2')}];
    const sandbox={URLSearchParams, console, setTimeout:(fn)=>setImmediate(fn),
        setInterval:()=>1,clearInterval:()=>{},
        document:{getElementById:()=>null},
        window:{addEventListener(type,handler){if(type==='pagehide')state.pagehide=handler;}},
        IguanaOffice:{async capturePictures(){return items;},async readPicture(t){return 'image-'+t.original.id;},
            async applyBatch(t){state.writes.push(t.original.id);}},
        async fetch(url,options){
            if(url==='/api/session')return {ok:true,json:async()=>({token:'test'})};
            const req=JSON.parse(options.body); state.calls.push([url,req]);
            let value;
            if(url==='/api/office/batch/status')value=state.batch||{status:'idle'};
            else if(url==='/api/wps/settings')value={point_size:18,color:'#000000',align:'left',review};
            else if(url==='/api/office/batch/start')value=state.batch={id:'batch',status:'running',total:req.total,succeeded:0,failed:0,skipped:0,stage:'准备中',errors:[]};
            else if(url==='/api/office/batch/update'){Object.assign(state.batch,req);value=state.batch;}
            else if(url==='/api/office/batch/finish'){Object.assign(state.batch,req,{status:state.batch.cancel_requested?'cancelled':'completed'});value=state.batch;}
            else if(url==='/api/office/batch/abort'){Object.assign(state.batch,{status:'interrupted'});value=state.batch;}
            else if(url==='/api/chat/start')value={id:'job',conversation_id:'conversation'};
            else if(url==='/api/chat/status'){await gate;value={status:'succeeded'};}
            else if(url==='/api/chat/history')value={revision:1,turns:[{id:'job',latex_blocks:['source']}]};
            else if(url==='/api/render')value={render_id:'render',png:'preview',svg:'svg'};
            else if(url==='/api/wps/review-create')value={id:'review-'+(++state.reviews)};
            else if(url==='/api/wps/review-status')value={decision:req.id==='review-1'?'skip':'accept'};
            else if(url==='/api/wps/review-discard'||url==='/api/wps/draft-delete'||url==='/api/chat/cancel')value={};
            else throw Error('Unexpected request '+url);
            return {ok:true,json:async()=>JSON.parse(JSON.stringify(value))};
        }};
    vm.runInNewContext(fs.readFileSync('office_addin/batch.js','utf8'),sandbox);
    const worker=sandbox.window.IguanaBatchWorker.create({background:true,onReview(){state.notices=(state.notices||0)+1;}});
    return {state,worker,release};
}
async function untilDone(state) {
    for(let i=0;i<200 && (!state.batch || state.batch.status==='running');i++) await new Promise(resolve=>setImmediate(resolve));
    assert.notEqual(state.batch.status,'running','worker should finish');
}
(async()=>{
    let f=fixture({hold:true});
    const started=await f.worker.start();
    assert.equal(started.total,2); assert.equal(f.state.batch.status,'running'); assert.equal(f.state.writes.length,0);
    await assert.rejects(f.worker.start(),/已有批量转换/);
    // No pane or dialog elements exist in this shared-runtime fixture.
    f.release(); await untilDone(f.state);
    assert.equal(f.state.batch.status,'completed'); assert.deepEqual(f.state.writes,['p1','p2']);
    assert.equal(f.state.batch.succeeded,2);

    f=fixture({hold:true}); await f.worker.start();
    f.state.batch.cancel_requested=true; f.release(); await untilDone(f.state);
    assert.equal(f.state.batch.status,'cancelled'); assert.deepEqual(f.state.writes,[]);

    f=fixture({review:true}); await f.worker.start(); await untilDone(f.state);
    assert.equal(f.state.notices,2); assert.equal(f.state.batch.skipped,1);
    assert.equal(f.state.batch.succeeded,1); assert.deepEqual(f.state.writes,['p2']);
    console.log('Office background batch worker tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
