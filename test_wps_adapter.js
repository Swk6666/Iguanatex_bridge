'use strict';
const assert = require('node:assert/strict');
const bridge = require('./wps_addin/adapter.js');
function fixture() {
    let shapes = [], next = 10, failTags = false, pictureType = 13;
    function picture() {
        const values = {LATEXADDIN: 'old source'}, obj = {Id: next++, Type: 13, Child: 0,
            Height: 30, Width: 100, Left: 70, Top: 90, Rotation: 24, HorizontalFlip: 0, VerticalFlip: 0,
            AlternativeText: 'old alt', Name: 'equation', Select() {}, Flip() {},
            get ZOrderPosition() { return shapes.indexOf(this) + 1; },
            Delete() { shapes.splice(shapes.indexOf(this), 1); },
            ZOrder() { let index = shapes.indexOf(this); shapes.splice(index, 1); shapes.splice(index - 1, 0, this); },
            Tags: {get Count() { return Object.keys(values).length; }, Name(i) { return Object.keys(values)[i-1]; },
                Value(i) { return Object.values(values)[i-1]; }, Item(k) { return values[k]; },
                Add(k,v) { if (failTags) throw Error('tags unavailable'); values[k] = v; }}
        };
        shapes.push(obj); return obj;
    }
    const old = picture(); picture(); picture();
    const slide = {SlideID: 256, SlideIndex: 1, Shapes: {get Count() { return shapes.length; },
        Item(i) { return shapes[i-1]; }, AddPicture(path, linked, embedded, x,y,w,h) {
            assert.equal(linked,0); assert.equal(embedded,-1);
            const p = picture(); Object.assign(p,{Type:pictureType,Left:x,Top:y,Width:w,Height:h}); return p;
        }}};
    const pres = {Slides: {Count:1, Item() { return slide; }}, PageSetup: {SlideWidth:960, SlideHeight:540}};
    const selection = {Type:2,ShapeRange:{Count:1,Item(){return old;}}};
    global.wps = {WppApplication() { return {ActivePresentation:pres, ActiveWindow:{View:{Slide:slide},Selection:selection}}; }};
    return {old, slide, shapes, selection, picture,
        svg() {pictureType=28;}, fail() { failTags=true; }};
}
function group(shape, children) {
    shape.Type=6;
    shape.GroupItems={get Count(){return children.length;},Item(i){return children[i-1];}};
    children.forEach(c=>{c.Child=-1;}); return shape;
}
function glyph(f, source='old source') {
    const p=f.picture(); f.shapes.splice(f.shapes.indexOf(p),1);
    p.Type=5; p.Tags.Add('EMFCHILD','True');p.Tags.Add('LATEXADDIN',source);p.AlternativeText='';return p;
}
const data = {path:'/tmp/test.png',tags:{LATEXADDIN:'new CaseSensitive source'},alt:'new alt',width:60,height:20};
{
    const f=fixture(), ctx=bridge.context(true), p=bridge.replace(ctx,data);
    assert.equal(f.shapes.length,3); assert.ok(!f.shapes.includes(f.old));
    assert.equal(p.Height,20); assert.equal(p.Width,60); assert.equal(p.Left,70);
    assert.equal(p.Top,90); assert.equal(p.Rotation,24); assert.equal(p.ZOrderPosition,1);
    assert.equal(ctx.shape,p); assert.equal(bridge.snapshot(p).tags.LATEXADDIN,data.tags.LATEXADDIN);
}
{
    const f=fixture(), ctx=bridge.context(true); f.fail();
    assert.throws(()=>bridge.replace(ctx,data),/tags unavailable/);
    assert.equal(f.shapes.length,3); assert.ok(f.shapes.includes(f.old));
}
{
    const f=fixture(), ctx=bridge.context(true); f.old.Tags.Add('LATEXADDIN','changed elsewhere');
    assert.throws(()=>bridge.replace(ctx,data),/其他窗口修改/); assert.equal(f.shapes.length,3);
}
{
    const f=fixture(), ctx=bridge.context(true); f.old.Delete();
    assert.throws(()=>bridge.replace(ctx,data),/已删除/); assert.equal(f.shapes.length,2);
}
{
    const f=fixture(), ctx=bridge.context(false), p=bridge.replace(ctx,data);
    assert.equal(f.shapes.length,4); assert.equal(p.Left,450); assert.equal(p.Top,260);
}
{
    const vm = require('node:vm'), fs = require('node:fs'), queue = [], calls = [];
    const sandbox = {window: {location: {href: 'http://127.0.0.1:17863/wps/index.html'}},
        setTimeout(fn) { queue.push(fn); }, wps: {ShowDialog(...args) { calls.push(args); }},
        alert(message) { throw Error(message); }};
    vm.runInNewContext(fs.readFileSync('./wps_addin/main.js','utf8'), sandbox);
    assert.equal(sandbox.OnNewFormula(),true); assert.equal(calls.length,0); assert.equal(queue.length,1);
    queue[0](); assert.equal(calls.length,1); assert.match(calls[0][0], /editor.html\?mode=new&session=/);
    assert.equal(calls[0][4],false); // Do not lock the WPS host in a modal loop.
    assert.deepEqual([calls[0][2],calls[0][3]],[920,760]);
    sandbox.OnConversionSettings(); queue[1]();
    assert.match(calls[1][0], /workflow.html\?mode=settings&session=/); assert.deepEqual([calls[1][2],calls[1][3],calls[1][4]],[600,540,false]);
    sandbox.OnApiSettings(); queue[2]();
    assert.match(calls[2][0], /workflow.html\?mode=api&session=/); assert.equal(calls[2][1],'API 设置');
    assert.deepEqual([calls[2][2],calls[2][3],calls[2][4]],[600,540,false]);
    // Conversion details open a non-modal window instead of a blocking alert().
    sandbox.window.IguanaRecognize={status(){return {detail:'转换完成：成功 1'};}};
    sandbox.OnConversionStatus(); queue[3]();
    assert.match(calls[3][0], /workflow.html\?mode=message&session=\d+#/); assert.equal(decodeURIComponent(calls[3][0].split('#')[1]),'转换完成：成功 1');
    assert.equal(calls[3][4],false);
    // Both settings actions intentionally use the existing settings icon.
    const ids=[...fs.readFileSync('./wps_addin/ribbon.xml','utf8').matchAll(/<button id="([^"]+)"/g)].map(m=>m[1]);
    const icons=ids.map(Id=>sandbox.GetImage({Id}));
    assert.ok(ids.includes('IguanaApiSettings'));
    assert.equal(sandbox.GetImage({Id:'IguanaApiSettings'}),sandbox.GetImage({Id:'IguanaSettings'}));
    assert.equal(new Set(icons).size,ids.length-1);
    for(const icon of icons){assert.match(icon,/^images\/[a-z]+\.svg$/);assert.ok(fs.existsSync('./wps_addin/'+icon),icon);}
}
{
    const f=fixture();group(f.old,[glyph(f),glyph(f,'')]);f.svg();
    const ctx=bridge.context(true), p=bridge.replace(ctx,{...data,output:'svg'});
    assert.equal(p.Type,28);assert.equal(f.shapes.length,3);assert.equal(p.ZOrderPosition,1);
    assert.equal(p.Height,20);assert.equal(p.Width,60);assert.equal(p.Left,70);assert.equal(ctx.sourceData.tags.LATEXADDIN,data.tags.LATEXADDIN);
    bridge.validate(ctx);
}
{
    const f=fixture(), g=glyph(f,''); group(f.old,[glyph(f),g]);
    f.selection.HasChildShapeRange=-1;f.selection.ChildShapeRange={Count:1,Item(){return g;}};
    const ctx=bridge.context(true);assert.equal(ctx.shape,f.old);assert.equal(ctx.sourceData.tags.LATEXADDIN,'old source');
}
{
    const f=fixture(), g=glyph(f);group(f.old,[g,glyph(f,'')]);
    f.old.Tags.Add('LATEXADDIN','');f.old.AlternativeText='';
    assert.equal(bridge.context(true).sourceData.tags.LATEXADDIN,'old source');
}
{
    const f=fixture();group(f.old,[glyph(f,'a'),glyph(f,'b')]);
    assert.throws(()=>bridge.context(true),/多个不同公式/);assert.equal(f.shapes.length,3);
}
{
    const f=fixture(), g=glyph(f);group(f.old,[g,glyph(f,'')]);
    const ctx=bridge.context(true);g.Tags.Add('LATEXADDIN','edited');
    assert.throws(()=>bridge.replace(ctx,data),/其他窗口修改/);assert.equal(f.shapes.length,3);
}
{
    const f=fixture();group(f.old,[glyph(f),glyph(f,'')]);
    assert.throws(()=>bridge.replace(bridge.context(true),{...data,output:'svg'}),/未返回 SVG/);
    assert.ok(f.shapes.includes(f.old));assert.equal(f.shapes.length,3);
}
{
    const f=fixture(), g=glyph(f), label=glyph(f,''); label.Tags.Add('EMFCHILD','False');
    group(f.old,[g,label]); f.old.Tags.Add('LATEXADDIN','');f.old.AlternativeText='';
    assert.throws(()=>bridge.context(true),/外层排版组合/);
}
{
    const f=fixture(); f.old.Type=5;f.svg();
    assert.equal(bridge.replace(bridge.context(true),{...data,output:'svg'}).Type,28);
}
{
    const f=fixture();group(f.old,[glyph(f)]);f.svg();
    const ctx=bridge.context(true);ctx.sizeMode='font';
    const bigger={...data,output:'svg',width:120,height:40,tags:{...data.tags,IGUANATEXSIZE:'36'}};
    const p=bridge.replace(ctx,bigger);
    assert.equal(p.Width,120);assert.equal(p.Height,40);assert.equal(p.Left,70);assert.equal(p.Top,90);
    assert.equal(p.Tags.Item('IGUANATEXSIZE'),'36');assert.equal(p.Rotation,24);
    const again=bridge.replace(ctx,bigger);
    assert.equal(again.Width,120);assert.equal(again.Height,40); // Never multiply again on repeated updates.
    const smaller=bridge.replace(ctx,{...bigger,width:75,height:25,tags:{...data.tags,IGUANATEXSIZE:'22.5'}});
    assert.equal(smaller.Width,75);assert.equal(smaller.Height,25);assert.equal(smaller.Tags.Item('IGUANATEXSIZE'),'22.5');
}
{
    const f=fixture(),ctx=bridge.context(false);ctx.sizeMode='font';
    const p=bridge.replace(ctx,{...data,width:1600,height:800});
    assert.equal(p.Width,1600);assert.equal(p.Height,800); // No implicit font-size reduction.
}
{
    const f=fixture(),ctx=bridge.context(true);ctx.sizeMode='font';
    assert.throws(()=>bridge.replace(ctx,{...data,width:Infinity}),/尺寸无效/);
    assert.equal(f.shapes.length,3);assert.ok(f.shapes.includes(f.old));
}
{
    // Replacing one SVG symbol with the reported Chinese sentence must grow in width.
    const f=fixture();f.old.Type=28;f.old.Width=30;f.old.Height=18.4;f.svg();
    const ctx=bridge.context(true), sentence={...data,output:'svg',width:139.44,height:11.52};
    const natural=bridge.layout(ctx,sentence);
    assert.equal(natural.height,sentence.height);assert.equal(natural.width,sentence.width);
    assert.ok(Math.abs(natural.width/natural.height-139.44/11.52)<1e-10);
    ctx.sizeMode='frame';
    assert.equal(bridge.layout(ctx,sentence).width,30); // Still available explicitly.
    ctx.sizeMode='height';
    const p=bridge.replace(ctx,sentence);assert.equal(p.Height,18.4);assert.equal(p.Width,18.4*sentence.width/sentence.height);assert.equal(p.Left,70);
}
console.log('18 WPS adapter/ribbon contract tests passed');

{
    const f=fixture(); f.old.Tags.Add('LATEXADDIN',''); f.old.AlternativeText='';
    let path=''; f.old.SaveAsPicture=(p)=>{path=p;};
    const ctx=bridge.imageContext(); bridge.exportImage(ctx,'/tmp/example.png');
    assert.equal(path,'/tmp/example.png');
    f.old.Left += 5;
    assert.throws(()=>bridge.validate(ctx),/位置或尺寸已改变/);
    assert.ok(f.shapes.includes(f.old));
}
{
    const f=fixture(); assert.throws(()=>bridge.imageContext(),/已经是可编辑公式/);
    f.old.Tags.Add('LATEXADDIN',''); f.old.AlternativeText=''; f.old.Type=6; f.old.GroupItems={Count:0};
    assert.throws(()=>bridge.imageContext(),/未组合的图片/);
}

{
    const f=fixture(); f.old.Tags.Add('LATEXADDIN',''); f.old.AlternativeText='';
    const other=f.shapes[1]; other.Tags.Add('LATEXADDIN',''); other.AlternativeText='';
    f.selection.ShapeRange={Count:2,Item(i){return [f.old,other][i-1];}};
    const items=bridge.imageContexts(); assert.equal(items.length,2); assert.notEqual(items[0].ctx.shapeId,items[1].ctx.shapeId);
    let ctx=items[0].ctx; ctx.sizeMode='font'; ctx.align='center';
    assert.equal(bridge.layout(ctx,{width:40,height:20}).left,f.old.Left+(f.old.Width-40)/2);
    ctx.align='right';assert.equal(bridge.layout(ctx,{width:40,height:20}).left,f.old.Left+f.old.Width-40);
}
