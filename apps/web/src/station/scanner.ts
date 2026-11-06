import jsQR from "jsqr";

/** Reads QR codes from a video element. */
export interface QrScanner {
  start(video: HTMLVideoElement | null, onCode: (text: string) => void): void;
  stop(): void;
}

/** jsQR on downscaled frames, ~4 times per second. */
export function createJsQrScanner(): QrScanner {
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    start(video, onCode) {
      if (!video) return;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let last = "";
      timer = setInterval(() => {
        if (!ctx || video.readyState < 2) return;
        const scale = Math.min(1, 800 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (code?.data && code.data !== last) {
          last = code.data;
          onCode(code.data);
        }
      }, 250);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
