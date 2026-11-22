// Gridlines on whole, evenly spaced degrees (1°, 2°, 5°, …) with about a degree
// of headroom above and below the data, at most six steps tall.
export function temperatureTicks(minValue: number, maxValue: number): number[] {
  const low = minValue - 1;
  const high = maxValue + 1;
  const step = [1, 2, 5, 10, 20, 50].find(candidate => (high - low) / candidate <= 5) ?? 100;
  const ticks: number[] = [];
  for (let value = Math.floor(low / step) * step; value <= Math.ceil(high / step) * step; value += step) ticks.push(value);
  return ticks;
}

// Vertical offsets for the room names written at the right end of each line.
// The highest line is labelled above its end point and every other line below,
// pushed down where needed so no two labels sit closer than one text line.
export function endLabelOffsets(endYs: number[], lineHeight = 13): number[] {
  const offsets = new Array<number>(endYs.length).fill(0);
  let previous = -Infinity;
  endYs.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y).forEach(({ y, index }, rank) => {
    const labelY = Math.max(y + (rank === 0 ? -8 : 16), previous + lineHeight);
    offsets[index] = labelY - y;
    previous = labelY;
  });
  return offsets;
}
