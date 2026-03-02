const predefinedImages = [
  "vi.png",
];
const imageList = document.getElementById("image-list");
const imageUpload = document.getElementById("imageUpload");
const previewImg = document.getElementById("preview");
let selectedImageData = null;  // Uint8Array of image bytes after resize

window.onload = () => {
  predefinedImages.forEach((url, i) => {
    const thumb = document.createElement("img");
    thumb.className = "thumbnail";
    thumb.src = url;
    thumb.dataset.index = i;
    thumb.onclick = async () => {
      document.querySelectorAll(".thumbnail").forEach(el => el.classList.remove("selected"));
      thumb.classList.add("selected");

      try {
        const result = await processImageTo80x160_565(url);
        selectedImageData = result.as_565;
        previewImg.src = URL.createObjectURL(new Blob([result.as_png], {type: "image/png"}));
        previewImg.style.display = "block";
        checkSendBtn();
      } catch (err) {
        setStatus("Failed to process image: " + err);
      }
    };
    imageList.appendChild(thumb);
  });
}

function rgbToRgb565(r, g, b) {
    const red = r >> 3;
    const green = g >> 2;
    const blue = b >> 3;
    return (red << 11) | (green << 5) | blue;
}

imageUpload.onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  // Clear any previous selection
  document.querySelectorAll(".thumbnail").forEach(el => el.classList.remove("selected"));

  try {
    setStatus("Processing image...");

    const result = await processImageTo80x160_565(file);
    selectedImageData = result.as_565;

    const resizedBlob = new Blob([result.as_png], { type: "image/png" });
    previewImg.src = URL.createObjectURL(resizedBlob);
    previewImg.style.display = "block";

    // Optional: clean up old object URL if you change images multiple times
    // (not strictly needed in most cases, browser cleans up on navigation)
    // if (window.lastObjectUrl) URL.revokeObjectURL(window.lastObjectUrl);
    // window.lastObjectUrl = objectUrl;

    checkSendBtn();
    setStatus("Image ready to send");
  } catch (err) {
    console.error(err);
    setStatus("Failed to load or process image: " + (err.message || err));
    previewImg.style.display = "none";
  }
};

async function processImageTo80x160_565(fileOrUrl) {
  /* Scales image, converts to RGB565 format (for device)
     and PNG (for thumbnail) */
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // needed if using external URLs

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 80;
      canvas.height = 160;

      const ctx = canvas.getContext("2d");

      // --- Center crop logic ---
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
      ctx.imageSmoothingQuality = "high";   // best quality (most browsers)

      ctx.drawImage(
        img,
        sourceX, sourceY, sourceW, sourceH,   // source rect
        0, 0, 80, 160                         // destination = exact size
      );

      // First, convert to RGB565
      // https://longfangsong.github.io/en/image-to-rgb565/
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
      }, "image/png", 0.92);   // or "image/jpeg", 0.85 if you prefer smaller size
    };

    img.onerror = reject;
    if (typeof fileOrUrl === "string") {
      // Remote URL or data URL
      img.src = fileOrUrl;
    } else if (fileOrUrl instanceof Blob || fileOrUrl instanceof File) {
      // Local File or Blob → create temporary object URL
      const objectUrl = URL.createObjectURL(fileOrUrl);
      img.src = objectUrl;
      // FIXME should clean this up with URL.revokeObjectURL when done
    } else {
      reject(new Error("Unsupported source type: must be string URL or File/Blob"));
    }
  });
}