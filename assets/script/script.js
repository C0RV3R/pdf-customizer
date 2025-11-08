// --- Kütüphaneleri Hazırla ---
const { PDFDocument, rgb, StandardFonts } = PDFLib;
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// --- DOM Elementleri ---
const fileInput = document.getElementById('file-input');
const downloadBtn = document.getElementById('download-pdf');
const editorContainer = document.getElementById('editor-container');
const loader = document.getElementById('loader');

// Navigasyon & Zoom
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const pageNumSpan = document.getElementById('page-num');
const pageCountSpan = document.getElementById('page-count');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomLevelSpan = document.getElementById('zoom-level');

// Araç Butonları
const toolButtons = document.querySelectorAll('.drawing-tools .tool-btn');
const toolSelectBtn = document.getElementById('tool-select');
const toolPencilBtn = document.getElementById('tool-pencil');
const toolTextBtn = document.getElementById('tool-text');
const toolArrowBtn = document.getElementById('tool-arrow');
const toolRectBtn = document.getElementById('tool-rect');
const toolCircleBtn = document.getElementById('tool-circle');
const toolHighlightBtn = document.getElementById('tool-highlight');

// Bağlamsal Araç Çubuğu
const contextToolbar = document.getElementById('context-toolbar');
const colorPicker = document.getElementById('color-picker');
const strokeWidthSlider = document.getElementById('stroke-width');
const fontSizeInput = document.getElementById('font-size');
const opacitySlider = document.getElementById('opacity-slider');
const deleteBtn = document.getElementById('delete-obj');
const strokeWidthGroup = document.getElementById('stroke-width-group');
const fontSizeGroup = document.getElementById('font-size-group');
const opacityGroup = document.getElementById('opacity-group');

// --- Global Durum (State) ---
let pdfDoc = null;
let currentPageNum = 1;
let currentZoom = 1;
let originalPdfBytes = null;
let fabricCanvas = null;
/** @type {Object<number, string>} */
let fabricState = {}; // Her sayfanın Fabric.js durumunu (JSON) saklar
let currentTool = 'select'; // Aktif araç

// --- 1. PDF Yükleme ve Görüntüleme ---

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || file.type !== 'application/pdf') return;

    showLoader(true);
    const fileReader = new FileReader();

    fileReader.onload = async function() {
        originalPdfBytes = new UintArray(this.result);
        
        try {
            const loadingTask = pdfjsLib.getDocument({ data: originalPdfBytes });
            pdfDoc = await loadingTask.promise;
            
            // Durumu sıfırla
            currentPageNum = 1;
            fabricState = {}; // Yeni PDF için eski durumları temizle
            pageCountSpan.textContent = pdfDoc.numPages;
            
            await renderPage(currentPageNum);
            showTools(true); // Araçları göster
        } catch (error) {
            console.error("PDF yüklenirken hata:", error);
            alert("PDF yüklenemedi. Dosya bozuk olabilir.");
        } finally {
            showLoader(false);
        }
    };
    fileReader.readAsArrayBuffer(file);
});

async function renderPage(pageNum) {
    if (!pdfDoc) return;
    showLoader(true);

    // --- DÜZELTME 1: ÖNCEKİ CANVAS'I İMHA ET (DISPOSE) ---
    // Bu, sayfa veya zoom değiştiğinde eski canvas'ın
    // olaylarının (events) bellekte kalmasını engeller.
    if (fabricCanvas) {
        saveFabricState(); // Mevcut durumu kaydet
        fabricCanvas.dispose(); // Eski canvas'ı bellekten at
        fabricCanvas = null;  // Referansı temizle
    }
    // ---------------------------------------------------

    editorContainer.innerHTML = ''; // HTML'i temizle

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: currentZoom });

    // 1. PDF Canvas (Alt Katman)
    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.id = 'pdf-canvas';
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    const context = pdfCanvas.getContext('2d');

    // 2. Fabric Canvas (Üst Katman)
    const fabricCanvasEl = document.createElement('canvas');
    fabricCanvasEl.id = 'fabric-canvas';
    fabricCanvasEl.width = viewport.width;
    fabricCanvasEl.height = viewport.height;
    
    editorContainer.appendChild(pdfCanvas);
    editorContainer.appendChild(fabricCanvasEl);
    
    await page.render({ canvasContext: context, viewport: viewport }).promise;

    // Fabric.js'yi YENİ canvas elemanı üzerinde başlat
    fabricCanvas = new fabric.Canvas(fabricCanvasEl, {
        isDrawingMode: false,
    });
    
    if (fabricState[pageNum]) {
        fabricCanvas.loadFromJSON(fabricState[pageNum], fabricCanvas.renderAll.bind(fabricCanvas));
    }

    // Olay dinleyicilerini BU YENİ canvas için ayarla
    setupFabricListeners();
    // Aktif aracı BU YENİ canvas için ayarla
    setTool(currentTool);

    pageNumSpan.textContent = pageNum;
    showLoader(false);
}

