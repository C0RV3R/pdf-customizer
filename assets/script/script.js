/* Gelişmiş PDF Düzenleyici - Düzeltilmiş ve Stabil JS
   Önemli düzeltmeler:
   - Uint8Array kullanımı
   - pdf.js worker fallback
   - canvas oluşturma/temizleme güvenliği
   - export için geçici StaticCanvas doğru yaratımı
*/

const { PDFDocument, StandardFonts } = PDFLib;

// pdf.js global referansı: script tag'ine bağlı olarak window['pdfjs-dist/build/pdf'] dönebilir.
const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib || window.pdfjs;
if (pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
    // Eğer CDN'deki worker script aynı sürümde yoksa basit fallback kullan
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsLib.GlobalWorkerOptions.workerSrc ||
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
}

const fileInput = document.getElementById('file-input');
const downloadBtn = document.getElementById('download-pdf');
const editorContainer = document.getElementById('editor-container');
const loader = document.getElementById('loader');

const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const pageNumSpan = document.getElementById('page-num');
const pageCountSpan = document.getElementById('page-count');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomLevelSpan = document.getElementById('zoom-level');

const toolButtons = document.querySelectorAll('.drawing-tools .tool-btn');
const toolSelectBtn = document.getElementById('tool-select');

const contextToolbar = document.getElementById('context-toolbar');
const colorPicker = document.getElementById('color-picker');
const strokeWidthSlider = document.getElementById('stroke-width');
const fontSizeInput = document.getElementById('font-size');
const opacitySlider = document.getElementById('opacity-slider');
const deleteBtn = document.getElementById('delete-obj');
const strokeWidthGroup = document.getElementById('stroke-width-group');
const fontSizeGroup = document.getElementById('font-size-group');
const opacityGroup = document.getElementById('opacity-group');

let pdfDoc = null;
let currentPageNum = 1;
let currentZoom = 1;
let originalPdfBytes = null;
let fabricCanvas = null;
let fabricState = {}; // pageNum => canvas JSON
let currentTool = 'select';

// helper: show/hide loader
function showLoader(show) { loader.style.display = show ? 'flex' : 'none'; }

// helper: show main tools
function showTools(show) {
    const display = show ? 'flex' : 'none';
    document.querySelector('.navigation-tools').style.display = display;
    document.querySelector('.zoom-tools').style.display = display;
    document.querySelector('.drawing-tools').style.display = display;
    document.querySelector('.save-tools').style.display = display;
}

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        alert('Lütfen bir PDF dosyası seçin.');
        return;
    }

    showLoader(true);
    const reader = new FileReader();
    reader.onload = async function() {
        try {
            // Düzeltme: Uint8Array (eski kodda UintArray hatası vardı)
            originalPdfBytes = new Uint8Array(this.result);

            // pdf.js yükle
            const loadingTask = pdfjsLib.getDocument({ data: originalPdfBytes });
            pdfDoc = await loadingTask.promise;

            currentPageNum = 1;
            fabricState = {};
            pageCountSpan.textContent = pdfDoc.numPages;

            await renderPage(currentPageNum);
            showTools(true);
        } catch (err) {
            console.error('PDF yüklenirken hata:', err);
            alert('PDF yüklenemedi. Dosya bozuk olabilir veya desteklenmeyen format.');
        } finally {
            showLoader(false);
        }
    };
    reader.readAsArrayBuffer(file);
});

