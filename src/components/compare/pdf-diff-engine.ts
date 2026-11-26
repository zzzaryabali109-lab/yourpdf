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

const MIN_WORDS_FOR_TEXT_DIFF = 4;

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
 * Visual comparison fallback for scanned pages and pages without extractable text.
 */
type PageCanvasBounds = {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
};

type VisualDiffResult = {
  diffs1: DiffBox[];
  diffs2: DiffBox[];
  totalDiffs: number;
  additions: number;
  deletions: number;
};

function getLuminance(data: Uint8ClampedArray, index: number): number {
  return (data[index] * 77 + data[index + 1] * 150 + data[index + 2] * 29) >> 8;
}

/**
 * Register two page renders with a small translation search. This absorbs the few-pixel
 * shifts common in rescanned or re-exported documents before looking for changed content.
 */
function estimateVisualAlignment(
  data1: Uint8ClampedArray,
  data2: Uint8ClampedArray,
  width: number,
  height: number
): { x: number; y: number } {
  const radius = Math.min(8, Math.floor(Math.min(width, height) / 80));
  if (radius < 1) return { x: 0, y: 0 };

  const stride = Math.max(3, Math.ceil(Math.max(width, height) / 180));
  let bestX = 0;
  let bestY = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      let totalDifference = 0;
      let samples = 0;

      for (let y = radius; y < height - radius; y += stride) {
        const y2 = y + dy;
        for (let x = radius; x < width - radius; x += stride) {
          const x2 = x + dx;
          const index1 = (y * width + x) * 4;
          const index2 = (y2 * width + x2) * 4;
          totalDifference += Math.abs(getLuminance(data1, index1) - getLuminance(data2, index2));
          samples++;
        }
      }

      if (samples === 0) continue;
      const score = totalDifference / samples + (Math.abs(dx) + Math.abs(dy)) * 0.001;
      if (score < bestScore) {
        bestScore = score;
        bestX = dx;
        bestY = dy;
      }
    }
  }

  return { x: bestX, y: bestY };
}

function createVisualPageBox(
  left: number,
  top: number,
  right: number,
  bottom: number,
  page: PageCanvasBounds,
  shiftX: number,
  shiftY: number,
  type: DiffBox["type"],
  id: string
): DiffBox | null {
  const pageLeft = Math.max(0, left + shiftX - page.offsetX);
  const pageTop = Math.max(0, top + shiftY - page.offsetY);
  const pageRight = Math.min(page.width, right + shiftX - page.offsetX);
  const pageBottom = Math.min(page.height, bottom + shiftY - page.offsetY);
  if (pageRight <= pageLeft || pageBottom <= pageTop) return null;

  return {
    id,
    x: (pageLeft / page.width) * 100,
    y: (pageTop / page.height) * 100,
    width: ((pageRight - pageLeft) / page.width) * 100,
    height: ((pageBottom - pageTop) / page.height) * 100,
    type,
  };
}

/**
 * Render both pages at a shared scale, align small scan shifts, then cluster changed pixels
 * into page-relative boxes. This works even when PDFs contain only scanned page images.
 */
