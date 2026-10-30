'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const layout = require('./wps_addin/adapter.js').layout;
async function fixture(edit=true, source='x', failRender=false, options={}) {
    const nodes={}, renders=[], replacements=[], closed=[], state={failRender};
    const storage = options.storage || new Map();
    const get=id=>nodes[id]||(nodes[id]={value:'',hidden:false,disabled:false,style:{},textContent:'',clientWidth:700,clientHeight:112});
    get('pointSize').value='18';get('engine').value='xelatex';get('output').value='svg';get('sizeMode').value='font';
    const ctx={shape:edit?{Id:1,Type:28,Width:30,Height:18.4,Left:70,Top:90}:null,slide:{SlideIndex:1},sourceData:{tags:{LATEXADDIN:'x'}},
        presentation:{PageSetup:{SlideWidth:960,SlideHeight:540}}};
    const sandbox={URLSearchParams,location:{search:edit?'?mode=edit':'?mode=new'},window:{close(){closed.push(true);},addEventListener(){},
        localStorage:{getItem(k){if(options.noStorage)throw Error('storage disabled');return storage.get(k);},setItem(k,v){if(options.noStorage)throw Error('storage disabled');storage.set(k,v);}}},
        document:{body:{classList:{add(){}}},getElementById:get,querySelectorAll(){return[];},addEventListener(){}},
        fetch:async(url,request)=>({ok:!(state.failRender && url==='/api/wps/render'),json:async()=>{
            if(url.startsWith('/api/session'))return {token:'test'};
            if(url==='/api/wps/metadata')return {found:true,source,engine:'xelatex',tags:{IGUANATEXSIZE:options.tagSize===undefined?'24':options.tagSize}};
            const body=JSON.parse(request.body);
            if(url==='/api/wps/image-target')return {token:'abc',path:'/tmp/test.png'};
            if(url==='/api/wps/image-read')return {data:'image-data'};
            if(url==='/api/wps/image-discard')return {ok:true};
            if(url==='/api/chat/start'){assert.equal(body.data,'image-data');return {id:'job',conversation_id:'conversation'};}
            if(url==='/api/chat/status')return options.recognitionFail ? {status:'failed',message:'识别失败'} : {status:'succeeded'};
            if(url==='/api/chat/history')return {turns:[{id:'job',latex_blocks:['\\documentclass{article}\n\\begin{document}\n$x=1$\n\\end{document}']}]};
            if(url==='/api/latex/source')return {source:body.source.includes('\\documentclass')?body.source:'\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\\[\n'+body.source+'\n\\]\n\\end{document}\n'};
            renders.push(body);
            if(state.failRender)return {error:'LaTeX 编译失败：unknown command'};
            return {png:'test',width:body.point_size*(options.sentence?13.944:2),height:body.point_size*(options.sentence?1.152:1), tags:{IGUANATEXSIZE:String(body.point_size)}};
        }}),
        IguanaWps:{context(){return ctx;},imageContext(){return ctx;},exportImage(c,p){assert.equal(p,'/tmp/test.png');},validate(){},layout,replace(c,d){
            if (options.failWrite) throw Error('写入失败，原公式已保留');
            const box=layout(c,d);replacements.push({mode:c.sizeMode,width:box.width,height:box.height});
            c.shape={Id:2,Width:box.width,Height:box.height,Left:box.left,Top:box.top};
        }}};
    if(options.chat)sandbox.window.IguanaChat={mount(){return {isBusy(){return false;},ask(t){options.chat.push(t);}};},compileReport:info=>info};
    vm.runInNewContext(fs.readFileSync('shared/latex.js','utf8'),sandbox);
    sandbox.IguanaLatex=sandbox.window.IguanaLatex;
    vm.runInNewContext(fs.readFileSync('wps_addin/editor.js','utf8'),sandbox);
    await new Promise(resolve=>setImmediate(resolve));
    return {get,ctx,renders,replacements,storage,closed,state};
}
(async()=>{
    {
        const f=await fixture();assert.equal(f.get('sizeLabel').hidden,false);
        f.get('pointSize').value='36';f.get('pointSize').oninput();
        assert.equal(f.get('sizeMode').value,'font');
        await f.get('applyButton').onclick();
        assert.deepEqual(f.replacements[0],{mode:'font',width:72,height:36});
        assert.equal(f.closed.length,1);
        assert.equal(f.get('sizeLabel').hidden,false);
        await f.get('applyButton').onclick();assert.deepEqual(f.replacements[1],f.replacements[0]);
    }
    {
        const f=await fixture();f.get('pointSize').value='36';f.get('pointSize').oninput();
        f.get('sizeMode').value='frame';f.get('sizeMode').onchange();
        assert.equal(Number(f.get('pointSize').value),24); // Don't stamp a new font size when preserving the frame.
        await f.get('applyButton').onclick();assert.equal(f.replacements[0].mode,'frame');
        assert.equal(f.renders[0].point_size,24);
    }
    {
        const f=await fixture();f.get('pointSize').value='0';f.get('pointSize').oninput();
        await f.get('applyButton').onclick();assert.equal(f.renders.length,0);assert.equal(f.replacements.length,0);
        assert.equal(f.closed.length,0);
        assert.match(f.get('status').textContent,/4–200/);
    }
    {
        const f=await fixture(false);assert.match(f.get('source').value,/\\documentclass/);assert.match(f.get('source').value,/\\usepackage/);f.get('pointSize').value='22.5';f.get('pointSize').oninput();
        await f.get('applyButton').onclick();assert.equal(f.replacements[0].mode,'font');
        assert.equal(f.get('sizeMode').value,'font');assert.equal(f.get('sizeLabel').hidden,false);assert.equal(f.renders[0].source,f.get('source').value);
        assert.equal(f.closed.length,1);
    }
    {
        const source='\\documentclass{article}\n\\usepackage{amsmath,xcolor}\n\\newcommand{\\F}{F}\n\\begin{document}\n$\\F$\n\\end{document}\n';
        const f=await fixture(true,source);
        assert.equal(f.get('source').value,source);
        assert.equal(f.closed.length,0);
        await f.get('previewButton').onclick();
        assert.equal(f.renders[0].source,source);
        assert.equal(f.get('source').value,source);
    }
    {
        const f=await fixture(false,'x',true);
        f.get('source').value='\\unknowncommand';
        await f.get('applyButton').onclick();
        assert.match(f.get('status').textContent,/编译失败/);
        assert.match(f.get('source').value,/\\documentclass/);
        assert.match(f.get('source').value,/\\unknowncommand/);
        assert.equal(f.renders[0].source,f.get('source').value);
        assert.equal(f.replacements.length,0);
        assert.equal(f.closed.length,0);
    }
    {
        const f=await fixture(true,'sentence',false,{sentence:true});
        assert.equal(f.get('sizeMode').value,'font');
        await f.get('previewButton').onclick();
        const image=f.get('formulaImage'), expected=139.44/11.52;
        assert.ok(Math.abs(parseFloat(image.style.width)/parseFloat(image.style.height)-expected)<1e-10);
        await f.get('applyButton').onclick();
        assert.equal(f.replacements[0].height,24*1.152);assert.equal(f.replacements[0].width,24*13.944);
        f.get('sizeMode').value='frame';f.ctx.shape.Width=30;f.ctx.shape.Height=18.4;f.get('sizeMode').onchange();
        await f.get('previewButton').onclick();
        assert.match(f.get('previewSize').textContent,/会拉伸文字/);
        assert.ok(Math.abs(parseFloat(image.style.width)/parseFloat(image.style.height)-30/18.4)<1e-10);
    }
    {
        const f=await fixture(false);assert.equal(Number(f.get('pointSize').value),18);
        f.get('pointSize').value='22.5';f.get('pointSize').oninput();
        const reopened=await fixture(false,'x',false,{storage:f.storage});
        assert.equal(Number(reopened.get('pointSize').value),22.5);
        const edit=await fixture(true,'x',false,{storage:f.storage,tagSize:'32'});
        assert.equal(Number(edit.get('pointSize').value),32); // Original metadata takes priority, without replacing the preference.
        assert.equal(Number((await fixture(false,'x',false,{storage:f.storage})).get('pointSize').value),22.5);
        const legacy=await fixture(true,'x',false,{storage:f.storage,tagSize:''});
        assert.equal(Number(legacy.get('pointSize').value),22.5);
    }
    {
        for(const value of ['bad','0','201','Infinity']) {
            const storage=new Map([['iguanatex-bridge.pointSize',value]]);
            const f=await fixture(false,'x',false,{storage});assert.equal(Number(f.get('pointSize').value),18);
            f.get('pointSize').value=value;f.get('pointSize').oninput();
            assert.equal(storage.get('iguanatex-bridge.pointSize'),value);
        }
        const f=await fixture(false,'x',false,{noStorage:true});assert.equal(Number(f.get('pointSize').value),18);
        f.get('pointSize').value='20';f.get('pointSize').oninput();await f.get('previewButton').onclick();
        assert.equal(f.renders[0].point_size,20);
    }
    {
        const f=await fixture(true,'x',false,{failWrite:true});
        await f.get('applyButton').onclick();
        assert.match(f.get('status').textContent,/写入失败/);assert.equal(f.closed.length,0);
    }
    {
        const f=await fixture();
        for(const [id,event,value] of [['source','oninput','x=2'],['engine','onchange','lualatex'],
                ['output','onchange','png'],['pointSize','oninput','20']]) {
            await f.get('previewButton').onclick();
            assert.equal(f.get('formulaImage').hidden,false);
            f.get(id).value=value;f.get(id)[event]();
            assert.equal(f.get('formulaImage').hidden,true,id);
            assert.equal(f.get('formulaImage').src,'');
            assert.equal(f.get('previewSize').hidden,true);
            assert.match(f.get('previewHint').textContent,/重新预览/);
        }
        await f.get('previewButton').onclick();
        const count=f.renders.length;await f.get('previewButton').onclick();
        assert.equal(f.renders.length,count); // Unchanged valid result remains cacheable.
        f.get('source').value+='broken';f.state.failRender=true;
        await f.get('applyButton').onclick(); // Also clears stale preview if no input event fired.
        assert.equal(f.get('formulaImage').hidden,true);assert.equal(f.get('formulaImage').src,'');
        assert.equal(f.get('previewSize').hidden,true);assert.equal(f.get('previewHint').hidden,false);
        assert.match(f.get('previewHint').textContent,/编译未完成/);
        assert.equal(f.replacements.length,0);assert.equal(f.closed.length,0);
        f.state.failRender=false;await f.get('previewButton').onclick();
        assert.equal(f.get('formulaImage').hidden,false);assert.equal(f.get('errorDetails').hidden,true);
    }
    {
        const asked=[];const f=await fixture(true,'x',true,{chat:asked});
        await f.get('previewButton').onclick();
        assert.equal(f.get('aiFix').hidden,false,'a LaTeX failure offers to ask the AI');
        await f.get('aiFix').onclick();
        assert.match(asked[0].message,/unknown command/);assert.equal(asked[0].engine,'xelatex');assert.match(asked[0].source,/documentclass/);
        f.get('source').oninput();assert.equal(f.get('aiFix').hidden,true,'editing invalidates the captured log');
        f.get('pointSize').value='0';await f.get('previewButton').onclick();
        assert.equal(f.get('aiFix').hidden,true,'local validation errors are not compiler logs');
        f.get('pointSize').value='18';f.state.failRender=false;await f.get('previewButton').onclick();
        assert.equal(f.get('aiFix').hidden,true);
    }
    {
        // 100% preview by default: a formula taller than the canvas must not be shrunk to match other sizes.
        const storage=new Map();const f=await fixture(false,'x',false,{storage});
        const shown=async size=>{f.get('pointSize').value=String(size);f.get('pointSize').oninput();await f.get('previewButton').onclick();return parseFloat(f.get('formulaImage').style.height);};
        const h12=await shown(120),h14=await shown(140);
        assert.ok(Math.abs(h14/h12-140/120)<1e-9,'different sizes must preview at different heights');
        assert.ok(Math.abs(h14-140*96/72)<1e-9);
        f.get('previewZoom').onclick();assert.equal(storage.get('iguanatex-bridge.previewFit'),'1');
        assert.ok(parseFloat(f.get('formulaImage').style.height)<=112-24+1e-9);assert.match(f.get('previewSize').textContent,/缩小至 \d+%/);
        f.get('previewZoom').onclick();assert.ok(Math.abs(parseFloat(f.get('formulaImage').style.height)-h14)<1e-9);
    }
    console.log('13 WPS editor interaction tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
