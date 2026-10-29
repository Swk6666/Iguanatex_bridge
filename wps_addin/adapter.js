/* Desktop WPS Presentation JS API. Also loadable by Node for contract tests. */
(function (root) {
    'use strict';
    function app() {
        if (!root.wps) throw new Error('请从 WPS 顶部的 IguanaTex 功能区打开此窗口。');
        return root.wps.WppApplication();
    }
    function tags(shape) {
        var result = {}, collection = shape.Tags;
        for (var i = 1; i <= collection.Count; i++) {
            result[String(collection.Name(i)).toUpperCase()] = String(collection.Value(i));
        }
        return result;
    }
    function snapshot(shape) { return {tags: tags(shape), alt: String(shape.AlternativeText || '')}; }
    function hasSource(data) { return Boolean(data.tags.LATEXADDIN || data.alt.indexOf('IGUANABRIDGE1:') !== -1); }
    function findPath(shapes, id, parents) {
        for (var i = 1; i <= shapes.Count; i++) {
            var shape = shapes.Item(i), path = (parents || []).concat([shape]);
            if (shape.Id === id) return path;
            if (shape.Type === 6) {
                var found = findPath(shape.GroupItems, id, path);
                if (found) return found;
            }
        }
        return null;
    }
    function groupState(shape) {
        var state = [shape.Id, snapshot(shape)];
        if (shape.Type === 6) {
            for (var i = 1; i <= shape.GroupItems.Count; i++) state.push(groupState(shape.GroupItems.Item(i)));
        }
        return state;
    }
    function sourceOwner(shape) {
        var own = snapshot(shape), owners = [], allGlyphs = true;
        function walk(node) {
            var data = snapshot(node);
            if (hasSource(data)) owners.push({shape: node, data: data});
            if (node.Type === 6) {
                for (var i = 1; i <= node.GroupItems.Count; i++) walk(node.GroupItems.Item(i));
            } else if (String(data.tags.EMFCHILD).toLowerCase() !== 'true' && data.tags.EMFCHILD !== '-1') allGlyphs = false;
        }
        if (shape.Type !== 6) return {shape: shape, data: own};
        for (var i = 1; i <= shape.GroupItems.Count; i++) walk(shape.GroupItems.Item(i));
        var reference = hasSource(own) ? {shape: shape, data: own} : owners[0];
        if (!reference) return {shape: shape, data: own};
        var source = reference.data.tags.LATEXADDIN;
        if (owners.some(function (o) { return o.data.tags.LATEXADDIN && source && o.data.tags.LATEXADDIN !== source; })) {
            throw new Error('这个组合包含多个不同公式，请先取消外层排版组合，再选择其中一个公式。');
        }
        // IguanaTex tags only the left-most glyph in some legacy groups.
        // Never infer that an arbitrary layout group is a single equation.
        if (!hasSource(own) && (!allGlyphs || !source || owners.some(function (o) { return o.shape.Type === 6; }))) {
            throw new Error('这是外层排版组合，请先取消外层组合，保留公式本身的 Shape 组合后再编辑。');
        }
        return reference;
    }
    function context(edit) {
        var application = app(), presentation = application.ActivePresentation;
        if (!presentation || !presentation.Slides.Count) throw new Error('请先打开演示文稿并添加一页幻灯片。');
        var slide = application.ActiveWindow.View.Slide, shape = null;
        if (!slide) throw new Error('请切换到普通编辑视图，并选择目标幻灯片。');
        if (edit) {
            var selection = application.ActiveWindow.Selection;
            if (selection.Type !== 2 || selection.ShapeRange.Count !== 1) throw new Error('请只选中一个公式，再点击“编辑选中公式”。');
            shape = selection.ShapeRange.Item(1);
            if (selection.HasChildShapeRange) {
                if (selection.ChildShapeRange.Count !== 1) throw new Error('请只选择一个公式或其中一个字符。');
                shape = selection.ChildShapeRange.Item(1);
            }
            var path = findPath(slide.Shapes, shape.Id);
            if (!path) throw new Error('找不到选中公式，请重新选择。');
            // Clicking a glyph inside an IguanaTex group edits the whole formula.
            for (var i = 0; i < path.length; i++) {
                if (hasSource(snapshot(path[i]))) { shape = path[i]; break; }
            }
            if (shape.Id !== path[0].Id) {
                // A legacy equation group can store its only source on a glyph.
                var parentOwner = sourceOwner(path[0]);
                if (hasSource(parentOwner.data)) shape = path[0];
                else throw new Error('公式位于外层排版组合中，请先取消外层组合后再编辑。');
            }
        }
        var owner = shape ? sourceOwner(shape) : null;
        return {presentation: presentation, slide: slide, shape: shape,
            slideId: slide.SlideID, shapeId: shape ? shape.Id : null,
            original: shape ? snapshot(shape) : null, sourceData: owner ? owner.data : null,
            structure: shape ? JSON.stringify(groupState(shape)) : null};
    }
    function validate(ctx) {
        var slide = null;
        for (var i = 1; i <= ctx.presentation.Slides.Count; i++) {
            var candidate = ctx.presentation.Slides.Item(i);
            if (candidate.SlideID === ctx.slideId) { slide = candidate; break; }
        }
        if (!slide) throw new Error('目标幻灯片已删除，请重新打开编辑器。');
        ctx.slide = slide;
        if (ctx.shapeId !== null) {
            var current = null;
            for (var j = 1; j <= slide.Shapes.Count; j++) {
                if (slide.Shapes.Item(j).Id === ctx.shapeId) { current = slide.Shapes.Item(j); break; }
            }
            if (!current) throw new Error('目标公式已删除，请重新打开编辑器。');
            if (JSON.stringify(groupState(current)) !== ctx.structure) throw new Error('公式源码或组合结构已在其他窗口修改，请重新载入。');
            ctx.shape = current;
        }
    }
    function stamp(shape, data) {
        Object.keys(data.tags).forEach(function (name) { shape.Tags.Add(name, String(data.tags[name])); });
        shape.AlternativeText = data.alt;
        // Do not remove the old picture if this WPS build truncates or changes source.
        if (String(shape.Tags.Item('LATEXADDIN')) !== data.tags.LATEXADDIN || String(shape.AlternativeText) !== data.alt) {
            throw new Error('WPS 未完整保存公式源码；已取消本次插入。');
        }
    }
    function layout(ctx, data) {
        // A longer formula must be allowed to grow, including SVGs and Shape groups.
        // Keeping both old dimensions is only an explicit layout choice.
        var old = ctx.shape, mode = ctx.sizeMode || 'font';
        var height = old && mode !== 'font' ? old.Height : data.height;
        var width = old && mode !== 'font' ? (mode === 'frame' ? old.Width : height * data.width / data.height) : data.width;
        if (!(width > 0 && height > 0 && isFinite(width) && isFinite(height))) throw new Error('公式尺寸无效，请检查字号后重试。');
        // Font mode uses the absolute rendered size, just like IguanaTex Reset.
        // Do not silently shrink an oversized formula and change its font size.
        var left = old ? old.Left : (ctx.presentation.PageSetup.SlideWidth - width) / 2;
        var top = old ? old.Top : (ctx.presentation.PageSetup.SlideHeight - height) / 2;
        return {width: width, height: height, left: left, top: top};
    }
    function replace(ctx, data) {
        validate(ctx);
        var old = ctx.shape, slide = ctx.slide, added = null, box = layout(ctx, data);
        var z = old ? old.ZOrderPosition : null;
        // A replacement is staged and verified before the original is removed.
        try {
            added = slide.Shapes.AddPicture(data.path, 0, -1, box.left, box.top, box.width, box.height);
            if (data.output === 'svg' && added.Type !== 28) throw new Error('当前 WPS 未返回 SVG 矢量对象。原公式已保留；可选择 PNG 输出后重试。');
            stamp(added, data);
            added.Name = old ? old.Name : 'IguanaTex ' + added.Id;
            if (old) {
                added.Rotation = old.Rotation;
                if (old.HorizontalFlip === -1) added.Flip(0);
                if (old.VerticalFlip === -1) added.Flip(1);
                for (var steps = slide.Shapes.Count; added.ZOrderPosition > z + 1 && steps > 0; steps--) added.ZOrder(3);
                if (added.ZOrderPosition !== z + 1) throw new Error('无法保持公式层叠顺序，已取消替换。');
                old.Delete();
            }
        } catch (e) {
            if (added) { try { added.Delete(); } catch (ignored) {} }
            throw e;
        }
        ctx.shape = added; ctx.shapeId = added.Id; ctx.original = snapshot(added);
        ctx.sourceData = ctx.original; ctx.structure = JSON.stringify(groupState(added));
        try { added.Select(); } catch (ignored) {}
        return added;
    }
    function formulas() {
        var presentation = app().ActivePresentation, result = [];
        function walk(shapes, page) {
            for (var i = 1; i <= shapes.Count; i++) {
                var shape = shapes.Item(i), data = snapshot(shape);
                if (data.tags.LATEXADDIN || data.alt.indexOf('IGUANABRIDGE1:') !== -1) result.push({shape: shape, data: data, page: page});
                else if (shape.Type === 6) walk(shape.GroupItems, page);
            }
        }
        for (var page = 1; page <= presentation.Slides.Count; page++) walk(presentation.Slides.Item(page).Shapes, page);
        return result;
    }
    root.IguanaWps = {context: context, validate: validate, tags: tags, snapshot: snapshot, stamp: stamp, layout: layout, replace: replace, formulas: formulas};
    if (typeof module !== 'undefined') module.exports = root.IguanaWps;
}(typeof window !== 'undefined' ? window : globalThis));
