const { PDFDocument, rgb, StandardFonts } = PDFLib;
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

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
let fabricState = {};
let currentTool = 'select';

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
            
            currentPageNum = 1;
            fabricState = {};
            pageCountSpan.textContent = pdfDoc.numPages;
            
            await renderPage(currentPageNum);
            showTools(true);
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

    if (fabricCanvas) {
        saveFabricState();
        fabricCanvas.dispose();
        fabricCanvas = null;
    }

    editorContainer.innerHTML = '';

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: currentZoom });

    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.id = 'pdf-canvas';
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    const context = pdfCanvas.getContext('2d');

    const fabricCanvasEl = document.createElement('canvas');
    fabricCanvasEl.id = 'fabric-canvas';
    fabricCanvasEl.width = viewport.width;
    fabricCanvasEl.height = viewport.height;
    
    editorContainer.appendChild(pdfCanvas);
    editorContainer.appendChild(fabricCanvasEl);
    
    await page.render({ canvasContext: context, viewport: viewport }).promise;

    fabricCanvas = new fabric.Canvas(fabricCanvasEl, {
        isDrawingMode: false,
    });

    if (fabricState[pageNum]) {
        fabricCanvas.loadFromJSON(fabricState[pageNum], fabricCanvas.renderAll.bind(fabricCanvas));
    }

    setupFabricListeners();
    setTool(currentTool);

    pageNumSpan.textContent = pageNum;
    showLoader(false);
}

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

toolButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        toolButtons.forEach(b => b.classList.remove('active'));
        const clickedBtn = e.currentTarget;
        clickedBtn.classList.add('active');
        
        setTool(clickedBtn.dataset.tool);
    });
});

function setTool(tool) {
    if (!fabricCanvas) return;
    
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
}

function setupFabricListeners() {
    if (!fabricCanvas) return;

    fabricCanvas.off();

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
                newObject = new fabric.IText('Buraya Yazın', {
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
                setTool('select');
                toolSelectBtn.click();
                isDrawing = false;
                newObject = null;
                return;
                
            case 'arrow':
                const line = new fabric.Line([0, 0, 0, 0], { // Başlangıç 0,0 olarak ayarla
                    stroke: color,
                    strokeWidth: strokeWidth,
                });
                const arrowHead = new fabric.Triangle({
                    left: 0,
                    top: 0,
                    originX: 'center',
                    originY: 'center',
                    fill: color,
                    width: strokeWidth * 3,
                    height: strokeWidth * 3,
                    angle: 90
                });
                // Grubu tıklama pozisyonunda oluştur
                newObject = new fabric.Group([line, arrowHead], {
                    left: startPos.x,
                    top: startPos.y,
                    subTargetCheck: true,
                    selectable: true
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
        
        if (newObject) {
             fabricCanvas.add(newObject);
             fabricCanvas.renderAll();
        }
    });

    fabricCanvas.on('mouse:move', (o) => {
        if (!isDrawing || !newObject) return;
        const pos = fabricCanvas.getPointer(o.e);

        const dx = pos.x - startPos.x;
        const dy = pos.y - startPos.y;

        switch (currentTool) {
            case 'arrow':
                const line = newObject.item(0);
                const arrowHead = newObject.item(1);
                
                line.set({ x2: dx, y2: dy });
                
                const angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
                arrowHead.set({ 
                    left: dx, 
                    top: dy,
                    angle: angle
                });
                break;
            case 'rect':
            case 'highlight':
                newObject.set({
                    width: Math.abs(dx),
                    height: Math.abs(dy),
                    originX: dx < 0 ? 'right' : 'left',
                    originY: dy < 0 ? 'bottom' : 'top'
                });
                break;
            case 'circle':
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
        if (!isDrawing) return;
        
        if (newObject) {
            newObject.setCoords();
            fabricCanvas.setActiveObject(newObject);
        }
        
        isDrawing = false;
        newObject = null;
        
        setTool('select');
        toolButtons.forEach(b => b.classList.remove('active'));
        toolSelectBtn.classList.add('active');
        fabricCanvas.renderAll();
    });

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
        
    } else if (obj.type === 'path') {
        colorPicker.value = obj.get('stroke');
        strokeWidthSlider.value = obj.get('strokeWidth');
        strokeWidthGroup.style.display = 'flex';

    } else if (obj.fill && obj.opacity < 1) {
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

colorPicker.addEventListener('input', (e) => {
    const obj = fabricCanvas.getActiveObject();
    if (!obj) return;
    
    const color = e.target.value;
    
    if (obj.type === 'i-text') {
        obj.set('fill', color);
    } else if (obj.type === 'path') {
        obj.set('stroke', color);
    } else if (obj.fill && obj.opacity < 1) {
         obj.set('fill', color);
    } else if (obj.type === 'group') {
        obj._objects.forEach(item => item.set(item.type === 'line' ? 'stroke' : 'fill', color));
    } else {
        obj.set('stroke', color);
    }
    fabricCanvas.renderAll();
});

strokeWidthSlider.addEventListener('input', (e) => {
    const obj = fabricCanvas.getActiveObject();
    if (!obj) return;
    const width = parseInt(e.target.value, 10);
    
    if (obj.type === 'group') {
        obj._objects[0].set('strokeWidth', width);
        obj._objects[1].set({ width: width * 3, height: width * 3 });
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
            
            await new Promise(resolve => tempCanvas.loadFromJSON(pageData, resolve));
            
            const pngDataUrl = tempCanvas.toDataURL({ format: 'png' });
            const pngImage = await pdfLibDoc.embedPng(pngDataUrl);
            
            pdfLibPage.drawImage(pngImage, {
                x: 0,
                y: 0,
                width: width,
                height: height,
            });
            tempCanvas.dispose();
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