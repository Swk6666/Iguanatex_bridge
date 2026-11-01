'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function fixture(mode='edit', options={}) {
    const nodes={}, calls=[], writes=[], listeners={}, storage=new Map();
    const get=id=>nodes[id]||(nodes[id]={value:'',hidden:false,disabled:false,textContent:'',style:{},clientWidth:700,clientHeight:180,
        dispatchEvent(e){if(e.type==='input' && this.oninput)this.oninput(e);},
        setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);},focus(){}});
    Object.assign(get('source'),{value:'E=mc^{2}'});
    get('engine').value='xelatex';get('output').value='svg';get('pointSize').value='18';get('sizeMode').value='font';get('lineWidth').value='1';
    const templates=['sum','matrix','aligned','chinese'].map(name=>({dataset:{template:name}}));
    const state={captureError:null,found:true,type:'Group',source:'Native \\frac{x}{Y}',size:'28',engine:'xelatex'};
    const sandbox={URLSearchParams,location:{search:'?mode='+mode},
        document:{getElementById:get,querySelectorAll(selector){return selector==='[data-template]'?templates:Object.values(nodes);},
            addEventListener(type,fn){listeners[type]=fn;}},
        Event:class{constructor(type){this.type=type;}},
        IguanaChat:{mount(){return {isBusy(){return false;},async attachPng(image){state.attached=image;}};}},
        IguanaOffice:{async capture(edit){calls.push(['capture',edit]);if(state.captureError)throw Error(state.captureError);
            return {original:edit?{id:'original',type:state.type,tags:{},width:48,height:24,left:1,top:2}:null,
                sourceTags:{LATEXADDIN:state.source,IGUANATEXSIZE:state.size,LATEXENGINEID:'2'}};},
            async capturePicture(){calls.push(['picture']);return {target:{presentationId:'deck',slideId:'s1',original:{id:'pic',type:'Image',tags:{},width:48,height:24,left:1,top:2},structure:'structure',imageDigest:'hash'},image:'pngdata'};},
            async apply(target,data,mode){if(state.applyError){const error=state.applyError;state.applyError=null;throw Error(error);}
                writes.push({target,data,mode});return {original:{id:'new',width:data.width,height:data.height}};},
            layout:require('./office_addin/adapter.js').layout},
        fetch:async(url,options)=>({ok:!(state.failRender && url==='/api/render'),json:async()=>{
            if(url==='/api/session')return {token:'test'};
            const body=JSON.parse(options.body);calls.push([url,body]);
            if(url==='/api/latex/source')return {source:body.source.includes('\\documentclass')?body.source:'\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n\\[\n'+body.source+'\n\\]\n\\end{document}\n'};
            if(url==='/api/metadata')return {found:state.found,source:body.tags.LATEXADDIN,engine:state.engine,
                tags:{IGUANATEXSIZE:body.tags.IGUANATEXSIZE,OUTPUTTYPE:state.type==='Group'?'SVG':'PDF'}};
            if(url==='/api/wps/settings')return {point_size:24,color:'#112233',align:'center',review:false};
            if(url==='/api/wps/review-create')return {id:'image-id'};
            if(url==='/api/wps/review-get')return {image:'pngdata'};
            if(url==='/api/wps/review-discard'||url==='/api/wps/draft-save'||url==='/api/wps/draft-delete')return {};
            if(url==='/api/wps/draft-get')return state.draft || {found:false};
            if(state.failRender)return {error:'LaTeX 字体缺字'};
            return {png:'preview',width:body.point_size*2,height:body.point_size,tags:{IGUANATEXSIZE:String(body.point_size)}};
        }}),
        Office:{HostType:{PowerPoint:'PowerPoint'},context:{requirements:{isSetSupported(){return !options.unsupported;}}},
            onReady(fn){fn({host:'PowerPoint'});}}};
    sandbox.window={Office:sandbox.Office,addEventListener(){},localStorage:{getItem(k){return storage.get(k)||null;},setItem(k,v){storage.set(k,v);}}};
    if(options.host) sandbox.window.IguanaDialogHost={async open(snapshot){state.opened=snapshot;}};
    if(options.dialog) sandbox.window.IguanaDialogClient={ready:Promise.resolve(options.dialog),close(snapshot){state.closed=snapshot;}};
    vm.runInNewContext(fs.readFileSync('shared/latex.js','utf8'),sandbox);
    sandbox.IguanaLatex=sandbox.window.IguanaLatex;
    vm.runInNewContext(fs.readFileSync('office_addin/taskpane.js','utf8'),sandbox);
    await new Promise(resolve=>setImmediate(resolve));
    return {get,state,calls,writes,listeners,storage,templates};
}
let count=0;
async function test(fn){await fn();count++;}
(async()=>{
    await test(async()=>{
        const f=await fixture();assert.ok(f.get('source').value.includes(f.state.source));assert.match(f.get('source').value,/\\documentclass/);
        assert.equal(Number(f.get('pointSize').value),28);assert.equal(f.get('apply').disabled,false);
        assert.equal(f.get('sizeMode').value,'font');
        await f.get('apply').onclick();assert.equal(f.writes[0].target.original.id,'original');
        assert.equal(f.writes[0].mode,'font');
    });
    await test(async()=>{
        const f=await fixture();f.state.captureError='请选择一个公式';await f.get('load').onclick();
        assert.equal(f.get('apply').disabled,true);assert.match(f.get('status').textContent,/请选择/);
        await f.get('apply').onclick();assert.equal(f.writes.length,0);
        await f.get('new').onclick();f.state.captureError=null;
        assert.equal(f.get('apply').disabled,false);assert.ok(f.get('source').value.includes('E=mc^{2}'));assert.match(f.get('source').value,/\\usepackage/);
        await f.get('apply').onclick();assert.equal(f.writes[0].target.original,null);
    });
    await test(async()=>{
        const f=await fixture();f.state.found=false;await f.get('load').onclick();
        assert.match(f.get('status').textContent,/没有公式源码/);assert.equal(f.get('apply').disabled,true);
        assert.equal(f.writes.length,0);
    });
    await test(async()=>{
        const f=await fixture('new');assert.equal(f.calls.filter(c=>c[0]!=='/api/latex/source').length,0);
        f.get('source').value='x=2';await f.get('apply').onclick();
        assert.equal(f.writes[0].target.original,null);assert.equal(f.writes[0].mode,'font');
        assert.equal(f.calls.find(c=>c[0]==='/api/render')[1].source,f.get('source').value);
    });
    await test(async()=>{
        const f=await fixture();f.get('pointSize').value='36';f.get('pointSize').oninput();
        await f.get('apply').onclick();assert.equal(f.writes[0].mode,'font');
        assert.equal(f.calls.find(c=>c[0]==='/api/render')[1].point_size,36);
    });
    await test(async()=>{
        const f=await fixture();f.state.type='Image';f.state.source='Regenerated by IguanaTeX';
        f.state.size='32';await f.get('load').onclick();
        assert.ok(f.get('source').value.includes(f.state.source));assert.match(f.get('source').value,/\\documentclass/);assert.equal(Number(f.get('pointSize').value),32);
        assert.equal(f.get('output').value,'svg');
    });
    await test(async()=>{
        const f=await fixture();
        for(const [id,event,value] of [['source','oninput','x=2'],['engine','onchange','lualatex'],
                ['output','onchange','png'],['pointSize','oninput','20']]) {
            await f.get('previewButton').onclick();assert.equal(f.get('formulaImage').hidden,false);
            f.get(id).value=value;f.get(id)[event]();
            assert.equal(f.get('formulaImage').hidden,true,id);assert.equal(f.get('formulaImage').src,'');
            assert.match(f.get('previewHint').textContent,/重新预览/);
        }
        await f.get('previewButton').onclick();
        const count=f.calls.filter(c=>c[0]==='/api/render').length;await f.get('previewButton').onclick();
        assert.equal(f.calls.filter(c=>c[0]==='/api/render').length,count);
        f.get('source').value+='broken';f.state.failRender=true;await f.get('apply').onclick();
        assert.equal(f.writes.length,0);assert.equal(f.get('formulaImage').hidden,true);
        assert.equal(f.get('formulaImage').src,'');assert.match(f.get('previewHint').textContent,/编译未完成/);
        f.state.failRender=false;await f.get('previewButton').onclick();assert.equal(f.get('formulaImage').hidden,false);
    });
    await test(async()=>{
        const f=await fixture('new'), original=f.get('source').value;
        f.get('lineWidth').value='0.6';f.get('lineWidth').oninput();
        assert.equal(f.get('source').value,original);
        await f.get('previewButton').onclick();
        assert.match(f.get('source').value,/\\setlength\{\\textwidth\}\{0\.6\\textwidth\}/);
        assert.equal(f.calls.find(c=>c[0]==='/api/render')[1].source,f.get('source').value);
        assert.match(f.get('previewSize').textContent,/写入尺寸/);
        f.get('lineWidth').value='2';f.get('lineWidth').oninput();await f.get('previewButton').onclick();
        assert.match(f.get('status').textContent,/行宽比例须在/);
    });
    await test(async()=>{
        const f=await fixture('new');
        f.get('pointSize').value='22.5';f.get('pointSize').oninput();
        assert.equal(f.storage.get('iguanatex-bridge.pointSize'),'22.5');
        f.get('source').selectionStart=0;f.get('source').selectionEnd=0;
        f.templates[0].onclick();assert.match(f.get('source').value,/\\sum/);
        let prevented=false;f.listeners.keydown({ctrlKey:true,key:'Enter',preventDefault(){prevented=true;}});
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(prevented,true);assert.ok(f.calls.some(c=>c[0]==='/api/render'));
    });
    await test(async()=>{
        const f=await fixture('new',{host:true});
        assert.equal(f.calls.filter(c=>c[0]==='capture' && c[1]===false).length,1);
        assert.ok(f.state.opened.insertTarget);
        assert.equal(f.state.opened.insertTarget.original,null);
    });
    await test(async()=>{
        const insertTarget={presentationId:'deck',slideId:'original-slide',original:null};
        const snapshot={mode:'new',source:'x=3',engine:'xelatex',output:'svg',pointSize:'18',sizeMode:'font',insertTarget};
        const f=await fixture('new',{unsupported:true,dialog:snapshot});
        assert.equal(f.get('source').value,'x=3');
        assert.doesNotMatch(f.get('status').textContent,/不支持所需 API/);
        await f.get('apply').onclick();
        assert.equal(f.writes[0].target,insertTarget);
        assert.equal(f.calls.filter(c=>c[0]==='capture').length,0);
        assert.equal(f.state.closed.target.original.id,'new');
    });
    await test(async()=>{
        const f=await fixture('new');await f.get('previewButton').onclick();
        f.state.applyError='预览已过期，请重新预览后插入。';await f.get('apply').onclick();
        assert.equal(f.get('formulaImage').hidden,true);
        await f.get('previewButton').onclick();
        assert.equal(f.calls.filter(c=>c[0]==='/api/render').length,2);
        await f.get('apply').onclick();assert.equal(f.writes.length,1);
    });
    await test(async()=>{
        const f=await fixture('picture',{host:true});
        assert.equal(f.state.opened.target.original.id,'pic');
        assert.equal(f.state.opened.target.align,'center');assert.equal(f.state.opened.pointSize,24);
        assert.equal(f.state.opened.imageId,'image-id');
        assert.equal(f.state.opened.pictureSourceReady,false);
        assert.equal(f.calls.filter(c=>c[0]==='/api/wps/review-create').length,1);
    });
    await test(async()=>{
        const target={presentationId:'deck',slideId:'s1',original:{id:'pic',type:'Image',tags:{},width:48,height:24,left:1,top:2},structure:'structure',imageDigest:'hash'};
        const snapshot={mode:'picture',source:'x=3',engine:'xelatex',output:'svg',pointSize:'24',sizeMode:'font',target,imageId:'image-id',pictureSourceReady:true,
            pictureSettings:{point_size:24,color:'#112233',align:'center',review:false}};
        const f=await fixture('picture',{dialog:snapshot});assert.equal(f.state.attached,'pngdata');
        assert.equal(f.get('apply').textContent,'替换原图片');
        f.state.failRender=true;await f.get('previewButton').onclick();
        const draft=f.calls.find(c=>c[0]==='/api/wps/draft-save')[1];
        assert.equal(draft.identity.shape_id,'pic');assert.equal(draft.source,f.get('source').value);
        f.state.failRender=false;await f.get('apply').onclick();assert.equal(f.writes.length,0);
        assert.match(f.get('status').textContent,/请先预览/);
        await f.get('previewButton').onclick();await f.get('apply').onclick();
        assert.equal(f.writes.length,1);assert.ok(f.calls.some(c=>c[0]==='/api/wps/draft-delete'));
    });
    await test(async()=>{
        const target={presentationId:'deck',slideId:'s1',original:{id:'pic',type:'Image',tags:{},width:48,height:24},structure:'s',imageDigest:'h'};
        const f=await fixture('picture',{dialog:{mode:'picture',source:'E=mc^2',engine:'xelatex',output:'svg',pointSize:'18',target}});
        assert.equal(f.get('apply').disabled,true);await f.get('previewButton').onclick();
        assert.match(f.get('status').textContent,/先采用识别结果或输入公式/);
        f.get('source').value='y=2';f.get('source').oninput();await f.get('previewButton').onclick();
        assert.equal(f.get('formulaImage').hidden,false);
    });
    await test(async()=>{
        const target={presentationId:'deck',slideId:'s1',original:{id:'pic',type:'Image',tags:{},width:48,height:24}};
        const f=await fixture('picture',{dialog:{mode:'picture',source:'\\bad',engine:'xelatex',output:'svg',pointSize:'18',target,
            pictureSourceReady:true,draftError:'LaTeX 编译失败：\n! Undefined control sequence.'}});
        assert.equal(f.get('errorDetails').hidden,false);assert.match(f.get('errorText').textContent,/Undefined/);
        assert.equal(f.get('aiFix').hidden,false);f.get('source').oninput();
        assert.equal(f.get('errorDetails').hidden,true);assert.equal(f.get('aiFix').hidden,true);
    });
    console.log(count+' Office taskpane interaction tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