// --- 2. Sayfalama ve Zoom ---

prevPageBtn.addEventListener('click', () => {
    if (currentPageNum <= 1) return;
    currentPageNum--;
    renderPage(currentPageNum);
});

nextPageBtn.addEventListener('click', () => {
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


// --- 3. Araç Seçimi ve "Oyuncaklar" ---

toolButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        toolButtons.forEach(b => b.classList.remove('active'));
        const clickedBtn = e.currentTarget;
        clickedBtn.classList.add('active');
        
        currentTool = clickedBtn.dataset.tool;
        setTool(currentTool);
    });
});

function setTool(tool) {
    if (!fabricCanvas) return;
    
    fabricCanvas.isDrawingMode = false;
    fabricCanvas.selection = true; 
    fabricCanvas.defaultCursor = 'default';

    switch (tool) {
        case 'select':
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
            fabricCanvas.selection = false; // Yeni şekil çizerken seçimi kapat
            fabricCanvas.defaultCursor = 'crosshair';
            break;
    }
}

// Canvas'a tıklandığında (text, shape eklemek için)
function setupFabricListeners() {
    if (!fabricCanvas) return; // Güvenlik kontrolü

    // --- DÜZELTME 2: TÜM ESKİ OLAYLARI TEMİZLE ---
    // Yeni canvas'a olay eklemeden önce, üzerinde
    // hiçbir olay dinleyicisi olmadığından emin ol.
    fabricCanvas.off();
    // ------------------------------------------

    let isDrawing = false;
    let startPos = { x: 0, y: 0 };
    let newObject = null;

    // YENİ OLAYLARI EKLE
    fabricCanvas.on('mouse:down', (o) => {
        // "select" veya "pencil" modundaysak bu listener bir şey yapmamalı
        // (pencil'ı fabric'in 'isDrawingMode'u kendi halleder)
        if (currentTool === 'select' || currentTool === 'pencil') {
            return;
        }

        isDrawing = true;
        startPos = fabricCanvas.getPointer(o.e);
        const color = colorPicker.value;
        const strokeWidth = parseInt(strokeWidthSlider.value, 10);

        switch (currentTool) {
            case 'text':
                newObject = new fabric.IText('Metin...', {
                    left: startPos.x,
                    top: startPos.y,
                    fill: color,
                    fontSize: parseInt(fontSizeInput.value, 10),
                    fontFamily: 'Arial',
                    originX: 'left',
                    originY: 'top'
                });
                break;
            case 'arrow':
                const line = new fabric.Line([startPos.x, startPos.y, startPos.x, startPos.y], {
                    stroke: color,
                    strokeWidth: strokeWidth,
                });
                const arrowHead = new fabric.Triangle({
                    left: startPos.x,
                    top: startPos.y,
                    originX: 'center',
                    originY: 'center',
                    fill: color,
                    width: strokeWidth * 3,
                    height: strokeWidth * 3,
                    angle: 90
                });
                newObject = new fabric.Group([line, arrowHead], {
                    left: startPos.x,
                    top: startPos.y,
                });
                break;
            case 'rect':
                newObject = new fabric.Rect({
                    left: startPos.x,
                    top: startPos.y,
                    width: 0,
                    height: 0,
                    stroke: color,
                    strokeWidth: strokeWidth,
                    fill: 'transparent',
                });
                break;
             case 'circle':
                newObject = new fabric.Circle({
                    left: startPos.x,
                    top: startPos.y,
                    radius: 0,
                    stroke: color,
                    strokeWidth: strokeWidth,
                    fill: 'transparent',
                    originX: 'left',
                    originY: 'top'
                });
                break;
            case 'highlight':
                newObject = new fabric.Rect({
                    left: startPos.x,
                    top: startPos.y,
                    width: 0,
                    height: 0,
                    fill: color,
                    opacity: 0.4,
                    strokeWidth: 0,
                });
                break;
        }
        
        if (newObject && currentTool !== 'text') { // Metin hariç diğerleri hemen eklenir
             fabricCanvas.add(newObject);
        }
    });

    fabricCanvas.on('mouse:move', (o) => {
        if (!isDrawing || !newObject) return;
        const pos = fabricCanvas.getPointer(o.e);

        switch (currentTool) {
            case 'arrow':
                const line = newObject.item(0);
                const arrowHead = newObject.item(1);
                
                // Grubun 'left' ve 'top'u değişmediği için
                // çizginin ve okun pozisyonunu grubun *içinde* hesaplamalıyız
                line.set({ x2: pos.x - startPos.x, y2: pos.y - startPos.y });
                
                const angle = Math.atan2(pos.y - startPos.y, pos.x - startPos.x) * 180 / Math.PI + 90;
                arrowHead.set({ 
                    left: pos.x - startPos.x, 
                    top: pos.y - startPos.y,
                    angle: angle
                });
                break;
            case 'rect':
            case 'highlight':
                newObject.set({
                    width: Math.abs(pos.x - startPos.x),
                    height: Math.abs(pos.y - startPos.y),
                    // Eğer mouse başlangıç noktasının soluna/üstüne geçerse diye
                    originX: pos.x < startPos.x ? 'right' : 'left',
                    originY: pos.y < startPos.y ? 'bottom' : 'top'
                });
                break;
            case 'circle':
                 const dx = pos.x - startPos.x;
                 const dy = pos.y - startPos.y;
                 const radius = Math.sqrt(dx * dx + dy * dy) / 2;
                 newObject.set({
                    radius: radius,
                    originX: 'center',
                    originY: 'center',
                    left: startPos.x + dx / 2,
                    top: startPos.y + dy / 2
                 });
                break;
        }
        if (newObject) fabricCanvas.renderAll();
    });

    fabricCanvas.on('mouse:up', () => {
        if (!isDrawing) return; // 'select' modunda tıklayıp bırakırsak
        
        if (newObject) {
            if(currentTool === 'text') {
                 fabricCanvas.add(newObject);
            }
            newObject.setCoords();
            fabricCanvas.setActiveObject(newObject);
        }
        
        isDrawing = false;
        newObject = null;
        // İş bittikten sonra seçim aracına geri dön
        setTool('select');
        // Butonun da "active" class'ını güncelle
        toolButtons.forEach(b => b.classList.remove('active'));
        toolSelectBtn.classList.add('active');
    });

    // --- 4. Bağlamsal Araç Çubuğu (Context Toolbar) ---
    fabricCanvas.on('selection:created', (e) => updateContextToolbar(e.target));
    fabricCanvas.on('selection:updated', (e) => updateContextToolbar(e.target));
    fabricCanvas.on('selection:cleared', () => contextToolbar.style.display = 'none');
}

