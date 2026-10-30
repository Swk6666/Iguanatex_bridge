'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

async function testCase(mode) {
    const calls=[], alerts=[], replaced=[], chatRequests=[], renderRequests=[];
    const ctx={original:{alt:'original'},shape:{}};
    const bad='\\documentclass{article}\n\\begin{document}\n$\\badcmd$\n\\end{document}';
    const fixed='\\documentclass{article}\n\\begin{document}\n$x=1$\n\\end{document}';
    let validations=0, jobNumber=0;
    const sandbox={window:{localStorage:{getItem(){return '24';}},IguanaWps:{
        imageContext(){return ctx;},
        exportImage(c,path){assert.equal(path,'/tmp/img.png');if(mode==='export')throw Error('export failed');},
        validate(){if(mode==='modified' && ++validations===2)throw Error('图片已改变');},
        replace(c,data){replaced.push({mode:c.sizeMode,data});}
    }},alert(message){alerts.push(message);},setTimeout,
    fetch:async(url,request)=>{
        calls.push(url);
        const body=request && request.body ? JSON.parse(request.body) : {};
        let data, ok=true;
        if(url.startsWith('/api/session'))data={token:'test'};
        else if(url==='/api/wps/image-target')data={token:'one',path:'/tmp/img.png'};
        else if(url==='/api/wps/image-read')data={data:'test-image'};
        else if(url==='/api/wps/image-discard')data={ok:true};
        else if(url==='/api/chat/start'){
            chatRequests.push(body); jobNumber++;
            if(jobNumber===1)assert.equal(body.data,'test-image');
            else {
                assert.equal(body.conversation_id,'chat');assert.equal(body.revision,jobNumber-1);
                assert.match(body.message,/badcmd|x=1/);assert.match(body.message,/Undefined control sequence/);
                assert.equal(body.data,undefined);assert.ok(body.message.length<=8000);
            }
            data={id:'job'+jobNumber,conversation_id:'chat'};
        } else if(url==='/api/chat/status')data=mode==='chat'?{status:'failed',message:'识别失败'}:{status:'succeeded'};
        else if(url==='/api/chat/history') {
            const code=(mode==='ambiguous'|| mode==='repair-ambiguous' && jobNumber>1)?[]:[mode==='long' ? bad+'x'.repeat(9000) : jobNumber===1?bad:fixed];
            data={revision:jobNumber,turns:[{id:'job'+jobNumber,latex_blocks:code}]};
        } else if(url==='/api/wps/render') {
            renderRequests.push(body);assert.equal(body.point_size,24);assert.equal(body.output,'svg');
            if(mode==='render' || mode==='long' || mode==='retry-always' || mode==='repair-ambiguous' || mode==='repair' && renderRequests.length===1) {
                ok=false;data={error:'LaTeX 编译失败：\n! Undefined control sequence.\nl.5 \\badcmd'};
            } else if(mode==='other-error'){ok=false;data={error:'本地服务不可用'};}
            else data={path:'/tmp/out.svg',output:'svg'};
        } else throw Error('unexpected request');
        return {ok,json:async()=>data};
    }};
    vm.runInNewContext(fs.readFileSync('wps_addin/recognize.js','utf8'),sandbox);
    sandbox.window.IguanaRecognize.start();
    for(let i=0;i<120 && !alerts.length && !replaced.length;i++)await new Promise(resolve=>setImmediate(resolve));
    if(mode===null || mode==='repair'){
        assert.equal(replaced.length,1);assert.equal(replaced[0].mode,'height');assert.equal(alerts.length,0);
        if(mode==='repair'){
            assert.equal(renderRequests.length,2);assert.equal(chatRequests.length,2);
            assert.equal(renderRequests[0].source,bad);assert.equal(renderRequests[1].source,fixed);
        }
    } else {
        assert.equal(replaced.length,0);assert.match(alerts[0],/原图已保留/);
    }
    if(mode==='export')assert.ok(calls.includes('/api/wps/image-discard'));
    if(mode==='retry-always' || mode==='render') {assert.equal(renderRequests.length,3);assert.equal(chatRequests.length,3);}
    if(mode==='other-error' || mode==='long')assert.equal(chatRequests.length,1);
    if(mode==='long')assert.match(alerts[0],/源码过长/);
    if(mode==='repair-ambiguous'){assert.equal(chatRequests.length,2);assert.equal(renderRequests.length,1);}
}
(async()=>{
    for(const mode of [null,'export','chat','ambiguous','repair','render','retry-always','repair-ambiguous','other-error','long','modified'])await testCase(mode);
    const queue=[],invoked=[],opened=[];
    const sandbox={window:{IguanaRecognize:{start(){invoked.push(true);}},location:{href:'http://localhost/wps/'}},
        setTimeout(fn){queue.push(fn);},wps:{ShowDialog(){opened.push(true);}},alert(){}};
    vm.runInNewContext(fs.readFileSync('wps_addin/main.js','utf8'),sandbox);
    assert.equal(sandbox.OnRecognizeImage(),true);
    assert.equal(opened.length,0);queue[0]();assert.equal(invoked.length,1);assert.equal(opened.length,0);
    console.log('Background recognition and automatic repair tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
