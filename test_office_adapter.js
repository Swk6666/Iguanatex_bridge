'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(version='1.8') {
    let sequence=0;
    const state = {selectedSlide:'s1',selected:[],shapes:[],writes:[],failStamp:false,failCommit:false,missingImageApi:false};
    const collection = items => ({items,load(){return this;},getItem(id){const item=this.items.find(s=>s.id===id);if(!item)throw Error('Missing item');return item;},
        addGeometricShape(type,box){const s=shape(++sequence===1?'new':'new'+sequence,{},'GeometricShape');
            Object.assign(s,box);s.fill={setImage(value){s.fillImage=value;}};s.lineFormat={visible:true};items.push(s);return s;}});
    function shape(id, tags={}, type='Image') {
        const s = {id,name:'Equation '+id,type,left:25,top:30,width:50,height:20,altTextDescription:'',image:'original png',load(){return this;},
            getImageAsBase64(){return {value:this.image};},
            delete(){state.shapes.splice(state.shapes.indexOf(s),1);state.writes.push('delete '+id);if(state.failCommit&&id==='old')throw Error('Commit response lost');},
            setZOrder(op){const i=state.shapes.indexOf(s);state.shapes.splice(i,1);state.shapes.splice(op==='SendToBack'?0:i+1,0,s);}};
        Object.defineProperty(s,'zOrderPosition',{get(){return state.shapes.indexOf(s);}});
        s.tags={items:Object.entries(tags).map(([key,value])=>({key,value})),load(){return this;},add(key,value){
            if(state.failStamp&&key==='LATEXADDIN')value='TRUNCATED';
            const item=this.items.find(t=>t.key===key);if(item)item.value=value;else this.items.push({key,value});
            if(state.concurrentEdit&&id==='new')state.shapes[0].left=99;
        }};
        return s;
    }
    const old=shape('old',{LATEXADDIN:'A=b',LATEXENGINEID:'2'}), other=shape('other');state.shapes.push(old,other);state.selected=[old];
    const slide={id:'s1',get shapes(){return collection(state.shapes);},setSelectedShapes(ids){state.selected=ids.map(id=>state.shapes.find(s=>s.id===id));}};
    const p={id:'deck',load(){},slides:{items:[slide],load(){},getItem(id){assert.equal(id,'s1');return slide;}},
        getSelectedSlides(){return collection([{...slide,id:state.selectedSlide}]);},getSelectedShapes(){return collection(state.selected);}};
    const Office={AsyncResultStatus:{Failed:'failed'},CoercionType:{Image:'image',XmlSvg:'xmlSvg'},context:{
        requirements:{isSetSupported(name,v){if(name==='ImageCoercion')return !state.missingImageApi;
            const [major,minor]=v.split('.').map(Number),[hostMajor,hostMinor]=version.split('.').map(Number);
            return major<hostMajor || (major===hostMajor && minor<=hostMinor);}},
        document:{setSelectedDataAsync(data,options,cb){
            assert.equal(state.selected.length,0,'must clear selection before image insertion');
            state.writes.push({data,options});
            const added=shape(++sequence===1?'new':'new'+sequence,{},options.coercionType==='xmlSvg'?'Graphic':'Image');state.shapes.push(added);state.selected=[added];
            cb({status:'succeeded'});
        }}}};
    const sandbox={Office,crypto:require('node:crypto').webcrypto,TextEncoder,btoa,unescape,encodeURIComponent,
        PowerPoint:{run:async fn=>fn({presentation:p,sync:async()=>{}})}};
    vm.runInNewContext(fs.readFileSync('office_addin/adapter.js','utf8'),sandbox);
    function group(children, tags) {
        old.type='Group'; old.group={shapes:collection(children)};
        if(tags) old.tags.items=Object.entries(tags).map(([key,value])=>({key,value}));
        return old;
    }
    return {api:sandbox.IguanaOffice,state,old,p,shape,group,sandbox,office:Office};
}
const data={output:'svg',svg:'<svg/>',png:'png',width:100,height:40,alt:'IGUANABRIDGE1:source',tags:{LATEXADDIN:'CaseSensitive x=Y',LATEXENGINEID:'2'}};
let count=0;
async function test(fn){await fn();count++;}
(async()=>{
    await test(async()=>{
        const f=fixture();const ctx=await f.api.capture(true);
        assert.equal(ctx.original.tags.LATEXADDIN,'A=b');
        const next=await f.api.apply(ctx,data,'frame');
        assert.deepEqual(f.state.shapes.map(s=>s.id),['new','other']);
        assert.equal(next.original.width,50);assert.equal(next.original.height,20);
        assert.equal(next.original.tags.IGUANABRIDGEMETA,data.alt);
        assert.equal(next.original.tags.LATEXADDIN,data.tags.LATEXADDIN);
        assert.equal(next.original.z,0);
        assert.equal(f.state.writes[0].options.coercionType,'xmlSvg');
        // Repeated updates use a fresh ID/snapshot instead of targeting a deleted shape.
        const again=await f.api.apply(next,data);assert.equal(again.original.width,100);assert.equal(again.original.height,40);
    });
    await test(async()=>{
        const f=fixture();const ctx=await f.api.capture(false);const next=await f.api.apply(ctx,{...data,output:'png'},'font');
        assert.equal(f.state.shapes.length,3);assert.equal(next.original.left,36);
        assert.equal(f.state.writes[0].data,'png');assert(!f.state.writes.includes('delete old'));
    });
    await test(async()=>{
        const f=fixture();const ctx=await f.api.capture(true);f.old.left=900;
        await assert.rejects(f.api.apply(ctx,data,'frame'),/变化/);assert.equal(f.state.writes.length,0);
    });
    await test(async()=>{
        const f=fixture();const ctx=await f.api.capture(true);f.state.selectedSlide='s2';
        await assert.rejects(f.api.apply(ctx,data,'frame'),/切换/);assert.equal(f.state.writes.length,0);
    });
    await test(async()=>{
        const f=fixture();const ctx=await f.api.capture(true);f.state.failStamp=true;
        await assert.rejects(f.api.apply(ctx,data,'frame'),/未完整保存/);
        assert.deepEqual(f.state.shapes.map(s=>s.id),['old','other']);
    });
    await test(async()=>{
        const f=fixture();const ctx=await f.api.capture(true);f.state.failCommit=true;
        await assert.rejects(f.api.apply(ctx,data,'frame'),/新公式已保留/);
        assert(f.state.shapes.some(s=>s.id==='new'),'must keep new object on uncertain deletion');
    });
    await test(async()=>{
        const f=fixture('1.5');f.old.type='Group';await assert.rejects(f.api.capture(true),/PowerPointApi 1.8/);
    });
    await test(async()=>{
        const f=fixture('1.5'), calls=[];f.office.context.platform='PC';
        f.office.context.document.url='file:///C:/slides/test.pptx';f.old.type='Group';
        const nativeTarget={presentationId:'deck',slideId:'s1',original:{id:'old'},nativeSession:'opaque'};
        f.sandbox.fetch=async(url,options)=>({ok:true,json:async()=>{
            if(url==='/api/session')return {token:'local-token'};
            assert.equal(options.headers['X-Bridge-Token'],'local-token');
            calls.push([url,JSON.parse(options.body)]);return nativeTarget;
        }});
        const target=await f.api.capture(true);assert.equal(target.nativeSession,'opaque');
        assert.equal(calls[0][0],'/api/office/native/capture');
        assert.equal(calls[0][1].binding.selectedId,'old');
        const next=await f.api.apply(target,{...data,render_id:'cached-preview'},'height');
        assert.equal(next.nativeSession,'opaque');
        assert.equal(calls[1][0],'/api/office/native/apply');
        assert.equal(calls[1][1].renderId,'cached-preview');
        assert.equal(calls[1][1].mode,'height');
        assert.equal(calls[1][1].data,undefined,'do not send arbitrary render data or paths to native writer');
        assert.equal(f.state.writes.length,0,'native target must never fall through to JS insertion');
        f.state.selectedSlide='s2';
        await assert.rejects(f.api.apply(target,{...data,render_id:'cached-preview'}),/切换/);
        assert.equal(calls.length,2);
    });
    await test(async()=>{
        const f=fixture('1.5');f.office.context.platform='PC';
        f.office.context.document.getFilePropertiesAsync=cb=>cb({status:'succeeded',value:{url:'C:\\slides\\saved.pptx'}});
        const glyph=f.shape('glyph');f.state.selected=[glyph];
        f.sandbox.fetch=async(url,options)=>({ok:true,json:async()=>{
            if(url==='/api/session')return {token:'local-token'};
            const binding=JSON.parse(options.body).binding;
            assert.equal(binding.selectedId,'glyph');assert.equal(binding.documentUrl,'C:\\slides\\saved.pptx');
            return {nativeSession:'child-session'};
        }});
        assert.equal((await f.api.capture(true)).nativeSession,'child-session');
    });
    await test(async()=>{
        const f=fixture('1.5');f.office.context.platform='PC';f.old.type='Group';
        f.sandbox.fetch=async url=>({ok:url==='/api/session',json:async()=>url==='/api/session'?{token:'local-token'}:{error:'原公式已变化'}});
        await assert.rejects(f.api.capture(true),/原公式已变化/);
        await assert.rejects(f.api.apply({nativeSession:'opaque'},data),/重新预览/);
        assert.equal(f.state.writes.length,0);
    });
    await test(async()=>{
        const f=fixture('1.8');f.office.context.platform='PC';
        f.sandbox.fetch=()=>{throw Error('modern hosts should use Office.js');};
        f.group([f.shape('glyph',{EMFCHILD:'True'})]);
        assert.equal((await f.api.capture(true)).original.type,'Group');
    });
    await test(async()=>{
        const f=fixture('1.4');await assert.rejects(f.api.capture(true),/PowerPointApi 1.5/);
    });
    await test(async()=>{
        const f=fixture('1.5');const ctx=await f.api.capture(true);await f.api.apply(ctx,data,'height');
        assert.equal(f.state.shapes[1].width,50);assert.equal(f.state.shapes[1].height,20);
    });
    await test(async()=>{
        const f=fixture();const ctx=await f.api.capture(false);f.state.missingImageApi=true;
        await assert.rejects(f.api.apply(ctx,data,'font'),/SVG/);assert.equal(f.state.shapes.length,2);
    });
    await test(async()=>{
        const f=fixture();const ctx=await f.api.capture(true);f.state.concurrentEdit=true;
        await assert.rejects(f.api.apply(ctx,data,'frame'),/变化/);
        assert.deepEqual(f.state.shapes.map(s=>s.id),['old','other']);
    });
    await test(async()=>{
        const f=fixture();const glyph=f.shape('glyph',{LATEXADDIN:'A=b',EMFCHILD:'True'},'Freeform');
        f.group([glyph,f.shape('glyph2',{EMFCHILD:'-1'},'Freeform')]);
        // Selecting one glyph must resolve to the complete native formula.
        f.state.selected=[glyph];const ctx=await f.api.capture(true);
        assert.equal(ctx.original.id,'old');assert.equal(ctx.sourceTags.LATEXADDIN,'A=b');
        const next=await f.api.apply(ctx,data,'frame');
        assert.equal(next.original.width,50);assert.deepEqual(f.state.shapes.map(s=>s.id),['new','other']);
    });
    await test(async()=>{
        const f=fixture();f.group([f.shape('glyph',{LATEXADDIN:'Legacy x=Y',LATEXENGINEID:'2',EMFCHILD:'True'},'Freeform'),
            f.shape('glyph2',{EMFCHILD:'True'},'Freeform')],{});
        const ctx=await f.api.capture(true);assert.equal(ctx.sourceTags.LATEXADDIN,'Legacy x=Y');
        assert.equal(ctx.original.tags.LATEXADDIN,undefined);
    });
    await test(async()=>{
        const f=fixture();f.group([f.shape('glyph',{LATEXADDIN:'A=b',EMFCHILD:'True'}),f.shape('unrelated')]);
        await assert.rejects(f.api.capture(true),/外层排版组合/);assert.equal(f.state.writes.length,0);
    });
    await test(async()=>{
        const f=fixture();f.group([f.shape('glyph',{LATEXADDIN:'x=1',EMFCHILD:'True'})]);
        await assert.rejects(f.api.capture(true),/多个不同公式/);
    });
    await test(async()=>{
        const f=fixture();const glyph=f.shape('glyph',{LATEXADDIN:'A=b',EMFCHILD:'True'});f.group([glyph]);
        const ctx=await f.api.capture(true);glyph.left=99;
        await assert.rejects(f.api.apply(ctx,data,'frame'),/变化/);assert.equal(f.state.writes.length,0);
    });
    await test(async()=>{
        const f=fixture();const nested=f.shape('nested',{LATEXADDIN:'A=b'},'Group');
        const glyph=f.shape('glyph',{LATEXADDIN:'A=b',EMFCHILD:'True'});
        nested.group={shapes:{items:[glyph],load(){}}};f.group([nested],{});f.state.selected=[glyph];
        await assert.rejects(f.api.capture(true),/外层排版组合/);
    });
    await test(async()=>{
        const f=fixture('1.10');f.state.selected=[f.state.shapes[1]];
        const picture=await f.api.capturePicture();assert.equal(picture.image,'original png');
        picture.target.align='center';await f.api.apply(picture.target,data,'font');
        const inserted=f.state.shapes.find(s=>s.id==='new');assert.equal(inserted.left,0);
        assert.equal(inserted.altTextDescription,data.alt);
    });
    await test(async()=>{
        const f=fixture('1.10');f.state.selected=[f.state.shapes[1]];
        const picture=await f.api.capturePicture();f.state.shapes[1].image='changed png';
        await assert.rejects(f.api.apply(picture.target,data,'font'),/原图片已变化/);
        assert.equal(f.state.writes.length,0);
    });
    await test(async()=>{
        const f=fixture('1.10');await assert.rejects(f.api.capturePicture(),/已有公式源码/);
        await assert.rejects(fixture('1.8').api.capturePicture(),/PowerPointApi 1.10/);
    });
    await test(async()=>{
        const f=fixture('1.10'), scan=await f.api.scanFormulas();
        assert.equal(scan.items.length,1);assert.equal(scan.hasAlt,true);
        await f.api.syncFormula(scan.items[0],{tags:{LATEXADDIN:'A=b',LATEXENGINEID:'2'},alt:'backup'});
        assert.equal(f.old.altTextDescription,'backup');
        assert.equal(f.old.tags.items.find(t=>t.key==='IGUANABRIDGEMETA').value,'backup');
    });
    await test(async()=>{
        const f=fixture('1.10'), scan=await f.api.scanFormulas();f.old.left=100;
        await assert.rejects(f.api.syncFormula(scan.items[0],{tags:{LATEXADDIN:'A=b'},alt:'backup'}),/对象已变化/);
        assert.equal(f.old.altTextDescription,'');
    });
    await test(async()=>{
        const f=fixture('1.10'), glyph=f.shape('glyph',{EMFCHILD:'True'},'Freeform');
        glyph.altTextDescription='IGUANABRIDGE1:backup';f.group([glyph],{});f.state.selected=[glyph];
        const captured=await f.api.capture(true);assert.equal(captured.sourceAlt,'IGUANABRIDGE1:backup');
    });
    await test(async()=>{
        const f=fixture('1.10');f.old.tags.items=[];f.state.selected=[f.old,f.state.shapes[1]];
        const items=await f.api.capturePictures();assert.equal(items.length,2);
        f.state.selectedSlide='s2';const pixels=await f.api.readPicture(items[0].target);assert.equal(pixels,'original png');
        items[0].target.align='center';await f.api.applyBatch(items[0].target,data);
        assert.deepEqual(f.state.shapes.map(s=>s.id),['new','other']);
        assert.equal(f.state.shapes[0].type,'GeometricShape');assert.equal(f.state.shapes[0].fillImage,btoa(data.svg));
        assert.equal(f.state.shapes[0].altTextDescription,data.alt);assert.equal(f.state.shapes[0].lineFormat.visible,false);
        await f.api.applyBatch(items[1].target,data);assert.deepEqual(f.state.shapes.map(s=>s.id),['new','new2']);
    });
    await test(async()=>{
        const f=fixture('1.10');f.old.tags.items=[];f.state.selected=[f.old];const items=await f.api.capturePictures();
        f.old.image='changed png';await assert.rejects(f.api.applyBatch(items[0].target,data),/原图片已变化/);
        assert.deepEqual(f.state.shapes.map(s=>s.id),['old','other']);
    });
    await test(async()=>{
        const f=fixture('1.10');f.old.tags.items=[];f.state.selected=[f.old];const items=await f.api.capturePictures();
        f.state.failStamp=true;await assert.rejects(f.api.applyBatch(items[0].target,data),/未完整保存/);
        assert.deepEqual(f.state.shapes.map(s=>s.id),['old','other']);
    });
    await test(async()=>{
        const f=fixture('1.10');f.old.tags.items=[];f.state.selected=[f.old];const items=await f.api.capturePictures();
        f.state.failCommit=true;await assert.rejects(f.api.applyBatch(items[0].target,data),/新公式已保留/);
        assert(f.state.shapes.some(s=>s.id==='new'));
    });
    console.log(count+' Office adapter contract tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