async function renderPage(pageNum) {
    if (!pdfDoc) return;
    showLoader(true);

    // sayfa değişmeden önce mevcut fabric state kaydet
    if (fabricCanvas) saveFabricState();

    // temizle DOM
    editorContainer.innerHTML = '';

    // sayfayı al ve viewport hesapla
    const page = await pdfDoc.getPage(pageNum);
    // Her zaman aynı başlangıç zoom'u uygula (canvas'i yeniden oluşturacağız)
    // pdf.js scale: 1 = 1 CSS pixel per PDF point (≈1.33 px vs 72dpi) — burası çoğu durumda yeterli
    const viewport = page.getViewport({ scale: currentZoom });

    // PDF canvas (arka plan)
    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.id = 'pdf-canvas';
    pdfCanvas.width = Math.round(viewport.width);
    pdfCanvas.height = Math.round(viewport.height);
    pdfCanvas.style.width = pdfCanvas.width + 'px';
    pdfCanvas.style.height = pdfCanvas.height + 'px';

    const ctx = pdfCanvas.getContext('2d');

    // Fabric canvas (üstünde çizim yapılacak)
    const fabricCanvasEl = document.createElement('canvas');
    fabricCanvasEl.id = 'fabric-canvas';
    fabricCanvasEl.width = pdfCanvas.width;
    fabricCanvasEl.height = pdfCanvas.height;
    fabricCanvasEl.style.width = pdfCanvas.style.width;
    fabricCanvasEl.style.height = pdfCanvas.style.height;

    // container boyutunu PDF sayfa boyutuna göre ayarla
    editorContainer.style.width = pdfCanvas.style.width;
    editorContainer.style.height = pdfCanvas.style.height;

    editorContainer.appendChild(pdfCanvas);
    editorContainer.appendChild(fabricCanvasEl);

    // pdf render
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Fabric Canvas oluştur
    // Güvenlik: önce eski canvas temizlenir
    if (fabricCanvas) {
        try { fabricCanvas.clear(); } catch(e) {}
        try { if (fabricCanvas.dispose) fabricCanvas.dispose(); } catch(e) {}
        fabricCanvas = null;
    }

    fabricCanvas = new fabric.Canvas(fabricCanvasEl, {
        isDrawingMode: false,
        uniScaleTransform: true,
        preserveObjectStacking: true
    });

    // Eğer bu sayfaya ait kayıtlı state varsa yükle
    if (fabricState[pageNum]) {
        await new Promise((resolve) => {
            fabricCanvas.loadFromJSON(fabricState[pageNum], fabricCanvas.renderAll.bind(fabricCanvas), function(o, object) {
                // per object callback (opsiyonel)
            });
            // loadFromJSON synchronous değilse küçük timeout ile renderAll bekleyelim
            setTimeout(resolve, 50);
        });
    }

    setupFabricListeners();
    setTool(currentTool, true);

    pageNumSpan.textContent = pageNum;
    showLoader(false);
}

prevPageBtn.addEventListener('click', () => {
    if (!pdfDoc) return;
    if (currentPageNum <= 1) return;
    currentPageNum--;
    renderPage(currentPageNum);
});

nextPageBtn.addEventListener('click', () => {
    if (!pdfDoc) return;
    if (currentPageNum >= pdfDoc.numPages) return;
    currentPageNum++;
    renderPage(currentPageNum);
});

zoomInBtn.addEventListener('click', () => {
    currentZoom += 0.25;
    zoomLevelSpan.textContent = `${Math.round(currentZoom * 100)}%`;
    renderPage(currentPageNum);
});

zoomOutBtn.addEventListener('click', () => {
    if (currentZoom <= 0.25) return;
    currentZoom -= 0.25;
    zoomLevelSpan.textContent = `${Math.round(currentZoom * 100)}%`;
    renderPage(currentPageNum);
});

toolButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        toolButtons.forEach(b => b.classList.remove('active'));
        const clickedBtn = e.currentTarget;
        clickedBtn.classList.add('active');

        setTool(clickedBtn.dataset.tool);
    });
});

