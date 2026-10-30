'use strict';
const assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
async function scenario(mode) {
    const calls=[], alerts=[], replaced=[], chats=[], renders=[], drafts=[], snapshots=[];
    const contexts = Array.from({length:mode==='batch'?3:1},(_,i)=>({original:{alt:''},shape:{}, identity:{presentation:'deck.pptx',slide_id:1,shape_id:i+1},signature:'shape-'+i}));
    const doc='\\documentclass{article}\n\\begin{document}\n$\\badcmd$\n\\end{document}';
    const fixed='\\documentclass{article}\n\\begin{document}\n$x=1$\n\\end{document}';
    let jobs=0, requestNumber=0, dialogCount=0, currentShape=0, cancelledJob=false;
    const settings={point_size:24,color:'#AABBCC',align:'center',review:['review','skip','review-cancel'].includes(mode)};
    const sandbox={window:{location:{href:'http://127.0.0.1:17863/wps/index.html'},wps:{ShowDialog(){dialogCount++;}},
        UpdateRecognitionUI(){snapshots.push(sandbox.window.IguanaRecognize.status().label);},IguanaWps:{
            imageContexts(){return contexts.map(ctx=>({ctx}));},
            exportImage(ctx,path){currentShape=ctx.identity.shape_id;assert.equal(path,'/tmp/img.png');if(mode==='batch' && currentShape===2)throw Error('WPS 无法导出');},
            validate(){},replace(ctx,data){replaced.push({ctx,data});}
        }},alert(message){alerts.push(message);},setTimeout,
        fetch:async(url,request)=>{
            calls.push(url);const body=request && request.body?JSON.parse(request.body):{};
            let result={},ok=true;
            if(url.startsWith('/api/session'))result={token:'test'};
            else if(url==='/api/wps/settings')result=settings;
            else if(url==='/api/wps/image-target')result={token:'one',path:'/tmp/img.png'};
            else if(url==='/api/wps/image-read')result={data:'test-image'};
            else if(url==='/api/wps/image-discard' || url==='/api/wps/draft-delete' || url==='/api/wps/review-discard')result={ok:true};
            else if(url==='/api/wps/draft-save'){drafts.push(body);result={saved:true};}
            else if(url==='/api/chat/start'){
                chats.push(body);jobs++;if(mode==='cancel-start'){setImmediate(()=>sandbox.window.IguanaRecognize.cancel());await new Promise(resolve=>setImmediate(resolve));}
                if(jobs===1 || body.data)assert.equal(body.data,'test-image');
                else {assert.ok(body.message.length<=8000);assert.match(body.message,/Undefined control sequence/);}
                result={id:'job'+jobs,conversation_id:'chat'};
            } else if(url==='/api/chat/status'){
                if(mode==='cancel'){setImmediate(()=>sandbox.window.IguanaRecognize.cancel());await new Promise(resolve=>setImmediate(resolve));result={status:'answering'};}
                else result={status:'succeeded'};
            } else if(url==='/api/chat/cancel'){cancelledJob=true;result={status:'cancelled'};}
            else if(url==='/api/chat/history')result={revision:jobs,turns:[{id:'job'+jobs,latex_blocks:[jobs===1?doc:fixed]}]};
            else if(url==='/api/wps/render'){
                renders.push(body);assert.equal(body.point_size,24);assert.equal(body.color,'#AABBCC');
                if(mode==='cancel-render'){setImmediate(()=>sandbox.window.IguanaRecognize.cancel());await new Promise(resolve=>setImmediate(resolve));result={path:'/tmp/out.svg',output:'svg',png:'cG5n'};}
                else if(mode==='compile-fail' || mode==='repair' && renders.length===1){ok=false;result={error:'LaTeX 编译失败：\n! Undefined control sequence.\nl.5 \\badcmd'};}
                else result={path:'/tmp/out.svg',output:'svg',png:'cG5n'};
            } else if(url==='/api/wps/review-create'){assert.equal(body.image,'test-image');result={id:'review1'};}
            else if(url==='/api/wps/review-status')result={decision:mode==='review'?'accept':mode==='skip'?'skip':'cancel'};
            else throw Error('unexpected '+url);
            return {ok,json:async()=>result};
        }};
    vm.runInNewContext(fs.readFileSync('wps_addin/recognize.js','utf8'),sandbox);
    sandbox.window.IguanaRecognize.start();
    for(let i=0;i<300;i++){
        await new Promise(resolve=>setImmediate(resolve));
        if(/完成|失败|取消/.test(sandbox.window.IguanaRecognize.status().label) && !/取消中/.test(sandbox.window.IguanaRecognize.status().label))break;
    }
    const status=sandbox.window.IguanaRecognize.status();
    if(mode==='batch'){
        assert.equal(replaced.length,2);assert.match(status.detail,/成功 2，失败 1/);assert.equal(alerts.length,1);
    } else if(mode==='compile-fail'){
        assert.equal(replaced.length,0);assert.equal(chats.length,3);assert.equal(drafts.length,1);assert.match(drafts[0].error,/Undefined/);assert.match(status.detail,/已保存草稿/);
    } else if(mode==='cancel' || mode==='cancel-start' || mode==='cancel-render'){
        assert.equal(replaced.length,0);assert.match(status.detail,/取消/);if(mode==='cancel' || mode==='cancel-start')assert.equal(cancelledJob,true);
    } else if(mode==='skip'){
        assert.equal(replaced.length,0);assert.match(status.detail,/跳过 1/);assert.equal(dialogCount,1);
    } else if(mode==='review-cancel'){
        assert.equal(replaced.length,0);assert.match(status.detail,/取消/);
    } else {
        assert.equal(replaced.length,1);assert.equal(replaced[0].ctx.align,'center');assert.equal(replaced[0].ctx.sizeMode,'font');
        if(mode==='repair'){assert.equal(chats.length,2);assert.equal(renders[1].source,fixed);assert.ok(snapshots.some(x=>x.includes('自动纠错中')));}
        if(mode==='review')assert.equal(dialogCount,1);
    }
    if(mode!== 'cancel')assert.ok(snapshots.some(x=>x.includes('识别中')));
}
(async()=>{
    for(const mode of ['normal','repair','batch','compile-fail','cancel','cancel-start','cancel-render','review','skip','review-cancel'])await scenario(mode);
    const queue=[],invoked=[],opened=[];
    const sandbox={window:{IguanaRecognize:{start(){invoked.push(true);}},location:{href:'http://localhost/wps/'}},setTimeout(fn){queue.push(fn);},wps:{ShowDialog(){opened.push(true);}},alert(){}};
    vm.runInNewContext(fs.readFileSync('wps_addin/main.js','utf8'),sandbox);
    assert.equal(sandbox.OnRecognizeImage(),true);assert.equal(opened.length,0);queue[0]();assert.equal(invoked.length,1);assert.equal(opened.length,0);
    console.log('Batch, progress, cancellation, drafts, styling and review tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
