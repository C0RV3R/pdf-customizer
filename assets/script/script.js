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
        originalPdfBytes = new Uint8Array(this.result);
        
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

    // Önceki sayfadaysak, o sayfanın durumunu kaydet
    if (fabricCanvas) {
        saveFabricState();
    }

    // PDF sayfasını al
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: currentZoom });

    // Container'ı temizle
    editorContainer.innerHTML = '';
    
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
    
    // Canvas'ları container'a ekle (DOM sırası önemli değil, CSS halleder)
    editorContainer.appendChild(pdfCanvas);
    editorContainer.appendChild(fabricCanvasEl);
    
    // PDF'i alt katmana çiz
    await page.render({ canvasContext: context, viewport: viewport }).promise;

    // Fabric.js'yi üst katmanda başlat
    fabricCanvas = new fabric.Canvas(fabricCanvasEl, {
        isDrawingMode: false,
    });
    
    // Bu sayfanın kayıtlı bir durumu varsa yükle
    if (fabricState[pageNum]) {
        fabricCanvas.loadFromJSON(fabricState[pageNum], fabricCanvas.renderAll.bind(fabricCanvas));
    }

    // Fabric event'lerini ayarla
    setupFabricListeners();
    // Aktif aracı ayarla (örn: kalem modu açıksa)
    setTool(currentTool);

    // UI Güncelle
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
        // Aktif butonu güncelle
        toolButtons.forEach(b => b.classList.remove('active'));
        const clickedBtn = e.currentTarget;
        clickedBtn.classList.add('active');
        
        // Aracı ayarla
        currentTool = clickedBtn.dataset.tool;
        setTool(currentTool);
    });
});

function setTool(tool) {
    if (!fabricCanvas) return;
    
    fabricCanvas.isDrawingMode = false; // Önce tüm modları kapat
    fabricCanvas.selection = true; // Seçime izin ver
    fabricCanvas.defaultCursor = 'default';

    switch (tool) {
        case 'select':
            // Zaten varsayılan bu
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
    fabricCanvas.off('mouse:down'); // Eski listener'ları temizle
    fabricCanvas.off('mouse:up');
    
    let isDrawing = false;
    let startPos = { x: 0, y: 0 };
    let newObject = null;

    fabricCanvas.on('mouse:down', (o) => {
        if (!['text', 'arrow', 'rect', 'circle', 'highlight'].includes(currentTool)) {
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
                    fontFamily: 'Arial'
                });
                break;
            case 'arrow':
                // Ok, bir çizgi ve bir üçgenden oluşan bir gruptur
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
                });
                break;
            case 'highlight':
                newObject = new fabric.Rect({
                    left: startPos.x,
                    top: startPos.y,
                    width: 0,
                    height: 0,
                    fill: color, // Vurgulayıcıda dolgu rengi kullanılır
                    opacity: 0.4, // Yarı saydam
                    strokeWidth: 0,
                });
                break;
        }
        
        if (newObject && currentTool !== 'text') { // Metin anında eklenir
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
                    width: pos.x - startPos.x,
                    height: pos.y - startPos.y,
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
        if (isDrawing && newObject) {
            if(currentTool === 'text') {
                 fabricCanvas.add(newObject);
            }
            newObject.setCoords(); // Koordinatları güncelle
            fabricCanvas.setActiveObject(newObject);
            isDrawing = false;
            newObject = null;
            // İş bittikten sonra seçim aracına geri dön
            setTool('select');
            toolSelectBtn.click();
        }
    });

    // --- 4. Bağlamsal Araç Çubuğu (Context Toolbar) ---
    fabricCanvas.on('selection:created', (e) => updateContextToolbar(e.target));
    fabricCanvas.on('selection:updated', (e) => updateContextToolbar(e.target));
    fabricCanvas.on('selection:cleared', () => contextToolbar.style.display = 'none');
}

