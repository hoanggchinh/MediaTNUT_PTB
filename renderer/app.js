let capturedPhotos = [];
let selectedFrame = null;
let selectedStickers = [];
let currentPhotoIndex = 0;
let isCapturing = false;
let currentStream = null;
let availableCameras = [];
let currentCameraIndex = 0;

// Photo positions config - exact positions in final 1850x5118 canvas
const posConfigs = [
    { x: 7, y: 88, w: 1836, h: 1276 },
    { x: 1, y: 1372, w: 1838, h: 1238 },
    { x: 7, y: 2620, w: 1830, h: 1248 },
    { x: 11, y: 3876, w: 1826, h: 1232 }
];

// DOM Elements - Match with index.html IDs
const videoElement = document.getElementById('cameraFeed');
const hiddenCanvas = document.getElementById('hiddenCanvas');
const captureBtn = document.getElementById('captureBtn');
const countdown = document.getElementById('countdown');
const switchCameraBtn = document.getElementById('switchCameraBtn');
const backBtn = document.getElementById('backBtn');

// Preview boxes
const previewBoxes = [
    document.getElementById('preview1'),
    document.getElementById('preview2'),
    document.getElementById('preview3'),
    document.getElementById('preview4')
];

// Screens
const cameraScreen = document.getElementById('cameraScreen');
const editorScreen = document.getElementById('editorScreen');
const resultScreen = document.getElementById('resultScreen');

// Editor elements
const framesList = document.getElementById('framesList');
const iconsList = document.getElementById('iconsList');
const previewPhotosGrid = document.getElementById('previewPhotosGrid');
const previewFrameOverlay = document.getElementById('previewFrameOverlay');
const previewIconsContainer = document.getElementById('previewIconsContainer');
const editorCanvas = document.getElementById('editorCanvas');
const doneBtn = document.getElementById('doneBtn');

// Preview photo elements
const previewPhotoElements = [
    document.getElementById('previewPhoto1'),
    document.getElementById('previewPhoto2'),
    document.getElementById('previewPhoto3'),
    document.getElementById('previewPhoto4')
];

// Result elements
const qrCode = document.getElementById('qrCode');
const downloadLink = document.getElementById('downloadLink');
const printBtn = document.getElementById('printBtn');
const newPhotoBtn = document.getElementById('newPhotoBtn');

// Store loaded assets
let loadedFrames = [];
let loadedIcons = [];

// Initialize camera
async function initCamera() {
    try {
        console.log('Initializing camera...');

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('getUserMedia not supported');
        }

        // Get available cameras
        const devices = await navigator.mediaDevices.enumerateDevices();
        availableCameras = devices.filter(device => device.kind === 'videoinput');

        console.log('Available cameras:', availableCameras.length);

        // Show/hide switch button
        if (availableCameras.length > 1) {
            switchCameraBtn.style.display = 'flex';
        } else {
            switchCameraBtn.style.display = 'none';
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 960 },
                aspectRatio: { ideal: 4/3 },
                deviceId: availableCameras[currentCameraIndex]?.deviceId
            }
        });

        currentStream = stream;
        videoElement.srcObject = stream;
        console.log('Camera initialized successfully');

        await videoElement.play();

    } catch (error) {
        console.error('Camera error:', error);
        alert(`Không thể truy cập camera!\nLỗi: ${error.message}`);
    }
}

// Load assets from main process
async function loadAssets() {
    try {
        const { frames, icons } = await window.electronAPI.getAssets();

        console.log('Assets received:', { frames: frames.length, icons: icons.length });

        loadedFrames = frames;
        loadedIcons = icons;

        // Render frames - preserve aspect ratio
        framesList.innerHTML = '';
        frames.forEach((frame, index) => {
            const div = document.createElement('div');
            div.className = 'frame-item';
            if (index === 0) {
                div.classList.add('selected');
                selectedFrame = frame.name;
            }

            const img = document.createElement('img');
            img.src = frame.data;
            img.alt = frame.name;

            img.onclick = () => selectFrame(frame.name, div);
            div.appendChild(img);
            framesList.appendChild(div);
        });

        // Render icons/stickers
        iconsList.innerHTML = '';
        icons.forEach(icon => {
            const div = document.createElement('div');
            div.className = 'icon-item';

            const img = document.createElement('img');
            img.src = icon.data;
            img.alt = icon.name;
            img.draggable = true;

            img.ondragstart = (e) => {
                e.dataTransfer.setData('iconName', icon.name);
            };

            div.appendChild(img);
            iconsList.appendChild(div);
        });

    } catch (error) {
        console.error('Error loading assets:', error);
    }
}