async function computeVisualDiffBoxes(
  page1: PDFPageProxy | null,
  page2: PDFPageProxy | null
): Promise<VisualDiffResult> {
  const empty: VisualDiffResult = { diffs1: [], diffs2: [], totalDiffs: 0, additions: 0, deletions: 0 };
  if (!page1 || !page2) return empty;

  const baseViewport1 = page1.getViewport({ scale: 1 });
  const baseViewport2 = page2.getViewport({ scale: 1 });
  const largestPageSide = Math.max(
    baseViewport1.width,
    baseViewport1.height,
    baseViewport2.width,
    baseViewport2.height
  );
  const scale = Math.min(1.5, 1200 / largestPageSide);
  const viewport1 = page1.getViewport({ scale });
  const viewport2 = page2.getViewport({ scale });
  const width = Math.ceil(Math.max(viewport1.width, viewport2.width));
  const height = Math.ceil(Math.max(viewport1.height, viewport2.height));
  const offset1 = { x: Math.floor((width - viewport1.width) / 2), y: Math.floor((height - viewport1.height) / 2) };
  const offset2 = { x: Math.floor((width - viewport2.width) / 2), y: Math.floor((height - viewport2.height) / 2) };

  const canvas1 = document.createElement("canvas");
  canvas1.width = width;
  canvas1.height = height;
  const ctx1 = canvas1.getContext("2d", { willReadFrequently: true });
  const canvas2 = document.createElement("canvas");
  canvas2.width = width;
  canvas2.height = height;
  const ctx2 = canvas2.getContext("2d", { willReadFrequently: true });
  if (!ctx1 || !ctx2) return empty;

  ctx1.fillStyle = "#ffffff";
  ctx1.fillRect(0, 0, width, height);
  ctx2.fillStyle = "#ffffff";
  ctx2.fillRect(0, 0, width, height);

  const renderCenteredPage = async (
    page: PDFPageProxy,
    targetContext: CanvasRenderingContext2D,
    viewportWidth: number,
    viewportHeight: number,
    offset: { x: number; y: number }
  ) => {
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = Math.ceil(viewportWidth);
    pageCanvas.height = Math.ceil(viewportHeight);
    const pageContext = pageCanvas.getContext("2d", { willReadFrequently: true });
    if (!pageContext) throw new Error("Could not create a canvas to compare PDF pages.");
    await page.render({ canvas: pageCanvas, canvasContext: pageContext, viewport: page.getViewport({ scale }) }).promise;
    targetContext.drawImage(pageCanvas, offset.x, offset.y);
    pageCanvas.width = 0;
    pageCanvas.height = 0;
  };

  await Promise.all([
    renderCenteredPage(page1, ctx1, viewport1.width, viewport1.height, offset1),
    renderCenteredPage(page2, ctx2, viewport2.width, viewport2.height, offset2),
  ]);

  const data1 = ctx1.getImageData(0, 0, width, height).data;
  const data2 = ctx2.getImageData(0, 0, width, height).data;
  const alignment = estimateVisualAlignment(data1, data2, width, height);
  const cellSize = 8;
  const columns = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const cellCount = columns * rows;
  const activeCells = new Uint8Array(cellCount);

  for (let cellY = 0; cellY < rows; cellY++) {
    const top = cellY * cellSize;
    const bottom = Math.min(height, top + cellSize);
    for (let cellX = 0; cellX < columns; cellX++) {
      const left = cellX * cellSize;
      const right = Math.min(width, left + cellSize);
      const cellIndex = cellY * columns + cellX;
      let changedPixels = 0;
      let totalPixels = 0;

      for (let y = top; y < bottom; y++) {
        const y2 = y + alignment.y;
        for (let x = left; x < right; x++) {
          const x2 = x + alignment.x;
          const index1 = (y * width + x) * 4;
          const index2 = x2 >= 0 && x2 < width && y2 >= 0 && y2 < height
            ? (y2 * width + x2) * 4
            : -1;
          const r2 = index2 < 0 ? 255 : data2[index2];
          const g2 = index2 < 0 ? 255 : data2[index2 + 1];
          const b2 = index2 < 0 ? 255 : data2[index2 + 2];
          const luminance2 = index2 < 0 ? 255 : getLuminance(data2, index2);
          const luminanceDifference = Math.abs(getLuminance(data1, index1) - luminance2);
          const channelDifference =
            Math.abs(data1[index1] - r2) +
            Math.abs(data1[index1 + 1] - g2) +
            Math.abs(data1[index1 + 2] - b2);

          if (luminanceDifference >= 28 || channelDifference >= 72) changedPixels++;
          totalPixels++;
        }
      }

      const minimumChangedPixels = Math.max(3, Math.ceil(totalPixels * 0.06));
      if (totalPixels > 0 && changedPixels >= minimumChangedPixels) activeCells[cellIndex] = 1;
    }
  }

  const visited = new Uint8Array(cellCount);
  const diffs1: DiffBox[] = [];
  const diffs2: DiffBox[] = [];
  let totalDiffs = 0;
  let additions = 0;
  let deletions = 0;
  let diffId = 0;

  for (let start = 0; start < cellCount; start++) {
    if (!activeCells[start] || visited[start]) continue;

    const queue = [start];
    visited[start] = 1;
    let minCellX = columns;
    let maxCellX = -1;
    let minCellY = rows;
    let maxCellY = -1;

    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      const cellX = current % columns;
      const cellY = Math.floor(current / columns);
      minCellX = Math.min(minCellX, cellX);
      maxCellX = Math.max(maxCellX, cellX);
      minCellY = Math.min(minCellY, cellY);
      maxCellY = Math.max(maxCellY, cellY);
      for (let neighborY = Math.max(0, cellY - 1); neighborY <= Math.min(rows - 1, cellY + 1); neighborY++) {
        for (let neighborX = Math.max(0, cellX - 1); neighborX <= Math.min(columns - 1, cellX + 1); neighborX++) {
          const neighbor = neighborY * columns + neighborX;
          if (activeCells[neighbor] && !visited[neighbor]) {
            visited[neighbor] = 1;
            queue.push(neighbor);
          }
        }
      }
    }

    const padding = 2;
    const left = Math.max(0, minCellX * cellSize - padding);
    const top = Math.max(0, minCellY * cellSize - padding);
    const right = Math.min(width, (maxCellX + 1) * cellSize + padding);
    const bottom = Math.min(height, (maxCellY + 1) * cellSize + padding);
    let ink1 = 0;
    let ink2 = 0;
    let inkSamples = 0;

    for (let y = top; y < bottom; y += 2) {
      for (let x = left; x < right; x += 2) {
        const x2 = x + alignment.x;
        const y2 = y + alignment.y;
        const index1 = (y * width + x) * 4;
        const index2 = x2 >= 0 && x2 < width && y2 >= 0 && y2 < height
          ? (y2 * width + x2) * 4
          : -1;
        ink1 += 255 - getLuminance(data1, index1);
        ink2 += index2 < 0 ? 0 : 255 - getLuminance(data2, index2);
        inkSamples++;
      }
    }

    const inkDifference = ink2 / Math.max(1, inkSamples) - ink1 / Math.max(1, inkSamples);
    const boxId = diffId++;
    if (inkDifference > 14) {
      const box = createVisualPageBox(left, top, right, bottom, { ...viewport2, offsetX: offset2.x, offsetY: offset2.y }, alignment.x, alignment.y, "added", `visual-add-${boxId}`);
      if (box) diffs2.push(box);
      if (box) { totalDiffs++; additions++; }
    } else if (inkDifference < -14) {
      const box = createVisualPageBox(left, top, right, bottom, { ...viewport1, offsetX: offset1.x, offsetY: offset1.y }, 0, 0, "deleted", `visual-del-${boxId}`);
      if (box) diffs1.push(box);
      if (box) { totalDiffs++; deletions++; }
    } else {
      const box1 = createVisualPageBox(left, top, right, bottom, { ...viewport1, offsetX: offset1.x, offsetY: offset1.y }, 0, 0, "modified", `visual-mod-old-${boxId}`);
      const box2 = createVisualPageBox(left, top, right, bottom, { ...viewport2, offsetX: offset2.x, offsetY: offset2.y }, alignment.x, alignment.y, "modified", `visual-mod-new-${boxId}`);
      if (box1) diffs1.push(box1);
      if (box2) diffs2.push(box2);
      if (box1 || box2) totalDiffs++;
    }
  }

  return { diffs1, diffs2, totalDiffs, additions, deletions };
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
    let visualDiffCount: number | null = null;

    if (page1 && page2) {
      // 1. Extract words with bounding boxes from both pages
      const [w1, w2] = await Promise.all([extractPageWords(page1), extractPageWords(page2)]);

      if (w1.length >= MIN_WORDS_FOR_TEXT_DIFF && w2.length >= MIN_WORDS_FOR_TEXT_DIFF) {
        // High-precision text diffing with word bounding boxes
        const textDiffResult = computeTextDiff(w1, w2);
        diffsDoc1 = textDiffResult.diffs1;
        diffsDoc2 = textDiffResult.diffs2;
        textDiffs = textDiffResult.textDiffs;
      } else {
        // Compare rendered pixels when either page has no selectable text.
        onProgress?.(progressPct, `Comparing scanned content on page ${p} of ${totalPages}...`);
        const visualDiff = await computeVisualDiffBoxes(page1, page2);
        diffsDoc1 = visualDiff.diffs1;
        diffsDoc2 = visualDiff.diffs2;
        visualDiffCount = visualDiff.totalDiffs;
        totalAdditions += visualDiff.additions;
        totalDeletions += visualDiff.deletions;
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

    const pageDiffCount = visualDiffCount ?? diffsDoc1.length + diffsDoc2.length;
    totalDifferences += pageDiffCount;
    if (visualDiffCount === null) {
      totalDeletions += diffsDoc1.length;
      totalAdditions += diffsDoc2.length;
    }

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