function updateContextToolbar(obj) {
    if (!obj) return;
    contextToolbar.style.display = 'flex';

    // Varsayılan olarak tüm ayar gruplarını gizle
    strokeWidthGroup.style.display = 'none';
    fontSizeGroup.style.display = 'none';
    opacityGroup.style.display = 'none';
    
    // Obje tipine göre ayarları göster
    if (obj.type === 'i-text') {
        colorPicker.value = obj.get('fill');
        fontSizeInput.value = obj.get('fontSize');
        fontSizeGroup.style.display = 'flex';
        
    } else if (obj.type === 'path' || obj.type === 'rect' || obj.type === 'circle' || obj.type === 'line' || obj.type === 'group') {
        // 'group' (ok) veya diğer şekiller
        const stroke = obj.get('stroke') || (obj._objects && obj._objects[0].get('stroke'));
        const fill = obj.get('fill') || (obj._objects && obj._objects[0].get('fill'));
        const strokeW = obj.get('strokeWidth') || (obj._objects && obj._objects[0].get('strokeWidth'));
        
        colorPicker.value = fill === 'transparent' ? stroke : fill;
        
        if (obj.get('opacity') && obj.get('opacity') < 1) { // Vurgulayıcı
            opacitySlider.value = obj.get('opacity');
            opacityGroup.style.display = 'flex';
        } else {
            strokeWidthSlider.value = strokeW || 5;
            strokeWidthGroup.style.display = 'flex';
        }
    }
}

// Bağlamsal araç çubuğu event'leri
colorPicker.addEventListener('input', (e) => {
    const obj = fabricCanvas.getActiveObject();
    if (!obj) return;
    
    const color = e.target.value;
    
    if (obj.type === 'i-text') {
        obj.set('fill', color);
    } else if (obj.get('opacity') && obj.get('opacity') < 1) { // Vurgulayıcı
         obj.set('fill', color);
    } else if (obj.type === 'group') { // Ok (grup)
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

    // Son sayfayı da kaydet
    saveFabricState();
    
    try {
        // Orijinal PDF'i pdf-lib ile yükle
        const pdfLibDoc = await PDFDocument.load(originalPdfBytes);
        const pages = pdfLibDoc.getPages();
        
        // Fontları göm (metin eklendiyse gerekir)
        const helveticaFont = await pdfLibDoc.embedFont(StandardFonts.Helvetica);
        
        // Her sayfayı işle
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const pageData = fabricState[i];
            if (!pageData) continue; // Bu sayfada düzenleme yok

            const pdfLibPage = pages[i - 1]; // pdf-lib 0-indeksli
            const { width, height } = pdfLibPage.getSize();
            
            // Çizimleri PNG olarak overlay etme (En Sağlam Yöntem)
            
            // 1. Geçici bir Fabric canvas oluştur
            const tempCanvas = new fabric.StaticCanvas(null, { width, height });
            
            // 2. O sayfanın durumunu bu geçici canvas'a yükle
            await new Promise(resolve => tempCanvas.loadFromJSON(pageData, resolve));
            
            // 3. Canvas'ı PNG data URL'ine dönüştür
            const pngDataUrl = tempCanvas.toDataURL({ format: 'png' });
            
            // 4. PNG resmini PDF'e göm
            const pngImage = await pdfLibDoc.embedPng(pngDataUrl);
            
            // 5. PNG resmini sayfanın tam üzerine çiz
            pdfLibPage.drawImage(pngImage, {
                x: 0,
                y: 0,
                width: width,
                height: height,
            });
            
            // (Alternatif - Metinleri ayrı işlemek): Bu daha karmaşıktır
            // ama metinlerin seçilebilir kalmasını sağlar.
            // Şimdilik PNG overlay daha garantidir.
        }

        // 6. Yeni PDF dosyasını oluştur
        const pdfBytes = await pdfLibDoc.save();

        // 7. Kullanıcıya indir
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

// Dosya indirme fonksiyonu
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