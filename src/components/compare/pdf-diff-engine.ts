import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export type DiffBox = {
  id: string;
  x: number; // Percentage 0 - 100%
  y: number; // Percentage 0 - 100%
  width: number; // Percentage 0 - 100%
  height: number; // Percentage 0 - 100%
  type: "added" | "deleted" | "modified";
  text?: string;
};

export type TextDiffToken = {
  type: "equal" | "added" | "deleted";
  text: string;
};

export type PageComparison = {
  pageNumber: number;
  hasDoc1: boolean;
  hasDoc2: boolean;
  diffsDoc1: DiffBox[];
  diffsDoc2: DiffBox[];
  textDiffs: TextDiffToken[];
  totalDiffs: number;
};

export type ComparisonResult = {
  file1Name: string;
  file2Name: string;
  doc1Pages: number;
  doc2Pages: number;
  totalPages: number;
  totalDifferences: number;
  totalAdditions: number;
  totalDeletions: number;
  pages: PageComparison[];
};

export type WordWithBounds = {
  word: string;
  normalized: string;
  x: number; // percentage of viewport width
  y: number; // percentage of viewport height
  width: number; // percentage of viewport width
  height: number; // percentage of viewport height
};

/**
 * Extract individual words with their accurate geometric bounding boxes from a PDF page.
 * Words are sorted in reading order (top-to-bottom, left-to-right).
 */
async function extractPageWords(page: PDFPageProxy): Promise<WordWithBounds[]> {
  const viewport = page.getViewport({ scale: 1.0 });
  const textContent = await page.getTextContent();
  const words: WordWithBounds[] = [];

  for (const item of textContent.items) {
    if (!("str" in item) || !item.str) continue;
    const str = item.str;
    if (!str.trim()) continue;

    // Transform matrix: [scaleX, skewY, skewX, scaleY, tx, ty]
    const tx = item.transform[4];
    const ty = item.transform[5];
    const totalWidth = item.width;
    const fontHeight = item.height || Math.hypot(item.transform[0], item.transform[1]) || 12;

    // In PDF coordinates, (0,0) is bottom-left; in DOM/Canvas, (0,0) is top-left
    const padY = fontHeight * 0.1;
    const boxHeight = fontHeight * 1.15;
    const domY = viewport.height - ty - fontHeight - padY * 0.5;

    // Extract individual words using whitespace regex
    const regex = /\S+/g;
    let match: RegExpExecArray | null;
    const strLen = Math.max(str.length, 1);

    while ((match = regex.exec(str)) !== null) {
      const word = match[0];
      const charIndex = match.index;
      const wordLen = word.length;

      // Calculate proportional horizontal offset and width of the word within the text item
      const wordX = tx + (charIndex / strLen) * totalWidth;
      const wordWidth = Math.max((wordLen / strLen) * totalWidth, 3);

      const pctX = (wordX / viewport.width) * 100;
      const pctY = Math.max(0, (domY / viewport.height) * 100);
      const pctWidth = (wordWidth / viewport.width) * 100;
      const pctHeight = (boxHeight / viewport.height) * 100;

      // Normalized word: alphanumeric lowercased without surrounding punctuation for matching
      const normalized = word.toLowerCase().replace(/^[^\w\d]+|[^\w\d]+$/g, "");

      words.push({
        word,
        normalized: normalized || word.toLowerCase(),
        x: Math.max(0, pctX),
        y: pctY,
        width: Math.min(100 - pctX, pctWidth),
        height: Math.min(100 - pctY, pctHeight),
      });
    }
  }

  // Sort in natural reading order: lines first, then columns
  words.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 0.8) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });

  return words;
}

/**
 * Merge adjacent changed word boxes on the SAME line into continuous highlight rectangles.
 * This prevents fragmented individual word boxes while strictly ensuring different lines
 * or paragraphs never merge into a giant block.
 */