function setTool(tool, silent = false) {
    // silent => buton klonlama gibi işlemlerden sonra setTool çağrıldığında buton yeniden kliklenmesin
    if (!fabricCanvas) {
        currentTool = tool;
        return;
    }

    fabricCanvas.discardActiveObject();
    fabricCanvas.renderAll();

    fabricCanvas.isDrawingMode = false;
    fabricCanvas.selection = true;
    fabricCanvas.defaultCursor = 'default';

    currentTool = tool;

    switch (tool) {
        case 'select':
            fabricCanvas.selection = true;
            break;
        case 'pencil':
            fabricCanvas.isDrawingMode = true;
            fabricCanvas.freeDrawingBrush.color = colorPicker.value;
            fabricCanvas.freeDrawingBrush.width = parseInt(strokeWidthSlider.value, 10);
            break;
        case 'text':
        case 'arrow':
        case 'rect':
        case 'circle':
        case 'highlight':
            fabricCanvas.selection = false;
            fabricCanvas.defaultCursor = 'crosshair';
            break;
    }

    // buton sync (silent değilse)
    if (!silent) {
        toolButtons.forEach(b => b.classList.remove('active'));
        const el = document.querySelector(`.drawing-tools .tool-btn[data-tool="${tool}"]`);
        if (el) el.classList.add('active');
    }
}

function setupFabricListeners() {
    if (!fabricCanvas) return;

    fabricCanvas.off(); // önce tüm eventler temizlensin

    let isDrawing = false;
    let startPos = { x: 0, y: 0 };
    let newObject = null;

    fabricCanvas.on('mouse:down', (o) => {
        if (fabricCanvas.isDrawingMode || currentTool === 'select') {
            return;
        }

        isDrawing = true;
        startPos = fabricCanvas.getPointer(o.e);
        const color = colorPicker.value;
        const strokeWidth = parseInt(strokeWidthSlider.value, 10);

        switch (currentTool) {
            case 'text':
                newObject = new fabric.IText('Buraya yazın', {
                    left: startPos.x,
                    top: startPos.y,
                    fill: color,
                    fontSize: parseInt(fontSizeInput.value, 10),
                    fontFamily: 'Arial',
                    originX: 'left',
                    originY: 'top',
                    editable: true
                });
                fabricCanvas.add(newObject);
                fabricCanvas.setActiveObject(newObject);
                // doğrudan seçim moduna dön
                setTool('select');
                break;

            case 'arrow': {
                const line = new fabric.Line([0, 0, 0, 0], {
                    stroke: color, strokeWidth, selectable: false, originX: 'left', originY: 'top'
                });
                const head = new fabric.Triangle({
                    left: 0, top: 0, originX: 'center', originY: 'center',
                    width: strokeWidth * 3, height: strokeWidth * 3, fill: color, selectable: false
                });
                // Grubu oluştur
                newObject = new fabric.Group([line, head], { left: startPos.x, top: startPos.y, subTargetCheck: true });
                break;
            }

            case 'rect':
                newObject = new fabric.Rect({
                    left: startPos.x, top: startPos.y, width: 0, height: 0,
                    stroke: color, strokeWidth, fill: 'transparent', originX: 'left', originY: 'top'
                });
                break;

            case 'circle':
                newObject = new fabric.Ellipse({
                    left: startPos.x, top: startPos.y, originX: 'left', originY: 'top',
                    rx: 0, ry: 0, stroke: color, strokeWidth, fill: 'transparent'
                });
                break;

            case 'highlight':
                newObject = new fabric.Rect({
                    left: startPos.x, top: startPos.y, width: 0, height: 0,
                    fill: color, opacity: parseFloat(opacitySlider.value || 0.4), strokeWidth: 0, originX: 'left', originY: 'top'
                });
                break;
        }

        if (newObject) {
            fabricCanvas.add(newObject);
            fabricCanvas.setActiveObject(newObject);
            fabricCanvas.renderAll();
        }
    });

    fabricCanvas.on('mouse:move', (o) => {
        if (!isDrawing || !newObject) return;
        const pos = fabricCanvas.getPointer(o.e);
        const dx = pos.x - startPos.x;
        const dy = pos.y - startPos.y;

        switch (currentTool) {
            case 'arrow': {
                const line = newObject.item(0);
                const head = newObject.item(1);
                line.set({ x2: dx, y2: dy });
                const angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
                head.set({ left: dx, top: dy, angle });
                break;
            }
            case 'rect':
            case 'highlight':
                newObject.set({ width: Math.abs(dx), height: Math.abs(dy), originX: dx < 0 ? 'right' : 'left', originY: dy < 0 ? 'bottom' : 'top' });
                break;
            case 'circle':
                // Ellipse kullanıyoruz: rx, ry
                newObject.set({ rx: Math.abs(dx) / 2, ry: Math.abs(dy) / 2, left: startPos.x + dx / 2, top: startPos.y + dy / 2, originX: 'center', originY: 'center' });
                break;
        }
        fabricCanvas.renderAll();
    });

    fabricCanvas.on('mouse:up', () => {
        if (!isDrawing) return;
        if (newObject) {
            newObject.setCoords();
            fabricCanvas.setActiveObject(newObject);
        }
        isDrawing = false;
        newObject = null;

        // otomatik seçim moduna dön
        setTool('select');
        document.querySelectorAll('.drawing-tools .tool-btn').forEach(b => b.classList.remove('active'));
        if (toolSelectBtn) toolSelectBtn.classList.add('active');
        fabricCanvas.renderAll();
    });

    fabricCanvas.on('selection:created', (e) => updateContextToolbar(e.target));
    fabricCanvas.on('selection:updated', (e) => updateContextToolbar(e.target));
    fabricCanvas.on('selection:cleared', () => contextToolbar.style.display = 'none');

    // klavye kısayolları
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Delete' || ev.key === 'Backspace') {
            const obj = fabricCanvas.getActiveObject();
            if (obj) { fabricCanvas.remove(obj); contextToolbar.style.display = 'none'; }
        } else if (ev.key === 'Escape') {
            fabricCanvas.discardActiveObject();
            fabricCanvas.renderAll();
            contextToolbar.style.display = 'none';
        }
    });
}

