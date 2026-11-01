/* Stable Office.js API (PowerPointApi 1.5); no preview-only image APIs. */
(function (root) {
    'use strict';
    function supports(version) { return root.Office.context.requirements.isSetSupported('PowerPointApi', version); }
    function available() {
        if (!root.Office || !root.PowerPoint || !supports('1.5')) {
            throw new Error('此加载项需要支持 PowerPointApi 1.5 的桌面 PowerPoint。请更新 Microsoft 365，或使用独立 PPTX 编辑器。');
        }
    }
    function fields() { return 'id,name,type,left,top,width,height' + (supports('1.8') ? ',zOrderPosition' : '') +
        (supports('1.10') ? ',altTextDescription' : ''); }
    function tagMap(shape) {
        var tags = {};
        shape.tags.items.forEach(function (t) { tags[t.key.toUpperCase()] = t.value; });
        return tags;
    }
    function snapshot(shape) {
        var result = {id: shape.id, name: shape.name, type: shape.type, left: shape.left, top: shape.top,
            width: shape.width, height: shape.height, tags: tagMap(shape),
            z: supports('1.8') ? shape.zOrderPosition : null};
        if (supports('1.10')) result.alt = shape.altTextDescription || '';
        return result;
    }
    function fingerprint(data) {
        var copy = Object.assign({}, data);
        copy.tags = Object.keys(data.tags).sort().map(function (k) { return [k, data.tags[k]]; });
        return JSON.stringify(copy);
    }
    function hasSource(data) { return Boolean(data.tags.LATEXADDIN || data.tags.IGUANABRIDGEMETA || (data.alt || '').includes('IGUANABRIDGE1:')); }
    async function readTrees(context, shapes) {
        var roots = shapes.map(function (shape) { return {shape: shape, children: []}; });
        var level = roots, count = 0, depth = 0;
        // Batch each level: large equations may contain hundreds of glyphs.
        while (level.length) {
            count += level.length;
            if (count > 5000 || ++depth > 20) throw new Error('组合结构过大，请先选中单个公式组合。');
            level.forEach(function (node) { node.shape.load(fields()); node.shape.tags.load('items/key,items/value'); });
            await context.sync();
            level.forEach(function (node) { node.data = snapshot(node.shape); });
            var groups = level.filter(function (node) { return node.data.type === 'Group'; });
            if (!groups.length) break;
            if (!supports('1.8')) throw new Error('编辑 Shape 组合需要 PowerPointApi 1.8。请更新 Office，或先用 IguanaTeX 转为 Picture。');
            groups.forEach(function (node) { node.shape.group.shapes.load('items/id'); });
            await context.sync();
            level = [];
            groups.forEach(function (node) {
                node.children = node.shape.group.shapes.items.map(function (shape) { return {shape: shape, children: []}; });
                level = level.concat(node.children);
            });
        }
        return roots;
    }
    function contains(node, id) {
        return node.data.id === id || node.children.some(function (child) { return contains(child, id); });
    }
    function structure(node) {
        return JSON.stringify([fingerprint(node.data), node.children.map(structure)]);
    }
    function sourceOwner(node) {
        if (node.data.type !== 'Group') return node.data;
        var owners = [], glyphsOnly = true;
        function walk(child, inheritedGlyph) {
            if (hasSource(child.data)) owners.push(child.data);
            var flag = String(child.data.tags.EMFCHILD || '').toLowerCase();
            var glyph = inheritedGlyph || flag === 'true' || flag === '-1';
            if (child.data.type === 'Group') child.children.forEach(function (nested) { walk(nested, glyph); });
            else if (!glyph) glyphsOnly = false;
        }
        node.children.forEach(function (child) { walk(child, false); });
        var own = hasSource(node.data), reference = own ? node.data : owners[0];
        if (!reference) throw new Error('选中组合没有公式源码，可用截图识别新建公式。');
        if (owners.some(function (owner) {
            return owner.tags.LATEXADDIN && reference.tags.LATEXADDIN && owner.tags.LATEXADDIN !== reference.tags.LATEXADDIN;
        })) throw new Error('这个组合包含多个不同公式，请先取消外层排版组合，再选择其中一个公式。');
        // The native add-in marks glyphs EMFCHILD and may put source only on
        // its first glyph. Never delete an arbitrary layout group as a formula.
        if (!glyphsOnly || !node.children.length || (!own && owners.some(function (owner) { return owner.type === 'Group'; }))) {
            throw new Error('这是外层排版组合，请先取消外层组合，保留公式本身的 Shape 组合后再编辑。');
        }
        return reference;
    }
    async function capture(edit) {
        available();
        return root.PowerPoint.run(async function (context) {
            var presentation = context.presentation;
            presentation.load('id');
            var slides = presentation.getSelectedSlides(); slides.load('items/id');
            var selected = presentation.getSelectedShapes(); selected.load('items/id');
            await context.sync();
            if (slides.items.length !== 1) throw new Error('请在普通视图中只选中一页幻灯片。');
            var slide = slides.items[0], old = null, tree = null;
            if (edit) {
                if (selected.items.length !== 1) throw new Error('请只选中一个公式或公式内的一个字符，再点击“编辑选中公式”。');
                slide.shapes.load('items/id,items/type');
                await context.sync();
                old = slide.shapes.items.find(function (s) { return s.id === selected.items[0].id; });
                if (old) tree = (await readTrees(context, [old]))[0];
                else {
                    if (!supports('1.8')) throw new Error('读取组合内的字符需要 PowerPointApi 1.8，请选中整个公式或更新 Office。');
                    var groups = slide.shapes.items.filter(function (s) { return s.type === 'Group'; });
                    tree = (await readTrees(context, groups)).find(function (node) { return contains(node, selected.items[0].id); });
                    if (!tree) throw new Error('找不到选中公式，请重新选择。');
                }
            }
            var owner = tree ? sourceOwner(tree) : null;
            return {presentationId: presentation.id, slideId: slide.id,
                original: tree ? tree.data : null, sourceTags: owner ? owner.tags : null, sourceAlt: owner ? owner.alt || '' : '',
                structure: tree ? structure(tree) : null};
        });
    }
    async function inspect(context, target, background) {
        var p = context.presentation; p.load('id');
        var slides = background ? null : p.getSelectedSlides();
        if (slides) slides.load('items/id');
        await context.sync();
        if (p.id !== target.presentationId || (slides && (slides.items.length !== 1 || slides.items[0].id !== target.slideId))) {
            throw new Error('目标演示文稿或幻灯片已切换，请回到原页后重试。');
        }
        var slide = slides ? slides.items[0] : p.slides.getItem(target.slideId); slide.shapes.load('items/id');
        await context.sync();
        var old = null;
        if (target.original) {
            old = slide.shapes.items.find(function (s) { return s.id === target.original.id; });
            if (!old) throw new Error('原公式已删除；请重新读取选中公式。');
            var tree = (await readTrees(context, [old]))[0];
            if (fingerprint(tree.data) !== fingerprint(target.original) || (target.structure && structure(tree) !== target.structure)) {
                throw new Error('公式或排版已在编辑期间变化，请重新读取选中公式。');
            }
            if (target.imageDigest) {
                var image = old.getImageAsBase64(target.imageOptions); await context.sync();
                if (await digest(image.value) !== target.imageDigest) throw new Error('原图片已变化，请重新选择后再识别。');
            }
        }
        return {slide: slide, old: old};
    }
    function layout(target, data, mode) {
        mode = mode || 'font';
        var old = target.original, height = old && mode !== 'font' ? old.height : data.height;
        var width = old && mode !== 'font' ? (mode === 'frame' ? old.width : height * data.width / data.height) : data.width;
        if (![width, height].every(function (n) { return Number.isFinite(n) && n > 0; })) throw new Error('公式尺寸无效。');
        var left = old ? old.left : 36;
        if (old && target.align === 'center') left += (old.width - width) / 2;
        if (old && target.align === 'right') left += old.width - width;
        return {width: width, height: height, left: left, top: old ? old.top : 36};
    }
    async function digest(base64) {
        var bytes = new TextEncoder().encode(base64);
        var hash = new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes));
        return Array.from(hash, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }
    async function capturePicture() {
        if (!supports('1.10')) throw new Error('直接读取选中图片需要 PowerPointApi 1.10；请使用截图或粘贴图片。');
        var target = await capture(true), original = target.original;
        if (!original || !['Image', 'Graphic'].includes(original.type)) throw new Error('请先在幻灯片中选中一张图片。');
        if (hasSource(original) || (original.alt || '').includes('IGUANABRIDGE1:')) {
            throw new Error('所选图片已有公式源码，请使用“编辑选中公式”。');
        }
        if (!(original.width > 0 && original.height > 0)) throw new Error('选中图片的尺寸无效。');
        var scale = 2048 / Math.max(original.width, original.height);
        target.imageOptions = {format: 'Png', width: Math.max(1, Math.round(original.width * scale)),
            height: Math.max(1, Math.round(original.height * scale))};
        var base64 = await root.PowerPoint.run(async function (context) {
            var current = await inspect(context, target);
            var image = current.old.getImageAsBase64(target.imageOptions); await context.sync();
            return image.value;
        });
        if (!base64 || base64.length > 14_000_000) throw new Error('导出的图片过大，请裁剪后重试。');
        target.imageDigest = await digest(base64);
        // A saved document's URL stays usable for draft lookup across restarts.
        target.draftPresentation = root.Office.context.document.url || target.presentationId;
        return {target: target, image: base64};
    }
    async function capturePictures() {
        available();
        if (!supports('1.10')) throw new Error('多图转换需要 PowerPointApi 1.10，请更新 Microsoft 365。');
        return root.PowerPoint.run(async function (context) {
            var p = context.presentation; p.load('id');
            var slides = p.getSelectedSlides(); slides.load('items/id');
            var selected = p.getSelectedShapes(); selected.load('items/id');
            await context.sync();
            if (slides.items.length !== 1 || !selected.items.length) throw new Error('请在同一页中选中一张或多张图片。');
            if (selected.items.length > 100) throw new Error('一次最多转换 100 张图片。');
            var slide = slides.items[0]; slide.shapes.load('items/id'); await context.sync();
            var selectedIds = selected.items.map(function (s) { return s.id; });
            var roots = selectedIds.map(function (id) { return slide.shapes.items.find(function (s) { return s.id === id; }); });
            roots.filter(Boolean).forEach(function (shape) { shape.load(fields()); shape.tags.load('items/key,items/value'); });
            await context.sync();
            var items = roots.map(function (shape) {
                if (!shape) return {error:'请先取消图片组合，然后选择单独的图片。'};
                var original = snapshot(shape), tree = {data:original, children:[]};
                if (!['Image', 'Graphic'].includes(original.type)) return {error:'所选对象不是单独的图片，请先取消组合。'};
                if (hasSource(original)) return {error:'图片已有公式源码，请使用“编辑选中公式”。'};
                if (!(original.width > 0 && original.height > 0)) return {error:'选中图片的尺寸无效。'};
                var scale = 2048 / Math.max(original.width, original.height);
                return {target:{presentationId:p.id, slideId:slide.id, original:original, structure:structure(tree),
                    draftPresentation:root.Office.context.document.url || p.id,
                    imageOptions:{format:'Png', width:Math.max(1, Math.round(original.width * scale)),
                        height:Math.max(1, Math.round(original.height * scale))}}};
            });
            // Snapshot every image's pixels at selection time.  Discard the
            // large data immediately and check the digest again before use.
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                if (!item.target) continue;
                try {
                    var image = roots[i].getImageAsBase64(item.target.imageOptions); await context.sync();
                    if (!image.value || image.value.length > 14000000) throw new Error('导出的图片过大，请裁剪后重试。');
                    item.target.imageDigest = await digest(image.value);
                } catch (e) { items[i] = {error:e.message || String(e)}; }
            }
            return items;
        });
    }
    async function readPicture(target) {
        return root.PowerPoint.run(async function (context) {
            var current = await inspect(context, target, true);
            var image = current.old.getImageAsBase64(target.imageOptions); await context.sync();
            if (!image.value || image.value.length > 14000000) throw new Error('导出的图片过大，请裁剪后重试。');
            if (await digest(image.value) !== target.imageDigest) throw new Error('原图片已变化，未覆盖。');
            return image.value;
        });
    }
    async function scanFormulas() {
        available();
        return root.PowerPoint.run(async function (context) {
            var presentation = context.presentation; presentation.load('id');
            presentation.slides.load('items/id'); await context.sync();
            var items = [], skippedGroups = 0;
            for (var page = 0; page < presentation.slides.items.length; page++) {
                var slide = presentation.slides.items[page]; slide.shapes.load('items/id,items/type'); await context.sync();
                var shapes = slide.shapes.items;
                if (!supports('1.8')) {
                    skippedGroups += shapes.filter(function (s) { return s.type === 'Group'; }).length;
                    shapes = shapes.filter(function (s) { return s.type !== 'Group'; });
                }
                var trees = await readTrees(context, shapes);
                function visit(node, path) {
                    var current = path.concat(node.data.id);
                    if (hasSource(node.data)) items.push({presentationId:presentation.id, slideId:slide.id,
                        page:page + 1, path:current, original:node.data});
                    else node.children.forEach(function (child) { visit(child, current); });
                }
                trees.forEach(function (node) { visit(node, []); });
            }
            return {items:items, skippedGroups:skippedGroups, hasAlt:supports('1.10')};
        });
    }
    async function syncFormula(item, metadata) {
        available();
        return root.PowerPoint.run(async function (context) {
            var presentation = context.presentation; presentation.load('id'); await context.sync();
            if (presentation.id !== item.presentationId) throw new Error('演示文稿已切换。');
            var shape = presentation.slides.getItem(item.slideId).shapes.getItem(item.path[0]);
            for (var i = 1; i < item.path.length; i++) shape = shape.group.shapes.getItem(item.path[i]);
            shape.load(fields()); shape.tags.load('items/key,items/value'); await context.sync();
            if (fingerprint(snapshot(shape)) !== fingerprint(item.original)) throw new Error('对象已变化，未覆盖。');
            var expected = Object.assign({}, metadata.tags, {IGUANABRIDGEMETA:metadata.alt});
            Object.keys(expected).forEach(function (key) { shape.tags.add(key, String(expected[key])); });
            if (supports('1.10')) shape.altTextDescription = metadata.alt;
            await context.sync();
            shape.tags.load('items/key,items/value');
            if (supports('1.10')) shape.load('altTextDescription');
            await context.sync();
            var saved = tagMap(shape);
            if (Object.keys(expected).some(function (key) { return saved[key] !== String(expected[key]); }) ||
                (supports('1.10') && shape.altTextDescription !== metadata.alt)) {
                throw new Error('源码备份未能完整写入，请检查此公式。');
            }
        });
    }
    function insertImage(data, box) {
        var svg = data.output === 'svg';
        if (svg && !root.Office.context.requirements.isSetSupported('ImageCoercion', '1.2')) {
            throw new Error('此 PowerPoint 不支持 SVG 插入，请选择 PNG 输出后重试。');
        }
        return new Promise(function (resolve, reject) {
            root.Office.context.document.setSelectedDataAsync(svg ? data.svg : data.png, {
                coercionType: svg ? root.Office.CoercionType.XmlSvg : root.Office.CoercionType.Image,
                imageLeft: box.left, imageTop: box.top, imageWidth: box.width, imageHeight: box.height
            }, function (result) { if (result.status === root.Office.AsyncResultStatus.Failed) reject(new Error(result.error.message)); else resolve(); });
        });
    }
    async function apply(target, data, mode) {
        available();
        var box = layout(target, data, mode), before, addedId = null, deletionStarted = false;
        await root.PowerPoint.run(async function (context) {
            var current = await inspect(context, target);
            before = current.slide.shapes.items.map(function (s) { return s.id; });
            // An image insertion must not replace the user's selected content.
            current.slide.setSelectedShapes([]);
            await context.sync();
        });
        await insertImage(data, box);
        try {
            return await root.PowerPoint.run(async function (context) {
                var current = await inspect(context, target);
                var added = current.slide.shapes.items.filter(function (s) { return before.indexOf(s.id) === -1; });
                if (added.length !== 1) throw new Error('无法唯一确认新增公式。原公式已保留，请检查本页后重试。');
                var shape = added[0]; addedId = shape.id;
                var expected = Object.assign({}, data.tags, {IGUANABRIDGEMETA: data.alt});
                Object.keys(expected).forEach(function (k) { shape.tags.add(k, String(expected[k])); });
                if (supports('1.10')) shape.altTextDescription = data.alt;
                shape.name = target.original ? target.original.name : 'IguanaTex ' + shape.id;
                shape.left = box.left; shape.top = box.top; shape.width = box.width; shape.height = box.height;
                await context.sync();
                shape.tags.load('items/key,items/value');
                await context.sync();
                var written = tagMap(shape);
                if (Object.keys(expected).some(function (k) { return written[k] !== String(expected[k]); })) {
                    throw new Error('PowerPoint 未完整保存源码，已取消替换。');
                }
                if (supports('1.10')) {
                    shape.load('altTextDescription'); await context.sync();
                    if (shape.altTextDescription !== data.alt) throw new Error('PowerPoint 未完整保存源码备份，已取消替换。');
                }
                // Keep stacking order when the host provides the stable 1.8 API.
                if (current.old && supports('1.8')) {
                    shape.setZOrder('SendToBack');
                    for (var i = 0; i <= target.original.z; i++) shape.setZOrder('BringForward');
                    await context.sync();
                }
                shape.load(fields());
                await context.sync();
                var saved = snapshot(shape);
                current = await inspect(context, target);
                if (current.old) {
                    // Do not roll back the new shape if deletion succeeded but the
                    // host lost the response; this is the irreversible commit boundary.
                    deletionStarted = true;
                    current.old.delete();
                    await context.sync();
                    if (saved.z !== null) saved.z = target.original.z;
                }
                return {presentationId: target.presentationId, slideId: target.slideId, original: saved};
            });
        } catch (e) {
            if (addedId && !deletionStarted) {
                try {
                    await root.PowerPoint.run(async function (context) {
                        context.presentation.load('id'); await context.sync();
                        if (context.presentation.id !== target.presentationId) throw new Error('演示文稿已切换');
                        context.presentation.slides.getItem(target.slideId).shapes.getItem(addedId).delete();
                        await context.sync();
                    });
                } catch (cleanup) { e.message += ' 新对象未能清理，请手动检查当前页。'; }
            }
            if (deletionStarted) e.message += ' 写入结果未能确认，请重新读取幻灯片；新公式已保留。';
            throw e;
        }
    }
    async function applyBatch(target, data) {
        available();
        if (!supports('1.10')) throw new Error('后台转换需要 PowerPointApi 1.10。');
        var box = layout(target, data, 'font'), addedId = null, deletionStarted = false;
        try {
            return await root.PowerPoint.run(async function (context) {
                var current = await inspect(context, target, true);
                // Stable 1.8 API: put SVG into a rectangle on the target slide,
                // without changing the user's active slide or selection.
                var shape = current.slide.shapes.addGeometricShape('Rectangle', box);
                shape.name = target.original.name; shape.lineFormat.visible = false;
                shape.load('id'); await context.sync(); addedId = shape.id;
                var encoded = data.output === 'svg' ? btoa(unescape(encodeURIComponent(data.svg))) : data.png;
                shape.fill.setImage(encoded);
                var expected = Object.assign({}, data.tags, {IGUANABRIDGEMETA:data.alt});
                Object.keys(expected).forEach(function (key) { shape.tags.add(key, String(expected[key])); });
                shape.altTextDescription = data.alt;
                await context.sync();
                shape.tags.load('items/key,items/value'); shape.load('altTextDescription'); await context.sync();
                var saved = tagMap(shape);
                if (Object.keys(expected).some(function (key) { return saved[key] !== String(expected[key]); }) || shape.altTextDescription !== data.alt) {
                    throw new Error('PowerPoint 未完整保存公式源码，已取消替换。');
                }
                shape.setZOrder('SendToBack');
                for (var i = 0; i <= target.original.z; i++) shape.setZOrder('BringForward');
                await context.sync();
                // Recheck the original after the new object and metadata have
                // been written, then make deletion the final commit step.
                current = await inspect(context, target, true);
                deletionStarted = true; current.old.delete(); await context.sync();
                return {slideId:target.slideId, id:addedId};
            });
        } catch (e) {
            if (addedId && !deletionStarted) {
                try {
                    await root.PowerPoint.run(async function (context) {
                        context.presentation.load('id'); await context.sync();
                        if (context.presentation.id !== target.presentationId) throw new Error('演示文稿已切换');
                        context.presentation.slides.getItem(target.slideId).shapes.getItem(addedId).delete(); await context.sync();
                    });
                } catch (cleanup) { e.message += ' 新对象未能清理，请检查原幻灯片。'; }
            }
            if (deletionStarted) e.message += ' 写入结果未能确认，新公式已保留，请检查原幻灯片。';
            throw e;
        }
    }
    root.IguanaOffice = {capture: capture, capturePicture: capturePicture, capturePictures:capturePictures,
        readPicture:readPicture, applyBatch:applyBatch, scanFormulas: scanFormulas,
        syncFormula: syncFormula, apply: apply, layout: layout, fingerprint: fingerprint};
    if (typeof module !== 'undefined') module.exports = root.IguanaOffice;
}(typeof window !== 'undefined' ? window : globalThis));
