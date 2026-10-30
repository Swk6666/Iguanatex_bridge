'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
async function fixture(mode) {
    const nodes={},requests=[],events={},closed=[];
    const $=id=>nodes[id]||(nodes[id]={value:'',checked:false,hidden:true,textContent:'',src:''});
    const sandbox={URLSearchParams,location:{search:mode==='settings'?'?mode=settings':'?mode=review&id=test-id'},
        document:{getElementById:$},window:{addEventListener(name,fn){events[name]=fn;},close(){closed.push(true);}},
        fetch:async(url,req)=>{
            if(url==='/api/session')return {json:async()=>({token:'token'})};
            const body=JSON.parse(req.body);requests.push({url,body});
            if(url==='/api/wps/settings')return {ok:true,json:async()=>Object.keys(body).length?body:{point_size:18,color:'#000000',align:'left',review:false}};
            if(url==='/api/wps/review-get')return {ok:true,json:async()=>({image:'aW1hZ2U=',preview:'cHJldmlldw=='})};
            if(url==='/api/wps/review-decide')return {ok:true,json:async()=>({ok:true})};
            throw Error('unexpected request '+url);
        }};
    vm.runInNewContext(fs.readFileSync('wps_addin/workflow.js','utf8'),sandbox);
    await new Promise(resolve=>setImmediate(resolve));return {$,requests,events,closed};
}
(async()=>{
    const s=await fixture('settings');assert.equal(s.$('settings').hidden,false);assert.equal(s.$('size').value,18);
    s.$('size').value=30;s.$('color').value='#cc5522';s.$('align').value='right';s.$('review').checked=true;
    await s.$('save').onclick();const request=s.requests.find(x=>x.url.endsWith('/settings') && x.body.point_size);
    assert.equal(request.body.point_size,30);assert.equal(request.body.align,'right');assert.equal(request.body.review,true);assert.match(s.$('status').textContent,/已保存/);
    for(const [id,choice] of [['accept','accept'],['skip','skip'],['cancel','cancel']]){
        const r=await fixture('review');assert.equal(r.$('reviewPanel').hidden,false);assert.match(r.$('original').src,/^data:image\/png;base64,/);
        r.$(id).onclick();await new Promise(resolve=>setImmediate(resolve));
        assert.equal(r.requests.find(x=>x.url.endsWith('/review-decide')).body.decision,choice);assert.equal(r.closed.length,1);
    }
    console.log('Workflow settings and review interface tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