function updateContextToolbar(obj) {
    if (!obj) return;
    contextToolbar.style.display = 'flex';

    strokeWidthGroup.style.display = 'none';
    fontSizeGroup.style.display = 'none';
    opacityGroup.style.display = 'none';
    
    if (obj.type === 'i-text') {
        colorPicker.value = obj.get('fill');
        fontSizeInput.value = obj.get('fontSize');
        fontSizeGroup.style.display = 'flex';
        
    } else if (obj.type === 'path') { // Kalem
        colorPicker.value = obj.get('stroke');
        strokeWidthSlider.value = obj.get('strokeWidth');
        strokeWidthGroup.style.display = 'flex';

    } else if (obj.fill && obj.opacity < 1) { // Vurgulayıcı
        colorPicker.value = obj.get('fill');
        opacitySlider.value = obj.get('opacity');
        opacityGroup.style.display = 'flex';

    } else if (obj.type === 'group' || obj.type === 'rect' || obj.type === 'circle') {
        const stroke = obj.get('stroke') || (obj._objects && obj._objects[0].get('stroke'));
        const strokeW = obj.get('strokeWidth') || (obj._objects && obj._objects[0].get('strokeWidth'));
        
        colorPicker.value = stroke || '#ff0000';
        strokeWidthSlider.value = strokeW || 5;
        strokeWidthGroup.style.display = 'flex';
    }
}

