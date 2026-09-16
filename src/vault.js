export function moveEntry(entries, sourceId, targetId, placeAfter) {
  const sourceIndex = entries.findIndex(entry => entry.id === sourceId);
  const targetIndexBeforeRemoval = entries.findIndex(entry => entry.id === targetId);
  if (sourceIndex < 0 || targetIndexBeforeRemoval < 0 || sourceId === targetId) return entries;
  const reordered = [...entries];
  const [moved] = reordered.splice(sourceIndex, 1);
  const targetIndex = reordered.findIndex(entry => entry.id === targetId);
  reordered.splice(targetIndex + (placeAfter ? 1 : 0), 0, moved);
  return reordered;
}
