// Splits a reply that is still streaming into the part that is finished and
// the part still being written, so the finished part can be rendered as
// markdown once and left alone while only the short tail re-renders per token.
//
// The seam is the last blank line — markdown's block boundary — that isn't
// inside an open code fence (a blank line inside a fence is just part of the
// code). A reply with no such seam yet is all tail.
export function splitStreamingMarkdown(text: string): { stable: string; tail: string } {
  let seam = text.lastIndexOf("\n\n");
  while (seam > 0) {
    if (!insideFence(text, seam)) return { stable: text.slice(0, seam), tail: text.slice(seam + 2) };
    seam = text.lastIndexOf("\n\n", seam - 1);
  }
  return { stable: "", tail: text };
}

// Whether `index` falls inside a fenced code block, counting the fence lines
// (``` or ~~~, optionally indented) that open or close one before it.
function insideFence(text: string, index: number): boolean {
  let open = false;
  for (const line of text.slice(0, index).split("\n")) {
    if (/^\s{0,3}(```|~~~)/.test(line)) open = !open;
  }
  return open;
}
