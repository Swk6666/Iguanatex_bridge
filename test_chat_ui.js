'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const answer = '完整说明 <img src=x onerror=alert(1)>\n```latex\nx=y\n```\n尾部解释';
async function fixture(options={}) {
    const nodes={}, created=[], calls=[], storage=options.storage||new Map(), copied=[];
    function element(key='') {
        if (key && nodes[key]) return nodes[key];
        const el={value:'',textContent:'',hidden:false,disabled:false,children:[],events:{},classList:{add(){}},
            scrollTop:0,clientHeight:200,scrollHeight:200,
            querySelector(s){return element(key+' '+s);},querySelectorAll(){return [];},
            appendChild(e){this.children.push(e);return e;},replaceChildren(...e){this.children=e;},
            addEventListener(t,fn){this.events[t]=fn;},dispatchEvent(e){this.dispatched=e.type;},removeAttribute(){},
            focus(){},select(){},remove(){}};
        if(key)nodes[key]=el;else created.push(el);
        return el;
    }
    const container=element('panel'),source=element('source');source.value='original';
    let config={configured:options.configured!==false,model:'deepseek-flash',key_source:'本机设置'};
    let data=options.history||{conversation_id:null,revision:0,turns:[],active_job:null};
    let cancelled=false, canStart=true;
    const sandbox={document:{createElement(){return element();},execCommand(){return true;}},
        Event:class{constructor(type){this.type=type;}},URL:{createObjectURL(){return 'blob:local';},revokeObjectURL(){}},
        navigator:{clipboard:{async writeText(text){copied.push(text);}}},
        localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
        FileReader:class{readAsDataURL(){this.result='data:image/png;base64,abc';this.onload();}},setTimeout(fn){fn();}};
    vm.runInNewContext(fs.readFileSync('shared/chat.js','utf8'),sandbox);
    const controller=sandbox.IguanaChat.mount(container,{source,canStart:()=>canStart,prepareSource:options.prepareSource,
        api:async(path,req)=>{
            calls.push([path,req]);
            if(path==='chat/config') {if(req.api_key)config.configured=true;if(req.clear_key)config.configured=false;return {...config};}
            if(path==='chat/history')return JSON.parse(JSON.stringify(data));
            if(path==='chat/start'){
                const id='job'+(data.turns.length+1);
                data={conversation_id:'conversation',revision:data.revision+1,active_job:id,turns:data.turns.concat({id,
                    message:req.message||'识别图片',has_image:!!req.data,model:'deepseek-flash',answer:'',status:'answering'})};
                return {id,conversation_id:'conversation'};
            }
            if(path==='chat/cancel'){cancelled=true;return {};}
            if(path==='chat/status'){
                if(options.onStatus) await options.onStatus({source,container,element});
                const status=cancelled?'cancelled':options.finalStatus||'succeeded';
                data.turns[data.turns.length-1]={...data.turns.at(-1),answer,status,latex_blocks:['x=y'],error:status==='succeeded'?'':'回答未完成'};
                data.active_job=null;
                return {id:req.id,conversation_id:'conversation',status,message:status};
            }
            throw Error(path);
        }});
    await controller.ready;
    return {controller,calls,source,created,storage,copied,container,element,
        click:a=>element('panel [data-action="'+a+'"]').onclick(),
        prompt:text=>{element('panel .chat-prompt').value=text;},
        choose(file={type:'image/png',size:50,name:'test.png'}){const el=element('panel input[type=file]');el.files=[file];el.onchange();},
        setCanStart(v){canStart=v;}};
}
let count=0;
async function test(fn){await fn();count++;}
const button=(f,label)=>f.created.find(e=>e.textContent===label&&typeof e.onclick==='function');
(async()=>{
    await test(async()=>{
        const f=await fixture();f.choose();f.prompt('解释这张图');
        assert.equal(f.calls.filter(c=>c[0]==='chat/start').length,0);
        await f.click('send');const req=f.calls.find(c=>c[0]==='chat/start')[1];
        assert.equal(req.message,'解释这张图');assert.equal(req.data,'abc');
        assert.equal(f.source.value,'original','answer must not overwrite source');
        assert(f.created.some(e=>e.className==='chat-answer'&&e.textContent===answer));
        await button(f,'复制完整回答').onclick();assert.equal(f.copied[0],answer);
        await button(f,'采用 LaTeX').onclick();assert.equal(f.source.value,'x=y');
        assert.equal(f.source.dispatched,'input');assert.equal(f.controller.isBusy(),false);
        f.prompt('再解释一下');await f.click('send');
        const second=f.calls.filter(c=>c[0]==='chat/start')[1][1];
        assert.equal(second.conversation_id,'conversation');assert.equal(second.revision,1);assert.equal(second.data,null);
    });
    await test(async()=>{
        const f=await fixture({prepareSource:async(source,current)=>{assert.equal(current,'original');return 'complete '+source;}});
        f.prompt('纯文字');await f.click('send');await button(f,'采用 LaTeX').onclick();assert.equal(f.source.value,'complete x=y');
    });
    await test(async()=>{
        const f=await fixture({prepareSource:async()=>{await Promise.resolve();f.source.value='new edit';return 'stale';}});
        f.choose();await f.click('send');await button(f,'采用 LaTeX').onclick();
        assert.equal(f.source.value,'new edit');assert.match(f.element('panel .chat-status').textContent,/已变化/);
    });
    await test(async()=>{
        const f=await fixture({configured:false});f.prompt('问题');await f.click('send');
        assert.equal(f.calls.filter(c=>c[0]==='chat/start').length,0);
        f.element('panel .chat-key').value='secret';f.element('panel .chat-model').value='deepseek-flash';await f.click('save');
        assert.equal(f.element('panel .chat-key').value,'');assert(!JSON.stringify([...f.storage]).includes('secret'));
        await f.click('send');assert.equal(f.calls.filter(c=>c[0]==='chat/start').length,1);
    });
    await test(async()=>{
        const f=await fixture();await f.click('send');
        f.choose({type:'image/svg+xml',size:10});await f.click('send');
        f.choose({type:'image/png',size:11*1024*1024});await f.click('send');
        assert.equal(f.calls.filter(c=>c[0]==='chat/start').length,0);
        f.prompt('hello');f.setCanStart(false);await f.click('send');assert.equal(f.calls.filter(c=>c[0]==='chat/start').length,0);
    });
    await test(async()=>{
        const f=await fixture({finalStatus:'failed'});f.prompt('保留草稿');f.choose();await f.click('send');
        assert.equal(f.element('panel .chat-prompt').value,'保留草稿');assert.equal(f.element('panel img').hidden,false);
        assert.equal(f.source.value,'original');assert.equal(button(f,'采用 LaTeX'),undefined);
        assert(button(f,'复制完整回答'));
    });
    await test(async()=>{
        const f=await fixture({onStatus:async({element})=>{await element('panel [data-action="cancel"]').onclick();}});
        f.prompt('cancel');await f.click('send');
        assert(f.calls.some(c=>c[0]==='chat/cancel'));assert.equal(button(f,'采用 LaTeX'),undefined);
        assert.equal(f.source.value,'original');
    });
    await test(async()=>{
        const f=await fixture();f.prompt('问题');await f.click('send');await f.click('new');
        f.prompt('新问题');await f.click('send');assert.equal(f.calls.filter(c=>c[0]==='chat/start')[1][1].conversation_id,null);
    });
    await test(async()=>{
        const f=await fixture({storage:new Map([['iguanatex-bridge.deepseekConversation','conversation']]),
            history:{conversation_id:'conversation',revision:1,active_job:'running',turns:[{id:'running',status:'answering',answer:'',message:'old',model:'deepseek-flash'}]}});
        assert(f.calls.some(c=>c[0]==='chat/status'));assert.equal(f.controller.isBusy(),false);assert(button(f,'采用 LaTeX'));
    });
    await test(async()=>{
        const f=await fixture();let prevented=false,stopped=false;
        f.container.events.paste({clipboardData:{files:[{type:'image/png',size:40}]},preventDefault(){prevented=true;}});
        assert(prevented);assert.equal(f.calls.filter(c=>c[0]==='chat/start').length,0);
        f.container.events.keydown({ctrlKey:true,key:'Enter',target:f.element('panel .chat-key'),preventDefault(){},stopPropagation(){stopped=true;}});
        assert(stopped);assert.equal(f.calls.filter(c=>c[0]==='chat/start').length,0);
    });
    await test(async()=>{
        const f=await fixture({onStatus:async({element})=>{element('panel .chat-prompt').value='等待时输入的草稿';}});
        f.prompt('第一个问题');await f.click('send');
        assert.equal(f.element('panel .chat-prompt').value,'等待时输入的草稿','a draft typed while waiting must survive');
    });
    await test(async()=>{
        const f=await fixture();f.prompt('不应发送');
        f.container.events.keydown({ctrlKey:true,key:'Enter',isComposing:true,target:f.element('panel .chat-prompt'),preventDefault(){},stopPropagation(){}});
        assert.equal(f.calls.filter(c=>c[0]==='chat/start').length,0,'Ctrl+Enter during IME composition must not send');
        f.setCanStart(false);await f.click('send');
        assert.match(f.element('panel .chat-status').textContent,/稍后再发送/);
        f.setCanStart(true);await f.controller.ask('修复这个错误');
        assert.equal(f.calls.find(c=>c[0]==='chat/start')[1].message,'修复这个错误');
    });
    await test(async()=>{
        const sb={};vm.runInNewContext(fs.readFileSync('shared/chat.js','utf8'),sb);const report=sb.IguanaChat.compileReport;
        const log='LaTeX 编译失败：\n'+Array.from({length:200},(_,i)=>'(noise line '+i+')').join('\n')+
            '\n! Undefined control sequence.\nl.12 \\fracc\n'+Array.from({length:200},(_,i)=>'tail '+i).join('\n');
        const text=report({source:'\\documentclass{article}\n'+'x'.repeat(20000),engine:'xelatex',message:log});
        assert.match(text,/XeLaTeX/);assert.match(text,/! Undefined control sequence\./);assert.match(text,/l\.12/);
        assert.doesNotMatch(text,/noise line 10\)/);assert.match(text,/documentclass/);
        assert(text.length<=8000,'report must fit the 8000-character chat limit, got '+text.length);
        assert.match(report({source:'x',engine:'pdflatex',message:'LaTeX 编译超过 50 秒；请检查源码。'}),/50 秒/);
    });
    console.log(count+' DeepSeek chat UI tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