function mergeLineBoxes(boxes: DiffBox[]): DiffBox[] {
  if (boxes.length <= 1) return boxes;

  const sorted = [...boxes].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 0.8) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });

  const merged: DiffBox[] = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];

    // Same line: Y difference is small (< 0.85%) and height difference is small (< 1.2%)
    const sameLine =
      Math.abs(current.y - next.y) < 0.85 &&
      Math.abs(current.height - next.height) < 1.2;

    // Adjacent: horizontally nearby within 2.2% gap (typical space between words)
    const adjacent =
      next.x >= current.x &&
      (next.x - (current.x + current.width)) <= 2.2;

    if (sameLine && adjacent) {
      const rightEdge = Math.max(current.x + current.width, next.x + next.width);
      current.width = rightEdge - current.x;
      current.height = Math.max(current.height, next.height);
      current.text = [current.text, next.text].filter(Boolean).join(" ");
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);

  return merged;
}

/**
 * High-performance word-level LCS diff algorithm with common prefix/suffix pruning.
 * Highlights ONLY changed text with exact word bounding boxes.
 */
function computeTextDiff(
  words1: WordWithBounds[],
  words2: WordWithBounds[]
): { diffs1: DiffBox[]; diffs2: DiffBox[]; textDiffs: TextDiffToken[] } {
  const n1 = words1.length;
  const n2 = words2.length;

  // 1. Fast match common prefix
  let start = 0;
  while (
    start < n1 &&
    start < n2 &&
    words1[start].normalized === words2[start].normalized
  ) {
    start++;
  }

  // 2. Fast match common suffix
  let end1 = n1 - 1;
  let end2 = n2 - 1;
  while (
    end1 >= start &&
    end2 >= start &&
    words1[end1].normalized === words2[end2].normalized
  ) {
    end1--;
    end2--;
  }

  const prefixDiffs: TextDiffToken[] = [];
  for (let i = 0; i < start; i++) {
    prefixDiffs.push({ type: "equal", text: words1[i].word });
  }

  const suffixDiffs: TextDiffToken[] = [];
  for (let i = end1 + 1; i < n1; i++) {
    suffixDiffs.push({ type: "equal", text: words1[i].word });
  }

  // 3. Middle slice where actual changes exist
  const mid1 = words1.slice(start, end1 + 1);
  const mid2 = words2.slice(start, end2 + 1);
  const m = mid1.length;
  const n = mid2.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (mid1[i - 1].normalized === mid2[j - 1].normalized) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const midDiffs: TextDiffToken[] = [];
  const deletedBoxes: DiffBox[] = [];
  const addedBoxes: DiffBox[] = [];

  let i = m;
  let j = n;
  let boxId = 0;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && mid1[i - 1].normalized === mid2[j - 1].normalized) {
      midDiffs.unshift({ type: "equal", text: mid1[i - 1].word });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      const w2 = mid2[j - 1];
      midDiffs.unshift({ type: "added", text: w2.word });
      addedBoxes.unshift({
        id: `diff-add-${boxId++}`,
        x: w2.x,
        y: w2.y,
        width: w2.width,
        height: w2.height,
        type: "added",
        text: w2.word,
      });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      const w1 = mid1[i - 1];
      midDiffs.unshift({ type: "deleted", text: w1.word });
      deletedBoxes.unshift({
        id: `diff-del-${boxId++}`,
        x: w1.x,
        y: w1.y,
        width: w1.width,
        height: w1.height,
        type: "deleted",
        text: w1.word,
      });
      i--;
    }
  }

  return {
    diffs1: mergeLineBoxes(deletedBoxes),
    diffs2: mergeLineBoxes(addedBoxes),
    textDiffs: [...prefixDiffs, ...midDiffs, ...suffixDiffs],
  };
}

/**
 * Pixel block visual comparison on rendered page canvases (fallback for pure scanned PDFs without text).
 */
