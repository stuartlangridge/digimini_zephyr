function rgbToRgb565(r, g, b) {
    const red = r >> 3;
    const green = g >> 2;
    const blue = b >> 3;
    return (red << 11) | (green << 5) | blue;
}

function convertDataURL(dataURL) {
    return new Promise((resolve, reject) => {
        // write the image into a canvas to make it 80x160
        const img = new Image();
        // img.crossOrigin = "anonymous"; // needed if using external URLs
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = 80; canvas.height = 160;
            const ctx = canvas.getContext("2d");
            let sourceX = 0, sourceY = 0;
            let sourceW = img.width;
            let sourceH = img.height;
            const targetRatio = 80 / 160;           // 0.5
            const inputRatio  = img.width / img.height;
            if (inputRatio > targetRatio) {
                // image wider than needed → crop sides
                sourceW = img.height * targetRatio;
                sourceX = (img.width - sourceW) / 2;
            } else {
                // image taller → crop top/bottom
                sourceH = img.width / targetRatio;
                sourceY = (img.height - sourceH) / 2;
            }
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(
                img,
                sourceX, sourceY, sourceW, sourceH,   // source rect
                0, 0, 80, 160                         // destination = exact size
            );

            // read the data as 565 and return both png and 565
            let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let rgb565Data = new ArrayBuffer(imgData.length / 4 * 2);
            let rgb565view = new DataView(rgb565Data);
            for (let i = 0; i < imgData.length; i += 4) {
                const r = imgData[i];
                const g = imgData[i + 1];
                const b = imgData[i + 2];
                rgb565view.setUint16(i / 4 * 2, rgbToRgb565(r, g, b), true);
            }
            // and now to blob
            canvas.toBlob((blob) => {
                if (!blob) return reject("Cannot create blob");
                blob.arrayBuffer().then(buf => {
                    const as_png = new Uint8Array(buf)
                    resolve({as_png, as_565: rgb565view});
                });
            }, "image/png", 0.92);
        }
        // and load the passed image to start the conversion
        img.onerror = reject;
        img.src = dataURL;
    });

}
