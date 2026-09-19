'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
async function fixture(edit=true) {
    const nodes={}, renders=[], replacements=[];
    const get=id=>nodes[id]||(nodes[id]={value:'',hidden:false,disabled:false,style:{},textContent:'',clientWidth:700});
    get('pointSize').value='24';get('engine').value='xelatex';get('output').value='svg';get('sizeMode').value='frame';
    const ctx={shape:edit?{Id:1}:null,keepFrame:true,slide:{SlideIndex:1},sourceData:{tags:{LATEXADDIN:'x'}},
        presentation:{PageSetup:{SlideWidth:960,SlideHeight:540}}};
    const sandbox={URLSearchParams,location:{search:edit?'?mode=edit':'?mode=new'},window:{close(){}},
        document:{getElementById:get,querySelectorAll(){return[];},addEventListener(){}},
        fetch:async(url,options)=>({ok:true,json:async()=>{
            if(url.startsWith('/api/session'))return {token:'test'};
            if(url==='/api/wps/metadata')return {found:true,source:'x',engine:'xelatex',tags:{IGUANATEXSIZE:'24'}};
            const body=JSON.parse(options.body);renders.push(body);
            return {png:'test',width:body.point_size*2,height:body.point_size, tags:{IGUANATEXSIZE:String(body.point_size)}};
        }}),
        IguanaWps:{context(){return ctx;},validate(){},layout(c,d){return d;},replace(c,d){
            replacements.push({mode:c.sizeMode,width:d.width,height:d.height});c.shape={Id:2};
        }}};
    vm.runInNewContext(fs.readFileSync('wps_addin/editor.js','utf8'),sandbox);
    await new Promise(resolve=>setImmediate(resolve));
    return {get,ctx,renders,replacements};
}
(async()=>{
    {
        const f=await fixture();assert.equal(f.get('sizeLabel').hidden,false);
        f.get('pointSize').value='36';f.get('pointSize').oninput();
        assert.equal(f.get('sizeMode').value,'font');
        await f.get('applyButton').onclick();
        assert.deepEqual(f.replacements[0],{mode:'font',width:72,height:36});
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
        assert.match(f.get('status').textContent,/4–200/);
    }
    {
        const f=await fixture(false);f.get('pointSize').value='22.5';f.get('pointSize').oninput();
        await f.get('applyButton').onclick();assert.equal(f.replacements[0].mode,'font');
        assert.equal(f.get('sizeMode').value,'font');assert.equal(f.get('sizeLabel').hidden,false);
    }
    console.log('4 WPS editor interaction tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