async function computeVisualDiffBoxes(
  page1: PDFPageProxy | null,
  page2: PDFPageProxy | null
): Promise<{ diffs1: DiffBox[]; diffs2: DiffBox[] }> {
  if (!page1 || !page2) return { diffs1: [], diffs2: [] };

  const scale = 1.0;
  const vp1 = page1.getViewport({ scale });
  const vp2 = page2.getViewport({ scale });

  const width = Math.max(vp1.width, vp2.width);
  const height = Math.max(vp1.height, vp2.height);

  const canvas1 = document.createElement("canvas");
  canvas1.width = width;
  canvas1.height = height;
  const ctx1 = canvas1.getContext("2d", { willReadFrequently: true });

  const canvas2 = document.createElement("canvas");
  canvas2.width = width;
  canvas2.height = height;
  const ctx2 = canvas2.getContext("2d", { willReadFrequently: true });

  if (!ctx1 || !ctx2) return { diffs1: [], diffs2: [] };

  ctx1.fillStyle = "#ffffff";
  ctx1.fillRect(0, 0, width, height);
  ctx2.fillStyle = "#ffffff";
  ctx2.fillRect(0, 0, width, height);

  await Promise.all([
    page1.render({ canvas: canvas1, canvasContext: ctx1, viewport: vp1 }).promise,
    page2.render({ canvas: canvas2, canvasContext: ctx2, viewport: vp2 }).promise,
  ]);

  const imgData1 = ctx1.getImageData(0, 0, width, height).data;
  const imgData2 = ctx2.getImageData(0, 0, width, height).data;

  const blockSize = 16;
  const rawDiffBoxes1: DiffBox[] = [];
  const rawDiffBoxes2: DiffBox[] = [];
  let diffId = 0;

  for (let y = 0; y < height; y += blockSize) {
    for (let x = 0; x < width; x += blockSize) {
      let diffPixels = 0;
      let totalSamples = 0;
      let doc1Brightness = 0;
      let doc2Brightness = 0;

      const step = 2;
      for (let by = y; by < Math.min(y + blockSize, height); by += step) {
        for (let bx = x; bx < Math.min(x + blockSize, width); bx += step) {
          const idx = (by * width + bx) * 4;
          const r1 = imgData1[idx];
          const g1 = imgData1[idx + 1];
          const b1 = imgData1[idx + 2];

          const r2 = imgData2[idx];
          const g2 = imgData2[idx + 1];
          const b2 = imgData2[idx + 2];

          const dR = Math.abs(r1 - r2);
          const dG = Math.abs(g1 - g2);
          const dB = Math.abs(b1 - b2);

          const bright1 = (r1 + g1 + b1) / 3;
          const bright2 = (r2 + g2 + b2) / 3;
          doc1Brightness += bright1;
          doc2Brightness += bright2;

          if (dR + dG + dB > 60) {
            diffPixels++;
          }
          totalSamples++;
        }
      }

      if (totalSamples > 0 && diffPixels / totalSamples > 0.15) {
        const avg1 = doc1Brightness / totalSamples;
        const avg2 = doc2Brightness / totalSamples;

        const bxPct = (x / width) * 100;
        const byPct = (y / height) * 100;
        const bwPct = (Math.min(blockSize, width - x) / width) * 100;
        const bhPct = (Math.min(blockSize, height - y) / height) * 100;

        if (avg1 < avg2 - 20) {
          rawDiffBoxes1.push({
            id: `diff-del-${diffId++}`,
            x: bxPct,
            y: byPct,
            width: bwPct,
            height: bhPct,
            type: "deleted",
          });
        } else if (avg2 < avg1 - 20) {
          rawDiffBoxes2.push({
            id: `diff-add-${diffId++}`,
            x: bxPct,
            y: byPct,
            width: bwPct,
            height: bhPct,
            type: "added",
          });
        }
      }
    }
  }

  return {
    diffs1: mergeLineBoxes(rawDiffBoxes1),
    diffs2: mergeLineBoxes(rawDiffBoxes2),
  };
}

