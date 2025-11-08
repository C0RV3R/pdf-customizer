// Gerekli kütüphaneleri ve DOM elementlerini seç
const { PDFDocument, rgb } = PDFLib; 
const pdfjsLib = window['pdfjs-dist/build/pdf']; 

// PDF.js worker yolunu ayarlayın (zorunlu)
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// DOM Elementleri
const fileInput = document.getElementById('file-input');
const downloadBtn = document.getElementById('download-pdf');
const addTextBtn = document.getElementById('add-text');
const addLineBtn = document.getElementById('add-line');
const drawModeBtn = document.getElementById('draw-mode');
const editorContainer = document.getElementById('editor-container');

// Ayar elementleri
const contextOptions = document.getElementById('context-options');
const colorPicker = document.getElementById('color-picker');
const fontSizeInput = document.getElementById('font-size');
const strokeWidthInput = document.getElementById('stroke-width');
const deleteBtn = document.getElementById('delete-obj');

// Global Değişkenler
let fabricCanvas = null; 
let pdfDoc = null; 
let originalPdfBytes = null; 
const PAGE_TO_RENDER = 1; 

// --- Adım 1: PDF Yükle ve Görüntüle (PDF.js) ---

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || file.type !== 'application/pdf') {
        alert('Lütfen geçerli bir PDF dosyası seçin.');
        return;
    }
    
    editorContainer.innerHTML = 'PDF yükleniyor ve işleniyor...';
    
    const fileReader = new FileReader();
    
    fileReader.onload = async function() {
        try {
            originalPdfBytes = this.result; 
            
            const loadingTask = pdfjsLib.getDocument({ data: originalPdfBytes });
            pdfDoc = await loadingTask.promise;
            
            await renderPage(PAGE_TO_RENDER);

        } catch (error) {
            console.error("PDF yükleme hatası:", error);
            editorContainer.innerHTML = 'PDF yüklenirken bir hata oluştu.';
        }
    };
    
    fileReader.readAsArrayBuffer(file);
});

async function renderPage(pageNum) {
    editorContainer.innerHTML = ''; 

    const page = await pdfDoc.getPage(pageNum);
    const scale = 1.5; 
    const viewport = page.getViewport({ scale: scale });

    // 1. Alt Katman: PDF Canvas'ı
    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.id = 'pdf-canvas';
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    const context = pdfCanvas.getContext('2d');
    
    // 2. Üst Katman: Düzenleme Canvas'ı (Fabric.js)
    const fabricCanvasEl = document.createElement('canvas');
    fabricCanvasEl.id = 'fabric-canvas';
    fabricCanvasEl.width = viewport.width;
    fabricCanvasEl.height = viewport.height;
    
    // Canvas'ları container'a ekle
    editorContainer.appendChild(pdfCanvas);
    editorContainer.appendChild(fabricCanvasEl); 
    
    // PDF sayfasını alt katmana çiz
    await page.render({ canvasContext: context, viewport: viewport }).promise;

    // Fabric.js'yi üst katmanda başlat
    initializeFabric(fabricCanvasEl, viewport.width, viewport.height);
}

// --- Adım 2: Etkileşimli Düzenleme Katmanı (Fabric.js) ---

function initializeFabric(canvasEl, width, height) {
    if (fabricCanvas) {
        fabricCanvas.dispose();
    }
    
    fabricCanvas = new fabric.Canvas(canvasEl, {
        width: width,
        height: height,
        selection: true 
    });
    
    // Event listener'lar
    fabricCanvas.on('selection:created', (e) => showContextOptions(e.target));
    fabricCanvas.on('selection:updated', (e) => showContextOptions(e.target));
    fabricCanvas.on('selection:cleared', () => {
        contextOptions.style.display = 'none';
        fabricCanvas.isDrawingMode = false;
        drawModeBtn.textContent = '✍️ Serbest Çizim';
    });

    // Çizim modu ayarlarını bağlama
    colorPicker.addEventListener('input', () => {
        if (fabricCanvas && fabricCanvas.isDrawingMode) {
            fabricCanvas.freeDrawingBrush.color = colorPicker.value;
        }
    });
    strokeWidthInput.addEventListener('input', () => {
        if (fabricCanvas && fabricCanvas.isDrawingMode) {
            fabricCanvas.freeDrawingBrush.width = parseInt(strokeWidthInput.value, 10);
        }
    });
}

// --- Adım 3: Araç Çubuğu Fonksiyonları (Kullanıcı İşlemleri) ---

// Metin Ekle
addTextBtn.addEventListener('click', () => {
    if (!fabricCanvas) return;
    fabricCanvas.isDrawingMode = false;
    drawModeBtn.textContent = '✍️ Serbest Çizim';
    
    const text = new fabric.IText('Yeni Metin', {
        left: 100,
        top: 100,
        fill: colorPicker.value,
        fontSize: parseInt(fontSizeInput.value, 10),
        fontFamily: 'Arial',
        padding: 5, 
        borderColor: 'red'
    });
    
    fabricCanvas.add(text);
    fabricCanvas.setActiveObject(text);
});