function updateContextToolbar(obj) {
    if (!obj) return;
    contextToolbar.style.display = 'flex';

    strokeWidthGroup.style.display = 'none';
    fontSizeGroup.style.display = 'none';
    opacityGroup.style.display = 'none';

    const type = obj.type;

    if (type === 'i-text' || obj instanceof fabric.IText) {
        colorPicker.value = obj.fill || '#000000';
        fontSizeInput.value = obj.fontSize || 24;
        fontSizeGroup.style.display = 'flex';
    } else if (type === 'path' || obj.isType && obj.isType === 'path') {
        colorPicker.value = obj.stroke || '#000000';
        strokeWidthSlider.value = obj.strokeWidth || 2;
        strokeWidthGroup.style.display = 'flex';
    } else if (obj.fill && (obj.opacity && obj.opacity < 1 || obj.fill !== 'transparent')) {
        colorPicker.value = obj.fill || '#ff0000';
        opacitySlider.value = obj.opacity || 1.0;
        opacityGroup.style.display = 'flex';
    } else if (type === 'group' || type === 'rect' || type === 'ellipse' || type === 'circle') {
        const stroke = obj.stroke || (obj._objects && obj._objects[0] && obj._objects[0].stroke) || '#ff0000';
        const strokeW = obj.strokeWidth || (obj._objects && obj._objects[0] && obj._objects[0].strokeWidth) || 2;
        colorPicker.value = stroke;
        strokeWidthSlider.value = strokeW;
        strokeWidthGroup.style.display = 'flex';
    }
}

colorPicker.addEventListener('input', (e) => {
    if (!fabricCanvas) return;
    const obj = fabricCanvas.getActiveObject();
    if (!obj) return;
    const color = e.target.value;
    if (obj.type === 'i-text') obj.set('fill', color);
    else if (obj.type === 'group') {
        obj._objects.forEach(item => {
            if (item.type === 'line' || item.type === 'path') item.set('stroke', color);
            else item.set('fill', color);
        });
    } else if (obj.set) {
        // stroke veya fill tercihi
        if (obj.strokeWidth && obj.stroke) obj.set('stroke', color);
        else obj.set('fill', color);
    }
    fabricCanvas.renderAll();
});