// Select frame
function selectFrame(frameName, divElement) {
    // Remove previous selection
    framesList.querySelectorAll('.frame-item').forEach(el => {
        el.classList.remove('selected');
    });

    divElement.classList.add('selected');
    selectedFrame = frameName;
    updateEditorPreview();
}

// Auto capture sequence - 4 photos with 3 second interval
async function startAutoCaptureSequence() {
    if (isCapturing) return;

    isCapturing = true;
    captureBtn.disabled = true;
    currentPhotoIndex = 0;
    capturedPhotos = [];

    // Clear preview boxes
    previewBoxes.forEach((box, i) => {
        box.innerHTML = `<span>${i + 1}</span>`;
        box.classList.remove('captured');
    });

    // Capture 4 photos
    for (let i = 0; i < 4; i++) {
        // Countdown
        for (let count = 3; count > 0; count--) {
            countdown.textContent = count;
            countdown.style.display = 'block';
            await sleep(1000);
        }

        countdown.style.display = 'none';
        capturePhoto();

        // Wait 3 seconds before next capture (except last one)
        if (i < 3) {
            await sleep(3000);
        }
    }

    isCapturing = false;

    // Go to editor after capturing all 4
    setTimeout(() => {
        goToEditor();
    }, 500);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Capture single photo
function capturePhoto() {
    const context = hiddenCanvas.getContext('2d');
    hiddenCanvas.width = videoElement.videoWidth;
    hiddenCanvas.height = videoElement.videoHeight;
    context.drawImage(videoElement, 0, 0);

    const photoData = hiddenCanvas.toDataURL('image/jpeg', 0.95);
    capturedPhotos.push(photoData);

    // Display in preview box
    const previewBox = previewBoxes[currentPhotoIndex];
    previewBox.innerHTML = '';
    previewBox.classList.add('captured');

    const img = document.createElement('img');
    img.src = photoData;
    previewBox.appendChild(img);

    currentPhotoIndex++;
}

// Go to editor
function goToEditor() {
    console.log('Going to editor...', {
        photos: capturedPhotos.length,
        selectedFrame
    });

    cameraScreen.classList.remove('active');
    editorScreen.classList.add('active');

    const previewContainer = document.querySelector('.preview-container');

    if (!previewContainer) {
        console.error('Preview container not found!');
        return;
    }

    const frameData = loadedFrames.find(f => f.name === selectedFrame);

    if (frameData) {
        const tempImg = new Image();
        tempImg.onload = () => {
            const frameWidth = tempImg.width;
            const frameHeight = tempImg.height;

            console.log('Frame dimensions:', { frameWidth, frameHeight });

            // Calculate container size to fit within max constraints
            const maxWidth = 350;
            const maxHeight = window.innerHeight - 250; // Leave space for button
            const aspectRatio = frameWidth / frameHeight;

            let containerWidth = maxWidth;
            let containerHeight = containerWidth / aspectRatio;

            // If height exceeds max, scale down based on height
            if (containerHeight > maxHeight) {
                containerHeight = maxHeight;
                containerWidth = containerHeight * aspectRatio;
            }

            // Set container dimensions
            previewContainer.style.width = `${containerWidth}px`;
            previewContainer.style.height = `${containerHeight}px`;

            console.log('Container size:', { containerWidth, containerHeight });

            // Hide all photos first
            previewPhotoElements.forEach(el => {
                el.style.display = 'none';
            });

            // Position photos according to posConfigs (scaled to percentage)
            capturedPhotos.forEach((photo, i) => {
                const config = posConfigs[i];
                const photoEl = previewPhotoElements[i];

                if (!photoEl || !config) {
                    console.warn(`Missing element or config for photo ${i}`);
                    return;
                }

                photoEl.src = photo;
                photoEl.style.display = 'block';
                photoEl.style.position = 'absolute';
                photoEl.style.left = `${(config.x / frameWidth) * 100}%`;
                photoEl.style.top = `${(config.y / frameHeight) * 100}%`;
                photoEl.style.width = `${(config.w / frameWidth) * 100}%`;
                photoEl.style.height = `${(config.h / frameHeight) * 100}%`;
                photoEl.style.objectFit = 'cover';

                console.log(`Photo ${i} positioned:`, {
                    left: photoEl.style.left,
                    top: photoEl.style.top,
                    width: photoEl.style.width,
                    height: photoEl.style.height
                });
            });

            updateEditorPreview();
        };
        tempImg.onerror = () => {
            console.error('Failed to load frame image');
        };
        tempImg.src = frameData.data;
    } else {
        console.error('Frame data not found for:', selectedFrame);
    }
}

// Update editor preview
async function updateEditorPreview() {
    // Show frame overlay
    if (selectedFrame) {
        const frameData = loadedFrames.find(f => f.name === selectedFrame);
        if (frameData) {
            previewFrameOverlay.src = frameData.data;
            previewFrameOverlay.classList.remove('hidden');
        }
    } else {
        previewFrameOverlay.classList.add('hidden');
    }

    // Update stickers
    updateStickersPreview();
}

// Setup drag and drop for preview container
function setupDragDrop() {
    const previewContainer = document.querySelector('.preview-container');

    previewContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    previewContainer.addEventListener('drop', async (e) => {
        e.preventDefault();
        const iconName = e.dataTransfer.getData('iconName');
        const iconData = loadedIcons.find(i => i.name === iconName);

        if (!iconData) return;

        const rect = previewContainer.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        selectedStickers.push({
            name: iconName,
            data: iconData.data,
            x: x,
            y: y,
            size: 32
        });

        updateStickersPreview();
    });
}

// Update stickers preview
function updateStickersPreview() {
    previewIconsContainer.innerHTML = '';

    selectedStickers.forEach((sticker, index) => {
        const stickerDiv = document.createElement('div');
        stickerDiv.className = 'placed-icon';
        stickerDiv.style.left = sticker.x + '%';
        stickerDiv.style.top = sticker.y + '%';
        stickerDiv.style.width = sticker.size + '%';

        const img = document.createElement('img');
        img.src = sticker.data;

        // Add remove button
        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = '&times;';
        removeBtn.style.position = 'absolute';
        removeBtn.style.top = '-10px';
        removeBtn.style.right = '-10px';
        removeBtn.style.width = '25px';
        removeBtn.style.height = '25px';
        removeBtn.style.borderRadius = '50%';
        removeBtn.style.border = 'none';
        removeBtn.style.background = '#EF4444';
        removeBtn.style.color = 'white';
        removeBtn.style.cursor = 'pointer';
        removeBtn.style.fontSize = '18px';
        removeBtn.style.lineHeight = '1';
        removeBtn.onclick = () => {
            selectedStickers.splice(index, 1);
            updateStickersPreview();
        };

        stickerDiv.appendChild(img);
        stickerDiv.appendChild(removeBtn);
        previewIconsContainer.appendChild(stickerDiv);
    });
}

// Process and finish
async function processAndFinish() {
    try {
        doneBtn.disabled = true;
        doneBtn.textContent = 'Đang xử lý...';

        // Get frame dimensions
        const frameData = loadedFrames.find(f => f.name === selectedFrame);
        const tempImg = new Image();

        await new Promise((resolve) => {
            tempImg.onload = resolve;
            tempImg.src = frameData.data;
        });

        const frameWidth = tempImg.width;
        const frameHeight = tempImg.height;

        // Convert percentage positions to absolute pixels
        const absoluteStickers = selectedStickers.map(sticker => ({
            name: sticker.name,
            x: (sticker.x / 100) * frameWidth - ((sticker.size / 100) * frameWidth) / 2,
            y: (sticker.y / 100) * frameHeight - ((sticker.size / 100) * frameHeight) / 2,
            size: (sticker.size / 100) * frameWidth
        }));

        const result = await window.electronAPI.processImage({
            photos: capturedPhotos,
            frameName: selectedFrame,
            stickerConfig: absoluteStickers,
            posConfigs: posConfigs
        });

        if (result.success) {
            window.processedImagePath = result.path;

            // Upload and get QR
            const uploadResult = await window.electronAPI.uploadAndGenQR(result.path);

            if (uploadResult.success) {
                qrCode.src = uploadResult.qrCode;
                downloadLink.href = uploadResult.url;
                downloadLink.textContent = uploadResult.url;

                // Show result screen
                editorScreen.classList.remove('active');
                resultScreen.classList.add('active');
            } else {
                alert('Lỗi upload: ' + uploadResult.error);
                doneBtn.disabled = false;
                doneBtn.textContent = 'Hoàn thành';
            }
        } else {
            alert('Lỗi xử lý ảnh: ' + result.error);
            doneBtn.disabled = false;
            doneBtn.textContent = 'Hoàn thành';
        }
    } catch (error) {
        console.error('Error processing:', error);
        alert('Có lỗi xảy ra!');
        doneBtn.disabled = false;
        doneBtn.textContent = 'Hoàn thành';
    }
}

// Print photo
async function printPhoto() {
    try {
        printBtn.disabled = true;
        printBtn.textContent = 'Đang in...';

        const result = await window.electronAPI.printImage(window.processedImagePath);

        if (result.success) {
            alert('In ảnh thành công!');
        } else {
            alert('Lỗi in ảnh: ' + result.error);
        }

        printBtn.disabled = false;
        printBtn.textContent = 'In ảnh';
    } catch (error) {
        console.error('Print error:', error);
        alert('Có lỗi khi in ảnh!');
        printBtn.disabled = false;
        printBtn.textContent = 'In ảnh';
    }
}

// Reset and start new photo session
function resetApp() {
    capturedPhotos = [];
    selectedStickers = [];
    currentPhotoIndex = 0;
    isCapturing = false;

    // Clear preview boxes
    previewBoxes.forEach((box, i) => {
        box.innerHTML = `<span>${i + 1}</span>`;
        box.classList.remove('captured');
    });

    // Reset screens
    resultScreen.classList.remove('active');
    editorScreen.classList.remove('active');
    cameraScreen.classList.add('active');

    captureBtn.disabled = false;

    // Reload assets to reset frame selection
    loadAssets();
}

// Switch camera
async function switchCamera() {
    if (availableCameras.length <= 1) return;

    try {
        // Stop current stream
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
        }

        // Switch to next camera
        currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 960 },
                aspectRatio: { ideal: 4/3 },
                deviceId: { exact: availableCameras[currentCameraIndex].deviceId }
            }
        });

        currentStream = stream;
        videoElement.srcObject = stream;
        await videoElement.play();

    } catch (error) {
        console.error('Switch camera error:', error);
        alert('Không thể chuyển camera!');
    }
}

// Back to camera from editor
function backToCamera() {
    selectedStickers = [];
    editorScreen.classList.remove('active');
    cameraScreen.classList.add('active');
}

// Event listeners
function setupEventListeners() {
    if (captureBtn) captureBtn.addEventListener('click', startAutoCaptureSequence);
    if (doneBtn) doneBtn.addEventListener('click', processAndFinish);
    if (printBtn) printBtn.addEventListener('click', printPhoto);
    if (newPhotoBtn) newPhotoBtn.addEventListener('click', resetApp);
    if (switchCameraBtn) switchCameraBtn.addEventListener('click', switchCamera);
    if (backBtn) backBtn.addEventListener('click', backToCamera);
}

// Initialize
console.log('Initializing app...');

// Wait for DOM to be fully loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

function init() {
    console.log('DOM loaded, initializing...');

    if (!window.electronAPI || !window.electronAPI.getAssets) {
        console.error('ERROR: window.electronAPI not exposed! Check preload.js');
        alert('Lỗi: API không khả dụng. Kiểm tra preload.js');
        return;
    }

    setupEventListeners();
    initCamera();
    loadAssets();
    setupDragDrop();
}