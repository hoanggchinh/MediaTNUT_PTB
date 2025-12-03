const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const QRCode = require('qrcode');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { exec } = require('child_process');
require('dotenv').config();

// Cloudflare R2 Client
const s3Client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
});

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        fullscreen: true, //false, // Set true nếu muốn fullscreen
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            enableRemoteModule: false
        }
    });

    mainWindow.loadFile('renderer/index.html');

    // Open DevTools để debug
    //mainWindow.webContents.openDevTools();
    mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC Handlers
ipcMain.handle('get-assets', async () => {
    try {
        const framesPath = path.join(__dirname, 'assets', 'frames');
        const iconsPath = path.join(__dirname, 'assets', 'icons');

        console.log('Loading assets from:', { framesPath, iconsPath });

        let frames = [];
        let icons = [];

        try {
            const frameFiles = await fs.readdir(framesPath);

            // Đọc và convert sang base64
            for (const file of frameFiles) {
                if (file.match(/\.(png|jpg|jpeg)$/i)) {
                    const filePath = path.join(framesPath, file);
                    const buffer = await fs.readFile(filePath);
                    const base64 = buffer.toString('base64');
                    const ext = path.extname(file).toLowerCase();
                    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

                    frames.push({
                        name: file,
                        data: `data:${mimeType};base64,${base64}`
                    });
                }
            }
            console.log('Frames loaded:', frames.length);
        } catch (e) {
            console.log('Frames folder error:', e.message);
        }

        try {
            const iconFiles = await fs.readdir(iconsPath);

            // Đọc và convert sang base64
            for (const file of iconFiles) {
                if (file.match(/\.(png|jpg|jpeg)$/i)) {
                    const filePath = path.join(iconsPath, file);
                    const buffer = await fs.readFile(filePath);
                    const base64 = buffer.toString('base64');
                    const ext = path.extname(file).toLowerCase();
                    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

                    icons.push({
                        name: file,
                        data: `data:${mimeType};base64,${base64}`
                    });
                }
            }
            console.log('Icons loaded:', icons.length);
        } catch (e) {
            console.log('Icons folder error:', e.message);
        }

        return { frames, icons };
    } catch (error) {
        console.error('Error loading assets:', error);
        return { frames: [], icons: [] };
    }
});

ipcMain.handle('process-image', async (event, data) => {
    try {
        const { photos, frameName, stickerConfig, posConfigs } = data;
        const tempDir = path.join(__dirname, 'temp');

        await fs.mkdir(tempDir, { recursive: true });

        // Load frame - keep original dimensions
        const framePath = path.join(__dirname, 'assets', 'frames', frameName);
        const frameImage = sharp(framePath);
        const frameMetadata = await frameImage.metadata();

        const canvasWidth = frameMetadata.width;   // Giữ nguyên kích thước frame
        const canvasHeight = frameMetadata.height;

        console.log(`Canvas size from frame: ${canvasWidth}x${canvasHeight}`);

        // Create base canvas with white background
        let canvas = sharp({
            create: {
                width: canvasWidth,
                height: canvasHeight,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 1 }
            }
        });

        const composites = [];

        // Add photos according to posConfigs
        for (let i = 0; i < photos.length && i < 4; i++) {
            const photoBuffer = Buffer.from(photos[i].split(',')[1], 'base64');
            const config = posConfigs[i];

            const resized = await sharp(photoBuffer)
                .resize(config.w, config.h, {
                    fit: 'cover',
                    position: 'center'
                })
                .toBuffer();

            composites.push({
                input: resized,
                top: config.y,
                left: config.x
            });
        }

        // Add frame overlay (keep original size)
        if (frameName) {
            const frameBuffer = await frameImage.toBuffer();
            composites.push({
                input: frameBuffer,
                top: 0,
                left: 0
            });
        }

        // Add stickers
        if (stickerConfig && stickerConfig.length > 0) {
            for (const sticker of stickerConfig) {
                const stickerPath = path.join(__dirname, 'assets', 'icons', sticker.name);
                const stickerBuffer = await sharp(stickerPath)
                    .resize(Math.round(sticker.size), Math.round(sticker.size))
                    .toBuffer();
                composites.push({
                    input: stickerBuffer,
                    top: Math.round(sticker.y),
                    left: Math.round(sticker.x)
                });
            }
        }

        const finalImage = await canvas.composite(composites).jpeg({ quality: 95 }).toBuffer();
        const outputPath = path.join(tempDir, `photo_${Date.now()}.jpg`);
        await fs.writeFile(outputPath, finalImage);

        console.log(`Image processed and saved to: ${outputPath}`);

        return { success: true, path: outputPath, width: canvasWidth, height: canvasHeight };
    } catch (error) {
        console.error('Error processing image:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('upload-and-qr', async (event, imagePath) => {
    try {
        const imageBuffer = await fs.readFile(imagePath);
        const fileName = `${Date.now()}_${path.basename(imagePath)}`;

        // Upload to R2
        const command = new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: fileName,
            Body: imageBuffer,
            ContentType: 'image/jpeg'
        });

        await s3Client.send(command);

        // Generate public URL
        const publicUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;

        // Generate QR code
        const qrCodeDataUrl = await QRCode.toDataURL(publicUrl, {
            width: 300,
            margin: 2
        });

        return {
            success: true,
            url: publicUrl,
            qrCode: qrCodeDataUrl,
            fileName: fileName
        };
    } catch (error) {
        console.error('Error uploading to R2:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('print-image', async (event, imagePath) => {
    try {
        const printerName = process.env.PRINTER_NAME;

        return new Promise((resolve, reject) => {
            // Windows print command
            const printCommand = process.platform === 'win32'
                ? `powershell -Command "& {Add-Type -AssemblyName System.Drawing; $img = [System.Drawing.Image]::FromFile('${imagePath}'); $printDoc = New-Object System.Drawing.Printing.PrintDocument; $printDoc.PrinterSettings.PrinterName = '${printerName}'; $printDoc.add_PrintPage({$_.Graphics.DrawImage($img, 0, 0)}); $printDoc.Print(); $img.Dispose()}"`
                : `lp -d ${printerName} "${imagePath}"`;

            exec(printCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error('Print error:', error);
                    resolve({ success: false, error: error.message });
                } else {
                    resolve({ success: true });
                }
            });
        });
    } catch (error) {
        console.error('Error printing:', error);
        return { success: false, error: error.message };
    }
});