strokeWidthSlider.addEventListener('input', (e) => {
    if (!fabricCanvas) return;
    const obj = fabricCanvas.getActiveObject();
    if (!obj) return;
    const w = parseInt(e.target.value, 10);
    if (obj.type === 'group' && obj._objects) {
        obj._objects.forEach((item, idx) => {
            if (item.set) item.set('strokeWidth', w);
        });
    } else {
        obj.set('strokeWidth', w);
    }
    fabricCanvas.renderAll();
});

fontSizeInput.addEventListener('input', (e) => {
    if (!fabricCanvas) return;
    const obj = fabricCanvas.getActiveObject();
    if (obj && obj.type === 'i-text') {
        obj.set('fontSize', parseInt(e.target.value, 10));
        fabricCanvas.renderAll();
    }
});

opacitySlider.addEventListener('input', (e) => {
    if (!fabricCanvas) return;
    const obj = fabricCanvas.getActiveObject();
    if (!obj) return;
    obj.set('opacity', parseFloat(e.target.value));
    fabricCanvas.renderAll();
});

deleteBtn.addEventListener('click', () => {
    if (!fabricCanvas) return;
    const obj = fabricCanvas.getActiveObject();
    if (obj) {
        fabricCanvas.remove(obj);
        contextToolbar.style.display = 'none';
    }
});

function saveFabricState() {
    if (!fabricCanvas) return;
    try {
        fabricState[currentPageNum] = JSON.stringify(fabricCanvas.toJSON());
    } catch (e) {
        console.warn('saveFabricState hata:', e);
    }
}

// Download / export işlemi
downloadBtn.addEventListener('click', async () => {
    if (!pdfDoc || !originalPdfBytes) {
        alert('Lütfen önce bir PDF yükleyin.');
        return;
    }

    showLoader(true);
    saveFabricState();

    try {
        const pdfLibDoc = await PDFDocument.load(originalPdfBytes);
        const pages = pdfLibDoc.getPages();

        // Her sayfa için: eğer fabricState varsa geçici canvas oluşturup PNG elde et ve göm.
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const pageJson = fabricState[i];
            if (!pageJson) continue; // düzenleme yoksa pas geç

            const pdfLibPage = pages[i - 1];
            const { width: pageWidth, height: pageHeight } = pdfLibPage.getSize();

            // Geçici canvas: boyutları PDF points ile eşleştirelim.
            // PDF points (72 per inch) ile canvas pixel farkı olabilir, ama embed ederken pdf-lib scale yapacaktır.
            const tmpCanvasEl = document.createElement('canvas');
            // pdf-lib uses points; burada canvas boyutunu pageWidth/pageHeight ile set ediyoruz.
            // Bu basit yaklaşım çoğu durumda iyi sonuç verir. İleri seviye: DPI dönüşümü yapılabilir.
            tmpCanvasEl.width = Math.round(pageWidth);
            tmpCanvasEl.height = Math.round(pageHeight);

            // static fabric canvas
            const tmpStatic = new fabric.StaticCanvas(tmpCanvasEl, { enableRetinaScaling: false, renderOnAddition: false });
            // load JSON
            await new Promise((resolve, reject) => {
                try {
                    tmpStatic.loadFromJSON(pageJson, () => {
                        tmpStatic.renderAll();
                        resolve();
                    });
                } catch (e) { reject(e); }
            });

            // PNG data URL
            const pngDataUrl = tmpStatic.toDataURL({ format: 'png' });

            // embed PNG into pdf
            const pngImage = await pdfLibDoc.embedPng(pngDataUrl);
            pdfLibPage.drawImage(pngImage, {
                x: 0,
                y: 0,
                width: pageWidth,
                height: pageHeight,
            });

            // temizle
            try { tmpStatic.clear(); } catch(e) {}
        }

        const pdfBytes = await pdfLibDoc.save();
        download(pdfBytes, `duzenlenmis-${fileInput.files[0].name}`, 'application/pdf');

    } catch (err) {
        console.error('Export hatası:', err);
        alert('PDF kaydedilirken hata oluştu. Konsolu kontrol edin.');
    } finally {
        showLoader(false);
    }
});

function download(data, filename, type) {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 100);
}
