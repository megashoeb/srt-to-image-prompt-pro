export interface Subtitle {
  id: string;
  startTime: string;
  endTime: string;
  text: string;
}

export function parseSRT(srtContent: string): Subtitle[] {
  const subtitles: Subtitle[] = [];
  // Normalize line endings
  const normalized = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\n+/);

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    if (lines.length >= 3) {
      const id = lines[0].trim();
      const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
      if (timeMatch) {
        const startTime = timeMatch[1];
        const endTime = timeMatch[2];
        const text = lines.slice(2).join(' ').trim();
        subtitles.push({ id, startTime, endTime, text });
      }
    }
  }
  return subtitles;
}