export async function comparePdfDocuments(
  file1: File,
  file2: File,
  onProgress?: (percent: number, status: string) => void
): Promise<ComparisonResult> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  onProgress?.(10, "Loading PDF documents...");
  const [bytes1, bytes2] = await Promise.all([file1.arrayBuffer(), file2.arrayBuffer()]);

  const [doc1, doc2]: [PDFDocumentProxy, PDFDocumentProxy] = await Promise.all([
    pdfjs.getDocument({ data: bytes1 }).promise,
    pdfjs.getDocument({ data: bytes2 }).promise,
  ]);

  const doc1Pages = doc1.numPages;
  const doc2Pages = doc2.numPages;
  const totalPages = Math.max(doc1Pages, doc2Pages);

  const pages: PageComparison[] = [];
  let totalDifferences = 0;
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (let p = 1; p <= totalPages; p++) {
    const progressPct = 15 + Math.round((p / totalPages) * 75);
    onProgress?.(progressPct, `Comparing page ${p} of ${totalPages}...`);

    const hasDoc1 = p <= doc1Pages;
    const hasDoc2 = p <= doc2Pages;

    let page1: PDFPageProxy | null = null;
    let page2: PDFPageProxy | null = null;

    if (hasDoc1) page1 = await doc1.getPage(p);
    if (hasDoc2) page2 = await doc2.getPage(p);

    let textDiffs: TextDiffToken[] = [];
    let diffsDoc1: DiffBox[] = [];
    let diffsDoc2: DiffBox[] = [];

    if (page1 && page2) {
      // 1. Extract words with bounding boxes from both pages
      const [w1, w2] = await Promise.all([extractPageWords(page1), extractPageWords(page2)]);

      if (w1.length > 0 || w2.length > 0) {
        // High-precision text diffing with word bounding boxes
        const textDiffResult = computeTextDiff(w1, w2);
        diffsDoc1 = textDiffResult.diffs1;
        diffsDoc2 = textDiffResult.diffs2;
        textDiffs = textDiffResult.textDiffs;
      } else {
        // Fallback for scanned PDFs without extractable text
        const visualDiff = await computeVisualDiffBoxes(page1, page2);
        diffsDoc1 = visualDiff.diffs1;
        diffsDoc2 = visualDiff.diffs2;
      }
    } else if (page1 && !page2) {
      // Page deleted in Document 2
      diffsDoc1 = [
        {
          id: `del-page-${p}`,
          x: 2,
          y: 2,
          width: 96,
          height: 96,
          type: "deleted",
          text: "Page removed in second document",
        },
      ];
      textDiffs = [{ type: "deleted", text: "Entire page deleted in comparison document." }];
    } else if (!page1 && page2) {
      // Page added in Document 2
      diffsDoc2 = [
        {
          id: `add-page-${p}`,
          x: 2,
          y: 2,
          width: 96,
          height: 96,
          type: "added",
          text: "Page added in second document",
        },
      ];
      textDiffs = [{ type: "added", text: "New page added to document." }];
    }

    const pageDiffCount = diffsDoc1.length + diffsDoc2.length;
    totalDifferences += pageDiffCount;
    totalDeletions += diffsDoc1.length;
    totalAdditions += diffsDoc2.length;

    pages.push({
      pageNumber: p,
      hasDoc1,
      hasDoc2,
      diffsDoc1,
      diffsDoc2,
      textDiffs,
      totalDiffs: pageDiffCount,
    });
  }

  onProgress?.(100, "Comparison complete!");

  return {
    file1Name: file1.name,
    file2Name: file2.name,
    doc1Pages,
    doc2Pages,
    totalPages,
    totalDifferences,
    totalAdditions,
    totalDeletions,
    pages,
  };
}