// Bağlamsal araç çubuğu event'leri
colorPicker.addEventListener('input', (e) => {
    const obj = fabricCanvas.getActiveObject();
    if (!obj) return;
    
    const color = e.target.value;
    
    if (obj.type === 'i-text') {
        obj.set('fill', color);
    } else if (obj.type === 'path') { // Kalem
        obj.set('stroke', color);
    } else if (obj.fill && obj.opacity < 1) { // Vurgulayıcı
         obj.set('fill', color);
    } else if (obj.type === 'group') { // Ok
        obj._objects.forEach(item => item.set(item.type === 'line' ? 'stroke' : 'fill', color));
    } else { // Diğer şekiller
        obj.set('stroke', color);
    }
    fabricCanvas.renderAll();
});

strokeWidthSlider.addEventListener('input', (e) => {
    const obj = fabricCanvas.getActiveObject();
    if (!obj) return;
    const width = parseInt(e.target.value, 10);
    
    if (obj.type === 'group') { // Ok
        obj._objects[0].set('strokeWidth', width); // Çizgi
        obj._objects[1].set({ width: width * 3, height: width * 3 }); // Ok ucu
    } else {
        obj.set('strokeWidth', width);
    }
    fabricCanvas.renderAll();
});

fontSizeInput.addEventListener('input', (e) => {
    const obj = fabricCanvas.getActiveObject();
    if (obj && obj.type === 'i-text') {
        obj.set('fontSize', parseInt(e.target.value, 10));
        fabricCanvas.renderAll();
    }
});

opacitySlider.addEventListener('input', (e) => {
    const obj = fabricCanvas.getActiveObject();
    if (obj) {
        obj.set('opacity', parseFloat(e.target.value));
        fabricCanvas.renderAll();
    }
});

deleteBtn.addEventListener('click', () => {
    const obj = fabricCanvas.getActiveObject();
    if (obj) {
        fabricCanvas.remove(obj);
        contextToolbar.style.display = 'none';
    }
});

// --- 5. Kaydetme ve İndirme ---

function saveFabricState() {
    if (fabricCanvas) {
        fabricState[currentPageNum] = JSON.stringify(fabricCanvas.toJSON());
    }
}

downloadBtn.addEventListener('click', async () => {
    if (!pdfDoc) {
        alert("Lütfen önce bir PDF yükleyin.");
        return;
    }
    showLoader(true);

    saveFabricState();
    
    try {
        const pdfLibDoc = await PDFDocument.load(originalPdfBytes);
        const pages = pdfLibDoc.getPages();
        const helveticaFont = await pdfLibDoc.embedFont(StandardFonts.Helvetica);
        
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const pageData = fabricState[i];
            if (!pageData) continue; 

            const pdfLibPage = pages[i - 1];
            const { width, height } = pdfLibPage.getSize();
            
            const tempCanvas = new fabric.StaticCanvas(null, { width, height });
            
            // loadFromJSON asenkron olabilir, bu yüzden renderCallback'ini beklemeliyiz
            await new Promise(resolve => tempCanvas.loadFromJSON(pageData, resolve));
            
            const pngDataUrl = tempCanvas.toDataURL({ format: 'png' });
            const pngImage = await pdfLibDoc.embedPng(pngDataUrl);
            
            pdfLibPage.drawImage(pngImage, {
                x: 0,
                y: 0,
                width: width,
                height: height,
            });
            tempCanvas.dispose(); // Geçici canvas'ı da temizle
        }

        const pdfBytes = await pdfLibDoc.save();
        download(pdfBytes, `duzenlenmis-${fileInput.files[0].name}`, "application/pdf");

    } catch (error) {
        console.error("PDF kaydedilirken hata:", error);
        alert("PDF kaydedilirken bir hata oluştu.");
    } finally {
        showLoader(false);
    }
});


// --- Yardımcı Fonksiyonlar ---

function showLoader(show) {
    loader.style.display = show ? 'flex' : 'none';
}

function showTools(show) {
    const display = show ? 'flex' : 'none';
    document.querySelector('.navigation-tools').style.display = display;
    document.querySelector('.zoom-tools').style.display = display;
    document.querySelector('.drawing-tools').style.display = display;
    document.querySelector('.save-tools').style.display = display;
}

function download(data, filename, type) {
    const blob = new Blob([data], { type: type });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}