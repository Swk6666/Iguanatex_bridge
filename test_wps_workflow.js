'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
async function fixture(mode, options={}) {
    const nodes={},requests=[],events={},closed=[];
    const $=id=>nodes[id]||(nodes[id]={value:'',checked:false,hidden:true,textContent:'',src:''});
    let config={configured:true,key_source:'仓库密钥',model:'gpt-6-astra'};
    const sandbox={URLSearchParams,location:{search:mode==='settings'?'?mode=settings':mode==='api'?'?mode=api':mode==='message'?'?mode=message':'?mode=review&id=test-id',hash:'#'+encodeURIComponent('转换完成：成功 1\n第 2 张：失败')},
        document:{getElementById:$},window:{addEventListener(name,fn){events[name]=fn;},close(){closed.push(true);}},
        fetch:async(url,req)=>{
            if(url==='/api/session')return {json:async()=>({token:'token'})};
            const body=JSON.parse(req.body);requests.push({url,body});
            if(url==='/api/wps/settings')return {ok:true,json:async()=>Object.keys(body).length?body:{point_size:18,color:'#000000',align:'left',review:false}};
            if(url==='/api/chat/config'){
                if(body.model && options.failSave)return {ok:false,json:async()=>({error:'保存失败，请稍后重试。'})};
                if(body.api_key)config={...config,configured:true,key_source:'本机设置'};
                if(body.model)config={...config,model:body.model};
                return {ok:true,json:async()=>({...config})};
            }
            if(url==='/api/wps/review-get')return {ok:true,json:async()=>({image:'aW1hZ2U=',preview:'cHJldmlldw=='})};
            if(url==='/api/wps/review-decide')return {ok:true,json:async()=>({ok:true})};
            throw Error('unexpected request '+url);
        }};
    vm.runInNewContext(fs.readFileSync('wps_addin/workflow.js','utf8'),sandbox);
    await new Promise(resolve=>setImmediate(resolve));return {$,requests,events,closed};
}
(async()=>{
    const s=await fixture('settings');assert.equal(s.$('settings').hidden,false);assert.equal(s.$('settingsActions').hidden,false);assert.equal(s.$('reviewActions').hidden,true);
    assert.equal(s.$('size').value,18);assert.equal(s.$('colorValue').textContent,'#000000');assert.equal(s.$('status').textContent,'');
    s.$('size').value=30;s.$('color').value='#cc5522';s.$('align').value='right';s.$('review').checked=true;
    await s.$('save').onclick();const request=s.requests.find(x=>x.url.endsWith('/settings') && x.body.point_size);
    assert.equal(request.body.point_size,30);assert.equal(request.body.align,'right');assert.equal(request.body.review,true);assert.match(s.$('status').textContent,/已保存/);
    assert.equal(s.$('status').className,'');assert.equal(s.$('save').disabled,false);
    const a=await fixture('api');
    assert.equal(a.$('apiSettings').hidden,false);assert.equal(a.$('apiActions').hidden,false);
    assert.equal(a.$('apiModel').value,'gpt-6-astra');assert.match(a.$('apiSource').textContent,/仓库密钥/);
    assert.equal(a.$('apiKey').value,'','saved keys must never be shown in the input');
    a.$('apiKey').value='  local-key  ';a.$('apiModel').value='new-model';await a.$('apiSave').onclick();
    const saved=a.requests.filter(x=>x.url==='/api/chat/config').at(-1).body;
    assert.equal(saved.api_key,'local-key');assert.equal(saved.model,'new-model');
    assert.equal(a.$('apiKey').value,'');assert.match(a.$('apiSource').textContent,/本机设置/);
    assert.match(a.$('status').textContent,/下一次请求生效/);
    await a.$('apiSave').onclick();assert.equal(a.requests.filter(x=>x.url==='/api/chat/config').at(-1).body.api_key,'');
    assert.match(a.$('apiSource').textContent,/本机设置/,'saving an empty key preserves the local key');
    a.$('apiClose').onclick();assert.equal(a.closed.length,1);
    const failed=await fixture('api',{failSave:true});failed.$('apiKey').value='sample-key';
    await failed.$('apiSave').onclick();
    assert.equal(failed.$('apiKey').value,'sample-key','failed saves retain the typed key for correction');
    assert.match(failed.$('status').textContent,/保存失败/);assert.equal(failed.$('status').className,'error');
    assert.equal(failed.$('apiSave').disabled,false);
    for(const [id,choice] of [['accept','accept'],['skip','skip'],['cancel','cancel']]){
        const r=await fixture('review');assert.equal(r.$('reviewPanel').hidden,false);assert.equal(r.$('reviewActions').hidden,false);assert.match(r.$('original').src,/^data:image\/png;base64,/);
        r.$(id).onclick();await new Promise(resolve=>setImmediate(resolve));
        assert.equal(r.requests.find(x=>x.url.endsWith('/review-decide')).body.decision,choice);assert.equal(r.closed.length,1);
    }
    const m=await fixture('message');assert.equal(m.$('message').hidden,false);assert.equal(m.$('messageActions').hidden,false);
    assert.equal(m.$('messageText').textContent,'转换完成：成功 1\n第 2 张：失败');assert.equal(m.requests.length,0);
    m.$('messageClose').onclick();assert.equal(m.closed.length,1);
    console.log('Workflow, API settings and review interface tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