// Çizgi Ekle
addLineBtn.addEventListener('click', () => {
    if (!fabricCanvas) return;
    fabricCanvas.isDrawingMode = false;
    drawModeBtn.textContent = '✍️ Serbest Çizim';

    const line = new fabric.Line([50, 50, 200, 50], {
        left: 100,
        top: 150,
        stroke: colorPicker.value,
        strokeWidth: parseInt(strokeWidthInput.value, 10),
    });
    fabricCanvas.add(line);
    fabricCanvas.setActiveObject(line);
});

// Serbest Çizim Modunu Aç/Kapat
drawModeBtn.addEventListener('click', () => {
    if (!fabricCanvas) return;

    fabricCanvas.isDrawingMode = !fabricCanvas.isDrawingMode;
    
    if (fabricCanvas.isDrawingMode) {
        drawModeBtn.textContent = '⛔ Çizimi Kapat';
        fabricCanvas.freeDrawingBrush.width = parseInt(strokeWidthInput.value, 10);
        fabricCanvas.freeDrawingBrush.color = colorPicker.value;
    } else {
        drawModeBtn.textContent = '✍️ Serbest Çizim';
    }
});

// Seçili objenin ayarlarını menüye yansıt
function showContextOptions(obj) {
    contextOptions.style.display = 'flex';
    
    colorPicker.value = obj.get('fill') || obj.get('stroke') || '#000000';
    
    const isText = obj.type === 'i-text';
    const isLineOrPath = obj.type === 'line' || obj.type === 'path';

    // Font Boyutu
    fontSizeInput.parentElement.style.display = isText ? 'inline-block' : 'none';
    if (isText) {
        fontSizeInput.value = obj.get('fontSize');
    }

    // Çizgi Kalınlığı
    strokeWidthInput.parentElement.style.display = isLineOrPath ? 'inline-block' : 'none';
    if (isLineOrPath) {
        strokeWidthInput.value = obj.get('strokeWidth') || 3;
    }
}

// Ayarları seçili objeye uygula (input eventleri)
colorPicker.addEventListener('input', (e) => {
    const obj = fabricCanvas.getActiveObject();
    if (obj) {
        if (obj.type === 'i-text') {
            obj.set('fill', e.target.value);
        } else {
            obj.set('stroke', e.target.value);
        }
        fabricCanvas.renderAll();
    }
});

fontSizeInput.addEventListener('input', (e) => {
    const obj = fabricCanvas.getActiveObject();
    if (obj && obj.type === 'i-text') {
        obj.set('fontSize', parseInt(e.target.value, 10));
        obj.setCoords(); 
        fabricCanvas.renderAll();
    }
});

strokeWidthInput.addEventListener('input', (e) => {
    const obj = fabricCanvas.getActiveObject();
    if (obj && (obj.type === 'line' || obj.type === 'path')) {
        obj.set('strokeWidth', parseInt(e.target.value, 10));
        fabricCanvas.renderAll();
    }
});

// Sil Butonu
deleteBtn.addEventListener('click', () => {
    const obj = fabricCanvas.getActiveObject();
    if (obj) {
        fabricCanvas.remove(obj);
        contextOptions.style.display = 'none';
    }
});


// --- Adım 4: Kaydetme ve İndirme (pdf-lib) ---

downloadBtn.addEventListener('click', async () => {
    if (!pdfDoc || !fabricCanvas) {
        alert("Lütfen önce bir PDF yükleyin.");
        return;
    }

    const pdfLibDoc = await PDFDocument.load(originalPdfBytes);
    const pages = pdfLibDoc.getPages();
    const firstPage = pages[PAGE_TO_RENDER - 1];
    const { width, height } = firstPage.getSize();
    
    const fabricObjects = fabricCanvas.getObjects();

    for (const obj of fabricObjects) {
        
        // Renk dönüştürme
        const hexColor = obj.get('fill') || obj.get('stroke');
        const pdfColor = hexToRgb(hexColor);
        
        if (obj.type === 'i-text') {
            // Metin koordinatları ve boyutu
            // PDF-lib'de metin tabanı baz alındığı için ince ayar yapılır.
            
            firstPage.drawText(obj.text, {
                x: obj.left,
                y: height - (obj.top + (obj.height * obj.scaleY * 0.7)), 
                size: obj.fontSize * obj.scaleY,
                color: rgb(pdfColor.r, pdfColor.g, pdfColor.b),
            });
        } else if (obj.type === 'line') {
            // Basit Çizgi Kaydı
            firstPage.drawLine({
                start: { x: obj.left, y: height - (obj.top) },
                end: { x: obj.left + obj.getScaledWidth(), y: height - (obj.top + obj.getScaledHeight()) },
                thickness: obj.strokeWidth * obj.scaleX, 
                color: rgb(pdfColor.r, pdfColor.g, pdfColor.b),
            });
        }
        // * Serbest çizim (path) kaydı karmaşıklık nedeniyle desteklenmez.
    }

    const pdfBytes = await pdfLibDoc.save();
    download(pdfBytes, "duzenlenmis_pdf.pdf", "application/pdf");
});


// --- Yardımcı Fonksiyonlar ---

function hexToRgb(hex) {
    hex = hex.replace(/^#/, '');

    let r = 0, g = 0, b = 0;
    if (hex.length == 3) { 
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length == 6) { 
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
    }
    return { r: r / 255, g: g / 255, b: b / 255 };
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